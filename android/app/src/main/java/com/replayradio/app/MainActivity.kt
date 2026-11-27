package com.replayradio.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.ContentValues
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.Looper
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import android.util.Rational
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.media3.common.C
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.MoreExecutors
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.roundToInt

/**
 * 主界面：启动内嵌本地服务，WebView 加载 http://127.0.0.1:18765/。
 * 通过 JS 桥接把「播放」交给原生 ExoPlayer 前台服务（锁屏/通知控制）。
 */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private var server: LocalServer? = null
    private val scope = CoroutineScope(Dispatchers.Main + Job())
    private var controller: MediaController? = null
    private var cachePurged = false
    private var pageLoaded = false
    /** 网页里的全屏播放是否开着：返回键要先把这一层吃掉，而不是退出 App */
    private var fsActive = false
    private var controllerRetry = 0
    // 画中画状态：页面据此收起/恢复播放 UI，桥接线程也可能读
    @Volatile private var pip = false
    // 正在等系统的文件/字幕选择器返回：这时退到后台是「去挑文件」，不该自动进画中画
    @Volatile private var pickingFile = false
    // `<input type=file>` 的回调。每开一次选择器都换新的，取消时必须回 null：
    // 只覆盖不回值，WebView 会认为上一次选择还没结束，之后点选文件永远没反应。
    private var fileChooserCb: ValueCallback<Array<Uri>>? = null
    // 页面每秒都在问位置/状态：这些值统一在主线程采样成快照，
    // 桥接线程只读快照，不去碰 MediaController（media3 要求同 Looper）。
    @Volatile private var snapPos = 0L
    @Volatile private var snapDur = -1L
    @Volatile private var snapPlaying = false
    @Volatile private var snapPwr = false
    @Volatile private var snapKey = ""

    // ---- 悬浮窗（8.2：退后台不再进系统画中画，改成 App 自己盖一个小窗继续播） ----
    // 前端每次 play / seek / pause / 切期都会调 setNowPlaying 把当前状态写进来。
    // 为什么不在 onUserLeaveHint 里回查 MediaController：那时 Activity 已经在准备离开，
    // 而且桥接线程不能碰 media3 的控制器，拿一份现成快照最稳。
    @Volatile private var lastUrl = ""
    @Volatile private var lastTitle = ""
    @Volatile private var lastPos = 0L
    @Volatile private var lastLive = false
    @Volatile private var lastPlaying = false
    /** 悬浮窗关窗回调带回来的位置，等 onResume 统一派发；NONE_POS = 没有待处理事件 */
    private val pendingClosedPos = java.util.concurrent.atomic.AtomicLong(NONE_POS)
    /** 我们自己收的窗（onResume）：服务那侧的 onClosed 不必再派发一遍 */
    @Volatile private var overlayStopByUs = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Diag.init(this)
        Diag.log("MainActivity.onCreate")
        Store.init(this)
        web = WebView(this)
        setContentView(web)
        Diag.log("setContentView done")

        askNotificationPermission()
        configureWebView()
        Diag.log("WebView configured")

        // 内嵌服务必须先在后台线程启动，再加载页面
        scope.launch(Dispatchers.IO) {
            try { ApiClient.ensureServer(applicationContext); Diag.log("server started port=${ApiClient.serverPort()}") }
            catch (e: Exception) { Diag.log("server FAILED: ${e.message}") }
            // 必须显式回主线程：内层 launch 会继承 IO 调度器，
            // 在后台线程调用 WebView.loadUrl 会抛 CalledFromWrongThreadException 而闪退。
            scope.launch(Dispatchers.Main) {
                Diag.log("loadUrl on main thread")
                try {
                    web.loadUrl("http://127.0.0.1:${ApiClient.serverPort()}/")
                } catch (e: Exception) {
                    Diag.log("loadUrl FAILED: ${e.message}")
                }
            }
        }
        connectController()
        startSampler()
        // 悬浮窗被用户点 × / 通知栏「停止」收掉时，服务会从主线程回调这里：
        // 只记下来再派发，-1 表示「别恢复」，页面据此不要自己接着放。
        OverlayService.onClosed = { pos ->
            if (overlayStopByUs) {
                overlayStopByUs = false
            } else {
                pendingClosedPos.set(pos)
                deliverOverlayClosed()
            }
        }
        Diag.log("controller connecting")
    }

    @SuppressLint("SetJavaScriptEnabled")
    companion object {
        /** 清掉 Service Worker 注册与 Cache Storage，只做一次（sessionStorage 标记）。 */
        private const val PURGE_JS = """(function(){
try{
  var K='__rr_sw_purged_v7';
  if(sessionStorage.getItem(K)) return 'skip';
  sessionStorage.setItem(K,'1');
  var did=false;
  if(window.caches&&caches.keys){caches.keys().then(function(ks){
    if(ks.length){did=true;Promise.all(ks.map(function(k){return caches.delete(k);})).then(function(){location.reload();});}
  });}
  if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations){navigator.serviceWorker.getRegistrations().then(function(rs){
    if(rs.length){did=true;Promise.all(rs.map(function(r){return r.unregister();})).then(function(){if(!window.caches)location.reload();});}
  });}
  return 'purged';
}catch(e){return 'err';}
})()"""

        /** requestCode：WebView 的 <input type=file> 与 pickSubtitle 各占一个 */
        private const val REQ_FILE = 7001
        private const val REQ_SUBTITLE = 7002
        /** 相册里的文件夹名（MediaStore RELATIVE_PATH 与旧版公共目录共用） */
        private const val GALLERY_DIR = "哔哩吧啦"
        /** 字幕是纯文本，超过这个大小基本是选错文件了，读进来只会卡主线程 */
        private const val MAX_SUBTITLE_BYTES = 4 * 1024 * 1024
        /** 悬浮窗关窗回调的「没有事件」哨兵值 */
        private const val NONE_POS = Long.MIN_VALUE
    }

    private fun configureWebView() {
        web.setBackgroundColor(Color.parseColor("#0B0C0E"))
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            // 本地服务不给 ETag/Last-Modified，开默认缓存会在升级 APK 后继续喂旧页面
            // （assets 换了、缓存没换）。都是走 127.0.0.1，重取一次几乎不花钱，宁可不缓存。
            cacheMode = WebSettings.LOAD_NO_CACHE
            useWideViewPort = true
            loadWithOverviewMode = true
            setSupportZoom(false)
            builtInZoomControls = false
            mediaPlaybackRequiresUserGesture = false
            userAgentString = "$userAgentString; ReplayRadioAndroid/1.0"
        }
        web.addJavascriptInterface(JsBridge(), "AndroidRadio")
        // 页面里的 <input type="file"> 与 pickSubtitle() 都靠这里打开系统选择器。
        // 不实现会怎样：点「选择字幕」完全没反应（WebView 默认没有文件选择能力）。
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView?,
                callback: ValueCallback<Array<Uri>>?,
                params: FileChooserParams?
            ): Boolean {
                return try {
                    // 上一次没收到结果的回调先放掉，避免文件输入框被永久锁住
                    try { fileChooserCb?.onReceiveValue(null) } catch (_: Exception) {}
                    fileChooserCb = callback
                    // 不用 params.createIntent()：accept=".srt,.vtt,.ass" 会被 WebView 翻成
                    // 具体 MIME，而 .ass/.srt 在多数 ROM 上没有注册 MIME，文件会被直接灰掉。
                    // 这里统一 */*，让字幕、歌词、任意文本都能选到（页面自己按扩展名校验）。
                    val i = Intent(Intent.ACTION_GET_CONTENT).apply {
                        addCategory(Intent.CATEGORY_OPENABLE)
                        type = "*/*"
                        putExtra(Intent.EXTRA_ALLOW_MULTIPLE,
                            params?.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                    }
                    pickingFile = true
                    startActivityForResult(Intent.createChooser(i, "选择文件"), REQ_FILE)
                    true
                } catch (e: Exception) {
                    fileChooserCb = null
                    Diag.log("filechooser failed: ${e.javaClass.simpleName}")
                    false
                }
            }
        }
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val u = request?.url?.toString() ?: return false
                // 只放行本地页面；外部链接交给系统浏览器
                if (u.startsWith("http://127.0.0.1:${ApiClient.serverPort()}")) return false
                if (u.startsWith("http://") || u.startsWith("https://")) {
                    try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(u))) } catch (_: Exception) {}
                    return true
                }
                return false
            }
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                // 旧版曾把整页 HTML 交给 Service Worker 缓存：换了新 APK 仍显示老界面，
                // 而且老页面永远不会执行新代码。这里由原生侧注入一次清理（同源，能读到
                // 老页面的 caches 与 SW 注册），清完自动重载一次。
                pageLoaded = true
                if (cachePurged) return
                cachePurged = true
                view?.evaluateJavascript(PURGE_JS, null)
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: android.webkit.WebResourceError?) {
                // 只有「主文档」失败才换兜底页。之前没判 isForMainFrame：
                // 任意一张封面图/子资源 404 都会把整页替换成「本机服务启动中或未就绪」，
                // 表现就是"服务永远起不来、点什么都没反应"。
                if (request != null && !request.isForMainFrame) return
                if (pageLoaded) return
                // 错误兜底页：不白屏
                val html = """<!doctype html><meta charset=utf-8>
                    <body style="background:#0B0C0E;color:#F2EDE4;font-family:sans-serif;padding:32px">
                    <h2 style="color:#E5B469;font-weight:600">哔哩吧啦</h2>
                    <p>本机服务启动中或未就绪，请稍候…</p>
                    <p style="color:#847F77;font-size:13px">${error?.description ?: ""}</p>
                    <button onclick="location.reload()" style="background:#E5B469;color:#191104;border:0;padding:12px 24px;border-radius:8px;font-size:16px">重试</button>
                    </body>"""
                view?.loadDataWithBaseURL("http://127.0.0.1:${ApiClient.serverPort()}/", html, "text/html", "utf-8", null)
            }
        }
    }

    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        // Android 9 及以下没有 MediaStore 的 IS_PENDING/RELATIVE_PATH，截图保存要写公共 Pictures 目录。
        // Android 10 起走 MediaStore 分区存储，完全不需要这个权限（清单里已按 maxSdkVersion=28 声明）。
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q &&
            checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), 2)
        }
    }

    /** 250ms 采一次播放器状态；只在主线程读，桥接线程读字段。 */
    private fun startSampler() {
        scope.launch {
            while (true) {
                val c = controller
                if (c != null) {
                    try {
                        snapPos = c.currentPosition
                        snapDur = if (c.duration == C.TIME_UNSET) -1L else c.duration
                        snapPlaying = c.isPlaying
                        snapPwr = c.playWhenReady
                        snapKey = c.currentMediaItem?.mediaId ?: ""
                    } catch (_: Exception) {}
                }
                delay(250)
            }
        }
    }

    private fun connectController() {
        val token = SessionToken(this, ComponentName(this, PlaybackService::class.java))
        val future = MediaController.Builder(this, token).buildAsync()
        future.addListener({
            try {
                controller = future.get()
            } catch (e: Exception) {
                // 控制器没连上时 seek/倍速/位置会全部静默失效（有声无画），退一步重试一次
                if (controllerRetry < 2) {
                    controllerRetry++
                    Diag.log("controller connect failed, retry ${'$'}controllerRetry")
                    scope.launch { delay(1200); connectController() }
                }
            }
        }, MoreExecutors.directExecutor())
    }

    // ---------- 7.1 原生能力的小工具 ----------

    /**
     * 桥接线程 → 主线程同步执行。窗口亮度、旋屏、PiP 都必须走主线程；
     * 而桥接方法要同步返回值，所以用 latch 等（600ms 上限，绝不把 JavaBridge 线程挂死）。
     * 已经在主线程时直接执行，不绕一圈。
     */
    private fun <T> onMainSync(block: () -> T, fallback: T): T {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            return try { block() } catch (_: Exception) { fallback }
        }
        var result = fallback
        try {
            val latch = CountDownLatch(1)
            runOnUiThread {
                try { result = block() } catch (_: Exception) {} finally { latch.countDown() }
            }
            latch.await(600, TimeUnit.MILLISECONDS)
        } catch (_: Exception) {}
        return result
    }

    private fun audioManager(): AudioManager? = try {
        getSystemService(AudioManager::class.java)
    } catch (_: Exception) { null }

    /** 系统亮度（0..1）：只在窗口亮度还是 -1（跟随系统）时当初始值用。 */
    private fun systemBrightness(): Float = try {
        val v = Settings.System.getInt(contentResolver, Settings.System.SCREEN_BRIGHTNESS)
        (v / 255f).coerceIn(0.05f, 1f)
    } catch (_: Exception) { 0.5f }

    private fun safeFileName(name: String): String {
        val raw = name.trim().ifEmpty { "rr_" + System.currentTimeMillis() }
            // 路径花样与文件名非法字符一律压平；中文保留，相册里看得懂
            .replace(Regex("""[\\/:*?"<>|\s]+"""), "_")
        val stem = raw.take(60).trim('.', '_').ifEmpty { "rr_" + System.currentTimeMillis() }
        return if (stem.lowercase().endsWith(".png")) stem else "$stem.png"
    }

    /**
     * base64 PNG → 系统相册。
     * Android 10+ 走 MediaStore + IS_PENDING（不需要任何存储权限），写完再清 pending；
     * Android 9 及以下没有分区存储，只能落公共 Pictures 目录再登记进 MediaStore。
     * 调用方是 JavaBridge 线程，这里的 IO 不会卡界面。
     */
    private fun savePngToGallery(raw: String, name: String): String {
        var b64 = raw.trim()
        // 页面可能直接把 data URL 丢进来
        if (b64.startsWith("data:")) {
            val comma = b64.indexOf(',')
            if (comma > 0) b64 = b64.substring(comma + 1)
        }
        if (b64.isEmpty()) return "err:图片数据为空"
        val bytes = try {
            Base64.decode(b64, Base64.DEFAULT)
        } catch (_: Exception) { return "err:base64 解码失败" }
        if (bytes.isEmpty()) return "err:图片数据为空"
        // 解一次图：既校验确实是图片，也顺手拿到宽高写进相册元数据
        val bmp = try { BitmapFactory.decodeByteArray(bytes, 0, bytes.size) } catch (_: Exception) { null }
            ?: return "err:不是有效的图片数据"
        val fileName = safeFileName(name)
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val values = ContentValues().apply {
                    put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
                    put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                    put(MediaStore.Images.Media.RELATIVE_PATH,
                        Environment.DIRECTORY_PICTURES + "/" + GALLERY_DIR)
                    put(MediaStore.Images.Media.IS_PENDING, 1)
                    put(MediaStore.Images.Media.WIDTH, bmp.width)
                    put(MediaStore.Images.Media.HEIGHT, bmp.height)
                }
                val uri = contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                    ?: return "err:相册不可写"
                try {
                    contentResolver.openOutputStream(uri)?.use { os ->
                        if (!bmp.compress(Bitmap.CompressFormat.PNG, 100, os)) {
                            throw java.io.IOException("PNG 编码失败")
                        }
                    } ?: throw java.io.IOException("打不开相册写入流")
                    contentResolver.update(uri, ContentValues().apply {
                        put(MediaStore.Images.Media.IS_PENDING, 0)
                    }, null, null)
                    return "ok"
                } catch (e: Exception) {
                    // 半截文件必须删掉，否则相册里会多一张打不开的破图
                    try { contentResolver.delete(uri, null, null) } catch (_: Exception) {}
                    return "err:" + (e.message ?: "写入相册失败")
                }
            }
            // ---- Android 9 及以下：先落盘，再登记 ----
            if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) !=
                PackageManager.PERMISSION_GRANTED) {
                return "err:需要存储权限"
            }
            val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES),
                GALLERY_DIR)
            if (!dir.exists() && !dir.mkdirs()) return "err:相册目录不可写"
            val f = File(dir, fileName)
            FileOutputStream(f).use { os ->
                if (!bmp.compress(Bitmap.CompressFormat.PNG, 100, os)) {
                    throw java.io.IOException("PNG 编码失败")
                }
            }
            contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
                put(MediaStore.Images.Media.MIME_TYPE, "image/png")
                @Suppress("DEPRECATION")
                put(MediaStore.Images.Media.DATA, f.absolutePath)
            })
            return "ok"
        } finally {
            try { bmp.recycle() } catch (_: Exception) {}
        }
    }

    /** `<input type=file>` 选完（或被取消）：必须回调，取消也要回 null，否则文件框永久锁死。 */
    private fun handleFileChooserResult(resultCode: Int, data: Intent?) {
        val cb = fileChooserCb
        fileChooserCb = null
        if (cb == null) return
        val uris: Array<Uri>? = try {
            when {
                resultCode != RESULT_OK || data == null -> null
                data.clipData != null -> {
                    val c = data.clipData!!
                    Array(c.itemCount) { i -> c.getItemAt(i).uri }
                }
                data.data != null -> arrayOf(data.data!!)
                else -> null
            }
        } catch (_: Exception) { null }
        try { cb.onReceiveValue(uris) } catch (_: Exception) {}
    }

    private fun subtitleDisplayName(uri: Uri): String = try {
        contentResolver.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME),
            null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else ""
        }?.ifEmpty { "subtitle.srt" } ?: "subtitle.srt"
    } catch (_: Exception) { "subtitle.srt" }

    /** 字幕多是 UTF-8，但国产字幕站常见 GBK/GB18030：先按 UTF-8 解，出替换字符再退回 GBK。 */
    private fun decodeText(bytes: ByteArray): String {
        val utf8 = String(bytes, Charsets.UTF_8)
        if (!utf8.contains('\uFFFD')) return utf8
        return try { String(bytes, charset("GBK")) } catch (_: Exception) { utf8 }
    }

    /** 原生选中的字幕文件 → 读文本 → 回调页面。读盘在 IO，回 WebView 必须回主线程。 */
    private fun handleSubtitleResult(resultCode: Int, data: Intent?) {
        val uri = data?.data
        if (resultCode != RESULT_OK || uri == null) return
        scope.launch(Dispatchers.IO) {
            try {
                val name = subtitleDisplayName(uri)
                val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
                if (bytes == null || bytes.isEmpty()) {
                    Diag.log("subtitle empty: $name")
                    return@launch
                }
                if (bytes.size > MAX_SUBTITLE_BYTES) {
                    Diag.log("subtitle too large: ${bytes.size}")
                    return@launch
                }
                val text = decodeText(bytes)
                scope.launch(Dispatchers.Main) {
                    try {
                        web.evaluateJavascript(
                            "(function(){try{if(window.__rrSubtitleFile)window.__rrSubtitleFile(" +
                                JSONObject.quote(name) + "," + JSONObject.quote(text) + ")}catch(e){}})()",
                            null
                        )
                    } catch (_: Exception) {}
                }
            } catch (e: Exception) {
                Diag.log("subtitle read failed: ${e.javaClass.simpleName}")
            }
        }
    }

    private fun dispatchPip(inPip: Boolean) {
        try {
            web.evaluateJavascript(
                "(function(){try{if(window.__rrPip)window.__rrPip($inPip)}catch(e){}})()", null)
        } catch (_: Exception) {}
    }

    @androidx.annotation.RequiresApi(Build.VERSION_CODES.O)
    private fun enterPipInternal(): Boolean = try {
        if (!packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
            false
        } else {
            val params = android.app.PictureInPictureParams.Builder()
                .setAspectRatio(Rational(16, 9))
                .build()
            enterPictureInPictureMode(params)
        }
    } catch (_: Exception) { false }

    /** 通知页面悬浮窗的进出：window.__rrOverlay(on, pos)。pos=-1 表示用户自己关的、别恢复。 */
    private fun dispatchOverlay(on: Boolean, pos: Long) {
        try {
            web.evaluateJavascript(
                "(function(){try{if(window.__rrOverlay)window.__rrOverlay($on,$pos)}catch(e){}})()", null)
        } catch (_: Exception) {}
    }

    /** 把攒下的关窗事件派发掉（最多派发一次）。 */
    private fun deliverOverlayClosed() {
        val v = pendingClosedPos.getAndSet(NONE_POS)
        if (v == NONE_POS) return
        dispatchOverlay(false, v)
    }

    /**
     * 起悬浮窗。必须先停 PlaybackService：小窗自带一台 ExoPlayer，两台一起放就是双声。
     * startService / dispatchOverlay 都要求主线程（桥接线程调过来时用 onMainSync 兜一层）。
     */
    private fun startOverlay(title: String, url: String, pos: Long, live: Boolean): Boolean {
        if (url.isEmpty()) return false
        return try {
            try {
                startService(Intent(this, PlaybackService::class.java).apply {
                    action = PlaybackService.ACTION_STOP
                })
            } catch (e: Exception) {
                Diag.log("stop playback before overlay failed: ${e.javaClass.simpleName}")
            }
            OverlayService.start(this, url, title, pos, live)
            // 告诉页面小窗接上了：直播页的 <video> 是在网页里自己出声的，
            // 起窗后得让它静音/停掉，不然和悬浮窗一起响。
            dispatchOverlay(true, pos)
            Diag.log("overlay started: live=$live pos=$pos")
            true
        } catch (e: Exception) {
            Diag.log("startOverlay failed: ${e.javaClass.simpleName}")
            false
        }
    }

    override fun onResume() {
        super.onResume()
        // 从文件选择器/外部页面回来一律复位：一次异常不该把「自动画中画」永久关掉
        pickingFile = false
        // 从悬浮窗回 App：先把小窗收掉，位置交回页面接着放；
        // 如果是在别的 App 里点了 × / 通知栏停止，走的是 else 分支的 -1（别恢复）。
        try {
            if (OverlayService.isShowing) {
                val pos = OverlayService.lastPosition
                overlayStopByUs = true
                OverlayService.stop(this, returnPos = true)
                Diag.log("overlay closed by resume, pos=$pos")
                dispatchOverlay(false, pos)
                // 兜底：服务那边万一已经在收尾、不再回调 onClosed，别让这个标记一直挂着，
                // 否则用户下一次点 × 的那条「别恢复」会被吞掉。
                scope.launch {
                    delay(1200)
                    overlayStopByUs = false
                }
            } else {
                deliverOverlayClosed()
            }
        } catch (e: Exception) {
            Diag.log("overlay resume failed: ${e.javaClass.simpleName}")
        }
    }

    /**
     * 用户按 Home / 上滑回桌面（Activity 没被销毁）时弹 App 自己的悬浮窗。
     *
     * 8.2 起这里不再自动进系统画中画 —— 用户明确要的是「App 自己盖在别的应用上面的小窗」。
     * 只认前端写进来的播放快照（setNowPlaying）：没在放就不弹窗，
     * 否则翻个节目单、开个设置页回来都会飘出一块窗。
     *
     * 没有「显示在其他应用上方」权限时：保持原样直接退后台，不偷偷进 PiP
     * （PiP 的代码和 enterPiP 桥接都留着当降级兜底，只是这条自动路径不用它）；
     * 回到 App 后页面用 isOverlayAllowed() 问一次就能把「去授权」的提示亮起来。
     */
    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (pip || pickingFile) return
        try {
            if (!lastPlaying || lastUrl.isEmpty()) return
            if (!Settings.canDrawOverlays(this)) {
                Diag.log("auto overlay: 无悬浮窗权限，直接退后台（不进画中画）")
                return
            }
            if (startOverlay(lastTitle, lastUrl, lastPos, lastLive)) {
                Diag.log("auto overlay: 播放中退后台，已弹悬浮窗")
            }
        } catch (e: Exception) {
            Diag.log("auto overlay failed: ${e.javaClass.simpleName}")
        }
    }

    /**
     * 进出画中画：通知页面（window.__rrPip）。退出时把系统栏还回去，
     * 否则沉浸式全屏的窗口状态会被带进 PiP，回来就少一条状态栏。
     */
    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        pip = isInPictureInPictureMode
        if (isInPictureInPictureMode) {
            // 画中画里播放不能停：WebView 在窗口「变小」时可能自己降频，
            // 主动 resume 一次保证 <video> 继续走（我们从不调用 web.onPause()）。
            try { web.onResume(); web.resumeTimers() } catch (_: Exception) {}
        } else {
            try {
                val w = window
                WindowCompat.getInsetsController(w, w.decorView)
                    .show(WindowInsetsCompat.Type.systemBars())
            } catch (_: Exception) {}
        }
        dispatchPip(isInPictureInPictureMode)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        pickingFile = false
        when (requestCode) {
            REQ_FILE -> handleFileChooserResult(resultCode, data)
            REQ_SUBTITLE -> handleSubtitleResult(resultCode, data)
        }
    }

    /** JS → 原生：播放 / 停止 / 状态 / 取源。 */
    private inner class JsBridge {
        @JavascriptInterface
        fun play(title: String, streamUrl: String, positionMs: Long, durationMs: Long, key: String, cover: String) {
            val intent = Intent(this@MainActivity, PlaybackService::class.java).apply {
                action = PlaybackService.ACTION_PLAY
                putExtra("title", title)
                putExtra("url", streamUrl)
                putExtra("positionMs", positionMs)
                putExtra("key", key)
                putExtra("cover", cover)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) startForegroundService(intent)
            else startService(intent)
        }

        @JavascriptInterface
        fun stop() {
            startService(Intent(this@MainActivity, PlaybackService::class.java).apply {
                action = PlaybackService.ACTION_STOP
            })
        }

        /**
         * 跳转 / 倍速：只发一条 intent，真正做事的在 PlaybackService。
         * 用 startService 而不是 startForegroundService —— 这是一次播放中的操作，
         * 不该因为拖了下进度条就在通知栏弹一个前台通知。
         */
        @JavascriptInterface
        fun seek(positionMs: Long) {
            if (positionMs < 0) return
            try {
                startService(Intent(this@MainActivity, PlaybackService::class.java).apply {
                    action = PlaybackService.ACTION_SEEK
                    putExtra("positionMs", positionMs)
                })
            } catch (e: Exception) {
                Diag.log("seek failed: ${e.javaClass.simpleName}")
            }
        }

        @JavascriptInterface
        fun setRate(rate: Float) {
            if (!rate.isFinite() || rate <= 0f) return
            try {
                startService(Intent(this@MainActivity, PlaybackService::class.java).apply {
                    action = PlaybackService.ACTION_RATE
                    putExtra("rate", rate)
                })
            } catch (e: Exception) {
                Diag.log("setRate failed: ${e.javaClass.simpleName}")
            }
        }

        @JavascriptInterface fun isPlaying(): Boolean = snapPlaying

        /**
         * 「用户想不想放」而不是「此刻在不在出声」：缓冲中 isPlaying 是 false，
         * 但 playWhenReady 仍是 true。前端拿它决定画面要不要跟着走，用错会把缓冲误判成暂停。
         */
        @JavascriptInterface fun getPlayWhenReady(): Boolean = snapPwr
        @JavascriptInterface fun getOrigin(): String = "http://127.0.0.1:${ApiClient.serverPort()}"

        /** 当前播放位置；控制器还没连上时给 0（前端拿它当「无进度」处理即可）。 */
        /** 原生此刻在放的这一期：bvid|cid。页面拿它和自己在放的对一下就直到有没有跑偏。 */
        @JavascriptInterface fun getKey(): String = snapKey

        @JavascriptInterface fun getPosition(): Long = snapPos

        /** 时长；media3 用 C.TIME_UNSET（Long.MIN_VALUE+1）表示未知，翻成 -1 给 JS 好判断。 */
        @JavascriptInterface fun getDuration(): Long = snapDur

        @JavascriptInterface fun getVersion(): String = "7.1.1"

        // ---------- 8.2 悬浮窗（退后台小窗继续播，替代自动画中画） ----------
        // 这些方法的调用线程是 WebView 的 JavaBridge 线程：凡是碰窗口/服务的都走
        // onMainSync 或 runOnUiThread，只读写字段的直接做。

        /**
         * 前端把「现在在放什么」写进原生。只存字段，不启动任何东西 ——
         * 什么时候弹小窗由 onUserLeaveHint 决定，页面说了不算。
         */
        @JavascriptInterface
        fun setNowPlaying(
            url: String,
            title: String,
            positionMs: Long,
            live: Boolean,
            playing: Boolean
        ) {
            try {
                lastUrl = url
                lastTitle = title
                lastPos = if (positionMs > 0) positionMs else 0L
                lastLive = live
                lastPlaying = playing
            } catch (e: Exception) {
                Diag.log("setNowPlaying failed: ${e.javaClass.simpleName}")
            }
        }

        /** 有没有「显示在其他应用上方」权限。没有的话退后台就只是普通退后台。 */
        @JavascriptInterface
        fun isOverlayAllowed(): Boolean = try {
            Settings.canDrawOverlays(this@MainActivity)
        } catch (_: Exception) { false }

        /** 跳到本 App 的悬浮窗授权页；少数 ROM 没这个页面，退一步打开应用详情。 */
        @JavascriptInterface
        fun openOverlaySettings() {
            try {
                startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:$packageName")
                    )
                )
            } catch (e: Exception) {
                Diag.log("openOverlaySettings failed: ${e.javaClass.simpleName}")
                try {
                    startActivity(
                        Intent(
                            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:$packageName")
                        )
                    )
                } catch (_: Exception) {}
            }
        }

        /**
         * 页面主动要小窗（比如用户点了「小窗播放」）。
         * 没权限返回 false，页面据此弹授权引导；起窗失败也返回 false。
         */
        @JavascriptInterface
        fun showOverlay(title: String, url: String, positionMs: Long, live: Boolean): Boolean {
            if (url.isEmpty()) return false
            val allowed = try {
                Settings.canDrawOverlays(this@MainActivity)
            } catch (_: Exception) { false }
            if (!allowed) return false
            return onMainSync({ startOverlay(title, url, positionMs, live) }, false)
        }

        /** 收窗（把位置带回来，页面接着放）。 */
        @JavascriptInterface
        fun hideOverlay(): Boolean = try {
            OverlayService.stop(this@MainActivity, returnPos = true)
            true
        } catch (e: Exception) {
            Diag.log("hideOverlay failed: ${e.javaClass.simpleName}")
            false
        }

        /** 小窗此刻的播放位置；没开窗时给 0。 */
        @JavascriptInterface
        fun overlayPosition(): Long = try { OverlayService.lastPosition } catch (_: Exception) { 0L }

        /**
         * 网页进入/退出全屏播放：收起系统栏并转横屏，退出时全部还原。
         * 只做窗口状态，不动页面；页面那边已经把画面钉到整屏了。
         */
        @JavascriptInterface
        fun setFullscreen(on: Boolean) {
            runOnUiThread {
                fsActive = on
                val w = window
                val ctl = WindowCompat.getInsetsController(w, w.decorView)
                if (on) {
                    ctl.hide(WindowInsetsCompat.Type.systemBars())
                    ctl.systemBarsBehavior =
                        WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                } else {
                    ctl.show(WindowInsetsCompat.Type.systemBars())
                    requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
                }
            }
        }

        // ---------- 7.1 播放器原生能力（PLAYER-CONTRACT §2） ----------
        // 全部 try/catch：桥接方法把异常抛回 JS 不会变成页面能 catch 的 Error，
        // 而是让这次调用静默失败、返回值永远不来 —— 手势调亮度会「卡住」。

        /**
         * 窗口亮度：0..1，传 -1（任何负数）恢复跟随系统。
         * 只能改 WindowManager.LayoutParams，且必须在主线程。
         * 下限收到 0.01：真给 0 会全黑，用户再也没法滑回来。
         */
        @JavascriptInterface
        fun setBrightness(v: Float) {
            try {
                onMainSync({
                    val lp = window.attributes
                    lp.screenBrightness = if (v < 0f) {
                        WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
                    } else {
                        v.coerceIn(0.01f, 1f)
                    }
                    window.attributes = lp
                    true
                }, false)
            } catch (e: Exception) {
                Diag.log("setBrightness failed: ${e.javaClass.simpleName}")
            }
        }

        /** 当前窗口亮度；没改过（跟随系统）时读系统亮度，避免右滑从 0 突然开始。 */
        @JavascriptInterface
        fun getBrightness(): Float {
            return try {
                onMainSync({
                    val cur = window.attributes.screenBrightness
                    if (cur >= 0f) cur else systemBrightness()
                }, 0.5f)
            } catch (e: Exception) {
                Diag.log("getBrightness failed: ${e.javaClass.simpleName}")
                0.5f
            }
        }

        /** 系统媒体音量 0..1（STREAM_MUSIC）；不弹系统音量条，横向滑动调音量才不刺眼。 */
        @JavascriptInterface
        fun setVolume(v: Float) {
            try {
                val am = audioManager()
                if (am != null) {
                    val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                    if (max > 0) {
                        val idx = (v.coerceIn(0f, 1f) * max).roundToInt().coerceIn(0, max)
                        am.setStreamVolume(AudioManager.STREAM_MUSIC, idx, 0)
                    }
                }
            } catch (e: Exception) {
                Diag.log("setVolume failed: ${e.javaClass.simpleName}")
            }
        }

        @JavascriptInterface
        fun getVolume(): Float {
            var out = 0f
            try {
                val am = audioManager()
                if (am != null) {
                    val max = am.getStreamMaxVolume(AudioManager.STREAM_MUSIC)
                    if (max > 0) {
                        out = am.getStreamVolume(AudioManager.STREAM_MUSIC).toFloat() / max
                    }
                }
            } catch (e: Exception) {
                Diag.log("getVolume failed: ${e.javaClass.simpleName}")
            }
            return out.coerceIn(0f, 1f)
        }

        /**
         * 旋屏：auto / landscape / portrait / lock-landscape / lock-portrait。
         * auto 用 FULL_SENSOR —— 系统旋屏锁开着也能跟着设备转，符合「自动旋屏」预期；
         * lock-* 用固定方向，彻底忽略传感器（躺床上看片不会自己翻）。
         */
        @JavascriptInterface
        fun setOrientation(mode: String) {
            try {
                val o = when (mode.trim().lowercase()) {
                    "landscape" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    "portrait" -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
                    "lock-landscape" -> ActivityInfo.SCREEN_ORIENTATION_LANDSCAPE
                    "lock-portrait" -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
                    "auto", "" -> ActivityInfo.SCREEN_ORIENTATION_FULL_SENSOR
                    else -> -1
                }
                if (o < 0) return
                runOnUiThread {
                    try { requestedOrientation = o } catch (_: Exception) {}
                }
            } catch (e: Exception) {
                Diag.log("setOrientation failed: ${e.javaClass.simpleName}")
            }
        }

        /** 进入画中画；不支持 / 系统拒绝时返回 false，页面照常全屏播放。 */
        @JavascriptInterface
        fun enterPiP(): Boolean {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
            return try {
                val ok = onMainSync({ enterPipInternal() }, false)
                if (ok) pip = true
                ok
            } catch (e: Exception) {
                Diag.log("enterPiP failed: ${e.javaClass.simpleName}")
                false
            }
        }

        /**
         * base64 PNG 存相册，返回 "ok" 或 "err:人话"。
         * 解码与落盘都在 JavaBridge 线程（本来就不是主线程），别往主线程挪。
         */
        @JavascriptInterface
        fun saveImage(b64Png: String, name: String): String {
            return try {
                savePngToGallery(b64Png, name)
            } catch (e: Exception) {
                Diag.log("saveImage failed: ${e.javaClass.simpleName}")
                "err:" + (e.message ?: "保存失败")
            }
        }

        /** 可选路径：原生文件选择器选字幕，选中后回调 window.__rrSubtitleFile(name, text)。 */
        @JavascriptInterface
        fun pickSubtitle(): Boolean {
            return try {
                runOnUiThread {
                    try {
                        val i = Intent(Intent.ACTION_GET_CONTENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                        }
                        pickingFile = true
                        startActivityForResult(Intent.createChooser(i, "选择字幕文件"), REQ_SUBTITLE)
                    } catch (e: Exception) {
                        Diag.log("pickSubtitle failed: ${e.javaClass.simpleName}")
                    }
                }
                true
            } catch (e: Exception) {
                Diag.log("pickSubtitle failed: ${e.javaClass.simpleName}")
                false
            }
        }
    }

    @SuppressLint("MissingSuperCall")
    override fun onBackPressed() {
        // 先问页面：全屏播放、监控放大都由页面自己收；它说没收掉才走正常返回。
        // 以前只判 fsActive，监控放大永远轮不到；而且页面每次切页都 pushState，
        // 浮层开着按返回会先把历史退掉、浮层留在原地。
        try {
            web.evaluateJavascript(
                "(function(){try{return window.__rrExitFs?window.__rrExitFs():false}catch(e){return false}})()"
            ) { r ->
                try {
                    if (r != "true") {
                        if (web.canGoBack()) web.goBack() else finish()
                    }
                } catch (_: Exception) { finish() }
            }
        } catch (e: Exception) {
            if (web.canGoBack()) web.goBack() else finish()
        }
    }

    override fun onDestroy() {
        // 摘掉悬浮窗回调，别让服务攥着一个被销毁的 Activity
        try { OverlayService.onClosed = null } catch (_: Exception) {}
        controller?.release()
        // WebView 不 destroy 会把整页 JS、媒体元素和 Activity 一起留住
        try { web.stopLoading(); web.destroy() } catch (_: Exception) {}
        scope.cancel()
        super.onDestroy()
    }
}
