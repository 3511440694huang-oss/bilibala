package com.replayradio.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.security.MessageDigest
import java.util.concurrent.Executors
import kotlin.math.roundToLong

/**
 * 内嵌本地 HTTP 服务：只绑 127.0.0.1，基于裸 ServerSocket（Android 无 com.sun.net.httpserver）。
 * 无独立鉴权，仅靠回环保护——因此绝不绑 0.0.0.0。
 */
class LocalServer(private val ctx: Context) {
    private var serverSocket: ServerSocket? = null
    private var running = false
    @Volatile var port: Int = PORT
        private set
    private val pool = Executors.newCachedThreadPool()
    private val NOW_EPOCH = 1790265600L
    private val NOW_SEED = 20260925
    // 播放服务每 5 秒问一次 /api/now，页面也在问；缓存挂在多线程上，必须整体替换而不是逐字段改
    private data class ProgSnap(val station: String, val at: Long, val json: JSONObject)
    @Volatile private var progSnap: ProgSnap? = null
    private val progLock = Any()
    @Volatile private var progFailAt = 0L
    @Volatile private var progFailStation = ""

    companion object {
        const val PORT = 18765
        private const val WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
        private const val WS_MAX_FRAME = 32 * 1024   // 单帧上限，别调大（见 handleLiveWs 注释）
        val MEDIA_HOSTS = listOf("hdslb.com", "bilivideo.com", "bilivideo.cn", "bilibili.com",
            "akamaized.net", "szbdyd.com", "sinaimg.cn", "weibo.com")
    }

    fun start() {
        if (running) return
        Store.init(ctx)
        Danmaku.init(ctx)   // 弹幕磁盘缓存目录 filesDir/dm
        val ss = ServerSocket()
        ss.reuseAddress = true
        // 首选固定端口；若被旧的 DSH/Termux 后端占用则自动顺延，保证打开即用
        var bound = false
        for (candidate in listOf(PORT, 18766, 18767, 18768, 18769)) {
            try { ss.bind(InetSocketAddress("127.0.0.1", candidate), 64); port = candidate; bound = true; break }
            catch (_: java.io.IOException) { /* 试下一个 */ }
        }
        if (!bound) { ss.close(); throw java.io.IOException("没有可用的本地端口") }
        serverSocket = ss
        running = true
        pool.execute {
            while (running) {
                try { val c = ss.accept(); pool.execute { handle(c) } }
                catch (_: Exception) { if (!running) break }
            }
        }
    }

    fun stop() { running = false; try { serverSocket?.close() } catch (_: Exception) {} }

    private data class Req(val method: String, val path: String, val query: Map<String, String>,
                           val headers: Map<String, String>, val body: String)

    private fun readRequest(sock: Socket): Req? {
        val inStream = BufferedInputStream(sock.getInputStream())
        // 读请求行 + 头
        val header = StringBuilder()
        var b: Int
        while (inStream.read().also { b = it } != -1) {
            header.append(b.toChar())
            if (header.endsWith("\r\n\r\n")) break
            if (header.length > 64 * 1024) return null
        }
        val lines = header.toString().split("\r\n")
        if (lines.isEmpty()) return null
        val parts = lines[0].split(" ")
        if (parts.size < 2) return null
        val method = parts[0]
        val uri = parts[1]
        val qIdx = uri.indexOf('?')
        val path = if (qIdx < 0) uri else uri.substring(0, qIdx)
        val rawQ = if (qIdx < 0) "" else uri.substring(qIdx + 1)
        val headers = mutableMapOf<String, String>()
        for (i in 1 until lines.size) {
            val c = lines[i].indexOf(':')
            if (c > 0) headers[lines[i].substring(0, c).lowercase()] = lines[i].substring(c + 1).trim()
        }
        val len = headers["content-length"]?.toIntOrNull() ?: 0
        // 本地服务也不该让人一次塞进来几十兆（跨站 form 就能做到）
        if (len < 0 || len > 1_000_000) return null
        var body = ""
        if (len > 0) {
            val buf = ByteArray(len)
            var off = 0
            while (off < len) { val n = inStream.read(buf, off, len - off); if (n < 0) break; off += n }
            body = String(buf, 0, off, Charsets.UTF_8)
        }
        return Req(method, path, parseQuery(rawQ), headers, body)
    }

    private fun parseQuery(raw: String): Map<String, String> {
        if (raw.isEmpty()) return emptyMap()
        return raw.split("&").mapNotNull { p ->
            val i = p.indexOf('=')
            if (i < 0) null else URLDecoder.decode(p.substring(0, i), "UTF-8") to
                    URLDecoder.decode(p.substring(i + 1), "UTF-8")
        }.toMap()
    }

    /**
     * 只服务「自己这一页」。别的网站也能往 127.0.0.1 发简单请求（发弹幕、删主播都是写操作），
     * 浏览器读不到响应，但副作用已经发生了 —— 所以按浏览器给的 Origin / Sec-Fetch-Site 挡掉。
     */
    private fun crossSite(req: Req): Boolean {
        val origin = req.headers["origin"]
        if (origin != null && !origin.startsWith("http://127.0.0.1")) return true
        val site = req.headers["sec-fetch-site"]
        if (site != null && site != "same-origin" && site != "none") return true
        return false
    }

    private fun handle(sock: Socket) {
        var path = ""
        try {
            sock.soTimeout = 35_000
            val req = readRequest(sock) ?: return
            path = req.path
            if (crossSite(req)) { json(sock.getOutputStream(), """{"error":"跨站请求已拒绝"}""", 403); return }
            val out = sock.getOutputStream()
            // WebSocket 的响应不是普通 HTTP：握手后这条连接要一直推到客户端断开，
            // 必须单独走一条分支（否则会被下面 startsWith("/api/") 的 404 兜底拒掉）。
            if (req.path == "/api/live/ws") { handleLiveWs(sock, out, req); return }
            when {
                req.path == "/api/ping" -> json(out, """{"app":"replay-radio","version":"7.1.1","lyrics":false,"independent":true,"build":"apk-711","ban_left":0}""")
                req.path == "/api/status" -> apiStatus(out, req)
                req.path == "/api/login/qrcode" -> apiLoginQr(out)
                req.path == "/api/login/poll" -> apiLoginPoll(out, req)
                req.path == "/api/logout" -> apiLogout(out)
                req.path == "/api/live/playinfo" -> apiLivePlayInfo(out, req.query)
                req.path == "/api/live/stream" -> apiLiveStream(out, req)
                // 实时弹幕 SSE：自己写完整响应（含头）并一直推，直到观众关页面。
                // 必须在下面的 /api/ 404 兜底之前，否则永远走不到。
                req.path == "/api/live/chat/stream" -> apiLiveChatStream(sock, out, req.query)
                req.path == "/api/live/credential" -> apiLiveCredential(out, req)
                // ---- 7.0.0 新增 ----
                req.path == "/api/live/brief" -> apiLiveBrief(out, req.query)
                req.path == "/api/live/emoticons" -> apiLiveEmoticons(out, req.query)
                req.path == "/api/dynamic" -> apiDynamic(out, req.query)
                req.path == "/api/chapters" -> apiChapters(out, req.query)
                req.path == "/api/playlists" -> apiPlaylists(out)
                req.path == "/api/playlist" -> apiPlaylistOne(out, req.query)
                req.path == "/api/playlist/import" -> apiPlaylistImport(out, req)
                req.path == "/api/playlist/delete" -> apiPlaylistDelete(out, req)
                req.path == "/api/following/live" -> apiFollowingLive(out, req)
                req.path == "/api/stations/following" -> apiStationsFollowing(out, req)
                req.path == "/api/status-board" -> json(out, """{"at":0,"mid":"","live":{"living":false,"title":"","url":"","face":""},"source":""}""")
                req.path == "/api/page/alive" || req.path == "/api/page/bye" -> json(out, """{"ok":true}""")
                req.path == "/api/diag" -> {
                    val body = Diag.dump().toByteArray(Charsets.UTF_8)
                    out.write("HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\n".toByteArray())
                    out.write("Content-Length: ${body.size}\r\nConnection: close\r\n\r\n".toByteArray())
                    out.write(body); out.flush()
                }
                req.path == "/api/dashinfo" || req.path == "/api/dash" -> json(out, """{"error":"此版本使用 MP4 播放"}""", 502)
                req.path.startsWith("/api/stations") -> handleStations(out, req)
                req.path == "/api/programs" -> apiPrograms(out, req.query["station"] ?: "")
                req.path == "/api/now" -> jsonObj(out, apiNow())
                req.path == "/api/cycle" -> apiCycle(out, req.query)
                req.path == "/api/live/send" -> apiLiveSend(out, req)
                // 7.1：视频弹幕发送（x/v2/dm/post）。必须放在 /api/dm 这类前缀判断之前，
                // 否则会先被 /api/dm 的「取弹幕」分支截走。
                req.path == "/api/dm/send" -> apiDmSend(out, req)
                req.path == "/api/playurl" -> apiPlayUrl(out, req.query)
                req.path == "/api/dm" -> apiDm(out, req.query)
                req.path == "/api/stream" -> proxy(out, req, media = true)
                req.path == "/api/img" -> proxy(out, req, media = false)
                req.path.startsWith("/api/") -> json(out, """{"error":"此功能未内置"}""", 404)
                else -> serveAsset(out, req.path)
            }
        } catch (e: Exception) {
            // 只记路径与异常类型：这条兜底可能在处理登录/直播请求时触发，
            // 异常消息里偶尔会带完整 URL（含签名参数），不值得为了排障把它写进 diag。
            Diag.log("HTTP $path failed: ${e.javaClass.simpleName}")
        } finally { try { sock.close() } catch (_: Exception) {} }
    }

    private fun handleStations(out: OutputStream, req: Req) {
        when (req.path) {
            "/api/stations" -> {
                val arr = JSONArray()
                Store.stations().forEach { arr.put(stationHead(it)) }
                val mainId = Store.stations().firstOrNull { it.optBoolean("main") }?.optString("id") ?: ""
                json(out, JSONObject().put("ok", true).put("stations", arr).put("main", mainId).toString())
            }
            "/api/stations/probe" -> {
                val mid = try { JSONObject(req.body).optString("mid") } catch (_: Exception) { "" }
                try { json(out, JSONObject().put("ok", true).put("probe", BiliApi.probe(mid)).toString()) }
                catch (e: Exception) { json(out, JSONObject().put("error", e.message ?: "探测失败").toString(), 502) }
            }
            "/api/stations/save" -> {
                try {
                    val o = JSONObject(req.body)
                    val mid = o.optString("mid"); val srcId = o.optString("sourceId")
                    val p = BiliApi.probe(mid)
                    var srcName = ""
                    if (srcId.isNotEmpty()) {
                        val sources = p.optJSONArray("sources") ?: JSONArray()
                        for (i in 0 until sources.length()) {
                            val s = sources.optJSONObject(i) ?: continue
                            if (s.optString("id") == srcId) srcName = s.optString("name")
                        }
                    }
                    val source = if (srcId.isNotEmpty()) srcId else p.optString("suggested")
                    Store.addStation(mid, p.optString("name").ifEmpty { "主播 $mid" },
                        p.optString("room"), p.optString("face"), source, srcName)
                    progSnap = null
                    val arr = JSONArray(); Store.stations().forEach { arr.put(it) }
                    json(out, JSONObject().put("ok", true).put("stations", arr).toString())
                } catch (e: Exception) { json(out, JSONObject().put("error", e.message ?: "保存失败").toString(), 502) }
            }
            "/api/stations/delete" -> {
                try {
                    val id = JSONObject(req.body).optString("id")
                    Store.deleteStation(id)
                    progSnap = null
                    val arr = JSONArray(); Store.stations().forEach { arr.put(it) }
                    json(out, JSONObject().put("ok", true).put("stations", arr).toString())
                } catch (e: Exception) { json(out, JSONObject().put("error", e.message ?: "删除失败").toString(), 502) }
            }
            else -> json(out, """{"error":"not found"}""", 404)
        }
    }

    /** 对齐 Python station_head() 的字段，让完整网页版的主播卡/主题色正常渲染。 */
    private fun stationHead(st: JSONObject): JSONObject {
        val id = st.optString("id")
        val hasPrograms = try { Store.readPrograms(id)?.optJSONArray("programs")?.length() ?: 0 > 0 } catch (_: Exception) { false }
        return JSONObject().apply {
            put("id", id)
            put("name", st.optString("name"))
            put("short", st.optString("short").ifEmpty { st.optString("name") })
            put("mid", st.optString("mid"))
            put("room", st.optString("room"))
            put("face", proxyImgUrl(st.optString("face")))
            put("main", st.optBoolean("main"))
            // 字段契约：监控快捷添加 / 主播滑动切换都读 live。这里只透出本地缓存的标志，
            // 真开播状态由 /api/live/playinfo 的 living 决定 —— stations 每次挨个去问 B 站
            // （10 个主播就是 10 个请求）必然触发风控，不能这么干。
            put("live", st.optBoolean("live"))
            put("has_programs", hasPrograms)
            put("tag", "")
            put("site", "bilibili")
            put("accent", st.optString("accent").ifEmpty { "#ff3b4e" })
            put("weibo", "")
            put("series", JSONObject().put("id", st.optString("series_id"))
                .put("source", st.optString("series_kind"))
                .put("name", st.optString("series_name"))
                .put("total", 0).put("error", ""))
        }
    }

    private fun proxyImgUrl(u: String): String {
        if (u.isEmpty()) return ""
        val raw = android.util.Base64.encodeToString(u.toByteArray(Charsets.UTF_8),
            android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP)
        return "http://127.0.0.1:$port/api/img?u=$raw"
    }

    /** 供完整网页版使用：回放清单 + meta。结构与 Python serve.py 的 /api/programs 对齐。 */
    private fun apiPrograms(out: OutputStream, stationId: String) {
        try {
            var st = if (stationId.isEmpty()) Store.currentStation() else Store.findStation(stationId)
            if (st == null) st = Store.currentStation()
            if (st == null) {
                json(out, JSONObject().put("programs", JSONArray())
                    .put("meta", JSONObject().put("count", 0).put("generated_at", 0)).toString())
                return
            }
            val sid = st.optString("id")
            val programs = getProgramsFor(sid, st)
            val meta = JSONObject()
                .put("mid", st.optString("mid"))
                .put("up_name", st.optString("name"))
                .put("station", st)
                .put("count", programs.length())
                .put("part_count", programs.length())
                .put("generated_at", System.currentTimeMillis() / 1000L)
                .put("live", false)
                .put("series", JSONObject().put("series_id", st.optString("series_id"))
                    .put("name", st.optString("series_name")))
            json(out, JSONObject().put("programs", programs).put("meta", meta).toString())
        } catch (e: Exception) {
            json(out, JSONObject().put("error", e.message ?: "取回放清单失败").toString(), 502)
        }
    }

    private fun getProgramsFor(sid: String, st: JSONObject): JSONArray {
        val fresh = 15 * 60 * 1000L
        progSnap?.let { snap ->
            if (snap.station == sid && System.currentTimeMillis() - snap.at < fresh) {
                return snap.json.optJSONArray("programs") ?: JSONArray()
            }
        }
        // 单飞：清单没缓存时只让一个线程去打 B 站，其余排队等结果，
        // 否则十几个线程同时拉（每页还 sleep 350ms）必然 412 风控 + 页面像卡死。
        synchronized(progLock) {
            progSnap?.let { snap ->
                if (snap.station == sid && System.currentTimeMillis() - snap.at < fresh) {
                    return snap.json.optJSONArray("programs") ?: JSONArray()
                }
            }
            Store.readPrograms(sid)?.let { disk ->
                val arr = disk.optJSONArray("programs")
                if (arr != null && arr.length() > 0) {
                    progSnap = ProgSnap(sid, disk.optLong("generated_at", 0), disk)
                    return arr
                }
            }
            val now = System.currentTimeMillis()
            if (progFailStation == sid && now - progFailAt < 30_000) {
                throw RuntimeException("刚取清单失败，等几秒再试")
            }
            try {
                var sourceSid = st.optString("series_id")
                var kind = st.optString("series_kind")
                if (sourceSid.isEmpty()) {
                    val p = BiliApi.probe(st.optString("mid"))
                    sourceSid = p.optString("suggested")
                    val sources = p.optJSONArray("sources") ?: JSONArray()
                    for (i in 0 until sources.length()) {
                        val s = sources.optJSONObject(i) ?: continue
                        if (s.optString("id") == sourceSid) kind = s.optString("kind")
                    }
                    if (sourceSid.isEmpty()) throw RuntimeException("还没定位到回放来源，请在主播设置里选一个合集")
                }
                val programs = BiliApi.buildPrograms(st.optString("mid"), sourceSid, kind)
                val doc = JSONObject().put("programs", programs).put("generated_at", System.currentTimeMillis())
                Store.writePrograms(sid, doc)
                progSnap = ProgSnap(sid, System.currentTimeMillis(), doc)
                progFailStation = ""
                return programs
            } catch (e: Exception) {
                // 负缓存：30 秒内别重复撞 B 站
                progFailStation = sid
                progFailAt = System.currentTimeMillis()
                throw e
            }
        }
    }

    private fun getPrograms(): JSONArray {
        val st = Store.currentStation() ?: throw RuntimeException("no_station")
        return getProgramsFor(st.optString("id"), st)
    }

    private fun mimeFor(path: String): String = when {
        path.endsWith(".html") -> "text/html; charset=utf-8"
        path.endsWith(".js") -> "application/javascript; charset=utf-8"
        path.endsWith(".css") -> "text/css; charset=utf-8"
        path.endsWith(".json") -> "application/json; charset=utf-8"
        path.endsWith(".png") -> "image/png"
        path.endsWith(".ico") -> "image/x-icon"
        path.endsWith(".webp") -> "image/webp"
        path.endsWith(".svg") -> "image/svg+xml"
        path.endsWith(".woff2") -> "font/woff2"
        path.endsWith(".woff") -> "font/woff"
        path.endsWith(".ttf") -> "font/ttf"
        path.endsWith(".otf") -> "font/otf"
        else -> "application/octet-stream"
    }

    /**
     * 静态资源的缓存策略。为什么按扩展名分：
     *  · index.html / sw.js 是「入口」：升级 APK 后必须立刻拿到新版本，否则 WebView 里
     *    还是旧页面（这正是「前端一直没变」的根因之一）→ 完全禁用缓存；
     *  · app.js / app.css 带 ?v= 版本号，允许浏览器缓存但必须每次回源校验（no-cache），
     *    这样版本号没变时省流量，变了立刻生效；
     *  · 图片/字体是内容资源，一天内不会变 → max-age，减少重复请求。
     */
    private fun cacheFor(path: String): String {
        val p = path.lowercase()
        return when {
            p.endsWith(".html") || p.endsWith("/sw.js") -> "no-store, no-cache, must-revalidate"
            p.endsWith(".css") || p.endsWith(".js") -> "no-cache"
            p.endsWith(".png") || p.endsWith(".jpg") || p.endsWith(".jpeg") ||
                p.endsWith(".gif") || p.endsWith(".webp") || p.endsWith(".ico") ||
                p.endsWith(".svg") || p.endsWith(".woff") || p.endsWith(".woff2") ||
                p.endsWith(".ttf") || p.endsWith(".otf") -> "max-age=86400"
            else -> "no-cache"
        }
    }

    /**
     * 从 assets/web/ 提供完整网页版的静态资源；拒绝路径穿越。
     * 路径先去掉查询串（?v=301 这类版本号只用于浏览器缓存键，不能当成文件名）。
     */
    private fun serveAsset(out: OutputStream, rawPath: String) {
        var path = rawPath.substringBefore('?')
        if (path == "/" || path.isEmpty()) path = "/index.html"
        path = path.replace("..", "")
        try {
            val bytes = ctx.assets.open("web$path").use { it.readBytes() }
            val hb = "HTTP/1.1 200 OK\r\nContent-Type: ${mimeFor(path)}\r\n" +
                "Content-Length: ${bytes.size}\r\nConnection: close\r\n" +
                "Cache-Control: ${cacheFor(path)}\r\n\r\n"
            out.write(hb.toByteArray(Charsets.US_ASCII))
            out.write(bytes)
        } catch (_: Exception) {
            val msg = "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain; charset=utf-8\r\n" +
                "Content-Length: 0\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n"
            out.write(msg.toByteArray(Charsets.US_ASCII))
        }
        out.flush()
    }

    private fun nowCycleKey(bvid: String): Long {
        val s = "$NOW_SEED|$bvid"; var h = 2166136261L
        for (ch in s) { h = h xor ch.code.toLong(); h = (h * 16777619L) and 0xFFFFFFFFL }
        return h
    }

    private fun buildCycle(programs: JSONArray): Pair<List<JSONObject>, Double> {
        val arr = mutableListOf<JSONObject>()
        for (i in 0 until programs.length()) programs.optJSONObject(i)?.let { arr.add(it) }
        arr.sortBy { nowCycleKey(it.optString("bvid")) }
        for (i in 1 until arr.size) {
            val prev = arr[i - 1].optString("category")
            if (arr[i].optString("category") == prev) {
                for (j in i + 1 until arr.size) if (arr[j].optString("category") != prev) {
                    val t = arr[i]; arr[i] = arr[j]; arr[j] = t; break
                }
            }
        }
        val segments = mutableListOf<JSONObject>()
        var acc = 0.0
        for (p in arr) {
            val parts = p.optJSONArray("parts") ?: continue
            for (i in 0 until parts.length()) {
                val part = parts.optJSONObject(i) ?: continue
                val dur = part.optDouble("duration", 0.0)
                if (dur <= 0) continue
                segments.add(JSONObject().put("bvid", p.optString("bvid"))
                    .put("page", part.optInt("page")).put("cid", part.optString("cid"))
                    .put("duration", dur).put("start", acc)
                    .put("title", part.optString("part").ifEmpty { p.optString("title") })
                    .put("cover", p.optString("cover")))
                acc += dur
            }
        }
        return segments to acc
    }

    private fun apiNow(): JSONObject {
        val st = Store.currentStation()
        if (st == null) return JSONObject().put("empty", true).put("reason", "no_station")
        return try {
            val (segments, total) = buildCycle(getProgramsFor(st.optString("id"), st))
            if (segments.isEmpty() || total <= 0) return JSONObject().put("empty", true).put("segments", 0)
            var pos = ((System.currentTimeMillis() / 1000L - NOW_EPOCH) % total.roundToLong()).toDouble()
            if (pos < 0) pos += total
            var idx = 0
            for (i in segments.indices) {
                val s = segments[i]
                if (pos < s.optDouble("start") + s.optDouble("duration")) { idx = i; break }
            }
            val cur = segments[idx]; val nxt = segments[(idx + 1) % segments.size]
            val within = (pos - cur.optDouble("start")).coerceAtLeast(0.0)
            JSONObject().put("empty", false).put("total", total).put("position", pos)
                .put("index", idx).put("count", segments.size).put("current", cur)
                .put("offset", within).put("remaining", (cur.optDouble("duration") - within).coerceAtLeast(0.0))
                .put("next", JSONObject().put("title", nxt.optString("title")))
                .put("playurl", "/api/playurl?bvid=${cur.optString("bvid")}&cid=${cur.optString("cid")}&qn=80")
        } catch (e: Exception) {
            if (e.message == "no_station") JSONObject().put("empty", true).put("reason", "no_station")
            else JSONObject().put("error", e.message ?: "排期失败")
        }
    }

    /** 24 小时页用的整条循环：当前指针 + 全部段（前端自己摊到当天时间轴上）。 */
    private fun apiCycle(out: OutputStream, q: Map<String, String> = emptyMap()) {
        try {
            // 允许 ?station=<id> 指定主播：24H 时间带要跟着顶栏切台走，不能永远用主主播
            val want = (q["station"] ?: "").trim()
            val st = if (want.isNotEmpty()) {
                Store.stations().firstOrNull { it.optString("id") == want } ?: Store.currentStation()
            } else Store.currentStation()
            if (st == null) {
                json(out, JSONObject().put("total", 0.0).put("position", 0.0)
                    .put("count", 0).put("segments", JSONArray()).toString())
                return
            }
            val (segments, total) = buildCycle(getProgramsFor(st.optString("id"), st))
            if (segments.isEmpty() || total <= 0) {
                json(out, JSONObject().put("total", 0.0).put("position", 0.0)
                    .put("count", 0).put("segments", JSONArray()).toString())
                return
            }
            var pos = ((System.currentTimeMillis() / 1000L - NOW_EPOCH) % total.roundToLong()).toDouble()
            if (pos < 0) pos += total
            val arr = JSONArray()
            for (seg in segments) {
                arr.put(JSONObject()
                    .put("bvid", seg.optString("bvid"))
                    .put("cid", seg.optString("cid"))
                    .put("title", seg.optString("title"))
                    .put("start", seg.optDouble("start"))
                    .put("duration", seg.optDouble("duration"))
                    .put("cover", seg.optString("cover")))
            }
            jsonObj(out, JSONObject().put("total", total).put("position", pos)
                .put("count", arr.length()).put("epoch", NOW_EPOCH).put("segments", arr)
                .put("station", st.optString("id")))
        } catch (e: Exception) {
            json(out, JSONObject().put("error", e.message ?: "排期取不到").toString(), 502)
        }
    }

    /** 发直播间弹幕：房间号取当前主播（也允许用 ?station= 指定）。 */
    private fun apiLiveSend(out: OutputStream, req: Req) {
        try {
            val text = try { JSONObject(req.body).optString("text").trim() } catch (_: Exception) { "" }
            if (text.isEmpty()) { json(out, """{"error":"弹幕不能为空"}""", 400); return }
            if (text.length > 20) { json(out, """{"error":"弹幕最多 20 个字"}""", 400); return }
            if (!BiliApi.hasSess()) { json(out, """{"error":"先扫码登录 B 站账号"}""", 401); return }
            val st = resolveStation(req.query["station"] ?: "")
                ?: throw RuntimeException("还没有添加主播")
            val room = st.optString("room")
            if (!room.matches(Regex("\\d+"))) throw RuntimeException("这位主播还没绑定直播间")
            json(out, BiliApi.sendDanmaku(room, text).toString())
        } catch (e: Exception) {
            json(out, JSONObject().put("error", e.message ?: "发送失败").toString(), 502)
        }
    }

    private fun apiPlayUrl(out: OutputStream, q: Map<String, String>) {
        val bvid = q["bvid"] ?: ""; val cid = q["cid"] ?: ""
        // 默认 1080P（qn=80）：带登录 Cookie 才真给得到，没登录 B 站会自动降到 720P
        // 并在 accept 里如实体现，不是错误。qn 缺省/传 0 都按 80 走（回放没有服务端「自动档」）。
        val qn = (q["qn"]?.toIntOrNull() ?: 80).let { if (it > 0) it else 80 }
        if (bvid.isEmpty() || cid.isEmpty()) { json(out, """{"error":"缺少 bvid/cid"}""", 400); return }
        try { json(out, playUrlCached(bvid, cid, qn).toString()) }
        catch (e: Exception) { json(out, JSONObject().put("error", e.message ?: "取播放地址失败").toString(), 502) }
    }

    /**
     * 回放弹幕：GET /api/dm?cid=<cid>&seg=<0 起>
     *
     * 重活（拉取/解压/解析/两级缓存）都在 Danmaku 里；这里只做参数校验和错误兜底，
     * 保证异常不会冒到 handle() 打一条没头没尾的日志。
     */

    // ================= 播放地址缓存 / 预热 =================

    /** bvid|cid|qn|登录态 → (取到的时刻, 返回体)。地址两小时内有效，这里只留 10 分钟，够连着听。 */
    private val playCache = java.util.concurrent.ConcurrentHashMap<String, Pair<Long, JSONObject>>()
    private val WARM_UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

    private fun playUrlCached(bvid: String, cid: String, qn: Int): JSONObject {
        // 登录态也要进 key：登录/退出后同一期的可用档位完全不同（720P ↔ 1080P），
        // 复用旧结果会让扫码登录后依旧只显示 720P，最多拖 10 分钟。
        val key = "$bvid|$cid|$qn|${if (BiliApi.hasSess()) 1 else 0}"
        val hit = playCache[key]
        if (hit != null && System.currentTimeMillis() - hit.first < 10 * 60_000L) return hit.second
        val j = BiliApi.playUrl(bvid, cid, qn)
        if (playCache.size > 200) playCache.clear()
        playCache[key] = System.currentTimeMillis() to j
        warmMedia(j.optString("media"))
        return j
    }

    /**
     * 取完地址顺手把这条路走一遍：DNS、TLS、CDN 跳转、首包。
     * 只读 2 个字节（Range: bytes=0-1），就算上游忽略 Range 也不会把整片拉下来。
     * 点播放时省下的就是这几百毫秒。
     */
    private fun warmMedia(url: String) {
        if (url.isEmpty()) return
        Thread {
            var c: java.net.HttpURLConnection? = null
            try {
                c = java.net.URL(url).openConnection() as java.net.HttpURLConnection
                c.connectTimeout = 6000
                c.readTimeout = 6000
                c.setRequestProperty("Range", "bytes=0-1")
                c.setRequestProperty("User-Agent", WARM_UA)
                c.setRequestProperty("Referer", "https://www.bilibili.com")
                c.inputStream.use { it.read(ByteArray(2)) }
                Diag.log("warm ok ${url.take(48)}")
            } catch (e: Exception) {
                Diag.log("warm failed: ${e.javaClass.simpleName}")
            } finally {
                try { c?.disconnect() } catch (_: Exception) {}
            }
        }.apply { isDaemon = true }.start()
    }

    private fun apiDm(out: OutputStream, q: Map<String, String>) {
        val cid = (q["cid"] ?: "").trim()
        if (cid.isEmpty()) { json(out, """{"error":"缺少 cid"}""", 400); return }
        // cid 会直接拼进上游 URL：只允许纯数字，顺手挡掉参数注入
        if (!cid.matches(Regex("\\d{1,20}"))) {
            json(out, """{"error":"cid 必须是纯数字"}""", 400); return
        }
        val seg = (q["seg"] ?: "").trim().toIntOrNull()?.coerceAtLeast(0) ?: 0
        try {
            json(out, Danmaku.buildJson(cid, seg))
        } catch (e: Exception) {
            Diag.log("dm failed cid=$cid: ${human(e)}")
            json(out, JSONObject().put("error", "取弹幕失败：${human(e)}").toString(), 502)
        }
    }

    /**
     * POST /api/dm/send {bvid,cid,text,progress,mode} —— 发一条视频弹幕（x/v2/dm/post）。
     *
     * progress 是毫秒；mode 1 滚动 / 4 底部 / 5 顶部。
     * 未登录在本地就挡掉（401 + 人话），页面据此弹扫码登录，不用去猜 B 站的 code=-101。
     */
    private fun apiDmSend(out: OutputStream, req: Req) {
        if (req.method != "POST") {
            json(out, """{"error":"请用 POST 发送弹幕"}""", 405)
            return
        }
        if (!BiliApi.hasSess()) {
            json(out, """{"error":"需要先登录"}""", 401)
            return
        }
        val o = try { JSONObject(req.body) } catch (_: Exception) { JSONObject() }
        val bvid = o.optString("bvid").trim()
        val cid = o.optString("cid").trim()
        // 页面历史上两种字段名都出现过，两个都认
        val text = o.optString("text").ifEmpty { o.optString("msg") }.trim()
        val progress = o.optLong("progress", 0L)                     // 毫秒
        val mode = o.optInt("mode", 1)
        val durHint = o.optLong("duration", o.optLong("durationMs", 0L))
        if (bvid.isEmpty()) { json(out, """{"error":"缺少 bvid"}""", 400); return }
        if (text.isEmpty()) { json(out, """{"error":"弹幕不能为空"}""", 400); return }
        if (text.codePointCount(0, text.length) > 100) {
            json(out, """{"error":"弹幕最多 100 个字"}""", 400); return
        }
        if (progress < 0) { json(out, """{"error":"弹幕时间点不能小于 0"}""", 400); return }
        try {
            // 进度上限（0..视频时长）与 cid 归属在 BiliApi 里按 view 接口的时长收口
            json(out, BiliApi.sendVideoDanmaku(bvid, cid, text, progress, mode, durHint).toString())
        } catch (e: Exception) {
            val m = human(e)
            Diag.log("dm send failed: ${m.take(80)}")
            val code = if (m.contains("登录") || m.contains("csrf")) 401 else 502
            json(out, JSONObject().put("error", m).toString(), code)
        }
    }

    private fun safeTarget(raw: String): String? {
        if (raw.isEmpty()) return null
        val decoded = try {
            val pad = "=".repeat((4 - raw.length % 4) % 4)
            String(android.util.Base64.decode(raw + pad, android.util.Base64.URL_SAFE), Charsets.UTF_8)
        } catch (_: Exception) { return null }
        val u = try { java.net.URI(decoded) } catch (_: Exception) { return null }
        if (u.scheme != "https") return null
        val host = (u.host ?: "").lowercase()
        if (MEDIA_HOSTS.none { host == it || host.endsWith(".$it") }) return null
        return decoded
    }

    private fun proxy(out: OutputStream, req: Req, media: Boolean) {
        val target = safeTarget(req.query["u"] ?: "")
        if (target == null) { json(out, """{"error":"非法地址"}""", 400); return }
        val conn = java.net.URL(target).openConnection() as java.net.HttpURLConnection
        conn.requestMethod = "GET"; conn.connectTimeout = 12000; conn.readTimeout = 30000
        conn.setRequestProperty("User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
        conn.setRequestProperty("Referer", "https://www.bilibili.com")
        conn.setRequestProperty("Accept", if (media) "*/*" else "image/*,*/*")
        if (media) req.headers["range"]?.let { conn.setRequestProperty("Range", it) }
        try {
            val code = conn.responseCode
            var ctype = conn.contentType ?: if (media) "video/mp4" else "image/jpeg"
            if (!media && !ctype.startsWith("image/")) ctype = "image/jpeg"
            val len = conn.getHeaderField("Content-Length")
            val cr = conn.getHeaderField("Content-Range")
            val ar = conn.getHeaderField("Accept-Ranges")
            val hb = StringBuilder()
            hb.append("HTTP/1.1 $code ${if (code == 200 || code == 206) "OK" else "Error"}\r\n")
            hb.append("Content-Type: $ctype\r\n")
            hb.append("Connection: close\r\n")
            if (len != null) hb.append("Content-Length: $len\r\n")
            if (cr != null) hb.append("Content-Range: $cr\r\n")
            if (ar != null) hb.append("Accept-Ranges: $ar\r\n")
            // 封面图变不了，让 WebView 自己缓存，别每次进页重拉几十张
            if (!media) hb.append("Cache-Control: public, max-age=86400\r\n")
            hb.append("\r\n")
            out.write(hb.toString().toByteArray(Charsets.US_ASCII))
            conn.inputStream.use { input ->
                val buf = ByteArray(64 * 1024)
                while (true) { val n = input.read(buf); if (n < 0) break; out.write(buf, 0, n) }
            }
        } catch (e: Exception) {
            try { out.write("HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray(Charsets.US_ASCII)) } catch (_: Exception) {}
        } finally { conn.disconnect() }
    }

    // ================= 登录 / 登录态 =================

    private fun apiStatus(out: OutputStream, req: Req) {
        try {
            jsonObj(out, BiliApi.status(req.query["refresh"] == "1"))
        } catch (e: Exception) {
            Diag.log("status failed: ${human(e)}")
            json(out, JSONObject().put("error", "登录状态获取失败：${human(e)}")
                .put("logged", false).put("jct", false).toString(), 502)
        }
    }

    private fun apiLoginQr(out: OutputStream) {
        try {
            // 前端只读 {url, key}；失败时需要 {error: 人话}
            jsonObj(out, BiliApi.loginQrCode())
        } catch (e: Exception) {
            Diag.log("login qrcode failed: ${human(e)}")
            json(out, JSONObject().put("error", "申请二维码失败：${human(e)}").toString(), 502)
        }
    }

    private fun apiLoginPoll(out: OutputStream, req: Req) {
        try {
            val key = req.query["key"] ?: ""
            if (key.isEmpty()) { json(out, """{"error":"缺少 key"}""", 400); return }
            jsonObj(out, BiliApi.loginPoll(key))
        } catch (e: Exception) {
            Diag.log("login poll failed: ${human(e)}")
            json(out, JSONObject().put("error", "轮询失败：${human(e)}").toString(), 502)
        }
    }

    private fun apiLogout(out: OutputStream) {
        try {
            BiliApi.logout()
            json(out, """{"logged":false}""")
        } catch (e: Exception) {
            Diag.log("logout failed: ${human(e)}")
            json(out, JSONObject().put("error", "退出登录失败：${human(e)}").toString(), 500)
        }
    }

    /** 前端「手工粘贴 bili_jct」的入口（扫码拿不到 jct 时的兜底）；只存不显示。 */
    private fun apiLiveCredential(out: OutputStream, req: Req) {
        try {
            val v = try { JSONObject(req.body).optString("jct").trim() } catch (_: Exception) { "" }
            if (v.isEmpty()) { json(out, """{"error":"bili_jct 不能为空"}""", 400); return }
            Store.saveCred("bili_jct", v)
            BiliApi.onCredentialChanged()
            json(out, """{"ok":true,"danmaku_ready":true}""")
        } catch (e: Exception) {
            json(out, JSONObject().put("error", "保存失败：${human(e)}").toString(), 400)
        }
    }

    // ================= 7.0.0 新接口 =================
    //
    // 全部跑在 LocalServer 的工作线程里（不是主线程，也不是 250ms 采样线程），
    // 每个入口都自带 try/catch：失败一律回 {"error":"人话"}，不把异常漏到连接上。

    /** GET /api/live/brief?room= —— 顶栏轻量开播状态（30s 缓存在 BiliApi 里）。 */
    private fun apiLiveBrief(out: OutputStream, q: Map<String, String>) {
        val room = (q["room"] ?: "").trim().ifEmpty { stationRoom(q["station"]) }
        if (!room.matches(Regex("\\d+"))) {
            json(out, """{"error":"没有可用的直播间号"}""", 400)
            return
        }
        try {
            val res = BiliApi.liveBrief(room)
            // 既没缓存也没拿到状态：用 502 让前端走失败分支（否则会被当成「主播没开播」）
            json(out, res.toString(), if (res.has("error") && !res.optBoolean("stale")) 502 else 200)
        } catch (e: Exception) {
            Diag.log("live brief failed: ${human(e)}")
            json(out, JSONObject().put("error", "取直播简报失败：${cut(human(e), 100)}").toString(), 502)
        }
    }

    /** GET /api/live/emoticons?room= —— 三类表情包；取不到也只回空 packs + error。 */
    private fun apiLiveEmoticons(out: OutputStream, q: Map<String, String>) {
        val room = (q["room"] ?: "").trim().ifEmpty { stationRoom(q["station"]) }
        if (!room.matches(Regex("\\d+"))) {
            json(out, """{"error":"没有可用的直播间号"}""", 400)
            return
        }
        try {
            // 表情包是增强功能：未登录/风控时给 200 + 空 packs + error，面板不整块报错。
            // （前端目前只认 packs，人话 error 留给后续版本展示，不阻塞打字。）
            jsonObj(out, BiliApi.liveEmoticons(room, q["refresh"] == "1"))
        } catch (e: Exception) {
            Diag.log("live emoticons failed: ${human(e)}")
            json(out, JSONObject().put("packs", JSONArray())
                .put("error", "取表情包失败：${cut(human(e), 100)}").toString(), 502)
        }
    }

    /** GET /api/dynamic?mid=&page= —— 空间动态（video / dynamic / live 三类）。 */
    private fun apiDynamic(out: OutputStream, q: Map<String, String>) {
        val mid = (q["mid"] ?: "").trim().ifEmpty { Store.currentStation()?.optString("mid") ?: "" }
        if (!mid.matches(Regex("\\d+"))) {
            json(out, """{"error":"缺少主播 UID"}""", 400)
            return
        }
        val page = (q["page"] ?: "1").toIntOrNull()?.coerceAtLeast(1) ?: 1
        try {
            val res = BiliApi.dynamicFeed(mid, page, q["refresh"] == "1")
            val bad = (res.optJSONArray("items")?.length() ?: 0) == 0 && res.has("error")
            json(out, res.toString(), if (bad) 502 else 200)
        } catch (e: Exception) {
            Diag.log("dynamic failed: ${human(e)}")
            json(out, JSONObject().put("items", JSONArray())
                .put("error", "取空间动态失败：${cut(human(e), 100)}").toString(), 502)
        }
    }

    /** GET /api/chapters?bvid=&cid= —— 视频章节；取不到回空数组，不报错。 */
    private fun apiChapters(out: OutputStream, q: Map<String, String>) {
        val bvid = (q["bvid"] ?: "").trim()
        val cid = (q["cid"] ?: "").trim()
        if (!bvid.matches(Regex("BV[0-9A-Za-z]{10}"))) {
            json(out, """{"error":"缺少 bvid"}""", 400)
            return
        }
        try {
            jsonObj(out, BiliApi.chapters(bvid, cid))
        } catch (e: Exception) {
            // 章节属于增强信息：异常也不该让播放页挂掉
            Diag.log("chapters failed: ${human(e)}")
            jsonObj(out, JSONObject().put("points", JSONArray())
                .put("error", "取章节失败：${cut(human(e), 100)}"))
        }
    }

    /** GET /api/playlists */
    private fun apiPlaylists(out: OutputStream) {
        try {
            jsonObj(out, Playlist.list())
        } catch (e: Exception) {
            Diag.log("playlists failed: ${human(e)}")
            json(out, JSONObject().put("lists", JSONArray())
                .put("error", "读取歌单失败：${cut(human(e), 100)}").toString(), 502)
        }
    }

    /** GET /api/playlist?id= */
    private fun apiPlaylistOne(out: OutputStream, q: Map<String, String>) {
        val id = (q["id"] ?: "").trim()
        if (id.isEmpty()) {
            json(out, """{"error":"缺少歌单 id"}""", 400)
            return
        }
        try {
            val pl = Playlist.get(id)
            if (pl == null) json(out, """{"error":"没有这张歌单"}""", 404) else jsonObj(out, pl)
        } catch (e: Exception) {
            Diag.log("playlist get failed: ${human(e)}")
            json(out, JSONObject().put("error", "读取歌单失败：${cut(human(e), 100)}").toString(), 502)
        }
    }

    /** POST /api/playlist/import {url} */
    private fun apiPlaylistImport(out: OutputStream, req: Req) {
        if (req.method != "POST") {
            json(out, """{"error":"请用 POST 导入歌单"}""", 405)
            return
        }
        val url = try { JSONObject(req.body).optString("url").trim() } catch (_: Exception) { "" }
        if (url.isEmpty()) {
            json(out, """{"error":"请先粘贴 B 站链接"}""", 400)
            return
        }
        try {
            jsonObj(out, Playlist.importUrl(url))
        } catch (e: Exception) {
            Diag.log("playlist import failed: ${human(e)}")
            json(out, JSONObject().put("error", cut(human(e), 160)).toString(), 502)
        }
    }

    /** POST /api/playlist/delete {id} */
    private fun apiPlaylistDelete(out: OutputStream, req: Req) {
        if (req.method != "POST") {
            json(out, """{"error":"请用 POST 删除歌单"}""", 405)
            return
        }
        val id = try { JSONObject(req.body).optString("id").trim() } catch (_: Exception) { "" }
        if (id.isEmpty()) {
            json(out, """{"error":"缺少歌单 id"}""", 400)
            return
        }
        try {
            if (Playlist.delete(id)) json(out, """{"ok":true}""")
            else json(out, """{"error":"没有这张歌单"}""", 404)
        } catch (e: Exception) {
            Diag.log("playlist delete failed: ${human(e)}")
            json(out, JSONObject().put("error", "删除歌单失败：${cut(human(e), 100)}").toString(), 502)
        }
    }

    // ================= 直播取流 =================

    /**
     * ?room= / ?mid= / ?station= 三种入参。
     * 状态与「取不取得到流」是两件事：living 只由状态接口决定，取流失败只写 error。
     */
    private fun apiLivePlayInfo(out: OutputStream, q: Map<String, String>) {
        try {
            val room = (q["room"] ?: "").trim()
            val mid = (q["mid"] ?: "").trim()
            val stKey = (q["station"] ?: "").trim()
            val st = resolveStation(stKey)
            val info = when {
                room.matches(Regex("\\d+")) ->
                    BiliApi.playInfoByRoom(room, if (stKey.isNotEmpty()) st else null)
                mid.matches(Regex("\\d+")) -> {
                    val r = BiliApi.playInfoByMid(mid)
                    if (st != null && st.optString("mid") == mid) {
                        r.put("uname", st.optString("name"))
                        r.put("face", st.optString("face"))
                    }
                    r
                }
                st == null -> JSONObject()
                    .put("error", "还没有添加主播").put("living", false)
                    .put("hls", false).put("qualities", JSONArray())
                else -> {
                    val r = st.optString("room")
                    if (r.isEmpty()) {
                        JSONObject().put("room_id", "").put("mid", st.optString("mid"))
                            .put("living", false).put("title", "").put("online", 0L)
                            .put("uname", st.optString("name")).put("face", st.optString("face"))
                            .put("cover", "").put("area", "").put("start", 0L).put("url", "")
                            .put("qualities", JSONArray())
                            .put("current_qn", BiliApi.LIVE_QN_DEFAULT).put("hls", false)
                            .put("error", "这位主播还没绑定直播间")
                    } else BiliApi.playInfoByRoom(r, st)
                }
            }
            jsonObj(out, info)
        } catch (e: Exception) {
            Diag.log("live playinfo failed: ${human(e)}")
            json(out, JSONObject().put("error", "取直播信息失败：${human(e)}").toString(), 502)
        }
    }

    /**
     * HTTP 长连接转发 FLV（直播间单路播放走这里，前端 mpegts.js 直接消费）。
     *
     * ⚠️ 不能写 Content-Length：直播是无穷流；HTTP/1.1 下没有长度就由「连接关闭」定界，
     *    浏览器/mpegts 对此的支持是稳的（Python 原版同样如此）。
     *    观众关页面时 out.write 抛异常 → 结束循环 → 关闭上游连接。
     */
    private fun apiLiveStream(out: OutputStream, req: Req) {
        val room = (req.query["room"] ?: "").trim().ifEmpty { stationRoom(req.query["station"]) }
        if (!room.matches(Regex("\\d+"))) {
            json(out, JSONObject().put("error", "没有可用的直播间号").toString(), 400)
            return
        }
        val qn = (req.query["qn"]?.toIntOrNull() ?: 0).let { if (it > 0) it else BiliApi.LIVE_QN_DEFAULT }
        val up = try {
            BiliApi.openLiveFlv(room, qn)
        } catch (e: Exception) {
            Diag.log("live stream open failed room=$room: ${human(e)}")
            json(out, JSONObject().put("error", "取直播流失败：${human(e)}").toString(), 502)
            return
        }
        val started = System.currentTimeMillis()
        var bytes = 0L
        try {
            val head = "HTTP/1.1 200 OK\r\nContent-Type: video/x-flv\r\n" +
                    "Cache-Control: no-store\r\nConnection: close\r\nX-Accel-Buffering: no\r\n\r\n"
            out.write(head.toByteArray(Charsets.US_ASCII)); out.flush()
            val tl = FlvTimeline("room $room/http")
            val buf = ByteArray(32 * 1024)
            while (true) {
                val n = up.input.read(buf)
                if (n < 0) break
                bytes += n
                val data = tl.feed(buf, 0, n)
                if (data.isNotEmpty()) { out.write(data); out.flush() }
            }
        } catch (e: Exception) {
            // 观众关页面 / 切走 / 网络断：都走这里，属正常断开，不刷日志
            Diag.log("live stream room=$room 断开: ${e.javaClass.simpleName}")
        } finally {
            up.close()
            Diag.log("live stream room=$room 结束，$bytes 字节，" +
                    "${System.currentTimeMillis() - started} ms")
        }
    }

    /**
     * 实时弹幕 SSE：GET /api/live/chat/stream?station=<id>
     *
     * 房间号必须在**写 SSE 头之前**解析：没有绑定直播间时还能回一条 400 JSON，
     * 前端能直接看到原因；一旦开始推 SSE，就只能靠连接关闭表达失败。
     */
    private fun apiLiveChatStream(sock: Socket, out: OutputStream, q: Map<String, String>) {
        val key = (q["station"] ?: "").trim()
        // station 传的是主播 id；找不到（旧链接/已删除）时回落到当前板块，跟其它 live 接口一致
        val st = if (key.isEmpty()) Store.currentStation()
        else (Store.findStation(key) ?: Store.currentStation())
        val room = st?.optString("room")?.trim() ?: ""
        if (!room.matches(Regex("\\d+"))) {
            json(out, JSONObject().put("error", "没有可用的直播间号").toString(), 400)
            return
        }
        val gw = try {
            LiveChat.prepare(room)
        } catch (e: Exception) {
            Diag.log("live chat gateway failed room=$room: ${human(e)}")
            json(out, JSONObject().put("error", "弹幕网关获取失败：${human(e)}").toString(), 502)
            return
        }
        // 从这里开始响应体是 text/event-stream，方法返回即关连接
        LiveChat.relay(sock, out, room, gw)
    }

    // ================= 关注列表 =================
    private fun apiFollowingLive(out: OutputStream, req: Req) {
        try {
            if (!BiliApi.hasSess()) {
                json(out, JSONObject().put("error", "需要登录：设置页扫码登录后才能读关注列表").toString(), 401)
                return
            }
            jsonObj(out, BiliApi.followingLive(req.query["refresh"] == "1"))
        } catch (e: Exception) {
            Diag.log("following live failed: ${human(e)}")
            json(out, JSONObject().put("error", "读取关注列表失败：${cut(human(e), 100)}").toString(), 502)
        }
    }

    private fun apiStationsFollowing(out: OutputStream, req: Req) {
        try {
            if (!BiliApi.hasSess()) {
                json(out, JSONObject().put("error", "需要登录：先在设置页扫码登录 B 站，才能读取关注列表").toString(), 401)
                return
            }
            val people = BiliApi.followingPeople(req.query["refresh"] == "1")
            val added = Store.stations().map { it.optString("mid") }.toHashSet()
            var addedCount = 0
            for (i in 0 until people.length()) {
                val p = people.optJSONObject(i) ?: continue
                val yes = added.contains(p.optString("mid"))
                p.put("added", yes)
                if (yes) addedCount++
            }
            json(out, JSONObject().put("list", people)
                .put("total", people.length()).put("added", addedCount).toString())
        } catch (e: Exception) {
            Diag.log("stations following failed: ${human(e)}")
            json(out, JSONObject().put("error", "读取关注列表失败：${cut(human(e), 100)}").toString(), 502)
        }
    }

    /** station 参数可能是 id / mid / 房间号；找不到时跟随当前板块（与 Python use_station 一致）。 */
    private fun resolveStation(key: String): JSONObject? {
        if (key.isEmpty()) return Store.currentStation()
        return Store.stations().firstOrNull {
            it.optString("id") == key || it.optString("mid") == key || it.optString("room") == key
        } ?: Store.currentStation()
    }

    private fun stationRoom(stationKey: String?): String =
        resolveStation(stationKey ?: "")?.optString("room") ?: ""

    // ================= WebSocket 直播中继 =================
    //
    // 为什么不用 HTTP 长连接做多路：浏览器对同一个源只给 6 条 HTTP/1.1 连接，
    // 而每路直播都是一条永不结束的响应 —— 6 路之后同源的一切请求（连 /api/ping 都算）
    // 全部排队。WebSocket 不占这 6 条，mpegts.js 见到 ws:// 会自动改用内置的
    // WebSocket 加载器，服务端只要把 FLV 字节按二进制帧发出去，前端不用改一行。

    private fun handleLiveWs(sock: Socket, out: OutputStream, req: Req) {
        val key = req.headers["sec-websocket-key"] ?: ""
        if (key.isEmpty()) {
            val body = "need Sec-WebSocket-Key".toByteArray(Charsets.UTF_8)
            try {
                out.write(("HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain; charset=utf-8\r\n" +
                        "Content-Length: ${body.size}\r\nConnection: close\r\n\r\n")
                    .toByteArray(Charsets.US_ASCII))
                out.write(body); out.flush()
            } catch (_: Exception) {}
            return
        }
        val accept = android.util.Base64.encodeToString(
            MessageDigest.getInstance("SHA-1")
                .digest((key + WS_GUID).toByteArray(Charsets.US_ASCII)),
            android.util.Base64.NO_WRAP)
        try {
            // 回 101 时把 Upgrade/Connection/版本号都补齐：有些代理层（含 WebView 的
            // 网络栈）会按这几项校验，缺了就当成普通响应而不断开升级流程。
            out.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n" +
                    "Connection: Upgrade\r\nSec-WebSocket-Accept: $accept\r\n" +
                    "Sec-WebSocket-Version: 13\r\n\r\n")
                .toByteArray(Charsets.US_ASCII))
            out.flush()
        } catch (e: Exception) {
            Diag.log("ws handshake failed: ${e.javaClass.simpleName}")
            return
        }
        // 握手之后这条 socket 只剩 WS 帧；35 秒的 HTTP 读超时会误杀空闲连接，先清掉
        try { sock.soTimeout = 0 } catch (_: Exception) {}
        try { sock.tcpNoDelay = true } catch (_: Exception) {}

        val room = (req.query["room"] ?: "").trim().ifEmpty { stationRoom(req.query["station"]) }
        val qn = (req.query["qn"]?.toIntOrNull() ?: 0).let { if (it > 0) it else BiliApi.LIVE_QN_DEFAULT }
        if (!room.matches(Regex("\\d+"))) {
            wsClose(out, 1011)
            Diag.log("ws: 没有可用的直播间号")
            return
        }
        val up = try {
            BiliApi.openLiveFlv(room, qn)
        } catch (e: Exception) {
            // 已经回过 101 了，只能用一条关闭帧把失败告诉前端（mpegts 会触发 error 重连）
            wsClose(out, 1011)
            Diag.log("ws room=$room 取流失败: ${human(e)}")
            return
        }
        val started = System.currentTimeMillis()
        var bytes = 0L
        val tl = FlvTimeline("room $room/ws")
        val buf = ByteArray(16 * 1024)
        try {
            val cin = sock.getInputStream()
            while (true) {
                if (wsClientClosed(sock, cin)) {
                    wsClose(out, 1000)
                    break
                }
                val n = up.input.read(buf)
                if (n < 0) break
                bytes += n
                val data = tl.feed(buf, 0, n)
                var off = 0
                while (off < data.size) {
                    // 单帧 ≤32KB：FLV 一个 tag 可能远大于 32KB（关键帧），
                    // 按字节边界拆成多帧对 mpegts.js 是透明的（它按流追加缓冲）。
                    val len = minOf(WS_MAX_FRAME, data.size - off)
                    wsSendBinary(out, data, off, len)
                    off += len
                }
            }
        } catch (e: Exception) {
            Diag.log("ws room=$room 断开: ${e.javaClass.simpleName}")
        } finally {
            up.close()   // 必须断开上游：否则每路会留一条永不关闭的 CDN 连接
            Diag.log("ws room=$room 结束，上行 $bytes 字节，" +
                    "${System.currentTimeMillis() - started} ms")
        }
    }

    /**
     * 非阻塞看一眼客户端有没有发 close 帧（关页面 / 取消勾选时都会发）。
     *
     * 只靠「写失败」也能发现断开，但客户端不再读取、连接又没断时，我们会一直往 TCP 里灌，
     * 要等浏览器自己的超时才断 —— 这期间上游那条流白占带宽。
     * 这里用 available() 探一下可读性再读完整帧；读到 ping 之类也直接丢掉。
     * ⚠️ 客户端只会发控制帧（close/ping，≤125 字节），所以「读到一半超时」的概率极低；
     *    真出现这种异常就按已断开处理，宁可多重连一次，也不留孤儿流。
     */
    private fun wsClientClosed(sock: Socket, input: InputStream): Boolean {
        return try {
            if (input.available() <= 0) return false
            sock.soTimeout = 2000
            val b0 = input.read(); if (b0 < 0) return true
            val b1 = input.read(); if (b1 < 0) return true
            var n = b1 and 0x7F
            if (n == 126) {
                n = (input.read() shl 8) or input.read()
            } else if (n == 127) {
                var v = 0L
                for (i in 0 until 8) v = (v shl 8) or input.read().toLong()
                n = v.toInt()
            }
            if ((b1 and 0x80) != 0) for (i in 0 until 4) input.read()  // 客户端帧一定带掩码
            var left = n
            if (left > 0) {
                val tmp = ByteArray(2048)
                while (left > 0) {
                    val r = input.read(tmp, 0, minOf(left, tmp.size))
                    if (r < 0) return true
                    left -= r
                }
            }
            (b0 and 0x0F) == 0x8
        } catch (_: java.net.SocketTimeoutException) {
            false
        } catch (_: Exception) {
            true
        } finally {
            try { sock.soTimeout = 0 } catch (_: Exception) {}
        }
    }

    /** 服务端发出的帧按协议不加掩码；单帧 ≤32KB。 */
    private fun wsSendBinary(out: OutputStream, data: ByteArray, off: Int, len: Int) {
        val head: ByteArray = when {
            len < 126 -> byteArrayOf(0x82.toByte(), len.toByte())
            len < 65536 -> byteArrayOf(0x82.toByte(), 126.toByte(),
                ((len shr 8) and 0xFF).toByte(), (len and 0xFF).toByte())
            else -> ByteArray(10).also {
                it[0] = 0x82.toByte(); it[1] = 127.toByte()
                for (i in 0 until 8) it[2 + i] = ((len.toLong() shr (56 - 8 * i)) and 0xFF).toByte()
            }
        }
        out.write(head)
        out.write(data, off, len)
        out.flush()
    }

    private fun wsClose(out: OutputStream, code: Int) {
        try {
            out.write(byteArrayOf(0x88.toByte(), 2,
                ((code shr 8) and 0xFF).toByte(), (code and 0xFF).toByte()))
            out.flush()
        } catch (_: Exception) {}
    }

    private fun human(e: Exception): String = (e.message ?: e.javaClass.simpleName).take(200)

    private fun cut(s: String, n: Int): String = if (s.length > n) s.substring(0, n) else s

    private fun jsonObj(out: OutputStream, obj: JSONObject) = json(out, obj.toString())
    private fun json(out: OutputStream, text: String, code: Int = 200) {
        val bytes = text.toByteArray(StandardCharsets.UTF_8)
        val reason = if (code == 200) "OK" else "Error"
        val hb = "HTTP/1.1 $code $reason\r\nContent-Type: application/json; charset=utf-8\r\n" +
                "Content-Length: ${bytes.size}\r\nConnection: close\r\n\r\n"
        out.write(hb.toByteArray(Charsets.US_ASCII))
        out.write(bytes)
        out.flush()
    }
    private fun asset(out: OutputStream, path: String, contentType: String) {
        val bytes = try { ctx.assets.open(path).use { it.readBytes() } }
        catch (_: Exception) { "页面资源缺失".toByteArray(StandardCharsets.UTF_8) }
        val hb = "HTTP/1.1 200 OK\r\nContent-Type: $contentType\r\n" +
                "Content-Length: ${bytes.size}\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n"
        out.write(hb.toByteArray(Charsets.US_ASCII))
        out.write(bytes)
        out.flush()
    }
}
