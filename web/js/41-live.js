/* ============================================================
   live · 直播视图（js/41-live.js）
   - FLV 舞台：mpegts.js 优先 playinfo.flv 直连，失败回落 /api/live/stream?room=&qn=
   - 全屏：#view-live.is-fs + AndroidRadio.setFullscreen/setOrientation（DOM 全屏只兜底）
   - 实时弹幕：SSE /api/live/chat/stream?station=
   - 发送：POST /api/live/send（表情带 emoticonOptions）
   - 表情：GET /api/live/emoticons?room=
   单个 IIFE + 'use strict'；只往 RR 挂模块，不污染其它全局。
   依赖 00-core 的 RR.*；缺什么就用本文件的局部 helper 兜住，绝不硬崩。
   ============================================================ */
(function () {
  'use strict';

  var RR = window.RR || (window.RR = {});

  /* WebView 对无源 <video> 的默认占位是「灰底 + 黑椭圆 + 三角」，用海报盖掉；
     出帧后浏览器自动隐藏 poster，不用手动清。 */
  var IDLE_ART = '/assets/idle.webp';
  var DIRECT_FIRST_FRAME_MS = 8000;

  /* ---------------- 局部 helper（00-core 尚未落地时的兜底） ---------------- */

  function q(sel, root) {
    if (typeof RR.$ === 'function') { try { return RR.$(sel, root); } catch (e) {} }
    return (root || document).querySelector(sel);
  }

  function mk(tag, cls, text) {
    var n = null;
    if (typeof RR.el === 'function') { try { n = RR.el(tag, cls); } catch (e) { n = null; } }
    if (!n) { n = document.createElement(tag); if (cls) n.className = cls; }
    if (text != null) n.textContent = text;
    return n;
  }

  function cnt(n) {
    n = Number(n) || 0;
    if (typeof RR.fmtCount === 'function') { try { return RR.fmtCount(n); } catch (e) {} }
    if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
    if (n >= 10000) return (n / 10000).toFixed(1) + '万';
    return String(Math.round(n));
  }

  function toast(text, kind) {
    if (typeof RR.toast === 'function') { try { RR.toast(text, kind); } catch (e) {} }
  }

  function emit(evt, data) {
    if (typeof RR.emit === 'function') { try { RR.emit(evt, data); } catch (e) {} }
  }

  function settings() {
    if (typeof RR.settings === 'function') { try { return RR.settings() || {}; } catch (e) {} }
    return {};
  }

  function saveSettings(patch) {
    if (typeof RR.saveSettings === 'function') { try { RR.saveSettings(patch); } catch (e) {} }
  }

  function storeGet(key, def) {
    if (RR.store && typeof RR.store.get === 'function') { try { return RR.store.get(key, def); } catch (e) {} }
    return def;
  }

  function storeSet(key, val) {
    if (RR.store && typeof RR.store.set === 'function') { try { RR.store.set(key, val); } catch (e) {} }
  }

  // RR.api 缺位时用 fetch 兜一份同样「失败即抛、带 .status」的语义
  function api(path, opts) {
    if (typeof RR.api === 'function') { try { return RR.api(path, opts); } catch (e) { return Promise.reject(e); } }
    var init = { method: (opts && opts.method) || 'GET', headers: { Accept: 'application/json' } };
    if (opts && opts.body != null) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch(path, init).then(function (r) {
      return r.text().then(function (t) {
        var j = {};
        try { j = t ? JSON.parse(t) : {}; } catch (e) { j = {}; }
        if (!r.ok) {
          var err = new Error((j && j.error) || ('HTTP ' + r.status));
          err.status = r.status;
          throw err;
        }
        return j;
      });
    });
  }

  function post(path, body) {
    if (typeof RR.post === 'function') { try { return RR.post(path, body); } catch (e) { return Promise.reject(e); } }
    return api(path, { method: 'POST', body: body });
  }

  /* 图标：优先 RR.ICO；只有 00-core 缺位时才用下面的等价兜底（同样 24 网格 / 1.75 描边 / 圆头） */
  var FALLBACK_ICON = {
    expand: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H4v5"/><path d="M15 4h5v5"/><path d="M20 15v5h-5"/><path d="M4 15v5h5"/></svg>',
    collapse: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h5V4"/><path d="M20 9h-5V4"/><path d="M15 20v-5h5"/><path d="M9 20v-5H4"/></svg>',
    volume: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6a9 9 0 0 1 0 12"/></svg>',
    mute: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="M16 9.5l5 5"/><path d="M21 9.5l-5 5"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.35-5.66"/><path d="M20 4v4.5h-4.5"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>'
  };

  function ico(name) {
    if (typeof RR.ICO === 'function') { try { var s = RR.ICO(name); if (s) return s; } catch (e) {} }
    return FALLBACK_ICON[name] || '';
  }

  function humanErr(msg) {
    var m = String(msg == null ? '' : msg);
    if (!m || /failed to fetch|networkerror|network error|load failed|timeout/i.test(m)) return '网络没有响应，等一下再试';
    if (/unknown endpoint|not found/i.test(m)) return '这个接口还没接通';
    return m.slice(0, 46) || '出了点问题，等一下再试';
  }

  function errText(err) {
    var s = err && err.status;
    if (s === 404) return '本机服务里还没有这个接口';
    if (!s || s >= 500) return '网络没有响应';
    return humanErr(err && err.message);
  }

  /* ---------------- 状态 ---------------- */

  var D = {};          // DOM 引用
  var st = {
    mounted: false,
    active: false,
    living: false,
    state: 'idle',
    info: null,
    stationId: '',
    room: '',
    qn: 0,
    qualities: [],
    online: 0,
    muted: true,
    player: null,
    pendDestroy: null,
    pendTimer: 0,
    streamTimer: 0,
    streamRetry: 0,
    chaseTimer: 0,
    wdTimer: 0,
    lastChase: 0,
    wdAt: 0,
    stall: 0,
    lastPlayTry: 0,
    directUrl: '',        // playinfo.flv：B 站 CDN 直连 FLV
    directQn: 0,          // playinfo.flv_qn：这条直连对应的画质
    noDirect: false,      // 这一路直连失败过，别再试
    curDirect: false,     // 当前这次 attempt 是不是直连
    firstTimer: 0,        // 直连首帧超时
    fbTimer: 0,           // 直连 → 中转的下一拍
    es: null,
    esTimer: 0,
    esRetry: 0,
    follow: true,
    unseen: 0,
    feedCount: 0,
    sending: false,
    needLogin: false,
    acct: null,
    loginHintAt: 0,
    fsOn: false,
    fsApplied: false,     // 真的动过系统栏/方向，退出时要还回去
    fsTimer: 0,           // 旋屏/系统栏的二次确认（有些机型第一下会被忽略）
    bodyOverflow: null,
    chromeHidden: null,   // 全屏时临时藏起来的顶栏 / dock / mini
    emo: { packs: [], pack: 0, loaded: false, loading: false, room: '', picked: null, open: false },
    sw: null,        // 切档现场：{ target, from, tries, armed, timer }
    swPill: null,    // 舞台右上角「正在切到 X…」
    hold: null,      // 切档定格帧 canvas
    holdTimer: 0
  };

  /* ---------------- 挂载 ---------------- */

  function mount() {
    if (st.mounted) return true;
    var root = document.getElementById('view-live');
    if (!root) return false;
    st.root = root;

    D = {
      stage: q('#live-stage', root),
      video: q('#live-video', root),
      badge: q('#live-badge', root),
      badgetxt: q('#live-badgetxt', root),
      fs: q('#live-fs', root),
      note: q('#live-note', root),
      noteT: q('#live-note-t', root),
      retry: q('#live-retry', root),
      off: q('#live-offline', root),
      offS: q('#live-off-s', root),
      goChannel: q('#live-go-channel', root),
      title: q('#live-title', root),
      uname: q('#live-uname', root),
      online: q('#live-online', root),
      ctl: q('#live-ctl', root),
      qn: q('#live-qn', root),
      mute: q('#live-mute', root),
      refresh: q('#live-refresh', root),
      panel: q('#live-panel', root),
      conn: q('#live-conn', root),
      connTxt: q('#live-conntxt', root),
      feed: q('#live-chat', root),
      empty: q('#live-chat-empty', root),
      neu: q('#live-new', root),
      neuTxt: q('#live-newtxt', root),
      loginbar: q('#live-loginbar', root),
      login: q('#live-login', root),
      form: q('#live-form', root),
      input: q('#live-input', root),
      send: q('#live-send', root),
      emoBtn: q('#live-emo-btn', root),
      emo: q('#live-emo', root),
      emoTabs: q('#live-emotabs', root),
      emoGrid: q('#live-emogrid', root),
      emoMsgWrap: q('#live-emomsgwrap', root),
      emoMsg: q('#live-emomsg', root),
      emoRetry: q('#live-emoretry', root),
      emoPrev: q('#live-emoprev', root),
      emoImg: q('#live-emoimg', root),
      emoName: q('#live-emoname', root),
      emoSend: q('#live-emosend', root),
      emoCancel: q('#live-emocancel', root)
    };

    if (!D.stage || !D.video) return false;
    st.mounted = true;

    /* 海报双保险：views/live.html 已写死 poster，装配/替换时丢了也能补回来 */
    if (D.video && !D.video.getAttribute('poster')) D.video.setAttribute('poster', IDLE_ART);

    if (D.fs) D.fs.innerHTML = ico('expand');
    if (D.mute) D.mute.innerHTML = ico('mute');
    if (D.refresh) D.refresh.innerHTML = ico('refresh');
    bind();
    return true;
  }

  function on(node, evt, fn, opts) {
    if (node) node.addEventListener(evt, fn, opts || false);
  }

  function bind() {
    on(D.fs, 'click', toggleFs);
    on(D.retry, 'click', function () { retryNow(); });
    on(D.goChannel, 'click', function () {
      if (typeof RR.go === 'function') RR.go('channel');
    });
    on(D.qn, 'click', pickQuality);
    on(D.mute, 'click', toggleMute);
    on(D.refresh, 'click', function () {
      if (!st.living) return;
      st.streamRetry = 0;
      toast('正在刷新直播流');
      setState('reconnect', '正在重新拉流…', false);
      startStream();
    });

    on(D.video, 'playing', function () {
      clearFirstFrame();
      if (st.living && st.state !== 'live') setState('live');
      if (st.sw) onSwitchFrame();
    });
    on(D.video, 'loadeddata', clearFirstFrame);
    on(D.video, 'error', function () {
      if (!st.living || !st.player) return;
      if (fallbackDirect()) return;
      scheduleReconnect('播放器报错');
    });

    on(D.form, 'submit', function (e) {
      if (e && e.preventDefault) e.preventDefault();
      submit();
    });
    on(D.input, 'input', updateSend);
    on(D.input, 'keydown', function (e) {
      if (e && (e.key === 'Enter' || e.keyCode === 13)) {
        if (e.preventDefault) e.preventDefault();
        submit();
      }
    });
    on(D.input, 'focus', function () {
      if (st.needLogin || loggedOut()) hintLogin();
    });

    on(D.feed, 'scroll', onFeedScroll, { passive: true });
    on(D.neu, 'click', toBottom);

    on(D.login, 'click', function () {
      toast('扫码登录在「我的」里');
      if (typeof RR.go === 'function') RR.go('me');
    });

    on(D.emoBtn, 'click', toggleEmo);
    on(D.emoSend, 'click', sendEmoji);
    on(D.emoCancel, 'click', closeEmoPick);
    on(D.emoRetry, 'click', function () { loadEmoticons(true); });

    if (typeof RR.on === 'function') {
      try { RR.on('station', onStationEvt); } catch (e) {}
    }
    document.addEventListener('fullscreenchange', onFsChange, false);
    document.addEventListener('webkitfullscreenchange', onFsChange, false);
    document.addEventListener('keydown', onKeyDown, true);
  }

  /* 系统返回/物理键盘退出：能收到 DOM 全屏事件就摘 class，
     收不到的话 native 会调 window.__rrExitFs（见文件末尾的包装）。 */
  function onKeyDown(e) {
    if (!e || !st.fsOn) return;
    if (e.key !== 'Escape' && e.key !== 'Esc' && e.keyCode !== 27) return;
    if (e.preventDefault) e.preventDefault();
    exitFs();
  }

  /* ---------------- 生命周期 ---------------- */

  function enter() {
    if (!mount()) return;
    if (st.active) return;
    st.active = true;

    /* 音频仲裁（8.0 新口径）：进直播页不再停回放，回放跨界面继续；
       只有用户把直播开声（applyMute 非静音路径 / 流带声起播）时才先停回放。 */
    abortSwitch();

    var sst = station();
    var sid = String(sst.id || sst.mid || '');
    // 离开直播页时也可能切过台：换了主播就不认上次记的画质，也重新给直连机会
    var switched = !!(sid && st.stationId && sid !== st.stationId);
    if (switched) {
      storeSet('liveQn', 0);
      resetDirect();
    }

    var s = settings();
    st.muted = s.liveMuted !== false;      // 契约：直播默认静音
    st.qn = Number(storeGet('liveQn', 0)) || 0;
    st.streamRetry = 0;
    st.esRetry = 0;
    st.online = 0;
    st.feedCount = 0;
    st.needLogin = false;
    st.sending = false;
    st.unseen = 0;
    st.follow = true;

    st.stationId = sid || st.stationId;
    st.room = String(sst.room || st.room || '');

    if (D.feed) D.feed.innerHTML = '';
    if (D.empty) D.empty.hidden = false;
    if (D.neu) D.neu.hidden = true;
    if (D.panel) D.panel.hidden = true;
    if (D.emo) D.emo.hidden = true;
    if (D.emoBtn) D.emoBtn.setAttribute('aria-expanded', 'false');
    closeEmoPick();
    applyMute(true);       // 进门只同步静音态，不动回放；真正出声在 startStream/取消静音时仲裁
    updateSend();
    refreshAccount();
    emit('live-state', { living: false, room: st.room });

    loadInfo();
  }

  function leave() {
    if (!st.mounted) return;
    st.active = false;
    st.living = false;
    st.state = 'idle';
    st.sending = false;
    abortSwitch();                 // 切档定格帧/胶囊跟着离场，别留在隐藏视图里
    closeChat();
    stopTimers();
    exitFs(true);
    if (D.emo) D.emo.hidden = true;
    if (D.emoBtn) D.emoBtn.setAttribute('aria-expanded', 'false');
    closeEmoPick();
    // 保最后一帧：先暂停，destroy 延后 60ms（契约 §task 4）
    stopStream(true);
    if (D.send) D.send.disabled = true;
    emit('live-state', { living: false, room: st.room });
  }

  function onStationEvt() {
    if (!st.active) return;
    var s = station();
    var id = String(s.id || s.mid || '');
    if (id && id === st.stationId) return;
    st.stationId = id;
    st.room = String(s.room || '');
    st.qn = 0;
    storeSet('liveQn', 0);         // 切台重置画质记忆
    resetDirect();                 // 换主播：直连地址和失败标记一起清零
    st.streamRetry = 0;
    st.online = 0;
    st.feedCount = 0;
    st.emo.loaded = false;
    st.emo.packs = [];
    st.emo.pack = 0;
    st.emo.room = '';
    abortSwitch();
    closeEmoPick();
    closeChat();
    stopTimers();
    stopStream(true);
    if (D.feed) D.feed.innerHTML = '';
    if (D.empty) D.empty.hidden = false;
    if (D.panel) D.panel.hidden = true;
    loadInfo();
  }

  function station() {
    var s = null;
    if (typeof RR.station === 'function') { try { s = RR.station(); } catch (e) { s = null; } }
    if (!s && typeof RR.stations === 'function') {
      try { var all = RR.stations() || []; s = all[0] || null; } catch (e) { s = null; }
    }
    return s || {};
  }

  /* ---------------- 直播信息 ---------------- */

  function loadInfo() {
    var s = station();
    if (s && s.id) st.stationId = String(s.id);
    if (s && s.room) st.room = String(s.room);
    if (!st.stationId && !st.room) {
      setState('error', '还没选主播，先在顶部挑一位。', true);
      return;
    }

    var p1 = '/api/live/playinfo?station=' + encodeURIComponent(st.stationId) +
      (st.room ? '&room=' + encodeURIComponent(st.room) : '');
    setState('loading', '正在连到直播间…', false);

    api(p1).then(null, function (e1) {
      if (!st.room) throw e1;
      // playinfo 不可用时退到轻量 brief（形状见契约 §7）
      return api('/api/live/brief?room=' + encodeURIComponent(st.room)).then(function (b) {
        return {
          living: !!(b && b.living),
          title: (b && b.title) || '',
          online: (b && b.online) || 0,
          room: (b && b.room) || st.room,
          uname: s && s.name,
          qualities: []
        };
      });
    }).then(onInfo).catch(function (err) {
      st.info = null;
      st.living = false;
      abortSwitch();
      if (D.panel) D.panel.hidden = true;
      setState('error', '连不上直播间：' + errText(err) + '。', true);
      emit('live-state', { living: false, room: st.room });
    });
  }

  function onInfo(info) {
    st.info = info || {};
    st.online = Number(st.info.online) || 0;
    if (st.info.room) st.room = String(st.info.room);

    /* 8.0.1 playinfo 会带 B 站 CDN 直连 FLV（CORS *）与它对应的画质；
       没有（或退回 brief）就留空，取流自动走本机中转。 */
    st.directUrl = typeof st.info.flv === 'string' ? st.info.flv : '';
    st.directQn = Number(st.info.flv_qn) || 0;
    st.curDirect = false;

    /* 接口只回 1 档（HLS-only 房间很常见）时补齐常见档，让画质按钮可点；
       后端给了 accept_qn 就以它为准过滤（不可用档不显示，后端也会兜底回落）。 */
    st.qualities = normalizeQualities(st.info);
    if (!st.qn) {
      st.qn = Number(st.info.current_qn) || Number(st.info.qn) ||
        (st.qualities[0] ? Number(st.qualities[0].qn) : 0) || 0;
    }
    if (st.qn && st.qualities.length && !hasQuality(st.qn)) {
      st.qn = Number(st.qualities[0].qn) || 0;
      storeSet('liveQn', st.qn);
    }

    renderMeta();

    var living = !!st.info.living;
    st.living = living;

    if (living) {
      st.streamRetry = 0;
      st.wdAt = 0;
      st.stall = 0;
      setState('live');
      if (D.panel) D.panel.hidden = false;
      if (D.empty) D.empty.hidden = !!st.feedCount;
      updateSend();
      startStream();
      openChat();
      loadEmoticons(false);
      startTimers();
      emit('live-state', { living: true, room: st.room });
    } else {
      abortSwitch();
      setState('offline');
      if (D.panel) D.panel.hidden = true;
      closeChat();
      stopTimers();
      stopStream(false);
      emit('live-state', { living: false, room: st.room });
    }
  }

  function renderMeta() {
    var info = st.info || {};
    var s = station();
    var name = info.uname || s.name || '主播';
    if (D.title) D.title.textContent = info.title ? String(info.title) : '直播间';
    if (D.uname) D.uname.textContent = name;
    if (D.offS) D.offS.textContent = name + ' 这会儿不在直播间。节目带里存着每一次现场。';
    if (D.online) D.online.textContent = st.online > 0 ? cnt(st.online) + ' 人气' : '人气统计中';
    renderQuality();
  }

  function renderQuality() {
    if (!D.qn) return;
    var qn = Number(st.qn) || (st.qualities[0] ? Number(st.qualities[0].qn) : 0);
    var label = qn ? qnLabel(qn) : (st.qualities.length ? (st.qualities[0].desc || '原画') : '原画');
    D.qn.textContent = label;
    D.qn.setAttribute('aria-label', '清晰度：' + label);
    D.qn.hidden = st.qualities.length < 2;
  }

  function setPopularity(v) {
    st.online = Number(v) || 0;
    if (D.online) D.online.textContent = st.online > 0 ? cnt(st.online) + ' 人气' : '人气统计中';
  }

  /* ---------------- 舞台状态 ---------------- */

  function setState(s, t, retry) {
    st.state = s;
    if (!D.stage) return;
    D.stage.setAttribute('data-state', s);

    var living = (s === 'live' || s === 'reconnect');
    if (D.badge) {
      D.badge.hidden = !living;
      if (living) {
        D.badge.classList.toggle('is-warn', s === 'reconnect');
        if (D.badgetxt) D.badgetxt.textContent = s === 'reconnect' ? '重连中' : '直播中';
      }
    }

    var showNote = (s === 'loading' || s === 'reconnect' || s === 'error');
    if (D.note) D.note.hidden = !showNote;
    if (showNote) {
      if (t != null && D.noteT) D.noteT.textContent = t;
      if (D.retry) D.retry.hidden = !retry;
    }
    if (D.off) D.off.hidden = (s !== 'offline');
    if (D.fs) D.fs.hidden = !living;
    setControls(living);
  }

  function setControls(on2) {
    if (D.ctl) D.ctl.classList.toggle('is-off', !on2);
    var b = [D.qn, D.mute, D.refresh];
    for (var i = 0; i < b.length; i++) if (b[i]) b[i].disabled = !on2;
    if (D.qn) D.qn.hidden = st.qualities.length < 2;
  }

  function retryNow() {
    if (!st.active) return;
    st.streamRetry = 0;
    st.esRetry = 0;
    if (st.info && st.info.living) {
      setState('loading', '正在重连…', false);
      startStream();
      openChat();
    } else {
      loadInfo();
    }
  }

  /* ---------------- 直播流（mpegts） ---------------- */

  // 换主播 / 首进：直连地址与失败标记整组清零
  function resetDirect() {
    st.directUrl = '';
    st.directQn = 0;
    st.noDirect = false;
    st.curDirect = false;
  }

  // 直连优先；没有地址 / 这一路失败过 / 画质和 flv_qn 对不上，就回本机中转
  function directFor(qn) {
    if (st.noDirect || !st.directUrl) return '';
    var dq = Number(st.directQn) || 0;
    if (dq && qn && dq !== Number(qn)) return '';
    return st.directUrl;
  }

  function relayUrl() {
    return '/api/live/stream?room=' + encodeURIComponent(st.room || st.stationId) +
      (st.qn ? '&qn=' + encodeURIComponent(st.qn) : '');
  }

  function clearFirstFrame() {
    if (st.firstTimer) { clearTimeout(st.firstTimer); st.firstTimer = 0; }
  }

  // 直连 8s 还没数据就当这一路不可用（中转很慢的房间靠这条兜住）
  function armFirstFrame(player) {
    clearFirstFrame();
    st.firstTimer = setTimeout(function () {
      st.firstTimer = 0;
      if (!st.active || !st.living || st.player !== player) return;
      if (D.video && D.video.readyState >= 2) return;   // 有数据了，只是还没起播，交给 tryPlay/看门狗
      fallbackDirect();
    }, DIRECT_FIRST_FRAME_MS);
  }

  /* 直连失败：清掉直连地址、记住这一路别再试，回中转重连。
     返回 true = 这次错误已被接管，调用方不要再 scheduleReconnect。 */
  function fallbackDirect() {
    if (!st.curDirect) return false;
    st.curDirect = false;
    st.directUrl = '';
    st.noDirect = true;
    st.streamRetry = 0;
    clearFirstFrame();
    if (!st.active || !st.living) return true;
    if (st.streamTimer) { clearTimeout(st.streamTimer); st.streamTimer = 0; }
    if (st.fbTimer) return true;          // 已经排好下一拍，别重复拉流
    setState('reconnect', '直连画面没接上，改走本机中转…', false);
    st.fbTimer = setTimeout(function () {
      st.fbTimer = 0;
      if (!st.active || !st.living) return;
      startStream();
    }, 0);
    return true;
  }

  // mpegts.js 由 shell.html 在 app.js 之前内联，这里只取现成的，绝不自己再注入 <script>
  function startStream() {
    if (!D.video || !st.active || !st.living) return;

    // 单音源：这次拉流会出声（非静音）时，先停回放再起播
    if (!st.muted) silenceReplay();

    stopStream(true);
    flushPendingDestroy();   // 旧播放器立刻销毁，别在 60ms 后把新播放器 detach 掉

    var MT = window.mpegts;
    if (!MT || typeof MT.createPlayer !== 'function') {
      setState('error', '直播组件没加载，先看节目带吧。', true);
      return;
    }

    var direct = directFor(st.qn);
    var isDirect = !!direct;
    var url = direct || relayUrl();
    st.mediaUrl = url;

    D.video.muted = st.muted;
    var player = null;
    st.curDirect = isDirect;
    try {
      player = MT.createPlayer({ type: 'flv', url: url, isLive: true, hasAudio: true, hasVideo: true }, isDirect ? {
        enableWorker: false,
        enableStashBuffer: false,
        stashInitialSize: 384,
        lazyLoad: false,
        liveBufferLatencyChasing: true,    // 直连不过 Kotlin 改时间戳，交给 mpegts 追帧
        autoCleanupSourceBuffer: true,
        fixAudioTimestampGap: false
      } : {
        enableWorker: false,
        enableStashBuffer: false,
        stashInitialSize: 128,
        lazyLoad: false,
        liveBufferLatencyChasing: false,   // 追帧自己算，避免 mpegts 反复 seek 拉偏音画
        autoCleanupSourceBuffer: true,
        fixAudioTimestampGap: false
      });
      player.attachMediaElement(D.video);
      player.on(MT.Events.ERROR, function (type, detail) {
        if (st.player !== player) return;  // 旧播放器的尾巴不算
        onMpegErr(type, detail);
      });
      st.player = player;          // 先挂引用：playing 首帧判定要能看到新播放器
      player.load();
      st.wdAt = 0;
      st.stall = 0;
      tryPlay();
      syncNowPlaying(true);
      if (isDirect) armFirstFrame(player);
    } catch (e) {
      try { if (player) player.destroy(); } catch (e2) {}
      st.player = null;
      st.curDirect = isDirect;
      if (fallbackDirect()) return;            // 直连打不开：先回中转
      if (st.sw) { switchFailed(); return; }   // 切档中途打不开：回原档，不落 error
      setState('error', '直播流打不开：' + humanErr(e && e.message) + '。', true);
    }
  }

  function onMpegErr(type, detail) {
    var ts = String(type || '');
    // mpegts 的 RuntimeException 多为偶发解析告警，不据此弹错；真断了交给看门狗与重连
    if (/RuntimeException/.test(ts)) return;
    if (fallbackDirect()) return;
    scheduleReconnect(/Network/i.test(ts) ? '网络断了' : '画面停了');
  }

  function scheduleReconnect(reason) {
    if (!st.active || !st.living) return;
    if (st.fbTimer) return;          // 正要切回中转，让那次重连先做
    if (st.streamTimer) return;
    // 切档期间：重连 2 次仍失败就回原档，别卡在 reconnect
    if (st.sw) {
      st.sw.tries++;
      if (st.sw.tries > 2) { switchFailed(); return; }
    }
    if (st.streamRetry >= 4) {
      if (st.sw) { switchFailed(); return; }
      setState('error', '直播流断了，试了 ' + st.streamRetry + ' 次都没接上。', true);
      return;
    }
    st.streamRetry++;
    var wait = [800, 1600, 3200, 4800][Math.min(st.streamRetry - 1, 3)];
    setState('reconnect', '画面断了，正在重连…（第 ' + st.streamRetry + ' 次）', true);
    st.streamTimer = setTimeout(function () {
      st.streamTimer = 0;
      if (!st.active || !st.living) return;
      startStream();
    }, wait);
  }

  /* 音频仲裁（8.0）：直播要出声时先停回放，同一秒只留一个音源。
     回放没在播就不动它 —— 不抢暂停中的回放，也不替用户恢复回放。 */
  /* 8.1：把「正在播的直播」镜像给原生，退后台时原生才能自己起悬浮窗 */
  function syncNowPlaying(on) {
    var BR = window.AndroidRadio;
    if (!BR || typeof BR.setNowPlaying !== 'function') { return; }
    try {
      if (on && st.living && st.mediaUrl) {
        BR.setNowPlaying(st.mediaUrl,
          (D.title && D.title.textContent) || '直播',
          0, true, true);
      } else {
        BR.setNowPlaying('', '', 0, false, false);
      }
    } catch (e) { }
  }

  function silenceReplay() {
    var pl = RR.player;
    if (!pl || typeof pl.stop !== 'function') return;
    var a = null;
    if (typeof pl.audioState === 'function') {
      try { a = pl.audioState(); } catch (e) { a = null; }
    }
    if (a) {
      // 正在播 / 正在缓冲：都算「将要出声」，一起停掉，别等它突然响
      if (a.item && (a.playing || a.loading || a.pending)) { try { pl.stop(); } catch (e) {} }
      return;
    }
    var on2 = false;
    if (typeof pl.isPlaying === 'function') {
      try { on2 = !!pl.isPlaying(); } catch (e) { on2 = false; }
    }
    if (on2) { try { pl.stop(); } catch (e) {} }
  }

  function tryPlay() {
    if (!D.video) return;
    if (!st.muted) silenceReplay();   // 这一下 play() 会出声：先让回放闭嘴
    try {
      var p = D.video.play();
      if (p && typeof p.catch === 'function') p.catch(function () { onAutoplayBlocked(); });
    } catch (e) {}
  }

  function onAutoplayBlocked() {
    if (st.muted) {
      // 静音都起不来：多半是流本身还没到，稍后再试一次
      setTimeout(function () {
        if (!st.active || !st.living || !D.video) return;
        if (!D.video.paused) return;
        try { var p = D.video.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
      }, 600);
      return;
    }
    // 带声音的自动播放被策略拒绝：退回静音并说人话，别静默失败
    st.muted = true;
    applyMute();
    saveSettings({ liveMuted: true });
    tryPlay();
    toast('浏览器先静音了画面，点喇叭开声');
  }

  function applyMute(quiet) {
    // 用户把直播开声（applyMute(false) 路径）：先停回放，再让直播出声
    if (!st.muted && !quiet) silenceReplay();
    if (D.video) D.video.muted = st.muted;
    if (D.mute) {
      D.mute.innerHTML = ico(st.muted ? 'mute' : 'volume');
      D.mute.setAttribute('aria-pressed', st.muted ? 'true' : 'false');
      D.mute.setAttribute('aria-label', st.muted ? '声音：已静音' : '声音：开');
      D.mute.classList.toggle('is-off', st.muted);
    }
  }

  function toggleMute() {
    if (!st.living) return;
    st.muted = !st.muted;
    applyMute();
    saveSettings({ liveMuted: st.muted });
    if (!st.muted) {
      tryPlay();
      toast('声音开了');
    }
  }

  // 离开 / 换台：保最后一帧，destroy 延后 60ms
  function stopStream(keepFrame) {
    syncNowPlaying(false);
    clearFirstFrame();
    st.curDirect = false;      // 旧 attempt 的尾巴不再算直连失败
    if (st.fbTimer) { clearTimeout(st.fbTimer); st.fbTimer = 0; }
    var p = st.player;
    st.player = null;
    flushPendingDestroy();     // 上一个延后销毁的播放器先清掉（这之后到的 error 一律不算）
    if (D.video) { try { D.video.pause(); } catch (e) {} }
    if (!p) {
      if (!keepFrame) releaseVideo();
      return;
    }
    var destroy = function () {
      try { p.pause(); } catch (e) {}
      try { p.unload(); } catch (e) {}
      try { p.detachMediaElement(); } catch (e) {}
      try { p.destroy(); } catch (e) {}
      if (!keepFrame) releaseVideo();
    };
    if (keepFrame) {
      st.pendDestroy = destroy;
      st.pendTimer = setTimeout(function () {
        st.pendTimer = 0;
        var d = st.pendDestroy;
        st.pendDestroy = null;
        if (d) d();
      }, 60);
    } else {
      destroy();
    }
  }

  function flushPendingDestroy() {
    if (st.pendTimer) { clearTimeout(st.pendTimer); st.pendTimer = 0; }
    var d = st.pendDestroy;
    st.pendDestroy = null;
    if (d) d();
  }

  function releaseVideo() {
    if (!D.video) return;
    try {
      D.video.removeAttribute('src');
      D.video.load();
    } catch (e) {}
  }

  /* ---------------- 计时：追帧 + 看门狗 ---------------- */

  function startTimers() {
    stopTimers();
    st.chaseTimer = setInterval(chaseTick, 1000);
    st.wdTimer = setInterval(watchdog, 2000);
  }

  function stopTimers() {
    if (st.chaseTimer) { clearInterval(st.chaseTimer); st.chaseTimer = 0; }
    if (st.wdTimer) { clearInterval(st.wdTimer); st.wdTimer = 0; }
    if (st.streamTimer) { clearTimeout(st.streamTimer); st.streamTimer = 0; }
    if (st.esTimer) { clearTimeout(st.esTimer); st.esTimer = 0; }
  }

  function chaseTick() {
    if (!st.active || !st.living) return;
    var v = D.video;
    if (!v) return;
    try {
      var b = v.buffered;
      if (!b || !b.length) return;
      var end = b.end(b.length - 1);
      var behind = end - v.currentTime;
      if (behind > 4.5 && Date.now() - st.lastChase > 8000) {
        st.lastChase = Date.now();
        v.currentTime = Math.max(0, end - 1.2);
      }
    } catch (e) {}
  }

  function watchdog() {
    if (!st.active || !st.living || !st.player) return;
    var v = D.video;
    if (!v) return;
    var t = v.currentTime;

    if (v.paused) {
      if (Date.now() - st.lastPlayTry > 4000) {
        st.lastPlayTry = Date.now();
        tryPlay();
      }
      return;
    }
    if (Math.abs(t - st.wdAt) < 0.08) {
      st.stall++;
      if (st.stall >= 4) {
        st.stall = 0;
        if (fallbackDirect()) return;   // 直连卡死：先降级，别在原地址上重试到死
        scheduleReconnect('画面没有前进');
      }
    } else {
      st.stall = 0;
      st.wdAt = t;
      st.streamRetry = 0;
    }
  }

  /* ---------------- 弹幕 SSE ---------------- */

  function openChat() {
    closeChat();
    if (typeof window.EventSource !== 'function') {
      setConn('off', '不支持');
      return;
    }
    setConn('idle', '连接中');
    var es;
    try {
      es = new window.EventSource('/api/live/chat/stream?station=' + encodeURIComponent(st.stationId));
    } catch (e) {
      setConn('err', '连不上');
      scheduleChat();
      return;
    }
    st.es = es;

    es.onopen = function () {
      if (st.es !== es) return;
      st.esRetry = 0;
      setConn('on', '已连接');
    };
    es.onmessage = function (ev) {
      if (st.es !== es) return;
      onChatMsg(ev && ev.data);
    };
    es.onerror = function () {
      if (st.es !== es) return;
      if (es.readyState === 2) {
        setConn('err', '断开');
        closeChat();
        scheduleChat();
      } else {
        setConn('err', '重连中');
      }
    };
  }

  function scheduleChat() {
    if (st.esTimer) return;
    var wait = Math.min(15000, 2500 * Math.pow(2, Math.min(st.esRetry, 3)));
    st.esRetry++;
    st.esTimer = setTimeout(function () {
      st.esTimer = 0;
      if (st.active && st.living) openChat();
    }, wait);
  }

  function closeChat() {
    var es = st.es;
    st.es = null;
    if (es) {
      try { es.onopen = es.onmessage = es.onerror = null; } catch (e) {}
      try { es.close(); } catch (e) {}
    }
  }

  function setConn(state, text) {
    if (D.conn) D.conn.setAttribute('data-state', state);
    if (D.connTxt) D.connTxt.textContent = text || '';
  }

  function onChatMsg(raw) {
    if (typeof raw !== 'string' || !raw) return;
    var m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;

    var type = String(m.type || '');
    if (type === 'danmaku') {
      addLine('dm', m.uname, m.text);
    } else if (type === 'superchat') {
      addLine('sc', m.uname, m.text, m.price);
    } else if (type === 'state') {
      setConn('on', '已连接');
    } else if (type === 'popularity') {
      setPopularity(m.value);
    } else if (type === 'gift') {
      if (m.text) addLine('sys', '', '收到礼物 · ' + m.text);
    }
    // 其它类型安静忽略，不打扰
  }

  function addLine(kind, user, text, price) {
    if (!D.feed) return;
    var body = String(text == null ? '' : text).replace(/\s+$/, '');
    if (!body) return;
    if (body.length > 140) body = body.slice(0, 140) + '…';

    var near = nearBottom();
    var li = mk('li', 'chat-line' + (kind === 'sc' ? ' is-sc' : kind === 'sys' ? ' is-sys' : ''));

    if (kind === 'sc' && price) {
      var p = mk('span', 'chat-line__price num', '¥' + price);
      li.appendChild(p);
    }
    if (user) {
      var u = mk('span', 'chat-line__u truncate', String(user).slice(0, 18));
      li.appendChild(u);
    }
    li.appendChild(mk('span', 'chat-line__t', body));
    D.feed.appendChild(li);

    st.feedCount++;
    while (D.feed.children.length > 120) {
      D.feed.removeChild(D.feed.firstChild);
    }
    if (D.empty) D.empty.hidden = true;

    if (near || st.follow) toBottom();
    else bump();
  }

  function nearBottom() {
    var f = D.feed;
    if (!f) return true;
    return f.scrollHeight - f.scrollTop - f.clientHeight < 28;
  }

  function toBottom() {
    var f = D.feed;
    if (!f) return;
    f.scrollTop = f.scrollHeight;
    st.follow = true;
    st.unseen = 0;
    if (D.neu) D.neu.hidden = true;
  }

  function bump() {
    st.follow = false;
    st.unseen++;
    if (D.neu) D.neu.hidden = false;
    if (D.neuTxt) D.neuTxt.textContent = st.unseen > 1 ? ('有新弹幕 ' + st.unseen) : '有新弹幕';
  }

  function onFeedScroll() {
    if (nearBottom()) {
      st.follow = true;
      st.unseen = 0;
      if (D.neu) D.neu.hidden = true;
    } else {
      st.follow = false;
    }
  }

  /* ---------------- 发送 ---------------- */

  function account() {
    // 真源：/api/status 的 {logged,jct,mid}；其次看别的模块有没有共享 account 对象
    if (st.acct && typeof st.acct === 'object') return st.acct;
    try {
      if (RR.account && typeof RR.account === 'object') return RR.account;
      if (RR.me && typeof RR.me.account === 'function') {
        var a = RR.me.account();
        if (a && typeof a === 'object') return a;
      }
    } catch (e) {}
    return null;
  }

  function loggedOut() {
    var a = account();
    if (!a) return false;                     // 不知道就别拦，别把能发的人锁死
    if (typeof a.logged === 'boolean') return !a.logged;
    if (typeof a.jct === 'boolean') return !a.jct;
    if (a.mid != null) return !(Number(a.mid) > 0);
    return false;
  }

  function refreshAccount() {
    api('/api/status').then(function (d) {
      if (!d || typeof d !== 'object') return;
      st.acct = { logged: d.logged !== false, jct: !!d.jct, mid: d.mid, uname: d.uname || '' };
      updateSend();
    }, function () { /* 取不到就维持未知，不拦发送 */ });
  }

  function hintLogin() {
    var now = Date.now();
    if (now - st.loginHintAt < 4000) return;
    st.loginHintAt = now;
    toast('发弹幕要先用 B 站账号扫码登录');
  }

  function updateSend() {
    var off = st.needLogin || loggedOut();
    var val = D.input ? String(D.input.value || '').trim() : '';
    if (D.send) D.send.disabled = !val || off || st.sending || !st.living;
    if (D.input) D.input.placeholder = off ? '说点什么…（需登录）' : '说点什么…';
    if (D.loginbar) D.loginbar.hidden = !off;
  }

  function submit() {
    if (!D.input) return;
    sendText(D.input.value, null);
  }

  function sendText(text, emo) {
    if (!st.active || !st.living) { toast('现在没有开播，发不了弹幕', 'err'); return; }
    if (st.needLogin || loggedOut()) { hintLogin(); return; }

    var body = String(text == null ? '' : text).trim();
    if (!body) return;
    if (body.length > 20) { toast('弹幕最多 20 个字', 'err'); return; }
    if (st.sending) return;

    st.sending = true;
    updateSend();

    var payload = { text: body };
    if (emo) payload.emoticonOptions = emo;

    post('/api/live/send', payload).then(function () {
      st.sending = false;
      if (emo) closeEmoPick();
      else if (D.input) D.input.value = '';
      updateSend();
      toast(emo ? '表情发出去了' : '弹幕发出去了');
    }, function (err) {
      st.sending = false;
      var status = err && err.status;
      var msg = (err && err.message) || '';
      if (status === 401 || status === 403 || /登录|未登录|身份|token|验证/i.test(msg)) {
        st.needLogin = true;
        updateSend();
        hintLogin();
        return;
      }
      updateSend();
      toast(humanErr(msg), 'err');
    });
  }

  /* ---------------- 表情 ---------------- */

  function emoErrText(err) {
    var s = err && err.status;
    if (s === 404) return '表情库还没接通，后端还在做——先打字吧。';
    if (!s || s >= 500) return '表情库暂时取不到，等一下再试。';
    return '表情库暂不可用，先打字吧。';
  }

  function setEmoMsg(text, retry) {
    if (D.emoMsg) D.emoMsg.textContent = text || '';
    if (D.emoMsgWrap) D.emoMsgWrap.hidden = !text;
    if (D.emoRetry) D.emoRetry.hidden = !retry;
  }

  function loadEmoticons(force) {
    var E = st.emo;
    if (E.loading) return;
    if (!force && E.loaded && E.room === st.room) { renderEmo(); return; }
    E.loading = true;
    E.room = st.room;
    setEmoMsg('正在取表情…');
    api('/api/live/emoticons?room=' + encodeURIComponent(st.room || st.stationId)).then(function (res) {
      E.loading = false;
      var packs = (res && res.packs) || [];
      var clean = [];
      for (var i = 0; i < packs.length; i++) {
        var p = packs[i];
        if (!p || !p.items || !p.items.length) continue;
        clean.push({ name: p.name || ('表情 ' + (clean.length + 1)), items: p.items });
      }
      E.packs = clean;
      E.loaded = true;
      E.pack = 0;
      E.picked = null;
      if (D.emoPrev) D.emoPrev.hidden = true;
      if (!clean.length) setEmoMsg('这个房间还没有可用表情，先打字吧。');
      else setEmoMsg('');
      renderEmo();
    }, function (err) {
      E.loading = false;
      E.loaded = false;
      E.packs = [];
      E.room = '';
      setEmoMsg(emoErrText(err), true);
      renderEmo();
    });
  }

  function renderEmo() {
    renderEmoTabs();
    renderEmoGrid();
  }

  function renderEmoTabs() {
    var wrap = D.emoTabs;
    if (!wrap) return;
    wrap.innerHTML = '';
    var packs = st.emo.packs;
    for (var i = 0; i < packs.length; i++) {
      var b = mk('button', 'lv-etab' + (i === st.emo.pack ? ' is-on' : ''), packs[i].name);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', i === st.emo.pack ? 'true' : 'false');
      b.setAttribute('data-i', String(i));
      b.addEventListener('click', (function (idx) {
        return function () { st.emo.pack = idx; renderEmo(); };
      })(i));
      wrap.appendChild(b);
    }
    wrap.hidden = packs.length < 2;
  }

  function renderEmoGrid() {
    var grid = D.emoGrid;
    if (!grid) return;
    grid.innerHTML = '';
    var pack = st.emo.packs[st.emo.pack];
    if (!pack) return;
    var items = pack.items.slice(0, 96);
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !it.url) continue;
      var b = mk('button', 'lv-eitem');
      b.type = 'button';
      b.setAttribute('aria-label', it.name || '表情');
      if (it.name) b.title = it.name;
      var img = document.createElement('img');
      img.className = 'lv-eimg';
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.width = 32;
      img.height = 32;
      img.src = it.url;
      (function (node, item, btn) {
        img.addEventListener('error', function () {
          try { node.remove(); } catch (e) {}
          if (!btn.querySelector('.lv-efb')) {
            btn.appendChild(mk('span', 'lv-efb', String(item.name || '?').slice(0, 2)));
            btn.classList.add('is-broken');
          }
        }, { once: true });
        btn.addEventListener('click', function () { pickEmo(item, btn); });
      })(img, it, b);
      b.appendChild(img);
      grid.appendChild(b);
    }
  }

  function pickEmo(item, btn) {
    st.emo.picked = item;
    if (D.emoPrev) D.emoPrev.hidden = false;
    if (D.emoImg) { D.emoImg.src = item.url; D.emoImg.alt = ''; }
    if (D.emoName) D.emoName.textContent = item.name || '表情';
    if (D.emoSend) D.emoSend.disabled = false;
    var prev = D.emoGrid ? D.emoGrid.querySelector('.lv-eitem.is-sel') : null;
    if (prev) prev.classList.remove('is-sel');
    if (btn) btn.classList.add('is-sel');
    keepAboveDock(D.emoPrev, 40);
  }

  function closeEmoPick() {
    st.emo.picked = null;
    if (D.emoPrev) D.emoPrev.hidden = true;
    var prev = D.emoGrid ? D.emoGrid.querySelector('.lv-eitem.is-sel') : null;
    if (prev) prev.classList.remove('is-sel');
  }

  // 面板贴底，底部还压着悬浮 dock：把节点滚到 dock 上方
  function keepAboveDock(node, delay) {
    if (!node) return;
    setTimeout(function () {
      try {
        var r = node.getBoundingClientRect();
        var room = window.innerHeight - 96;
        if (r.bottom > room) window.scrollBy(0, Math.min(r.bottom - room + 8, 460));
      } catch (e) {}
    }, delay || 90);
  }

  function toggleEmo() {
    if (!D.emo) return;
    var open = !!D.emo.hidden;
    D.emo.hidden = !open;
    if (D.emoBtn) D.emoBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (D.panel) D.panel.classList.toggle('is-emo', open);
    if (!open) return;
    loadEmoticons(false);
    keepAboveDock(D.emo, 90);
  }

  function sendEmoji() {
    var it = st.emo.picked;
    if (!it) return;
    var opt = {
      unique: it.unique || '',
      name: it.name || '',
      url: it.url || '',
      w: Number(it.w) || 0,
      h: Number(it.h) || 0
    };
    sendText('[' + (it.name || '表情') + ']', opt);
  }

  /* ---------------- 画质 ---------------- */

  // 常见档位兜底（接口只回 1 档时补全；后端对不可用档会回落到可用档）
  var QN_TIERS = [10000, 400, 250, 150, 80];
  var QN_DESC = { 10000: '原画', 400: '蓝光', 250: '超清', 150: '高清', 80: '流畅' };
  var SW_TEXT = '正在切到';
  var HOLD_MAX = 2500;    // 定格帧最多铺 2.5s，兜底移除
  var SW_MAX = 10000;     // 切档整体超时：再等就回原档，不卡在 reconnect

  function hasQuality(qn) {
    qn = Number(qn) || 0;
    for (var i = 0; i < st.qualities.length; i++) {
      if (Number(st.qualities[i].qn) === qn) return true;
    }
    return false;
  }

  function qnLabel(qn) {
    qn = Number(qn) || 0;
    for (var i = 0; i < st.qualities.length; i++) {
      if (Number(st.qualities[i].qn) === qn) {
        return st.qualities[i].desc || QN_DESC[qn] || ('QN ' + qn);
      }
    }
    return QN_DESC[qn] || (qn ? ('QN ' + qn) : '原画');
  }

  // 接口档位 + 常见档兜底 + accept_qn 过滤（accept_qn 为空时保留补全结果）
  function normalizeQualities(info) {
    var out = [], seen = {}, i, q, qn;
    var src = (info && info.qualities) || [];
    for (i = 0; i < src.length; i++) {
      q = src[i];
      if (!q || !q.qn) continue;
      qn = Number(q.qn);
      if (!qn || seen[qn]) continue;
      seen[qn] = 1;
      out.push({ qn: qn, desc: q.desc || QN_DESC[qn] || ('QN ' + qn) });
    }
    if (out.length < 2) {
      for (i = 0; i < QN_TIERS.length; i++) {
        qn = QN_TIERS[i];
        if (seen[qn]) continue;
        seen[qn] = 1;
        out.push({ qn: qn, desc: QN_DESC[qn] });
      }
    }
    var accept = info && info.accept_qn;
    if (typeof accept === 'string') accept = accept.split(',');
    if (accept && accept.length) {
      var allowed = {};
      for (i = 0; i < accept.length; i++) {
        qn = Number(accept[i]);
        if (qn) allowed[qn] = 1;
      }
      var keep = [];
      for (i = 0; i < out.length; i++) {
        if (allowed[out[i].qn]) keep.push(out[i]);
      }
      if (keep.length) out = keep;
    }
    return out;
  }

  function setQuality(qn) {
    qn = Number(qn) || 0;
    if (!qn || qn === st.qn) return;
    var from = st.qn;
    st.qn = qn;
    st.noDirect = false;       // 换清晰度：重新给直连一次机会（直连只对应 flv_qn 那一档）
    storeSet('liveQn', qn);
    renderQuality();
    if (!st.living) {
      toast('画质：' + qnLabel(qn));
      return;
    }
    st.streamRetry = 0;
    beginSwitch(qn, from);
    startStream();
  }

  /* ---- 切档现场：定格帧铺住舞台 → 换流 → 首帧上屏再撤 ---- */

  function captureFrame() {
    var v = D.video;
    if (!v || !v.videoWidth || !v.videoHeight) return null;
    if (v.readyState < 2) return null;
    var cv = document.createElement('canvas');
    cv.className = 'lv-hold';
    cv.width = v.videoWidth;
    cv.height = v.videoHeight;
    try {
      cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
    } catch (e) {
      return null;
    }
    return cv;
  }

  function removeNode(n) {
    if (!n) return;
    try { if (n.parentNode) n.parentNode.removeChild(n); } catch (e) {}
  }

  // 抓当前帧铺在 video 之上（z-index 低于提示层），切完淡出移除
  function showHold() {
    dropHold(true);
    var cv = captureFrame();
    if (!cv || !D.stage) return;
    D.stage.appendChild(cv);
    st.hold = cv;
  }

  function dropHold(now) {
    if (st.holdTimer) { clearTimeout(st.holdTimer); st.holdTimer = 0; }
    var cv = st.hold;
    st.hold = null;
    if (!cv) return;
    if (now) { removeNode(cv); return; }
    try { cv.classList.add('is-out'); } catch (e) {}
    setTimeout(function () { removeNode(cv); }, 240);
  }

  function setSwPill(text) {
    if (!D.stage) return;
    if (!st.swPill || st.swPill.parentNode !== D.stage) {
      st.swPill = mk('div', 'lv-sw');
      st.swPill.setAttribute('role', 'status');
      D.stage.appendChild(st.swPill);
    }
    st.swPill.textContent = text || '';
  }

  function clearSwPill() {
    removeNode(st.swPill);
    st.swPill = null;
  }

  function beginSwitch(target, from) {
    abortSwitch();
    showHold();
    if (st.hold) {
      st.holdTimer = setTimeout(function () {
        st.holdTimer = 0;
        dropHold();
      }, HOLD_MAX);
    }
    var sw = { target: target, from: from, tries: 0, armed: false, timer: 0 };
    sw.timer = setTimeout(function () {
      if (st.sw !== sw) return;
      switchFailed();
    }, SW_MAX);
    st.sw = sw;
    var text = SW_TEXT + qnLabel(target) + '…';
    setSwPill(text);
    setState('reconnect', text, false);
  }

  // playing 之后等这一帧真的呈现（rVFC），没有就用 playing+120ms
  function onSwitchFrame() {
    var sw = st.sw;
    if (!sw || sw.armed) return;
    // 只认「新播放器已挂上 + 视频真的在走」的那一次 playing，旧流的尾巴不算
    var v = D.video;
    if (!v || !st.player || v.paused) return;
    sw.armed = true;
    var fin = function () {
      if (st.sw !== sw) return;
      switchDone(sw);
    };
    if (typeof v.requestVideoFrameCallback === 'function') {
      try {
        v.requestVideoFrameCallback(function () { setTimeout(fin, 30); });
        return;
      } catch (e) {}
    }
    setTimeout(fin, 120);
  }

  function switchDone(sw) {
    if (sw.timer) { clearTimeout(sw.timer); sw.timer = 0; }
    if (st.sw === sw) st.sw = null;
    dropHold();
    setTimeout(function () {
      if (!st.sw) clearSwPill();
    }, 220);
    toast('画质：' + qnLabel(sw.target));
  }

  function switchFailed() {
    var sw = st.sw;
    if (!sw) return;
    st.sw = null;
    if (sw.timer) { clearTimeout(sw.timer); sw.timer = 0; }
    if (st.streamTimer) { clearTimeout(st.streamTimer); st.streamTimer = 0; }
    var back = Number(sw.from) || 0;
    if (!back) {
      for (var i = 0; i < st.qualities.length; i++) {
        var q = Number(st.qualities[i].qn);
        if (q && q !== Number(sw.target)) { back = q; break; }
      }
    }
    st.qn = back;
    storeSet('liveQn', back);
    renderQuality();
    dropHold(true);
    clearSwPill();
    toast('切到' + qnLabel(sw.target) + '没成功，' + (back ? ('回到' + qnLabel(back)) : '先按默认画质播'), 'err');
    if (!st.active || !st.living) return;
    st.streamRetry = 0;
    setState('reconnect', back ? ('正在回到' + qnLabel(back) + '…') : '正在按默认画质重连…', false);
    // 下一拍再拉流：别在 mpegts 的 error 回调里同步销毁它自己
    setTimeout(function () {
      if (st.active && st.living && !st.sw) startStream();
    }, 0);
  }

  // 离场 / 切台 / 信息刷新：清掉定格帧与状态，不做回退
  function abortSwitch() {
    var sw = st.sw;
    st.sw = null;
    if (sw && sw.timer) clearTimeout(sw.timer);
    dropHold(true);
    clearSwPill();
  }

  function pickQuality() {
    if (!st.living || st.qualities.length < 2) return;

    if (typeof RR.sheet !== 'function') {
      // 没有抽屉就顺序切，别让按钮变成死的
      var idx = 0;
      for (var i = 0; i < st.qualities.length; i++) {
        if (Number(st.qualities[i].qn) === Number(st.qn)) { idx = i; break; }
      }
      setQuality(st.qualities[(idx + 1) % st.qualities.length].qn);
      return;
    }

    // 抽屉在 #view-live 之外，样式只能用基础类 + 行内变量，别写越界的 CSS 选择器
    var body = mk('div', 'stack');
    st.qualities.forEach(function (q) {
      var cur = Number(q.qn) === Number(st.qn);
      var row = mk('button', 'btn');
      row.type = 'button';
      row.style.width = '100%';
      row.style.height = '48px';
      row.style.justifyContent = 'space-between';
      row.style.marginBottom = 'var(--sp-2)';
      row.style.background = cur ? 'var(--accent-soft)' : 'var(--bg-surface-tonal)';
      if (cur) row.style.color = 'var(--accent)';
      row.appendChild(mk('span', '', q.desc || ('QN ' + q.qn)));
      row.appendChild(mk('span', 'num', cur ? '当前' : String(q.qn)));
      row.addEventListener('click', function () {
        try { if (sheet && sheet.close) sheet.close(); } catch (e) {}
        setQuality(q.qn);
      });
      body.appendChild(row);
    });

    var sheet = null;
    try {
      sheet = RR.sheet({ title: '画质', body: body });
    } catch (e) {
      sheet = null;
    }
  }

  /* ---------------- 全屏 ---------------- */

  function liveRoot() {
    return st.root || document.getElementById('view-live');
  }

  /* 顶栏 / dock / 小窗在 #view-live 之外，视图 CSS 不能越界选它们，
     这里临时把 visibility / pointer-events 藏起来，退出时原样还回去。 */
  function setChromeHidden(hide) {
    if (hide) {
      if (st.chromeHidden) return;
      var list = [document.querySelector('.top'), document.getElementById('dock'), document.querySelector('.mini')];
      var saved = [];
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        if (!n) continue;
        saved.push({ n: n, vis: n.style.visibility || '', pe: n.style.pointerEvents || '' });
        n.style.visibility = 'hidden';
        n.style.pointerEvents = 'none';
      }
      st.chromeHidden = saved;
      return;
    }
    var back = st.chromeHidden;
    st.chromeHidden = null;
    if (!back) return;
    for (var j = 0; j < back.length; j++) {
      try {
        back[j].n.style.visibility = back[j].vis;
        back[j].n.style.pointerEvents = back[j].pe;
      } catch (e) {}
    }
  }

  function toggleFs() {
    if (!st.living) return;
    if (st.fsOn) exitFs();
    else enterFs();
  }

  /* 全屏真相是 #view-live 的 .is-fs：WebView 里 DOM fullscreen 经常不生效，
     所以横屏 + 系统栏一律走原生桥接为主，DOM 请求只在桥接缺失时兜底。 */
  function enterFs() {
    var root = liveRoot();
    if (!root || st.fsOn) return;
    st.fsOn = true;
    st.fsApplied = false;
    root.classList.add('is-fs');
    setChromeHidden(true);                         // 顶栏 / dock / mini 让位
    if (st.bodyOverflow == null) st.bodyOverflow = document.body.style.overflow || '';
    document.body.style.overflow = 'hidden';
    setFsIcon(true);

    var br = window.AndroidRadio || null;
    var hasBridge = false;
    if (br) {
      if (typeof br.setFullscreen === 'function') {
        hasBridge = true;
        try { br.setFullscreen(true); } catch (e) {}
      }
      if (typeof br.setOrientation === 'function') {
        hasBridge = true;
        try { br.setOrientation('landscape'); } catch (e) {}
      }
    }
    st.fsApplied = hasBridge;
    if (!hasBridge) { requestDomFs(root); return; }

    /* 有些机型/主题下第一下 setFullscreen + 旋屏会被忽略（尤其是刚进页面就点全屏），
       过一拍再确认一次；用户已经退出就什么都不做。 */
    if (st.fsTimer) { clearTimeout(st.fsTimer); st.fsTimer = 0; }
    st.fsTimer = setTimeout(function () {
      st.fsTimer = 0;
      if (!st.fsOn) return;
      var b = window.AndroidRadio || null;
      if (!b) return;
      if (typeof b.setOrientation === 'function') { try { b.setOrientation('landscape'); } catch (e) {} }
      if (typeof b.setFullscreen === 'function') { try { b.setFullscreen(true); } catch (e) {} }
    }, 280);
  }

  function requestDomFs(root) {
    var fn = root.requestFullscreen || root.webkitRequestFullscreen;
    if (typeof fn !== 'function') return;
    var p = null;
    try { p = fn.call(root); } catch (e) { p = null; }
    if (p && typeof p.then === 'function') {
      p.then(function () { st.fsApplied = true; }, function () {});
    } else {
      st.fsApplied = true;
    }
  }

  function exitFs(quiet) {
    var was = st.fsOn;
    var applied = st.fsApplied;
    st.fsOn = false;
    st.fsApplied = false;
    if (st.fsTimer) { clearTimeout(st.fsTimer); st.fsTimer = 0; }
    setFsIcon(false);
    var root = liveRoot();
    if (root) root.classList.remove('is-fs');
    setChromeHidden(false);
    if (st.bodyOverflow != null) {
      try { document.body.style.overflow = st.bodyOverflow; } catch (e) {}
      st.bodyOverflow = null;
    }
    if (!was && !applied && quiet) return;   // 没真进过全屏：不用碰系统栏/方向

    var br = window.AndroidRadio || null;
    if (br) {
      if (typeof br.setFullscreen === 'function') { try { br.setFullscreen(false); } catch (e) {} }
      if (typeof br.setOrientation === 'function') { try { br.setOrientation('portrait'); } catch (e) {} }
    }
    try {
      if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
        var p = document.exitFullscreen();
        if (p && p.catch) p.catch(function () {});
      } else if (document.webkitFullscreenElement && typeof document.webkitExitFullscreen === 'function') {
        document.webkitExitFullscreen();
      }
    } catch (e) {}
  }

  function setFsIcon(on2) {
    if (!D.fs) return;
    D.fs.innerHTML = ico(on2 ? 'collapse' : 'expand');
    D.fs.setAttribute('aria-label', on2 ? '退出全屏' : '全屏观看');
  }

  // DOM 兜底全屏被系统退出时，class / 方向也要跟着收回来
  function onFsChange() {
    if (!st.fsOn) return;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    exitFs(true);
  }

  /* 系统返回键等原生统一退出入口（35-fs / 30-player 也是这么串的） */
  var prevExitFs = window.__rrExitFs;
  window.__rrExitFs = function () {
    if (st.fsOn) { exitFs(); return true; }
    return typeof prevExitFs === 'function' ? prevExitFs() : false;
  };

  /* ---------------- 对外 ---------------- */

  RR.live = {
    mount: mount,
    enter: enter,
    leave: leave,
    state: function () {
      return {
        state: st.state,
        living: st.living,
        room: st.room,
        station: st.stationId,
        qn: st.qn,
        muted: st.muted,
        chat: st.feedCount,
        unseen: st.unseen,
        emoticons: st.emo.packs.length
      };
    },
    send: sendText,
    refresh: function () { if (st.active) retryNow(); },
    /* 从原生悬浮窗回到 App：按当前画质重新拉一次流 */
    reconnect: function () { if (st.active) { retryNow(); } },
    toggleEmoji: toggleEmo
  };

  // 90-boot 按 RR.modules[name] 挂载，必须走 RR.view 注册
  if (typeof RR.view === 'function') RR.view('live', RR.live);
})();
