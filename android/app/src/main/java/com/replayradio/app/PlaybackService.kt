package com.replayradio.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import androidx.annotation.OptIn
import androidx.core.content.ContextCompat
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** 后台播放：ExoPlayer + MediaSession，通知/锁屏可控制；支持 JS 直接指定媒体，也支持按排期自动切段。 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private var player: ExoPlayer? = null
    private var session: MediaSession? = null
    private val scope = CoroutineScope(Dispatchers.Main + Job())

    // ---- 音频焦点 / 拔耳机（7.1：来电、闹铃、拔耳机都要暂停） ----
    // ExoPlayer 自己的焦点处理在下面被关掉了（setAudioAttributes(..., false)）：
    // 谁最后 requestAudioFocus，谁的回调才生效 —— 两套都开只会互相抢监听器。
    private var focusRequest: android.media.AudioFocusRequest? = null
    private var hasFocus = false
    /** 因「短暂打断」而暂停时记下来：拿回焦点后要自己接着放，用户没按过暂停 */
    private var resumeOnFocusGain = false

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        val p = player ?: return@OnAudioFocusChangeListener
        try {
            when (change) {
                AudioManager.AUDIOFOCUS_LOSS -> {
                    // 声音被彻底收走（别的 App 开始长期播放）：这场播放结束，不自动恢复
                    resumeOnFocusGain = false
                    p.playWhenReady = false
                }
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT -> {
                    // 来电、闹铃、语音助手：先暂停，拿回焦点后接着放
                    resumeOnFocusGain = p.playWhenReady
                    p.playWhenReady = false
                }
                AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK -> {
                    // 我们只有声音，压低音量会让人以为卡了；按短暂打断处理
                    resumeOnFocusGain = p.playWhenReady
                    p.playWhenReady = false
                }
                AudioManager.AUDIOFOCUS_GAIN -> {
                    if (resumeOnFocusGain) p.playWhenReady = true
                    resumeOnFocusGain = false
                }
            }
        } catch (e: Exception) {
            Diag.log("focus change failed: ${e.javaClass.simpleName}")
        }
    }

    /** 拔耳机 / 断蓝牙：立刻停，别让声音从外放喷出来。 */
    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(ctx: Context?, intent: Intent?) {
            if (intent?.action != AudioManager.ACTION_AUDIO_BECOMING_NOISY) return
            try { player?.playWhenReady = false } catch (_: Exception) {}
        }
    }

    private fun audioManager(): AudioManager? = try {
        getSystemService(AudioManager::class.java)
    } catch (_: Exception) { null }

    /** 取音频焦点；失败也继续放（本地电台，抢不到焦点时不该变成「按了没反应」）。 */
    private fun requestFocus(): Boolean {
        val am = audioManager() ?: return false
        return try {
            val ok = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val attrs = android.media.AudioAttributes.Builder()
                    .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
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
            if (!ok) Diag.log("audio focus denied (play anyway)")
            ok
        } catch (e: Exception) {
            Diag.log("requestFocus failed: ${e.javaClass.simpleName}")
            false
        }
    }

    private fun abandonFocus() {
        hasFocus = false
        resumeOnFocusGain = false
        try {
            val am = audioManager() ?: return
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                focusRequest?.let { am.abandonAudioFocusRequest(it) }
            } else {
                @Suppress("DEPRECATION")
                am.abandonAudioFocus(focusListener)
            }
        } catch (_: Exception) {}
    }

    companion object {
        const val ACTION_START = "com.replayradio.app.START"
        const val ACTION_PLAY = "com.replayradio.app.PLAY"
        const val ACTION_STOP = "com.replayradio.app.STOP"
        const val ACTION_SEEK = "com.replayradio.app.SEEK"
        const val ACTION_RATE = "com.replayradio.app.RATE"
        const val CHANNEL_ID = "replayradio_playback"

        /**
         * 当前是否真的在出声（自动画中画判定用，只读给外部）。
         * 写入点只有下面的 syncPlaying：ExoPlayer 的 isPlaying / 播放状态变化时同步过来，
         * 所以暂停、停止、播完、被来电抢焦点、拔耳机都会如实反映。
         */
        @Volatile
        var isPlaying: Boolean = false
            private set

        /** 唯一写入点；放在 companion 里，外部拿不到 setter。 */
        fun syncPlaying(playing: Boolean) {
            isPlaying = playing
        }
    }

    override fun onCreate() {
        super.onCreate()
        Diag.log("PlaybackService.onCreate")
        try { ApiClient.ensureServer(this) } catch (e: Exception) { Diag.log("ensureServer in service FAILED: ${e.message}") }
        createChannel()
        setMediaNotificationProvider(
            DefaultMediaNotificationProvider.Builder(this).setChannelId(CHANNEL_ID).build()
        )
        // 画面由 WebView 里的 <video> 出，这台播放器只管声音：
        // 关掉视频轨（少解一路 1080p，发热和掉帧都会降），缓冲按「开得快、断得少」调。
        val tracks = DefaultTrackSelector(this).apply {
            setParameters(buildUponParameters().setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, true))
        }
        val load = DefaultLoadControl.Builder()
            .setBufferDurationsMs(10_000, 60_000, 400, 800)
            .setBackBuffer(20_000, true)
            .setPrioritizeTimeOverSizeThresholds(true)
            .build()
        player = ExoPlayer.Builder(this)
            .setTrackSelector(tracks)
            .setLoadControl(load)
            .setSeekBackIncrementMs(10_000)
            .setSeekForwardIncrementMs(10_000)
            .build().apply {
                playWhenReady = true
                repeatMode = Player.REPEAT_MODE_OFF
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(C.USAGE_MEDIA)
                        .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
                        .build(),
                    // handleAudioFocus=false：焦点由本类自己管（见 focusListener）。
                    // 交给 ExoPlayer 的话，它 requestAudioFocus 时会把我们的监听器顶掉，
                    // 两条路径只能留一条，留自己能控制「短暂打断后恢复」的那条。
                    false
                )
                // 拔耳机双保险：这里再挂一次，两处都只是 playWhenReady=false，重复无害。
                setHandleAudioBecomingNoisy(true)
                setWakeMode(C.WAKE_MODE_NETWORK)
            }
        session = MediaSession.Builder(this, player!!).build()

        // 播放态同步（自动画中画只认它）：暂停、停止、播完、焦点被抢、拔耳机都会走到这里。
        player?.addListener(object : Player.Listener {
            override fun onIsPlayingChanged(isNowPlaying: Boolean) {
                syncPlaying(isNowPlaying)
            }

            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_IDLE || state == Player.STATE_ENDED) syncPlaying(false)
            }
        })

        // 拔耳机/断蓝牙的广播；ContextCompat 会按版本补上 RECEIVER_NOT_EXPORTED，
        // 这个广播只有系统会发，导出没意义。
        try {
            ContextCompat.registerReceiver(this, noisyReceiver,
                IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
                ContextCompat.RECEIVER_NOT_EXPORTED)
        } catch (e: Exception) {
            Diag.log("noisy receiver FAILED: ${e.javaClass.simpleName}")
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // seek / rate 是对「正在播的那首歌」的一次操作：它们不产生新的播放会话，
        // 更不能走 startForeground —— 否则通知栏会平白闪一条、同步逻辑也会被带起来。
        // player 还没创建时直接忽略（页面刚打开就拖进度条不该把服务拉成前台）。
        when (intent?.action) {
            ACTION_SEEK -> {
                player?.let { p ->
                    p.seekTo(intent.getLongExtra("positionMs", 0L).coerceAtLeast(0L))
                }
                return START_STICKY
            }
            ACTION_RATE -> {
                val rate = intent.getFloatExtra("rate", 1f)
                // 0 / 负数 / NaN 会让 ExoPlayer 抛异常，先挡掉；上限按常见播放器习惯收在 4x
                if (rate.isFinite() && rate > 0f) player?.setPlaybackSpeed(rate.coerceIn(0.25f, 4f))
                return START_STICKY
            }
        }

        // STOP 只是收尾：先弹通知再收，状态栏会闪一条，没必要
        if (intent?.action == ACTION_STOP) {
            player?.stop(); abandonFocus(); stopForeground(true); stopSelf(); return START_NOT_STICKY
        }

        val notification = createPlaceholderNotification()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(1001, notification, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            @Suppress("DEPRECATION") startForeground(1001, notification)
        }
        when (intent?.action) {
            ACTION_STOP -> { player?.stop(); abandonFocus(); stopForeground(true); stopSelf(); return START_NOT_STICKY }
            ACTION_PLAY -> {
                val url = intent.getStringExtra("url") ?: ""
                val title = intent.getStringExtra("title") ?: "哔哩吧啦"
                val pos = intent.getLongExtra("positionMs", 0)
                val cover = intent.getStringExtra("cover") ?: ""
                val key = intent.getStringExtra("key") ?: ""
                if (url.isNotEmpty()) playDirect(title, url, pos, cover, key)
            }
            // 其它情况（尤其是 START_STICKY 被系统重启时 intent 为 null）什么都别做。
            // 以前这里会按 /api/now 每 5 秒自己切一期 —— 页面显示的是用户
            // 选的这期，声音却跳到 24 小时循环里的另一期，就是「音画不是同一个视频」。
            else -> Unit
        }
        return START_STICKY
    }

    private fun playDirect(title: String, url: String, pos: Long, cover: String = "", key: String = "") {
        val p = player ?: return
        // 开播前后各要一次焦点：拿不到也照放（本地电台），但拿到了才能在
        // 「来电短暂打断」结束后靠 AUDIOFOCUS_GAIN 自己接上。
        requestFocus()
        val meta = MediaMetadata.Builder().setTitle(title).setArtist("24H 电台")
        // 封面可选：直播/旧调用没有封面，空串不能塞给 Uri.parse（会得到协议为空的怪 Uri）
        if (cover.isNotEmpty()) meta.setArtworkUri(Uri.parse(cover))
        val item = MediaItem.Builder().setUri(url)
            .setMediaId(key)          // mediaId = bvid|cid：页面可以读回来核对「放的是不是同一期」
            .setMediaMetadata(meta.build())
            .build()
        p.setMediaItem(item, pos.coerceAtLeast(0))
        p.prepare(); p.playWhenReady = true
    }

    override fun onGetSession(info: MediaSession.ControllerInfo): MediaSession? = session

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val ch = NotificationChannel(CHANNEL_ID, getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW)
                .apply { description = getString(R.string.channel_desc) }
            getSystemService(NotificationManager::class.java).createNotificationChannel(ch)
        }
    }

    private fun createPlaceholderNotification(): android.app.Notification {
        val pi = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
            android.app.Notification.Builder(this, CHANNEL_ID)
        else @Suppress("DEPRECATION") android.app.Notification.Builder(this)
        return b.setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(getString(R.string.notif_text))
            .setContentIntent(pi).setOngoing(true).build()
    }

    override fun onDestroy() {
        try { unregisterReceiver(noisyReceiver) } catch (_: Exception) {}
        syncPlaying(false)
        abandonFocus()
        session?.release(); player?.release(); super.onDestroy()
    }
}
