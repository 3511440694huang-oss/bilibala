package com.replayradio.app

import okhttp3.ConnectionPool
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedInputStream
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.concurrent.Callable
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * B站接口封装（只实现核心收听所需，匿名访问，不做任何绕过风控的手段）。
 * 所有请求的 UA / Referer / Accept 与原 Python 版一致；失败时以人话报错。
 */
object BiliApi {
    private const val UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    private const val REFERER = "https://www.bilibili.com"
    private const val SERIES_ARCHIVES = "https://api.bilibili.com/x/series/archives"
    private const val SEASON_ARCHIVES = "https://api.bilibili.com/x/polymer/web-space/seasons_archives_list"
    private const val PAGE_SIZE = 30

    // 登录 / 登录态
    private const val NAV = "https://api.bilibili.com/x/web-interface/nav"
    /** 视频弹幕发送（7.1）：表单是 oid/cid/progress/mode/fontsize/color/msg/csrf */
    private const val DM_POST = "https://api.bilibili.com/x/v2/dm/post"
    private const val QR_GENERATE =
        "https://passport.bilibili.com/x/passport-login/web/qrcode/generate"
    private const val QR_POLL =
        "https://passport.bilibili.com/x/passport-login/web/qrcode/poll"

    // 直播
    private const val LIVE_ROOM_INFO = "https://api.live.bilibili.com/room/v1/Room/get_info"
    private const val LIVE_PLAY_URL = "https://api.live.bilibili.com/room/v1/Room/playUrl"
    private const val LIVE_PLAYINFO =
        "https://api.live.bilibili.com/xlive/web-room/v2/index/getRoomPlayInfo"
    private const val LIVE_STATUS =
        "https://api.live.bilibili.com/room/v1/Room/get_status_info_by_uids"
    const val LIVE_QN_DEFAULT = 250          // 超清。原画(10000)带宽太大，直播默认不抢它

    // 关注列表
    private const val FOLLOWING_API = "https://api.bilibili.com/x/relation/followings"
    private const val FOLLOW_PAGE = 50       // 接口上限
    private const val FOLLOW_PAGE_MAX = 400  // 防跑飞上限；正常账号远远用不到
    private const val FOLLOW_WORKERS = 6     // 实测 6 稳定，再高只会把风控窗口撑长
    private const val FOLLOW_BATCH = 50      // 每批开播状态查询的 uid 数
    private const val FOLLOW_LIVE_TTL = 120_000L
    private const val FOLLOW_UIDS_TTL = 30 * 60_000L
    private const val FOLLOW_PEOPLE_TTL = 5 * 60_000L
    private const val FOLLOW_DISK_TTL = 24 * 60 * 60_000L
    private const val FOLLOW_DISK = "follow_cache.json"

    private val QN_DESC = mapOf(
        80 to "1080P 高清", 74 to "720P 高清", 64 to "720P", 32 to "480P", 16 to "360P"
    )
    private val LIVE_QN_DESC = mapOf(
        127 to "8K", 126 to "杜比视界", 125 to "HDR", 120 to "4K", 116 to "1080P60",
        112 to "1080P 高码率", 10000 to "原画", 400 to "蓝光", 250 to "超清",
        150 to "高清", 80 to "1080P 高清", 74 to "720P60", 64 to "720P", 32 to "480P", 16 to "360P"
    )

    // ---------------- HTTP 层（全项目唯一出口，第 5 项提速的核心） ----------------

    /** 常规接口的读超时；单个调用要更长时间时用 clientFor() 派生，不重开连接。 */
    private const val READ_TIMEOUT_MS = 8_000

    private val FORM_TYPE = "application/x-www-form-urlencoded".toMediaType()

    /**
     * 共享的 B 站 HTTP 客户端。
     *
     * 以前每个请求都 `new HttpURLConnection` + `disconnect()`：等于每次重开 TCP、重做 TLS 握手
     * （B 站全站 HTTPS，一次握手 200~500ms），还带着 `Accept-Encoding: identity` 把压缩关掉。
     * 现在共用一个带连接池的 client：连接复用 + HTTP/2 + 自动 gzip，首屏那串接口不再各自握手。
     */
    private val HTTP: OkHttpClient = OkHttpClient.Builder()
        .connectionPool(ConnectionPool(8, 5, TimeUnit.MINUTES))
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(READ_TIMEOUT_MS.toLong(), TimeUnit.MILLISECONDS)
        .callTimeout(12, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .followRedirects(true)
        .build()

    /**
     * 直播字节流专用客户端：和 JSON 客户端分开。
     *
     * 直播是一条**一直开着**的连接（几分钟到几小时），所以不能套 12s 的总超时；
     * 读超时保留 30s（和 7.x 的 HttpURLConnection 一致）：正常直播每几百毫秒就有数据，
     * 30 秒一声不响说明这条连接已经死了，必须让读线程自己退出来，否则线程和 socket 都卡住。
     */
    private val STREAM: OkHttpClient = OkHttpClient.Builder()
        .connectionPool(ConnectionPool(4, 2, TimeUnit.MINUTES))
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .callTimeout(0, TimeUnit.MILLISECONDS)
        .retryOnConnectionFailure(true)
        .followRedirects(true)
        .build()

    /**
     * 常规调用一律用共享 client（连接都在池里）；只有显式要求更长读超时的调用
     * （登录轮询等）才派生一个 —— 派生 client 仍共享同一个连接池与调度器，不会重开连接。
     */
    private fun clientFor(timeoutMs: Int): OkHttpClient =
        if (timeoutMs <= READ_TIMEOUT_MS) HTTP
        else HTTP.newBuilder()
            .readTimeout(timeoutMs.toLong(), TimeUnit.MILLISECONDS)
            .callTimeout((timeoutMs + 4_000).toLong(), TimeUnit.MILLISECONDS)
            .build()

    /** 同包复用（LiveChat 的 danmuinfo 握手）：别再为一次性请求新开一条 TCP+TLS。 */
    internal fun http(): OkHttpClient = HTTP

    private fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")

    /** 一次 GET 的结果：JSON 本体 + 原样保留的响应头（扫码登录要从 Set-Cookie 取凭据）。 */
    private class Resp(val body: JSONObject, val headers: Map<String, List<String>>)

    /**
     * 所有 B 站请求的唯一出口：UA/Referer/Accept 与原 Python 版一致。
     * cookie 只在这里拼；异常一律翻成「人话」，绝不把 Cookie 或响应头带进异常消息。
     *
     * 不设 `Accept-Encoding`：交给 OkHttp 自动加 gzip 并透明解压（JSON 体积能小 70%）。
     * 连接复用与超时全部由共享 client 负责，这里只管拼请求、翻错误。
     */
    private fun request(url: String, referer: String = REFERER, cookie: String = "",
                        timeoutMs: Int = READ_TIMEOUT_MS, wantHeaders: Boolean = false): Resp {
        val builder = Request.Builder()
            .url(url)
            .header("User-Agent", UA)
            .header("Referer", referer)
            .header("Accept", "application/json, text/plain, */*")
            .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
            .header("Origin", "https://www.bilibili.com")
        if (cookie.isNotEmpty()) builder.header("Cookie", cookie)
        clientFor(timeoutMs).newCall(builder.build()).execute().use { resp ->
            val code = resp.code
            if (code == 412) throw RuntimeException("B站暂时拒绝请求（风控限流），请稍后再试")
            if (code != 200) throw RuntimeException("HTTP $code")
            val text = resp.body?.string().orEmpty()
            // Headers.toMultimap() 本身就是小写 key、保留重复项：扫码登录靠它拿全部 Set-Cookie
            val headers: Map<String, List<String>> =
                if (wantHeaders) resp.headers.toMultimap() else emptyMap()
            return Resp(JSONObject(text), headers)
        }
    }

    private fun getJson(url: String, referer: String = REFERER, cookie: String = "",
                        timeoutMs: Int = READ_TIMEOUT_MS): JSONObject =
        request(url, referer, cookie, timeoutMs).body

    /** 带登录态 GET：7.0 的歌单/动态等接口统一走这里，别各自 new HttpURLConnection。 */

    /** 从 Set-Cookie 行里挑出我们关心的四个凭据。值本身绝不进日志。 */
    private fun parseSetCookies(headers: Map<String, List<String>>): Map<String, String> {
        val out = HashMap<String, String>()
        val lines = headers["set-cookie"] ?: emptyList()
        for (line in lines) {
            for (name in arrayOf("SESSDATA", "bili_jct", "DedeUserID", "buvid3")) {
                val m = Regex("(?:^|[;,\\s])" + name + "=([^;,\\s]+)").find(line)
                if (m != null && m.groupValues[1].isNotEmpty()) out[name] = m.groupValues[1]
            }
        }
        return out
    }

    private fun sessCookie(): String {
        val s = Store.cred("SESSDATA")
        if (s.isEmpty()) return ""
        val b = Store.cred("buvid3").ifEmpty { ensureBuvid3() }
        return if (b.isEmpty()) "SESSDATA=$s" else "SESSDATA=$s; buvid3=$b"
    }

    // buvid3 是 B 站判「是不是陌生客户端」的设备指纹。登录响应里不一定带，
    // 不带时列表类接口更容易被风控（-352/412）。这里按需向 finger/spi 领一个并落盘，
    // 失败 5 分钟内不再重试，避免每个请求都多打一次接口。
    private val buvidLock = Any()
    @Volatile private var buvidMem = ""
    @Volatile private var buvidTriedAt = 0L

    private fun ensureBuvid3(): String {
        val stored = Store.cred("buvid3")
        if (stored.isNotEmpty()) return stored
        val now = System.currentTimeMillis()
        synchronized(buvidLock) {
            if (buvidMem.isNotEmpty()) return buvidMem
            if (now - buvidTriedAt < 5 * 60_000L) return ""
            buvidTriedAt = now
        }
        return try {
            val d = getJson("https://api.bilibili.com/x/frontend/finger/spi",
                "https://www.bilibili.com/")
            val v = (d.optJSONObject("data") ?: JSONObject()).optString("b_3").trim()
            if (v.isNotEmpty()) {
                synchronized(buvidLock) { buvidMem = v }
                try { Store.saveCred("buvid3", v) } catch (_: Exception) {}
            }
            v
        } catch (e: Exception) {
            Diag.log("buvid3 fetch failed: ${human(e)}")
            ""
        }
    }

    fun hasSess(): Boolean = Store.cred("SESSDATA").isNotEmpty()

    // ---------------- 登录 ----------------

    /**
     * 申请扫码登录二维码。
     * 顺带保存生成接口下发的 buvid3（有就存）：后续 nav 少一次「无设备指纹」的嫌疑，
     * 没有也不影响登录，不额外请求。
     */
    fun loginQrCode(): JSONObject {
        val r = request(QR_GENERATE, "https://www.bilibili.com/", wantHeaders = true)
        val d = r.body
        if (d.optInt("code", -1) != 0) {
            throw RuntimeException("B 站返回 ${d.optInt("code")} ${d.optString("message")}")
        }
        val dd = d.optJSONObject("data") ?: throw RuntimeException("B 站没有返回二维码")
        val url = dd.optString("url")
        val key = dd.optString("qrcode_key")
        if (url.isEmpty() || key.isEmpty()) throw RuntimeException("B 站没有返回二维码")
        val cookies = parseSetCookies(r.headers)
        val buvid = cookies["buvid3"] ?: ""
        if (buvid.isNotEmpty()) {
            try { Store.saveCred("buvid3", buvid) } catch (_: Exception) {}
        }
        return JSONObject().put("url", url).put("key", key)
    }

    /**
     * 轮询扫码状态。code：0 成功 / 86101 未扫描 / 86090 已扫描待确认 / 86038 已失效。
     *
     * 成功后凭据只在 **Set-Cookie 响应头**里（JSON body 没有）。OkHttp 的
     * Headers.toMultimap() 会保留每一行 Set-Cookie（同名不合并），所以四条凭据能一次取全。
     * 返回体里 jct 只给布尔 —— 前端只需要知道「有没有」，任何响应都不许出现凭据原值。
     */
    fun loginPoll(key: String): JSONObject {
        if (key.isEmpty()) throw RuntimeException("缺少 key")
        val url = QR_POLL + "?qrcode_key=" + enc(key) + "&source=main-fe-header"
        val r = request(url, "https://www.bilibili.com/", wantHeaders = true)
        val dd = r.body.optJSONObject("data") ?: JSONObject()
        val code = dd.optInt("code", -1)
        val out = JSONObject().put("code", code).put("message", dd.optString("message"))
        if (code != 0) {
            Diag.log("login poll code=$code")
            return out
        }
        val cookies = parseSetCookies(r.headers)
        val sess = cookies["SESSDATA"] ?: ""
        val jct = cookies["bili_jct"] ?: ""
        val uid = cookies["DedeUserID"] ?: ""
        val buvid = cookies["buvid3"] ?: ""
        try {
            if (sess.isNotEmpty()) Store.saveCred("SESSDATA", sess)
            if (jct.isNotEmpty()) Store.saveCred("bili_jct", jct)
            if (uid.isNotEmpty()) Store.saveCred("DedeUserID", uid)
            if (buvid.isNotEmpty()) Store.saveCred("buvid3", buvid)
        } catch (e: Exception) {
            Diag.log("login save cred FAILED: ${e.message}")
        }
        onCredentialChanged()
        out.put("logged", sess.isNotEmpty()).put("jct", jct.isNotEmpty())
        if (sess.isEmpty()) {
            out.put("message", "登录成功但未取到 SESSDATA")
        } else if (jct.isEmpty()) {
            out.put("message", "登录成功，但未取到 bili_jct；重新扫码一次通常就有了")
        }
        Diag.log("login poll success sess=${sess.isNotEmpty()} jct=${jct.isNotEmpty()} uid=${uid.isNotEmpty()}")
        return out
    }

    /** 登出：清凭据 + 清所有「属于上一个账号」的缓存。 */
    fun logout() {
        Store.clearCred()
        onCredentialChanged()
        Diag.log("logout: credentials cleared")
    }

    /**
     * 凭据变化（登录成功 / 登出 / 手工改 jct）后统一作废缓存。
     * 不清理关注缓存的话，换账号后第一次进监控室会看到**上一个人**的关注名单，
     * 既像数据串了，也是隐私问题。
     */
    fun onCredentialChanged() {
        invalidateStatus()
        selfUidCache = null
        synchronized(followLock) {
            followList = JSONArray()
            followAt = 0L
            followUids = emptyList()
            followUidsAt = 0L
            followBusy = false
            followDiskTried = false
            followPeople = JSONArray()
            followPeopleAt = 0L
        }
        try { Store.deleteFile(FOLLOW_DISK) } catch (_: Exception) {}
    }

    // ---------------- 登录态 ----------------
    private val statusLock = Any()
    @Volatile private var statusCache: JSONObject? = null
    @Volatile private var statusAt = 0L

    fun invalidateStatus() {
        synchronized(statusLock) {
            statusCache = null
            statusAt = 0L
        }
    }

    /**
     * 本机登录态。缓存 30 秒（页面一次加载会问两三次），refresh=1 绕过 ——
     * 登录/登出之后必须立刻拿到新结果，否则刚扫码完会看到 30 秒的「未登录」。
     */
    fun status(force: Boolean): JSONObject {
        if (!force) {
            synchronized(statusLock) {
                val hit = statusCache
                if (hit != null && System.currentTimeMillis() - statusAt < 30_000L) {
                    return JSONObject(hit.toString())
                }
            }
        }
        val sess = Store.cred("SESSDATA")
        val hasJct = Store.cred("bili_jct").isNotEmpty()
        val info: JSONObject
        if (sess.isEmpty()) {
            info = JSONObject().put("logged", false).put("jct", false)
                .put("status", "匿名模式（核心收听可用）")
        } else {
            info = JSONObject().put("logged", true).put("jct", hasJct)
            try {
                val dd = getJson(NAV, "https://www.bilibili.com/", sessCookie())
                    .optJSONObject("data") ?: JSONObject()
                val logged = dd.optBoolean("isLogin")
                info.put("logged", logged)
                info.put("uname", dd.optString("uname").trim())
                info.put("mid", dd.optLong("mid"))
                info.put("face", dd.optString("face").trim())
                info.put("vip", dd.optInt("vipStatus") == 1)
                if (!logged) info.put("status", "登录态已失效，请重新扫码")
            } catch (e: Exception) {
                // 网络/风控失败时不能谎报「未登录」：本地有 SESSDATA 就先按已登录显示，
                // 等下一次刷新成功再校正（Python 原版同样的取舍）。
                info.put("error", "登录态查询失败：${human(e)}")
                Diag.log("status nav failed: ${human(e)}")
            }
        }
        synchronized(statusLock) {
            statusCache = JSONObject(info.toString())
            statusAt = System.currentTimeMillis()
        }
        return info
    }

    @Volatile private var selfUidCache: String? = null

    /**
     * 登录账号自己的 uid。优先用登录时落盘的 DedeUserID（省一次 nav），
     * 没有再问 nav。**失败不缓存 0**：缓存了会把错误钉死，之后每次都拿 0 去查关注。
     */
    fun selfUid(): String {
        selfUidCache?.let { return it }
        val fromCred = Store.cred("DedeUserID")
        if (fromCred.matches(Regex("\\d+")) && fromCred != "0") {
            selfUidCache = fromCred
            return fromCred
        }
        return try {
            val uid = (getJson(NAV, "https://www.bilibili.com/", sessCookie())
                .optJSONObject("data") ?: JSONObject()).optLong("mid").toString()
            if (uid != "0") {
                selfUidCache = uid
                uid
            } else ""
        } catch (e: Exception) {
            Diag.log("selfUid failed: ${human(e)}")
            ""
        }
    }

    // ---------------- 主播状态 / 直播取流 ----------------

    private val liveUrlCache = ConcurrentHashMap<String, JSONObject>()
    private val liveHlsCache = ConcurrentHashMap<String, JSONObject>()

    /** 按房间号取权威开播状态（get_info 不需要登录，也不受新版 HLS 流影响）。 */
    fun liveRoomInfo(room: String): JSONObject {
        val d = getJson("$LIVE_ROOM_INFO?room_id=${enc(room)}",
            "https://live.bilibili.com/$room", sessCookie())
        if (d.optInt("code") != 0) {
            throw RuntimeException("直播间信息 code=${d.optInt("code")} ${d.optString("message")}")
        }
        val x = d.optJSONObject("data") ?: throw RuntimeException("直播间不存在")
        val rid = x.optString("room_id")
        if (!rid.matches(Regex("\\d+"))) throw RuntimeException("直播间不存在")
        // live_time：老接口给的是日期字符串，get_status_info_by_uids 给的是秒级时间戳。
        // int() 不成功就按 0 处理（Python 版同样兜底），前端只把它当「播了多久」的提示。
        val start = try { x.optString("live_time").toLong() } catch (_: Exception) { 0L }
        return JSONObject()
            .put("uid", x.optString("uid"))
            .put("room_id", rid)
            .put("living", x.optInt("live_status") == 1)
            .put("title", x.optString("title"))
            .put("area", x.optString("area_name"))
            .put("cover", x.optString("keyframe").ifEmpty { x.optString("user_cover") })
            .put("online", x.optLong("online"))
            .put("start", start)
    }

    /**
     * 老 FLV 通道（room/v1/Room/playUrl，不需要签名）。
     * 缓存按**房间**分开、60 秒：监控室会同时取好几路，一份共享缓存会互相覆盖，
     * A 房间刚取完就被 B 顶掉，两路都拿错流。
     */
    fun livePlayUrl(room: String, qn: Int): JSONObject {
        val now = System.currentTimeMillis()
        liveUrlCache[room]?.let { c ->
            if (c.optInt("qn") == qn && now - c.optLong("at") < 60_000L) return c
        }
        val d = getJson("$LIVE_PLAY_URL?cid=${enc(room)}&qn=$qn&platform=web&ptype=8",
            "https://live.bilibili.com/$room", sessCookie())
        if (d.optInt("code") != 0) throw RuntimeException("B 站返回 code=${d.optInt("code")}")
        val data = d.optJSONObject("data") ?: JSONObject()
        val media = (data.optJSONArray("durl")?.optJSONObject(0))?.optString("url") ?: ""
        if (media.isEmpty()) throw RuntimeException("没有取到直播流地址（可能刚下播）")
        val qualities = JSONArray()
        val desc = data.optJSONArray("quality_description") ?: JSONArray()
        for (i in 0 until desc.length()) {
            val q = desc.optJSONObject(i) ?: continue
            qualities.put(JSONObject().put("qn", q.optInt("qn"))
                .put("desc", q.optString("desc").ifEmpty { LIVE_QN_DESC[q.optInt("qn")] ?: "" }))
        }
        val accept = JSONArray()
        val accArr = data.optJSONArray("accept_quality") ?: JSONArray()
        for (i in 0 until accArr.length()) accept.put(accArr.optInt(i))
        val out = JSONObject().put("at", now).put("qn", qn).put("url", media)
            .put("current_qn", data.optInt("current_qn", qn)).put("qualities", qualities)
            .put("accept_qn", accept)
        liveUrlCache[room] = out
        return out
    }

    /**
     * 新版取流接口（HLS/fMP4）。老 playUrl 对一部分新房间直接报 19001012，
     * 状态接口仍然准 —— 所以这条只用来「兜底拿地址」，绝不参与开播判断。
     * 只挑 avc：mpegts.js 与 FLV 都只认 H.264。
     */
    fun liveHlsUrl(room: String, qn: Int): JSONObject {
        val now = System.currentTimeMillis()
        liveHlsCache[room]?.let { c ->
            if (c.optInt("qn") == qn && now - c.optLong("at") < 60_000L) return c
        }
        val url = "$LIVE_PLAYINFO?room_id=${enc(room)}&protocol=0,1&format=0,1,2" +
                "&codec=0,1&qn=$qn&platform=web&ptype=8&dolby=5&panorama=1"
        val d = getJson(url, "https://live.bilibili.com/$room", sessCookie())
        if (d.optInt("code") != 0) throw RuntimeException("新版取流 code=${d.optInt("code")}")
        val p = (d.optJSONObject("data")?.optJSONObject("playurl_info")
            ?.optJSONObject("playurl")) ?: throw RuntimeException("新版取流没有 playurl")
        val desc = HashMap<Int, String>()
        val gs = p.optJSONArray("g_qn_desc") ?: JSONArray()
        for (i in 0 until gs.length()) {
            val g = gs.optJSONObject(i) ?: continue
            desc[g.optInt("qn")] = g.optString("desc")
        }
        val streams = p.optJSONArray("stream") ?: JSONArray()
        for (si in 0 until streams.length()) {
            val st = streams.optJSONObject(si) ?: continue
            val formats = st.optJSONArray("format") ?: continue
            for (fi in 0 until formats.length()) {
                val fm = formats.optJSONObject(fi) ?: continue
                val codecs = fm.optJSONArray("codec") ?: continue
                for (ci in 0 until codecs.length()) {
                    val co = codecs.optJSONObject(ci) ?: continue
                    if (co.optString("codec_name") != "avc") continue
                    val base = co.optString("base_url")
                    val infos = co.optJSONArray("url_info") ?: JSONArray()
                    if (base.isEmpty() || infos.length() == 0) continue
                    val u = infos.optJSONObject(0) ?: continue
                    val full = u.optString("host") + base + u.optString("extra")
                    val cur = co.optInt("current_qn", qn)
                    val qualities = JSONArray()
                    val acc = co.optJSONArray("accept_qn") ?: JSONArray()
                    for (ai in 0 until acc.length()) {
                        val q = acc.optInt(ai)
                        qualities.put(JSONObject().put("qn", q)
                            .put("desc", desc[q] ?: LIVE_QN_DESC[q] ?: q.toString()))
                    }
                    // format 记录真实容器：getRoomPlayInfo 在部分房间会先给 http_stream/flv，
                    // 这种地址不需要 ffmpeg 也能直连播放，跟真正的 HLS 要区别对待。
                    val out = JSONObject().put("at", now).put("qn", qn)
                        .put("kind", if (fm.optString("format_name") == "flv") "flv" else "hls")
                        .put("format", fm.optString("format_name"))
                        .put("protocol", st.optString("protocol_name"))
                        .put("url", full).put("current_qn", cur).put("qualities", qualities)
                        .put("accept_qn", acc)
                    liveHlsCache[room] = out
                    return out
                }
            }
        }
        throw RuntimeException("新版取流没有可用的 H.264 通道")
    }

    // ---------------- 画质档位（第 4 项） ----------------

    /** 常见直播画质档：原画 / 蓝光 / 超清 / 高清 / 流畅。接口只回一档时用它补齐列表。 */
    private val LIVE_COMMON_QN = intArrayOf(10000, 400, 250, 150, 80)

    /** 取流失败时的降级顺序：谁先试谁。0 = 让接口给服务端默认档。 */
    private fun qnLadder(qn: Int): List<Int> {
        val out = ArrayList<Int>(8)
        if (qn > 0) out.add(qn)
        for (q in LIVE_COMMON_QN) if (q != qn) out.add(q)
        out.add(0)
        return out
    }

    private fun qnName(q: Int): String = LIVE_QN_DESC[q] ?: q.toString()

    /**
     * 合并成前端要的 qualities。
     *
     * 上游经常只回一档（HLS-only 房间甚至只回 current_qn），直接丢给前端就只剩一个选项。
     * 所以先用 LIVE_COMMON_QN 铺底，再用接口真实下发的档位覆盖描述，按 qn 降序输出。
     * 真实可用的档位另放在 accept_qn 里，前端据此过滤/置灰 —— 两边不冲突。
     */
    private fun mergeQualities(real: JSONArray?, current: Int): JSONArray {
        val desc = LinkedHashMap<Int, String>()
        for (q in LIVE_COMMON_QN) desc[q] = qnName(q)
        if (current > 0 && !desc.containsKey(current)) desc[current] = qnName(current)
        if (real != null) for (i in 0 until real.length()) {
            val o = real.optJSONObject(i) ?: continue
            val q = o.optInt("qn", -1)
            if (q <= 0) continue
            desc[q] = o.optString("desc").ifEmpty { qnName(q) }
        }
        val out = JSONArray()
        for (q in desc.keys.sortedDescending()) {
            out.put(JSONObject().put("qn", q).put("desc", desc[q] ?: qnName(q)))
        }
        return out
    }

    /** 把上游的 accept_qn 透出去；接口没给就不放这个键（空数组会被前端当成「一档都不支持」）。 */
    private fun putAccept(out: JSONObject, src: JSONObject) {
        val acc = src.optJSONArray("accept_qn") ?: return
        if (acc.length() > 0) out.put("accept_qn", acc)
    }

    /**
     * 先 FLV、失败再 HLS；只往 out 里补 qualities/accept_qn/current_qn/flv/hls/error。
     * flv 只在真拿到可播的 FLV 时写；living=false 时调用方根本不进来，前端拿到的就是空（不带这个键）。
     * ⚠️ 返回 false **不代表没开播**：调用方必须保留之前查到的 living。
     */
    fun fillLiveStream(out: JSONObject, room: String, qn: Int): Boolean {
        try {
            val c = livePlayUrl(room, qn)
            val cur = c.optInt("current_qn", qn)
            out.put("qualities", mergeQualities(c.optJSONArray("qualities"), cur))
            putAccept(out, c)
            out.put("current_qn", cur)
            /* 8.0.1：把这条已经验过的 FLV 地址一并交出去。
               监控墙 6 路若全走本机中转，Kotlin 要逐字节改写 6 条 FLV 时间戳，
               手机 CPU 会被打满；WebView 也只剩 6 条 HTTP/1.1 连接可用。
               B 站 CDN 允许 CORS（Access-Control-Allow-Origin: *），监控可以直接拉。 */
            out.put("flv", toHttps(c.optString("url")))
            out.put("flv_qn", cur)
            return true
        } catch (e1: Exception) {
            val m1 = human(e1)
            try {
                val h = liveHlsUrl(room, qn)
                val cur = h.optInt("current_qn", qn)
                out.put("current_qn", cur)
                // HLS-only 房间也要有档位列表：画质面板照样要显示，
                // 「能不能播」由 hls/error 表达，不该靠 qualities 为空来暗示。
                out.put("qualities", mergeQualities(h.optJSONArray("qualities"), cur))
                putAccept(out, h)
                if (h.optString("format") == "flv") {
                    // 这条「新版接口」其实给了 http_stream/flv：不需要转封装就能播
                    out.put("hls", false)
                    out.put("flv", toHttps(h.optString("url")))
                    out.put("flv_qn", cur)
                    return true
                }
                // 真正的 HLS/fMP4：本 APK 没有 ffmpeg 转封装，mpegts.js 也吃不了，
                // 所以不能假装能播 —— 明确告诉前端「直播中但本机播不了」。
                out.put("hls", true)
                out.put("error", "直播中：该直播间只提供 HLS/fMP4 流，本机没有转封装组件，暂时无法播放（可去原直播间观看）")
                Diag.log("live fill: room=$room 只有 HLS/${h.optString("format")}，无法本机播放")
                return false
            } catch (e2: Exception) {
                out.put("error", "直播中，但取流失败：${cut(m1, 50)}；备用通道：${cut(human(e2), 50)}")
                Diag.log("live fill failed room=$room: ${m1} / ${human(e2)}")
                return false
            }
        }
    }

    /** 房间已下播 / 老接口整体不支持：换画质档位没有意义，别白打六个请求。 */
    private fun noStream(e: Exception): Boolean {
        val m = human(e)
        return m.contains("没有取到直播流地址") ||
            m.contains("19002") ||                 // 19002000 房间已关闭
            m.contains("19001012") ||              // 老 playUrl 对新房间直接报错，走新版接口
            m.contains("未开播")
    }

    /**
     * 打开一路直播 FLV 字节流（HTTP 转发与 WebSocket 中继共用）。
     *
     * 档位不可用时**不许直接失败**：老 playUrl 对部分房间只认某几档（报 -400/-404），
     * 监控墙要 150、焦点格要 10000，硬要某一档会整路黑掉。
     * 顺序 = 请求档 → 10000 → 400 → 250 → 150 → 80 → 服务端默认档（qn=0）。
     */
    fun openLiveFlv(room: String, qn: Int): LiveFlvStream {
        var last = ""
        for (candidate in qnLadder(qn)) {
            val media = try {
                livePlayUrl(room, candidate).optString("url")
            } catch (e: Exception) {
                last = human(e)
                if (noStream(e)) break       // 下播了，换档位救不回来
                continue
            }
            if (media.isEmpty()) { last = "没有取到直播流地址"; break }
            try {
                return openMediaStream(room, media, qn, candidate)
            } catch (e: Exception) {
                /* 8.0.1：某档拿到的 CDN 地址连不上（404/403/超时）时继续试下一档，
                   以前这里直接抛出，整路黑屏。 */
                last = human(e)
                Diag.log("live flv room=$room 候选档 $candidate 连不上：${cut(last, 60)}")
            }
        }
        // 老接口彻底没辙：新版接口里若还有 http_stream/flv 通道（不需要 ffmpeg）就再试一次
        val alt = try { liveHlsUrl(room, if (qn > 0) qn else LIVE_QN_DEFAULT) } catch (_: Exception) { null }
        val altUrl = alt?.optString("url").orEmpty()
        if (alt != null && alt.optString("format") == "flv" && altUrl.isNotEmpty()) {
            return openMediaStream(room, altUrl, qn, alt.optInt("current_qn", qn))
        }
        throw RuntimeException(
            if (last.isEmpty()) "直播中，但只有 HLS/fMP4 流，本机无法转封装播放"
            else "直播取流失败（已依次尝试多个画质档）：${cut(last, 80)}"
        )
    }

    /** 真正连上 CDN 并交出字节流；连接一直持有到客户端断开。 */
    private fun openMediaStream(room: String, media: String, reqQn: Int, finalQn: Int): LiveFlvStream {
        val req = Request.Builder().url(media)
            // CDN 校验 Referer + UA：不带 Referer 直连返回 403，所以浏览器只能走本机中转
            .header("User-Agent", UA)
            .header("Referer", "https://live.bilibili.com/$room")
            .header("Accept", "*/*")
            // 直播要的是原始 FLV 字节，不能让 gzip 透明解压把流搅乱
            .header("Accept-Encoding", "identity")
            .build()
        val call = STREAM.newCall(req)
        val resp = try {
            call.execute()
        } catch (e: Exception) {
            try { call.cancel() } catch (_: Exception) {}
            throw RuntimeException("连接直播 CDN 失败：${human(e)}")
        }
        if (resp.code != 200) {
            val code = resp.code
            try { resp.close() } catch (_: Exception) {}
            try { call.cancel() } catch (_: Exception) {}
            throw RuntimeException("直播 CDN 返回 HTTP $code")
        }
        val body = resp.body
        if (body == null) {
            try { resp.close() } catch (_: Exception) {}
            try { call.cancel() } catch (_: Exception) {}
            throw RuntimeException("直播 CDN 没有返回数据")
        }
        Diag.log("live flv room=$room 取流成功，请求档 $reqQn / 实际档 $finalQn")
        return LiveFlvStream(call, resp, BufferedInputStream(body.byteStream(), 64 * 1024), room)
    }

    /** 按房间号：开播状态 + 取流信息。station 非空时用它补 uname/face（关注源没有这个名字）。 */
    fun playInfoByRoom(room: String, station: JSONObject? = null): JSONObject {
        val out = JSONObject()
            .put("room_id", room)
            .put("mid", station?.optString("mid") ?: "")
            .put("living", false)
            .put("title", "")
            .put("online", 0L)
            .put("uname", station?.optString("name") ?: "")
            .put("face", station?.optString("face") ?: "")
            .put("cover", "")
            .put("area", "")
            .put("start", 0L)
            .put("url", "https://live.bilibili.com/$room")
            .put("qualities", JSONArray())
            .put("current_qn", LIVE_QN_DEFAULT)
            .put("hls", false)
        val meta = try {
            liveRoomInfo(room)
        } catch (e: Exception) {
            // 开播判定只能由 live_status 决定：取流地址在下播后仍可能有效，
            // 用「能不能取到 FLV」反推会把已经下播的直播间判成在播（上游已改掉）。
            // 状态接口失败就如实报「状态未知」，宁可不显示，也不谎报在播。
            out.put("status_unknown", true)
            out.put("error", "开播状态获取失败：${cut(human(e), 80)}")
            Diag.log("live room info failed room=$room: ${human(e)}")
            return out
        }
        // 用户可能传的是短号（如 room=6）；playUrl/取流只认真实房间号，
        // 所以后续一律用 get_info 回来的 room_id，别再拿入参去取流。
        val canonical = meta.optString("room_id").ifEmpty { room }
        out.put("mid", meta.optString("uid").ifEmpty { out.optString("mid") })
        out.put("room_id", canonical)
        out.put("living", meta.optBoolean("living"))
        out.put("title", meta.optString("title"))
        out.put("area", meta.optString("area"))
        out.put("cover", meta.optString("cover"))
        out.put("online", meta.optLong("online"))
        out.put("start", meta.optLong("start"))
        out.put("url", "https://live.bilibili.com/$canonical")
        if (meta.optBoolean("living")) fillLiveStream(out, canonical, LIVE_QN_DEFAULT)
        return out
    }

    /** 按 uid：监控室「关注的直播」用；不需要真实房间号。 */
    fun playInfoByMid(mid: String): JSONObject {
        val info = fetchLiveFor(mid)
        val room = info.optString("room_id")
        val out = JSONObject()
            .put("room_id", room)
            .put("mid", mid)
            .put("living", info.optBoolean("living"))
            .put("title", info.optString("title"))
            .put("online", info.optLong("online"))
            .put("uname", info.optString("uname"))
            .put("face", info.optString("face"))
            .put("cover", info.optString("cover"))
            .put("area", info.optString("area"))
            .put("start", info.optLong("start"))
            .put("url", if (room.isEmpty()) "" else "https://live.bilibili.com/$room")
            .put("qualities", JSONArray())
            .put("current_qn", LIVE_QN_DEFAULT)
            .put("hls", false)
        if (info.optBoolean("living") && room.isNotEmpty()) {
            fillLiveStream(out, room, LIVE_QN_DEFAULT)
        }
        return out
    }

    private fun fetchLiveFor(mid: String): JSONObject {
        val d = getJson("$LIVE_STATUS?uids[]=${enc(mid)}", "https://live.bilibili.com/", sessCookie())
        if (d.optInt("code") != 0) {
            throw RuntimeException("开播接口 code=${d.optInt("code")} ${d.optString("message")}")
        }
        val info = d.optJSONObject("data")?.optJSONObject(mid)
            ?: throw RuntimeException("开播接口未返回该 uid 的数据")
        return JSONObject()
            .put("living", info.optInt("live_status") == 1)
            .put("room_id", info.optString("room_id"))
            .put("uname", info.optString("uname").trim())
            .put("face", info.optString("face").trim())
            .put("title", info.optString("title"))
            .put("area", info.optString("area_v2_name"))
            .put("online", info.optLong("online"))
            .put("cover", info.optString("cover_from_user").ifEmpty { info.optString("keyframe") })
            .put("start", try { info.optLong("live_time") } catch (_: Exception) { 0L })
    }

    // ---------------- 关注列表 ----------------

    private val followLock = Any()
    @Volatile private var followUids: List<String> = emptyList()
    @Volatile private var followUidsAt = 0L
    @Volatile private var followList: JSONArray = JSONArray()
    @Volatile private var followAt = 0L
    @Volatile private var followBusy = false
    @Volatile private var followDiskTried = false
    @Volatile private var followPeople: JSONArray = JSONArray()
    @Volatile private var followPeopleAt = 0L

    /** 固定大小线程池 + daemon 线程：请求都带超时，任务结束池一定 shutdown。 */
    internal fun <T, R> parallel(items: List<T>, workers: Int, fn: (T) -> R): List<R?> {
        if (items.isEmpty()) return emptyList()
        val n = minOf(workers, items.size)
        val pool = Executors.newFixedThreadPool(n) { r ->
            Thread(r, "bili-follow").apply { isDaemon = true }
        }
        try {
            val futures = items.map { item -> pool.submit(Callable { fn(item) }) }
            return futures.map { f ->
                try { f.get(40, TimeUnit.SECONDS) } catch (_: Exception) { null }
            }
        } finally {
            pool.shutdownNow()
        }
    }

    /** 关注接口：必须带 SESSDATA，否则 B 站会当成匿名并返回 -101。 */
    private fun followJson(url: String, referer: String): JSONObject {
        val sess = Store.cred("SESSDATA")
        if (sess.isEmpty()) throw RuntimeException("需要登录：设置页扫码登录后才能读关注列表")
        return getJson(url, referer, "SESSDATA=$sess")
    }

    /**
     * 全部关注的 uid（30 分钟缓存；翻页并发跑）。
     * 页数由第一页的 total 决定，不再写死上限；单页失败会退避重试，
     * 仍失败则整体抛错 —— 缺页 = 名单不完整，宁可沿用旧数据，也不能把残缺名单写进缓存。
     */
    fun followingUids(): List<String> {
        val now = System.currentTimeMillis()
        synchronized(followLock) {
            if (followUids.isNotEmpty() && now - followUidsAt < FOLLOW_UIDS_TTL) return followUids
        }
        val uid = selfUid()
        if (uid.isEmpty()) throw RuntimeException("需要登录：设置页扫码登录后才能读关注列表")
        val first = followJson("$FOLLOWING_API?vmid=$uid&pn=1&ps=$FOLLOW_PAGE", REFERER)
        if (first.optInt("code") != 0) {
            throw RuntimeException("关注列表 code=${first.optInt("code")} ${first.optString("message")}")
        }
        val data = first.optJSONObject("data") ?: JSONObject()
        val total = data.optInt("total", 0)
        val out = mutableListOf<String>()
        collectUids(data.optJSONArray("list"), out)
        val pages = minOf(maxOf(1, (total + FOLLOW_PAGE - 1) / FOLLOW_PAGE), FOLLOW_PAGE_MAX)
        if (total <= 0) {
            // 0 个关注是合法状态，不是错误
            synchronized(followLock) { followUids = emptyList(); followUidsAt = now }
            Diag.log("follow uids=0 (total=0)")
            return emptyList()
        }
        if (pages > 1) {
            val todo = (2..pages).toList()
            val got = parallel(todo, FOLLOW_WORKERS) { pn -> followPage(uid, pn) }
            val failed = todo.filterIndexed { i, _ -> got[i] == null }
            if (failed.isNotEmpty()) {
                throw RuntimeException("关注列表有 ${failed.size}/$pages 页取失败（" +
                        failed.take(5).joinToString("、") + "…）")
            }
            for (g in got) if (g != null) out.addAll(g)
        }
        val dedup = out.distinct()
        synchronized(followLock) {
            followUids = dedup
            followUidsAt = now
        }
        Diag.log("follow uids=${dedup.size} total=$total pages=$pages")
        return dedup
    }

    private fun collectUids(arr: JSONArray?, out: MutableList<String>) {
        if (arr == null) return
        for (i in 0 until arr.length()) {
            val u = arr.optJSONObject(i)?.optString("mid") ?: ""
            if (u.isNotEmpty()) out.add(u)
        }
    }

    /** 翻一页；失败重试 2 次（0.6s / 1.2s 退避），仍失败返回 null。 */
    private fun followPage(uid: String, pn: Int): List<String>? {
        for (attempt in 0..2) {
            try {
                val d = followJson("$FOLLOWING_API?vmid=$uid&pn=$pn&ps=$FOLLOW_PAGE", REFERER)
                if (d.optInt("code") != 0) {
                    Diag.log("follow page=$pn code=${d.optInt("code")}")
                    return null
                }
                val out = mutableListOf<String>()
                collectUids(d.optJSONObject("data")?.optJSONArray("list"), out)
                return out
            } catch (e: Exception) {
                Diag.log("follow page=$pn attempt=${attempt + 1} failed: ${human(e)}")
            }
            if (attempt < 2) {
                try { Thread.sleep(600L * (attempt + 1)) } catch (_: InterruptedException) { return null }
            }
        }
        return null
    }

    /**
     * 一批（最多 50 个 uid）的开播信息。返回 null 表示这一批失败 ——
     * 失败批次会让那一批里的在播主播整批消失，所以上层必须重试、最终整体报错。
     */
    private fun statusBatch(uids: List<String>): List<JSONObject>? {
        if (uids.isEmpty()) return emptyList()
        val q = uids.joinToString("&") { "uids[]=" + enc(it) }
        return try {
            val d = getJson("$LIVE_STATUS?$q", "https://live.bilibili.com/", sessCookie())
            if (d.optInt("code") != 0) {
                Diag.log("follow status code=${d.optInt("code")}")
                null
            } else {
                val data = d.optJSONObject("data") ?: return null
                val out = mutableListOf<JSONObject>()
                for (uid in uids) {
                    val info = data.optJSONObject(uid) ?: continue
                    out.add(JSONObject()
                        .put("mid", uid)
                        .put("uname", info.optString("uname").trim())
                        .put("face", info.optString("face").trim())
                        .put("room", info.optString("room_id"))
                        .put("title", info.optString("title"))
                        .put("area", info.optString("area_v2_name"))
                        .put("cover", info.optString("cover_from_user")
                            .ifEmpty { info.optString("keyframe") })
                        .put("online", info.optLong("online"))
                        .put("living", info.optInt("live_status") == 1)
                        .put("start", try { info.optLong("live_time") } catch (_: Exception) { 0L })
                        .put("added", false))
                }
                out
            }
        } catch (e: Exception) {
            Diag.log("follow status batch failed: ${human(e)}")
            null
        }
    }

    /** 全部 uid 的开播信息；每 50 个一批、并发 6，失败批次单独重试一次，仍有失败就整体报错。 */
    private fun fetchAllStatus(uids: List<String>): List<JSONObject>? {
        if (uids.isEmpty()) return emptyList()
        val batches = uids.chunked(FOLLOW_BATCH)
        val got = parallel(batches, FOLLOW_WORKERS) { statusBatch(it) }.toMutableList()
        for (i in got.indices) {
            if (got[i] == null) {
                try { Thread.sleep(400) } catch (_: InterruptedException) {}
                got[i] = statusBatch(batches[i])
            }
        }
        if (got.any { it == null }) {
            Diag.log("follow status: ${got.count { it == null }}/${batches.size} 批仍失败")
            return null
        }
        return got.filterNotNull().flatten()
    }

    /** 同步跑完整条链：名单 → 并发查开播 → 按人气排序。任一批失败即抛错。 */
    private fun fetchFollowingLive(): JSONArray {
        val uids = followingUids()
        if (uids.isEmpty()) return JSONArray()
        val status = fetchAllStatus(uids)
            ?: throw RuntimeException("开播状态有部分批次取失败（可能被限流）")
        val live = status.filter { it.optBoolean("living") && it.optString("room").isNotEmpty() }
            .sortedByDescending { it.optLong("online") }
        val arr = JSONArray()
        for (p in live) {
            // 只回前端真正用到的字段（与 Python 版 /api/following/live 对齐）
            arr.put(JSONObject()
                .put("mid", p.optString("mid"))
                .put("uname", p.optString("uname"))
                .put("face", p.optString("face"))
                .put("room", p.optString("room"))
                .put("title", p.optString("title"))
                .put("online", p.optLong("online")))
        }
        return arr
    }

    /**
     * 关注列表里正在直播的主播。缓存四层（与 Python 原版一致）：
     * ① 进程重启先读落盘缓存（24 小时内有效），第一次进监控室不用干等；
     * ② 两分钟内直接给，cached=true；
     * ③ 更旧就立刻给旧的 + 后台刷新（stale=true），用户不用对着「正在读取」等；
     * ④ 一份都没有才同步跑（冷启动 1~2 秒）。
     */
    fun followingLive(force: Boolean): JSONObject {
        val now = System.currentTimeMillis()
        ensureFollowDiskLoaded()
        val old = followList
        if (old.length() > 0 && !force) {
            if (now - followAt < FOLLOW_LIVE_TTL) {
                return JSONObject().put("list", old).put("cached", true)
            }
            val busy = kickFollowRefresh()
            return JSONObject().put("list", old).put("cached", true).put("stale", true)
                .put("age", ((now - followAt) / 1000).toInt()).put("refreshing", busy)
        }
        if (old.length() > 0 && force && followBusy) {
            // 后台已经在刷：再同步跑一轮只会白打一遍接口，还可能招风控
            return JSONObject().put("list", old).put("cached", true).put("stale", true)
                .put("refreshing", true).put("age", ((now - followAt) / 1000).toInt())
        }
        val t0 = System.currentTimeMillis()
        val live = try {
            fetchFollowingLive()
        } catch (e: Exception) {
            // 同步取失败：有旧数据就连同原因一起给前端（列表不清空、只标「刷新失败」）
            if (old.length() > 0) {
                return JSONObject().put("list", old).put("cached", true).put("stale", true)
                    .put("refreshing", false).put("age", ((now - followAt) / 1000).toInt())
                    .put("error", "刷新失败：${cut(human(e), 80)}")
            }
            throw e
        }
        storeFollowList(live)
        Diag.log("follow live=${live.length()} ms=${System.currentTimeMillis() - t0}")
        return JSONObject().put("list", live).put("ms", (System.currentTimeMillis() - t0).toInt())
    }

    /** 全部关注里**有直播间**的人（批量添加主播用）。get_status 不返回没直播间的账号。 */
    fun followingPeople(force: Boolean): JSONArray {
        val now = System.currentTimeMillis()
        synchronized(followLock) {
            if (!force && followPeople.length() > 0 && now - followPeopleAt < FOLLOW_PEOPLE_TTL) {
                return followPeople
            }
        }
        val uids = followingUids()
        if (uids.isEmpty()) return JSONArray()
        val status = fetchAllStatus(uids)
            ?: throw RuntimeException("关注资料有部分批次取失败，请稍后重试")
        val people = status.filter {
            val r = it.optString("room")
            r.isNotEmpty() && r != "0"
        }
        // 在播优先；没昵称的排最后（API 偶尔缺 uname，别让它占住列表顶部）
        val sorted = people.sortedWith(compareBy<JSONObject>(
            { !it.optBoolean("living") },
            { it.optString("uname").isEmpty() },
            { it.optString("uname") }
        ))
        val arr = JSONArray()
        for (p in sorted) arr.put(p)
        synchronized(followLock) {
            followPeople = arr
            followPeopleAt = now
        }
        return arr
    }

    private fun ensureFollowDiskLoaded() {
        if (followDiskTried) return
        synchronized(followLock) {
            if (followDiskTried) return
            followDiskTried = true
            val d = try { Store.readJson(FOLLOW_DISK) } catch (_: Exception) { null } ?: return
            val at = d.optLong("at", 0L)
            if (at <= 0L || System.currentTimeMillis() - at > FOLLOW_DISK_TTL) return
            val list = d.optJSONArray("list") ?: return
            if (list.length() == 0) return
            followList = list
            followAt = at
            val uidsAt = d.optLong("uids_at", 0L)
            if (uidsAt > 0L && System.currentTimeMillis() - uidsAt < FOLLOW_UIDS_TTL) {
                val ua = d.optJSONArray("uids") ?: JSONArray()
                val l = mutableListOf<String>()
                for (i in 0 until ua.length()) {
                    val u = ua.optString(i)
                    if (u.isNotEmpty()) l.add(u)
                }
                followUids = l
                followUidsAt = uidsAt
            }
            Diag.log("follow disk cache hit: ${list.length()} live")
        }
    }

    private fun storeFollowList(list: JSONArray) {
        val at = System.currentTimeMillis()
        val uidsSnapshot = synchronized(followLock) {
            followAt = at
            followList = list
            followUids.toList()
        }
        try {
            val ua = JSONArray()
            for (u in uidsSnapshot) ua.put(u)
            Store.writeJson(FOLLOW_DISK, JSONObject().put("at", at).put("list", list)
                .put("uids", ua).put("uids_at", followUidsAt))
        } catch (e: Exception) {
            Diag.log("follow disk save failed: ${e.message}")
        }
    }

    /** 后台刷新：同一时刻只跑一轮，失败就继续用旧数据。 */
    private fun kickFollowRefresh(): Boolean {
        synchronized(followLock) {
            if (followBusy) return false
            followBusy = true
        }
        Thread {
            try {
                val live = fetchFollowingLive()
                storeFollowList(live)
                Diag.log("follow bg refresh: ${live.length()} live")
            } catch (e: Exception) {
                Diag.log("follow bg refresh failed: ${human(e)}")
            } finally {
                synchronized(followLock) { followBusy = false }
            }
        }.apply { isDaemon = true; name = "follow-refresh"; start() }
        return true
    }

    // ---------------- 小工具 ----------------
    private fun human(e: Exception): String = e.message ?: e.javaClass.simpleName

    private fun cut(s: String, n: Int): String = if (s.length > n) s.substring(0, n) else s

    private fun requireCode(d: JSONObject, what: String) {
        val code = d.optInt("code", -1)
        if (code != 0) throw RuntimeException("$what 返回 code=$code ${d.optString("message")}")
    }

    /** 探测主播：按 UID 查名字 / 房间 / 头像 / 可回放来源。 */
    fun probe(midRaw: String): JSONObject {
        val mid = midRaw.trim()
        if (!mid.matches(Regex("\\d+"))) throw RuntimeException("UID 必须是纯数字（B站空间号）")
        val live = getJson(
            "https://api.live.bilibili.com/room/v1/Room/get_status_info_by_uids?uids[]=$mid",
            "https://live.bilibili.com/"
        )
        requireCode(live, "主播信息")
        val info = ((live.optJSONObject("data") ?: JSONObject()).optJSONObject(mid)) ?: JSONObject()
        if (info.length() == 0) throw RuntimeException("没查到 UID $mid，请确认是空间号")

        val cands = JSONArray()
        var suggested = ""
        var err = ""
        try {
            val found = discoverSeries(mid)
            val list = found.optJSONArray("candidates") ?: JSONArray()
            for (i in 0 until list.length()) cands.put(list.optJSONObject(i))
            suggested = found.optString("series_id")
        } catch (e: Exception) { err = e.message ?: "发现失败" }
        return JSONObject()
            .put("mid", mid)
            .put("name", info.optString("uname").trim())
            .put("room", info.optString("room_id"))
            .put("face", info.optString("face").trim())
            .put("living", info.optInt("live_status") == 1)
            .put("sources", cands)
            .put("suggested", suggested)
            .put("error", err)
    }

    /** 列出「合集和系列」，挑出回放那个来源（含全部候选）。 */
    private fun discoverSeries(mid: String): JSONObject {
        val d = getJson(
            "https://api.bilibili.com/x/polymer/web-space/seasons_series_list" +
                    "?mid=$mid&page_size=20&page_num=1&web_location=333.1387",
            "https://space.bilibili.com/$mid/lists"
        )
        requireCode(d, "系列列表")
        val items = ((d.optJSONObject("data") ?: JSONObject())
            .optJSONObject("items_lists") ?: JSONObject())
        val cands = JSONArray()
        for ((kind, key) in arrayOf("series" to "series_list", "season" to "seasons_list")) {
            val list = items.optJSONArray(key) ?: continue
            for (i in 0 until list.length()) {
                val it = list.optJSONObject(i) ?: continue
                val meta = it.optJSONObject("meta") ?: it
                val sid = meta.optString("series_id").ifEmpty { meta.optString("season_id") }
                    .ifEmpty { it.optString("id") }
                if (sid.isEmpty()) continue
                cands.put(JSONObject()
                    .put("id", sid)
                    .put("name", meta.optString("name").ifEmpty { it.optString("name") })
                    .put("total", meta.optInt("total").let { t -> if (t == 0) it.optInt("total") else t })
                    .put("kind", kind))
            }
        }
        if (cands.length() == 0) throw RuntimeException("这位主播的「合集和系列」里还没有内容")
        // 优先「回放/录播」，否则取条数最多的
        var best: JSONObject? = null
        var bestScore = -1
        for (i in 0 until cands.length()) {
            val c = cands.optJSONObject(i) ?: continue
            val n = c.optString("name")
            val replay = n.contains("回放") || n.contains("录播")
            val score = (if (replay) 1_000_000 else 0) + c.optInt("total")
            if (score > bestScore) { bestScore = score; best = c }
        }
        return JSONObject()
            .put("series_id", best!!.optString("id"))
            .put("candidates", cands)
    }

    /** 抓回放来源的全部投稿 bvid（分页）。 */
    private fun fetchArchives(mid: String, sid: String, kind: String): JSONArray {
        val items = JSONArray()
        var pn = 1
        while (true) {
            val (url, ref) = if (kind == "series")
                "$SERIES_ARCHIVES?mid=$mid&series_id=$sid&only_normal=true&sort=desc&pn=$pn&ps=$PAGE_SIZE" to
                        "https://space.bilibili.com/$mid/lists/$sid?type=series"
            else
                "$SEASON_ARCHIVES?mid=$mid&season_id=$sid&sort_reverse=false&page_num=$pn&page_size=$PAGE_SIZE" to
                        "https://space.bilibili.com/$mid/lists"
            val d = getJson(url, ref)
            requireCode(d, if (kind == "series") "系列" else "合集")
            val data = d.optJSONObject("data") ?: JSONObject()
            val arcs = data.optJSONArray("archives") ?: JSONArray()
            for (i in 0 until arcs.length()) arcs.optJSONObject(i)?.let { items.put(it) }
            val total = (data.optJSONObject("page") ?: JSONObject()).optInt("total")
            val done = arcs.length() == 0 || arcs.length() < PAGE_SIZE || (total > 0 && items.length() >= total)
            if (done) break
            pn++
            if (pn > 100) break
            TimeUnit.MILLISECONDS.sleep(350) // 翻页间隔，避免风控
        }
        return items
    }

    /** 构建回放清单：与 Python build_programs 同构（标题/PART/时长/封面）。 */
    fun buildPrograms(mid: String, sid: String, kindHint: String): JSONArray {
        var archives = JSONArray()
        var lastErr: Exception? = null
        val kinds = if (kindHint == "series" || kindHint == "season") listOf(kindHint) else listOf("series", "season")
        for (kind in kinds) {
            try {
                val a = fetchArchives(mid, sid, kind)
                if (a.length() > 0) { archives = a; break }
            } catch (e: Exception) { lastErr = lastErr ?: e }
        }
        if (archives.length() == 0) throw lastErr ?: RuntimeException("这个来源里没有任何投稿")

        val programs = JSONArray()
        for (i in 0 until archives.length()) {
            val a = archives.optJSONObject(i) ?: continue
            val bvid = a.optString("bvid")
            if (bvid.isEmpty()) continue
            try {
                val d = getJson("https://api.bilibili.com/x/web-interface/view?bvid=$bvid",
                    "https://www.bilibili.com/video/$bvid")
                if (d.optInt("code") != 0) continue
                val detail = d.optJSONObject("data") ?: continue
                val pages = detail.optJSONArray("pages") ?: JSONArray()
                var totalDur = 0L
                for (p in 0 until pages.length()) totalDur += pages.optJSONObject(p)?.optLong("duration") ?: 0
                if (totalDur <= 0) totalDur = 1
                val stat = detail.optJSONObject("stat") ?: JSONObject()
                val dm = stat.optInt("danmaku")
                val pubdate = detail.optLong("pubdate", (System.currentTimeMillis() / 1000L))
                val cover = toHttps(detail.optString("pic"))
                val parts = JSONArray()
                for (p in 0 until pages.length()) {
                    val pg = pages.optJSONObject(p) ?: continue
                    val dur = pg.optLong("duration")
                    parts.put(JSONObject()
                        .put("cid", pg.optString("cid"))
                        .put("page", pg.optInt("page"))
                        .put("part", pg.optString("part").ifEmpty { detail.optString("title") })
                        .put("duration", dur)
                        .put("dm_total", Math.round(dm * dur.toDouble() / totalDur)))
                }
                val dstr = java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.CHINA)
                    .format(java.util.Date(pubdate * 1000L))
                programs.put(JSONObject()
                    .put("bvid", bvid)
                    .put("aid", detail.optLong("aid"))
                    .put("title", detail.optString("title"))
                    .put("raw_title", detail.optString("title"))
                    .put("category", classify(detail.optString("title")))
                    .put("pubdate", pubdate)
                    .put("date", dstr)
                    .put("duration", totalDur)
                    .put("parts", parts)
                    .put("cover", cover)
                    .put("thumb", cover + "@320w_200h_1c.webp")
                    .put("url", "https://www.bilibili.com/video/$bvid")
                    .put("view", stat.optInt("view"))
                    .put("danmaku", dm)
                    .put("reply", stat.optInt("reply"))
                    .put("like", stat.optInt("like"))
                    .put("dm_total", dm))
            } catch (_: Exception) { /* 单个失败不影响整体 */ }
        }
        if (programs.length() == 0) throw RuntimeException("投稿详情一个都没取到，可能B站限流，请稍后重试")
        return programs
    }

    private fun classify(title: String): String = when {
        title.contains(Regex("歌|唱|音乐|弹唱")) -> "音乐"
        title.contains(Regex("游戏|PUBG|王者|吃鸡|原神|LOL")) -> "游戏"
        title.contains(Regex("闲聊|聊天|杂谈|深夜")) -> "闲聊"
        else -> "其他"
    }

    private fun toHttps(u: String): String = if (u.startsWith("http://")) "https://" + u.removePrefix("http://") else u

    /** 取 MP4 播放地址（fnval=1，与 Python 一致）。 */
    fun playUrl(bvid: String, cid: String, qn: Int): JSONObject {
        // 必须带登录 Cookie：匿名请求 B 站最高只给 720P（qn=64），带 SESSDATA 才放 1080P（qn=80）。
        // 未登录时不报错，B 站自动降到匿名可用档，真实档位由 accept 体现。
        val d = getJson(
            "https://api.bilibili.com/x/player/playurl?bvid=$bvid&cid=$cid&qn=$qn" +
                    "&fnval=1&fnver=0&fourk=0&platform=pc&high_quality=1",
            "https://www.bilibili.com/video/$bvid",
            sessCookie()
        )
        if (d.optInt("code") != 0) throw RuntimeException("B站返回 code=${d.optInt("code")} ${d.optString("message")}")
        val data = d.optJSONObject("data") ?: JSONObject()
        val durl = (data.optJSONArray("durl") ?: JSONArray()).optJSONObject(0) ?: JSONObject()
        val media = durl.optString("url")
        if (media.isEmpty()) throw RuntimeException("没有取到播放地址")
        val quality = data.optInt("quality")
        val accept = data.optJSONArray("accept_quality") ?: JSONArray()
        val acceptList = JSONArray()
        for (i in 0 until accept.length()) {
            val q = accept.optInt(i)
            acceptList.put(JSONObject().put("qn", q).put("desc", QN_DESC[q] ?: "$q"))
        }
        // accept_quality 偶尔缺失（老稿件/接口改版）：退回 support_formats 补齐，
        // 前端靠 accept 生成档位菜，空数组会让它只能自己兜底猜。
        if (acceptList.length() == 0) {
            val sf = data.optJSONArray("support_formats") ?: JSONArray()
            for (i in 0 until sf.length()) {
                val o = sf.optJSONObject(i) ?: continue
                val q = o.optInt("quality")
                if (q > 0) acceptList.put(JSONObject().put("qn", q)
                    .put("desc", o.optString("new_description").ifEmpty { QN_DESC[q] ?: "$q" }))
            }
        }
        return JSONObject()
            .put("media", media)
            .put("length", data.optLong("timelength"))
            .put("quality", quality)
            .put("qualityDesc", QN_DESC[quality] ?: "$quality")
            .put("accept", acceptList)
            .put("logged", hasSess())
    }

    /**
     * 发一条直播间弹幕。
     * 必须带 SESSDATA + bili_jct（csrf 就是 jct），只走 https。
     * B 站返回 code=0 才算成功；-101 未登录、-111 被禁言、-403 房间不对。
     */
    fun sendDanmaku(room: String, text: String): JSONObject {
        val jct = Store.cred("bili_jct")
        if (!hasSess() || jct.isEmpty()) throw RuntimeException("先扫码登录 B 站账号才能发弹幕")
        if (!room.matches(Regex("\\d+"))) throw RuntimeException("直播间号不合法")
        val msg = text.trim()
        if (msg.isEmpty()) throw RuntimeException("弹幕不能为空")
        if (msg.length > 20) throw RuntimeException("弹幕最多 20 个字")
        val url = "https://api.live.bilibili.com/msg/send"
        val form = "color=16777215&fontsize=25&mode=1&msg=" + enc(msg) +
                "&rnd=" + (System.currentTimeMillis() / 1000L) +
                "&roomid=" + enc(room) + "&bubble=0" +
                "&csrf=" + enc(jct) + "&csrf_token=" + enc(jct)
        val req = Request.Builder().url(url)
            .header("User-Agent", UA)
            .header("Referer", "https://live.bilibili.com/$room")
            .header("Origin", "https://live.bilibili.com")
            .header("Accept", "application/json, text/plain, */*")
            .header("Cookie", sessCookie())
            .post(form.toRequestBody(FORM_TYPE))
            .build()
        HTTP.newCall(req).execute().use { resp ->
            val code = resp.code
            if (code == 412) throw RuntimeException("B站暂时拒绝请求（风控限流），请稍后再试")
            if (code != 200) throw RuntimeException("HTTP $code")
            val d = JSONObject(resp.body?.string().orEmpty())
            val errno = d.optInt("code", -1)
            if (errno != 0) {
                val m = d.optString("message").ifEmpty { d.optString("msg") }
                throw RuntimeException(if (m.isEmpty()) "发送失败（code $errno）" else m)
            }
            return JSONObject().put("ok", true)
        }
    }

    // ==================== 7.1 视频弹幕发送 ====================

    /**
     * 发一条视频弹幕（`x/v2/dm/post`）。
     *
     * 上游要的是 `oid=aid`，而页面手上只有 bvid：先用 view 接口把 aid / 分P / 时长取回来，
     * 顺便校验「这个 cid 确实属于这个视频」。不查直接发的话，B 站只会回一个 -400，
     * 页面根本没法告诉用户错在哪。
     *
     * @param cid        分P 的 cid；传 0/空字符串 = 第一个分P
     * @param progressMs 弹幕出现的时间点（毫秒，B 站的时间轴单位）
     * @param mode       1 滚动 / 4 底部 / 5 顶部
     * @param durationMsHint 拿不到视频时长时的兜底（页面可以传当前 duration）
     * @return {"ok":true,"oid":..,"cid":..,"progress":..,"mode":..}
     */
    fun sendVideoDanmaku(
        bvid: String, cid: String, text: String,
        progressMs: Long, mode: Int, durationMsHint: Long = 0L
    ): JSONObject {
        // 未登录先在本地说清楚：让页面直接弹「扫码登录」，而不是透传 B 站的 code=-101
        if (!hasSess()) throw RuntimeException("需要先登录")
        val jct = Store.cred("bili_jct")
        if (jct.isEmpty()) throw RuntimeException("需要先登录")
        val bv = bvid.trim()
        if (!bv.matches(Regex("BV[0-9A-Za-z]{10}"))) throw RuntimeException("bvid 不合法")
        val msg = text.trim()
        if (msg.isEmpty()) throw RuntimeException("弹幕不能为空")
        // 按 code point 数，一条 emoji 不该被算成两三个字
        if (msg.codePointCount(0, msg.length) > 100) throw RuntimeException("弹幕最多 100 个字")

        val view = videoData(bv)          // 已带登录态，错误码在内部翻成人话
        val aid = view.optLong("aid", 0L)
        if (aid <= 0L) throw RuntimeException("取不到视频 aid，稍后再试")
        val pages = view.optJSONArray("pages") ?: JSONArray()
        val wantCid = cid.trim().ifEmpty { "0" }
        var cidOut = ""
        var durSec = view.optLong("duration", 0L)
        for (i in 0 until pages.length()) {
            val pg = pages.optJSONObject(i) ?: continue
            val pc = pg.optString("cid")
            if (wantCid == "0" && i == 0) {
                cidOut = pc
                durSec = pg.optLong("duration", durSec)
            } else if (wantCid != "0" && pc == wantCid) {
                cidOut = pc
                durSec = pg.optLong("duration", durSec)
            }
        }
        if (cidOut.isEmpty()) throw RuntimeException("这个 cid 不属于该视频")

        val durMs = if (durSec > 0) durSec * 1000 else durationMsHint
        var progress = progressMs.coerceAtLeast(0L)
        // 贴在片尾（progress == duration）会被 B 站判「超出视频时长」，留 0.5s 余量
        if (durMs > 0) progress = progress.coerceAtMost(maxOf(0L, durMs - 500))
        val md = mode.coerceIn(1, 9)

        val form = "type=1&oid=$aid&msg=" + enc(msg) +
            "&progress=$progress&color=16777215&fontsize=25&pool=0&mode=" + md +
            "&plat=2&csrf=" + enc(jct) + "&cid=" + enc(cidOut)
        val req = Request.Builder().url(DM_POST)
            .header("User-Agent", UA)
            .header("Referer", "https://www.bilibili.com/video/$bv")
            .header("Origin", "https://www.bilibili.com")
            .header("Accept", "application/json, text/plain, */*")
            .header("Cookie", sessCookie() + "; bili_jct=$jct")
            .post(form.toRequestBody(FORM_TYPE))
            .build()
        HTTP.newCall(req).execute().use { resp ->
            val code = resp.code
            if (code == 412) throw RuntimeException("B站暂时拒绝请求（风控限流），请稍后再试")
            if (code != 200) throw RuntimeException("HTTP $code")
            val d = JSONObject(resp.body?.string().orEmpty())
            val errno = d.optInt("code", -1)
            if (errno != 0) {
                // -101 未登录 / -111 csrf 失效 都会走到这里，errorText 已翻成人话
                throw RuntimeException(errorText(errno, d.optString("message")))
            }
            return JSONObject().put("ok", true).put("text", msg).put("oid", aid).put("cid", cidOut)
                .put("progress", progress).put("mode", md)
        }
    }

    // ==================== 7.0.0 新增接口 ====================
    // 这些函数一律在 LocalServer 的工作线程里被调用（不是主线程，也不是 250ms 采样线程）。
    // 约定：能返回结构化结果的就不要抛异常；必须抛的地方用「人话」，由 LocalServer 兜成 {error}。

    // ---------- wbi 签名（全项目唯一实现；LiveChat 的 getDanmuInfo 也复用它） ----------

    private val WBI_MIXIN = intArrayOf(
        46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
        27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
        37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
        22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52)

    @Volatile private var wbiMixKey = ""
    @Volatile private var wbiMixAt = 0L
    private val wbiMixLock = Any()

    /** wbi 密钥缓存时长：原来 6 小时，一天要重取 4 次；密钥一天内不会失效，拉到 12 小时。 */
    private const val WBI_TTL = 12 * 3600_000L

    /**
     * nav 匿名也会下发 wbi_img，所以未登录也能签。
     * 失败时把缓存清干净并立刻重取一次：网络抖动一下就回落未签名，代价比多打一个 nav 大得多。
     */
    private fun wbiKeys(): String {
        val now = System.currentTimeMillis()
        if (wbiMixKey.isNotEmpty() && now - wbiMixAt < WBI_TTL) return wbiMixKey
        synchronized(wbiMixLock) {
            if (wbiMixKey.isNotEmpty() && System.currentTimeMillis() - wbiMixAt < WBI_TTL) {
                return wbiMixKey
            }
            for (attempt in 0..1) {
                val k = fetchWbiKeys()
                if (k.isNotEmpty()) {
                    wbiMixKey = k
                    wbiMixAt = System.currentTimeMillis()
                    return k
                }
                wbiMixKey = ""
                wbiMixAt = 0L
                if (attempt == 1) break
            }
            return ""
        }
    }

    /** 取一次 nav 里的 wbi_img/sub_img 拼出 32 位混合密钥；任何问题都返回空串。 */
    private fun fetchWbiKeys(): String {
        return try {
            val d = getJson(NAV, "https://www.bilibili.com/", sessCookie())
            val wi = (d.optJSONObject("data") ?: JSONObject()).optJSONObject("wbi_img")
                ?: return ""
            val img = wi.optString("img_url").substringAfterLast('/').substringBefore('.')
            val sub = wi.optString("sub_url").substringAfterLast('/').substringBefore('.')
            val raw = img + sub
            val sb = StringBuilder(32)
            for (i in WBI_MIXIN) {
                if (i >= raw.length) continue
                sb.append(raw[i])
                if (sb.length == 32) break
            }
            if (sb.length < 32) return ""
            sb.toString()
        } catch (e: Exception) {
            Diag.log("wbi keys failed: ${human(e)}")
            ""
        }
    }

    /** 给 url 补 wts + w_rid。拿不到密钥时返回空串，调用方回落未签名地址（B 站通常仍给匿名结果）。 */
    fun wbiSigned(base: String, params: Map<String, String>): String {
        val key = wbiKeys()
        if (key.isEmpty()) return ""
        val p = LinkedHashMap(params)
        p["wts"] = (System.currentTimeMillis() / 1000).toString()
        val q = p.keys.sorted().joinToString("&") { k ->
            "$k=" + URLEncoder.encode(p[k] ?: "", "UTF-8")
        }
        val digest = MessageDigest.getInstance("MD5").digest((q + key).toByteArray(Charsets.UTF_8))
        val hex = StringBuilder(32)
        for (b in digest) {
            val v = b.toInt() and 0xFF
            if (v < 16) hex.append('0')
            hex.append(Integer.toHexString(v))
        }
        return "$base?$q&w_rid=$hex"
    }

    // ---------- 公共小工具（歌单 / 章节复用，避免各处重复拼 Cookie、重复造请求） ----------

    /** 带登录态 GET：7.0 的歌单/动态等接口统一走这里，别各自 new HttpURLConnection。 */
    fun sessionJson(url: String, referer: String, timeoutMs: Int = READ_TIMEOUT_MS): JSONObject =
        getJson(url, referer, sessCookie(), timeoutMs)

    /** 视频详情（view 接口的 data 对象）。 */
    fun videoData(bvid: String): JSONObject {
        if (!bvid.matches(Regex("BV[0-9A-Za-z]{10}"))) throw RuntimeException("bvid 不合法")
        val d = getJson("https://api.bilibili.com/x/web-interface/view?bvid=$bvid",
            "https://www.bilibili.com/video/$bvid", sessCookie())
        if (d.optInt("code", -1) != 0) {
            throw RuntimeException(errorText(d.optInt("code"), d.optString("message")))
        }
        return d.optJSONObject("data") ?: throw RuntimeException("B 站没有返回视频信息")
    }

    /** 跟随 https 跳转并返回最终地址（b23.tv 短链解析用）。 */
    fun resolveShortLink(url: String): String {
        val finalUrl = try {
            val req = Request.Builder().url(url).header("User-Agent", UA).get().build()
            // OkHttp 跟完跳转后会把最终的请求地址记在 response.request 里
            HTTP.newCall(req).execute().use { it.request.url.toString() }
        } catch (e: Exception) {
            throw RuntimeException("短链解析失败：${cut(human(e), 80)}")
        }
        if (finalUrl.isEmpty()) throw RuntimeException("短链解析失败：没有拿到地址")
        return finalUrl
    }

    fun toHttpsUrl(u: String): String = toHttps(u)

    /** B 站 code → 人话。7.0 新接口统一用它，避免前端看到「code=-352」这种机器话。 */
    private fun errorText(code: Int, message: String): String = when (code) {
        -101 -> "需要登录 B 站账号（设置页扫码登录后再试）"
        -352 -> "B 站风控拦截（-352），请稍后再试"
        -404, -403 -> "内容不存在、已删除或没有访问权限"
        -111 -> "操作被拒绝（csrf 校验失败），重新扫码登录一次"
        else -> "B 站返回 code=$code ${message}".trim()
    }

    // ---------- /api/live/brief ----------

    private const val BRIEF_TTL = 30_000L
    private val briefLock = Any()
    private val briefCache = HashMap<String, Pair<Long, JSONObject>>()

    /**
     * 顶栏用的直播简报：只走 get_info，开播与否**只看 live_status**。
     * 30 秒缓存；失败时有旧值给旧值 + stale，没有旧值也给空简报 + error，绝不抛给上层。
     */
    fun liveBrief(roomRaw: String): JSONObject {
        val room = roomRaw.trim()
        if (!room.matches(Regex("\\d+"))) throw RuntimeException("直播间号不合法")
        val now = System.currentTimeMillis()
        val cached = synchronized(briefLock) { briefCache[room] }
        if (cached != null && now - cached.first < BRIEF_TTL) return JSONObject(cached.second.toString())
        return try {
            val info = liveRoomInfo(room)
            val out = JSONObject()
                .put("room", info.optString("room_id").ifEmpty { room })
                .put("living", info.optBoolean("living"))
                .put("title", info.optString("title"))
                .put("cover", toHttps(info.optString("cover")))
                .put("online", info.optLong("online"))
                .put("area", info.optString("area"))
                .put("at", now / 1000L)
            synchronized(briefLock) {
                if (briefCache.size > 200) briefCache.clear()
                briefCache[room] = now to out
            }
            out
        } catch (e: Exception) {
            Diag.log("live brief failed room=$room: ${human(e)}")
            if (cached != null) {
                JSONObject(cached.second.toString()).put("stale", true)
                    .put("error", "刷新失败：${cut(human(e), 80)}")
            } else {
                JSONObject().put("room", room).put("living", false).put("title", "")
                    .put("cover", "").put("online", 0L)
                    .put("error", "取直播简报失败：${cut(human(e), 80)}")
            }
        }
    }

    // ---------- /api/live/emoticons ----------

    private const val LIVE_EMOTE_API =
        "https://api.live.bilibili.com/xlive/web-ucenter/v2/emoticon/GetEmoticons"
    private const val EMOTE_DISK_PREFIX = "emoticons_"
    private const val EMOTE_DISK_TTL = 12 * 60 * 60_000L

    private fun normalizeEmoteUrl(raw: String): String {
        var u = raw.trim()
        if (u.isEmpty()) return ""
        if (u.startsWith("//")) u = "https:$u"
        if (u.startsWith("http://")) u = "https://" + u.removePrefix("http://")
        // 只认 B 站自己的图：表情面板里的 url 会原样交给前端/以后发给 B 站，不能放第三方图
        val host = try { java.net.URI(u).host?.lowercase() ?: "" } catch (_: Exception) { "" }
        if (host != "hdslb.com" && !host.endsWith(".hdslb.com")) return ""
        return u
    }

    /**
     * 表情包归类：B 站没公开 pkg_type 的语义，所以**先按包名判**（线上包名是中文），
     * 名字缺失时才按常见取值兜底（1 通用 / 2 房间 / 3、5 UP 主大表情）。
     * 三个分类名固定成契约里的「通用 / UP主大表情 / 房间专属」。
     */
    private fun emoteCategory(name: String, type: Int): String {
        val n = name.lowercase()
        return when {
            n.contains("房间") || (n.contains("专属") && !n.contains("up")) -> "房间专属"
            n.contains("up主") || n.contains("粉丝团") ||
                (n.contains("up") && n.contains("大")) -> "UP主大表情"
            n.contains("通用") || n.contains("官方") -> "通用表情"
            type == 2 -> "房间专属"
            type == 3 || type == 5 -> "UP主大表情"
            else -> "通用表情"
        }
    }

    private fun buildEmotePacks(pkgs: JSONArray): JSONArray {
        val order = listOf("通用表情", "UP主大表情", "房间专属")
        val groups = LinkedHashMap<String, MutableList<JSONObject>>()
        order.forEach { groups[it] = mutableListOf() }
        val seen = HashSet<String>()
        for (i in 0 until pkgs.length()) {
            val p = pkgs.optJSONObject(i) ?: continue
            val cat = emoteCategory(p.optString("pkg_name"), p.optInt("pkg_type"))
            val ems = p.optJSONArray("emoticons") ?: continue
            for (j in 0 until ems.length()) {
                val e = ems.optJSONObject(j) ?: continue
                val unique = e.optString("emoticon_unique").trim()
                if (unique.isEmpty() || !seen.add(unique)) continue
                val url = normalizeEmoteUrl(e.optString("url"))
                if (url.isEmpty()) continue
                val name = e.optString("emoji").trim()
                    .ifEmpty { e.optString("descript").trim() }
                    .ifEmpty { unique }
                groups.getValue(cat).add(JSONObject()
                    .put("unique", unique)
                    .put("name", name)
                    .put("url", url)
                    .put("w", e.optInt("width"))
                    .put("h", e.optInt("height"))
                    .put("level", e.optInt("unlock_need_level")))
            }
        }
        val out = JSONArray()
        for (name in order) {
            val items = groups.getValue(name)
            if (items.isEmpty()) continue
            val arr = JSONArray()
            items.forEach { arr.put(it) }
            out.put(JSONObject().put("name", name).put("items", arr))
        }
        return out
    }

    /**
     * 当前直播间的表情包（GetEmoticons + wbi 签名），落盘缓存 12 小时。
     * 失败不抛：至少给 `{packs:[], error}`，面板不该整块空掉；有旧缓存就带 stale 返回。
     */
    fun liveEmoticons(roomRaw: String, force: Boolean = false): JSONObject {
        val room = roomRaw.trim()
        if (!room.matches(Regex("\\d+"))) throw RuntimeException("直播间号不合法")
        val diskName = "$EMOTE_DISK_PREFIX$room.json"
        val now = System.currentTimeMillis()
        val cached = try { Store.readJson(diskName) } catch (_: Exception) { null }
        val cachedPacks = cached?.optJSONArray("packs")?.length() ?: 0
        if (!force && cached != null && cachedPacks > 0 &&
            now - cached.optLong("at", 0L) < EMOTE_DISK_TTL) {
            return JSONObject(cached.toString())
        }
        try {
            val signed = wbiSigned(LIVE_EMOTE_API, linkedMapOf("platform" to "pc", "room_id" to room))
            val url = signed.ifEmpty { "$LIVE_EMOTE_API?platform=pc&room_id=$room" }
            val d = getJson(url, "https://live.bilibili.com/$room", sessCookie())
            val code = d.optInt("code", -1)
            if (code != 0) throw RuntimeException(errorText(code, d.optString("message")))
            val pkgs = (d.optJSONObject("data") ?: JSONObject()).optJSONArray("data") ?: JSONArray()
            val packs = buildEmotePacks(pkgs)
            if (packs.length() == 0) throw RuntimeException("B 站没有返回可用的表情")
            val out = JSONObject().put("room", room).put("packs", packs)
                .put("at", now).put("source", "bili")
            try { Store.writeJsonAtomic(diskName, out) } catch (_: Exception) {}
            return out
        } catch (e: Exception) {
            Diag.log("live emoticons failed room=$room: ${human(e)}")
            if (cached != null && cachedPacks > 0) {
                return JSONObject(cached.toString()).put("stale", true)
                    .put("error", "刷新失败：${cut(human(e), 80)}")
            }
            return JSONObject().put("room", room).put("packs", JSONArray())
                .put("source", "none").put("error", human(e))
        }
    }

    // ---------- /api/dynamic ----------

    private const val DYN_SPACE = "https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space"
    private const val DYN_TTL_OK = 5 * 60_000L
    private const val DYN_TTL_FAIL = 60_000L
    private val dynLock = Any()
    private val dynCache = HashMap<String, Pair<Long, JSONObject>>()   // "mid|page" → 响应
    private val dynOffset = HashMap<String, String>()                  // "mid|page" → 请求该页用的游标

    /**
     * 空间动态（polymer feed/space）。B 站只给 offset 游标、不给页码，
     * 所以 page>1 时用「游标链」：前一页响应里的 offset 就是下一页的入参，逐页走一遍并缓存。
     */
    fun dynamicFeed(midRaw: String, pageRaw: Int, force: Boolean = false): JSONObject {
        val mid = midRaw.trim()
        if (!mid.matches(Regex("\\d+"))) throw RuntimeException("缺少主播 UID")
        val page = pageRaw.coerceIn(1, 50)
        val key = "$mid|$page"
        val now = System.currentTimeMillis()
        if (!force) {
            val hit = synchronized(dynLock) { dynCache[key] }
            if (hit != null) {
                val ttl = if (hit.second.has("error")) DYN_TTL_FAIL else DYN_TTL_OK
                if (now - hit.first < ttl) return JSONObject(hit.second.toString())
            }
        }
        // 实测匿名一律 -352：不如直接给人话，省一次风控命中
        if (!hasSess()) {
            return JSONObject().put("mid", mid).put("page", page).put("items", JSONArray())
                .put("error", "空间动态需要登录 B 站账号（设置页扫码登录后再试）")
        }
        return try {
            val offset = dynamicOffsetOf(mid, page)
            val d = fetchDynamicPage(mid, offset)
            val code = d.optInt("code", -1)
            if (code != 0) {
                val out = JSONObject().put("mid", mid).put("page", page).put("items", JSONArray())
                    .put("error", errorText(code, d.optString("message")))
                rememberDynamic(key, now, out)
                return out
            }
            val data = d.optJSONObject("data") ?: JSONObject()
            val items = mapDynamicItems(data.optJSONArray("items"))
            val next = data.optString("offset").trim()
            synchronized(dynLock) {
                dynOffset["$mid|${page + 1}"] = next
                if (dynOffset.size > 400) dynOffset.clear()
            }
            val out = JSONObject().put("mid", mid).put("page", page)
                .put("items", items).put("has_more", next.isNotEmpty())
            rememberDynamic(key, now, out)
            out
        } catch (e: Exception) {
            Diag.log("dynamic failed mid=$mid page=$page: ${human(e)}")
            val out = JSONObject().put("mid", mid).put("page", page).put("items", JSONArray())
                .put("error", "取空间动态失败：${cut(human(e), 100)}")
            rememberDynamic(key, now, out)
            out
        }
    }

    private fun rememberDynamic(key: String, at: Long, out: JSONObject) {
        synchronized(dynLock) {
            if (dynCache.size > 120) dynCache.clear()
            dynCache[key] = at to JSONObject(out.toString())
        }
    }

    private fun fetchDynamicPage(mid: String, offset: String): JSONObject {
        var url = "$DYN_SPACE?host_mid=$mid&timezone_offset=-480&platform=web"
        if (offset.isNotEmpty()) url += "&offset=" + enc(offset)
        // 不要加 &features=itemOpusStyle：加了 B 站会改回 opus 结构，与下面的解析对不上
        return getJson(url, "https://space.bilibili.com/$mid", sessCookie(), 25_000)
    }

    /** 求第 page 页的 offset：已知就用缓存，不知道就把前面的页走一遍（顺手缓存游标）。 */
    private fun dynamicOffsetOf(mid: String, page: Int): String {
        if (page <= 1) return ""
        var off = ""
        for (p in 1 until page) {
            val known = synchronized(dynLock) { dynOffset["$mid|${p + 1}"] }
            if (known != null) {
                if (known.isEmpty()) throw RuntimeException("已经到最后一页了")
                off = known
                continue
            }
            val raw = fetchDynamicPage(mid, off)
            val code = raw.optInt("code", -1)
            if (code != 0) throw RuntimeException(errorText(code, raw.optString("message")))
            val next = (raw.optJSONObject("data") ?: JSONObject()).optString("offset").trim()
            synchronized(dynLock) { dynOffset["$mid|${p + 1}"] = next }
            if (next.isEmpty()) throw RuntimeException("已经到最后一页了")
            off = next
        }
        return off
    }

    private fun mapDynamicItems(arr: JSONArray?): JSONArray {
        val out = JSONArray()
        if (arr == null) return out
        for (i in 0 until arr.length()) {
            val it = arr.optJSONObject(i) ?: continue
            val mods = it.optJSONObject("modules") ?: JSONObject()
            val au = mods.optJSONObject("module_author") ?: JSONObject()
            val dy = mods.optJSONObject("module_dynamic") ?: JSONObject()
            val major = dy.optJSONObject("major") ?: JSONObject()
            val type = it.optString("type")
            val id = (it.optJSONObject("basic") ?: JSONObject()).optString("comment_id_str")
                .ifEmpty { it.optString("id_str") }
            var kind = "dynamic"
            var text = (dy.optJSONObject("desc") ?: JSONObject()).optString("text")
            var cover = ""
            var url = if (id.isEmpty()) "" else "https://t.bilibili.com/$id"
            when (type) {
                "DYNAMIC_TYPE_AV" -> {
                    kind = "video"
                    val arch = major.optJSONObject("archive")
                    if (arch != null) {
                        if (text.isEmpty()) text = arch.optString("title")
                        cover = toHttps(arch.optString("cover"))
                        val bv = arch.optString("bvid")
                        url = arch.optString("jump_url").ifEmpty {
                            if (bv.isNotEmpty()) "https://www.bilibili.com/video/$bv" else url
                        }
                    }
                }
                "DYNAMIC_TYPE_LIVE", "DYNAMIC_TYPE_LIVE_RCMD" -> {
                    kind = "live"
                    // live_rcmd.content 是「一段 JSON 字符串」，解析失败就当没有
                    val content = try {
                        JSONObject(major.optJSONObject("live_rcmd")?.optString("content") ?: "")
                    } catch (_: Exception) { JSONObject() }
                    val lp = content.optJSONObject("live_play_info") ?: JSONObject()
                    if (text.isEmpty()) text = lp.optString("title")
                    cover = toHttps(lp.optString("cover"))
                    url = lp.optString("link").ifEmpty {
                        val rid = lp.optString("room_id")
                        if (rid.isNotEmpty()) "https://live.bilibili.com/$rid" else url
                    }
                }
                else -> {
                    val draw = major.optJSONObject("draw")?.optJSONArray("items")
                    if (draw != null && draw.length() > 0) {
                        cover = toHttps(draw.optJSONObject(0)?.optString("src") ?: "")
                    }
                    val art = major.optJSONObject("article")
                    if (art != null) {
                        if (cover.isEmpty()) {
                            cover = toHttps(art.optJSONArray("covers")?.optString(0) ?: "")
                        }
                        url = art.optString("jump_url").ifEmpty { url }
                    }
                }
            }
            // 转发动态本身常常只有一句话：正文/图取被转内容兜底，卡片才不至于全空
            val orig = it.optJSONObject("orig")
            if (orig != null) {
                val ody = (orig.optJSONObject("modules") ?: JSONObject())
                    .optJSONObject("module_dynamic") ?: JSONObject()
                if (text.isEmpty()) text = (ody.optJSONObject("desc") ?: JSONObject()).optString("text")
                if (cover.isEmpty()) {
                    cover = toHttps(ody.optJSONObject("major")?.optJSONObject("draw")
                        ?.optJSONArray("items")?.optJSONObject(0)?.optString("src") ?: "")
                }
            }
            val stat = mods.optJSONObject("module_stat") ?: JSONObject()
            out.put(JSONObject()
                .put("id", id)
                .put("at", au.optLong("pub_ts"))
                .put("kind", kind)
                .put("text", text)
                .put("cover", cover)
                .put("url", url)
                .put("stat", JSONObject()
                    .put("like", stat.optJSONObject("like")?.optInt("count") ?: 0)
                    .put("comment", stat.optJSONObject("comment")?.optInt("count") ?: 0)))
        }
        return out
    }

    // ---------- /api/chapters ----------

    private const val PLAYER_V2 = "https://api.bilibili.com/x/player/v2"
    private const val PLAYER_WBI_V2 = "https://api.bilibili.com/x/player/wbi/v2"
    private val chapterLock = Any()
    private val chapterCache = HashMap<String, Pair<Long, JSONObject>>()

    /**
     * 视频章节（view_points）。优先 wbi 版 player 接口，失败回落老的 player/v2。
     * 契约要求「取不到返回空数组而不是报错」，所以这里永远给 points，错误只放在 error 字段里。
     */
    fun chapters(bvidRaw: String, cidRaw: String): JSONObject {
        val bvid = bvidRaw.trim()
        val empty = JSONObject().put("points", JSONArray())
        if (!bvid.matches(Regex("BV[0-9A-Za-z]{10}"))) {
            return empty.put("error", "bvid 不合法")
        }
        var cid = cidRaw.trim()
        if (!cid.matches(Regex("\\d{1,20}"))) {
            // 只给了 bvid：用 view 接口取第一个分P 的 cid（章节只对当前分P 有意义）
            cid = try {
                val data = videoData(bvid)
                data.optString("cid").ifEmpty {
                    data.optJSONArray("pages")?.optJSONObject(0)?.optString("cid") ?: ""
                }
            } catch (_: Exception) { "" }
        }
        if (!cid.matches(Regex("\\d{1,20}"))) return empty.put("error", "缺少 cid")
        val key = "$bvid|$cid"
        val now = System.currentTimeMillis()
        val hit = synchronized(chapterLock) { chapterCache[key] }
        if (hit != null && now - hit.first < 10 * 60_000L) return JSONObject(hit.second.toString())

        var points = JSONArray()
        var err = ""
        try {
            val signed = wbiSigned(PLAYER_WBI_V2, linkedMapOf("bvid" to bvid, "cid" to cid))
            if (signed.isNotEmpty()) points = fetchChapters(signed, bvid)
        } catch (e: Exception) {
            err = human(e)
        }
        if (points.length() == 0) {
            try {
                points = fetchChapters("$PLAYER_V2?bvid=$bvid&cid=$cid", bvid)
            } catch (e: Exception) {
                if (err.isEmpty()) err = human(e)
            }
        }
        val out = JSONObject().put("points", points)
        if (err.isNotEmpty()) out.put("error", "取章节失败：${cut(err, 100)}")
        synchronized(chapterLock) {
            if (chapterCache.size > 300) chapterCache.clear()
            chapterCache[key] = now to JSONObject(out.toString())
        }
        return out
    }

    private fun fetchChapters(url: String, bvid: String): JSONArray {
        val d = getJson(url, "https://www.bilibili.com/video/$bvid", sessCookie())
        val code = d.optInt("code", -1)
        if (code != 0) throw RuntimeException(errorText(code, d.optString("message")))
        val vp = (d.optJSONObject("data") ?: JSONObject()).optJSONArray("view_points")
            ?: return JSONArray()
        val rows = ArrayList<JSONObject>()
        for (i in 0 until vp.length()) {
            val p = vp.optJSONObject(i) ?: continue
            rows.add(JSONObject()
                .put("from", p.optInt("from"))
                .put("to", p.optInt("to"))
                .put("content", p.optString("content")))
        }
        rows.sortBy { it.optInt("from") }
        val out = JSONArray()
        rows.forEach { out.put(it) }
        return out
    }
}
