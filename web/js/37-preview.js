/* ============================================================
   37-preview.js · 进度条拖拽缩略图（RR.preview）
   契约：attach(rulerEl) / openAt(sec) / close()
   做法：另起一个隐藏 <video>（同源 /api/stream 可直接 drawImage），
        seek 到目标时间 → seeked + 一帧呈现后 drawImage 到 160×90 canvas；
        节流 1s 最多取一帧；拖动结束取消在途取样、暂停并复位取样器。
   边界：不碰主 video 的 src / currentTime；取样器永远 muted 且从不 play()。
   与 core 协作：core 拖进度条时调 openAt(sec)/close() 也成立（幂等、同一状态机）；
        attach() 自己也会监听指针，两条路不会打架。
   ============================================================ */
(function () {
  'use strict';
  var RR = window.RR;
  if (!RR) { return; }

  var W = 160, H = 90;          /* 缩略图规格（契约 §4） */
  var THROTTLE = 1000;          /* 每 1s 最多取一帧 */
  var SEEK_TIMEOUT = 2600;
  var LOAD_TIMEOUT = 7000;

  var S = {
    ruler: null, bound: false,
    bubble: null, cv: null, ctx: null, ph: null, tEl: null, bw: 0, bh: 0,
    sampler: null, src: '', loadP: null,
    open: false, dur: 0, sec: 0, hasFrame: false,
    pending: null, busy: false, lastAt: 0, timer: 0, hideT: 0, gen: 0,
    dragId: null
  };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function now() { return Date.now(); }
  function videoEl() { return document.getElementById('player'); }

  function duration() {
    var v = videoEl(), d = 0;
    if (v && isFinite(v.duration) && v.duration > 0) { d = v.duration; }
    if (!d && RR.player && typeof RR.player.audioState === 'function') {
      try { d = Number(RR.player.audioState().duration) || 0; } catch (e) { d = 0; }
    }
    return d > 0 ? d : 0;
  }

  function mainSrc() {
    var v = videoEl();
    if (!v) { return ''; }
    return v.currentSrc || v.src || v.getAttribute('src') || '';
  }

  /* ---------- 气泡 DOM ---------- */
  function build() {
    if (S.bubble) { return S.bubble; }
    var b = RR.el('div', 'rr-prev');
    b.id = 'rr-prev';
    b.hidden = true;
    b.setAttribute('aria-hidden', 'true');

    var card = RR.el('div', 'rr-prev__card');
    var frame = RR.el('div', 'rr-prev__frame');
    var cv = document.createElement('canvas');
    cv.className = 'rr-prev__cv';
    cv.width = W; cv.height = H;
    var ph = RR.el('span', 'rr-prev__ph');
    ph.textContent = '取帧中…';
    var t = RR.el('span', 'rr-prev__t');
    t.textContent = '0:00';

    frame.appendChild(cv);
    frame.appendChild(ph);
    card.appendChild(frame);
    card.appendChild(t);
    b.appendChild(card);
    document.body.appendChild(b);

    S.bubble = b; S.cv = cv; S.ctx = cv.getContext('2d'); S.ph = ph; S.tEl = t;
    return b;
  }

  function showPh(txt) {
    if (!S.ph) { return; }
    S.ph.textContent = txt;
    S.ph.hidden = false;
  }

  function clearFrame() {
    S.hasFrame = false;
    if (S.ctx) { try { S.ctx.clearRect(0, 0, W, H); } catch (e) { } }
    showPh('取帧中…');
  }

  /* 气泡跟随：横向对准目标时间，纵向贴在进度条上方（上方放不下就翻到下方） */
  function place(sec) {
    var b = S.bubble;
    if (!b) { return; }
    if (!S.bw) { S.bw = b.offsetWidth || 176; S.bh = b.offsetHeight || 127; }
    var w = S.bw, h = S.bh;
    var r = S.ruler && S.ruler.getBoundingClientRect ? S.ruler.getBoundingClientRect() : null;
    var x, y;
    if (r && r.width > 0) {
      var pct = S.dur ? clamp(sec / S.dur, 0, 1) : 0;
      x = r.left + pct * r.width;
      y = r.top - h - 10;
      if (y < 8) { y = Math.min(window.innerHeight - h - 8, r.bottom + 12); }
    } else {
      x = window.innerWidth / 2;
      y = window.innerHeight * 0.62;
    }
    var left = clamp(x - w / 2, 8, Math.max(8, window.innerWidth - w - 8));
    var top = clamp(y, 8, Math.max(8, window.innerHeight - h - 8));
    b.style.left = Math.round(left) + 'px';
    b.style.top = Math.round(top) + 'px';
  }

  /* ---------- 隐藏取样器 ---------- */
  function createSampler() {
    var v = document.createElement('video');
    v.className = 'rr-prev__sampler';
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('webkit-playsinline', '');
    v.setAttribute('aria-hidden', 'true');
    v.tabIndex = -1;
    v.addEventListener('error', function () { S.loadP = null; });
    document.body.appendChild(v);
    S.sampler = v;
    return v;
  }

  function ensureSampler() {
    var src = mainSrc();
    if (!src) { return Promise.reject(new Error('nosrc')); }
    var v = S.sampler || createSampler();

    if (S.src !== src) {
      S.src = src;
      S.loadP = null;
      v.src = src;
      try { v.load(); } catch (e) { }
    }
    if (v.readyState >= 2) { return Promise.resolve(v); }
    if (S.loadP) { return S.loadP; }

    S.loadP = new Promise(function (res, rej) {
      var to = 0, done = false;
      function fin(ok) {
        if (done) { return; }
        done = true;
        clearTimeout(to);
        v.removeEventListener('loadeddata', check);
        v.removeEventListener('canplay', check);
        v.removeEventListener('error', onErr);
        S.loadP = null;
        if (ok) { res(v); } else { rej(new Error('load')); }
      }
      function check() { if (v.readyState >= 2) { fin(true); } }
      function onErr() { fin(false); }
      v.addEventListener('loadeddata', check);
      v.addEventListener('canplay', check);
      v.addEventListener('error', onErr);
      to = setTimeout(function () { fin(v.readyState >= 2); }, LOAD_TIMEOUT);
      check();
    });
    return S.loadP;
  }

  function seekTo(v, sec) {
    var d = v.duration;
    if (isFinite(d) && d > 0) { sec = Math.min(sec, Math.max(0, d - 0.08)); }
    sec = Math.max(0, sec);
    if (v.readyState >= 2 && Math.abs((v.currentTime || 0) - sec) < 0.004) {
      return Promise.resolve();
    }
    return new Promise(function (res, rej) {
      var to = 0, done = false;
      function fin(ok, err) {
        if (done) { return; }
        done = true;
        clearTimeout(to);
        v.removeEventListener('seeked', onSeeked);
        v.removeEventListener('error', onErr);
        if (ok) { res(); } else { rej(err || new Error('seek')); }
      }
      function onSeeked() { fin(true); }
      function onErr() { fin(false, new Error('media')); }
      v.addEventListener('seeked', onSeeked);
      v.addEventListener('error', onErr);
      to = setTimeout(function () { fin(false, new Error('timeout')); }, SEEK_TIMEOUT);
      try { v.currentTime = sec; } catch (e) { fin(false, e); }
    });
  }

  /* seeked 之后等「这一帧真的呈现出来」，drawImage 才不会拿到上一帧 */
  function frameReady(v) {
    return new Promise(function (res) {
      var to = 0, done = false;
      function fin() {
        if (done) { return; }
        done = true;
        clearTimeout(to);
        res();
      }
      to = setTimeout(fin, 320);
      if (typeof v.requestVideoFrameCallback === 'function') {
        try { v.requestVideoFrameCallback(function () { fin(); }); return; } catch (e) { }
      }
      requestAnimationFrame(function () { requestAnimationFrame(fin); });
    });
  }

  function drawTo(v) {
    if (!S.cv || !S.ctx || !v || !v.videoWidth) { return false; }
    var sw = v.videoWidth, sh = v.videoHeight;
    var dr = W / H, sr = sw / sh;
    var sx = 0, sy = 0, cw = sw, ch = sh;
    if (sr > dr) { cw = Math.round(sh * dr); sx = Math.round((sw - cw) / 2); }
    else if (sr < dr) { ch = Math.round(sw / dr); sy = Math.round((sh - ch) / 2); }
    try {
      S.ctx.clearRect(0, 0, W, H);
      S.ctx.drawImage(v, sx, sy, cw, ch, 0, 0, W, H);
    } catch (e) {
      return false;
    }
    S.hasFrame = true;
    if (S.ph) { S.ph.hidden = true; }
    return true;
  }

  /* 全黑检测：只用于「片头黑帧」时自动往后挪 0.8s 再取一次（仍是真实帧，不造假） */
  function isDark() {
    if (!S.ctx) { return false; }
    var d;
    try { d = S.ctx.getImageData(0, 0, W, H).data; } catch (e) { return false; }
    var lit = 0;
    for (var i = 0; i < d.length; i += 148) {
      if (d[i] > 16 || d[i + 1] > 16 || d[i + 2] > 16) {
        lit++;
        if (lit > 4) { return false; }
      }
    }
    return true;
  }

  function run(sec, gen, retried) {
    return ensureSampler().then(function (v) {
      if (gen !== S.gen) { return; }
      return seekTo(v, sec).then(function () {
        if (gen !== S.gen) { return; }
        return frameReady(v);
      }).then(function () {
        if (gen !== S.gen) { return; }
        if (!drawTo(v)) { throw new Error('draw'); }
        if (!retried && sec + 0.8 < S.dur && isDark()) {
          return run(sec + 0.8, gen, true);
        }
      });
    });
  }

  /* ---------- 取样调度（节流 + 合并最新位置） ---------- */
  function pump() {
    if (!S.open) { return; }
    if (S.busy) { return; }
    if (S.pending === null) { return; }
    var wait = S.lastAt + THROTTLE - now();
    if (wait > 0) {
      if (!S.timer) {
        S.timer = setTimeout(function () { S.timer = 0; pump(); }, Math.min(wait + 8, THROTTLE));
      }
      return;
    }
    var target = S.pending;
    S.pending = null;
    S.busy = true;
    S.lastAt = now();
    var gen = ++S.gen;
    if (!S.hasFrame) { showPh('取帧中…'); }
    run(target, gen, false).then(function () {
      if (gen !== S.gen) { return; }
      S.busy = false;
      if (S.pending !== null) { pump(); }
    }, function () {
      if (gen !== S.gen) { return; }
      S.busy = false;
      showPh('取不到这一帧');
      if (S.pending !== null) { pump(); }
    });
  }

  function requestFrame(sec) {
    S.pending = sec;
    pump();
  }

  /* ---------- 对外：开 / 关 ---------- */
  function openAt(sec) {
    var d = duration();
    if (!d) { return false; }
    build();
    if (!S.ruler || !S.ruler.isConnected) {
      attach(document.getElementById('ch-track'));
    }
    var wasOpen = S.open;
    S.dur = d;
    S.sec = clamp(Number(sec) || 0, 0, d);
    S.open = true;

    var b = S.bubble;
    if (b.hidden) {
      b.hidden = false;
      /* rAF 在后台/无渲染帧的 WebView 里可能被压住，配一个定时兜底保证一定能显示 */
      requestAnimationFrame(function () { if (S.open) { b.classList.add('is-on'); } });
      setTimeout(function () { if (S.open) { b.classList.add('is-on'); } }, 60);
    } else if (!b.classList.contains('is-on')) {
      b.classList.add('is-on');
    }
    document.body.classList.add('rr-previewing');
    if (S.tEl) { S.tEl.textContent = RR.fmtTime(S.sec); }
    if (!wasOpen) { clearFrame(); }
    place(S.sec);
    requestFrame(S.sec);
    return true;
  }

  function close() {
    if (!S.open && !S.bubble) { return; }
    S.open = false;
    S.gen++;                       /* 作废在途取样 */
    S.pending = null;
    if (S.timer) { clearTimeout(S.timer); S.timer = 0; }
    S.busy = false;
    S.lastAt = 0;
    document.body.classList.remove('rr-previewing');
    if (S.bubble) {
      S.bubble.classList.remove('is-on');
      clearTimeout(S.hideT);
      S.hideT = setTimeout(function () { if (!S.open && S.bubble) { S.bubble.hidden = true; } }, 140);
    }
    resetSampler();
    if (S.cv && S.ctx) { try { S.ctx.clearRect(0, 0, W, H); } catch (e) { } }
    S.hasFrame = false;
  }

  function resetSampler() {
    var v = S.sampler;
    if (!v) { return; }
    try { v.pause(); } catch (e) { }
    try { v.currentTime = 0; } catch (e) { }
    S.src = '';
    S.loadP = null;
    if (v.getAttribute('src')) {
      v.removeAttribute('src');
      try { v.load(); } catch (e) { }
    }
  }

  /* ---------- 拖动监听（自己也能独立工作） ---------- */
  function secAt(e) {
    var r = S.ruler.getBoundingClientRect();
    var pct = (e.clientX - r.left) / (r.width || 1);
    return clamp(pct, 0, 1) * S.dur;
  }

  function onDown(e) {
    if (e.button != null && e.button > 0) { return; }
    if (RR.player && typeof RR.player.isLocked === 'function' && RR.player.isLocked()) { return; }
    var d = duration();
    if (!d) { return; }
    S.dur = d;
    S.dragId = (e.pointerId == null ? 1 : e.pointerId);
    openAt(secAt(e));
  }

  function onMove(e) {
    if (S.dragId === null || S.dragId === undefined) { return; }
    if (e.pointerId != null && e.pointerId !== S.dragId) { return; }
    if (!S.open) { return; }
    openAt(secAt(e));
  }

  function onUp(e) {
    if (S.dragId === null || S.dragId === undefined) { return; }
    if (e.pointerId != null && e.pointerId !== S.dragId) { return; }
    S.dragId = null;
    close();
  }

  function onResize() {
    if (S.open) { place(S.sec); }
  }

  function attach(el) {
    el = el || document.getElementById('ch-track');
    if (!el) { return null; }
    if (S.ruler === el && S.bound) { return RR.preview; }
    detach();
    S.ruler = el;
    S.bound = true;
    el.addEventListener('pointerdown', onDown, { passive: true });
    el.addEventListener('pointermove', onMove, { passive: true });
    el.addEventListener('pointerup', onUp, { passive: true });
    el.addEventListener('pointercancel', onUp, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    return RR.preview;
  }

  function detach() {
    var el = S.ruler;
    if (el && S.bound) {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      window.removeEventListener('resize', onResize);
    }
    S.bound = false;
    S.dragId = null;
  }

  function mount() {
    build();
    attach(document.getElementById('ch-track'));
  }

  RR.preview = {
    mount: mount,
    attach: attach,
    detach: detach,
    openAt: openAt,
    close: close,
    isOpen: function () { return S.open; },
    hasFrame: function () { return S.hasFrame; }
  };

  /* 自己挂自己：DOM 就绪后绑进度条；切页/离开时收掉取样 */
  if (RR.on) {
    RR.on('rr:route', function () { close(); });
    RR.on('station', function () { close(); });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
