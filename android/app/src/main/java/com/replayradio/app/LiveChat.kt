package com.replayradio.app

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.OutputStream
import java.net.Socket
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import java.util.zip.DataFormatException
import java.util.zip.Inflater

/**
 * 直播间实时弹幕：服务端连 B 站弹幕 WebSocket，解析后转成 SSE 推给页面。
 *
 * 为什么不让 WebView 直连弹幕网关：
 *  · 浏览器握手带不上 bilibili 域的 Cookie，实测认证后立刻被网关断开（close 1006）；
 *  · B 站返回的是自定义二进制包（zlib 压缩、多包拼接），页面里解包既慢又容易踩坑。
 *
 * 为什么单独一个文件：字节协议、WS 生命周期、SSE 推流三件事各自都有坑，
 * 混进 LocalServer 会把路由逻辑淹掉。LocalServer 只负责「房间号校验 + 502 兜底」。
 *
 * 几个实机结论（别再踩）：
 *  1. getDanmuInfo **不带 wbi 签名会被风控拦成 -352**，所以这里先原样请求，失败再补签名；
 *  2. 认证包必须请求 protover=2（zlib）；protover=3 是 brotli，本项目没有解压库；
 *  3. zlib 解出来的内容又是「若干 16 字节包拼接」，必须循环切分逐包处理；
 *  4. uid=0（匿名）也能认证成功，但登录过就优先用 DedeUserID。
 */
object LiveChat {
    private const val UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    private const val LIVE_REFERER = "https://live.bilibili.com/"
    private const val DANMU_INFO =
        "https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo"
    private const val SPI = "https://api.bilibili.com/x/frontend/finger/spi"

    private const val OP_HEARTBEAT = 2
    private const val OP_POPULARITY = 3
    private const val OP_MESSAGE = 5
    private const val OP_AUTH = 7
    private const val OP_AUTH_REPLY = 8

    private const val PING_MS = 15_000L        // SSE 注释心跳
    private const val HEARTBEAT_MS = 30_000L   // B 站业务心跳（operation=2）

    /** 队列里的哨兵：WS 断开/失败。用对象身份判断，跟任何字符串都不会混。 */
    private val FAILED = Any()

    /** 单例 OkHttpClient：每条 SSE 都建一个客户端会把线程池堆起来，用完也不退。 */
    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(10, TimeUnit.SECONDS)
            // 弹幕可能十几分钟没一条：WS 的读超时必须关掉，否则 OkHttp 会当成连接失败
            .readTimeout(0, TimeUnit.MILLISECONDS)
            .pingInterval(0, TimeUnit.MILLISECONDS)   // 协议层 ping 不用，业务心跳自己发
            .build()
    }

    /** 一个弹幕网关：token + 可用的 wss 服务器（按返回顺序，最多取 3 个）。 */
    class Gateway(val token: String, val hosts: List<Host>) {
        class Host(val host: String, val port: Int)
    }

    // ---------------- 网关信息 ----------------

    /**
     * 取弹幕服务器地址。失败抛异常，由 LocalServer 在写 SSE 头之前翻成 502 JSON。
     * 先按需求原样请求；实测不加 wbi 签名会 -352，再补一次签名。签名密钥缓存 6 小时。
     */
    fun prepare(room: String): Gateway {
        var d = httpJson("$DANMU_INFO?id=$room&type=0")
        if (d.optInt("code", -1) != 0) {
            val signed = try {
                BiliApi.wbiSigned(DANMU_INFO, linkedMapOf("id" to room, "type" to "0"))
            } catch (_: Exception) { "" }
            if (signed.isNotEmpty()) d = httpJson(signed)
        }
        val code = d.optInt("code", -1)
        if (code != 0) throw RuntimeException("code=$code ${d.optString("message")}".trim())
        val data = d.optJSONObject("data") ?: throw RuntimeException("没有 data")
        val token = data.optString("token").trim()
        if (token.isEmpty()) throw RuntimeException("没有 token")

        val hosts = ArrayList<Gateway.Host>(3)
        val arr = data.optJSONArray("host_list") ?: JSONArray()
        for (i in 0 until arr.length()) {
            val h = arr.optJSONObject(i) ?: continue
            val host = h.optString("host").trim()
            if (host.isEmpty()) continue
            val port = h.optInt("wss_port", 443).let { if (it > 0) it else 443 }
            // B 站经常把同一个 host 重复下发三份，去重后才有「换服务器」的意义
            if (hosts.none { it.host == host && it.port == port }) hosts.add(Gateway.Host(host, port))
            if (hosts.size >= 3) break
        }
        if (hosts.isEmpty()) throw RuntimeException("没有可用的弹幕服务器")
        return Gateway(token, hosts)
    }

    private fun httpJson(url: String): JSONObject {
        // 复用 BiliApi 的共享客户端：进直播间只握手一次，别再为这条请求新开 TCP+TLS
        val b = Request.Builder().url(url)
            .header("User-Agent", UA)
            .header("Referer", LIVE_REFERER)
            .header("Origin", "https://live.bilibili.com")
            .header("Accept", "application/json, text/plain, */*")
        val ck = cookieHeader()
        if (ck.isNotEmpty()) b.header("Cookie", ck)
        BiliApi.http().newCall(b.build()).execute().use { resp ->
            val code = resp.code
            if (code != 200) throw RuntimeException("HTTP $code")
            return JSONObject(resp.body?.string().orEmpty())
        }
    }

    // ---------------- Cookie / buvid3 ----------------

    private fun cookieHeader(): String {
        val parts = ArrayList<String>(4)
        val sess = Store.cred("SESSDATA").trim()
        if (sess.isNotEmpty()) parts.add("SESSDATA=$sess")
        val buvid = buvid3()
        if (buvid.isNotEmpty()) {
            parts.add("buvid3=$buvid")
            // b_nut 是设备指纹的时间戳，和 buvid3 配套；匿名握手时网关更宽容
            parts.add("b_nut=" + (System.currentTimeMillis() / 1000))
        }
        return parts.joinToString("; ")
    }

    @Volatile private var buvidMem = ""
    @Volatile private var buvidTriedAt = 0L
    private val buvidLock = Any()

    /**
     * 没有 buvid3 时向 finger/spi 领一个。
     * ⚠️ 只放内存，**不写 cred.json**（那是登录凭据文件，而且匿名指纹会随会话变）。
     * 5 分钟内失败过一次就不再打：重连循环里反复打这个接口没有意义。
     */
    private fun buvid3(): String {
        val stored = Store.cred("buvid3").trim()
        if (stored.isNotEmpty()) return stored
        synchronized(buvidLock) {
            if (buvidMem.isNotEmpty()) return buvidMem
            if (System.currentTimeMillis() - buvidTriedAt < 5 * 60_000L) return ""
            buvidTriedAt = System.currentTimeMillis()
            return try {
                val d = httpJson(SPI)
                val v = (d.optJSONObject("data") ?: JSONObject()).optString("b_3").trim()
                if (v.isNotEmpty()) buvidMem = v
                v
            } catch (e: Exception) {
                Diag.log("chat buvid3 failed: ${e.javaClass.simpleName}")
                ""
            }
        }
    }

    // ---------------- SSE 会话 ----------------

    /** 一路 SSE 连接的全部可变状态：消息队列 + 停止标记 + 人气去重。 */
    private class Session(val room: String, val gw: Gateway) {
        val queue = LinkedBlockingQueue<Any>(512)
        val stopping = AtomicBoolean(false)
        @Volatile var lastPopularity = -1L

        /** 首次连接由 relay() 统一发「已连接」；之后每次重连成功才补一条「已重新连接」。 */
        @Volatile private var openedOnce = false

        /** 连一台弹幕服务器。失败/关闭都会往队列里丢一个 FAILED 哨兵，由主循环决定重连。 */
        fun connect(hostIndex: Int): WebSocket {
            val h = gw.hosts[hostIndex % gw.hosts.size]
            // 每台连接一个独立的一次性标记：onFailure 和 onClosed 可能先后触发，只报一次
            val failed = AtomicBoolean(false)
            val builder = Request.Builder()
                .url("wss://${h.host}:${h.port}/sub")
                .header("User-Agent", UA)
                .header("Origin", "https://live.bilibili.com")
            val ck = cookieHeader()
            if (ck.isNotEmpty()) builder.header("Cookie", ck)
            return client.newWebSocket(builder.build(), object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    try {
                        val uid = Store.cred("DedeUserID").trim().toLongOrNull() ?: 0L
                        val auth = JSONObject()
                            .put("uid", uid)
                            .put("roomid", room.toLong())
                            .put("protover", 2)          // 只要 zlib；3=brotli 本项目解不了
                            .put("platform", "web")
                            .put("type", 2)
                            .put("key", gw.token)
                        webSocket.send(ByteString.of(*packet(auth.toString().toByteArray(Charsets.UTF_8), OP_AUTH)))
                        // 重连成功后把页面上的「重连中…」改回来，否则要等第一条弹幕才更新
                        if (openedOnce) {
                            queue.offer("{\"type\":\"state\",\"text\":\"已重新连接 · 实时弹幕中\"}")
                        } else {
                            openedOnce = true
                        }
                    } catch (e: Exception) {
                        Diag.log("chat auth send failed: ${e.javaClass.simpleName}")
                        if (!stopping.get() && failed.compareAndSet(false, true)) queue.offer(FAILED)
                    }
                }

                override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                    try { handlePackets(bytes.toByteArray(), this@Session, 0) }
                    catch (e: Exception) { Diag.log("chat packet failed: ${e.javaClass.simpleName}") }
                }

                override fun onMessage(webSocket: WebSocket, text: String) {
                    // 正常是二进制帧；万一有网关用文本帧下推，也按一行一条 JSON 处理
                    try { handleJsonLines(text, this@Session) } catch (_: Exception) {}
                }

                override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                    webSocket.close(1000, null)
                }

                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                    if (!stopping.get() && failed.compareAndSet(false, true)) queue.offer(FAILED)
                }

                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                    if (!stopping.get()) {
                        Diag.log("chat ws failure room=$room: ${t.javaClass.simpleName} http=${response?.code ?: 0}")
                        if (failed.compareAndSet(false, true)) queue.offer(FAILED)
                    }
                }
            })
        }
    }

    /**
     * 跑完一路 SSE，客户端断开/重试耗尽才返回。LocalServer 每请求一线程，这里是阻塞写法。
     */
    fun relay(sock: Socket, out: OutputStream, room: String, gw: Gateway) {
        val s = Session(room, gw)
        var ws: WebSocket? = null
        var hostIndex = 0
        var failures = 0
        var lastWrite = System.currentTimeMillis()
        var lastHeartbeat = 0L
        try {
            // 先回 SSE 头：EventSource 收到 200 才会进入 open 状态。
            // 没有 Content-Length，响应体由「连接关闭」定界（SSE 的标准玩法）。
            out.write(("HTTP/1.1 200 OK\r\n" +
                    "Content-Type: text/event-stream; charset=utf-8\r\n" +
                    "Cache-Control: no-cache\r\n" +
                    "Connection: close\r\n" +
                    "X-Accel-Buffering: no\r\n\r\n").toByteArray(Charsets.US_ASCII))
            out.flush()
            // 覆盖 handle() 里的 35 秒 HTTP 读超时。SSE 不读客户端，这个值只用于
            // clientGone() 的探活读；超时在这里是「该发 ping 了」的正常节拍，不是断开。
            sock.soTimeout = 20_000
            send(out, "{\"type\":\"state\",\"text\":\"已连接 · 实时弹幕中\"}")
            lastWrite = System.currentTimeMillis()

            ws = s.connect(hostIndex)
            hostIndex++
            lastHeartbeat = System.currentTimeMillis()

            while (true) {
                try {
                    if (clientGone(sock)) break

                    val now = System.currentTimeMillis()
                    if (now - lastHeartbeat >= HEARTBEAT_MS) {
                        try {
                            ws?.send(ByteString.of(*packet(
                                "[object Object]".toByteArray(Charsets.UTF_8), OP_HEARTBEAT)))
                        } catch (_: Exception) { /* 连接已断：等 onFailure 的哨兵 */ }
                        lastHeartbeat = now
                    }

                    val item = s.queue.poll(500, TimeUnit.MILLISECONDS)
                    if (item == null) {
                        if (System.currentTimeMillis() - lastWrite >= PING_MS) {
                            out.write(": ping\n\n".toByteArray(Charsets.US_ASCII))
                            out.flush()
                            lastWrite = System.currentTimeMillis()
                        }
                        continue
                    }

                    if (item === FAILED) {
                        failures++
                        if (failures > 2) {
                            send(out, "{\"type\":\"state\",\"text\":\"弹幕连接已断开，请刷新重试\"}")
                            break
                        }
                        send(out, "{\"type\":\"state\",\"text\":\"弹幕连接断开，重连中…\"}")
                        // 退避 2s / 4s：网关偶尔抽风，立刻重连只会被连续拒绝
                        try { Thread.sleep(if (failures == 1) 2000L else 4000L) }
                        catch (_: InterruptedException) { break }
                        if (clientGone(sock)) break
                        ws = s.connect(hostIndex)      // 换下一台服务器（最多 3 台轮一遍）
                        hostIndex++
                        lastHeartbeat = System.currentTimeMillis()
                        lastWrite = System.currentTimeMillis()
                        continue
                    }

                    (item as? String)?.let { send(out, it) }
                    lastWrite = System.currentTimeMillis()
                } catch (e: java.net.SocketTimeoutException) {
                    // 20 秒探活超时：当成 ping 的节拍，绝不退出
                    out.write(": ping\n\n".toByteArray(Charsets.US_ASCII))
                    out.flush()
                    lastWrite = System.currentTimeMillis()
                }
            }
        } catch (e: java.io.IOException) {
            // 写失败 = 观众关页面/切走：正常结束，不刷日志
            Diag.log("chat sse room=$room 断开: ${e.javaClass.simpleName}")
        } catch (e: Exception) {
            Diag.log("chat sse room=$room failed: ${e.javaClass.simpleName}")
        } finally {
            // 方法结束前必须关 WebSocket：否则每条 SSE 都会留一条永不关闭的上行连接
            s.stopping.set(true)
            try { ws?.close(1000, null) } catch (_: Exception) {}
            try { ws?.cancel() } catch (_: Exception) {}
        }
    }

    /** SSE 一条消息一行数据；JSONObject.toString 会把控制字符转义，不会破坏 data 行。 */
    private fun send(out: OutputStream, json: String) {
        out.write(("data: " + json + "\n\n").toByteArray(Charsets.UTF_8))
        out.flush()
    }

    /**
     * 看一眼客户端是否已经关了连接。
     * 用 1ms 超时的 read 探一下：SSE 客户端正常不发数据 → 超时（false）；
     * 对端关闭 → read 返回 -1（true）。探完立刻把超时恢复成 20 秒。
     */
    private fun clientGone(sock: Socket): Boolean {
        return try {
            sock.soTimeout = 1
            sock.getInputStream().read() < 0
        } catch (_: java.net.SocketTimeoutException) {
            false
        } catch (_: Exception) {
            true
        } finally {
            try { sock.soTimeout = 20_000 } catch (_: Exception) {}
        }
    }

    // ---------------- 二进制协议 ----------------

    /** B 站包头 16 字节：总长(4) 头长(2) 版本(2) 操作码(4) 序号(4)。全部大端。 */
    private fun packet(body: ByteArray, op: Int, ver: Int = 1): ByteArray {
        val out = ByteArray(16 + body.size)
        writeInt(out, 0, out.size)
        out[4] = 0
        out[5] = 16
        out[6] = ((ver shr 8) and 0xFF).toByte()
        out[7] = (ver and 0xFF).toByte()
        writeInt(out, 8, op)
        writeInt(out, 12, 1)
        System.arraycopy(body, 0, out, 16, body.size)
        return out
    }

    /**
     * 切分一个二进制包。ver=2 的 op=5 内容是 zlib 压缩的，而且解出来仍是「多包拼接」，
     * 所以这里对解压结果递归调用自己（深度上限防御畸形数据）。
     */
    private fun handlePackets(buf: ByteArray, s: Session, depth: Int) {
        if (depth > 3) return
        var off = 0
        while (off + 16 <= buf.size) {
            val total = readInt(buf, off)
            val headerLen = readShort(buf, off + 4)
            val ver = readShort(buf, off + 6)
            val op = readInt(buf, off + 8)
            if (total < 16 || off + total > buf.size) return   // 半个包：这条帧不要了
            if (headerLen < 16 || headerLen > total) return
            val bodyOff = off + headerLen
            val bodyLen = total - headerLen
            when (op) {
                OP_POPULARITY -> if (bodyLen >= 4) {
                    val v = readInt(buf, bodyOff).toLong() and 0xFFFFFFFFL
                    if (v != s.lastPopularity) {
                        s.lastPopularity = v
                        s.queue.offer("{\"type\":\"popularity\",\"value\":$v}")
                    }
                }
                OP_MESSAGE -> when (ver) {
                    2 -> inflate(buf, bodyOff, bodyLen)?.let { handlePackets(it, s, depth + 1) }
                    3 -> { /* brotli：认证时固定请求 ver=2，这里只做防御，解不了就跳过 */ }
                    else -> handleJsonLines(String(buf, bodyOff, bodyLen, Charsets.UTF_8), s)
                }
                OP_AUTH_REPLY -> {
                    val text = String(buf, bodyOff, bodyLen, Charsets.UTF_8)
                    val code = try { JSONObject(text).optInt("code", -1) } catch (_: Exception) { -1 }
                    if (code != 0) Diag.log("chat auth reply room=${s.room}: ${text.take(160)}")
                }
            }
            off += total
        }
    }

    /** zlib 解压（B 站用带头的 zlib；失败再试裸 deflate，防御其它网关版本）。 */
    private fun inflate(src: ByteArray, off: Int, len: Int): ByteArray? {
        inflateOnce(src, off, len, false)?.let { return it }
        return inflateOnce(src, off, len, true)
    }

    private fun inflateOnce(src: ByteArray, off: Int, len: Int, nowrap: Boolean): ByteArray? {
        val inf = Inflater(nowrap)
        return try {
            inf.setInput(src, off, len)
            val out = ByteArrayOutputStream(maxOf(len * 4, 4096))
            val buf = ByteArray(16 * 1024)
            var guard = 0
            while (!inf.finished()) {
                val n = try { inf.inflate(buf) } catch (_: DataFormatException) { return null }
                if (n > 0) out.write(buf, 0, n)
                else if (inf.needsInput() || inf.needsDictionary()) break
                if (++guard > 4096) return null
                if (out.size() > 16 * 1024 * 1024) return null   // 防畸形包把内存撑爆
            }
            if (out.size() == 0) null else out.toByteArray()
        } finally {
            inf.end()
        }
    }

    /** 一个包体里可能是多条 JSON，用 \0 或 \n 分隔（B 站两种都用过）。 */
    private fun handleJsonLines(text: String, s: Session) {
        var start = 0
        while (start < text.length) {
            var end = start
            while (end < text.length) {
                val c = text[end]
                if (c == '\n' || c == '\u0000') break
                end++
            }
            val line = text.substring(start, end).trim()
            start = end + 1
            if (line.isEmpty()) continue
            val obj = try { JSONObject(line) } catch (_: Exception) { continue }
            dispatch(obj, s)
        }
    }

    private fun dispatch(obj: JSONObject, s: Session) {
        when (val cmd = obj.optString("cmd")) {
            "LIVE" -> s.queue.offer("{\"type\":\"state\",\"text\":\"直播已开始\"}")
            "PREPARING" -> s.queue.offer("{\"type\":\"state\",\"text\":\"主播已下播\"}")
            "SUPER_CHAT_MESSAGE" -> {
                val d = obj.optJSONObject("data") ?: return
                val out = JSONObject()
                    .put("type", "superchat")
                    .put("uname", d.optJSONObject("user_info")?.optString("uname") ?: "")
                    .put("text", d.optString("message"))
                    .put("price", d.optInt("price"))     // 整数元
                s.queue.offer(out.toString())
            }
            else -> {
                // DANMU_MSG 还有 DANMU_MSG:4:0:2:2:2:0 这种后缀，必须 startsWith
                if (!cmd.startsWith("DANMU_MSG")) return
                val info = obj.optJSONArray("info") ?: return
                val text = info.optString(1)
                if (text.isEmpty()) return
                val who = info.optJSONArray(2) ?: JSONArray()
                val out = JSONObject()
                    .put("type", "danmaku")
                    .put("uid", who.optLong(0))
                    .put("uname", who.optString(1))
                    .put("text", text)
                // 表情弹幕：info[0][13] 是一个 JSONObject，有 url 才带（普通弹幕这里是 {}）
                val emo = info.optJSONArray(0)?.opt(13)
                if (emo is JSONObject) {
                    val url = emo.optString("url").trim()
                    if (url.isNotEmpty()) out.put("emoticon", JSONObject().put("url", url))
                }
                s.queue.offer(out.toString())
            }
        }
    }

    private fun readInt(b: ByteArray, off: Int): Int =
        ((b[off].toInt() and 0xFF) shl 24) or ((b[off + 1].toInt() and 0xFF) shl 16) or
                ((b[off + 2].toInt() and 0xFF) shl 8) or (b[off + 3].toInt() and 0xFF)

    private fun readShort(b: ByteArray, off: Int): Int =
        ((b[off].toInt() and 0xFF) shl 8) or (b[off + 1].toInt() and 0xFF)

    private fun writeInt(b: ByteArray, off: Int, v: Int) {
        b[off] = ((v ushr 24) and 0xFF).toByte()
        b[off + 1] = ((v ushr 16) and 0xFF).toByte()
        b[off + 2] = ((v ushr 8) and 0xFF).toByte()
        b[off + 3] = (v and 0xFF).toByte()
    }
}
