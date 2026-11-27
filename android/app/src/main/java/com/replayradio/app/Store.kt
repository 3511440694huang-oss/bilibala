package com.replayradio.app

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * 主播配置与回放清单缓存。全部落在 App 私有目录（filesDir），不写外部存储。
 * 结构对齐原 Python 版 data/stations.json 的核心字段，保证行为一致。
 */
object Store {
    private const val STATIONS = "stations.json"
    private const val PROGRAMS_PREFIX = "programs_"
    private const val CRED = "cred.json"
    private lateinit var ctx: Context

    fun init(context: Context) { ctx = context.applicationContext }

    private fun read(name: String): JSONObject? = try {
        val f = java.io.File(ctx.filesDir, name)
        if (f.exists()) JSONObject(f.readText(Charsets.UTF_8)) else null
    } catch (_: Exception) { null }

    private fun write(name: String, obj: JSONObject) {
        val f = java.io.File(ctx.filesDir, name)
        f.writeText(obj.toString(), Charsets.UTF_8)
    }

    // ---------------- 主播 ----------------
    fun stations(): MutableList<JSONObject> {
        val doc = read(STATIONS) ?: return mutableListOf()
        val arr = doc.optJSONArray("stations") ?: return mutableListOf()
        val out = mutableListOf<JSONObject>()
        for (i in 0 until arr.length()) arr.optJSONObject(i)?.let { out.add(it) }
        return out
    }

    fun saveStations(list: List<JSONObject>) {
        val arr = JSONArray()
        list.forEach { arr.put(it) }
        write(STATIONS, JSONObject().put("stations", arr).put("_version", 2))
    }

    fun findStation(id: String): JSONObject? = stations().firstOrNull { it.optString("id") == id }

    fun currentStation(): JSONObject? {
        val list = stations()
        return list.firstOrNull { it.optBoolean("main") } ?: list.firstOrNull()
    }

    fun addStation(mid: String, name: String, room: String, face: String, sourceId: String, sourceName: String): JSONObject {
        val list = stations()
        val id = mid // 纯数字 UID 天然安全且唯一，直接当目录/标识
        val existing = list.firstOrNull { it.optString("mid") == mid }
        val st = existing ?: JSONObject().apply {
            put("id", id); put("short", name); put("main", list.isEmpty())
        }
        st.put("mid", mid).put("name", name).put("room", room).put("face", face)
        if (sourceId.isNotEmpty()) {
            st.put("series_id", sourceId).put("series_name", sourceName)
        }
        if (existing == null) list.add(st)
        saveStations(list)
        return st
    }

    fun deleteStation(id: String) {
        val list = stations().filterNot { it.optString("id") == id }.toMutableList()
        if (list.isNotEmpty() && list.none { it.optBoolean("main") }) list[0].put("main", true)
        saveStations(list)
    }

    // ---------------- 回放清单缓存 ----------------
    fun programsCacheKey(stationId: String) = "$PROGRAMS_PREFIX$stationId.json"
    fun readPrograms(stationId: String): JSONObject? = read(programsCacheKey(stationId))
    fun writePrograms(stationId: String, obj: JSONObject) = write(programsCacheKey(stationId), obj)

    // ---------------- 凭据（B 站登录态） ----------------
    /**
     * 凭据只落在 App 私有目录的 cred.json，不写外部存储，也不进 SharedPreferences。
     * 为什么不用 SharedPreferences：它会把同一份秘密另存成 XML，清空/迁移时容易漏掉一处；
     * 这里一个文件、一处权限、一处清理，且可以显式把模式收紧到 0600。
     *
     * 读取每次都重新读文件（与 Python 原版一致）：扫码登录后不用重启服务，也避免内存里
     * 长期留着一份可能已失效的副本。
     */
    fun cred(key: String): String {
        val doc = read(CRED) ?: return ""
        return doc.optString(key).trim()
    }

    /**
     * 写一项凭据（其余项保持不变）。拒绝空白/分号/引号等字符：
     * 这些值最终要拼进 Cookie 头，带控制字符既可能把请求头弄坏，也是注入面。
     */
    fun saveCred(key: String, value: String) {
        if (!key.matches(Regex("[A-Za-z0-9_]{1,32}"))) throw IllegalArgumentException("凭据名不合法")
        if (value.isEmpty() || value.length > 512) throw IllegalArgumentException("凭据格式不合法")
        for (ch in value) {
            if (ch.isWhitespace() || ch.isISOControl() || ch == ';' || ch == '"' ||
                ch == '\'' || ch == '\\') throw IllegalArgumentException("凭据格式不合法")
        }
        val doc = read(CRED) ?: JSONObject()
        doc.put(key, value)
        writeCred(doc)
    }

    /** 登出/换账号：直接删文件，不留给下一个账号任何可复用状态。 */
    fun clearCred() {
        try { java.io.File(ctx.filesDir, CRED).delete() } catch (_: Exception) {}
    }

    /**
     * 先写临时文件再改名：中途被杀进程时旧凭据仍然完整，不会留下半截 JSON
     * （半截文件会被 read() 当成「没有凭据」，表现为刚登录又被登出）。
     */
    private fun writeCred(obj: JSONObject) {
        val dir = ctx.filesDir
        val tmp = java.io.File(dir, "$CRED.tmp")
        tmp.writeText(obj.toString(), Charsets.UTF_8)
        restrict(tmp)
        val dst = java.io.File(dir, CRED)
        if (!tmp.renameTo(dst)) {
            // 极少数文件系统不允许改名覆盖：退化成直接重写，再收紧权限
            dst.writeText(obj.toString(), Charsets.UTF_8)
            restrict(dst)
            tmp.delete()
        }
    }

    /** 0600：仅本 App uid 可读写。filesDir 本身是 0700，这里是第二道锁。 */
    private fun restrict(f: java.io.File) {
        try {
            f.setReadable(false, false); f.setWritable(false, false); f.setExecutable(false, false)
            f.setReadable(true, true); f.setWritable(true, true)
        } catch (_: Exception) { /* 个别分区不支持 chmod，退化为目录权限保护 */ }
    }

    // ---------------- 通用 JSON 缓存（关注列表 / 歌单 / 表情包落盘用） ----------------
    /** 给 BiliApi 的关注缓存复用同一套「损坏即当没有」的读取语义。 */
    fun readJson(name: String): JSONObject? = read(name)
    fun writeJson(name: String, obj: JSONObject) = write(name, obj)

    /**
     * 原子写 JSON：先写 `<name>.tmp` 再改名。
     *
     * 歌单/表情包缓存都是「读改写」的大文件，写到一半被系统杀进程会留下半截 JSON，
     * 下次读取就整份当损坏丢掉（表现为歌单忽然全没了）。改名在同一分区上是原子的。
     */
    fun writeJsonAtomic(name: String, obj: JSONObject) {
        val dir = ctx.filesDir
        val tmp = java.io.File(dir, "$name.tmp")
        tmp.writeText(obj.toString(), Charsets.UTF_8)
        val dst = java.io.File(dir, name)
        if (!tmp.renameTo(dst)) {
            // 个别文件系统不支持改名覆盖：退化成直接重写
            dst.writeText(obj.toString(), Charsets.UTF_8)
            tmp.delete()
        }
    }
    fun deleteFile(name: String) {
        try { java.io.File(ctx.filesDir, name).delete() } catch (_: Exception) {}
    }
}
