/* ============================================================
   20-danmaku.js · 7.1 弹幕渲染引擎（单 canvas + rAF）
   - 数据：/api/dm?cid=<cid>&seg=<段>，每段 6 分钟，随播放预取下一段
   - 时间：优先 #player.currentTime；播放内核不驱动画面时自动切到
          RR.player.audioState().position（尽力兼容 7.1 新内核）
   - 设置：dmOn / dmOpacity / dmSpeed / dmSize / dmArea
           全部走 RR.saveSettings 持久化，渲染层实时跟着改，不重建 canvas
   - 性能：活跃硬上限 140 条；切页/切台/锁屏/隐藏时停 rAF
   - 发送：RR.danmaku.send(text) → POST /api/dm/send，成功后本地乐观插入
   只暴露 RR.danmaku（UI 在 21-dm-ui.js）；不碰 video 的 src/currentTime。
   ============================================================ */
(function () {
  'use strict';
  var RR = window.RR;
  if (!RR) { return; }

  var SEG = 360;                  /* 6 分钟一段 */
  var CACHE_MAX = 18;             /* 最多缓存 18 段 */
  var MAX_ACTIVE = 140;           /* 活跃弹幕硬上限 */
  var MAX_TEXT = 100;             /* 与后端限长一致 */
  var FONT_STACK = 'system-ui,-apple-system,"PingFang SC","Segoe UI","Microsoft YaHei",sans-serif';
  var AREAS = { all: 1, scroll: 1, top: 1, bottom: 1 };
  var AREA_LABEL = { all: '全屏', scroll: '滚动', top: '顶部', bottom: '底部' };
  var OWN_COLOR = 0xFFFFFF;       /* 自己的弹幕：白字 + 强调色药丸底 */
  var noop = function () { };

  var St = {
    mounted: false, building: 0, el: null, ctx: null, video: null, media: null, stage: null, root: null, ro: null,
    cid: '', bvid: '', dur: 0,
    on: true, op: .85, speedMul: 1, scale: 1, area: 'all',
    segs: {}, order: [], busy: {}, failed: {},
    raf: 0, lastT: -1, seg: -1, pending: [], pi: 0, active: [], own: [],
    W: 0, H: 0, dpr: 1, baseFont: 16, font: 16, laneH: 22, baseSpeed: 120,
    ls: [], lt: [], lb: [], lastFont: '',
    paused: false, hidden: false,
    clkSrc: 'video', clkAt: 0, clkVal: 0,
    frames: 0, fps: 0, fpsAt: 0,
    loginState: null, lastSend: null, lastOwn: null, lastError: ''
  };

  /* ---------- 小工具 ---------- */
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function num(v, def) { var n = Number(v); return isFinite(n) ? n : def; }
  function str(v) { return v == null ? '' : String(v); }
  function rootEl() { return document.getElementById('view-channel'); }
  function isFs() { var r = rootEl(); return !!(r && r.classList.contains('is-fs')); }
  function routeName() {
    try { if (RR.route) { return RR.route(); } } catch (e) { }
    return document.body ? document.body.dataset.route : '';
  }
  function settings() { try { return RR.settings ? RR.settings() : {}; } catch (e) { return {}; } }
  function audioState() {
    try {
      var p = RR.player && RR.player.audioState && RR.player.audioState();
      return (p && typeof p === 'object') ? p : null;
    } catch (e) { return null; }
  }
  function keyParts() {
    var v = St.video;
    var k = (v && v.dataset && v.dataset.key) || '';
    if (!k) { return ['', '']; }
    var i = k.indexOf('|');
    return i < 0 ? [k, ''] : [k.slice(0, i), k.slice(i + 1)];
  }
  function rowBvid() {
    var r = document.querySelector('#view-channel [data-bvid][aria-current="true"]') ||
      document.querySelector('#view-channel .ch-row.is-on[data-bvid]');
    return r ? str(r.getAttribute('data-bvid')) : '';
  }
  function fontOf(px) { return '600 ' + px + 'px ' + FONT_STACK; }
  function colorOf(n) {
    n = Number(n) || 0xFFFFFF;
    return '#' + ('000000' + (n & 0xFFFFFF).toString(16)).slice(-6);
  }
  function err(msg, code, cause) {
    var e = new Error(msg);
    e.code = code || '';
    e.cause = cause || null;
    return e;
  }

  /* ---------- 设置 ---------- */
  function normArea(a) { return AREAS[a] ? a : 'all'; }

  function readSettings() {
    var s = settings();
    St.on = s.dmOn !== false;
    St.op = clamp(num(s.dmOpacity, .85), 0, 1);
    St.speedMul = clamp(num(s.dmSpeed, 1), .5, 2);
    St.scale = clamp(num(s.dmSize, 1), .6, 1.8);
    St.area = normArea(s.dmArea);
    applyVisual();
    refreshMetrics();
  }

  function applyVisual() {
    if (!St.el) { return; }
    St.el.style.opacity = St.on ? String(St.op) : '0';
    St.el.style.visibility = St.on ? 'visible' : 'hidden';
  }

  function persist(patch) {
    if (!RR.saveSettings) { return; }
    var s = settings(), diff = false, k;
    for (k in patch) { if (s[k] !== patch[k]) { diff = true; } }
    if (!diff) { return; }
    try { RR.saveSettings(patch); } catch (e) { }
  }

  function refreshMetrics() {
    var w = St.W || 390;
    St.baseFont = w < 420 ? 15 : (w < 800 ? 17 : 19);
    St.font = clamp(Math.round(St.baseFont * St.scale), 11, 40);
    St.laneH = Math.round(St.font * 1.5);
    St.baseSpeed = Math.max(86, w / 7.4);
  }
  function speedNow() { return Math.max(40, St.baseSpeed * St.speedMul); }

  /* ---------- 画布 / 尺寸 ---------- */
  function ensureCanvas() {
    var root = rootEl();
    if (!root) { return false; }
    var media = document.getElementById('ch-media') || root.querySelector('.ch-media') || root.querySelector('#ch-stage') || root.querySelector('.ch-stage');
    var video = document.getElementById('player') || root.querySelector('video');
    if (!video || !media) { return false; }
    var stage = document.getElementById('ch-stage') || root.querySelector('.ch-stage') || (media.parentElement || root);
    var canvas = document.getElementById('dm-canvas') || root.querySelector('canvas.ch-dm');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.id = 'dm-canvas';
      canvas.className = 'ch-dm dm-canvas--auto';
      canvas.setAttribute('aria-hidden', 'true');
      media.appendChild(canvas);
    }
    var ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) { return false; }
    St.root = root; St.media = media; St.video = video; St.stage = stage;
    St.el = canvas; St.ctx = ctx;
    return true;
  }

  function measure() {
    if (!St.media || !St.el) { return; }
    var r = St.media.getBoundingClientRect();
    var w = Math.round(r.width), h = Math.round(r.height);
    if (w < 2 || h < 2) { return; }

    /* 全屏时 video 是 contain：把弹幕对齐到真正的画面矩形，不铺到黑边上 */
    var left = 0, top = 0;
    if (isFs() && St.video && St.video.videoWidth && St.video.videoHeight) {
      var ar = St.video.videoWidth / St.video.videoHeight;
      if (ar > w / h) { var hh = Math.round(w / ar); top = Math.round((h - hh) / 2); h = hh; }
      else { var ww = Math.round(h * ar); left = Math.round((w - ww) / 2); w = ww; }
    }

    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var resized = (w !== St.W || h !== St.H || dpr !== St.dpr);
    St.W = w; St.H = h; St.dpr = dpr;

    St.el.style.left = left + 'px';
    St.el.style.top = top + 'px';
    St.el.style.width = w + 'px';
    St.el.style.height = h + 'px';
    if (St.el.width !== Math.round(w * dpr) || St.el.height !== Math.round(h * dpr)) {
      St.el.width = Math.round(w * dpr);
      St.el.height = Math.round(h * dpr);
    }
    St.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    St.lastFont = '';
    refreshMetrics();
    if (resized || !St.ls.length) {
      lanes();
      resetAt(clock());
    }
  }

  function lanes() {
    var laneH = Math.max(14, St.laneH);
    var n = Math.max(1, Math.floor(St.H * .70 / laneH));
    var nt = Math.max(1, Math.min(4, Math.floor(St.H * .24 / laneH)));
    var nb = Math.max(1, Math.min(3, Math.floor(St.H * .26 / laneH)));
    St.ls = []; St.lt = []; St.lb = [];
    var i;
    for (i = 0; i < n; i++) { St.ls.push({ y: Math.round(laneH * (.62 + i)), free: 0 }); }
    for (i = 0; i < nt; i++) { St.lt.push({ y: Math.round(laneH * (.62 + i)), free: 0 }); }
    for (i = 0; i < nb; i++) { St.lb.push({ y: Math.round(St.H - laneH * (.55 + i)), free: 0 }); }
  }

  /* ---------- 时钟 ---------- */
  function videoTime() {
    var v = St.video;
    if (!v) { return NaN; }
    var t = +v.currentTime;
    return isFinite(t) ? t : NaN;
  }
  function playerTime() {
    var p = audioState();
    var t = p ? +p.position : NaN;
    return isFinite(t) ? t : NaN;
  }
  /* 两个时钟里挑“真的在走”的那个；稳定 0.8s 才切换，避免抖动 */
  function clock() {
    var vt = videoTime(), pt = playerTime(), now = Date.now();
    if (now - St.clkAt > 800) {
      var moved;
      if (isFinite(vt) && Math.abs(vt - St.clkVal) > .05) { moved = 'video'; }
      else if (isFinite(pt) && Math.abs(pt - St.clkVal) > .05) { moved = 'player'; }
      if (moved) { St.clkSrc = moved; St.clkVal = moved === 'video' ? vt : pt; }
      St.clkAt = now;
    }
    if (St.clkSrc === 'player' && isFinite(pt) && pt > 0) { return pt; }
    if (isFinite(vt) && vt > 0) { return vt; }
    if (isFinite(pt) && pt > 0) { return pt; }
    return 0;
  }

  function isPlaying() {
    var p = audioState();
    if (p && p.playing === true) { return true; }
    /* 播放内核还没回状态的那一帧，以画面是否在走为准 */
    return !!(St.video && !St.video.paused);
  }

  function shouldRun() {
    if (!St.mounted || !St.el || !St.ctx) { return false; }
    if (!St.on || !St.cid) { return false; }
    if (St.paused || St.hidden) { return false; }
    if (document.hidden) { return false; }
    if (routeName() !== 'channel') { return false; }
    return isPlaying();
  }

  /* ---------- 分段数据 ---------- */
  function keyOf(cid, seg) { return cid + '|' + seg; }
  function segOf(t) { return Math.floor(Math.max(0, t) / SEG); }

  function ensure(seg) {
    if (!St.cid || seg < 0) { return; }
    var k = keyOf(St.cid, seg);
    if (St.segs[k] || St.busy[k]) { return; }
    if (St.failed[k] && Date.now() - St.failed[k] < 15000) { return; }
    St.busy[k] = true;
    load(St.cid, seg, 0, function (res) {
      delete St.busy[k];
      if (!res) { St.failed[k] = Date.now(); return; }
      if (String(St.cid) !== String(res.cid)) { return; }   /* cid 已换，丢弃 */
      St.segs[k] = res.list;
      St.order.push(k);
      prune();
      if (seg === St.seg) { setPending(clock()); }
      kick();
    });
  }

  function load(cid, seg, tries, cb) {
    var url = '/api/dm?cid=' + encodeURIComponent(cid) + '&seg=' + seg;
    RR.api(url).then(function (d) {
      var list = normalize(d);
      cb({ cid: String(cid), seg: seg, list: list });
    }).catch(function () {
      if (tries < 1) { setTimeout(function () { load(cid, seg, tries + 1, cb); }, 1400); return; }
      cb(null);
    });
  }

  function normalize(d) {
    var raw = (d && (d.items || d.data || d.list)) || [];
    var out = [];
    for (var i = 0; i < raw.length; i++) {
      var it = raw[i], t, m, sz, c, x;
      if (!it) { continue; }
      if (Array.isArray(it)) { t = +it[0]; m = +it[1]; sz = +it[2]; c = +it[3]; x = it[4]; }
      else {
        t = +(it.progress == null ? it.t : it.progress);
        m = +(it.mode == null ? it.m : it.mode);
        sz = +(it.size == null ? it.s : it.size);
        c = +(it.color == null ? it.c : it.color);
        x = it.text == null ? it.content : it.text;
      }
      if (!x || !isFinite(t)) { continue; }
      /* /api/dm 的 progress 是毫秒（与 B 站一致） */
      t = t / 1000;
      if (t < 0) { continue; }
      if (!isFinite(sz) || sz <= 0) { sz = 18; }
      if (!isFinite(c)) { c = 0xFFFFFF; }
      out.push({ t: t, m: m || 1, s: sz, c: c, x: String(x) });
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  function prune() {
    while (St.order.length > CACHE_MAX) {
      var k = St.order.shift();
      if (k !== keyOf(St.cid, St.seg)) { delete St.segs[k]; }
    }
  }

  function lower(arr, t) {
    var lo = 0, hi = arr.length;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (arr[mid].t < t) { lo = mid + 1; } else { hi = mid; }
    }
    return lo;
  }

  function setPending(t) {
    var arr = St.segs[keyOf(St.cid, St.seg)];
    St.pending = arr || [];
    St.pi = arr ? lower(arr, Math.max(0, t - .3)) : 0;
  }

  function resetAt(t) {
    St.active.length = 0;
    St.own.length = 0;
    var i;
    for (i = 0; i < St.ls.length; i++) { St.ls[i].free = 0; }
    for (i = 0; i < St.lt.length; i++) { St.lt[i].free = 0; }
    for (i = 0; i < St.lb.length; i++) { St.lb[i].free = 0; }
    St.seg = segOf(t || 0);
    setPending(t || 0);
    ensure(St.seg);
    ensure(St.seg + 1);
  }

  /* ---------- 生成 ---------- */
  function areaAllows(mode) {
    if (St.area === 'all') { return true; }
    if (St.area === 'scroll') { return mode === 1; }
    if (St.area === 'top') { return mode === 5; }
    if (St.area === 'bottom') { return mode === 4; }
    return true;
  }
  function modeOf(it) { return it.m === 4 ? 4 : (it.m === 5 ? 5 : 1); }

  function pxFor(sz) { return clamp(Math.round(St.font * (sz >= 25 ? 1.12 : 1)), 11, 40); }

  function pick(arr, t) {
    if (!arr.length) { return null; }
    var best = null, i, l;
    for (i = 0; i < arr.length; i++) {
      l = arr[i];
      if (l.free <= t) { return l; }
      if (!best || l.free < best.free) { best = l; }
    }
    if (best && best.free <= t + .15) { return best; }   /* 最多提前 150ms 进同一条车道 */
    return null;
  }
  function freest(arr) {
    if (!arr.length) { return null; }
    var b = arr[0], i;
    for (i = 1; i < arr.length; i++) { if (arr[i].free < b.free) { b = arr[i]; } }
    return b;
  }

  function add(it, t0, force) {
    if (!St.ctx || St.active.length >= MAX_ACTIVE) { return null; }
    var mode = modeOf(it);
    if (!force && !areaAllows(mode)) { return null; }
    var px = pxFor(it.s);
    St.ctx.font = fontOf(px);
    St.lastFont = fontOf(px);
    var w = Math.ceil(St.ctx.measureText(it.x).width) || 1;
    /* 自己发的那条：一开始就整条可见（12px 贴着右边缘），别只露半截 */
    var off = force ? clamp(w + 12, 40, Math.round(St.W * .62)) : 0;
    var a = {
      x: it.x, s: it.s, c: it.c, px: px, w: w, t0: t0, mode: mode, lane: null, y: 0,
      dur: 4.2, off: off, mine: !!force
    };
    if (mode === 5) {
      var lt = force ? freest(St.lt) : pick(St.lt, t0);
      if (!lt) { return null; }
      a.lane = lt; a.y = lt.y; a.dur = 4.2;
      lt.free = t0 + a.dur + .15;
    } else if (mode === 4) {
      var lb = force ? freest(St.lb) : pick(St.lb, t0);
      if (!lb) { return null; }
      a.lane = lb; a.y = lb.y; a.dur = 4.2;
      lb.free = t0 + a.dur + .15;
    } else {
      var l = force ? freest(St.ls) : pick(St.ls, t0);
      if (!l) { return null; }
      a.lane = l; a.y = l.y;
      a.dur = (St.W + a.w + a.off) / speedNow();
      l.free = t0 + (a.w + 26) / speedNow();
    }
    St.active.push(a);
    return a;
  }

  function spawn(t) {
    var p = St.pending;
    if (!p || !p.length) { return; }
    var guard = 0;
    while (St.pi < p.length && p[St.pi].t <= t + .04 && guard++ < 40) {
      if (St.active.length >= MAX_ACTIVE) { return; }
      var it = p[St.pi];
      var mode = modeOf(it);
      if (!areaAllows(mode)) { St.pi++; continue; }
      if (it.t < t - 2.6) { St.pi++; continue; }
      St.pi++;
      /* 车道满了就丢掉这一条：不能因为一条顶部/底部弹幕挡住后面整段队列 */
      add(it, Math.max(t, it.t), false);
    }
  }

  /* ---------- 绘制 ---------- */
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawOne(ctx, a, x, y, alpha) {
    if (a.mine) {
      var pad = 6, bh = a.px + 6;
      ctx.globalAlpha = alpha * .78;
      ctx.fillStyle = 'rgba(11,87,208,.62)';
      roundRect(ctx, x - pad, y - bh / 2, a.w + pad * 2, bh, bh / 2);
      ctx.fill();
    }
    var fs = fontOf(a.px);
    if (St.lastFont !== fs) { ctx.font = fs; St.lastFont = fs; }
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(2, Math.round(a.px * .14));
    ctx.strokeStyle = 'rgba(6,8,11,.62)';
    ctx.strokeText(a.x, x, y);
    ctx.fillStyle = a.mine ? '#FFFFFF' : colorOf(a.c);
    ctx.fillText(a.x, x, y);
    ctx.globalAlpha = 1;
  }

  function draw(t) {
    var ctx = St.ctx;
    if (!ctx) { return; }
    ctx.clearRect(0, 0, St.W, St.H);
    if (!St.on) { St.active.length = 0; return; }
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    St.lastFont = '';
    var keep = [], i, a, age, x, alpha;
    var sp = speedNow();
    for (i = 0; i < St.active.length; i++) {
      a = St.active[i];
      age = t - a.t0;
      if (age < -.05) { keep.push(a); continue; }
      if (a.mode === 1) {
        x = St.W - a.off - age * sp;
        if (x + a.w < -2) { continue; }
        drawOne(ctx, a, x, a.y, 1);
        keep.push(a);
      } else {
        if (age > a.dur) { continue; }
        alpha = age > a.dur - .5 ? Math.max(0, (a.dur - age) / .5) : 1;
        x = Math.round((St.W - a.w) / 2);
        drawOne(ctx, a, x, a.y, alpha);
        keep.push(a);
      }
    }
    St.active = keep;
    ctx.globalAlpha = 1;
  }

  function renderOnce(t) {
    if (!St.ctx) { return; }
    draw(isFinite(t) ? t : clock());
  }

  /* ---------- 循环 ---------- */
  function countFps() {
    St.frames++;
    var now = performance.now();
    if (!St.fpsAt) { St.fpsAt = now; }
    if (now - St.fpsAt >= 500) {
      St.fps = Math.round(St.frames * 1000 / (now - St.fpsAt));
      St.frames = 0; St.fpsAt = now;
    }
  }

  function tick() {
    var t = clock();
    /* 大跳（seek / 换台 / 卡顿恢复）直接重排，避免一次性倒出整段 */
    if (St.lastT >= 0 && Math.abs(t - St.lastT) > 1.2) { resetAt(t); }
    St.lastT = t;
    var seg = segOf(t);
    if (seg !== St.seg) {
      St.seg = seg;
      setPending(t);
      ensure(seg); ensure(seg + 1);
    }
    spawn(t);
    draw(t);
    countFps();
  }

  function frame() {
    St.raf = 0;
    if (!shouldRun()) { return; }
    tick();
    if (shouldRun()) { schedule(); }
  }

  function schedule() {
    if (St.raf || !shouldRun()) { return; }
    St.raf = requestAnimationFrame(frame);
  }
  function stopLoop() {
    if (St.raf) { cancelAnimationFrame(St.raf); St.raf = 0; }
  }
  function kick() {
    if (!shouldRun()) { return; }
    schedule();
  }

  /* ---------- 暂停 / 恢复 / 清理 ---------- */
  function pause() {
    St.paused = true;
    stopLoop();
  }

  function resume() {
    St.paused = false;
    St.hidden = false;
    St.lastT = -1;
    resetAt(clock());
    renderOnce(clock());
    kick();
  }

  function clear() {
    St.active.length = 0;
    St.own.length = 0;
    renderOnce(clock());
  }

  function leave() {
    stopLoop();
    St.paused = true;
    clear();
  }

  /* ---------- 视频事件 ---------- */
  function onVideo(e) {
    var type = e && e.type;
    if (type === 'play' || type === 'playing') {
      St.paused = false;
      St.lastT = -1;
      resetAt(clock());
      kick();
    } else if (type === 'pause') {
      pause();
    } else if (type === 'seeking') {
      St.lastT = -1;
    } else if (type === 'seeked') {
      St.lastT = -1;
      resetAt(clock());
      renderOnce(clock());
      kick();
    } else if (type === 'ended' || type === 'emptied') {
      stopLoop();
      clear();
    } else if (type === 'loadedmetadata') {
      measure();
    }
  }

  function onResize() { measure(); }

  function onVisibility() {
    St.hidden = !!document.hidden;
    if (St.hidden) {
      stopLoop();
    } else {
      St.lastT = -1;
      renderOnce(clock());
      kick();
    }
  }

  /* ---------- 生命周期 ---------- */
  function mount() {
    if (St.mounted) { return; }
    if (!rootEl()) {
      St.building++;
      if (St.building < 20) { setTimeout(mount, 300); }
      return;
    }
    if (!ensureCanvas()) {
      St.building++;
      if (St.building < 20) { setTimeout(mount, 300); }
      return;
    }
    St.mounted = true;
    St.building = 0;
    readSettings();
    measure();

    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('orientationchange', onResize, { passive: true });
    if (window.ResizeObserver) {
      try { St.ro = new ResizeObserver(onResize); St.ro.observe(St.media); } catch (e) { }
    }
    ['play', 'playing', 'pause', 'seeking', 'seeked', 'ended', 'emptied', 'loadedmetadata'].forEach(function (ev) {
      St.video.addEventListener(ev, onVideo);
    });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', stopLoop);
    RR.on('route', onRoute);
    RR.on('settings', onSettings);
    RR.on('station', onStation);
    RR.on('playing', onPlaying);
    RR.on('dm-area', function (a) { setArea(a); });
    RR.on('dm-speed', function (v) { setSpeed(v); });
    RR.on('dm-size', function (v) { setSize(v); });
    RR.on('dm-opacity', function (v) { setOpacity(v); });
  }

  function onRoute(d) {
    var to = d && d.to;
    if (to === 'channel') {
      if (!St.mounted) { mount(); }
      measure();
      var p = audioState();
      if (p && p.playing) { resume(); } else { renderOnce(clock()); }
    } else {
      leave();
    }
  }

  function onSettings() {
    var before = { scale: St.scale, speed: St.speedMul, area: St.area, on: St.on };
    readSettings();
    if (St.scale !== before.scale) { relayoutActive(); }
    if (St.speedMul !== before.speed) { retime(before.speed); }
    if (St.area !== before.area) { filterArea(); }
    if (!St.on) {
      St.active.length = 0; St.own.length = 0;
      stopLoop();
      renderOnce(clock());
      return;
    }
    renderOnce(clock());
    kick();
  }

  function onStation() {
    /* 切台：旧弹幕立即停，等新的一期 attach 后再起 */
    detach();
  }

  function onPlaying(d) {
    if (!d) { return; }
    if (d.item) {
      attach({
        cid: d.item.cid, bvid: d.item.bvid,
        duration: d.duration || d.item.dur || 0, title: d.item.title
      });
    }
    if (d.playing) { resume(); } else { pause(); }
  }

  function attach(info) {
    if (!St.mounted && !ensureCanvas()) { return; }
    if (!St.mounted) { mount(); }
    if (!St.el) { return; }
    info = info || {};
    var p = audioState() || {};
    var parts = keyParts();
    var cid = str(info.cid || p.cid || (p.item && p.item.cid) || parts[1]);
    var bvid = str(info.bvid || p.bvid || (p.item && p.item.bvid) || parts[0] || rowBvid());
    if (!cid) { detach(); return; }
    if (cid !== St.cid) {
      St.cid = cid;
      St.bvid = bvid;
      St.segs = {}; St.order = []; St.busy = {}; St.failed = {};
      St.pending = []; St.pi = 0; St.seg = -1; St.lastT = -1;
      St.active.length = 0; St.own.length = 0;
      for (var li = 0; li < St.ls.length; li++) { St.ls[li].free = 0; }
      for (li = 0; li < St.lt.length; li++) { St.lt[li].free = 0; }
      for (li = 0; li < St.lb.length; li++) { St.lb[li].free = 0; }
      St.clkAt = 0; St.clkVal = 0;
    } else if (bvid && !St.bvid) {
      St.bvid = bvid;
    }
    if (info.duration) { St.dur = +info.duration || 0; }
    readSettings();
    measure();
    St.paused = false;
    var t = clock();
    St.seg = segOf(t);
    setPending(t);
    ensure(St.seg); ensure(St.seg + 1);
    renderOnce(t);
    kick();
  }

  function detach() {
    St.cid = '';
    St.pending = [];
    St.pi = 0;
    St.seg = -1;
    St.lastT = -1;
    stopLoop();
    St.active.length = 0;
    St.own.length = 0;
    renderOnce(clock());
  }

  function enter() {
    if (!St.mounted) { mount(); }
    readSettings();
    measure();
    St.paused = false;
    var p = audioState();
    if (!St.cid && p && p.cid) {
      attach({ cid: p.cid, bvid: p.bvid, duration: p.duration });
      return;
    }
    if (!St.cid) { St.cid = str((audioState() || {}).cid || keyParts()[1]); }
    if (St.cid) {
      St.seg = segOf(clock());
      ensure(St.seg); ensure(St.seg + 1);
    }
    if (isPlaying()) { resume(); } else { renderOnce(clock()); }
  }

  function prefetch(cid) {
    if (!cid) { return; }
    var k = keyOf(String(cid), 0);
    if (St.segs[k] || St.busy[k]) { return; }
    St.busy[k] = true;
    load(String(cid), 0, 0, function (res) {
      delete St.busy[k];
      if (res && res.list) { St.segs[k] = res.list; St.order.push(k); prune(); }
    });
  }

  /* ---------- 设置入口（全部写 RR.saveSettings） ---------- */
  function setEnabled(on, save) {
    on = !!on;
    var changed = St.on !== on;
    St.on = on;
    applyVisual();
    if (save !== false) { persist({ dmOn: on }); }
    if (!on) {
      St.active.length = 0; St.own.length = 0;
      stopLoop();
      renderOnce(clock());
    } else if (changed) {
      St.lastT = -1;
      if (St.cid) { resetAt(clock()); }
      kick();
    }
    return St.on;
  }

  function setOpacity(v, save) {
    St.op = clamp(num(v, .85), 0, 1);
    applyVisual();
    if (save !== false) { persist({ dmOpacity: St.op }); }
    return St.op;
  }

  function setSpeed(v, save) {
    var next = clamp(num(v, 1), .5, 2);
    var old = St.speedMul;
    if (Math.abs(next - old) < 1e-6) {
      if (save !== false) { persist({ dmSpeed: next }); }
      return St.speedMul;
    }
    St.speedMul = next;
    var t = retime(old);
    if (save !== false) { persist({ dmSpeed: next }); }
    renderOnce(t);
    return St.speedMul;
  }

  /* 变速：按“已走里程”反推新的出生时间，画面不跳；并重算车道占用 */
  function retime(old) {
    var t = clock();
    if (old > 0 && old !== St.speedMul) {
      var scale = old / St.speedMul, i;
      for (i = 0; i < St.active.length; i++) {
        var a = St.active[i];
        if (a.mode === 1) { a.t0 = t - (t - a.t0) * scale; }
      }
      for (i = 0; i < St.ls.length; i++) { St.ls[i].free = 0; }
      for (i = 0; i < St.active.length; i++) {
        var b = St.active[i];
        if (b.mode === 1 && b.lane) {
          var lane = null, j;
          for (j = 0; j < St.ls.length; j++) { if (St.ls[j] === b.lane) { lane = St.ls[j]; break; } }
          if (lane) { lane.free = Math.max(lane.free, b.t0 + (b.w + 26) / speedNow()); }
        }
      }
    }
    return t;
  }

  function setSize(v, save) {
    var next = clamp(num(v, 1), .6, 1.8);
    if (Math.abs(next - St.scale) < 1e-6) {
      if (save !== false) { persist({ dmSize: next }); }
      return St.scale;
    }
    St.scale = next;
    relayoutActive();
    if (save !== false) { persist({ dmSize: next }); }
    renderOnce(clock());
    return St.scale;
  }

  /* 字号变化：不重建 canvas，只改字体度量；已经在飞的那几条也按新字号重排宽度 */
  function relayoutActive() {
    refreshMetrics();
    if (St.ctx) {
      for (var i = 0; i < St.active.length; i++) {
        var a = St.active[i];
        a.px = pxFor(a.s);
        St.ctx.font = fontOf(a.px);
        a.w = Math.ceil(St.ctx.measureText(a.x).width) || 1;
        if (a.mode === 1) { a.dur = (St.W + a.w + a.off) / speedNow(); }
      }
      St.lastFont = '';
    }
    reshapeLanes();
  }

  /* 字号变化只改车道几何，不推倒重来（free 占用保留，避免新弹幕撞进旧车道） */
  function fitLanes(arr, count, yOf) {
    while (arr.length < count) { arr.push({ y: 0, free: 0 }); }
    while (arr.length > count) { arr.pop(); }
    for (var i = 0; i < count; i++) { arr[i].y = Math.round(yOf(i)); }
  }
  function reshapeLanes() {
    var laneH = Math.max(14, St.laneH), H = St.H;
    if (!H) { return; }
    var n = Math.max(1, Math.floor(H * .70 / laneH));
    var nt = Math.max(1, Math.min(4, Math.floor(H * .24 / laneH)));
    var nb = Math.max(1, Math.min(3, Math.floor(H * .26 / laneH)));
    fitLanes(St.ls, n, function (i) { return laneH * (.62 + i); });
    fitLanes(St.lt, nt, function (i) { return laneH * (.62 + i); });
    fitLanes(St.lb, nb, function (i) { return H - laneH * (.55 + i); });
  }

  function setArea(a, save) {
    var next = normArea(a);
    var changed = St.area !== next;
    St.area = next;
    if (changed) { filterArea(); renderOnce(clock()); }
    if (save !== false) { persist({ dmArea: next }); }
    return St.area;
  }

  function filterArea() {
    var keep = [];
    for (var i = 0; i < St.active.length; i++) {
      if (areaAllows(St.active[i].mode)) { keep.push(St.active[i]); }
    }
    St.active = keep;
    St.lastT = -1;
    if (St.cid) { setPending(clock()); }
  }

  /* ---------- 发送 ---------- */
  function resolveIds() {
    var p = audioState() || {};
    var parts = keyParts();
    var bvid = str(p.bvid || (p.item && p.item.bvid) || parts[0] || rowBvid());
    var cid = str(p.cid || (p.item && p.item.cid) || parts[1]);
    return { bvid: bvid, cid: cid };
  }

  function insertOwn(text, sec, mode) {
    if (!St.on) { return null; }
    var t = clock();
    var it = { t: t, m: mode || 1, s: 25, c: OWN_COLOR, x: text };
    if (St.active.length >= MAX_ACTIVE) { St.active.shift(); }
    var a = add(it, t, true);
    if (a) {
      a.mine = true;
      St.own.push(a);
      if (St.own.length > 20) { St.own.shift(); }
      St.lastOwn = { text: text, at: Date.now(), mode: mode || 1, sec: sec };
    }
    renderOnce(clock());
    kick();
    return a;
  }

  function send(text, opts) {
    opts = opts || {};
    text = str(text).replace(/\s+$/, '').replace(/^\s+/, '');
    if (!text) { return Promise.reject(err('先写点什么再发', 'empty')); }
    if (text.length > MAX_TEXT) { text = text.slice(0, MAX_TEXT); }
    var ids = resolveIds();
    if (!ids.bvid || !ids.cid) {
      return Promise.reject(err('先在频道里播一期，再发弹幕', 'no-item'));
    }
    var sec = opts.sec == null ? clock() : +opts.sec;
    if (!isFinite(sec) || sec < 0) { sec = 0; }
    if (St.dur && sec > St.dur) { sec = St.dur; }
    var mode = +opts.mode || 1;
    var body = {
      bvid: ids.bvid, cid: ids.cid, text: text,
      progress: Math.round(sec * 1000), mode: mode
    };
    return RR.post('/api/dm/send', body).then(function (d) {
      if (d && d.ok === false) { throw err((d && d.error) || '弹幕没发出去', 'send-fail'); }
      St.loginState = true;
      St.lastSend = {
        at: Date.now(), bvid: ids.bvid, cid: ids.cid, text: text,
        progress: body.progress, sec: sec, mode: mode, ok: true
      };
      var shown = insertOwn(text, sec, mode);
      St.lastSend.shown = !!shown;
      try { RR.emit('dm-sent', { text: text, sec: sec, mode: mode, shown: !!shown }); } catch (e) { }
      return { ok: true, text: text, progress: body.progress, sec: sec, mode: mode, shown: !!shown };
    }).catch(function (e) {
      var msg = str(e && e.message);
      var need = (e && (e.status === 401 || e.status === 403)) ||
        /登录|扫码|csrf|SESSDATA|not\s*login/i.test(msg);
      if (need) {
        St.loginState = false;
        St.lastError = 'need-login';
        throw err('先在设置里扫码登录', 'need-login', e);
      }
      var human = msg && !/请求失败|Failed to fetch|network|加载失败/i.test(msg)
        ? msg : '弹幕没发出去，稍后再试';
      St.lastError = human;
      St.lastSend = { at: Date.now(), text: text, ok: false, error: human };
      throw err(human, 'send-fail', e);
    });
  }

  function status() {
    var modes = { scroll: 0, top: 0, bottom: 0 };
    for (var mi = 0; mi < St.active.length; mi++) {
      var mm = St.active[mi].mode;
      modes[mm === 5 ? 'top' : (mm === 4 ? 'bottom' : 'scroll')]++;
    }
    return {
      mounted: St.mounted, cid: St.cid, bvid: St.bvid, dur: St.dur,
      modes: modes,
      lanes: { scroll: St.ls.length, top: St.lt.length, bottom: St.lb.length },
      on: St.on, opacity: St.op, speed: St.speedMul, size: St.scale, area: St.area,
      areaLabel: AREA_LABEL[St.area] || '全屏',
      seg: St.seg, active: St.active.length, cap: MAX_ACTIVE,
      own: St.own.length, cached: St.order.length,
      font: St.font, laneH: St.laneH, speedPx: Math.round(speedNow()),
      fps: St.fps, paused: St.paused, hidden: St.hidden,
      clock: Math.round(clock() * 100) / 100, clockSrc: St.clkSrc,
      loginState: St.loginState, lastSend: St.lastSend, lastError: St.lastError,
      canvas: St.el ? { w: St.el.width, h: St.el.height, cssW: St.W, cssH: St.H, dpr: St.dpr } : null
    };
  }

  RR.danmaku = {
    /* 生命周期（90-boot / player 调用，幂等） */
    mount: mount, enter: enter, leave: leave,
    /* 与播放内核的接口 */
    attach: attach, detach: detach, pause: pause, resume: resume,
    /* 契约导出的设置项 */
    setEnabled: setEnabled, setOpacity: setOpacity, setSpeed: setSpeed,
    setSize: setSize, setArea: setArea,
    /* 发送 */
    send: send,
    /* 兼容旧调用 */
    toggle: function () { return setEnabled(!St.on); },
    clear: clear, prefetch: prefetch, layout: measure, status: status,
    openSettings: function () { if (RR.dmUI && RR.dmUI.openSettings) { RR.dmUI.openSettings(); } }
  };

  /* 自己挂自己：脚本在 body 末尾，DOM 已就绪；视图若还没渲染会重试 */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
