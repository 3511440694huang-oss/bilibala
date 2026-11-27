package com.replayradio.app

import android.animation.Animator
import android.animation.AnimatorListenerAdapter
import android.animation.ValueAnimator
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.Outline
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.InsetDrawable
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.view.Gravity
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.TextureView
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewOutlineProvider
import android.view.WindowManager
import android.widget.TextView
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * 悬浮窗播放（8.2）：用户明确不要系统画中画，要的是「App 自己的、能盖在别的应用上面、
 * 可拖动」的小窗，退后台后接着播。
 *
 * 为什么自己起一台 ExoPlayer：PlaybackService 那台是纯音频（视频轨被显式关掉），
 * 而且它的生命周期要跟着 MediaSession 通知走；这里要的是一块能出画面、能拖、能随时收的窗口，
 * 两套硬绑在一起只会互相拖。代价是——起小窗之前必须先把 PlaybackService 停掉，
 * 否则两个播放器一起出声（这一步在 MainActivity.startOverlay 里做）。
 *
 * 窗口用 TYPE_APPLICATION_OVERLAY（8.0 以下退回 TYPE_PHONE）+ SYSTEM_ALERT_WINDOW 权限。
 */
@OptIn(UnstableApi::class)
class OverlayService : Service() {
    private val main = Handler(Looper.getMainLooper())

    private var wm: WindowManager? = null
    private var root: View? = null
    private var video: TextureView? = null
    private var bar: View? = null
    private var btnPlay: TextView? = null
    private var tvTitle: TextView? = null
    private var tvTime: TextView? = null
    private var params: WindowManager.LayoutParams? = null
    private var player: ExoPlayer? = null

    /** 窗口是否还挂在 WindowManager 上（removeView 只能做一次） */
    private var attached = false
    /** 收尾流程只走一次：× 按钮、通知栏停止、onResume 收窗可能同时来 */
    private var stopping = false
    /** onClosed 只回调一次，否则页面会收到两条「已关闭」 */
    private var closedFired = false
    private var live = false
    private var curTitle = ""
    /** 有没有真的画出过一帧：黑屏排查用（有声音没画面时这一位是 false） */
    private var gotFrame = false

    // ---- 拖动 ----
    // 位置一律用「手指的屏幕绝对坐标 - 按下时的抓取偏移」算。
    // 绝对不能用相对增量：窗口一移动，下一帧的 e.x/e.y 就跟着变，窗口和手指互相追，
    // 表现就是发黏、跟不上手（这个坑以前踩过）。
    private var downRawX = 0f
    private var downRawY = 0f
    private var grabDx = 0f
    private var grabDy = 0f
    private var dragging = false
    private var lastTapUp = 0L
    private val touchSlop: Int by lazy { ViewConfiguration.get(this).scaledTouchSlop }

    // ---- 音频焦点（和 PlaybackService 同一套策略：来电/别的 App 抢焦点就暂停，拿回来再接上） ----
    private var focusRequest: android.media.AudioFocusRequest? = null
    private var hasFocus = false
    private var resumeOnFocusGain = false

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        val p = player ?: return@OnAudioFocusChangeListener
        try {
            when (change) {
                AudioManager.AUDIOFOCUS_LOSS -> {
                    // 声音被彻底收走（别的 App 开始长期播放）：这次播放结束，不自动恢复
                    resumeOnFocusGain = false
                    p.playWhenReady = false
                }
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT,
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                    // 来电、闹铃、语音助手：先暂停，拿回焦点后接着放
                    resumeOnFocusGain = p.playWhenReady
                    p.playWhenReady = false
                }
                AudioManager.AUDIOFOCUS_GAIN -> {
                    if (resumeOnFocusGain) p.playWhenReady = true
                    resumeOnFocusGain = false
                }
            }
        } catch (e: Exception) {
            Diag.log("overlay focus change failed: ${e.javaClass.simpleName}")
        }
    }

    companion object {
        const val ACTION_START = "com.replayradio.app.OVERLAY_START"
        /** 通知栏「停止」与页面 hideOverlay 共用；用户主动收窗 */
        const val ACTION_STOP = "com.replayradio.app.OVERLAY_STOP"
        private const val CHANNEL_ID = "replayradio_overlay"
        private const val NOTIF_ID = 1002
        private const val PREFS = "rr_overlay"
        private const val KEY_X = "x"
        private const val KEY_Y = "y"
        /** 小窗宽度（dp）；高度按 16:9 算 */
        private const val WINDOW_W_DP = 220f
        /** 松手吸附时离屏幕边缘留的空 */
        private const val EDGE_DP = 12
        /** 控制条显示多久后自己淡出 */
        private const val BAR_IDLE_MS = 3000L
        /** 单击/双击的判定窗口 */
        private const val DOUBLE_TAP_MS = 280L

        /**
         * 是否有一块悬浮窗在屏幕上（MainActivity.onResume 靠它决定要不要收）。
         * 只由本类的 onCreate/detach 改。
         */
        @Volatile
        var isShowing: Boolean = false
            private set

        /** 最后播放位置：收窗时 MainActivity 读它接着放，页面 overlayPosition() 也读它 */
        @Volatile
        var lastPosition: Long = 0L
            private set

        /**
         * 关窗回调：参数是最后播放位置，**-1 表示用户主动关的（别恢复）**。
         * MainActivity 在 onCreate 里挂上，onDestroy 里摘掉。
         */
        @Volatile
        var onClosed: ((Long) -> Unit)? = null

        @Volatile
        private var instance: OverlayService? = null

        /** 起窗；已经在显示时只是换片源（不重建窗口）。 */
        fun start(ctx: Context, url: String, title: String, posMs: Long, live: Boolean) {
            if (url.isEmpty()) return
            val i = Intent(ctx, OverlayService::class.java).apply {
                action = ACTION_START
                putExtra("url", url)
                putExtra("title", title)
                putExtra("positionMs", posMs)
                putExtra("live", live)
            }
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i)
                else ctx.startService(i)
            } catch (e: Exception) {
                Diag.log("overlay start failed: ${e.javaClass.simpleName}")
            }
        }

        /**
         * 收窗。returnPos=true 时会把当前位置交给 onClosed（回 App 接着放）；
         * false 表示「用户自己关的」，onClosed(-1)。
         * 服务没在跑时什么都不做（不白起一个进程）。
         */
        fun stop(ctx: Context, returnPos: Boolean) {
            val cur = instance
            if (cur == null) {
                isShowing = false
                return
            }
            cur.main.post { cur.shutdown(returnPos) }
        }
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
        Diag.log("OverlayService.onCreate")
        wm = getSystemService(WindowManager::class.java)
        createChannel()
        // 先抬成前台再建窗口：Android 12+ 后台起的前台服务超时会被直接杀掉
        startForegroundCompat()
        buildPlayer()
        buildWindow()
        isShowing = true
        main.postDelayed(ticker, 500)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> shutdown(returnPos = false)
            ACTION_START, null -> {
                // when 的主题是 intent?.action，这里 intent 仍是可空的：取参数要一路安全调用
                val url = intent?.getStringExtra("url") ?: ""
                if (url.isNotEmpty()) {
                    applyPlay(
                        url = url,
                        title = intent?.getStringExtra("title") ?: "哔哩吧啦",
                        posMs = intent?.getLongExtra("positionMs", 0L) ?: 0L,
                        isLive = intent?.getBooleanExtra("live", false) ?: false,
                    )
                }
            }
        }
        // 不 STICKY：系统重启一个没有片源参数的小窗只是块黑砖
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ---------------- 播放 ----------------

    private fun buildPlayer() {
        val p = ExoPlayer.Builder(this).build().apply {
            playWhenReady = true
            // 这台要出画面，所以不能像 PlaybackService 那样关视频轨
            setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                    .build(),
                // handleAudioFocus=false：焦点由本类自己管（见 focusListener），
                // 交给 ExoPlayer 它会另起一套监听器，和我们这条抢同一个焦点请求
                false
            )
            setHandleAudioBecomingNoisy(true)
            setWakeMode(C.WAKE_MODE_NETWORK)
            addListener(object : Player.Listener {
                override fun onIsPlayingChanged(isPlaying: Boolean) = updateBar()
                override fun onPlaybackStateChanged(state: Int) = updateBar()
                override fun onRenderedFirstFrame() {
                    // 有声音没画面时，这条日志能直接分清「没解码出帧」还是「有帧但没显示」
                    gotFrame = true
                    Diag.log("overlay first frame rendered")
                    tvTitle?.text = curTitle
                }
                override fun onPlayerError(error: PlaybackException) {
                    Diag.log("overlay player error: ${error.errorCodeName}")
                    // 出错别只剩一块黑：把原因摊在控制条上，用户一眼能说出是哪种
                    tvTitle?.text = "播放失败：" + error.errorCodeName
                    showBar()
                }
            })
        }
        player = p
    }

    /**
     * 把播放器接上 TextureView。
     * 必须在 addView 之后挂（TextureView 的 SurfaceTexture 是挂进窗口后才可用），
     * 而播放器要更早建好——所以 create 顺序是 buildPlayer() → buildWindow()。
     *
     * 这里不再手写 SurfaceTextureListener：ExoPlayer 的 setVideoTextureView 自己管
     * SurfaceTexture 的创建/销毁，窗口重建或纹理被回收时也能自己接回来。
     */
    private fun bindVideo(p: ExoPlayer) {
        val tv = video ?: return
        try {
            p.setVideoTextureView(tv)
        } catch (e: Exception) {
            Diag.log("overlay bindVideo failed: ${e.javaClass.simpleName}")
        }
        if (!tv.isHardwareAccelerated) {
            // clipToOutline / TextureView 都要求窗口是硬件加速的；
            // 说明 lp.flags 里的 FLAG_HARDWARE_ACCELERATED 没生效（被系统忽略时会走到这里）
            Diag.log("overlay window NOT hardware accelerated, corners may be square")
        }
    }

    /** 换片源 / 首次开播。直播不给起点也不给进度。 */
    private fun applyPlay(url: String, title: String, posMs: Long, isLive: Boolean) {
        val p = player ?: return
        live = isLive
        curTitle = title
        gotFrame = false
        tvTitle?.text = title
        tvTime?.visibility = if (isLive) View.GONE else View.VISIBLE
        requestFocus()
        val item = MediaItem.Builder()
            .setUri(url)
            .setMediaMetadata(MediaMetadata.Builder().setTitle(title).build())
            .build()
        try {
            p.setMediaItem(item, if (isLive) 0L else posMs.coerceAtLeast(0L))
            p.prepare()
            p.playWhenReady = true
        } catch (e: Exception) {
            Diag.log("overlay play failed: ${e.javaClass.simpleName}")
        }
        updateBar()
        notifyRefresh()
        showBar()
        // 6 秒还没出第一帧，就把状态摊到控制条上：比一块沉默的黑屏好定位
        main.removeCallbacks(frameProbe)
        main.postDelayed(frameProbe, 6000)
    }

    private val frameProbe = Runnable {
        val p = player ?: return@Runnable
        if (gotFrame) return@Runnable
        Diag.log("overlay no frame after 6s: state=${p.playbackState} pwr=${p.playWhenReady}")
        tvTitle?.text = "画面还在路上…"
        showBar()
    }

    private fun requestFocus(): Boolean {
        val am = getSystemService(AudioManager::class.java) ?: return false
        return try {
            val ok = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val attrs = android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MOVIE)
                    .build()
                val req = focusRequest ?: android.media.AudioFocusRequest
                    .Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attrs)
                    .setOnAudioFocusChangeListener(focusListener)
                    .setWillPauseWhenDucked(true)
                    .build()
                    .also { focusRequest = it }
                am.requestAudioFocus(req) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
            } else {
                @Suppress("DEPRECATION")
                am.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
            }
            hasFocus = ok
            // 抢不到也照放：小窗已经弹出来了，卡在这里只会变成「点了没反应」
            if (!ok) Diag.log("overlay audio focus denied (play anyway)")
            ok
        } catch (e: Exception) {
            Diag.log("overlay requestFocus failed: ${e.javaClass.simpleName}")
            false
        }
    }

    private fun abandonFocus() {
        hasFocus = false
        resumeOnFocusGain = false
        try {
            val am = getSystemService(AudioManager::class.java) ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                focusRequest?.let { am.abandonAudioFocusRequest(it) }
            } else {
                @Suppress("DEPRECATION")
                am.abandonAudioFocus(focusListener)
            }
        } catch (_: Exception) {}
    }

    // ---------------- 窗口 ----------------

    private fun buildWindow() {
        val w = wm ?: return
        val density = resources.displayMetrics.density
        val width = (WINDOW_W_DP * density).roundToInt()
        val height = (width * 9f / 16f).roundToInt()

        val view = LayoutInflater.from(this).inflate(R.layout.overlay_window, null)
        root = view
        video = view.findViewById(R.id.ovVideo)
        bar = view.findViewById(R.id.ovBar)
        btnPlay = view.findViewById(R.id.ovPlay)
        tvTitle = view.findViewById(R.id.ovTitle)
        tvTime = view.findViewById(R.id.ovTime)

        // 圆角暗容器（#0B0F14）+ 1dp 边光 rgba(255,255,255,.10)。
        // 圆角这次是真的裁出来的：根容器挂 roundRect outline + clipToOutline，
        // TextureView 的画面跟着视图层级一起被裁，四角露出下面 App 的画面
        // （窗口是 PixelFormat.TRANSLUCENT，裁掉的区域是透明而不是黑的）。
        val radius = 16 * density
        view.background = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            cornerRadius = radius
            setColor(Color.parseColor("#0B0F14"))
        }
        view.outlineProvider = object : ViewOutlineProvider() {
            override fun getOutline(v: View, outline: Outline) {
                outline.setRoundRect(0, 0, v.width, v.height, radius)
                outline.alpha = 1f
            }
        }
        view.clipToOutline = true
        // 画面自己也裁一遍：父容器裁的是整块窗口，万一某个 ROM 上父级 RenderNode 的裁剪
        // 没传到子层，视频四角还是会把圆角顶成方的——两层都挂，哪层生效都不会露方角
        video?.let { tv ->
            tv.outlineProvider = object : ViewOutlineProvider() {
                override fun getOutline(v: View, outline: Outline) {
                    outline.setRoundRect(0, 0, v.width, v.height, radius)
                    outline.alpha = 1f
                }
            }
            tv.clipToOutline = true
        }
        // 边光单独一层盖在画面上。向内缩半个线宽：描边是骑在边界上的，
        // 外半边会被上面的圆角裁掉，不缩的话看起来只剩 0.5dp 的虚边
        val hair = density.roundToInt().coerceAtLeast(1)
        view.findViewById<View>(R.id.ovBorder)?.background = InsetDrawable(
            GradientDrawable().apply {
                shape = GradientDrawable.RECTANGLE
                cornerRadius = radius
                setColor(Color.TRANSPARENT)
                setStroke(hair, Color.parseColor("#1AFFFFFF"))
            },
            (hair / 2).coerceAtLeast(1)
        )

        btnPlay?.setOnClickListener {
            val p = player ?: return@setOnClickListener
            p.playWhenReady = !p.playWhenReady
            updateBar()
            showBar()
        }
        view.findViewById<View>(R.id.ovBack)?.setOnClickListener { goBackToApp() }
        view.findViewById<View>(R.id.ovClose)?.setOnClickListener {
            // 用户主动关：-1，回 App 后页面别自动恢复
            shutdown(returnPos = false)
        }

        val (x0, y0) = initialPosition(width, height)
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        else
            @Suppress("DEPRECATION") WindowManager.LayoutParams.TYPE_PHONE
        val lp = WindowManager.LayoutParams(
            width,
            height,
            type,
            // NOT_FOCUSABLE：不抢输入焦点（也不会把下面的 App 顶住），且隐含 NOT_TOUCH_MODAL，
            // 所以点小窗以外的地方照常落到下面的应用；NO_LIMITS：允许拖到屏幕边缘外一点再看回来
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                // 必须显式要硬件加速：服务 addView 出来的窗口不会自动带上这个 flag
                // （只有 Activity 的窗口由框架加）。没有它 TextureView 就是一块黑砖，
                // clipToOutline 也会静默失效、圆角变方的。
                WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = x0
            y = y0
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                layoutInDisplayCutoutMode =
                    WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
            }
        }
        params = lp
        try {
            w.addView(view, lp)
            attached = true
        } catch (e: Exception) {
            Diag.log("overlay addView failed: ${e.javaClass.simpleName}: ${e.message}")
            stopSelf()
            return
        }
        view.setOnTouchListener { _, e -> onRootTouch(e) }
        player?.let { bindVideo(it) }
        showBar()
    }

    /**
     * 整窗拖动 + 单击切控制条 + 双击回 App。
     * 返回 true 表示这一次触摸我们吃掉了（拖动手感要紧，不能让父级再处理一遍）。
     */
    private fun onRootTouch(e: MotionEvent): Boolean {
        val p = params ?: return false
        val w = wm ?: return false
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downRawX = e.rawX
                downRawY = e.rawY
                // 抓取偏移：手指在小窗里的哪个位置，拖动时窗口就相对这个点平移
                grabDx = e.rawX - p.x
                grabDy = e.rawY - p.y
                dragging = false
                main.removeCallbacks(singleTap)
                showBar()
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (!dragging) {
                    val dx = e.rawX - downRawX
                    val dy = e.rawY - downRawY
                    if (abs(dx) > touchSlop || abs(dy) > touchSlop) {
                        dragging = true
                        main.removeCallbacks(singleTap)
                    }
                }
                if (dragging) {
                    p.x = (e.rawX - grabDx).toInt()
                    p.y = (e.rawY - grabDy).toInt()
                    try { w.updateViewLayout(root, p) } catch (_: Exception) {}
                }
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                if (dragging) {
                    dragging = false
                    snapToEdge()
                } else if (e.actionMasked == MotionEvent.ACTION_UP) {
                    val now = SystemClock.uptimeMillis()
                    if (now - lastTapUp <= DOUBLE_TAP_MS) {
                        // 双击：回 App
                        lastTapUp = 0L
                        main.removeCallbacks(singleTap)
                        goBackToApp()
                    } else {
                        // 单击：稍等一下再执行，免得双击时先闪一下控制条
                        lastTapUp = now
                        main.postDelayed(singleTap, DOUBLE_TAP_MS)
                    }
                }
                return true
            }
        }
        return false
    }

    private val singleTap = Runnable { toggleBar() }

    /** 松手吸附到最近的左右边，离边 12dp；纵向顺手夹回屏内，别让人把窗口拖丢。 */
    private fun snapToEdge() {
        val p = params ?: return
        val w = wm ?: return
        val dm = resources.displayMetrics
        val margin = dp(EDGE_DP)
        val target = if (p.x + p.width / 2 < dm.widthPixels / 2) {
            margin
        } else {
            (dm.widthPixels - p.width - margin).coerceAtLeast(margin)
        }
        val topMin = margin
        val topMax = (dm.heightPixels - p.height - margin).coerceAtLeast(topMin)
        p.y = p.y.coerceIn(topMin, topMax)
        val from = p.x
        // 吸附给一小段动画，瞬移看着像「窗口闪了一下」
        ValueAnimator.ofInt(from, target).setDuration(160).apply {
            addUpdateListener {
                p.x = it.animatedValue as Int
                try { w.updateViewLayout(root, p) } catch (_: Exception) {}
            }
            addListener(object : AnimatorListenerAdapter() {
                override fun onAnimationEnd(animation: Animator) {
                    savePosition(p.x, p.y)
                }
            })
            start()
        }
    }

    private fun initialPosition(windowW: Int, windowH: Int): Pair<Int, Int> {
        val dm = resources.displayMetrics
        val margin = dp(EDGE_DP)
        val sp = getSharedPreferences(PREFS, MODE_PRIVATE)
        val sx = sp.getInt(KEY_X, Int.MIN_VALUE)
        val sy = sp.getInt(KEY_Y, Int.MIN_VALUE)
        // 第一次：右上角，避开状态栏
        if (sx == Int.MIN_VALUE || sy == Int.MIN_VALUE) {
            return (dm.widthPixels - windowW - margin).coerceAtLeast(0) to (dp(88))
        }
        // 换分辨率/密度后旧坐标可能已经出屏，夹回来
        return sx.coerceIn(0, (dm.widthPixels - windowW).coerceAtLeast(0)) to
            sy.coerceIn(0, (dm.heightPixels - windowH).coerceAtLeast(0))
    }

    private fun savePosition(x: Int, y: Int) {
        try {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putInt(KEY_X, x).putInt(KEY_Y, y).apply()
        } catch (_: Exception) {}
    }

    // ---------------- 控制条 / 进度 ----------------

    private fun updateBar() {
        val p = player ?: return
        // 图标跟「用户想不想放」走：缓冲中 playWhenReady 已是 true，这时候给暂停按钮才对
        btnPlay?.text = if (p.playWhenReady) "‖" else "▶"
    }

    private fun showBar() {
        val b = bar ?: return
        main.removeCallbacks(hideBar)
        b.animate().cancel()
        b.visibility = View.VISIBLE
        b.alpha = 1f
        main.postDelayed(hideBar, BAR_IDLE_MS)
    }

    private val hideBar = Runnable {
        val b = bar ?: return@Runnable
        b.animate().alpha(0f).setDuration(180).setListener(object : AnimatorListenerAdapter() {
            override fun onAnimationEnd(animation: Animator) {
                b.visibility = View.GONE
                b.animate().setListener(null)
            }
        }).start()
    }

    private fun toggleBar() {
        val b = bar ?: return
        if (b.visibility == View.VISIBLE && b.alpha > 0.05f) {
            main.removeCallbacks(hideBar)
            hideBar.run()
        } else {
            showBar()
        }
    }

    /** 每 500ms 采一次：进度条文案 + 记住当前位置（收窗时要交给页面）。 */
    private val ticker = object : Runnable {
        override fun run() {
            try {
                val p = player
                if (p != null) {
                    val pos = p.currentPosition.coerceAtLeast(0L)
                    lastPosition = pos
                    if (!live) {
                        val dur = if (p.duration == C.TIME_UNSET) -1L else p.duration
                        tvTime?.text = if (dur > 0) "${fmt(pos)} / ${fmt(dur)}" else fmt(pos)
                        tvTime?.visibility = View.VISIBLE
                    } else {
                        tvTime?.visibility = View.GONE
                    }
                }
            } catch (_: Exception) {}
            main.postDelayed(this, 500)
        }
    }

    private fun fmt(ms: Long): String {
        val total = (ms / 1000).coerceAtLeast(0)
        val h = total / 3600
        val m = (total % 3600) / 60
        val s = total % 60
        return if (h > 0) String.format("%d:%02d:%02d", h, m, s)
        else String.format("%02d:%02d", m, s)
    }

    /** 回 App：小窗不自己收，MainActivity.onResume 会把它收掉并把位置接回去。 */
    private fun goBackToApp() {
        try {
            val i = Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_LAUNCHER)
                .setClass(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            startActivity(i)
        } catch (e: Exception) {
            Diag.log("overlay goBackToApp failed: ${e.javaClass.simpleName}")
        }
    }

    // ---------------- 收尾 ----------------

    /**
     * 收窗。returnPos=true 把当前位置交给 onClosed；false 表示用户主动关（-1）。
     * 幂等：× 按钮、通知栏停止、onResume 收窗可能先后打进来。
     */
    private fun shutdown(returnPos: Boolean) {
        if (stopping) return
        stopping = true
        main.removeCallbacksAndMessages(null)
        val p = player
        val pos = try {
            if (p != null) p.currentPosition.coerceAtLeast(0L) else lastPosition
        } catch (_: Exception) { lastPosition }
        if (pos > 0) lastPosition = pos
        try { p?.stop() } catch (_: Exception) {}
        detach()
        abandonFocus()
        fireClosed(if (returnPos) lastPosition else -1L)
        stopForeground(true)
        stopSelf()
    }

    private fun detach() {
        if (!attached) return
        attached = false
        isShowing = false
        try { params?.let { savePosition(it.x, it.y) } } catch (_: Exception) {}
        try { wm?.removeViewImmediate(root) } catch (_: Exception) {}
        root = null
        video = null
        bar = null
    }

    private fun fireClosed(pos: Long) {
        if (closedFired) return
        closedFired = true
        try { onClosed?.invoke(pos) } catch (e: Exception) {
            Diag.log("overlay onClosed failed: ${e.javaClass.simpleName}")
        }
    }

    override fun onDestroy() {
        instance = null
        isShowing = false
        main.removeCallbacksAndMessages(null)
        detach()
        try { player?.release() } catch (_: Exception) {}
        player = null
        abandonFocus()
        super.onDestroy()
    }

    // ---------------- 通知 ----------------

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(
                CHANNEL_ID, "悬浮窗播放", NotificationManager.IMPORTANCE_LOW
            ).apply { description = "退后台后用小窗继续播放" }
            getSystemService(NotificationManager::class.java)?.createNotificationChannel(ch)
        }
    }

    private fun buildNotification(): Notification {
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val stopPi = PendingIntent.getService(
            this, 1,
            Intent(this, OverlayService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            Notification.Builder(this, CHANNEL_ID)
        else
            @Suppress("DEPRECATION") Notification.Builder(this)
        @Suppress("DEPRECATION")
        return b.setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("哔哩吧啦 · 悬浮窗播放中")
            .setContentText(curTitle.ifEmpty { "点按回到哔哩吧啦" })
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(R.drawable.ic_notification, "停止", stopPi)
            .build()
    }

    private fun startForegroundCompat() {
        val n = buildNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            @Suppress("DEPRECATION") startForeground(NOTIF_ID, n)
        }
    }

    private fun notifyRefresh() {
        try {
            getSystemService(NotificationManager::class.java)?.notify(NOTIF_ID, buildNotification())
        } catch (_: Exception) {}
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).roundToInt()
}
