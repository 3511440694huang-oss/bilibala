package com.replayradio.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.GZIPInputStream
import java.util.zip.Inflater
import java.util.zip.InflaterInputStream

/**
 * 回放弹幕：拉 B 站的 XML 弹幕、解析成紧凑数组、按 6 分钟一段切片给前端。
 *
 * 为什么单独一个文件：
 *  · 这条链路有三件容易互相污染的事——网络原始字节的解压、XML 扫描、两级缓存；
 *    塞进 LocalServer 会让「路由」和「脏活」缠在一起；
 *  · 解析结果要同时服务多个请求（同一 cid 的不同 seg），必须有一处统一的缓存与锁。
 *
 * 实机确认的两个坑（写死在这里，别再踩）：
 *  1. list.so 的 Content-Encoding 是 deflate，但**实际发的是裸 deflate（没有 0x78 头）**，
 *     按 zlib 解会直接 -3；必须按裸流再试一次（见 decode()）；
 *  2. XML 里 p 的第 1 个字段是「秒.5 位小数」（0.60100 = 601 ms），不是毫秒。
 *     按毫秒直接 toLong 会得到 0，弹幕会全部挤到 0 秒（见 toMs()）。
 *
 * 内存 LRU 12 个 cid + 磁盘 filesDir/dm/<cid>.json（7 天），进程内用一把锁保护。
 */
object Danmaku {
    private const val UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    private const val REFERER = "https://www.bilibili.com"
    private const val LIST_SO = "https://api.bilibili.com/x/v1/dm/list.so?oid="

    /** 一段的长度。前端按 seg 拉，服务端负责把 [from,to) 切好，省得页面自己过滤。 */
    private const val SEG_MS = 360_000L

    /** 单个 cid 最多保留的条数（防御性上限）。total 仍然报真实值，截断只影响 items。 */
    private const val MAX_ITEMS = 20_000

    private const val MEM_MAX = 12
    private const val DISK_TTL_MS = 7L * 24 * 3600 * 1000

    @Volatile private var dir: File? = null

    /** 服务启动时调一次；之后所有请求都复用这个目录。 */
    fun init(context: Context) {
        dir = File(context.filesDir, "dm")
    }

    /** 一条弹幕。text 已做 XML 反转义并按 120 字截断。 */
    private class Item(val ms: Long, val mode: Int, val size: Int, val color: Int, val text: String)

    /** 一个 cid 的完整解析结果（items 已按 ms 升序）。 */
    private class Doc(val cid: String, val total: Int, val items: List<Item>)

    private val lock = Any()

    // accessOrder=true：访问即刷新位置，超 12 个淘汰最久未用的。
    private val mem = object : LinkedHashMap<String, Doc>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<String, Doc>?): Boolean =
            size > MEM_MAX
    }

    // ---------------- 对外入口 ----------------

    /**
     * 返回 /api/dm 的完整响应正文（紧凑 JSON）。
     * 失败直接抛异常，由 LocalServer 统一翻成 502 —— 这里不碰 OutputStream，便于复用。
     */
    fun buildJson(cid: String, seg: Int): String {
        val doc = load(cid) ?: run {
            val fresh = download(cid)
            synchronized(lock) {
                // 并发下另一个线程可能已经写好：以内存里的为准，避免同一 cid 出现两份对象
                mem[cid] ?: fresh.also {
                    mem[cid] = it
                    writeDisk(it)
                }
            }
        }
        val from = seg.toLong() * SEG_MS
        val to = from + SEG_MS
        val sb = StringBuilder(1024 + doc.items.size / 4)
        sb.append("{\"cid\":\"").append(doc.cid)
            .append("\",\"seg\":").append(seg)
            .append(",\"from\":").append(from)
            .append(",\"to\":").append(to)
            .append(",\"total\":").append(doc.total)
            .append(",\"items\":[")
        var n = 0
        for (it in doc.items) {
            if (it.ms < from) continue
            if (it.ms >= to) break          // items 已升序
            if (n++ > 0) sb.append(',')
            sb.append('[').append(it.ms).append(',').append(it.mode).append(',')
                .append(it.size).append(',').append(it.color).append(',')
            appendJsonString(sb, it.text)
            sb.append(']')
        }
        sb.append("]}")
        return sb.toString()
    }

    // ---------------- 缓存 ----------------

    private fun cacheDir(): File {
        val d = dir ?: throw IllegalStateException("弹幕缓存未初始化")
        if (!d.exists()) d.mkdirs()
        return d
    }

    private fun load(cid: String): Doc? = synchronized(lock) {
        mem[cid]?.let { return it }
        val f = File(cacheDir(), "$cid.json")
        if (!f.isFile) return null
        if (System.currentTimeMillis() - f.lastModified() > DISK_TTL_MS) return null   // 过期：下次联网重拉
        val doc = try {
            val o = JSONObject(f.readText(Charsets.UTF_8))
            Doc(cid, o.optInt("total", 0), readItems(o.optJSONArray("items")))
        } catch (_: Exception) {
            // 半截/损坏的文件当没有：删掉，走网络重新生成
            try { f.delete() } catch (_: Exception) {}
            return null
        }
        mem[cid] = doc
        doc
    }

    /** 先写 .tmp 再改名：进程被杀时不会留下半截 JSON 被下次启动当成有效缓存。 */
    private fun writeDisk(doc: Doc) {
        val target = File(cacheDir(), "${doc.cid}.json")
        val tmp = File(cacheDir(), "${doc.cid}.json.tmp")
        val sb = StringBuilder(64 + doc.items.size * 48)
        sb.append("{\"total\":").append(doc.total).append(",\"items\":[")
        for ((i, it) in doc.items.withIndex()) {
            if (i > 0) sb.append(',')
            sb.append('[').append(it.ms).append(',').append(it.mode).append(',')
                .append(it.size).append(',').append(it.color).append(',')
            appendJsonString(sb, it.text)
            sb.append(']')
        }
        sb.append("]}")
        try {
            tmp.writeText(sb.toString(), Charsets.UTF_8)
            if (!tmp.renameTo(target)) {
                target.writeText(sb.toString(), Charsets.UTF_8)
                tmp.delete()
            }
        } catch (e: Exception) {
            // 磁盘满/权限异常不该影响正在进行的请求：内存缓存已经活着，下次联网重来
            Diag.log("dm cache write failed: ${e.javaClass.simpleName}")
            try { tmp.delete() } catch (_: Exception) {}
        }
    }

    private fun readItems(arr: JSONArray?): List<Item> {
        if (arr == null || arr.length() == 0) return emptyList()
        val out = ArrayList<Item>(arr.length())
        for (i in 0 until arr.length()) {
            val a = arr.optJSONArray(i) ?: continue
            val text = a.optString(4)
            if (text.isEmpty()) continue
            out.add(Item(a.optLong(0), a.optInt(1, 1), a.optInt(2, 25), a.optInt(3, 0xFFFFFF), text))
        }
        return out
    }

    // ---------------- 网络 ----------------

    private fun cookie(): String {
        val parts = ArrayList<String>(3)
        val sess = Store.cred("SESSDATA").trim()
        if (sess.isNotEmpty()) parts.add("SESSDATA=$sess")
        val uid = Store.cred("DedeUserID").trim()
        if (uid.isNotEmpty()) parts.add("DedeUserID=$uid")
        val buvid = Store.cred("buvid3").trim()
        if (buvid.isNotEmpty()) parts.add("buvid3=$buvid")
        return parts.joinToString("; ")
    }

    private fun download(cid: String): Doc {
        val conn = URL(LIST_SO + cid).openConnection() as HttpURLConnection
        conn.requestMethod = "GET"
        conn.connectTimeout = 12_000
        conn.readTimeout = 25_000
        conn.instanceFollowRedirects = true
        conn.setRequestProperty("User-Agent", UA)
        conn.setRequestProperty("Referer", REFERER)
        conn.setRequestProperty("Accept", "text/xml,application/xml,*/*")
        // 明确声明编码：带了这个头 HttpURLConnection 就不会自动解压，我们拿到的一定是原始字节，
        // 解压规则由 decode() 决定（B 站实际发裸 deflate，自动解压反而更不可控）。
        conn.setRequestProperty("Accept-Encoding", "gzip, deflate")
        val ck = cookie()
        if (ck.isNotEmpty()) conn.setRequestProperty("Cookie", ck)
        try {
            val code = conn.responseCode
            if (code == 412) throw RuntimeException("被风控限流（412），请稍后再试")
            if (code != 200) throw RuntimeException("HTTP $code")
            val raw = conn.inputStream.use { it.readBytes() }
            val xml = decode(raw)
            return parse(cid, xml)
        } finally {
            conn.disconnect()
        }
    }

    /**
     * 按内容判断压缩格式。不要相信 Content-Encoding 头：
     *  · gzip：魔数 1f 8b；
     *  · zlib：魔数 0x78（还能再细分，但 Inflater 认得）；
     *  · 明文：以 XML 声明/根节点开头；
     *  · 其余按裸 deflate 再试（B 站实际就是这种），最后兜底 zlib/gzip。
     */
    private fun decode(raw: ByteArray): String {
        if (raw.isEmpty()) throw RuntimeException("接口返回空内容")
        val b0 = raw[0].toInt() and 0xFF
        val b1 = if (raw.size > 1) raw[1].toInt() and 0xFF else 0

        if (b0 == 0x1F && b1 == 0x8B) return gunzip(raw)

        if (b0 == 0x78) {
            try { return inflate(raw, false) } catch (_: Exception) { /* 其实不是 zlib，继续试 */ }
        }
        if (looksLikeXml(raw)) return String(raw, Charsets.UTF_8)
        // B 站风险接口返回的是 JSON（例如风控提示），别把它当压缩数据硬解
        if (b0 == '{'.code) throw RuntimeException("接口返回错误：${cut(String(raw, Charsets.UTF_8), 120)}")
        // 风控页/错误页是 HTML：直接给一句人话，别掉到下面的解压分支报「解压失败」。
        // （裸 deflate 也有极小概率以 '<' 开头，所以再确认一下确实是 HTML 标签）
        if (b0 == '<'.code) {
            val head = String(raw, 0, minOf(raw.size, 256), Charsets.UTF_8).lowercase()
            if (head.contains("<html") || head.startsWith("<!doctype")) {
                throw RuntimeException("接口返回了网页而不是弹幕（可能被风控拦截）")
            }
        }

        try { return inflate(raw, true) } catch (_: Exception) {}
        try { return inflate(raw, false) } catch (_: Exception) {}
        try { return gunzip(raw) } catch (_: Exception) {}
        throw RuntimeException("弹幕数据解压失败")
    }

    private fun looksLikeXml(raw: ByteArray): Boolean {
        val head = String(raw, 0, minOf(raw.size, 64), Charsets.UTF_8).trimStart()
        return head.startsWith("<?xml") || head.startsWith("<i>") || head.startsWith("<i ")
    }

    private fun gunzip(raw: ByteArray): String = GZIPInputStream(ByteArrayInputStream(raw)).use {
        val out = ByteArrayOutputStream(maxOf(raw.size * 4, 8192))
        val buf = ByteArray(16 * 1024)
        while (true) { val n = it.read(buf); if (n < 0) break; out.write(buf, 0, n) }
        String(out.toByteArray(), Charsets.UTF_8)
    }

    /** nowrap=true 表示裸 deflate（不带 zlib 头），B 站的实际格式。 */
    private fun inflate(raw: ByteArray, nowrap: Boolean): String {
        val inf = Inflater(nowrap)
        try {
            val out = ByteArrayOutputStream(maxOf(raw.size * 5, 8192))
            InflaterInputStream(ByteArrayInputStream(raw), inf, 8192).use { input ->
                val buf = ByteArray(16 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    if (out.size() > 64 * 1024 * 1024) throw RuntimeException("解压后过大")
                }
            }
            val bytes = out.toByteArray()
            if (bytes.isEmpty()) throw RuntimeException("解压后为空")
            val text = String(bytes, Charsets.UTF_8)
            // 裸 deflate 用错格式时偶尔不报错而是吐出垃圾：不是弹幕 XML 就判失败，交给上层换方案
            if (!text.contains("<i>") && !text.contains("<d p=")) throw RuntimeException("解压结果不是弹幕 XML")
            return text
        } finally {
            inf.end()
        }
    }

    // ---------------- XML 解析 ----------------

    private fun parse(cid: String, xml: String): Doc {
        val items = ArrayList<Item>(2048)
        var total = 0
        var pos = 0
        while (true) {
            val start = xml.indexOf("<d p=\"", pos)
            if (start < 0) break
            val pStart = start + 6
            val pEnd = xml.indexOf('"', pStart)
            if (pEnd < 0) break
            val tagEnd = xml.indexOf('>', pEnd)
            if (tagEnd < 0) break
            val end = xml.indexOf("</d>", tagEnd + 1)
            if (end < 0) break
            pos = end + 4

            // 只切需要的字段，避免每个条目都 split 出 9 个字符串
            val p = xml.substring(pStart, pEnd)
            val c1 = p.indexOf(',')
            if (c1 < 0) continue
            val c2 = p.indexOf(',', c1 + 1)
            val c3 = if (c2 < 0) -1 else p.indexOf(',', c2 + 1)
            val c4 = if (c3 < 0) -1 else p.indexOf(',', c3 + 1)
            val ms = toMs(p.substring(0, c1)) ?: continue
            val text = truncate(unescape(xml.substring(tagEnd + 1, end)).trim(), 120)
            if (text.isEmpty()) continue
            total++
            if (items.size < MAX_ITEMS) {
                items.add(Item(
                    ms,
                    if (c2 > 0) p.substring(c1 + 1, c2).trim().toIntOrNull() ?: 1 else 1,
                    if (c3 > 0) p.substring(c2 + 1, c3).trim().toIntOrNull() ?: 25 else 25,
                    if (c4 > 0) p.substring(c3 + 1, c4).trim().toIntOrNull() ?: 0xFFFFFF else 0xFFFFFF,
                    text))
            }
        }
        items.sortBy { it.ms }
        return Doc(cid, total, items)
    }

    /**
     * p 的第 1 字段是时间：实机确认 list.so 给的是「秒.5 位小数」（0.60100 / 188.33500）。
     * 带小数点一律按秒换算；极少数镜像/自造数据直接给毫秒整数（没小数点），按毫秒处理。
     * 负数（无效弹幕）返回 null，由调用方丢弃。
     */
    private fun toMs(raw: String): Long? {
        val v = raw.trim().toDoubleOrNull() ?: return null
        if (v < 0) return null
        return if (raw.contains('.')) Math.round(v * 1000.0) else Math.round(v)
    }

    /** XML 实体反转义：单遍扫描，遇到 &...; 才解码，因此 &amp;lt; 不会被二次解码成 <。 */
    private fun unescape(s: String): String {
        if (s.indexOf('&') < 0) return s
        val sb = StringBuilder(s.length)
        var i = 0
        while (i < s.length) {
            val c = s[i]
            if (c != '&') { sb.append(c); i++; continue }
            val semi = s.indexOf(';', i + 1)
            if (semi < 0 || semi - i > 10) { sb.append(c); i++; continue }
            val ent = s.substring(i + 1, semi)
            when {
                ent == "amp" -> sb.append('&')
                ent == "lt" -> sb.append('<')
                ent == "gt" -> sb.append('>')
                ent == "quot" -> sb.append('"')
                ent == "apos" -> sb.append('\'')
                ent.startsWith("#x") || ent.startsWith("#X") -> {
                    val cp = ent.substring(2).toIntOrNull(16)
                    if (cp != null && Character.isValidCodePoint(cp)) sb.appendCodePoint(cp)
                    else sb.append(s, i, semi + 1)
                }
                ent.startsWith("#") -> {
                    val cp = ent.substring(1).toIntOrNull()
                    if (cp != null && Character.isValidCodePoint(cp)) sb.appendCodePoint(cp)
                    else sb.append(s, i, semi + 1)
                }
                else -> sb.append(s, i, semi + 1)   // 不认识的实体原样保留，别吞内容
            }
            i = semi + 1
        }
        return sb.toString()
    }

    /** 按「字」（code point）截断，别把 emoji 的代理对劈成半个，否则前端 JSON.parse 会挂。 */
    private fun truncate(s: String, max: Int): String {
        if (s.length <= max) return s
        if (s.codePointCount(0, s.length) <= max) return s
        return s.substring(0, s.offsetByCodePoints(0, max))
    }

    // ---------------- JSON ----------------

    /** 自己拼字符串数组：org.json 会给每个对象套一层开销，且会转义 '/'，两万条时差距明显。 */
    private fun appendJsonString(sb: StringBuilder, s: String) {
        sb.append('"')
        for (ch in s) {
            when (ch) {
                '"' -> sb.append("\\\"")
                '\\' -> sb.append("\\\\")
                '\n' -> sb.append("\\n")
                '\r' -> sb.append("\\r")
                '\t' -> sb.append("\\t")
                else -> if (ch.code < 0x20) {
                    sb.append("\\u")
                    val hex = Integer.toHexString(ch.code)
                    for (k in hex.length until 4) sb.append('0')
                    sb.append(hex)
                } else sb.append(ch)
            }
        }
        sb.append('"')
    }

    private fun cut(s: String, n: Int): String = if (s.length > n) s.substring(0, n) else s
}
