package com.replayradio.app

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** 与内嵌本地服务通信。服务只绑 127.0.0.1，端口固定 18765。 */
object ApiClient {
    const val DEFAULT_PORT = 18765
    private val client = OkHttpClient.Builder()
        .connectTimeout(3, TimeUnit.SECONDS)
        .readTimeout(10, TimeUnit.SECONDS)
        .build()

    @Volatile private var server: LocalServer? = null

    /** App 内唯一持有者：启动一次，UI 与服务同生命周期。 */
    @Synchronized
    fun ensureServer(ctx: Context): Int {
        if (server == null) {
            val s = LocalServer(ctx.applicationContext)
            s.start()
            server = s
        }
        return server!!.port
    }

    fun serverPort(): Int = server?.port ?: DEFAULT_PORT
    private fun base(): String = "http://127.0.0.1:${serverPort()}"

    data class NowInfo(
        val empty: Boolean,
        val bvid: String?, val cid: String?, val title: String?,
        val offsetMs: Long, val remainingMs: Long, val index: Int, val count: Int
    )

    suspend fun now(): Result<NowInfo> = withContext(Dispatchers.IO) {
        try {
            val json = JSONObject(get("${base()}/api/now"))
            if (json.optBoolean("empty")) {
                Result.success(NowInfo(true, null, null, null, 0, 0, 0, 0))
            } else {
                val cur = json.optJSONObject("current") ?: JSONObject()
                Result.success(NowInfo(
                    false, cur.optString("bvid"), cur.optString("cid"), cur.optString("title"),
                    (json.optDouble("offset", 0.0) * 1000).toLong(),
                    (json.optDouble("remaining", 0.0) * 1000).toLong(),
                    json.optInt("index"), json.optInt("count")
                ))
            }
        } catch (e: Exception) { Result.failure(e) }
    }

    suspend fun playUrl(bvid: String, cid: String, qn: Int = 64): Result<String> =
        withContext(Dispatchers.IO) {
            try {
                val json = JSONObject(get("${base()}/api/playurl?bvid=$bvid&cid=$cid&qn=$qn"))
                val media = json.optString("media")
                if (media.isEmpty()) Result.failure(RuntimeException(json.optString("error", "取播放地址失败")))
                else Result.success(base() + "/api/stream?u=" + b64(media))
            } catch (e: Exception) { Result.failure(e) }
        }

    fun proxyUrl(cdnUrl: String): String = base() + "/api/stream?u=" + b64(cdnUrl)

    private fun b64(s: String) = android.util.Base64.encodeToString(
        s.toByteArray(Charsets.UTF_8),
        android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING
    )

    private fun get(url: String): String {
        val req = okhttp3.Request.Builder().url(url).build()
        client.newCall(req).execute().use { resp ->
            if (!resp.isSuccessful) throw RuntimeException("HTTP ${resp.code}")
            return resp.body?.string().orEmpty()
        }
    }
}
