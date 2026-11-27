package com.replayradio.app

import org.json.JSONArray
import org.json.JSONObject

/**
 * 歌单（7.0.0）：把 B 站「合集 / 收藏夹 / 分P / 单视频」链接解析成曲目，落盘 filesDir/playlists.json。
 *
 * 设计取舍：
 *  · 只认 B 站公开接口（view / fav/resource/list），不绕风控、不爬 HTML；
 *  · 条目唯一键是 **cid**（合集内多P时同一 bvid 下有多首歌，只按 bvid 会互相串），
 *    没有 cid 时才退回 bvid+pN；
 *  · 重复导入同一张歌单 = 更新：源里已消失的旧条目**保留**，用户数据不该因为作者删稿而丢；
 *  · 解析/网络失败一律抛「人话」，由 LocalServer 兜成 {error}，绝不把未捕获异常漏到连接上。
 */
object Playlist {
    private const val FILE = "playlists.json"
    private const val MAX_ITEMS = 800            // 防呆：超大合集先截断，别把页面拖死
    private const val FAV_API = "https://api.bilibili.com/x/v3/fav/resource/list"
    private const val REFERER_SPACE = "https://space.bilibili.com/"
    private const val BV_RE = "BV[0-9A-Za-z]{10}"
    private val bvRegex = Regex(BV_RE)
    private val lock = Any()

    private class Built(val items: List<JSONObject>, val kind: String,
                        val seasonId: String, val name: String, val cover: String)

    private class FavFetch(val items: List<JSONObject>, val cover: String, val author: String)

    // ---------------- 读写 ----------------

    private fun doc(): JSONObject {
        val d = try { Store.readJson(FILE) } catch (_: Exception) { null }
        if (d == null || d.optJSONArray("lists") == null) {
            return JSONObject().put("version", 1).put("lists", JSONArray())
        }
        return d
    }

    private fun listsOf(d: JSONObject): MutableList<JSONObject> {
        val out = mutableListOf<JSONObject>()
        val arr = d.optJSONArray("lists") ?: return out
        for (i in 0 until arr.length()) arr.optJSONObject(i)?.let { out.add(it) }
        return out
    }

    private fun save(d: JSONObject) {
        d.put("version", 1)
        Store.writeJsonAtomic(FILE, d)
    }

    // ---------------- 接口 ----------------

    /** GET /api/playlists */
    fun list(): JSONObject {
        val rows = synchronized(lock) { listsOf(doc()) }
            .sortedByDescending { it.optLong("updated") }
        val arr = JSONArray()
        for (pl in rows) {
            val items = pl.optJSONArray("items") ?: JSONArray()
            arr.put(JSONObject()
                .put("id", pl.optString("id"))
                .put("name", pl.optString("name"))
                .put("count", items.length())
                .put("tags", pl.optJSONArray("tags") ?: JSONArray())
                .put("cover", pl.optString("cover"))
                .put("updated", pl.optLong("updated")))
        }
        return JSONObject().put("lists", arr)
    }

    /** GET /api/playlist?id= */
    fun get(idRaw: String): JSONObject? {
        val id = idRaw.trim()
        if (id.isEmpty()) return null
        val pl = synchronized(lock) {
            listsOf(doc()).firstOrNull { it.optString("id") == id }?.let { JSONObject(it.toString()) }
        } ?: return null
        val arr = JSONArray()
        val items = pl.optJSONArray("items") ?: JSONArray()
        for (i in 0 until items.length()) {
            val it = items.optJSONObject(i) ?: continue
            // 只暴露契约里的六个字段（page 等内部字段不出去，前端不需要也不该依赖）
            arr.put(JSONObject()
                .put("bvid", it.optString("bvid"))
                .put("cid", it.optString("cid"))
                .put("title", it.optString("title"))
                .put("author", it.optString("author"))
                .put("cover", it.optString("cover"))
                .put("dur", it.optLong("dur")))
        }
        return JSONObject()
            .put("id", pl.optString("id"))
            .put("name", pl.optString("name"))
            .put("items", arr)
    }

    /** POST /api/playlist/delete {id} */
    fun delete(idRaw: String): Boolean {
        val id = idRaw.trim()
        if (id.isEmpty()) return false
        synchronized(lock) {
            val d = doc()
            val rows = listsOf(d)
            val idx = rows.indexOfFirst { it.optString("id") == id }
            if (idx < 0) return false
            rows.removeAt(idx)
            val arr = JSONArray()
            rows.forEach { arr.put(it) }
            d.put("lists", arr)
            save(d)
            return true
        }
    }

    /** POST /api/playlist/import {url} */
    fun importUrl(rawUrl: String): JSONObject {
        val url = rawUrl.trim()
        if (url.isEmpty()) throw RuntimeException("请先粘贴 B 站合集 / 收藏夹 / 分P / 视频链接")
        val fav = favId(url)
        if (fav.isNotEmpty()) {
            // 网络请求必须在锁外：一次收藏夹导入要翻很多页，占着锁会把其它歌单操作全堵死
            val fetched = fetchFav(fav)
            return saveEntry("f$fav", "收藏夹 $fav", "收藏夹", url,
                fetched.items, fetched.cover, fetched.author, keepExistingName = true)
        }
        val bvid = resolveBvid(url)
        val data = BiliApi.videoData(bvid)
        val built = entries(data)
        val title = data.optString("title")
        val name = if (built.seasonId.isNotEmpty()) built.name else title.ifEmpty { built.name }
        val owner = (data.optJSONObject("owner") ?: JSONObject()).optString("name")
        val id = if (built.seasonId.isNotEmpty()) "s${built.seasonId}" else "b$bvid"
        return saveEntry(id, name, built.kind, url, built.items, built.cover, owner,
            keepExistingName = false)
    }

    // ---------------- 保存 / 合并 ----------------

    private fun saveEntry(id: String, fallbackName: String, kind: String, url: String,
                          items: List<JSONObject>, cover: String, extraTag: String,
                          keepExistingName: Boolean): JSONObject {
        synchronized(lock) {
            val d = doc()
            val rows = listsOf(d)
            val old = rows.firstOrNull { it.optString("id") == id }
            val merged = merge(old?.optJSONArray("items"), items)
            var name = if (keepExistingName) old?.optString("name") ?: "" else ""
            if (name.isEmpty()) name = fallbackName.ifEmpty { "未命名歌单" }
            val tags = JSONArray().put(kind)
            if (extraTag.isNotEmpty() && extraTag != name) tags.put(extraTag)
            var useCover = cover
            if (useCover.isEmpty()) useCover = merged.first.optJSONObject(0)?.optString("cover") ?: ""
            val entry = JSONObject()
                .put("id", id)
                .put("name", name)
                .put("kind", kind)
                .put("url", url)
                .put("updated", System.currentTimeMillis() / 1000L)
                .put("cover", useCover)
                .put("tags", tags)
                .put("items", merged.first)
            if (old != null) rows[rows.indexOf(old)] = entry else rows.add(entry)
            val arr = JSONArray()
            rows.forEach { arr.put(it) }
            d.put("lists", arr)
            save(d)
            return JSONObject().put("ok", true).put("id", id).put("name", name)
                .put("count", merged.first.length()).put("added", merged.second)
                .put("updated", old != null).put("kind", kind)
        }
    }

    /** 新条目在前；旧条目里源已没有的，保留在末尾（不能因为作者删稿丢掉用户数据）。 */
    private fun merge(old: JSONArray?, items: List<JSONObject>): Pair<JSONArray, Int> {
        val prev = HashMap<String, JSONObject>()
        if (old != null) {
            for (i in 0 until old.length()) {
                val o = old.optJSONObject(i) ?: continue
                prev[keyOf(o)] = o
            }
        }
        val out = JSONArray()
        val seen = HashSet<String>()
        var added = 0
        for (it in items) {
            val k = keyOf(it)
            if (!seen.add(k)) continue
            val o = prev[k]
            if (o != null) it.put("page", o.optInt("page", it.optInt("page", 1))) else added++
            out.put(it)
        }
        if (old != null) {
            for (i in 0 until old.length()) {
                val o = old.optJSONObject(i) ?: continue
                if (seen.add(keyOf(o))) out.put(o)
            }
        }
        return out to added
    }

    private fun keyOf(it: JSONObject): String {
        val cid = it.optString("cid")
        if (cid.isNotEmpty()) return "c$cid"
        return it.optString("bvid") + "p" + it.optInt("page", 1)
    }

    // ---------------- 解析视频 / 合集 / 分P ----------------

    /**
     * 条目来源优先级：合集（ugc_season）> 多P（pages）> 单个视频。
     *
     * ⚠️ 合集条目自己可能又是多P视频（一期歌切里十几个分P），内层 pages 才是单曲；
     *    只看合集条目的 page/cid 会把每期压成一首，所以内层 >1 个分P 时必须展开。
     */
    private fun entries(data: JSONObject): Built {
        val items = mutableListOf<JSONObject>()
        var cover = BiliApi.toHttpsUrl(data.optString("pic"))
        var name = data.optString("title")
        val owner = (data.optJSONObject("owner") ?: JSONObject()).optString("name")
        val ugc = data.optJSONObject("ugc_season")
        if (ugc != null) {
            val seasonId = ugc.optString("id")
            name = ugc.optString("title").ifEmpty { name }
            // 合集自己的封面比「某一期的封面」更能代表整张歌单
            val ugcCover = BiliApi.toHttpsUrl(ugc.optString("cover"))
            if (ugcCover.isNotEmpty()) cover = ugcCover
            val upName = (ugc.optJSONObject("upper") ?: JSONObject()).optString("name").ifEmpty { owner }
            val sections = ugc.optJSONArray("sections") ?: JSONArray()
            for (si in 0 until sections.length()) {
                val eps = sections.optJSONObject(si)?.optJSONArray("episodes") ?: continue
                for (ei in 0 until eps.length()) {
                    val e = eps.optJSONObject(ei) ?: continue
                    val bvid = e.optString("bvid")
                    if (bvid.isEmpty()) continue
                    val arc = e.optJSONObject("arc") ?: JSONObject()
                    val epTitle = e.optString("title").ifEmpty { arc.optString("title") }
                    val pic = BiliApi.toHttpsUrl(arc.optString("pic"))
                    if (cover.isEmpty() && pic.isNotEmpty()) cover = pic
                    // 合集条目的作者字段是 arc.author（实测没有 arc.owner），再回落到合集 UP / 视频 UP
                    val author = (arc.optJSONObject("owner") ?: JSONObject()).optString("name")
                        .ifEmpty { (arc.optJSONObject("author") ?: JSONObject()).optString("name") }
                        .ifEmpty { upName }
                    val pgRaw = e.opt("page")
                    val pg = pgRaw as? JSONObject
                    val inner = e.optJSONArray("pages")
                    if (inner != null && inner.length() > 1) {
                        val pref = Regex("^[【\\[]([^】\\]]+)[】\\]]").find(epTitle)
                            ?.groupValues?.get(1) ?: ""
                        for (pi in 0 until inner.length()) {
                            val p = inner.optJSONObject(pi) ?: continue
                            val cid = p.optString("cid")
                            if (cid.isEmpty()) continue
                            val part = stripIndex(p.optString("part")).ifEmpty { epTitle }
                            items.add(item(bvid, cid, p.optInt("page", pi + 1),
                                if (pref.isNotEmpty()) "【$pref】$part" else part,
                                author, pic, p.optLong("duration")))
                        }
                    } else {
                        val one = if (inner != null && inner.length() > 0) inner.optJSONObject(0) else null
                        val cid = e.optString("cid")
                            .ifEmpty { pg?.optString("cid") ?: "" }
                            .ifEmpty { one?.optString("cid") ?: "" }
                        if (cid.isEmpty()) continue
                        var dur = pg?.optLong("duration") ?: 0L
                        if (dur <= 0L) dur = one?.optLong("duration") ?: 0L
                        if (dur <= 0L) dur = arc.optLong("duration")
                        val page = pg?.optInt("page", 1)
                            ?: (pgRaw as? Number)?.toInt() ?: 1
                        items.add(item(bvid, cid, page, epTitle, author, pic, dur))
                    }
                }
            }
            if (items.isNotEmpty()) return Built(items, "合集", seasonId, name, cover)
        }

        val bvid = data.optString("bvid")
        val pages = data.optJSONArray("pages") ?: JSONArray()
        if (pages.length() > 1) {
            for (i in 0 until pages.length()) {
                val p = pages.optJSONObject(i) ?: continue
                val cid = p.optString("cid")
                if (cid.isEmpty()) continue
                items.add(item(bvid, cid, p.optInt("page", i + 1),
                    p.optString("part").ifEmpty { data.optString("title") },
                    owner, cover, p.optLong("duration")))
            }
            if (items.isNotEmpty()) return Built(items, "分P", "", name, cover)
        }

        val cid = data.optString("cid").ifEmpty { pages.optJSONObject(0)?.optString("cid") ?: "" }
        if (cid.isEmpty()) throw RuntimeException("这个视频没有可播放的分P")
        var dur = data.optLong("duration")
        if (dur <= 0L) dur = pages.optJSONObject(0)?.optLong("duration") ?: 0L
        items.add(item(bvid, cid, 1, data.optString("title"), owner, cover, dur))
        return Built(items, "单视频", "", name, cover)
    }

    private fun item(bvid: String, cid: String, page: Int, title: String,
                     author: String, cover: String, dur: Long): JSONObject =
        JSONObject()
            .put("bvid", bvid)
            .put("cid", cid)
            .put("page", if (page > 0) page else 1)
            .put("title", title)
            .put("author", author)
            .put("cover", cover)
            .put("dur", if (dur > 0) dur else 0L)

    /** 剥掉分P名常见的序号前缀：`001_歌名` / `01-歌名` / `3. 歌名`（必须带分隔符，免得削掉「01年的夏天」）。 */
    private fun stripIndex(part: String): String {
        val s = part.trim()
        if (s.isEmpty()) return s
        val stripped = s.replaceFirst(Regex("^\\d{1,3}\\s*[_\\-.\u3001]\\s*"), "")
        return stripped.ifEmpty { s }
    }

    // ---------------- 收藏夹 ----------------

    private fun favId(raw: String): String {
        Regex("[?&]fid=(\\d+)").find(raw)?.let { return it.groupValues[1] }
        val s = raw.trim()
        if (s.lowercase().startsWith("fav:")) {
            Regex("^fav:(\\d+)$", RegexOption.IGNORE_CASE).find(s)?.let { return it.groupValues[1] }
        }
        return ""
    }

    private fun fetchFav(fid: String): FavFetch {
        val rows = mutableListOf<JSONObject>()
        var cover = ""
        var author = ""
        var pn = 1
        while (rows.size < MAX_ITEMS) {
            val d = BiliApi.sessionJson(
                "$FAV_API?media_id=$fid&pn=$pn&ps=20&platform=web", REFERER_SPACE, 20_000)
            val code = d.optInt("code", -1)
            if (code != 0) {
                if (pn == 1) {
                    throw RuntimeException("取收藏夹失败：code=$code ${d.optString("message")}"
                        .trim() + "（私密收藏夹需要先在设置页登录 B 站）")
                }
                break
            }
            val data = d.optJSONObject("data") ?: break
            val info = data.optJSONObject("info") ?: JSONObject()
            if (cover.isEmpty()) cover = BiliApi.toHttpsUrl(info.optString("cover"))
            if (author.isEmpty()) {
                author = (info.optJSONObject("upper") ?: JSONObject()).optString("name")
            }
            val medias = data.optJSONArray("medias") ?: break
            if (medias.length() == 0) break
            for (i in 0 until medias.length()) {
                val m = medias.optJSONObject(i) ?: continue
                val bv = m.optString("bvid")
                if (bv.isEmpty()) continue        // 图文 / 番剧：没有 bvid
                rows.add(JSONObject()
                    .put("bvid", bv)
                    .put("title", m.optString("title"))
                    .put("author", (m.optJSONObject("upper") ?: JSONObject()).optString("name"))
                    .put("cover", BiliApi.toHttpsUrl(m.optString("cover")))
                    .put("dur", m.optLong("duration")))
                if (rows.size >= MAX_ITEMS) break
            }
            if (!data.optBoolean("has_more", true)) break
            pn++
            if (pn > 60) break
            try { Thread.sleep(400) } catch (_: InterruptedException) { break }   // 翻页间隔，避风控
        }
        if (rows.isEmpty()) throw RuntimeException("收藏夹里没有可导入的视频")

        // 收藏夹接口不返回 cid，而歌单条目必须靠 cid 定位分P：逐条取 view 补上（并发 4）
        val filled = BiliApi.parallel(rows, 4) { row ->
            try {
                val v = BiliApi.videoData(row.optString("bvid"))
                var cid = v.optString("cid")
                if (cid.isEmpty()) cid = v.optJSONArray("pages")?.optJSONObject(0)?.optString("cid") ?: ""
                if (cid.isEmpty()) {
                    null
                } else {
                    item(row.optString("bvid"), cid, 1,
                        row.optString("title"),
                        row.optString("author").ifEmpty {
                            (v.optJSONObject("owner") ?: JSONObject()).optString("name")
                        },
                        row.optString("cover").ifEmpty { BiliApi.toHttpsUrl(v.optString("pic")) },
                        row.optLong("dur").let { if (it > 0) it else v.optLong("duration") })
                }
            } catch (_: Exception) {
                null   // 单个视频取不到就跳过，不算整张歌单失败
            }
        }.filterNotNull()
        if (filled.isEmpty()) throw RuntimeException("收藏夹里没有可导入的视频（图文 / 番剧会被跳过）")
        return FavFetch(filled, cover, author)
    }

    // ---------------- 链接 → bvid ----------------

    private fun resolveBvid(raw: String): String {
        bvRegex.find(raw)?.let { return it.value }
        val m = Regex("b23\\.tv/([A-Za-z0-9]+)").find(raw)
        if (m != null) {
            val finalUrl = BiliApi.resolveShortLink("https://b23.tv/" + m.groupValues[1])
            bvRegex.find(finalUrl)?.let { return it.value }
            throw RuntimeException("短链没有跳到视频页（跳到了 ${finalUrl.take(80)}）")
        }
        throw RuntimeException("认不出链接：请粘 B 站视频链接（bilibili.com/video/BV…）、" +
            "合集内任意一期、收藏夹链接或 b23.tv 短链")
    }
}
