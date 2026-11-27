/* ============================================================
   43-monitor.js · 多路监控（view-monitor）
   8.0：
   · 横屏墙 .is-wall（matchMedia 自动进入 / #mon-wall 手动，最多 6 路）
   · 焦点 = 一大多小（同一 <video>，FLIP；焦点 qn=10000，缩略 qn=150）
   · 长按 300ms 拖动排序（其余瓦片 FLIP 让位，顺序写 mon_order）
   · 墙「铺满 / 完整」切换（#mon-fit，mon_fit 落盘，默认铺满）
   · 瓦片手势：单击开声（多路永远只有一路出声）/ 双击放大 / 长按拖动
   · 自动排版按路数 + 方向选网格（FLIP 260ms）
   既有：自动补台 / 手输房间 / mon_skip 24h / 看门狗 2s·8s·退避·第 4 次判死
   · 离开页面销毁全部 player；监控默认静音，只有用户开声才抢音源
   ============================================================ */
(function () {
  'use strict';
  var RR = window.RR;
  if (!RR) return;

  var MAX = 6;                 /* 同时最多 6 路 */
  var INFO_TTL = 60000;        /* playinfo 缓存 */
  var DISCOVER_TTL = 60000;    /* 自动补台缓存 */
  var WATCH_MS = 2000;         /* 看门狗采样间隔 */
  var STALL_MS = 8000;         /* 多久不动算卡住 */
  var BACKOFF = [800, 1600, 3200];
  var MAX_FAILS = 4;           /* 第 4 次重连仍失败 → 判死 */
  var DESTROY_DELAY = 60;      /* mpegts destroy 延后，压多路偶发崩溃 */
  var LAYOUTS = ['1', '2', '2x2', 'auto'];
  var SKIP_TTL = 24 * 3600 * 1000;  /* 手删过的自动房间：24h 内不再自动加回 */
  var STATION_EVT_GAP = 400;        /* station / station-changed 双事件去重 */

  var THUMB_QN = 250;          /* 走本机中转时的默认档：和直播页一致（B 站常忽略 qn，150 反而可能拿到异常流） */
  var FOCUS_QN = 10000;        /* 焦点瓦片：高码率 */
  var QN_SETTLE = 320;         /* 焦点切换后延迟重连，避免来回抖动 */
  var HOLD_MS = 300;           /* 长按进入拖动 */
  var MOVE_SLOP = 8;           /* 长按前移动多少像素就放弃拖动（交给页面滚动/点击） */
  var DOUBLE_MS = 320;         /* 两次单击间隔小于它算双击 */
  var DOUBLE_SLOP = 24;        /* 双击两次落点允许的位移 */
  var SETTLE_MS = 220;         /* 松手落位 */
  var FOCUS_MS = 320;          /* 焦点 FLIP */
  var FLIP_MS = 260;           /* 自动排版 FLIP */
  var WALL_IDLE = 3500;        /* 墙内顶栏淡出 */

  var st = {
    mounted: false,
    alive: false,
    manual: [],
    auto: [],
    autoAt: 0,
    loadedOnce: false,
    discovering: false,
    discoverToken: 0,
    autoErr: '',
    dismissed: {},
    info: {},
    cells: {},
    order: [],
    layout: 'auto',
    watchdog: 0,
    refresher: 0,
    focus: null,
    focusMuted: true,
    fit: 'cover',
    wall: false,
    wallManual: null,
    wallTimer: 0,
    drag: null
  };

  var el = {};
  var stationEvt = { sid: '', at: 0 };
  var mq = null;
  var wallWakeAt = 0;
  var tap = { c: null, at: 0, x: 0, y: 0, timer: 0 };   /* 单击/双击判定 */

  function $(sel, root) { return RR.$(sel, root); }
  function nowMs() { return Date.now(); }
  function isRoom(v) { return /^\d{1,12}$/.test(String(v || '')); }
  function isLandscape() {
    if (mq) return !!mq.matches;
    return window.innerWidth > window.innerHeight;
  }
  function setOrient(mode) {
    var BR = window.AndroidRadio;
    if (!BR || typeof BR.setOrientation !== 'function') return;
    try { BR.setOrientation(mode); } catch (e) { }
  }

  /* ---------- 持久化 ---------- */
  function readManual() {
    var raw = RR.store.get('mon_manual', []);
    var out = [];
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (x) {
      var room = (typeof x === 'string') ? x : (x && x.room);
      room = String(room || '').trim();
      if (!isRoom(room)) return;
      for (var i = 0; i < out.length; i++) if (out[i].room === room) return;
      out.push({ room: room, name: (x && x.name) || ('房间 ' + room) });
    });
    return out.slice(0, 12);
  }
  function saveManual() {
    RR.store.set('mon_manual', st.manual);
  }

  /* 手删过的自动房间：落盘 24h，重进页面/重启也不偷偷加回来 */
  function readSkip() {
    var raw = RR.store.get('mon_skip', {});
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    var t = nowMs();
    Object.keys(raw).forEach(function (room) {
      if (!isRoom(room)) return;
      var at = +raw[room] || 0;
      if (at && (t - at) < SKIP_TTL) out[room] = at;
    });
    return out;
  }
  function saveSkip() {
    RR.store.set('mon_skip', st.dismissed);
  }

  /* 拖动排序：mon_order = [room...]，reconcile 优先按它排 */
  function readOrder() {
    var raw = RR.store.get('mon_order', []);
    var out = [];
    if (!Array.isArray(raw)) return out;
    raw.forEach(function (room) {
      room = String(room || '').trim();
      if (isRoom(room) && out.indexOf(room) < 0) out.push(room);
    });
    return out;
  }
  function saveOrder(list) {
    st.order = (Array.isArray(list) ? list : st.order).filter(isRoom).slice(0, 12);
    RR.store.set('mon_order', st.order);
  }
  function saveOrderFromDom() {
    var rooms = gridRooms();
    if (!rooms.length) return;
    var tail = st.order.filter(function (room) { return rooms.indexOf(room) < 0; });
    saveOrder(rooms.concat(tail));
  }

  /* ---------- 布局 ---------- */
  function applyLayout(lay, animate) {
    if (LAYOUTS.indexOf(lay) < 0) lay = 'auto';
    function paint() {
      st.layout = lay;
      if (el.grid) {
        LAYOUTS.forEach(function (k) {
          el.grid.classList.toggle('mon-lay-' + k, k === lay);
          if (el.skel) el.skel.classList.toggle('mon-lay-' + k, k === lay);
        });
      }
      if (el.seg) {
        RR.$$('button', el.seg).forEach(function (b) {
          b.setAttribute('aria-pressed', b.dataset.lay === lay ? 'true' : 'false');
        });
      }
      RR.store.set('mon_layout', lay);
    }
    if (animate && st.alive && el.grid && !st.focus) flipLayout(paint, FLIP_MS);
    else paint();
  }

  function autoArrange() {
    if (!st.alive) return;
    if (st.focus) closeFocus(true);
    applyLayout('auto', true);
    wakeWallbar();
    RR.toast('已按路数自动排版');
  }

  /* ---------- 文稿 ---------- */
  function labelOf(d) {
    return (d && d.name) || ('房间 ' + (d && d.room) || '');
  }
  function nameOf(c) {
    return (c && c.desc && c.desc.name) || ('房间 ' + (c && c.room));
  }

  function setState(c, state, title, sub) {
    c.state = state;
    c.el.dataset.state = state;
    if (title != null) c.stEl.textContent = title;
    if (sub != null) {
      c.ssEl.textContent = sub;
      c.ssEl.hidden = !sub;
    }
    c.retryEl.hidden = !(state === 'dead' || state === 'offline' || state === 'paused');
  }

  /* 这一格属于当前选中的主播吗：切台后给它的名字加「· 当前」，
     让监控墙能一眼看出现在跟着谁（不重建格子、不影响手动房间） */
  function isCurrentStationRoom(d) {
    if (!d || !d.auto || !d.stationId) return false;
    var s = (typeof RR.station === 'function') ? RR.station() : null;
    var sid = s ? (s.id != null ? s.id : s.mid) : '';
    return !!sid && String(d.stationId) === String(sid);
  }

  function updateDesc(c, d) {
    var base = c.desc || {};
    var desc = {
      room: String(d.room || c.room),
      name: d.name || base.name || ('房间 ' + c.room),
      title: d.title != null ? d.title : (base.title || ''),
      cover: d.cover || base.cover || '',
      online: d.online != null ? +d.online : (base.online || 0),
      auto: d.auto != null ? !!d.auto : !!base.auto,
      manual: d.manual != null ? !!d.manual : !!base.manual,
      url: d.url || base.url || '',
      /* 8.0.1：后端 playinfo 额外给出的「已经验过的 FLV 直连地址」。
         监控优先直连：B 站 CDN 允许 CORS，直连不占本机中转的 CPU 和 6 条 HTTP 连接。 */
      flv: d.flv != null ? String(d.flv) : (base.flv || ''),
      flvQn: d.flv_qn != null ? +d.flv_qn : (base.flvQn || 0),
      kind: d.kind || base.kind || 'flv',
      living: d.living != null ? !!d.living : base.living,
      stationId: (d.stationId != null && d.stationId !== '') ? String(d.stationId) : (base.stationId || '')
    };
    c.desc = desc;
    var isCur = isCurrentStationRoom(desc);
    c.nameEl.textContent = isCur ? (desc.name + ' · 当前') : desc.name;
    c.titleEl.textContent = desc.title || (c.state === 'offline' ? '没在播' : '');
    c.titleEl.hidden = !c.titleEl.textContent;
    /* 手势说明写进 aria：单击开声、双击放大、长按拖动排序 */
    c.hitEl.setAttribute('aria-label', desc.name + ' · 单击开声，双击放大，长按拖动排序');
    c.delEl.setAttribute('aria-label', '移除 ' + desc.name);
    c.el.setAttribute('aria-label', desc.name + (isCur ? '（当前主播）' : '') + ' 的直播画面');
    if (st.focus === c) syncFocusInfo();
  }

  /* ---------- 格子的建立 ---------- */
  function makeCell(d) {
    var cell = RR.el('article', 'mon-cell');
    cell.dataset.room = d.room;
    cell.dataset.state = 'loading';

    var video = RR.el('video', 'mon-cell__video');
    video.setAttribute('playsinline', '');
    video.setAttribute('disablepictureinpicture', '');
    video.preload = 'none';
    video.muted = true;

    var state = RR.el('div', 'mon-cell__state');
    var spin = RR.el('i', 'mon-spin');
    spin.setAttribute('aria-hidden', 'true');
    var stT = RR.el('b', 'mon-cell__st');
    stT.textContent = '拉流中…';
    var stS = RR.el('span', 'mon-cell__ss');
    stS.textContent = '正在连到直播间';
    var retry = RR.el('button', 'mon-cell__retry');
    retry.type = 'button';
    retry.textContent = '重连';
    retry.hidden = true;
    state.appendChild(spin);
    state.appendChild(stT);
    state.appendChild(stS);
    state.appendChild(retry);

    var bar = RR.el('div', 'mon-cell__bar');
    var dot = RR.el('span', 'mon-cell__dot');
    dot.setAttribute('aria-hidden', 'true');
    var txt = RR.el('div', 'mon-cell__txt');
    var name = RR.el('b', 'truncate');
    var title = RR.el('i', 'truncate');
    txt.appendChild(name);
    txt.appendChild(title);
    bar.appendChild(dot);
    bar.appendChild(txt);

    var hit = RR.el('button', 'mon-cell__hit');
    hit.type = 'button';

    var del = RR.el('button', 'mon-cell__del');
    del.type = 'button';
    del.innerHTML = RR.ICO('close', 18);

    /* 有声角标：只在 .is-sounding 时露出，右上角让给删格所以放左上 */
    var snd = RR.el('span', 'mon-cell__snd');
    snd.setAttribute('aria-hidden', 'true');
    snd.innerHTML = RR.ICO('volume', 14);

    cell.appendChild(video);
    cell.appendChild(state);
    cell.appendChild(bar);
    cell.appendChild(hit);
    cell.appendChild(del);
    cell.appendChild(snd);

    var c = {
      room: d.room,
      el: cell,
      video: video,
      stateEl: state,
      stEl: stT,
      ssEl: stS,
      retryEl: retry,
      nameEl: name,
      titleEl: title,
      hitEl: hit,
      delEl: del,
      sndEl: snd,
      desc: null,
      state: 'idle',
      token: 0,
      streamId: 0,
      fails: 0,
      progressAt: 0,
      lastT: -1,
      player: null,
      restartTimer: 0,
      silentTimer: 0,
      silentRestarts: 0,
      qn: THUMB_QN,
      streamQn: 0,
      viaDirect: false,     /* 当前这一路是否走 CDN 直连（失败后降级本机中转） */
      noDirect: false,      /* 直连连续失败后不再尝试，避免重连时来回切 */
      qnTimer: 0,
      wantSound: false,
      skipClickAt: 0
    };
    updateDesc(c, d);

    hit.addEventListener('click', function (e) {
      if (st.drag) return;
      if (nowMs() < (c.skipClickAt || 0)) return;
      tileTap(c, e);
    });
    del.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      removeRoom(c.room);
    });
    retry.addEventListener('click', function () { retryCell(c); });
    video.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    /* 系统长按菜单（文本选择 / 图像另存）一律不让它出来，长按留给拖动排序 */
    cell.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    bindDrag(c);

    video.addEventListener('playing', function () {
      if (!st.alive) return;
      c.progressAt = nowMs();
      c.lastT = video.currentTime || 0;
      if (c.state === 'loading' || c.state === 'reconnect' || c.state === 'paused') {
        c.fails = 0;
        setState(c, 'playing', '', '');
      }
    });
    video.addEventListener('error', function () {
      if (!st.alive || !c.player) return;
      onFatal(c, '画面断了');
    });
    /* 有限长的流（夹具 / 点播形态）放完：静默重连，不进错误层 */
    video.addEventListener('ended', function () {
      if (!st.alive) return;
      silentRestart(c);
    });

    return c;
  }

  /* ---------- 期望的房间列表（手动在前，之后按 mon_order 排） ---------- */
  function desiredRooms() {
    var out = [], seen = {};
    function push(d) {
      if (!d || !d.room || out.length >= MAX || seen[d.room]) return;
      seen[d.room] = 1;
      out.push(d);
    }
    st.manual.forEach(function (m) {
      push({ room: m.room, name: m.name, manual: true, auto: false });
    });
    st.auto.forEach(function (a) {
      var skipAt = st.dismissed[a.room];
      if (skipAt && (nowMs() - skipAt) < SKIP_TTL) return;
      push({
        room: a.room,
        name: a.name,
        title: a.title,
        cover: a.cover,
        online: a.online,
        auto: true,
        living: true,
        stationId: a.stationId || ''
      });
    });
    if (st.order.length) {
      var rank = {};
      st.order.forEach(function (room, i) { rank[room] = i; });
      out.sort(function (a, b) {
        var ra = rank[a.room], rb = rank[b.room];
        if (ra == null && rb == null) return 0;
        if (ra == null) return 1;
        if (rb == null) return -1;
        return ra - rb;
      });
    }
    return out;
  }

  function gridRooms() {
    var out = [];
    if (!el.grid) return out;
    for (var i = 0; i < el.grid.children.length; i++) {
      var node = el.grid.children[i];
      if (!node.dataset || !st.cells[node.dataset.room]) continue;
      if (node.classList.contains('is-out')) continue;
      out.push(node.dataset.room);
    }
    return out;
  }

  function reorderDom(rooms) {
    if (!el.grid) return;
    var prev = null;
    rooms.forEach(function (room) {
      var c = st.cells[room];
      if (!c || !c.el.parentNode) return;
      var ref = prev ? prev.nextSibling : el.grid.firstChild;
      if (ref !== c.el) el.grid.insertBefore(c.el, ref);
      prev = c.el;
    });
  }

  /* ---------- 增量 reconcile：不动其它格 ---------- */
  function reconcile() {
    if (!el.grid) return;
    if (st.focus) { syncUI(); return; }

    var want = desiredRooms();
    var wanted = {};
    want.forEach(function (d) { wanted[d.room] = 1; });

    Object.keys(st.cells).forEach(function (room) {
      if (!wanted[room]) dropCell(st.cells[room]);
    });

    want.forEach(function (d) {
      var c = st.cells[d.room];
      if (!c) {
        c = makeCell(d);
        st.cells[d.room] = c;
        el.grid.appendChild(c.el);
        updateDesc(c, d);
        if (st.alive) attach(c, false);
        c.el.classList.add('is-in');
      } else {
        updateDesc(c, d);
      }
    });

    reorderDom(want.map(function (d) { return d.room; }));
    syncUI();
  }

  function dropCell(c) {
    if (!c) return;
    if (st.focus === c) closeFocus(true);
    c.token++;
    clearTimeout(c.restartTimer);
    clearTimeout(c.silentTimer);
    clearTimeout(c.qnTimer);
    c.restartTimer = 0;
    c.silentTimer = 0;
    c.qnTimer = 0;
    destroyPlayer(c, false);
    delete st.cells[c.room];
    c.el.classList.add('is-out');
    c.el.style.pointerEvents = 'none';
    var node = c.el;
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
    }, 240);
  }

  /* ---------- 取 stream 信息（60s 缓存） ---------- */
  function infoFor(room) {
    var hit = st.info[room];
    if (hit && nowMs() - hit.at < INFO_TTL) return Promise.resolve(hit.data);
    return RR.api('/api/live/playinfo?room=' + encodeURIComponent(room)).then(function (d) {
      st.info[room] = { at: nowMs(), data: d };
      return d;
    });
  }

  /* 8.0 起统一走本机中转（后端支持 qn；直连 B 站 CDN 过不了 Referer/CORS） */
  function streamUrl(room, qn) {
    return '/api/live/stream?room=' + encodeURIComponent(room) + '&qn=' + encodeURIComponent(qn);
  }

  /* ---------- 拉流 ---------- */
  function attach(c, fresh, silent) {
    if (!st.alive) {
      setState(c, 'paused', nameOf(c) + ' · 已停止', '房间 ' + c.room + ' · 回监控页会接着拉流');
      return;
    }
    var token = ++c.token;
    if (fresh) delete st.info[c.room];
    clearTimeout(c.restartTimer);
    clearTimeout(c.silentTimer);
    c.restartTimer = 0;
    c.silentTimer = 0;
    c.progressAt = nowMs();
    if (!silent) setState(c, 'loading', nameOf(c) + ' · 拉流中', '房间 ' + c.room + ' 正在连到直播间');

    infoFor(c.room).then(function (d) {
      if (token !== c.token || !st.alive) return;
      if (!d || d.living === false) {
        setState(c, 'offline', nameOf(c) + ' · 没在播', '房间 ' + c.room + ' 暂时没开播');
        return;
      }
      var curName = nameOf(c);
      /* 后端已经明确「这一路取不到可播的流」（比如只有 HLS）时，直接把原因写在格子上，
         不要让它看起来只是「连不上」；有直连地址时以直连为准。 */
      if (!d.flv && d.error) {
        setState(c, 'dead', nameOf(c) + ' · 播不了', String(d.error).slice(0, 72));
        return;
      }
      updateDesc(c, {
        room: c.room,
        name: /^房间 \d+$/.test(curName) ? (d.uname || curName) : curName,
        title: d.title || c.desc.title,
        cover: d.cover || c.desc.cover,
        online: d.online,
        living: true,
        url: d.url || c.desc.url,
        /* 8.1：playinfo 的 CDN 直连地址必须在这里落进 desc，
           否则 startStream 的 direct 恒为空，六路全退回本机中转（CPU 高、起播慢）。 */
        flv: d.flv || '',
        flvQn: d.flv_qn != null ? +d.flv_qn : 0,
        kind: d.kind || 'flv'
      });
      startStream(c, d, token);
    }).catch(function (e) {
      if (token !== c.token || !st.alive) return;
      if (e && (e.status === 404 || e.status === 400)) {
        setState(c, 'offline', nameOf(c) + ' · 没在播', '房间 ' + c.room + ' 暂时没开播');
      } else {
        setState(c, 'dead', nameOf(c) + ' · 连不上', '房间 ' + c.room + ' · 点重连接回来');
      }
    });
  }

  function startStream(c, info, token) {
    destroyPlayer(c, true);
    var video = c.video;
    var qn = c.qn == null ? THUMB_QN : c.qn;
    /* 直连优先：后端 playinfo 验过的 FLV 直连地址；没有/挂了才降级本机中转 */
    var direct = (!c.noDirect && c.desc && c.desc.flv) || '';
    var url = direct || streamUrl(c.room, qn);
    c.viaDirect = !!direct;
    var withSound = !!c.wantSound;
    if (withSound) {
      /* 重开流也守住单音源：别的格哪怕还留着 wantSound，也先闭掉 */
      Object.keys(st.cells).forEach(function (room) {
        var x = st.cells[room];
        if (x && x !== c && x.wantSound) muteCell(x);
      });
    }
    video.muted = !withSound;
    if (withSound) { try { video.volume = 1; } catch (e) { } }
    paintCellSound(c, withSound);
    c.progressAt = nowMs();
    c.lastT = -1;
    c.streamId = (c.streamId || 0) + 1;
    var sid = c.streamId;

    if (!window.mpegts || !window.mpegts.isSupported || !window.mpegts.isSupported()) {
      video.src = url;
      var pr = video.play();
      if (pr && pr.catch) pr.catch(function () { });
      c.streamQn = qn;
      setState(c, 'loading', nameOf(c) + ' · 拉流中', '房间 ' + c.room + ' · 这台设备在试直连');
      return;
    }

    var player;
    try {
      player = window.mpegts.createPlayer({
        type: 'flv',
        isLive: true,
        /* 和直播页完全同参：多路是否出声由 video.muted 控制，
           不在 mpegts 层砍音轨，避免不同房间的纯音频头把 demux 卡住 */
        hasAudio: true,
        hasVideo: true,
        url: url
      }, {
        enableStashBuffer: false,
        lazyLoad: false,
        autoCleanupSourceBuffer: true,
        autoCleanupMaxBackwardDuration: 24,
        autoCleanupMinBackwardDuration: 12,
        /* 多路墙上不做追帧：少一次 seek，多路更稳、A/V 不容易被拉偏 */
        liveBufferLatencyChasing: false,
        stashInitialSize: 128,
        enableWorker: false
      });
    } catch (e) {
      setState(c, 'dead', nameOf(c) + ' · 播放器起不来', '房间 ' + c.room + ' · 点重连接回来');
      return;
    }
    c.player = player;
    c.streamQn = qn;

    player.on(window.mpegts.Events.ERROR, function (type, detail) {
      if (sid !== c.streamId || !st.alive) return;
      var msg = String(detail || type || '');
      if (msg.indexOf('RuntimeException') >= 0) return;  /* 只过滤 mpegts 自身的偶发 */
      onFatal(c, msg || '流断了');
    });

    try {
      player.attachMediaElement(video);
      player.load();
      player.play();
    } catch (e2) {
      onFatal(c, e2.message || '播放器起不来');
    }
  }

  function destroyPlayer(c, keepSrc) {
    var p = c.player;
    c.player = null;
    c.streamId = (c.streamId || 0) + 1;
    c.streamQn = 0;
    if (p) {
      try { p.pause(); } catch (e) { }
      try { p.unload(); } catch (e) { }
      try { p.detachMediaElement(); } catch (e) { }
      /* 多路并发时立刻 destroy 偶发崩溃，推迟一拍 */
      setTimeout(function () { try { p.destroy(); } catch (e) { } }, DESTROY_DELAY);
    }
    var v = c.video;
    if (v) {
      try { v.pause(); } catch (e) { }
      if (!keepSrc) {
        try { v.removeAttribute('src'); v.load(); } catch (e) { }
      }
    }
    c.progressAt = 0;
  }

  /* 焦点 / 缩略切换时按需重连：qn 没变就不动流，避免抖动 */
  function scheduleQn(c) {
    if (!c) return;
    clearTimeout(c.qnTimer);
    c.qnTimer = setTimeout(function () {
      c.qnTimer = 0;
      if (!st.alive || !c.el) return;
      if (c.viaDirect) return;                 /* 直连只有一档，不因焦点来回重连 */
      if (c.qn == null || c.qn === c.streamQn) return;
      if (c.state === 'dead' || c.state === 'offline' || c.state === 'paused') return;
      clearTimeout(c.restartTimer);
      clearTimeout(c.silentTimer);
      c.restartTimer = 0;
      c.silentTimer = 0;
      attach(c, false, true);
    }, QN_SETTLE);
  }

  /* ---------- 看门狗 / 重连 ---------- */
  /* 「放完」不是「断了」：保留最后一帧，静默换一次源；失败才进错误层 */
  function silentRestart(c) {
    if (!st.alive || c.silentTimer) return;
    if (c.state === 'dead' || c.state === 'offline' || c.state === 'paused') return;
    c.fails = 0;
    clearTimeout(c.restartTimer);
    c.restartTimer = 0;
    c.silentTimer = setTimeout(function () {
      c.silentTimer = 0;
      if (!st.alive) return;
      if (c.state === 'dead' || c.state === 'offline') return;
      c.token++;
      attach(c, true, true);
    }, 180);
  }

  function onFatal(c, why) {
    if (!st.alive || c.state === 'dead' || c.restartTimer) return;
    if (c.state === 'reconnect') return;
    if (c.fails >= MAX_FAILS) { markDead(c); return; }
    /* 8.0.1：第二次失败就换通道 —— 直连→本机中转；中转→服务端默认档 */
    if (c.fails >= 1) {
      if (c.viaDirect) { c.noDirect = true; c.viaDirect = false; }
      else if (c.qn !== 0) { c.qn = 0; }
    }
    c.fails += 1;
    var wait = BACKOFF[Math.min(c.fails - 1, BACKOFF.length - 1)];
    setState(c, 'reconnect', nameOf(c) + ' · 重连 ' + c.fails + '/' + MAX_FAILS, '房间 ' + c.room + ' · 流断了，再试一次');
    destroyPlayer(c, true);
    c.restartTimer = setTimeout(function () {
      c.restartTimer = 0;
      if (!st.alive) return;
      attach(c, true);
    }, wait);
  }

  function markDead(c) {
    c.fails = MAX_FAILS;
    destroyPlayer(c, true);
    setState(c, 'dead', nameOf(c) + ' · 断开了', '房间 ' + c.room + ' · 点重连接回来');
  }

  function retryCell(c) {
    if (!st.alive) return;
    c.fails = 0;
    clearTimeout(c.restartTimer);
    clearTimeout(c.silentTimer);
    clearTimeout(c.qnTimer);
    c.restartTimer = 0;
    c.silentTimer = 0;
    c.qnTimer = 0;
    c.token++;
    c.noDirect = false;
    c.viaDirect = false;
    c.qn = st.focus === c ? FOCUS_QN : THUMB_QN;
    attach(c, true);
  }

  /* 错位检测：只看 DOM 顺序（拖动中让位由拖拽接管，重连逻辑完全不动） */
  function fixPlacement() {
    if (!el.grid || st.focus) return;
    if (st.drag && st.drag.active) return;
    var want = [], list = desiredRooms();
    for (var i = 0; i < list.length; i++) {
      if (st.cells[list[i].room]) want.push(list[i].room);
    }
    var have = gridRooms();
    if (!want.length || want.length !== have.length) return;
    for (var j = 0; j < want.length; j++) {
      if (want[j] !== have[j]) { reorderDom(want); return; }
    }
  }

  function watch() {
    if (!st.alive) return;
    fixPlacement();
    var now = nowMs();
    Object.keys(st.cells).forEach(function (room) {
      var c = st.cells[room];
      if (!c) return;
      if (c.state === 'dead' || c.state === 'offline' || c.state === 'paused') return;
      var v = c.video;
      if (!v) return;
      var t = v.currentTime || 0;
      var dur = v.duration;
      if (isFinite(dur) && dur > 0 && (v.ended || dur - t < 1.5)) {
        silentRestart(c);
        return;
      }
      if (t > 0.2 && t !== c.lastT) {
        c.lastT = t;
        c.progressAt = now;
        c.silentRestarts = 0;
        if (c.state !== 'playing') {
          c.fails = 0;
          setState(c, 'playing', '', '');
        }
        return;
      }
      if (!c.progressAt) c.progressAt = now;
      if (now - c.progressAt >= STALL_MS && c.state !== 'reconnect') {
        /* 先静默换一次源，还不动才进「重连」错误层（终点是流放完而不是断流） */
        if ((c.silentRestarts || 0) < 1) {
          c.silentRestarts = 1;
          silentRestart(c);
        } else {
          onFatal(c, '画面不动了');
        }
      }
    });
  }

  function startWatchdog() {
    stopWatchdog();
    st.watchdog = setInterval(watch, WATCH_MS);
  }
  function stopWatchdog() {
    if (st.watchdog) { clearInterval(st.watchdog); st.watchdog = 0; }
  }
  function startRefresher() {
    stopRefresher();
    st.refresher = setInterval(function () {
      if (st.alive && !st.focus) discover(true);
    }, 60000);
  }
  function stopRefresher() {
    if (st.refresher) { clearInterval(st.refresher); st.refresher = 0; }
  }

  /* ---------- 自动补台 ---------- */
  function stationSid(s) {
    if (!s) return '';
    var id = (s.id != null) ? s.id : s.mid;
    return (id == null) ? '' : String(id);
  }

  /* 顶栏切台：作废 60s 缓存；监控页可见时静默重跑（只增删差集，不重建已有格） */
  function onStation(s) {
    var sid = stationSid(s) || stationSid(RR.station && RR.station());
    var t = nowMs();
    if (sid && sid === stationEvt.sid && (t - stationEvt.at) < STATION_EVT_GAP) return;
    stationEvt.sid = sid;
    stationEvt.at = t;

    st.autoAt = 0;                       /* ① 下次 discover 必重取，不吃 60s 缓存 */
    if (!st.alive) return;               /* 不在监控页：标脏，enter 时 discover(false) 会重取 */
    if (typeof RR.route === 'function' && RR.route() !== 'monitor') return;
    discover(true);                      /* ② 强制批次；with focus 时只更新数据，不打断 */
  }

  function discover(force) {
    if (st.discovering && !force) return;
    if (!force && st.autoAt && nowMs() - st.autoAt < DISCOVER_TTL) {
      st.loadedOnce = true;
      reconcile();
      syncUI();
      return;
    }
    st.discovering = true;
    st.autoErr = '';
    var token = ++st.discoverToken;
    var stations = (RR.stations && RR.stations()) || [];
    /* 当前主播排在最前：后端若忽略 station/room 参数、只按当前主主播返回，
       当前这一路的 uname/title 会先占住房间号，不会被列表里旧主播的名字抢走 */
    var curSid = stationSid(RR.station && RR.station());
    if (curSid) {
      var ci = -1;
      for (var si = 0; si < stations.length; si++) {
        if (stationSid(stations[si]) === curSid) { ci = si; break; }
      }
      if (ci > 0) {
        stations = [stations[ci]].concat(stations.slice(0, ci), stations.slice(ci + 1));
      }
    }
    var reqs = [];
    stations.forEach(function (s) {
      if (!s) return;
      var q = [];
      if (s.id != null) q.push('station=' + encodeURIComponent(s.id));
      if (s.room) q.push('room=' + encodeURIComponent(s.room));
      else if (s.mid != null) q.push('mid=' + encodeURIComponent(s.mid));
      if (!q.length) return;
      reqs.push(RR.api('/api/live/playinfo?' + q.join('&')).then(function (d) {
        return { ok: true, s: s, d: d };
      }, function (e) {
        return { ok: false, s: s, e: e };
      }));
    });
    var fp = RR.api('/api/following/live').then(function (d) {
      return { ok: true, d: d };
    }, function (e) {
      return { ok: false, e: e };
    });
    syncUI();

    Promise.all(reqs.concat([fp])).then(function (all) {
      if (token !== st.discoverToken) return;
      st.discovering = false;
      var f = all[all.length - 1];
      var list = [], seen = {}, fail = 0, keep = {};

      all.slice(0, -1).forEach(function (r) {
        if (!r.ok) {
          fail++;
          if (r.s && r.s.room) keep[String(r.s.room)] = 1;
          return;
        }
        var d = r.d || {};
        if (!(d.living || d.live)) return;
        var room = String(d.room || (r.s && r.s.room) || '');
        if (!room || seen[room]) return;
        seen[room] = 1;
        list.push({
          room: room,
          name: (r.s && r.s.name) || d.uname || ('房间 ' + room),
          title: d.title || '',
          cover: d.cover || '',
          online: +d.online || 0,
          auto: true,
          stationId: (r.s && (r.s.id != null ? r.s.id : r.s.mid)) || ''
        });
        st.info[room] = { at: nowMs(), data: d };
      });

      if (f.ok) {
        var arr = (f.d && f.d.living) || [];
        arr.forEach(function (x) {
          var room = String(x.room || '');
          if (!room || seen[room]) return;
          seen[room] = 1;
          list.push({
            room: room,
            name: x.name || ('房间 ' + room),
            title: x.title || '',
            cover: x.cover || '',
            online: +x.online || 0,
            auto: true
          });
        });
      } else {
        fail++;
      }

      var total = reqs.length + 1;
      if (fail >= total) {
        st.autoErr = '自动补台没成功，检查网络后再试一次。';
      } else {
        /* 单站探失败时保留它原来那一路，别让画面无故消失 */
        st.auto.forEach(function (a) {
          if (keep[a.room] && !seen[a.room]) { seen[a.room] = 1; list.push(a); }
        });
        st.auto = list;
        st.autoAt = nowMs();
      }
      st.loadedOnce = true;
      if (st.focus) { syncUI(); return; }
      reconcile();
      syncUI();
    }, function () {
      if (token !== st.discoverToken) return;
      st.discovering = false;
      st.autoErr = '自动补台没成功，检查网络后再试一次。';
      st.loadedOnce = true;
      reconcile();
      syncUI();
    });
  }

  /* ---------- 删格 ---------- */
  function removeRoom(room) {
    room = String(room || '');
    var c = st.cells[room];
    if (!c) return;
    if (st.focus === c) closeFocus(true);
    if (st.drag && st.drag.c === c) dragCancel();
    var wasManual = !!(c.desc && c.desc.manual);
    var name = labelOf(c.desc);

    var idx = -1;
    for (var i = 0; i < st.manual.length; i++) {
      if (st.manual[i].room === room) { idx = i; break; }
    }
    if (idx >= 0) { st.manual.splice(idx, 1); saveManual(); }
    if (c.desc && c.desc.auto) { st.dismissed[room] = nowMs(); saveSkip(); }
    for (var j = 0; j < st.auto.length; j++) {
      if (st.auto[j].room === room) { st.auto.splice(j, 1); break; }
    }
    var oi = st.order.indexOf(room);
    if (oi >= 0) {
      var order = st.order.slice();
      order.splice(oi, 1);
      saveOrder(order);
    }

    c.token++;
    clearTimeout(c.restartTimer);
    clearTimeout(c.qnTimer);
    c.restartTimer = 0;
    c.qnTimer = 0;
    delete st.cells[room];
    destroyPlayer(c, false);
    c.el.classList.add('is-out');
    c.el.style.pointerEvents = 'none';
    var node = c.el;
    setTimeout(function () {
      if (node.parentNode) node.parentNode.removeChild(node);
      if (st.alive) reconcile();
      syncUI();
    }, 260);
    syncUI();
    RR.toast((wasManual ? '移除 ' : '移除了 ') + name);
  }

  /* ---------- 加一路 ---------- */
  function faceUrl(u) {
    if (!u) return '';
    u = String(u);
    if (u.indexOf('//') === 0) return 'https:' + u;
    return u;
  }

  /* 已添加的主播（/api/stations）：去掉已在监控的、没有房间号的，点一行直接加 */
  function stationPicks() {
    var out = [], seen = {};
    var stations = (RR.stations && RR.stations()) || [];
    stations.forEach(function (s) {
      if (!s) return;
      var room = String(s.room || '').trim();
      if (!isRoom(room) || seen[room]) return;
      if (st.cells[room]) return;
      for (var i = 0; i < st.manual.length; i++) if (st.manual[i].room === room) return;
      seen[room] = 1;
      out.push({ room: room, name: s.name || ('房间 ' + room), face: s.face || '' });
    });
    return out;
  }

  function pickStation(p) {
    if (!p || !isRoom(p.room)) return;
    if (st.cells[p.room]) { RR.closeSheet(); RR.toast('这一路已经在看了', 'err'); return; }
    var dup = false;
    for (var i = 0; i < st.manual.length; i++) if (st.manual[i].room === p.room) dup = true;
    if (!dup) st.manual.push({ room: p.room, name: p.name || ('房间 ' + p.room) });
    saveManual();
    delete st.dismissed[p.room];
    saveSkip();
    RR.closeSheet();
    reconcile();
    if (st.alive) discover(true);
    RR.toast('加上了');
  }

  function buildPickList() {
    var wrap = RR.el('div', 'mon-pick');
    var head = RR.el('p', 'mon-pick__h');
    head.textContent = '已添加的主播';
    wrap.appendChild(head);

    var picks = stationPicks();
    if (!picks.length) {
      var all = (RR.stations && RR.stations()) || [];
      var empty = RR.el('p', 'mon-pick__empty');
      /* 全被过滤（都已经在监控里）和真的一个都没添加过是两件事，别让用户以为列表坏了 */
      empty.textContent = all.length ? '关注的主播都已经在监控里了' : '还没有添加过主播';
      wrap.appendChild(empty);
      return wrap;
    }

    var list = RR.el('div', 'mon-pick__list');
    picks.forEach(function (p) {
      var row = RR.el('button', 'mon-pick__row');
      row.type = 'button';
      row.setAttribute('aria-label', '加一路 ' + p.name + '（房间 ' + p.room + '）');

      var av = RR.el('span', 'mon-pick__av');
      av.setAttribute('aria-hidden', 'true');
      av.textContent = (p.name || '房').slice(0, 1);
      if (p.face) {
        var img = RR.el('img');
        img.alt = '';
        img.setAttribute('referrerpolicy', 'no-referrer');
        img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); };
        img.src = faceUrl(p.face);
        av.appendChild(img);
      }

      var txt = RR.el('span', 'mon-pick__t');
      var nm = RR.el('b', 'mon-pick__n');
      nm.textContent = p.name;
      var rm = RR.el('i', 'mon-pick__r');
      rm.textContent = '房间 ' + p.room;
      txt.appendChild(nm);
      txt.appendChild(rm);

      var ico = RR.el('span', 'mon-pick__ico');
      ico.setAttribute('aria-hidden', 'true');
      ico.innerHTML = RR.ICO('plus', 16);

      row.appendChild(av);
      row.appendChild(txt);
      row.appendChild(ico);
      row.addEventListener('click', function () { pickStation(p); });
      list.appendChild(row);
    });
    wrap.appendChild(list);
    return wrap;
  }

  function openAdd() {
    if (Object.keys(st.cells).length >= MAX) {
      RR.toast('最多同时看 ' + MAX + ' 路，先移除一路', 'err');
      return;
    }
    var box = RR.el('div', 'mon-form');
    /* 快捷：已添加的主播（点一下直接加一路） */
    box.appendChild(buildPickList());
    var div = RR.el('div', 'mon-pick__div');
    box.appendChild(div);

    var lab2 = RR.el('p', 'mon-pick__lab');
    lab2.textContent = '或者手输房间号';
    box.appendChild(lab2);

    var lab = RR.el('label', 'sr-only');
    lab.setAttribute('for', 'mon-room');
    lab.textContent = '直播间房间号';
    var input = RR.el('input', 'fld');
    input.id = 'mon-room';
    input.type = 'text';
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('maxlength', '12');
    input.placeholder = '直播间房间号，例如 2233';
    var hint = RR.el('p', 'muted');
    hint.style.cssText = 'margin-top:10px;font-size:12.5px;line-height:1.6';
    hint.textContent = '填 B 站直播间的房间号；正在直播才会出画面。';
    box.appendChild(lab);
    box.appendChild(input);
    box.appendChild(hint);

    function submit() {
      var room = String(input.value || '').replace(/\D/g, '').slice(0, 12);
      if (!isRoom(room)) {
        RR.toast('房间号是一串数字', 'err');
        try { input.focus(); } catch (e) { }
        return;
      }
      if (st.cells[room]) { RR.toast('这一路已经在看了', 'err'); return; }
      st.manual.push({ room: room, name: '房间 ' + room });
      saveManual();
      delete st.dismissed[room];
      saveSkip();
      RR.closeSheet();
      RR.toast('加上了，正在拉流');
      reconcile();
      if (st.alive) discover(true);
    }

    RR.sheet({
      title: '加一路监控',
      body: box,
      actions: [
        { label: '取消' },
        { label: '加进来', primary: true, keepOpen: true, onClick: submit }
      ]
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    /* 上面有快捷列表时别抢焦点弹键盘，手输才需要 */
    if (!box.querySelector('.mon-pick__row')) {
      setTimeout(function () { try { input.focus(); } catch (e) { } }, 260);
    }
  }

  /* ---------- FLIP ---------- */
  function snapshotCells(exclude) {
    var recs = [];
    Object.keys(st.cells).forEach(function (room) {
      var c = st.cells[room];
      var node = c.el;
      if (!node || node === exclude || !node.parentNode) return;
      if (node.classList.contains('is-out')) return;
      var r = node.getBoundingClientRect();
      if (!r.width && !r.height) return;
      recs.push({ node: node, x: r.left, y: r.top, w: r.width, h: r.height });
    });
    return recs;
  }

  function playFlip(recs, dur) {
    recs.forEach(function (rec) {
      var node = rec.node;
      if (!node || !node.parentNode) return;
      node.style.transition = 'none';
      node.style.transform = 'none';
      node.style.transformOrigin = '0 0';
      var r = node.getBoundingClientRect();
      if (!r.width || !r.height) {
        node.style.transition = '';
        node.style.transformOrigin = '';
        return;
      }
      var dx = rec.x - r.left, dy = rec.y - r.top;
      var sx = rec.w / r.width, sy = rec.h / r.height;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 &&
          Math.abs(sx - 1) < .004 && Math.abs(sy - 1) < .004) {
        node.style.transition = '';
        node.style.transformOrigin = '';
        return;
      }
      node.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(' + sx + ',' + sy + ')';
      requestAnimationFrame(function () {
        if (!node.parentNode) return;
        node.style.transition = 'transform ' + dur + 'ms var(--ease)';
        node.style.transform = 'none';
        setTimeout(function () {
          node.style.transition = '';
          node.style.transform = '';
          node.style.transformOrigin = '';
        }, dur + 30);
      });
    });
  }

  function flipLayout(fn, dur) {
    if (!el.grid || (st.drag && st.drag.active)) { fn(); return; }
    var recs = snapshotCells(null);
    fn();
    playFlip(recs, dur);
  }

  function layoutRect(node) {
    var tr = node.style.transform, ts = node.style.transition;
    node.style.transition = 'none';
    node.style.transform = 'none';
    var r = node.getBoundingClientRect();
    node.style.transform = tr;
    node.style.transition = ts;
    return r;
  }

  /* ---------- 焦点：一大多小 ---------- */
  function applyFocusClasses() {
    if (!el.grid) return;
    var thumbs = 0;
    Object.keys(st.cells).forEach(function (room) {
      var c = st.cells[room];
      var main = !!st.focus && st.focus === c;
      c.el.classList.toggle('is-focus-main', main);
      c.el.classList.toggle('is-focus-mini', !!st.focus && !main);
      if (st.focus && !main) thumbs++;
    });
    var on = !!st.focus;
    el.grid.classList.toggle('is-focus', on);
    if (el.view) el.view.classList.toggle('is-focusing', on);
    if (on) {
      if (thumbs === 0) {
        el.grid.style.gridTemplateColumns = 'minmax(0,1fr)';
        el.grid.style.gridTemplateRows = 'minmax(0,1fr)';
      } else if (isLandscape()) {
        el.grid.style.gridTemplateColumns = '2fr 1fr';
        el.grid.style.gridTemplateRows = 'repeat(' + thumbs + ', minmax(0, 1fr))';
      } else {
        var cols = Math.min(3, thumbs);
        el.grid.style.gridTemplateColumns = 'repeat(' + cols + ', minmax(0, 1fr))';
        el.grid.style.gridTemplateRows = 'auto';
      }
    } else {
      el.grid.style.gridTemplateColumns = '';
      el.grid.style.gridTemplateRows = '';
    }
  }

  function openFocus(c) {
    if (!c || !st.alive) return;
    if (st.focus === c) { closeFocus(false); return; }
    var prev = st.focus;
    if (prev) {
      prev.qn = THUMB_QN;
      muteCell(prev);
      scheduleQn(prev);
    }
    st.focus = c;
    c.qn = FOCUS_QN;
    /* 进焦点仍然默认静音：要出声点焦点条的喇叭，或双击前先单击开声 */
    muteCell(c);
    syncFocusSound();
    flipLayout(function () {
      applyFocusClasses();
      if (el.focusBar) el.focusBar.hidden = false;
      syncFocusInfo();
    }, FOCUS_MS);
    scheduleQn(c);
    wakeWallbar();
  }

  function closeFocus(immediate) {
    var c = st.focus;
    if (!c) return;
    st.focus = null;
    c.qn = THUMB_QN;
    muteAll();            /* 收起放大一律回到全静音 */
    syncFocusSound();
    function paint() {
      applyFocusClasses();
      if (el.focusBar) el.focusBar.hidden = true;
    }
    if (immediate) paint();
    else flipLayout(paint, 300);
    scheduleQn(c);
    if (!immediate) {
      setTimeout(function () { if (st.alive) reconcile(); }, FOCUS_MS);
    }
  }

  function syncFocusInfo() {
    var c = st.focus;
    if (!c) return;
    var d = c.desc || {};
    if (el.focusName) el.focusName.textContent = d.name || nameOf(c);
    if (el.focusTitle) el.focusTitle.textContent = d.title || ('房间 ' + c.room);
    if (el.focusOnline) {
      var n = +d.online || 0;
      el.focusOnline.textContent = n > 0 ? (RR.fmtCount(n) + ' 人在看') : '';
    }
  }

  /* ============================================================
     声音：监控默认静音，多路墙上永远只有一路出声
     · 开声前先 RR.player.stop()，停掉原生回放（单音源）
     · 开某一路 = 其它路 video.muted=true + wantSound=false，再解自己的静音
     · 焦点条的 #mon-focus-sound 与 st.focus.wantSound 双向同步
     ============================================================ */
  function muteCell(c) {
    if (!c) return;
    c.wantSound = false;
    try { if (c.video) c.video.muted = true; } catch (e) { }
    paintCellSound(c, false);
  }

  function paintCellSound(c, on) {
    if (!c || !c.el) return;
    c.el.classList.toggle('is-sounding', !!on);
    if (c.sndEl) c.sndEl.setAttribute('aria-hidden', on ? 'false' : 'true');
  }

  function unmuteCell(c) {
    if (!c) return;
    if (RR.player && typeof RR.player.stop === 'function') {
      try { RR.player.stop(); } catch (e) { }
    }
    /* 单音源：其它路一律闭麦（连 wantSound 一起清掉，重连时不会偷偷响） */
    Object.keys(st.cells).forEach(function (room) {
      var x = st.cells[room];
      if (x && x !== c) muteCell(x);
    });
    c.wantSound = true;
    try {
      if (c.video) { c.video.muted = false; c.video.volume = 1; }
    } catch (e) { }
    paintCellSound(c, true);
    syncFocusSound();
  }

  function applyCellSound(c, on) {
    if (!c) return;
    if (on) unmuteCell(c);
    else { muteCell(c); syncFocusSound(); }
  }

  function toggleCellSound(c) {
    if (!st.alive || !c) return;
    applyCellSound(c, !c.wantSound);
  }

  function syncFocusSound() {
    var on = !!(st.focus && st.focus.wantSound);
    st.focusMuted = !on;
    setSoundIcon(on);
  }

  function muteAll() {
    Object.keys(st.cells).forEach(function (room) { muteCell(st.cells[room]); });
  }

  /* 焦点条那颗声音按钮：直接切焦点格（和单击瓦片同一条链路） */
  function setSound(on) {
    var c = st.focus;
    if (!c) return;
    applyCellSound(c, !!on);
  }

  function setSoundIcon(on) {
    if (!el.sound) return;
    el.sound.innerHTML = RR.ICO(on ? 'volume' : 'mute', 20);
    el.sound.setAttribute('aria-pressed', on ? 'true' : 'false');
    el.sound.setAttribute('aria-label', on ? '声音：已开' : '声音：已静音');
  }

  /* ---------- 横屏墙 ---------- */
  function wakeWallbar() {
    if (!st.wall || !el.wallBar) return;
    el.wallBar.classList.remove('is-away');
    clearTimeout(st.wallTimer);
    st.wallTimer = setTimeout(function () {
      st.wallTimer = 0;
      if (st.wall && el.wallBar) el.wallBar.classList.add('is-away');
    }, WALL_IDLE);
  }

  function setWall(on) {
    on = !!on;
    if (!el.view) return;
    if (st.wall === on) {
      if (on) wakeWallbar();
      return;
    }
    st.wall = on;
    el.view.classList.toggle('is-wall', on);
    if (el.wall) el.wall.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) {
      document.documentElement.style.overflow = 'hidden';
      wakeWallbar();
    } else {
      document.documentElement.style.overflow = '';
      clearTimeout(st.wallTimer);
      st.wallTimer = 0;
      if (el.wallBar) el.wallBar.classList.remove('is-away');
    }
  }

  function enterWall() {
    st.wallManual = true;
    setOrient('landscape');
    setWall(true);
    wakeWallbar();
  }

  function exitWall() {
    st.wallManual = false;
    setOrient('portrait');
    setWall(false);
  }

  /* 进入/离开页面时决定墙的状态；竖屏手动进墙也保留 */
  function syncWallForRoute() {
    if (!st.alive) { setWall(false); return; }
    var want = isLandscape() ? (st.wallManual !== false) : (st.wallManual === true);
    setWall(want);
  }

  function onOrient() {
    if (!isLandscape() && st.wallManual === false) st.wallManual = null;
    if (!st.alive) return;
    if (isLandscape()) {
      if (!st.wall && st.wallManual !== false) setWall(true);
    } else if (st.wall && st.wallManual !== true) {
      setWall(false);
    }
    if (st.focus) applyFocusClasses();
  }

  /* ---------- 铺满 / 完整 ----------
     铺满（默认）：格子不再锁 16:9，按 .is-wall 的行高填满视口，video cover 裁切
     完整：grid 回到按 16:9 算出来的宽度、margin:auto 居中，video contain 看全画面
     状态落 mon_fit；类挂在 #mon-grid 上（.is-fit-contain） */
  function applyFit(fit, persist) {
    st.fit = (fit === 'contain') ? 'contain' : 'cover';
    if (el.grid) el.grid.classList.toggle('is-fit-contain', st.fit === 'contain');
    paintFit();
    if (persist !== false) RR.store.set('mon_fit', st.fit);
  }

  function toggleFit() {
    applyFit(st.fit === 'contain' ? 'cover' : 'contain');
    wakeWallbar();
    RR.toast(st.fit === 'contain' ? '画面：完整（墙里 16:9 等比居中）' : '画面：铺满（墙里裁切填满）');
  }

  function paintFit() {
    var cover = st.fit !== 'contain';
    var tip = (cover ? '画面：铺满' : '画面：完整') + '（点一下切换）';
    if (el.fit) {
      var txt = RR.$('[data-mon-fit-txt]', el.fit);
      if (txt) txt.textContent = cover ? '铺满' : '完整';
      var ico = RR.$('[data-ico]', el.fit);
      if (ico) {
        ico.innerHTML = RR.ICO(cover ? 'expand' : 'image', 16);
        ico.dataset.iconized = '1';
      }
      el.fit.setAttribute('aria-pressed', cover ? 'true' : 'false');
      el.fit.setAttribute('aria-label', tip);
    }
    if (el.fit2) {
      el.fit2.textContent = cover ? '铺满' : '完整';
      el.fit2.setAttribute('aria-pressed', cover ? 'true' : 'false');
      el.fit2.setAttribute('aria-label', tip);
    }
  }

  /* ---------- 手势：单击开声 / 双击放大 / 长按拖动 ---------- */
  /* 单击先等 DOUBLE_MS，确认不是双击再开声；双击直接放大/还原 */
  function tileTap(c, e) {
    var t = nowMs();
    var x = (e && e.clientX) || 0, y = (e && e.clientY) || 0;
    if (tap.c === c && tap.timer && (t - tap.at) < DOUBLE_MS &&
        Math.abs(x - tap.x) <= DOUBLE_SLOP && Math.abs(y - tap.y) <= DOUBLE_SLOP) {
      clearTimeout(tap.timer);
      tap = { c: null, at: 0, x: 0, y: 0, timer: 0 };
      openFocus(c);
      return;
    }
    clearTimeout(tap.timer);
    tap = { c: c, at: t, x: x, y: y, timer: 0 };
    tap.timer = setTimeout(function () {
      tap = { c: null, at: 0, x: 0, y: 0, timer: 0 };
      toggleCellSound(c);
    }, DOUBLE_MS);
  }

  /* ---------- 长按拖动排序 ---------- */
  function bindDrag(c) {
    var hit = c.hitEl;
    /* 常驻的非 passive touchmove：WebView 在 touchstart 时就认这段手势要交给 JS，
       之后的 touchmove 才是 cancelable（拖到一半才挂监听器通常已经晚了）；
       真正跟手的位移仍由 document 上那条 dragTouchMove 做 */
    hit.addEventListener('touchmove', function (e) {
      var d = st.drag;
      if (!d || d.c !== c) return;
      if (d.active && e.cancelable) e.preventDefault();
    }, { passive: false });
    /* touchstart 必须非 passive：长按已激活时要 preventDefault，挡住系统长按菜单和滚动；
       tile 上的 touch-action:none 让 WebView 不从瓦片上抢手势，这才拖得动 */
    hit.addEventListener('touchstart', function (e) {
      if (st.drag && st.drag.active) {
        if (e.cancelable) e.preventDefault();
        return;
      }
      if (e.touches.length !== 1) return;
      dragBegin(c, e.touches[0].clientX, e.touches[0].clientY, true);
    }, { passive: false });
    hit.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      dragBegin(c, e.clientX, e.clientY, false);
    });
    hit.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  }

  function dragBegin(c, x, y, touch) {
    if (!st.alive || st.drag || st.focus || !c || !c.el.parentNode) return;
    st.drag = {
      c: c, x0: x, y0: y, tx: 0, ty: 0, cx: 0, cy: 0,
      active: false, moved: false, touch: !!touch, timer: 0
    };
    st.drag.timer = setTimeout(dragArm, HOLD_MS);
    if (touch) {
      document.addEventListener('touchmove', dragTouchMove, { passive: false });
      document.addEventListener('touchend', dragTouchEnd);
      document.addEventListener('touchcancel', dragTouchEnd);
    } else {
      document.addEventListener('mousemove', dragMouseMove);
      document.addEventListener('mouseup', dragMouseUp);
    }
  }

  function dragUnbind() {
    document.removeEventListener('touchmove', dragTouchMove);
    document.removeEventListener('touchend', dragTouchEnd);
    document.removeEventListener('touchcancel', dragTouchEnd);
    document.removeEventListener('mousemove', dragMouseMove);
    document.removeEventListener('mouseup', dragMouseUp);
  }

  function dragArm() {
    var d = st.drag;
    if (!d || !d.c) return;
    d.active = true;
    var c = d.c;
    /* 8.0 修复：拖动目标用「拖动开始时冻结的格子槽位」判定，不再用 elementFromPoint。
       原因：格子一换位，elementFromPoint 命中的目标会跟着变，手指停在原地也会来回换位，
       松手后顺序又回到原样（真机长按拖动排序失效）。槽位是静态的，越过边界才移动一次。 */
    d.slots = Array.prototype.slice.call(el.grid.children).map(function (n) {
      var r = n.getBoundingClientRect();
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
    });
    c.el.classList.add('is-dragging');
    c.el.style.transition = 'none';
    c.el.style.transformOrigin = '0 0';
    c.el.style.pointerEvents = 'none';
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { } }
  }

  function dragApply() {
    var d = st.drag;
    if (!d || !d.active || !d.c || !d.c.el) return;
    d.c.el.style.transform = 'translate3d(' + (d.tx + d.cx) + 'px,' + (d.ty + d.cy) + 'px,0) scale(1.02)';
  }

  function dragMoveTo(x, y) {
    var d = st.drag;
    if (!d) return;
    var dx = x - d.x0, dy = y - d.y0;
    if (!d.active) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) > MOVE_SLOP) dragCancel();
      return;
    }
    d.tx = dx;
    d.ty = dy;
    if (Math.abs(dx) > MOVE_SLOP || Math.abs(dy) > MOVE_SLOP) d.moved = true;
    dragApply();
    if (d.moved) dragTarget(x, y);
  }

  function dragTarget(x, y) {
    var d = st.drag;
    if (!d || !d.active || !el.grid) return;
    var slots = d.slots;
    if (!slots || !slots.length) return;
    var me = d.c.el;

    /* 落在哪一格：先找包含点的那一格，落在缝里就取中心最近的 */
    var found = -1, best = Infinity;
    for (var i = 0; i < slots.length; i++) {
      var r = slots[i];
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { found = i; break; }
      var dx = x - r.cx, dy = y - r.cy, dist = dx * dx + dy * dy;
      if (dist < best) { best = dist; found = i; }
    }
    if (found < 0) return;

    var kids = Array.prototype.slice.call(el.grid.children);
    var cur = kids.indexOf(me);
    if (cur < 0 || found === cur) return;
    var ref = kids[found];
    if (!ref || ref === me) return;

    var recs = snapshotCells(me);
    var before = layoutRect(me);
    if (found < cur) el.grid.insertBefore(me, ref);
    else el.grid.insertBefore(me, ref.nextSibling);
    var after = layoutRect(me);
    d.cx += before.left - after.left;
    d.cy += before.top - after.top;
    dragApply();
    playFlip(recs, 200);
    /* 每换一次位就落盘：真机上 touchend 有时被 WebView 吞掉，
       只靠 dragEnd 写会在重进页面后顺序还原。 */
    saveOrderFromDom();
  }

  function dragTouchMove(e) {
    var d = st.drag;
    if (!d) return;
    if (d.active && e.cancelable) e.preventDefault();
    var t = e.touches && e.touches[0];
    if (!t) return;
    dragMoveTo(t.clientX, t.clientY);
  }

  function dragTouchEnd(e) {
    if (e && e.type === 'touchcancel') { dragCancel(); return; }
    dragEnd();
  }

  function dragMouseMove(e) { dragMoveTo(e.clientX, e.clientY); }
  function dragMouseUp() { dragEnd(); }

  function dragCancel() {
    var d = st.drag;
    dragUnbind();
    st.drag = null;
    if (!d) return;
    clearTimeout(d.timer);
    var c = d.c;
    if (!c) return;
    c.skipClickAt = nowMs() + 300;
    c.el.classList.remove('is-dragging');
    c.el.style.transition = '';
    c.el.style.transform = '';
    c.el.style.transformOrigin = '';
    c.el.style.pointerEvents = '';
  }

  function dragEnd() {
    var d = st.drag;
    dragUnbind();
    st.drag = null;
    if (!d) return;
    clearTimeout(d.timer);
    var c = d.c;
    if (!c || !c.el) return;
    var wasActive = d.active, moved = d.moved;
    c.el.classList.remove('is-dragging');
    c.el.style.pointerEvents = '';
    if (wasActive) c.skipClickAt = nowMs() + 500;

    if (wasActive && moved) {
      c.el.style.transition = 'transform ' + SETTLE_MS + 'ms var(--ease)';
      c.el.style.transform = 'none';
      saveOrderFromDom();
      setTimeout(function () {
        c.el.style.transition = '';
        c.el.style.transform = '';
        c.el.style.transformOrigin = '';
      }, SETTLE_MS + 30);
    } else {
      c.el.style.transition = '';
      c.el.style.transform = '';
      c.el.style.transformOrigin = '';
      /* 长按没移动就松手：不改任何状态（不进焦点、不开声）。
         松手后 WebView 还会补一次 click，靠上面 skipClickAt 吃掉，
         否则会和「单击开声」打架。 */
    }
  }

  /* ---------- 界面状态 ---------- */
  function syncUI() {
    var n = Object.keys(st.cells).length;
    var loading = st.discovering && n === 0;
    if (el.grid) {
      el.grid.hidden = n === 0;
      for (var k = 1; k <= MAX; k++) el.grid.classList.toggle('mon-count-' + k, n === k);
      el.grid.classList.toggle('is-fit-contain', st.fit === 'contain');
    }
    if (el.skel) el.skel.hidden = !loading;
    if (el.empty) el.empty.hidden = !(n === 0 && st.loadedOnce && !st.discovering);

    if (el.sub) {
      var curSt = (typeof RR.station === 'function') ? RR.station() : null;
      var stName = curSt ? (curSt.name || curSt.mid || '') : '';
      var pre = stName ? (stName + ' · ') : '';
      if (n) el.sub.textContent = pre + n + ' 路在监控 · 默认静音';
      else if (st.discovering) el.sub.textContent = '正在找正在直播的房间…';
      else if (st.loadedOnce) el.sub.textContent = '关注里这会儿没人开播 · 可以手动加一路';
      else el.sub.textContent = '自动从关注里补台 · 默认静音';
    }
    if (el.note) el.note.hidden = !st.autoErr;
    if (el.noteT && st.autoErr) el.noteT.textContent = st.autoErr;
  }

  /* ---------- 生命周期 ---------- */
  function mount() {
    if (st.mounted) return;
    if (!RR.$('#view-monitor')) return;
    st.mounted = true;

    el.view = RR.$('#view-monitor');
    el.grid = RR.$('#mon-grid');
    el.skel = RR.$('#mon-skel');
    el.empty = RR.$('#mon-empty');
    el.add = RR.$('#mon-add');
    el.add2 = RR.$('#mon-add2');
    el.seg = RR.$('#mon-seg');
    el.refresh = RR.$('#mon-refresh');
    el.note = RR.$('#mon-note');
    el.noteT = RR.$('#mon-note-t');
    el.noteRetry = RR.$('#mon-note-retry');
    el.sub = RR.$('#mon-sub');
    el.wall = RR.$('#mon-wall');
    el.wallBar = RR.$('#mon-wallbar');
    el.wallExit = RR.$('#mon-wall-exit');
    el.wallAuto = RR.$('#mon-auto');
    el.wallAdd = RR.$('#mon-wall-add');
    el.fit = RR.$('#mon-fit');
    el.fit2 = RR.$('#mon-fit2');
    el.focusBar = RR.$('#mon-focus-bar');
    el.focusName = RR.$('#mon-focus-name');
    el.focusTitle = RR.$('#mon-focus-title');
    el.focusOnline = RR.$('#mon-focus-online');
    el.sound = RR.$('#mon-focus-sound');
    el.close = RR.$('#mon-focus-close');

    if (!el.grid) return;
    st.manual = readManual();
    st.dismissed = readSkip();
    st.order = readOrder();
    st.layout = RR.store.get('mon_layout', 'auto');
    applyLayout(st.layout);
    st.fit = RR.store.get('mon_fit', 'cover');
    applyFit(st.fit, false);

    if (window.matchMedia) {
      try { mq = window.matchMedia('(orientation: landscape)'); } catch (e) { mq = null; }
    }
    if (mq) {
      if (mq.addEventListener) mq.addEventListener('change', onOrient);
      else if (mq.addListener) mq.addListener(onOrient);
    }

    if (RR.on) {
      RR.on('station', onStation);
      RR.on('station-changed', onStation);
    }

    if (el.add) el.add.addEventListener('click', openAdd);
    if (el.add2) el.add2.addEventListener('click', openAdd);
    if (el.refresh) el.refresh.addEventListener('click', function () { discover(true); });
    if (el.noteRetry) el.noteRetry.addEventListener('click', function () { discover(true); });
    if (el.wall) el.wall.addEventListener('click', function () { if (st.wall) exitWall(); else enterWall(); });
    if (el.wallExit) el.wallExit.addEventListener('click', exitWall);
    if (el.wallAuto) el.wallAuto.addEventListener('click', autoArrange);
    if (el.wallAdd) el.wallAdd.addEventListener('click', openAdd);
    if (el.fit) el.fit.addEventListener('click', toggleFit);
    if (el.fit2) el.fit2.addEventListener('click', toggleFit);
    if (el.close) el.close.addEventListener('click', function () { closeFocus(false); });
    if (el.sound) {
      el.sound.addEventListener('click', function () {
        setSound(!(st.focus && st.focus.wantSound));
      });
    }

    RR.$$('button', el.seg).forEach(function (b) {
      b.addEventListener('click', function () { applyLayout(b.dataset.lay, true); });
    });

    if (el.view) {
      el.view.addEventListener('pointerdown', function (e) {
        if (!st.wall) return;
        if (el.wallBar && el.wallBar.classList.contains('is-away')) {
          wallWakeAt = nowMs();
          wakeWallbar();
        }
        if (e && e.target && el.focusBar && el.focusBar.contains(e.target)) wallWakeAt = 0;
      }, { passive: true });
      el.view.addEventListener('click', function (e) {
        if (!st.wall) return;
        if (wallWakeAt && (nowMs() - wallWakeAt) < 700) {
          wallWakeAt = 0;
          var inBar = !!(el.focusBar && el.focusBar.contains(e.target)) ||
            !!(el.wallBar && el.wallBar.contains(e.target));
          /* 焦点态下点瓦片是切换/退出焦点，不该被“点亮顶栏”吃掉 */
          if (!inBar && !st.focus) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
        }
        wallWakeAt = 0;
        wakeWallbar();
      }, true);
    }
    if (el.grid) {
      el.grid.addEventListener('click', function (e) {
        if (e.target === el.grid && st.focus) closeFocus(false);
      });
    }
    if (el.view) {
      /* 焦点态点空白（页面背景 / 大格黑边外的留白）也退出 */
      el.view.addEventListener('click', function (e) {
        if (!st.focus) return;
        var t = e.target;
        if (!t || !t.closest) return;
        if (t.closest('.mon-cell')) return;
        if (el.focusBar && el.focusBar.contains(t)) return;
        if (el.wallBar && el.wallBar.contains(t)) return;
        closeFocus(false);
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && st.focus) closeFocus(false);
    });

    setSoundIcon(false);
    syncUI();
  }

  function enter() {
    if (!st.mounted) mount();
    if (!el.grid) return;
    if (st.alive) { syncWallForRoute(); return; }
    st.alive = true;

    /* 8.0：进入监控页不再抢原生回放音频；只有用户开声时才 RR.player.stop() */
    Object.keys(st.cells).forEach(function (room) {
      var c = st.cells[room];
      if (!c.player) { c.fails = 0; attach(c, false); }
    });

    discover(false);
    reconcile();
    startWatchdog();
    startRefresher();
    syncUI();
    syncWallForRoute();
  }

  function leave() {
    st.alive = false;
    dragCancel();
    clearTimeout(tap.timer);
    tap = { c: null, at: 0, x: 0, y: 0, timer: 0 };
    closeFocus(true);
    stopWatchdog();
    stopRefresher();
    if (st.wall) {
      setWall(false);
      setOrient('auto');
    }
    st.wallManual = null;
    clearTimeout(st.wallTimer);
    st.wallTimer = 0;

    Object.keys(st.cells).forEach(function (room) {
      var c = st.cells[room];
      c.token++;
      clearTimeout(c.restartTimer);
      clearTimeout(c.silentTimer);
      clearTimeout(c.qnTimer);
      c.restartTimer = 0;
      c.silentTimer = 0;
      c.qnTimer = 0;
      muteCell(c);                      /* 离开页面一律静音，别把声音留在后台 */
      destroyPlayer(c, false);
      setState(c, 'paused', nameOf(c) + ' · 已停止', '房间 ' + c.room + ' · 回监控页会接着拉流');
    });
    syncFocusSound();
    syncUI();
  }

  /* ---------- 对外 ---------- */
  var mod = {
    mount: mount,
    enter: enter,
    leave: leave,
    rooms: function () {
      return desiredRooms().map(function (d) { return d.room; });
    },
    debug: function () {
      return {
        wall: st.wall,
        layout: st.layout,
        fit: st.fit,
        order: st.order.slice(),
        focus: st.focus ? st.focus.room : '',
        cells: Object.keys(st.cells).map(function (room) {
          var c = st.cells[room];
          return {
            room: room,
            state: c.state,
            player: !!c.player,
            attempts: c.fails,
            muted: !!(c.video && c.video.muted),
            wantSound: !!c.wantSound,
            direct: !!c.viaDirect,
            qn: c.qn,
            streamQn: c.streamQn,
            t: +((c.video && c.video.currentTime) || 0).toFixed(2),
            focus: st.focus === c
          };
        })
      };
    },
    remove: function (room) { removeRoom(room); },
    layout: function (lay) { applyLayout(lay, false); },
    fit: function (v) { applyFit(v); },
    sound: function (room) {
      var c = st.cells[room];
      if (c) toggleCellSound(c);
      return c ? !!c.wantSound : false;
    },
    wall: function (on) { if (on) enterWall(); else exitWall(); },
    arrange: autoArrange
  };

  if (RR.view) RR.view('monitor', mod);
  RR.monitor = mod;
})();
