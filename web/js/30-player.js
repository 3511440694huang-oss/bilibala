/* ============================================================
   30-player.js · 播放内核（RR.player）+ 节目带数据（RR.replay）· 7.1
   硬契约：
   - 画面在 WebView、声音在原生；切源必须 video.src='/api/stream?u='+b64url(绝对URL)
   - 先写 #np-title，再 dataset.key / dataset.cover，最后 play()
   - **位置唯一事实是 video.currentTime**。原生 getPosition() 只有在
     「被证明在前进」时才可当参照，且只用于极端漂移的限流纠偏
     （见 §八 syncNative：7.1 修的 P0「几秒内循环」就出在这条上）
   - 流过期重试 ≤2；页面挂起/跟随原生状态时用 window.__rrKeepNative 包住 pause/play
   - 退出全屏先调 window.__rrExitFs()
   ============================================================ */
(function () {
  'use strict';
  var RR = window.RR;
  if (!RR) { return; }

  var noop = function () { };
  var CHUNK = 18;              /* 节目带每批渲染条数，避免一次塞上百个节点 */
  var MEDIA_TTL = 240000;      /* 取流地址缓存 4 分钟（会过期） */
  var MAX_RETRY = 2;
  var TOGGLE_WIN = 260;        /* 连点合流窗口：窗口内只留最后一次播放/暂停意图 */
  var HOLD_MS = 1600;          /* 刚起播/刚暂停/刚 seek 后不纠正原生状态的保持窗口 */
  /* ---- 7.1 原生同步参数（P0 修复的核心） ---- */
  var VT = 150;                /* 一次采样推进 ≥150ms 才算「原生在走」 */
  var VTR = .15;               /* 且推进速率不低于实时的 15%（防抖、防一次假跳） */
  var HARD_DRIFT = 3.0;        /* 原生读数**领先**画面 3s 以上：画面落后了，可往前纠 */
  var HARD_BACK = 8.0;         /* 原生读数**落后**画面 8s 以上才允许往回纠（回退就是那个「循环」） */
  var FIX_MIN = 8000;          /* 硬纠偏限流：两次之间至少 8s */
  var STALL_RESTART = 8000;    /* 原生连续卡死 8s 才重启一次 */
  var UI_AWAY = 3500;          /* 覆盖层 3.5s 自动淡出 */
  var LONG_MS = 420;           /* 长按临时 2× */
  var TAP_WIN = 280;           /* 双击窗口 */
  var FPS = 30;                /* frameStep 的单帧步长 */

  /* ============================================================
     一、RR.replay · 节目带数据（day / monitor 也会用）
     ============================================================ */
  var RP = { at: 0, ttl: 60000, items: [], eps: [], meta: {}, sid: '', pend: null };

  function stationId() {
    var s = RR.station ? RR.station() : null;
    return String((s && (s.id || s.mid)) || (RR.store ? RR.store.get('station_id', '') : '') || '');
  }

  function flatten(eps) {
    var out = [];
    (eps || []).forEach(function (p, pi) {
      var parts = (p && p.parts && p.parts.length) ? p.parts
        : [{ cid: p.cid || '', page: 1, part: '全场', duration: p.duration || 0, dm_total: p.dm_total || 0 }];
      var multi = parts.length > 1;
      var acc = 0;
      parts.forEach(function (pt, k) {
        var dur = +pt.duration || 0;
        var base = p.title || p.raw_title || '未命名的一期';
        out.push({
          /* 后端原字段，不重命名 */
          bvid: p.bvid || '', cid: String(pt.cid || ''), cover: p.cover || p.thumb || '',
          category: p.category || '', date: p.date || '', pubdate: +p.pubdate || 0,
          duration: dur, aid: p.aid, view: p.view, dm_total: +pt.dm_total || 0, url: p.url || '',
          page: pt.page || k + 1, part: pt.part || '全场',
          progTitle: base, progIndex: pi, partsTotal: parts.length, partIndex: k,
          /* 播放器友好字段（lead 约定） */
          title: multi ? (base + ' · ' + (pt.part || ('第 ' + (k + 1) + ' 段'))) : base,
          dur: dur, kind: p.category || '', start: acc,
          episodeDur: +p.duration || dur
        });
        acc += dur;
      });
    });
    return out;
  }

  function fetchPrograms(force) {
    var now = Date.now(), sid = stationId();
    if (!force && RP.items.length && RP.sid === sid && now - RP.at < RP.ttl) {
      return Promise.resolve(RP.items);
    }
    if (RP.pend && !force) { return RP.pend; }
    var url = '/api/programs' + (sid ? '?station=' + encodeURIComponent(sid) : '');
    var p = RR.api(url).then(function (d) {
      RP.eps = (d && d.programs) || [];
      RP.meta = (d && d.meta) || {};
      RP.items = flatten(RP.eps);
      RP.at = Date.now(); RP.sid = sid; RP.pend = null;
      var payload = { items: RP.items, programs: RP.eps, meta: RP.meta, station: RR.station ? RR.station() : null };
      RR.emit('programs', payload);
      RR.emit('rr:programs', payload);
      return RP.items;
    });
    RP.pend = p.then(function (x) { return x; }, function (e) { RP.pend = null; throw e; });
    return RP.pend;
  }

  RR.replay = {
    stations: function () { return RR.stations ? RR.stations() : []; },
    programs: function (force) { return fetchPrograms(!!force); },
    episodes: function () { return RP.eps; },
    meta: function () { return RP.meta; },
    refresh: function () {
      RP.at = 0; RP.items = []; RP.eps = []; RP.pend = null;
      return fetchPrograms(true);
    }
  };
  RR.on('station', function () { RP.at = 0; RP.items = []; RP.eps = []; RP.sid = ''; });

  /* ============================================================
     二、播放器状态
     ============================================================ */
  var P = {
    mounted: false, item: null, queue: [], qi: 0,
    playing: false, loading: false, error: false, stopped: true,
    token: 0, retries: 0, dur: 0, rate: 1, boost: false,
    fs: false, hidden: false, holdUntil: 0, wantPos: 0,
    sleepAt: 0, sleepMin: 0, last: null, savedAt: 0, startingUntil: 0,
    media: {}, retryTimer: 0, hintTimer: 0, fsTimer: 0, tickTimer: 0,
    lastPaint: -1, lastState: '', stageKey: '', expanded: false,
    /* 连点合流：applied=已落到 video/桥接上的状态；pendWant=窗口内最后一次意图 */
    togglePending: false, pendWant: null, toggleTimer: 0, lastCommit: 0,
    applied: false, emitKey: '',
    /* ---- 7.1 新增 ---- */
    locked: false, uiAway: false, uiTimer: 0, lockTimer: 0,
    dragging: false, stalled: false, previewBound: false,
    qn: 0, mediaUrl: '', holdTimer: 0, tapTimer: 0, lastTapAt: 0,
    /* ---- 8.0：清晰度按接口实测档位；qnActual=这一期真实在放的档 ---- */
    accept: [], qnActual: 0
  };

  /* 原生链路的健康度账本：只用来判断「原生位置可不可信」，不参与进度 */
  var N = {
    pos: -1,        /* 上一次原生位置（ms），-1 = 没有基线 */
    at: 0,          /* 上一次采样时刻 */
    adv: 0,         /* 这次推进了多少 ms */
    advN: 0,        /* 连续「在走」的采样次数 */
    stallFrom: 0,   /* 卡死起点；0 = 没卡 */
    restarts: 0,    /* 本轮卡死里重启过几次（上限 1） */
    fixAt: 0,       /* 上次硬纠偏时刻 */
    pwrMiss: 0,     /* 播放态对不上的连续次数 */
    lastRestart: 0
  };

  var root = null;
  var E = {};
  var D = { eps: [], seq: [], loaded: false, loading: false, error: null, filter: 'all', shown: 0, lastDate: '', pend: null, sid: '' };
  var emptyFn = null;

  /* ---------- 小工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function note(text, kind) { if (RR.toast) { RR.toast(text, kind); } }
  function fmtRate(r) { return (Math.round((+r || 1) * 100) / 100).toString() + '×'; }
  function hasNative() { return !!window.AndroidRadio; }

  function absolute(u) {
    if (/^https?:/i.test(u)) { return u; }
    var a = document.createElement('a');
    a.href = u;
    return a.href;
  }
  function coverOf(u) {
    if (u && /^(https?:|data:)/i.test(u)) { return u; }
    if (u) { try { return absolute(u); } catch (e) { } }
    return location.origin + '/assets/idle.webp';
  }
  function b64url(str) {
    var i, bin = '';
    if (window.TextEncoder) {
      var bytes = new TextEncoder().encode(str);
      for (i = 0; i < bytes.length; i++) { bin += String.fromCharCode(bytes[i]); }
    } else {
      bin = unescape(encodeURIComponent(str));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function keepNative(fn) {
    var prev = !!window.__rrKeepNative;
    window.__rrKeepNative = true;
    try { fn(); } catch (e) { }
    window.__rrKeepNative = prev;
  }
  function position() {
    var v = E.video;
    var t = v ? +v.currentTime : 0;
    return (isFinite(t) && t > 0) ? t : 0;
  }
  function indexOfKey(list, key) {
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if ((String(x.bvid || '') + '|' + String(x.cid == null ? '' : x.cid)) === key) { return i; }
    }
    return -1;
  }

  /* 采样基线作废：换源 / seek / 停播之后，旧位置不能再拿来算「推进」 */
  function nativesReset() {
    N.pos = -1; N.at = 0; N.adv = 0; N.advN = 0;
    N.stallFrom = 0; N.restarts = 0; N.pwrMiss = 0;
  }

  /* ---------- 数据结构 ---------- */
  function normalize(x) {
    if (!x) { return null; }
    if (x && x.__norm) { return x; }
    var bvid = x.bvid || '';
    var cid = x.cid == null ? '' : String(x.cid);
    if (!bvid && !cid) { return null; }
    var partsTotal = +x.partsTotal || 1;
    var part = x.part || '全场';
    var base = x.progTitle || x.title || x.raw_title || '未命名的一期';
    var display = base;
    if (partsTotal > 1 && part && part !== '全场' && String(base).indexOf(part) < 0) {
      display = base + ' · ' + part;
    }
    return {
      __norm: true, bvid: bvid, cid: cid, key: bvid + '|' + cid,
      title: display, rawTitle: base, part: part, page: +x.page || 1, partsTotal: partsTotal,
      dur: +x.dur || +x.duration || 0, duration: +x.duration || +x.dur || 0,
      cover: x.cover || '', category: x.category || x.kind || '', dm_total: +x.dm_total || 0,
      pubdate: +x.pubdate || 0, author: x.author || (RP.meta && RP.meta.up_name) || '', start: +x.start || 0
    };
  }

  function partsOf(prog) {
    var parts = (prog.parts && prog.parts.length) ? prog.parts
      : [{ cid: prog.cid || '', page: 1, part: '全场', duration: prog.duration || 0, dm_total: prog.dm_total || 0 }];
    var out = [];
    parts.forEach(function (pt, k) {
      out.push(normalize({
        bvid: prog.bvid, cid: pt.cid, title: prog.title, progTitle: prog.title,
        cover: prog.cover, category: prog.category, pubdate: prog.pubdate,
        part: pt.part, page: pt.page || k + 1, partsTotal: parts.length,
        duration: pt.duration, dur: pt.duration, dm_total: pt.dm_total, start: 0
      }));
    });
    return out.filter(Boolean);
  }

  function setQueue(list, idx) {
    var q = [];
    (list || []).forEach(function (x) {
      var n = normalize(x);
      if (n) { q.push(n); }
    });
    P.queue = q;
    P.qi = Math.max(0, Math.min(idx || 0, Math.max(0, q.length - 1)));
    return q.length;
  }

  /* ============================================================
     三、取流地址
     ============================================================ */
  function resolveMedia(it, force) {
    var qn = wantQn();
    var k = it.bvid + '|' + it.cid + '|' + qn;
    var c = P.media[k];
    if (!force && c && Date.now() - c.at < MEDIA_TTL) { return Promise.resolve(c.url); }
    var url = '/api/playurl?bvid=' + encodeURIComponent(it.bvid) + '&cid=' + encodeURIComponent(it.cid) + '&qn=' + qn;
    return RR.api(url).then(function (d) {
      var u = d && (d.media || d.url || d.playurl);
      if (u && typeof u === 'object') { u = u.url || u.media || ''; }
      if (!u) { throw new Error((d && d.error) || '这一期没有可用的流'); }
      u = absolute(u);
      P.media[k] = { url: u, at: Date.now() };
      cacheAccept(d);                       /* 这一期真实可用的档位，只认接口回的 accept */
      return u;
    });
  }

  /* ============================================================
     四、视图状态与文案
     ============================================================ */
  function setTitle(it) {
    if (!E.title) { return; }
    E.title.textContent = it ? it.title : '还没有在放';
  }

  function paintMeta(it) {
    if (!E.meta) { return; }
    if (!it) {
      E.meta.textContent = '';
      E.meta.hidden = true;
      return;
    }
    var bits = [];
    if (it.author) { bits.push(it.author); }
    if (it.partsTotal > 1) { bits.push('第 ' + it.page + ' / ' + it.partsTotal + ' 段'); }
    else if (it.part && it.part !== '全场') { bits.push(it.part); }
    if (it.category) { bits.push(it.category); }
    if (it.dur) { bits.push('时长 ' + RR.fmtTime(it.dur)); }
    if (it.dm_total) { bits.push(RR.fmtCount(it.dm_total) + ' 弹幕'); }
    E.meta.textContent = bits.join(' · ') || '点开就听';
    E.meta.hidden = false;
  }

  function paintState() {
    if (!E.state) { return; }
    var txt;
    if (P.error) { txt = '画面没取到'; }
    else if (P.loading) { txt = '正在取流'; }
    else if (P.playing) { txt = '正在播放'; }
    else if (P.item) { txt = '已暂停'; }
    else { txt = '未播放'; }
    if (txt !== P.lastState) {
      P.lastState = txt;
      E.state.textContent = txt;
    }
    if (E.stage) {
      var sk = P.item ? (P.playing ? 'play' : 'pause') : 'idle';
      if (sk !== P.stageKey) {
        P.stageKey = sk;
        E.stage.classList.toggle('is-playing', sk === 'play');
        E.stage.classList.toggle('is-idle', sk === 'idle');
      }
      /* 8.1：空舞台 → 有节目 才展开信息区（CSS 管 320ms 过渡）。
         只在 true/false 翻转时写 class：暂停/恢复、切清晰度/倍速时 item 一直在，
         class 一直为 true → 展开动画不重播、布局不抖。 */
      var expanded = !!P.item;
      if (expanded !== P.expanded) {
        P.expanded = expanded;
        E.stage.classList.toggle('is-expanded', expanded);
      }
      /* 8.0：空闲态只放我们自己的主题底图，B 站默认封面（灰底黑圈三角）不许露头 */
      if (sk === 'idle' || P.error) { idleArtOn(); } else { idleArtOff(); }
    }
    paintToggle();
  }

  /* 播放/暂停图标：两个 SVG 已经叠在按钮里，这里只翻属性，让 CSS 做交叉过渡。
     不换 innerHTML、不动布局；状态没变一个字节都不写。 */
  function paintToggle() {
    var b = E.toggle;
    if (!b) { return; }
    var st = P.playing ? 'playing' : 'paused';
    if (b.getAttribute('data-state') === st) { return; }
    /* 减少动效：直接切（html.reduce-motion 由 05-motion 按设置/系统偏好维护） */
    if (document.documentElement.classList.contains('reduce-motion')) {
      b.classList.add('is-noanim');
    } else if (b.classList.contains('is-noanim')) {
      b.classList.remove('is-noanim');
    }
    b.setAttribute('data-state', st);
    b.setAttribute('aria-label', st === 'playing' ? '暂停' : '播放');
  }

  /* 图标槽：play / pause 两个内联 SVG 叠放（RR.ICO 出品），只建一次 */
  function buildToggle() {
    var b = E.toggle;
    if (!b) { return; }
    b.innerHTML =
      '<span class="ch-ico ch-ico--pause" aria-hidden="true">' + RR.ICO('pause') + '</span>' +
      '<span class="ch-ico ch-ico--play" aria-hidden="true">' + RR.ICO('play') + '</span>';
    b.removeAttribute('data-ico');            /* 不再交给 RR.iconize，避免整块 innerHTML 重写 */
    b.setAttribute('data-state', P.playing ? 'playing' : 'paused');
    b.setAttribute('aria-label', P.playing ? '暂停' : '播放');
  }

  function paintTime() {
    var v = E.video;
    if (!v || !E.elapsed) { return; }
    if (P.dragging) { return; }        /* 拖动中：进度条只跟手指，这里一根像素都不许写 */
    var cur = +v.currentTime || 0;
    if (cur < 0) { cur = 0; }
    var dur = P.dur || 0;
    var sec = Math.floor(cur);
    if (sec !== P.lastPaint) {
      P.lastPaint = sec;
      E.elapsed.textContent = RR.fmtTime(cur);
      if (E.dur) { E.dur.textContent = dur > 0 ? RR.fmtTime(dur) : '--:--'; }
    }
    var pct = dur > 0 ? Math.min(100, cur / dur * 100) : 0;
    var ps = pct.toFixed(2) + '%';
    /* 只写变化的像素/属性：同步循环 700ms 一跑，值没变就别碰 DOM */
    if (E.fill && E.fill.style.width !== ps) { E.fill.style.width = ps; }
    if (E.knob && E.knob.style.left !== ps) { E.knob.style.left = ps; }
    if (E.track) {
      var vmax = String(Math.round(dur)), vnow = String(Math.round(cur));
      var vtxt = RR.fmtTime(cur) + ' / ' + (dur > 0 ? RR.fmtTime(dur) : '--:--');
      if (E.track.getAttribute('aria-valuemax') !== vmax) { E.track.setAttribute('aria-valuemax', vmax); }
      if (E.track.getAttribute('aria-valuenow') !== vnow) { E.track.setAttribute('aria-valuenow', vnow); }
      if (E.track.getAttribute('aria-valuetext') !== vtxt) { E.track.setAttribute('aria-valuetext', vtxt); }
    }
    var buf = 0;
    try { if (v.buffered && v.buffered.length) { buf = v.buffered.end(v.buffered.length - 1); } } catch (e) { }
    if (E.buf) {
      var bs = dur > 0 ? Math.min(100, buf / dur * 100).toFixed(2) + '%' : '0%';
      if (E.buf.style.width !== bs) { E.buf.style.width = bs; }
    }
  }

  function showLoading(on) {
    if (!E.loading) { return; }
    E.loading.hidden = !on;
    if (E.stage) { E.stage.setAttribute('aria-busy', on ? 'true' : 'false'); }
  }

  /* ---------- 8.0 · 空闲底图 ----------
     没在放的时候舞台只显示我们自己的主题图；节目封面只在「真在放」时出现。 */
  var IDLE_ART = '/assets/idle.webp';

  function idleArtOn() {
    if (!E.poster || !E.stage) { return; }
    if (E.stage.classList.contains('is-idle-art') && E.poster.getAttribute('src') === IDLE_ART) { return; }
    E.stage.classList.add('is-idle-art');
    E.poster.setAttribute('src', IDLE_ART);
    E.poster.hidden = false;
  }

  function idleArtOff() {
    if (E.stage && E.stage.classList.contains('is-idle-art')) { E.stage.classList.remove('is-idle-art'); }
  }

  function showIdleError(it, err) {
    if (!E.idleLine) { return; }
    if (E.stage) { E.stage.classList.add('is-idle'); }
    /* 失败态也不许把 B 站默认封面留在画面上：交还给空闲底图 */
    if (E.poster) {
      E.poster.hidden = false;
      E.poster.setAttribute('src', IDLE_ART);
    }
    if (E.stage) { E.stage.classList.add('is-idle-art'); }
    E.idleLine.textContent = '这一期没加载出来';
    if (E.idlePlayTxt) { E.idlePlayTxt.textContent = '重试画面'; }
    if (E.idlePlayIco) { E.idlePlayIco.innerHTML = RR.ICO('refresh'); }
  }

  function defaultIdleCopy() {
    if (!E.idleLine) { return; }
    E.idleLine.textContent = '把每场直播回放排成电台';
    if (E.idlePlayTxt) { E.idlePlayTxt.textContent = '开始收听'; }
    if (E.idlePlayIco) { E.idlePlayIco.innerHTML = RR.ICO('play'); }
  }

  function renderResume() {
    if (!E.idleLine) { return; }
    var last = lastItem();          /* 别把上一位主播的进度挂到这一位身上 */
    if (!last) {
      if (!P.item) { defaultIdleCopy(); }
      return;
    }
    /* 只留一个 44 高的胶囊：有上次进度时，这个按钮就是「继续上次」 */
    E.idleLine.textContent = '把每场直播回放排成电台';
    if (E.idlePlayTxt) {
      E.idlePlayTxt.textContent = '继续上次 · ' + RR.fmtTime(last.at || 0);
    }
  }

  function remember(it, pos) {
    if (!it || !RR.store) { return; }
    P.last = {
      bvid: it.bvid, cid: it.cid, title: it.rawTitle || it.title, part: it.part, page: it.page,
      partsTotal: it.partsTotal, dur: it.dur, dm_total: it.dm_total, cover: it.cover,
      category: it.category, pubdate: it.pubdate, at: Math.max(0, +pos || 0),
      station: stationId(), ts: Date.now()
    };
    RR.store.set('last', P.last);
  }

  function emitPlaying(on) {
    RR.emit('playing', { item: P.item, playing: !!on, position: position(), duration: P.dur });
  }

  /* ============================================================
     五、播放
     ============================================================ */
  function resolveItem(item) {
    if (item == null) { return null; }
    if (typeof item === 'number') {
      var q = P.queue[item];
      return q ? normalize(q) : null;
    }
    if (item.parts && item.parts.length) {
      var parts = partsOf(item);
      if (!parts.length) { return null; }
      setQueue(parts, 0);
      return P.queue[0];
    }
    var it = normalize(item);
    if (!it) { return null; }
    var idx = indexOfKey(P.queue, it.key);
    if (idx >= 0) { P.qi = idx; return P.queue[idx]; }
    var band = RP.items || [];
    var j = indexOfKey(band, it.key);
    if (j >= 0) {
      setQueue(band, j);
      return P.queue[j];
    }
    setQueue([it], 0);
    return P.queue[0];
  }

  function play(item, startSec, isRetry) {
    var it = resolveItem(item);
    if (!it) { return Promise.resolve(false); }
    if (!isRetry) { P.retries = 0; }
    cancelToggle();                       /* 切源优先：挂起的连点意图作废 */
    var tok = ++P.token;
    var start = Math.max(0, Number(startSec) || 0);
    var v = E.video;
    if (!v) { return Promise.resolve(false); }
    if (P.boost) { boostOff(); }
    P.item = it;
    P.error = false;
    P.loading = true;
    P.playing = true;
    P.stopped = false;
    P.startingUntil = Date.now() + 800;
    P.wantPos = start;
    P.lastPaint = -1;
    P.holdUntil = Date.now() + HOLD_MS;
    nativesReset();                       /* 新的一条流：旧位置基线作废 */
    setTitle(it);          /* 桥接读 #np-title，必须在 play() 之前 */
    paintMeta(it);
    paintState();
    showLoading(true);
    if (E.stage) { E.stage.classList.remove('is-idle'); }
    remember(it, start);
    markCurrent();
    if (RR.danmaku) { RR.danmaku.attach({ cid: it.cid, duration: it.dur || 0, title: it.title }); }

    return resolveMedia(it, !!isRetry).then(function (url) {
      if (tok !== P.token) { return false; }
      v.dataset.key = it.bvid + '|' + it.cid;
      v.dataset.cover = coverOf(it.cover);
      /* 8.0：video 不再自带 poster —— B 站没封面时会给一张「灰底黑圈三角」，
         那一层全不透明，会把我们的空闲底图整个盖住。画面底图只留 #ch-poster。 */
      if (E.poster) {
        if (it.cover) { E.poster.setAttribute('src', coverOf(it.cover)); E.poster.hidden = false; }
        else { E.poster.hidden = true; E.poster.removeAttribute('src'); }
      }
      v.muted = true;                       /* 声音归原生；网页永远不出声 */
      var nextSrc = '/api/stream?u=' + b64url(url);
      if (v.getAttribute('src') === nextSrc) {
        try { v.load(); } catch (e) { }     /* 同一地址（比如换档后 URL 不变）：强制重开一次 */
      } else {
        v.src = nextSrc;
      }
      P.mediaUrl = url;                     /* 原生重启时原样交回去 */
      P.dur = it.dur || 0;
      if (E.dur) { E.dur.textContent = P.dur ? RR.fmtTime(P.dur) : '--:--'; }
      try { v.currentTime = start; } catch (e) { }
      applyRateToNative(P.rate);
      P.playing = true;
      P.applied = true;
      var pr;
      try { pr = v.play(); } catch (e) { pr = null; }
      if (pr && pr.catch) {
        pr.catch(function (err) {
          if (tok !== P.token) { return; }
          var msg = String((err && (err.name || err.message)) || '');
          if (/interrupt/i.test(msg)) { return; }
          P.loading = false; P.playing = false;
          showLoading(false); paintState();
          note('声音没起来，点播放再试一次', 'err');
        });
      }
      return true;
    }).catch(function (err) {
      if (tok !== P.token) { return false; }
      P.loading = false; P.playing = false; P.error = true;
      showLoading(false);
      showIdleError(it, err);
      paintState();
      note((err && err.message) || '这一期暂时取不到流', 'err');
      return false;
    });
  }

  function playItemAt(item, sec) { return play(item, sec); }

  /* ---------- 播放/暂停：合流 + 落地 ---------- */
  function cancelToggle() {
    if (P.toggleTimer) { clearTimeout(P.toggleTimer); P.toggleTimer = 0; }
    P.togglePending = false;
    P.pendWant = null;
  }

  /* 状态没变就不发事件：连点/同步循环都不会把别的视图一起拖着重绘 */
  function emitOnce(on) {
    var k = (on ? '1' : '0') + '|' + (P.item ? P.item.key : '');
    if (P.emitKey === k) { return; }
    P.emitKey = k;
    emitPlaying(on);
  }

  /* 「继续上次」只在同一主播内有效 */
  function lastItem() {
    var l = P.last;
    if (!l || !l.bvid) { return null; }
    var sid = stationId();
    if (l.station && sid && String(l.station) !== sid) { return null; }
    return l;
  }

  /* 真正落地：暂停一次（video + 桥接各一次） */
  function commitPause() {
    P.playing = false;
    P.applied = false;
    P.holdUntil = Date.now() + HOLD_MS;
    if (P.boost) { boostOff(); }
    var v = E.video;
    if (v) { try { v.pause(); } catch (e) { } }   /* 人按的暂停：桥接会顺带停原生 */
    if (RR.danmaku) { RR.danmaku.pause(); }
    paintState(); paintTime();
    emitOnce(false);
    remember(P.item, position());
  }

  /* 真正落地：恢复一次（video + 桥接各一次） */
  function commitResume() {
    if (!P.item) { return; }
    if (P.error) { play(P.item, position(), true); return; }
    var v = E.video;
    if (!v || !v.getAttribute('src')) { play(P.item, position()); return; }
    P.stopped = false;
    P.error = false;
    P.playing = true;
    P.applied = true;
    P.holdUntil = Date.now() + HOLD_MS;
    var pr;
    try { pr = v.play(); } catch (e) { pr = null; }   /* 人按的播放：桥接重新拉起原生 */
    if (pr && pr.catch) {
      pr.catch(function (err) {
        var msg = String((err && (err.name || err.message)) || '');
        if (/interrupt/i.test(msg)) { return; }
        P.playing = false; paintState();
        note('播放没起来，检查一下网络', 'err');
      });
    }
    if (RR.danmaku) { RR.danmaku.resume(); }
    paintState();
    emitOnce(true);
  }

  function pause() {
    cancelToggle();                 /* 外部直接命令：挂起的连点意图作废 */
    commitPause();
  }

  function resume() {
    cancelToggle();
    if (!P.item) { return toggle(); }
    commitResume();
  }

  /* 把某个意图真正落到 video/桥接上一次（landToggle 记账：多久之前刚落地过） */
  function landToggle(want) {
    P.lastCommit = Date.now();
    if (!P.item) { return; }
    if (want === P.applied) { P.playing = want; paintState(); return; }   /* 状态没变：不重复调 */
    if (want) { commitResume(); } else { commitPause(); }
  }

  /* 连点合流（leading + trailing）：
     - 距上次真正落地 >= 260ms：首击**立即落地**（单击 0 延迟），同时开窗收集后续连点；
     - 窗口内的连点只改「最终意图」，图标/文案照样立刻翻；
     - 窗口随每次点击续期，静止 260ms 后收尾：终态和已落地状态不同才补落地一次。
     于是一次单击 = 1 次原生调用；任意长连点 = 最多 2 次（首击 + 收尾）。 */
  function toggle() {
    if (!P.item) {
      var last = lastItem();
      if (last) { play(last, last.at || 0); return; }
      if (D.seq && D.seq.length) { setQueue(D.seq, 0); play(D.seq[0], 0); return; }
      if (!D.loaded && !D.loading) {
        loadPrograms(false).then(function () {
          if (P.item) { return; }
          if (D.seq && D.seq.length) { setQueue(D.seq, 0); play(D.seq[0], 0); }
        });
        note('正在取节目带');
        return;
      }
      note('节目带还在路上，稍等一下');
      return;
    }
    var now = Date.now();
    var want = P.togglePending ? !P.pendWant : !P.playing;
    var leading = !P.togglePending && (now - P.lastCommit >= TOGGLE_WIN);

    P.togglePending = true;
    P.pendWant = want;
    P.playing = want;                                     /* 乐观：按钮立刻变 */
    P.holdUntil = Math.max(P.holdUntil, now + TOGGLE_WIN + HOLD_MS);
    paintState();
    if (leading) { landToggle(want); }                    /* 首击：立即生效 */
    if (P.toggleTimer) { clearTimeout(P.toggleTimer); }   /* 连点续期，静止 260ms 才收尾 */
    P.toggleTimer = setTimeout(commitToggle, TOGGLE_WIN);
  }

  function commitToggle() {
    if (P.toggleTimer) { clearTimeout(P.toggleTimer); P.toggleTimer = 0; }
    if (!P.togglePending) { return; }
    var want = !!P.pendWant;
    P.togglePending = false;
    P.pendWant = null;
    if (!P.item) { P.playing = want; paintState(); return; }
    if (want === P.applied) { P.playing = want; paintState(); return; }   /* 终态没变：不再补调 */
    landToggle(want);
  }

  /* 换主播：把播放态彻底归零，旧节目不许被 toggle()/resume() 再拉起来 */
  function resetPlayback() {
    cancelToggle();
    ++P.token;                       /* 作废在途取流 / 错误重试 */
    clearTimeout(P.retryTimer);
    P.retryTimer = 0;
    P.item = null;
    P.playing = false;
    P.applied = false;
    P.loading = false;
    P.error = false;
    P.stopped = true;
    P.dur = 0;
    P.wantPos = 0;
    P.startingUntil = 0;
    P.holdUntil = 0;
    P.lastCommit = 0;
    P.queue = [];                    /* 旧主播的队列/位置一并作废 */
    P.qi = 0;
    P.retries = 0;
    P.lastPaint = -1;
    P.lastState = '';
    P.emitKey = '';
    P.mediaUrl = '';
    P.dragging = false;
    nativesReset();
    unfreeze();
    stallPaint(false);
    if (P.locked) { lock(false, true); }
    P.uiAway = false;
    uiPaint();
    if (P.boost) { boostOff(); }
    var v = E.video;
    if (v) {
      try { if (!v.paused) { v.pause(); } } catch (e) { }
      try { v.removeAttribute('src'); v.load(); } catch (e) { }
      v.dataset.key = '';
      v.dataset.cover = '';
      v.poster = '';
    }
    var BR = window.AndroidRadio;
    if (BR && BR.stop) { try { BR.stop(); } catch (e) { } }
    if (E.poster) { E.poster.hidden = true; E.poster.removeAttribute('src'); }
    setTitle(null);
    paintMeta(null);
    showLoading(false);
    if (RR.danmaku) { RR.danmaku.clear(); RR.danmaku.pause(); }
    paintState(); paintTime();
    markCurrent();
    renderResume();
    emitOnce(false);
  }

  function stop(opts) {
    opts = opts || {};
    cancelToggle();
    P.playing = false;
    P.stopped = true;
    P.loading = false;
    P.applied = false;
    nativesReset();
    stallPaint(false);
    unfreeze();
    P.uiAway = false;
    uiPaint();
    if (P.boost) { boostOff(); }
    var v = E.video;
    if (v) { try { v.pause(); } catch (e) { } }
    var BR = window.AndroidRadio;
    if (BR && BR.stop) { try { BR.stop(); } catch (e) { } }   /* 仲裁：同一时刻只能一个音源 */
    if (RR.danmaku) { RR.danmaku.pause(); }
    remember(P.item, position());
    paintState(); paintTime();
    emitOnce(false);
    /* 停播就是会话结束：小窗（如果开着）立刻收掉，别在别的视图上挡一个暂停的画面 */
    if (RR.mini && typeof RR.mini.sync === 'function') { try { RR.mini.sync(); } catch (e) { } }
  }

  function seek(sec) {
    var v = E.video;
    if (!v || !P.item) { return; }
    var dur = P.dur || 0;
    sec = Math.max(0, Math.min(dur > 0 ? dur - .2 : 1e9, Number(sec) || 0));
    try { v.currentTime = sec; } catch (e) { }
    var BR = window.AndroidRadio;
    if (BR && BR.seek) { try { BR.seek(Math.round(sec * 1000)); } catch (e) { } }
    P.holdUntil = Date.now() + HOLD_MS;
    P.lastPaint = -1;
    nativesReset();                  /* seek 之后原生位置会跳，旧基线不能算推进 */
    unfreeze();
    paintTime();
    if (RR.danmaku) {
      RR.danmaku.clear();
      if (P.playing) { RR.danmaku.resume(); }
    }
    remember(P.item, sec);
    uiArm();
    return sec;
  }

  function jump(delta, label) {
    seek(position() + delta);
    hint(label);
  }

  function hint(text) {
    if (!E.hint) { return; }
    E.hint.textContent = text;
    E.hint.classList.add('is-on');
    clearTimeout(P.hintTimer);
    P.hintTimer = setTimeout(function () { E.hint.classList.remove('is-on'); }, 720);
  }

  function advance() {
    var next = P.queue[P.qi + 1];
    if (!next) { return false; }
    P.qi++;
    play(next, 0);
    scrollRow(next.bvid);
    return true;
  }

  function onEnded() {
    P.playing = false; P.loading = false; P.applied = false;
    paintState(); emitOnce(false);
    if (RR.danmaku) { RR.danmaku.clear(); }
    RR.emit('ended', { item: P.item });
    if (RR.settings && RR.settings().autoplay === false) {
      P.stopped = true;
      note('这一期播完了');
      return;
    }
    if (!advance()) {
      P.stopped = true;
      note('节目带播完了，换一期接着听');
    }
  }

  /* ---------- 倍速 ---------- */
  function applyRateToNative(r) {
    r = Math.max(.5, Math.min(3, +r || 1));
    if (E.video) { try { E.video.playbackRate = r; } catch (e) { } }
    var BR = window.AndroidRadio;
    if (BR && BR.setRate) { try { BR.setRate(r); } catch (e) { } }
  }

  function applyRate(r, persist) {
    r = Math.max(.5, Math.min(3, +r || 1));
    P.rate = r;
    if (!P.boost) { applyRateToNative(r); }
    if (E.rateLabel) { E.rateLabel.textContent = fmtRate(r); }
    if (persist !== false && RR.saveSettings) { RR.saveSettings({ rate: r }); }
  }

  function rate(r) {
    if (r === undefined) { return P.rate; }
    applyRate(r, true);
    return P.rate;
  }

  function boostOn() {
    if (!P.playing || P.boost) { return; }
    P.boost = true;
    applyRateToNative(2);
    if (E.boost) { E.boost.hidden = false; }
    if (navigator.vibrate) { try { navigator.vibrate(6); } catch (e) { } }
  }

  function boostOff() {
    if (!P.boost) { return; }
    P.boost = false;
    applyRateToNative(P.rate);
    if (E.boost) { E.boost.hidden = true; }
  }

  /* ---------- 7.1 · 倍速（对外入口） ---------- */
  function setSpeed(r) {
    r = Math.max(.5, Math.min(2, +r || 1));
    if (P.boost) { P.boost = false; if (E.boost) { E.boost.hidden = true; } }
    applyRate(r, true);
    hint(fmtRate(r));
    return P.rate;
  }

  /* ---------- 7.1 · 清晰度：换流不黑屏 ----------
     先把当前帧画到 #ch-hold 铺住画面，再重新取流从原位置起播；
     首个 'playing' 帧到了才撤掉定格画（unfreeze）。 */
  function freeze() {
    var v = E.video, cv = E.hold;
    if (!v || !cv) { return false; }
    var w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) { return false; }
    try {
      var scale = Math.min(1, 1280 / Math.max(w, h));
      cv.width = Math.max(2, Math.round(w * scale));
      cv.height = Math.max(2, Math.round(h * scale));
      var ctx = cv.getContext('2d');
      ctx.drawImage(v, 0, 0, cv.width, cv.height);
      cv.hidden = false;
      clearTimeout(P.holdTimer);
      P.holdTimer = setTimeout(unfreeze, 8000);   /* 兜底：8s 一定撤 */
      return true;
    } catch (e) { return false; }
  }

  function unfreeze() {
    clearTimeout(P.holdTimer);
    P.holdTimer = 0;
    if (E.hold) { E.hold.hidden = true; }
  }

  /* 清晰度：**先认接口**。`/api/playurl` 回什么档就用什么档（accept: [{qn,desc}]），
     没回才回落常用四档；「自动」= 当前可用的最高档（qn 记 0）。
     切档仍然走 freeze() → play(原位置)，位置由 video.currentTime 唯一决定。 */
  var QN_LABEL = {
    127: '8K', 126: '杜比视界', 125: 'HDR', 120: '4K', 116: '1080P60', 112: '1080P+',
    80: '1080P', 74: '720P60', 64: '720P', 32: '480P', 16: '360P', 6: '240P'
  };
  var QN_FALLBACK = [80, 74, 64, 32];

  function labelOf(qn) { return QN_LABEL[qn] || (qn > 0 ? ('QN ' + qn) : '自动'); }

  function qualityList() {
    var auto = { qn: 0, label: '自动', hint: '自动用这一期能给的最高档' };
    if (P.accept.length) { return [auto].concat(P.accept); }
    return [auto].concat(QN_FALLBACK.map(function (qn) {
      return { qn: qn, label: labelOf(qn) };
    }));
  }

  function acceptHas(qn) {
    for (var i = 0; i < P.accept.length; i++) { if (P.accept[i].qn === qn) { return true; } }
    return false;
  }

  /* 自动档的落点：接口给过档位就用最高那档，否则 1080P */
  function bestQn() {
    var best = 0;
    for (var i = 0; i < P.accept.length; i++) { if (P.accept[i].qn > best) { best = P.accept[i].qn; } }
    if (!best) { for (var j = 0; j < QN_FALLBACK.length; j++) { if (QN_FALLBACK[j] > best) { best = QN_FALLBACK[j]; } } }
    return best || 80;
  }

  function wantQn() {
    var qn = +((RR.settings && RR.settings().qn) || 0);
    return qn > 0 ? qn : bestQn();
  }

  function qnLabel(qn) {
    qn = +qn || 0;
    if (qn <= 0) { return '自动'; }
    var list = qualityList();
    for (var i = 0; i < list.length; i++) { if (list[i].qn === qn) { return list[i].label; } }
    return labelOf(qn);
  }

  function cacheAccept(d) {
    if (!d) { return; }
    var raw = d.accept || d.accept_quality || d.acceptQuality;
    var actual = +((d.quality || d.current_qn) || 0);
    if (actual > 0) { P.qnActual = actual; }
    if (!raw || !raw.length) { paintQn(); return; }
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var x = raw[i], qn = 0, lab = '';
      if (typeof x === 'number' || typeof x === 'string') { qn = +x; }
      else if (x) { qn = +x.qn || +x.quality || 0; lab = x.desc || x.desc_name || x.label || ''; }
      if (qn > 0) { out.push({ qn: qn, label: lab || labelOf(qn) }); }
    }
    if (!out.length) { paintQn(); return; }
    out.sort(function (a, b) { return b.qn - a.qn; });
    P.accept = out;
    paintQn();
  }

  /* #ch-qn / 面板里的「当前」都读这里：优先报真实在放的档，其次报用户选的档 */
  function currentQn() {
    var want = +((RR.settings && RR.settings().qn) || 0);
    if (want <= 0) { return 0; }
    if (P.accept.length && !acceptHas(want) && P.qnActual > 0) { return P.qnActual; }
    return want;
  }

  function paintQn() {
    if (!E.qn) { return; }
    var qn = currentQn();
    var lab = qnLabel(qn);
    if (E.qn.textContent !== lab) { E.qn.textContent = lab; }
    E.qn.setAttribute('aria-label', '清晰度 ' + lab + '，点开切换');
    E.qn.setAttribute('data-qn', String(qn));
  }

  function setQuality(qn, silent) {
    qn = Math.max(0, Number(qn) || 0);
    var cur = +((RR.settings && RR.settings().qn) || 0);
    P.qn = qn;
    P.qnActual = qn > 0 ? qn : bestQn();
    if (RR.saveSettings) { RR.saveSettings({ qn: qn }); }
    paintQn();
    if (!P.item) { return P.qn; }
    if (qn === cur && !silent) { hint('已经是这个清晰度'); return P.qn; }
    var it = P.item, pos = position(), wasPlaying = !!P.playing;
    freeze();                                    /* 定格最后一帧，切的时候不黑屏 */
    P.media = {};                                /* 只作废取流缓存，不换期 */
    var p = play(it, pos);                       /* 位置续着播 */
    if (!wasPlaying) { p.then(function () { pause(); }); }
    if (!silent) { hint('清晰度 · ' + qnLabel(qn)); }
    return P.qn;
  }

  /* 8.1：这一期接口回的最高档。没回 accept 时返回 0（=档位未知，不做登录提示） */
  function maxAcceptQn() {
    var best = 0;
    for (var i = 0; i < P.accept.length; i++) { if (P.accept[i].qn > best) { best = P.accept[i].qn; } }
    return best;
  }

  /* 登录态口径与 21-dm-ui / 41-live 一致：/api/status 的 {logged,mid,uname}。
     取不到就返回 null（未知），调用方不拿它当「已登录」。 */
  function loginState() {
    return RR.api('/api/status', { timeout: 4000 }).then(function (d) {
      return !!(d && (d.logged === true || d.mid || d.uname)) && !(d && d.logged === false);
    }).catch(function () { return null; });
  }

  /* 面板底部：「这一期最高只到 720P」且未登录时，补一行登录提示。
     只在 accept 明确回档、且最高档 ≤64（720P）时出现；点一下关面板回「我的」。 */
  function addQualityLoginHint(box, sh) {
    var best = maxAcceptQn();
    if (!best || best > 64) { return; }
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'ch-qnhint';
    b.hidden = true;
    b.setAttribute('aria-label', '登录 B 站账号可解锁 1080P，点这里去登录');
    b.innerHTML = '<span class="ch-qnhint__ico" aria-hidden="true">' + RR.ICO('user', 18) + '</span>' +
      '<span>登录 B 站账号可解锁 1080P</span>' +
      '<span class="ch-qnhint__chev" aria-hidden="true">' + RR.ICO('chevron', 16) + '</span>';
    b.addEventListener('click', function () {
      try { sh.close(); } catch (e) { }
      RR.go('me');
    });
    box.appendChild(b);
    loginState().then(function (on) {
      if (on === true) { return; }                 /* 已登录：这行本来就不该出现 */
      if (!box.isConnected) { return; }            /* 面板已经关了/换了，别再往旧节点写 */
      b.hidden = false;
    });
  }

  /* 只开画质面板：不复用倍速/定时那张，省得用户在一堆行里找 */
  function openQuality() {
    var box = document.createElement('div');
    var cur = +((RR.settings && RR.settings().qn) || 0);
    var shown = currentQn();
    var sh = RR.sheet({ title: '清晰度', body: box });
    subHead(box, '画质', true);
    qualityList().forEach(function (q) {
      var on = q.qn === cur;
      box.appendChild(rowBtn(
        '<span class="sheet-row__t"><b>' + esc(q.label) + '</b><i>' +
        (on ? '正在用这一档' : esc(q.hint || '切过去从当前位置接着播')) + '</i></span>' +
        (on ? '<span class="badge">当前</span>' : ''),
        function () { sh.close(); setQuality(q.qn); }));
    });
    var tip = document.createElement('p');
    tip.className = 'muted';
    tip.style.cssText = 'font-size:12px;margin:12px 0 2px';
    tip.textContent = P.accept.length
      ? ('这一期实际可用 ' + P.accept.length + ' 档，当前在放 ' + qnLabel(shown))
      : '还没取到这一期的流，先按常用档位列';
    box.appendChild(tip);
    addQualityLoginHint(box, sh);
    return sh;
  }

  /* 外部（小窗 / 路由 / 画中画）挪动过播放器后，让频道 UI 按 currentTime 重画一次 */
  function repaint() {
    if (!P.mounted) { return; }
    P.lastPaint = -1;
    paintState();
    paintQn();
    paintTime();
    markCurrent();
    uiPaint();
  }

  /* ---------- 7.1 · 上一期 / 下一期 ---------- */
  function next(silent) {
    var q = P.queue;
    if (!q.length) { return false; }
    if (P.qi + 1 >= q.length) {
      if (!silent) { note('已经是最后一期了'); }
      return false;
    }
    P.qi++;
    play(q[P.qi], 0);
    scrollRow(q[P.qi].bvid);
    if (!silent) { hint('下一期'); }
    return true;
  }

  /* 上一期就是上一期（可预期优先）：已经在第一期就从头再放，别让人以为按钮没反应 */
  function prev(silent) {
    var q = P.queue;
    if (!q.length || !P.item) { return false; }
    if (P.qi <= 0) {
      seek(0);
      if (!silent) { hint('已经是第一期 · 从头放'); }
      return false;
    }
    P.qi--;
    play(q[P.qi], 0);
    scrollRow(q[P.qi].bvid);
    if (!silent) { hint('上一期'); }
    return true;
  }

  /* ---------- 7.1 · 锁屏（防误触） ---------- */
  function lock(on, silent) {
    on = !!on;
    if (P.locked === on) { return P.locked; }
    P.locked = on;
    if (on) { P.uiAway = false; }
    if (E.stage) {
      E.stage.classList.toggle('is-locked', on);
      if (!on) { E.stage.classList.remove('is-lockhint'); }
    }
    if (root) { root.classList.toggle('is-locked', on); }   /* 手势层的 #view-channel.is-locked 也跟着走 */
    if (E.shield) { E.shield.hidden = !on; }
    if (E.lock) { E.lock.setAttribute('data-state', on ? 'locked' : 'unlocked'); }
    if (RR.preview && RR.preview.close) { try { RR.preview.close(); } catch (e) { } }
    uiPaint();
    uiArm();
    clearTimeout(P.lockTimer);
    if (on) { lockHint(true); }
    if (!silent) { note(on ? '已锁定 · 点画面显示解锁按钮' : '已解锁'); }
    return P.locked;
  }

  function isLocked() { return !!P.locked; }

  /* 锁屏时只显隐那把锁 */
  function lockHint(show) {
    if (!E.stage) { return; }
    clearTimeout(P.lockTimer);
    if (show === undefined) { show = !E.stage.classList.contains('is-lockhint'); }
    E.stage.classList.toggle('is-lockhint', !!show);
    if (show) {
      P.lockTimer = setTimeout(function () {
        if (E.stage) { E.stage.classList.remove('is-lockhint'); }
      }, 2600);
    }
  }

  /* ---------- 8.1 · 退后台：优先「显示在其他应用上方」的悬浮窗，没权限才回退画中画 ---------- */
  /* 当前这一路的播放快照：退后台时原生要靠它自己起悬浮窗，不能等网页再算 */
  function nowPlaying() {
    if (!P.item || !E.video) { return null; }
    var v = E.video;
    var src = v.currentSrc || v.src || '';
    if (!src || src.indexOf('/api/stream') < 0) { return null; }
    return {
      url: src,
      title: (E.title && E.title.textContent) || P.item.title || '正在播放',
      pos: Math.max(0, Math.round((v.currentTime || 0) * 1000)),
      live: false,
      playing: !!P.playing && !v.paused && !v.ended
    };
  }

  /* 每 1.5s 把位置/标题镜像给原生（tick 里调，成本只有一次字符串拼接） */
  var npAt = 0;
  function syncNowPlaying(force) {
    var BR = window.AndroidRadio;
    if (!BR || typeof BR.setNowPlaying !== 'function') { return; }
    /* 直播页在播时，快照归直播：否则回放的 tick 会把直播地址顶掉，
       退后台就会弹出上一期的回放。 */
    if (RR.route && RR.route() === 'live') {
      var ls = RR.live && RR.live.state ? RR.live.state() : null;
      if (ls && ls.living) { return; }
    }
    var now = Date.now();
    if (!force && now - npAt < 1500) { return; }
    npAt = now;
    var n = nowPlaying();
    try {
      if (n) { BR.setNowPlaying(n.url, n.title, n.pos, false, n.playing); }
      else if (!P.item) { BR.setNowPlaying('', '', 0, false, false); }
    } catch (e) { }
  }

  function overlayOn() {
    var s = (RR.settings && RR.settings()) || {};
    return s.overlayOn !== false;
  }

  function overlayAllowed() {
    var BR = window.AndroidRadio;
    if (!BR || typeof BR.isOverlayAllowed !== 'function') { return false; }
    try { return !!BR.isOverlayAllowed(); } catch (e) { return false; }
  }

  /* 真起了悬浮窗就返回 true，并让网页这路让位（声音归悬浮窗，避免双声） */
  function tryOverlay() {
    var BR = window.AndroidRadio;
    if (!BR || typeof BR.showOverlay !== 'function' || !overlayOn()) { return false; }
    var n = nowPlaying();
    if (!n) { return false; }
    if (!overlayAllowed()) {
      try { if (BR.openOverlaySettings) { BR.openOverlaySettings(); } } catch (e) { }
      note('打开「显示在其他应用上方」后，退后台就是悬浮窗', 'err');
      return false;
    }
    try {
      if (!BR.showOverlay(n.title, n.url, n.pos, false)) { return false; }
    } catch (e) { return false; }
    commitPause();                           /* 网页暂停、原生停声，悬浮窗接管 */
    return true;
  }

  function pip() {
    if (tryOverlay()) { return true; }
    var BR = window.AndroidRadio;
    if (BR && BR.enterPiP) {
      try { return !!BR.enterPiP(); } catch (e) { }
    }
    /* 老 APK / 桌面：退回网页 PiP（画面在网页，声音仍在原生） */
    var v = E.video;
    if (v && document.pictureInPictureEnabled && v.requestPictureInPicture) {
      try {
        v.removeAttribute('disablepictureinpicture');
        var p = v.requestPictureInPicture();
        if (p && p.catch) { p.catch(function () { note('这台设备进不了画中画', 'err'); }); }
        return true;
      } catch (e) { }
    }
    note('这台设备还不支持画中画', 'err');
    return false;
  }

  /* ---------- 7.1 · 逐帧 / 抓帧（截图模块可以直接用） ---------- */
  function frameStep(dir) {
    dir = (+dir) < 0 ? -1 : 1;
    if (!P.item || !E.video) { return 0; }
    if (P.playing) { pause(); }
    var t = Math.max(0, position() + dir / FPS);
    try { E.video.currentTime = t; } catch (e) { }
    var BR = window.AndroidRadio;
    if (BR && BR.seek) { try { BR.seek(Math.round(t * 1000)); } catch (e) { } }
    P.holdUntil = Date.now() + HOLD_MS;
    nativesReset();
    unfreeze();
    paintTime();
    return t;
  }

  function captureFrame() {
    var v = E.video;
    if (!v || !v.videoWidth) { return null; }
    var w = v.videoWidth, h = v.videoHeight;
    var scale = Math.min(1, 1600 / Math.max(w, h));
    var cv = document.createElement('canvas');
    cv.width = Math.max(2, Math.round(w * scale));
    cv.height = Math.max(2, Math.round(h * scale));
    try { cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height); } catch (e) { return null; }
    return cv;
  }

  /* ---------- 定时关闭 ---------- */
  function armSleep(min, quiet) {
    min = Math.max(0, +min || 0);
    P.sleepMin = min;
    P.sleepAt = min > 0 ? Date.now() + min * 60000 : 0;
    if (min > 0 && !quiet) { note('定时关闭 · ' + min + ' 分钟后暂停'); }
  }

  function sleep(min) {
    if (min === undefined) { return P.sleepMin; }
    armSleep(min);
    if (RR.saveSettings) { RR.saveSettings({ sleep: +min || 0 }); }
    if (!+min && !P.sleepAt) { note('定时关闭已取消'); }
    return P.sleepMin;
  }

  function checkSleep() {
    if (P.sleepAt && Date.now() >= P.sleepAt) {
      P.sleepAt = 0; P.sleepMin = 0;
      if (RR.saveSettings) { RR.saveSettings({ sleep: 0 }); }
      if (P.playing) { pause(); }
      note('定时关闭 · 已经暂停');
    }
  }

  /* ---------- 原生同步（7.1 重做） ----------------------------
     进度真相只有一个：video.currentTime。
     原生的 getPosition() 只是「另一台设备的读数」，必须先证明它自己在走，
     才有资格在极端漂移时限流纠偏；
     它不动的时候（缓冲/卡死/控制器没连上）我们既不 seek 也不 pause，
     只把 UI 切进缓冲态，卡满 8s 才重启原生一次。
     P0「几秒内循环」就是旧版无条件 `v.currentTime = posms/1000` 造成的。 */
  function stallPaint(on, text) {
    on = !!on && !!P.item && !P.loading && !P.error;
    if (E.stallTxt && text) { E.stallTxt.textContent = text; }
    if (P.stalled === on) { return; }
    P.stalled = on;
    if (E.stall) { E.stall.hidden = !on; }
    if (E.stage) { E.stage.classList.toggle('is-stall', on); }
  }

  /* 原生确实卡死了：按「页面上的真相」重开一条流（不碰画面进度） */
  function restartNative() {
    var BR = window.AndroidRadio;
    if (!BR || !BR.play || !P.item) { return false; }
    var v = E.video;
    var pos = (v && isFinite(v.currentTime) && v.currentTime > 0) ? v.currentTime : (P.wantPos || 0);
    var dur = P.dur || P.item.dur || 0;
    N.restarts++;
    N.stallFrom = Date.now();        /* 再给一个观察窗 */
    N.pos = -1; N.advN = 0;          /* 新的这条流要重新证明自己在走 */
    N.lastRestart = Date.now();
    stallPaint(true, '正在重连声音…');
    try {
      BR.play((E.title && E.title.textContent) || P.item.title, P.mediaUrl || '',
        Math.round(pos * 1000), Math.round(dur * 1000),
        P.item.bvid + '|' + P.item.cid, coverOf(P.item.cover));
    } catch (e) { return false; }
    return true;
  }

  function syncNative(v) {
    var BR = window.AndroidRadio;
    if (!BR || !BR.getPlayWhenReady) { stallPaint(false); return; }
    var now = Date.now();
    var pwr = false, posms = -1, durms = -1;
    try {
      pwr = !!BR.getPlayWhenReady();
      posms = BR.getPosition ? Number(BR.getPosition()) : -1;
      durms = BR.getDuration ? Number(BR.getDuration()) : -1;
    } catch (e) { return; }
    if (isFinite(durms) && durms > 500) { P.dur = durms / 1000; }

    /* ---- 采样记账：只算「这次比上次推进了多少」，绝不据此改画面 ---- */
    var dt = N.at ? now - N.at : 0;
    var adv = (N.pos >= 0 && posms >= 0) ? posms - N.pos : 0;
    N.pos = posms >= 0 ? posms : -1;
    N.at = now;

    /* 拖动进度 / 连点合流 / 刚起播刚暂停刚 seek：这段时间原生的读数不算数 */
    if (P.dragging || P.togglePending || now < P.holdUntil) {
      N.adv = 0; N.advN = 0; N.stallFrom = 0; N.pwrMiss = 0;
      stallPaint(false);
      return;
    }
    /* 位置读数是否可用：控制器没连上时旧桥接给 0，页面都放到 1s 之后了原生
       不可能正好在 0 —— 这种读数不是「卡住」而是「没有数据」，不参与卡死判定，
       也不拿来纠偏；但播放意图（pwr）照旧可信，下面的镜像继续做。 */
    var posOk = posms >= 0 && !(posms < 100 && (+v.currentTime || 0) > 1);

    if (!posOk) {
      N.adv = 0; N.advN = 0; N.stallFrom = 0; N.restarts = 0;
      stallPaint(false);
    } else {
      var atEnd = P.dur > 0 && posms >= P.dur * 1000 - 1200;
      /* 「在走」的判据：有播放意图 + 一次采样推进 ≥150ms + 推进速率 ≥ 实时的 15% */
      var moving = pwr && adv >= VT && dt > 0 && (adv / dt) > VTR;

      N.adv = adv;
      N.advN = moving ? N.advN + 1 : 0;

      if (atEnd || !pwr) {
        N.stallFrom = 0; N.restarts = 0;
        stallPaint(false);
      } else if (moving) {
        if (N.stallFrom) { N.stallFrom = 0; N.restarts = 0; }
        stallPaint(false);
      } else {
        if (!N.stallFrom) { N.stallFrom = now; stallPaint(true, '声音缓冲中'); }
        else if (now - N.stallFrom >= STALL_RESTART && N.restarts < 1) { restartNative(); }
      }

      /* ---- 硬纠偏：原生连续两次采样被证明在走，且漂移离谱，且距上次 ≥8s ----
         方向不对称：往前纠（画面落后）3s 就够；往后拽（画面领先）要 8s —— 回退正是
         用户看到的「几秒循环」，宁可让画面略微超前，也绝不轻易往回拉。
         长按 2× 期间两边倍速可能不一致，整段跳过。 */
      if (moving && N.advN >= 2 && !v.paused && !v.ended && !P.boost && now - N.fixAt >= FIX_MIN) {
        var drift = posms / 1000 - (+v.currentTime || 0);
        if (drift > HARD_DRIFT || drift < -HARD_BACK) {
          N.fixAt = now;
          P.holdUntil = now + HOLD_MS;     /* 纠完重新给原生一点时间 */
          nativesReset();
          try { v.currentTime = posms / 1000; } catch (e) { }
        }
      }
    }

    /* 播完的那一帧不参与「播放态镜像」，否则会把 ended 的视频重新拉起来 */
    if (v.ended) { N.pwrMiss = 0; return; }

    /* ---- 播放态镜像：原生也是用户的遥控器（通知栏/耳机键） ---- */
    var videoOn = !v.paused;
    if (pwr !== videoOn) {
      N.pwrMiss++;
      if (N.pwrMiss >= 2) {              /* 连续两个 tick 都对不上才纠一次 */
        N.pwrMiss = 0;
        if (pwr) {
          keepNative(function () { try { var p = v.play(); if (p && p.catch) { p.catch(noop); } } catch (e) { } });
        } else {
          keepNative(function () { try { v.pause(); } catch (e) { } });
        }
      }
    } else {
      N.pwrMiss = 0;
    }
    if (pwr !== P.playing) {
      P.playing = pwr;
      P.applied = pwr;
      paintState();
      emitOnce(pwr);
      if (RR.danmaku) { if (pwr) { RR.danmaku.resume(); } else { RR.danmaku.pause(); } }
    }
  }

  function tick() {
    if (!P.mounted) { return; }
    if (document.hidden) { checkSleep(); return; }
    var v = E.video;
    if (!v || !P.item) { checkSleep(); return; }
    if (!P.stopped && !P.hidden) { syncNative(v); }
    if (!P.stopped) { syncNowPlaying(); }      /* 退后台时原生靠这份快照起悬浮窗 */
    var d = v.duration;
    if (d && isFinite(d) && d > 0) { P.dur = d; }
    if (P.loading && !P.error && Date.now() - P.startingUntil > 9000 && v.readyState < 2) {
      P.loading = false;
      showLoading(false);
      paintState();
      note('画面还在缓冲，声音可能已经开始了');
    }
    paintTime();
    paintState();
    if (P.playing && Date.now() - P.savedAt > 5000) {
      P.savedAt = Date.now();
      remember(P.item, v.currentTime);
    }
    checkSleep();
  }

  /* ============================================================
     六、节目带列表
     ============================================================ */
  function pubDate(p) {
    if (p.pubdate) { return new Date(p.pubdate * 1000); }
    if (p.date) {
      var d = new Date(String(p.date).replace(/-/g, '/'));
      if (!isNaN(d.getTime())) { return d; }
    }
    return null;
  }
  function clockOf(p) {
    var d = pubDate(p);
    if (!d) { return '--:--'; }
    var h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? '0' + h : h) + ':' + (m < 10 ? '0' + m : m);
  }
  function dateOf(p) {
    var d = pubDate(p);
    if (!d) { return ''; }
    var m = d.getMonth() + 1, day = d.getDate();
    return (m < 10 ? '0' + m : m) + '.' + (day < 10 ? '0' + day : day);
  }

  function rowHtml(p) {
    var parts = (p.parts && p.parts.length) ? p.parts : [];
    var bits = [];
    if (p.category) { bits.push(p.category); }
    bits.push(parts.length > 1 ? parts.length + ' 段' : '单段');
    if (+p.dm_total) { bits.push(RR.fmtCount(+p.dm_total) + ' 弹幕'); }
    var dur = +p.duration || 0;
    return '<button class="ch-row" type="button" data-bvid="' + esc(p.bvid) + '" aria-label="' + esc(p.title) + '">' +
      '<span class="ch-row__time"><span class="ch-row__date num">' + dateOf(p) + '</span>' +
      '<span class="ch-row__hms num">' + clockOf(p) + '</span></span>' +
      '<span class="ch-row__main">' +
      '<span class="ch-row__title truncate">' + esc(p.title) + '</span>' +
      '<span class="ch-row__sub truncate">' + esc(bits.join(' · ')) + '</span>' +
      '</span>' +
      '<span class="ch-row__dur num">' + (dur ? RR.fmtTime(dur) : '--:--') + '</span>' +
      '<span class="ch-eq" aria-hidden="true"><i></i><i></i><i></i></span>' +
      '</button>';
  }

  function filtered() {
    if (D.filter === 'all') { return D.eps; }
    return D.eps.filter(function (p) { return (p.category || '其他') === D.filter; });
  }

  function renderReset() {
    if (!E.list) { return; }
    E.list.innerHTML = '';
    D.shown = 0;
    D.lastDate = '';
    appendChunk();
    updateEmpty();
  }

  function appendChunk() {
    if (!E.list) { return; }
    var list = filtered();
    if (D.shown >= list.length) {
      if (E.more) { E.more.hidden = true; }
      return;
    }
    var slice = list.slice(D.shown, D.shown + CHUNK);
    var frag = document.createDocumentFragment();
    slice.forEach(function (p) {
      var li = document.createElement('li');
      li.className = 'ch-item';
      li.innerHTML = rowHtml(p);
      frag.appendChild(li);
    });
    E.list.appendChild(frag);
    D.shown += slice.length;
    if (E.more) { E.more.hidden = D.shown >= list.length; }
    markCurrent();
  }

  function updateEmpty() {
    if (!E.empty) { return; }
    var list = filtered();
    if (D.loading || D.error) { return; }
    if (!D.loaded) { return; }
    if (D.eps.length === 0) {
      showEmpty({
        ttl: '这位主播还没有回放',
        sub: '等 TA 播完一场，回放会自己排进这条频道',
        action: '重新加载',
        fn: function () { loadPrograms(true); }
      });
      return;
    }
    if (!list.length) {
      showEmpty({
        ttl: '「' + D.filter + '」分类还是空的',
        sub: '先把全部 ' + D.eps.length + ' 期翻一遍',
        action: '看全部',
        fn: function () { setFilter('all'); }
      });
      return;
    }
    hideEmpty();
  }

  function showEmpty(o) {
    if (!E.empty) { return; }
    E.empty.hidden = false;
    if (E.emptyTtl) { E.emptyTtl.textContent = o.ttl || ''; }
    if (E.emptySub) { E.emptySub.textContent = o.sub || ''; }
    if (E.retry) { E.retry.textContent = o.action || '重新加载'; }
    emptyFn = o.fn || function () { loadPrograms(true); };
  }
  function hideEmpty() { if (E.empty) { E.empty.hidden = true; } }

  function showSkeleton(on) {
    if (!E.skel) { return; }
    if (on && !E.skel.childElementCount) {
      var h = '';
      for (var i = 0; i < 6; i++) {
        h += '<span class="ch-sk" aria-hidden="true"><i></i><b></b><em></em></span>';
      }
      E.skel.innerHTML = h;
    }
    E.skel.hidden = !on;
    if (E.list) { E.list.hidden = !!on; }
    if (on) { hideEmpty(); if (E.more) { E.more.hidden = true; } }
  }

  function buildFilters() {
    if (!E.filters) { return; }
    E.filters.innerHTML = '';
    var counts = {}, order = [];
    D.eps.forEach(function (p) {
      var c = p.category || '其他';
      if (!counts[c]) { counts[c] = 0; order.push(c); }
      counts[c]++;
    });
    var known = ['歌回', '杂谈', '游戏', '联动'];
    var cats = known.filter(function (c) { return counts[c]; })
      .concat(order.filter(function (c) { return known.indexOf(c) < 0; }));
    if (D.filter !== 'all' && cats.indexOf(D.filter) < 0) { D.filter = 'all'; }

    function chip(label, n, key) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (D.filter === key ? ' is-on' : '');
      b.setAttribute('data-filter', key);
      b.setAttribute('aria-pressed', String(D.filter === key));
      b.innerHTML = esc(label) + ' <span class="num">' + n + '</span>';
      return b;
    }
    E.filters.appendChild(chip('全部', D.eps.length, 'all'));
    cats.forEach(function (c) { E.filters.appendChild(chip(c, counts[c], c)); });
  }

  function setFilter(key) {
    D.filter = key;
    if (!E.filters) { return; }
    Array.prototype.forEach.call(E.filters.children, function (n) {
      var on = n.getAttribute('data-filter') === key;
      n.classList.toggle('is-on', on);
      n.setAttribute('aria-pressed', String(on));
    });
    renderReset();
  }

  function loadPrograms(force) {
    if (D.pend && !force) { return D.pend; }
    D.loading = true;
    D.error = null;
    showSkeleton(true);
    D.pend = fetchPrograms(force).then(function (items) {
      D.eps = (RR.replay.episodes() || []).slice();
      D.seq = items || [];
      if (!D.eps.length && D.seq.length) { D.eps = groupItems(D.seq); }
      D.loaded = true;
      D.loading = false;
      D.pend = null;
      D.sid = stationId();
      showSkeleton(false);
      buildFilters();
      renderReset();
      paintCount();
      renderResume();
      markCurrent();
      return true;
    }).catch(function (e) {
      D.loading = false;
      D.pend = null;
      D.error = e;
      showSkeleton(false);
      if (E.list) { E.list.innerHTML = ''; }
      if (E.more) { E.more.hidden = true; }
      showEmpty({
        ttl: '节目带没取到',
        sub: (e && e.message) || '网络不太顺，稍后再试',
        action: '重新加载',
        fn: function () { loadPrograms(true); }
      });
      return false;
    });
    return D.pend;
  }

  function groupItems(items) {
    var map = {}, out = [];
    items.forEach(function (x) {
      var k = x.bvid || x.cid;
      if (!map[k]) {
        map[k] = { bvid: x.bvid, title: x.progTitle || x.title, category: x.kind || x.category, pubdate: x.pubdate, date: x.date, duration: 0, dm_total: 0, cover: x.cover, parts: [] };
        out.push(map[k]);
      }
      var p = map[k];
      p.parts.push({ cid: x.cid, page: x.page, part: x.part, duration: x.dur, dm_total: x.dm_total });
      p.duration += x.dur || 0;
      p.dm_total += x.dm_total || 0;
    });
    return out;
  }

  function paintCount() {
    if (!E.count) { return; }
    if (!D.loaded) { E.count.textContent = ''; return; }
    E.count.textContent = D.eps.length + ' 期 · ' + D.seq.length + ' 段';
  }

  function markCurrent() {
    if (!E.list) { return; }
    var bvid = P.item && P.item.bvid;
    Array.prototype.forEach.call(E.list.querySelectorAll('.ch-row'), function (n) {
      var on = !!bvid && n.getAttribute('data-bvid') === bvid;
      n.classList.toggle('is-on', on);
      if (on) { n.setAttribute('aria-current', 'true'); } else { n.removeAttribute('aria-current'); }
    });
  }

  function scrollRow(bvid) {
    if (!bvid || !E.list) { return; }
    if (!RR.route || RR.route() !== 'channel') { return; }
    var row = E.list.querySelector('.ch-row[data-bvid="' + String(bvid).replace(/"/g, '') + '"]');
    if (!row) { return; }
    var r = row.getBoundingClientRect();
    var topBar = 64;
    if (r.top < topBar || r.bottom > window.innerHeight - 110) {
      if (RR.scrollToEl) { RR.scrollToEl(row, 84); } else { try { row.scrollIntoView({ block: 'center' }); } catch (e) { } }
    }
  }

  function playProgram(bvid) {
    var seq = D.seq;
    if (!seq || !seq.length) { loadPrograms(false).then(function () { playProgram(bvid); }); return; }
    var idx = -1;
    for (var i = 0; i < seq.length; i++) { if (seq[i].bvid === bvid) { idx = i; break; } }
    if (idx < 0) { return; }
    setQueue(seq, idx);
    play(P.queue[idx], 0);
  }

  /* ============================================================
     七、面板（倍速 / 定时 / 队列）
     ============================================================ */
  function rateHint(r) {
    if (r < 1) { return '慢一点，听清每个字'; }
    if (r === 1) { return '原速'; }
    return '快一点，赶时间的时候';
  }

  function rowBtn(html, onPick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'sheet-row';
    b.innerHTML = html;
    b.addEventListener('click', onPick);
    return b;
  }

  function subHead(box, text, first) {
    var h = document.createElement('p');
    h.className = 'eyebrow';
    h.style.cssText = (first ? 'margin:2px 0 6px' : 'margin:16px 0 6px');
    h.textContent = text;
    box.appendChild(h);
  }

  /* 播放设置：倍速 / 清晰度 / 定时关闭（横屏、竖屏共用同一个面板） */
  function openRate() {
    var box = document.createElement('div');
    box.className = 'stack';
    subHead(box, '倍速', true);
    [0.5, 0.75, 1, 1.25, 1.5, 2].forEach(function (r) {
      box.appendChild(rowBtn(
        '<span class="sheet-row__t"><b class="num">' + fmtRate(r) + '</b><i>' + rateHint(r) + '</i></span>' +
        (Math.abs(r - P.rate) < .001 ? '<span class="badge">当前</span>' : ''),
        function () { setSpeed(r); sh.close(); }));
    });

    subHead(box, '清晰度');
    var curQn = +((RR.settings && RR.settings().qn) || 0);
    qualityList().forEach(function (q) {
      box.appendChild(rowBtn(
        '<span class="sheet-row__t"><b>' + esc(q.label) + '</b><i>' +
        (q.qn === curQn ? '正在用这一档' : esc(q.hint || '切过去会从当前位置接着播')) + '</i></span>' +
        (q.qn === curQn ? '<span class="badge">当前</span>' : ''),
        function () { sh.close(); setQuality(q.qn); }));
    });

    subHead(box, '定时关闭');
    [[0, '关'], [15, '15 分钟'], [30, '30 分钟'], [60, '1 小时'], [90, '1.5 小时']].forEach(function (o) {
      box.appendChild(rowBtn(
        '<span class="sheet-row__t"><b>' + o[1] + '</b><i>' +
        (o[0] ? '到点自动暂停播放' : '不自动暂停') + '</i></span>' +
        ((o[0] === P.sleepMin) ? '<span class="badge">当前</span>' : ''),
        function () { sleep(o[0]); sh.close(); }));
    });

    subHead(box, '画面');
    box.appendChild(rowBtn(
      '<span class="sheet-row__t"><b>悬浮窗</b><i>盖在别的 App 上方接着看；没权限时才退回画中画</i></span>',
      function () { sh.close(); pip(); }));
    box.appendChild(rowBtn(
      '<span class="sheet-row__t"><b>' + (P.locked ? '解锁画面' : '锁定画面') + '</b><i>防误触：锁住后点击不会换台</i></span>',
      function () { sh.close(); lock(!P.locked); }));

    var sh = RR.sheet({ title: '播放设置', body: box });
  }

  function openQueue() {
    if (!P.queue.length) {
      note('还没有可播的队列，先在节目带里点一期');
      return;
    }
    var box = document.createElement('div');
    var tip = document.createElement('p');
    tip.className = 'muted';
    tip.style.cssText = 'font-size:12px;margin:2px 0 8px';
    tip.textContent = '队列 · 共 ' + P.queue.length + ' 段，播完自动接下一期';
    box.appendChild(tip);

    var from = Math.max(0, P.qi - 1);
    var to = Math.min(P.queue.length, from + 40);
    for (var i = from; i < to; i++) {
      (function (idx) {
        var it = P.queue[idx];
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'sheet-row';
        var bits = [];
        if (it.category) { bits.push(it.category); }
        if (it.partsTotal > 1) { bits.push('第 ' + it.page + '/' + it.partsTotal + ' 段'); }
        if (it.dur) { bits.push(RR.fmtTime(it.dur)); }
        b.innerHTML = '<span class="sheet-row__t"><b class="truncate">' + esc(it.title) + '</b><i>' +
          esc(bits.join(' · ')) + '</i></span>' + (idx === P.qi ? '<span class="badge">正在</span>' : '');
        b.addEventListener('click', function () {
          sh.close();
          P.qi = idx;
          play(P.queue[idx], 0);
        });
        box.appendChild(b);
      })(i);
    }
    var sh = RR.sheet({ title: '队列', body: box });
  }

  /* ============================================================
     八、全屏
     ============================================================ */
  /* 覆盖层显隐：播放中 3.5s 没动静就淡出，单击唤出/收起。
     只动 opacity/transform，不动布局；暂停时永远可见。 */
  function uiPaint() {
    if (!root) { return; }
    var away = !!P.uiAway && !P.locked;
    root.classList.toggle('is-away', away);
    if (E.stage) { E.stage.classList.toggle('is-away', away); }
  }

  function uiShow() {
    P.uiAway = false;
    uiPaint();
    uiArm();
  }

  function uiHide() {
    if (P.locked) { return; }
    P.uiAway = true;
    clearTimeout(P.uiTimer);
    uiPaint();
  }

  function uiToggle() {
    if (P.uiAway) { uiShow(); } else { uiHide(); }
  }

  /* 3.5s 无操作自动淡出（只在整个画面在放、且没锁的时候） */
  function uiArm() {
    clearTimeout(P.uiTimer);
    if (inFs()) { return; }              /* 横屏的 3.5s 自动隐藏由手势层管 */
    if (!P.playing || P.locked || P.dragging) { return; }
    P.uiTimer = setTimeout(function () {
      if (!P.playing || P.locked || P.dragging) { return; }
      if (RR.sheetOpen && RR.sheetOpen()) { uiArm(); return; }
      P.uiAway = true;
      uiPaint();
    }, UI_AWAY);
  }

  /* 兼容旧调用名：全屏里「用户有动作 → 重新计时」也是同一个 uiShow() */
  function fsArm() { uiShow(); }

  function setFs(on) {
    on = !!on;
    if (P.fs === on) { return; }
    P.fs = on;
    if (!root) { return; }
    root.classList.toggle('is-fs', on);
    P.uiAway = false;
    uiPaint();
    document.body.style.overflow = on ? 'hidden' : '';
    if (E.fs) {
      E.fs.innerHTML = RR.ICO(on ? 'collapse' : 'expand');
      E.fs.setAttribute('aria-label', on ? '退出全屏' : '全屏播放');
    }
    var BR = window.AndroidRadio;
    if (BR && BR.setFullscreen) { try { BR.setFullscreen(on); } catch (e) { } }
    clearTimeout(P.fsTimer);
    if (on) { uiArm(); }
    setTimeout(function () { if (RR.danmaku && RR.danmaku.layout) { RR.danmaku.layout(); } }, 360);
    setTimeout(function () { if (RR.danmaku && RR.danmaku.layout) { RR.danmaku.layout(); } }, 950);
  }

  var prevExitFs = window.__rrExitFs;
  window.__rrExitFs = function () {
    if (P.fs) { setFs(false); return true; }
    return prevExitFs ? prevExitFs() : false;
  };

  /* ============================================================
     九、手势
     ============================================================ */
  var G = {
    id: null, x: 0, y: 0, t: 0, moved: false, longT: 0,
    boosting: false, ignore: false, locked: false
  };

  /* 事件挂在 document 的**捕获段**：谁在画面上叠了手势层都不影响单击/双击/长按，
     而且我们只按「点是否落在画面矩形里」判断，不依赖 e.target。 */
  function bindMedia() {
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onCancel, true);
    if (E.media) {
      E.media.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    }
  }

  /* 横屏/全屏的手势归 36-gesture（它在 #ch-media 上整段接管）；本内核只在自己
     掌管的竖屏里做单击/双击/长按。is-fs 由 35-fs 与 setFs 共同维护，两边都认。 */
  function inFs() { return !!(P.fs || (root && root.classList.contains('is-fs'))); }

  function mediaPoint(e) {
    if (!E.media) { return false; }
    var r = E.media.getBoundingClientRect();
    if (!r.width || !r.height) { return false; }
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  function onControl(e) {
    var t = e.target;
    if (!t || !t.closest) { return true; }
    if (t.closest('button,input,textarea,select,a[href],[role="slider"],[role="textbox"]')) { return true; }
    if (t.closest('.ch-body') || t.closest('#sheet') || t.closest('#scrim')) { return true; }
    return false;
  }

  function onDown(e) {
    if (e.button && e.button !== 0) { return; }
    if (!P.mounted || (RR.route && RR.route() !== 'channel')) { return; }
    if (RR.sheetOpen && RR.sheetOpen()) { return; }
    if (inFs()) { return; }              /* 横屏手势由 36-gesture 接管 */
    if (!mediaPoint(e)) { return; }
    if (onControl(e)) { G.ignore = true; return; }
    G.ignore = false;
    G.id = e.pointerId;
    G.x = e.clientX; G.y = e.clientY; G.t = Date.now();
    G.moved = false;
    clearTimeout(G.longT);
    if (!P.locked) {
      G.longT = setTimeout(function () {
        if (G.moved || P.locked || !P.playing || P.boost) { return; }
        boostOn();
        G.boosting = true;
      }, LONG_MS);
    }
    uiArm();
  }

  function onMove(e) {
    if (G.id !== e.pointerId) { return; }
    var dx = e.clientX - G.x, dy = e.clientY - G.y;
    if (dx * dx + dy * dy > 100) {
      G.moved = true;
      clearTimeout(G.longT);
      if (G.boosting) { boostOff(); G.boosting = false; }
    }
    uiArm();
  }

  function onUp(e) {
    if (G.ignore) { G.ignore = false; return; }
    if (G.id !== e.pointerId) { return; }
    if (inFs()) { clearTimeout(G.longT); if (G.boosting) { boostOff(); G.boosting = false; } G.id = null; return; }
    G.id = null;
    clearTimeout(G.longT);
    if (G.boosting) { boostOff(); G.boosting = false; return; }
    if (G.moved || Date.now() - G.t > 600) { return; }
    var r = E.media.getBoundingClientRect();
    var x = Math.max(0, Math.min(1, (e.clientX - r.left) / (r.width || 1)));
    var now = Date.now();
    var locked = P.locked;

    /* 锁屏：不换台、不暂停、不进度，只显隐那把锁 */
    if (locked) {
      lockHint();
      return;
    }

    if (now - P.lastTapAt < TAP_WIN) {
      clearTimeout(P.tapTimer);
      P.tapTimer = 0;
      P.lastTapAt = 0;
      if (!P.item) { toggle(); return; }
      if (x < .38) { jump(-10, '-10 秒'); }
      else if (x > .62) { jump(10, '+10 秒'); }
      else { toggle(); }
      uiShow();
      return;
    }
    P.lastTapAt = now;
    clearTimeout(P.tapTimer);
    P.tapTimer = setTimeout(function () {
      P.tapTimer = 0;
      P.lastTapAt = 0;
      /* 还没在放：点画面就是「开始听」 */
      if (!P.item) { toggle(); return; }
      uiToggle();
    }, 260);
  }

  function onCancel() {
    G.id = null;
    clearTimeout(G.longT);
    if (G.boosting) { boostOff(); G.boosting = false; }
  }

  /* ============================================================
     十、绑定 DOM
     ============================================================ */
  /* 进度条：跟手拖动 + 松手精确 seek。
     拖动期间：进度条只跟手指（paintTime 不抢），原生同步整体停摆，
     缩略图交给 RR.preview.openAt/close（没装这个模块就用本地气泡兜底）。 */
  function previewReady() { return !!(RR.preview && RR.preview.openAt); }

  function previewAttach() {
    if (P.previewBound) { return; }
    if (!RR.preview || !RR.preview.attach || !E.track) { return; }
    try { RR.preview.attach(E.track); P.previewBound = true; } catch (e) { }
  }

  function bindTrack() {
    var tr = E.track;
    if (!tr) { return; }
    var drag = null, lastPreviewAt = 0;

    function pctOf(e) {
      var r = tr.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / (r.width || 1)));
    }

    function paintDrag(pct) {
      if (E.fill) { E.fill.style.width = (pct * 100) + '%'; }
      if (E.knob) { E.knob.style.left = (pct * 100) + '%'; }
      if (E.elapsed) { E.elapsed.textContent = RR.fmtTime(pct * (P.dur || 0)); }
      if (E.track) {
        E.track.setAttribute('aria-valuenow', String(Math.round(pct * (P.dur || 0))));
        E.track.setAttribute('aria-valuetext', RR.fmtTime(pct * (P.dur || 0)) + ' / ' + RR.fmtTime(P.dur || 0));
      }
    }

    function bubble(pct) {
      if (!E.bubble) { return; }
      if (previewReady()) { E.bubble.hidden = true; return; }   /* 缩略图自带时间 */
      E.bubble.hidden = false;
      E.bubble.textContent = RR.fmtTime(pct * (P.dur || 0));
      var r = tr.getBoundingClientRect();
      E.bubble.style.left = Math.max(0, Math.min(r.width, pct * r.width)) + 'px';
    }

    function follow(e) {
      var pct = pctOf(e);
      paintDrag(pct);
      bubble(pct);
      /* 缩略图每秒最多取一帧，节流在 120ms，其余交给 preview 自己压 */
      var now = Date.now();
      if (now - lastPreviewAt > 120) {
        lastPreviewAt = now;
        if (previewReady()) {
          try { RR.preview.openAt(pct * (P.dur || 0)); } catch (er) { }
        }
      }
    }

    function endDrag(commit, e) {
      if (drag === null) { return; }
      drag = null;
      P.dragging = false;
      tr.classList.remove('is-dragging');
      if (E.bubble) { E.bubble.hidden = true; }
      if (previewReady()) { try { RR.preview.close(); } catch (er) { } }
      P.lastPaint = -1;
      if (commit && P.dur) { seek(pctOf(e) * P.dur); }
      else { paintTime(); }
      uiArm();
    }

    tr.addEventListener('pointerdown', function (e) {
      if (!P.item || !P.dur) { return; }
      if (e.button && e.button !== 0) { return; }
      drag = e.pointerId;
      P.dragging = true;
      tr.classList.add('is-dragging');
      try { tr.setPointerCapture(e.pointerId); } catch (er) { }
      previewAttach();
      e.preventDefault();
      e.stopPropagation();
      follow(e);
    });
    tr.addEventListener('pointermove', function (e) {
      if (drag !== e.pointerId) { return; }
      e.preventDefault();
      follow(e);
    });
    tr.addEventListener('pointerup', function (e) {
      if (drag !== e.pointerId) { return; }
      endDrag(true, e);
    });
    tr.addEventListener('pointercancel', function (e) {
      if (drag !== e.pointerId) { return; }
      endDrag(false, e);
    });
    tr.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); seek(position() - 5); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); seek(position() + 5); }
      else if (e.key === 'Home') { e.preventDefault(); seek(0); }
      else if (e.key === 'End') { e.preventDefault(); seek((P.dur || 0) - 1); }
    });
  }

  function bindVideo() {
    var v = E.video;
    if (!v) { return; }
    v.addEventListener('play', function () {
      P.stopped = false;
      P.applied = true;
      if (!P.playing) { P.playing = true; paintState(); }
    });
    v.addEventListener('playing', function () {
      P.playing = true; P.applied = true; P.loading = false; P.error = false; P.stopped = false; P.retries = 0;
      showLoading(false);
      unfreeze();                 /* 新的一帧已经上屏，定格画可以撤了 */
      stallPaint(false);
      paintState();
      paintTime();
      emitOnce(true);
      uiArm();
      if (RR.danmaku && P.item) {
        RR.danmaku.attach({ cid: P.item.cid, duration: P.dur || P.item.dur });
        RR.danmaku.resume();
      }
    });
    v.addEventListener('pause', function () {
      if (P.hidden) { return; }
      if (Date.now() < P.startingUntil) { return; }
      if (P.boost) { boostOff(); }
      if (!P.playing) { return; }        /* 状态没变：不写 DOM、不重发事件 */
      P.playing = false;
      P.applied = false;
      paintState();
      emitOnce(false);
      if (RR.danmaku) { RR.danmaku.pause(); }
      uiShow();
    });
    v.addEventListener('timeupdate', function () {
      if (document.hidden) { return; }
      var sec = Math.floor(+v.currentTime || 0);
      if (sec !== P.lastPaint) { paintTime(); }
    });
    v.addEventListener('loadedmetadata', function () {
      if (v.duration && isFinite(v.duration)) { P.dur = v.duration; }
      paintTime();
    });
    v.addEventListener('waiting', function () {
      if (P.playing) { P.loading = true; paintState(); }
    });
    v.addEventListener('canplay', function () {
      if (P.loading) { P.loading = false; showLoading(false); paintState(); }
      unfreeze();
    });
    v.addEventListener('loadeddata', function () {
      if (v.videoWidth) { unfreeze(); }   /* 有画面了就别再盖着定格帧 */
    });
    v.addEventListener('ended', onEnded);
    v.addEventListener('error', onMediaError);
  }

  function onMediaError() {
    if (!P.item || P.error) { return; }
    if (P.retries >= MAX_RETRY) { fail(); return; }
    P.retries++;
    var pos = position();
    showLoading(true);
    note('流断了，正在重取（' + P.retries + '/' + MAX_RETRY + '）');
    clearTimeout(P.retryTimer);
    P.retryTimer = setTimeout(function () {
      if (!P.item || P.token === 0) { return; }
      play(P.item, pos, true);
    }, 700 * P.retries);
  }

  function fail() {
    P.loading = false;
    P.playing = false;
    P.error = true;
    P.stopped = true;
    showLoading(false);
    showIdleError(P.item);
    paintState();
    note('这一期暂时取不到画面，点播放再试一次', 'err');
  }

  function bindKeys() {
    document.addEventListener('keydown', function (e) {
      if (!RR.route || RR.route() !== 'channel') { return; }
      if (RR.sheetOpen && RR.sheetOpen()) { return; }
      var t = e.target;
      var tag = (t && t.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (t && t.isContentEditable)) { return; }
      if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
        e.preventDefault(); toggle();
      } else if (e.key === 'ArrowLeft' || e.key === 'j' || e.key === 'J') {
        e.preventDefault(); jump(-10, '-10 秒');
      } else if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') {
        e.preventDefault(); jump(10, '+10 秒');
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault(); setFs(!P.fs);
      }
    });
  }

  function bindUi() {
    if (E.idlePlay) {
      E.idlePlay.addEventListener('click', function () {
        if (P.error && P.item) { play(P.item, position(), true); return; }
        var last = lastItem();
        if (last) { play(last, last.at || 0); return; }
        if (D.seq && D.seq.length) { setQueue(D.seq, 0); play(D.seq[0], 0); return; }
        loadPrograms(false).then(function () {
          if (D.seq && D.seq.length) { setQueue(D.seq, 0); play(D.seq[0], 0); }
        });
      });
    }
    if (E.toggle) { E.toggle.addEventListener('click', function () { toggle(); }); }
    if (E.back) { E.back.addEventListener('click', function () { jump(-10, '-10 秒'); }); }
    if (E.fwd) { E.fwd.addEventListener('click', function () { jump(10, '+10 秒'); }); }
    if (E.prev) { E.prev.addEventListener('click', function () { prev(); }); }
    if (E.next) { E.next.addEventListener('click', function () { next(); }); }
    if (E.queue) { E.queue.addEventListener('click', openQueue); }
    if (E.rate) { E.rate.addEventListener('click', openRate); }
    /* 8.0：标题旁的画质胶囊，点了只开画质面板 */
    if (E.qn) { E.qn.addEventListener('click', function (e) { e.preventDefault(); openQuality(); }); }
    if (E.lock) { E.lock.addEventListener('click', function () { lock(!P.locked); }); }
    if (E.shield) {
      /* 挡板只吞事件；显隐锁按钮交给 document 捕获段的 onUp 统一处理 */
      E.shield.addEventListener('click', function (e) { e.stopPropagation(); });
    }
    if (E.dm) {
      E.dm.addEventListener('click', function () {
        var on = !(RR.settings && RR.settings().dmOn !== false);
        if (RR.saveSettings) { RR.saveSettings({ dmOn: on }); }
        if (RR.danmaku) { RR.danmaku.setEnabled(on); }
        E.dm.setAttribute('aria-pressed', String(on));
        note(on ? '弹幕已开' : '弹幕已关');
      });
    }
    if (E.fs) { E.fs.addEventListener('click', function () { setFs(!P.fs); }); }
    if (E.retry) {
      E.retry.addEventListener('click', function () {
        if (emptyFn) { emptyFn(); } else { loadPrograms(true); }
      });
    }
    if (E.moreBtn) {
      E.moreBtn.addEventListener('click', function () { appendChunk(); });
    }
    if (E.filters) {
      E.filters.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('.chip') : null;
        if (!b) { return; }
        setFilter(b.getAttribute('data-filter'));
      });
    }
    if (E.list) {
      E.list.addEventListener('click', function (e) {
        var b = e.target.closest ? e.target.closest('.ch-row') : null;
        if (!b) { return; }
        playProgram(b.getAttribute('data-bvid'));
      });
    }
    if (root) {
      /* 任何操作都把覆盖层叫回来并重新计时（显隐本身由画面上的单击判定处理） */
      root.addEventListener('pointerdown', uiArm, { passive: true });
    }
  }

  function bindEvents() {
    RR.on('route', function (d) {
      var to = d && d.to;
      if (to !== 'channel') {
        if (P.fs) { setFs(false); }
        if (P.boost) { boostOff(); }
        /* 8.0 新口径：切视图**不停回放**（声音仲裁交给「直播开声 / 监控开声 / 用户停」），
           离开频道的画面由 js/31-mini.js 的小窗接着放。 */
        P.uiAway = false;
        uiPaint();
        if (P.locked) { lock(false, true); }   /* 离开频道自动解锁，回来不至于点不动 */
      } else if (P.mounted) {
        paintState(); paintTime(); markCurrent(); renderResume();
        uiShow();
        previewAttach();
        if (RR.danmaku) { RR.danmaku.enter(); }
      }
    });
    RR.on('station', function () {
      if (!P.mounted) { return; }
      var key = stationId();
      if (D.sid === key) { return; }          /* 同一主播的内部刷新：不动播放态 */
      var first = !D.sid;
      /* 首启时 loadStations 的事件早于 enter，别把「上次听到」清掉 */
      if (!first && P.last && String(P.last.station || '') !== key) { P.last = null; }
      if (!first) { resetPlayback(); }        /* 换主播：清 item/标题/进度/按钮，旧节目不许再响 */
      D.sid = key; D.loaded = false; D.eps = []; D.seq = []; D.error = null;
      renderResume();
      loadPrograms(true);
    });
    RR.on('settings', function (s) {
      if (!P.mounted) { return; }
      if (s && s.rate && Math.abs(s.rate - P.rate) > .001 && !P.boost) { applyRate(s.rate, false); }
      if (E.dm) { E.dm.setAttribute('aria-pressed', String(!s || s.dmOn !== false)); }
      if (RR.danmaku) { RR.danmaku.setEnabled(!s || s.dmOn !== false); }
      if (s && +s.sleep > 0 && !P.sleepAt) { armSleep(+s.sleep, true); }
      if (s) { P.qn = Math.max(0, Number(s.qn) || 0); paintQn(); }   /* 设置页改默认画质，标题旁跟着变 */
    });
    document.addEventListener('visibilitychange', function () {
      P.hidden = document.hidden;
      var v = E.video;
      if (!v) { return; }
      if (document.hidden) {
        keepNative(function () { if (!v.paused) { try { v.pause(); } catch (e) { } } });
      } else if (P.item && !P.stopped) {
        keepNative(function () {
          try { var p = v.play(); if (p && p.catch) { p.catch(noop); } } catch (e) { }
        });
      }
      if (RR.danmaku) { if (document.hidden) { RR.danmaku.pause(); } else if (P.playing) { RR.danmaku.resume(); } }
    });
  }

  /* ============================================================
     十一、生命周期
     ============================================================ */
  function mount() {
    if (P.mounted) { return; }
    root = document.getElementById('view-channel');
    var video = document.getElementById('player');
    if (!root || !video) { return; }

    E.stage = document.getElementById('ch-stage');
    E.media = document.getElementById('ch-media');
    E.video = video;
    E.poster = document.getElementById('ch-poster');
    E.idle = document.getElementById('ch-idle');
    E.idleLine = document.getElementById('ch-idle-line');
    E.idlePlay = document.getElementById('ch-idle-play');
    E.fs = document.getElementById('ch-fs');
    E.loading = document.getElementById('ch-loading');
    E.boost = document.getElementById('ch-boost');
    E.hint = document.getElementById('ch-hint');
    E.state = document.getElementById('ch-state');
    E.title = document.getElementById('np-title');
    E.meta = document.getElementById('ch-meta');
    E.elapsed = document.getElementById('ch-elapsed');
    E.track = document.getElementById('ch-track');
    E.buf = document.getElementById('ch-buf');
    E.fill = document.getElementById('ch-fill');
    E.knob = document.getElementById('ch-knob');
    E.bubble = document.getElementById('ch-bubble');
    E.dur = document.getElementById('ch-dur');
    E.back = document.getElementById('ch-back');
    E.toggle = document.getElementById('ch-toggle');
    E.fwd = document.getElementById('ch-fwd');
    E.dm = document.getElementById('ch-dm');
    E.rate = document.getElementById('ch-rate');
    E.rateLabel = document.getElementById('ch-rate-label');
    E.queue = document.getElementById('ch-queue');
    E.list = document.getElementById('ch-list');
    E.filters = document.getElementById('ch-filters');
    E.skel = document.getElementById('ch-skel');
    E.more = document.getElementById('ch-more');
    E.moreBtn = document.getElementById('ch-more-btn');
    E.empty = document.getElementById('ch-empty');
    E.emptyTtl = document.getElementById('ch-empty-ttl');
    E.emptySub = document.getElementById('ch-empty-sub');
    E.retry = document.getElementById('ch-retry');
    E.count = document.getElementById('ch-count');
    /* ---- 7.1 新增节点：定格帧 / 锁屏挡板与锁按钮 / 缓冲提示 / 上下期 ---- */
    E.hold = document.getElementById('ch-hold');
    E.shield = document.getElementById('ch-shield');
    E.lock = document.getElementById('ch-lock');
    E.stall = document.getElementById('ch-stall');
    E.stallTxt = document.getElementById('ch-stall-txt');
    E.prev = document.getElementById('ch-prev');
    E.next = document.getElementById('ch-next');
    /* ---- 8.0 新增：标题旁的画质胶囊 ---- */
    E.qn = document.getElementById('ch-qn');
    if (E.lock) { E.lock.setAttribute('data-state', 'unlocked'); }

    if (E.idlePlay) { E.idlePlayIco = E.idlePlay.firstElementChild; E.idlePlayTxt = E.idlePlay.lastElementChild; }

    P.mounted = true;
    buildToggle();                  /* 播放/暂停两个图标叠放，只建一次 */
    RR.iconize(root);
    video.muted = true;             /* 声音一律归原生（桥接也会再设一次） */
    video.preload = 'auto';
    applyRate((RR.settings && RR.settings().rate) || 1, false);
    if (E.dm && RR.settings) { E.dm.setAttribute('aria-pressed', String(RR.settings().dmOn !== false)); }
    P.last = RR.store ? RR.store.get('last', null) : null;

    P.qn = +((RR.settings && RR.settings().qn) || 0);
    bindUi();
    bindTrack();
    bindVideo();
    bindMedia();
    bindKeys();
    bindEvents();
    if (RR.danmaku) { RR.danmaku.mount(); }
    /* preview 模块比本文件晚加载：本轮先尝试挂一次，真正拖动时还会再试 */
    previewAttach();
    setTimeout(previewAttach, 0);

    renderResume();
    paintState();
    paintQn();
    paintTime();
    uiPaint();
    P.tickTimer = setInterval(tick, 700);
  }

  function enter() {
    if (!P.mounted) { mount(); }
    if (!P.mounted) { return; }
    if (RR.danmaku) { RR.danmaku.enter(); }
    paintState();
    paintQn();
    /* 回到频道：画面可能刚从小窗插回来（位置由 currentTime 唯一决定），强制按真实进度重画一次 */
    P.lastPaint = -1;
    paintTime();
    markCurrent();
    renderResume();
    previewAttach();
    if (!D.loaded && !D.loading) { loadPrograms(false); }
    if (RR.settings) {
      var sl = +RR.settings().sleep || 0;
      if (sl > 0 && !P.sleepAt) { armSleep(sl, true); }
      if (E.dm) { E.dm.setAttribute('aria-pressed', String(RR.settings().dmOn !== false)); }
      P.qn = +RR.settings().qn || 0;
    }
    if (!D.sid) { D.sid = stationId(); }
    /* 回到频道：覆盖层重新露出来（3.5s 后按播放态自动淡出） */
    P.uiAway = false;
    uiPaint();
    uiArm();
  }

  function leave() {
    if (P.togglePending) { commitToggle(); } else { cancelToggle(); }
    if (P.fs) { setFs(false); }
    if (P.boost) { boostOff(); }
    if (P.locked) { lock(false, true); }
    clearTimeout(G.longT);
    clearTimeout(P.tapTimer);
    clearTimeout(P.uiTimer);
    clearTimeout(P.lockTimer);
    P.tapTimer = 0;
    P.dragging = false;
    G.boosting = false;
    if (RR.preview && RR.preview.close) { try { RR.preview.close(); } catch (e) { } }
    P.uiAway = false;
    uiPaint();
    if (RR.danmaku) { RR.danmaku.leave(); }
  }

  function warm(item) {
    var it = normalize(item);
    if (!it) { return; }
    if (it.cid) { resolveMedia(it, false).catch(noop); }
    if (RR.danmaku && RR.danmaku.prefetch && it.cid) { RR.danmaku.prefetch(it.cid); }
    if (it.cover) {
      try { var img = new Image(); img.src = coverOf(it.cover); } catch (e) { }
    }
  }

  function audioState() {
    return {
      item: P.item, playing: P.playing, loading: P.loading, error: P.error,
      position: position(), duration: P.dur, rate: P.rate, key: P.item ? P.item.key : '',
      cid: P.item ? P.item.cid : '', bvid: P.item ? P.item.bvid : '',
      native: hasNative(), sleepMin: P.sleepMin, route: RR.route ? RR.route() : '',
      pending: P.togglePending,
      /* 7.1 追加（只加不改，弹幕/手势都靠这些） */
      locked: !!P.locked, uiAway: !!P.uiAway, stalled: !!P.stalled, buffering: !!P.loading,
      fs: !!P.fs, qn: P.qnActual || P.qn || ((RR.settings && RR.settings().qn) || 80), speed: P.rate,
      title: P.item ? P.item.title : '', dur: P.dur || 0, mediaUrl: P.mediaUrl,
      index: P.qi, count: P.queue.length,
      /* 8.0 追加：小窗靠 stopped 区分「用户暂停」与「真的停了」，暂停要保住小窗会话 */
      stopped: !!P.stopped, qnActual: P.qnActual || 0, accept: P.accept.slice(),
      canPrev: P.qi > 0 || position() > 5, canNext: P.qi + 1 < P.queue.length
    };
  }

  RR.player = {
    /* CONTRACT §5 必需 */
    play: play, playItemAt: playItemAt, toggle: toggle, stop: stop, seek: seek,
    /* 8.1：退后台悬浮窗 */
    nowPlaying: nowPlaying, syncNowPlaying: syncNowPlaying, overlay: tryOverlay,
    overlayAllowed: overlayAllowed,
    rate: rate, warm: warm, audioState: audioState, busy: function () { return !!P.loading; },
    /* 其它视图会顺手用到的 */
    mount: mount, enter: enter, leave: leave,
    pause: pause, resume: resume,
    setQueue: setQueue, current: function () { return P.item; },
    queue: function () { return P.queue.slice(); },
    isPlaying: function () { return !!P.playing; },
    time: position,
    setRate: function (r) { applyRate(r, true); },
    sleep: sleep, sleepMin: function () { return P.sleepMin; },
    fullscreen: function () { return P.fs; },
    setFullscreen: setFs,
    /* ---- 7.1 播放器契约新增 ---- */
    setSpeed: setSpeed, setQuality: setQuality,
    lock: lock, isLocked: isLocked,
    pip: pip, frameStep: frameStep, captureFrame: captureFrame,
    next: next, prev: prev,
    /* 队列/面板给手势和截图模块复用 */
    openSettings: openRate, openQueue: openQueue,
    freeze: freeze, unfreeze: unfreeze, stallState: function () { return !!P.stalled; },
    uiShow: uiShow, uiHide: uiHide, uiToggle: uiToggle,
    lockHint: lockHint, attachPreview: previewAttach,
    /* ---- 8.0 新增：清晰度入口 + 外部挪动播放器后的重画 ---- */
    openQuality: openQuality, qualityList: qualityList, qualityLabel: qnLabel,
    repaint: repaint
  };
  RR.view('channel', RR.player);

  /* 自己挂自己：90-boot 会再调一次 mount()，幂等 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { if (!P.mounted) { mount(); } });
  } else if (!P.mounted) {
    mount();
  }
})();
