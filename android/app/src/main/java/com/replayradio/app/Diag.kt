package com.replayradio.app

import android.content.Context
import java.io.File

/**
 * 启动诊断：写到 App 自己的外部目录（无需存储权限），便于真机排障。
 * 路径：/sdcard/Android/data/com.replayradio.app/files/diag.log
 */
object Diag {
    private var file: File? = null

    fun init(ctx: Context) {
        val dir = ctx.getExternalFilesDir(null) ?: ctx.filesDir
        file = File(dir, "diag.log")
        val prev = installHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            log("FATAL ${t.name}: ${e.javaClass.simpleName}: ${e.message}")
            log(e.stackTrace.take(12).joinToString("\n") { "  at $it" })
            prev?.uncaughtException(t, e)
        }
        log("=== app start ===")
    }

    /** 供 /api/diag 读取：Termux 读不到 /Android/data，只能让 App 自己吐出来。 */
    fun dump(): String = try {
        val t = file?.readText() ?: "(diag 未初始化)"
        if (t.length > 20000) t.substring(t.length - 20000) else t
    } catch (e: Exception) { "diag 读取失败: ${e.message}" }

    fun log(msg: String) {
        val f = file ?: return
        try {
            f.appendText(java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.CHINA)
                .format(java.util.Date()) + " $msg\n")
        } catch (_: Exception) {}
    }

    private fun installHandler(): Thread.UncaughtExceptionHandler? =
        Thread.getDefaultUncaughtExceptionHandler()
}
