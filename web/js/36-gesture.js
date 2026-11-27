/* ============================================================
   36-gesture.js · 横屏手势层 + 横屏 UI（RR.gesture）
   ------------------------------------------------------------
   分工：35-fs 管全屏状态与取色保护层，本层管
     · 旋屏：自动跟随 + 手动锁定           RR.gesture.setOrientation(mode)
     · 画面左侧 30% 竖滑 → 音量；右侧 30% → 亮度；中间 40% 不拦
       （AndroidRadio.getVolume/setVolume、getBrightness/setBrightness）
     · 横屏 UI：左上退出横屏；右上 旋屏锁 / 字幕 / 截图 / 弹幕设置 / 锁；
       底部进度+播放沿用播放器 .ch-body（内核缺进度条时本层补一条兜底）
     · 单击显隐 UI（3.5s 自动隐藏）、双击 ±10s、长按 2×
     · 防误触锁（RR.player.lock / isLocked；无内核实现时本层自己扛）
   互斥：横屏下在 #ch-media 上捕获 pointerdown，整段手势归本层；竖屏只接管
   「竖滑」，判定成竖滑后给播放器补一个 pointercancel，避免它再补一次 tap。
   只调用 RR.player 的既有方法（play/pause/seek/toggle/lock/isLocked/setSpeed），
   一律 typeof 兜底，不碰它的内部实现。
   ============================================================ */
(function () {
  'use strict';
  var RR = window.RR;
  if (!RR) { return; }

  var HIDE_MS = 3500;      /* 横屏 UI 自动隐藏 */
  var LONG_MS = 480;       /* 长按 2× 的判定 */
  var TAP_MS = 300;        /* 单击与双击的分界 */
  var TOL = 14;            /* 位移容差（px） */
  var CONTROL = 'button,a[href],input,select,textarea,[role="slider"],[role="button"],' +
    '.ch-track,.ch-prog,.ch-body,.fs-chrome,.fs-hud,.fs-bottom,.fs-unlock';
  var MODES = ['auto', 'landscape', 'portrait', 'lock-landscape', 'lock-portrait'];

  var root = null, media = null, chrome = null, hud = null, hintEl = null, unlock = null, bottom = null;
  var mounted = false, fsOn = false;
  var locked = false, lockShown = false;
  var uiHidden = false, hideTimer = 0;
  var hudTimer = 0, hintTimer = 0;
  var orient = 'auto', orientLocked = false;

  var G = {
    id: null, x0: 0, y0: 0, t0: 0, zone: 'mid', active: false, fs: false,
    longT: 0, tapT: 0, lastTap: 0, boost: false, prevRate: 1,
    start: .5, val: .5, span: 320, lastApply: 0
  };

  /* ---------- 图标（本层自带，不改 core 的 ICO 表） ---------- */
  var ICONS = {
    lock: '<rect x="5" y="10.4" width="14" height="9.6" rx="3"/><path d="M8.6 10.4V8a3.4 3.4 0 0 1 6.8 0v2.4"/>',
    rotate: '<rect x="8" y="3.2" width="8" height="17.6" rx="2.4"/><path d="M5 8.6V7a2 2 0 0 1 2-2h.6M19 15.4V17a2 2 0 0 1-2 2h-.6"/>',
    cc: '<rect x="3" y="5" width="18" height="14" rx="3.5"/><path d="M10.4 10.2a2.3 2.3 0 1 0 0 3.6M17.2 10.2a2.3 2.3 0 1 0 0 3.6"/>',
    shot: '<rect x="3.5" y="6.5" width="17" height="13" rx="3"/><circle cx="12" cy="13" r="3.4"/><path d="M9.2 6.5 10.3 4.4h3.4l1.1 2.1"/>',
    sliders: '<path d="M4 8h8M17.4 8H20M4 16h3M12.4 16H20"/><circle cx="14.4" cy="8" r="2.1"/><circle cx="9.6" cy="16" r="2.1"/>',
    exit: '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
    volume: '<path d="M4 9.5h3l4-3.4v11.8l-4-3.4H4z"/><path d="M15 9a4 4 0 0 1 0 6M17.6 6.6a7.4 7.4 0 0 1 0 10.8"/>'
  };

  function ico(name, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 22) + '" height="' + (size || 22) +
      '" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" ' +
      'stroke-linejoin="round" aria-hidden="true" focusable="false">' + (ICONS[name] || '') + '</svg>';
  }
  function byId(id) { return document.getElementById(id); }
  function br() { return window.AndroidRadio || null; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function err(tag, e) { if (window.__E) { __E.push('gesture.' + tag + ':' + ((e && e.message) || e)); } }

  /* ============================================================
     一、横屏 UI
     ============================================================ */
  function build() {
    root = root || byId('view-channel');
    media = media || byId('ch-media');
    if (!root || !media) { return false; }
    if (chrome) { return true; }

    chrome = document.createElement('div');
    chrome.id = 'fs-chrome';
    chrome.className = 'fs-chrome';
    chrome.hidden = true;
    chrome.innerHTML =
      '<button type="button" class="fs-act fs-exit" id="fs-exit" aria-label="退出横屏">' + ico('exit') + '</button>' +
      '<div class="fs-acts" role="group" aria-label="横屏操作">' +
        '<button type="button" class="fs-act" id="fs-orient" aria-label="锁定横屏" aria-pressed="false">' + ico('rotate') + '</button>' +
        '<button type="button" class="fs-act" id="fs-sub" aria-label="字幕">' + ico('cc') + '</button>' +
        '<button type="button" class="fs-act" id="fs-shot" aria-label="截图">' + ico('shot') + '</button>' +
        '<button type="button" class="fs-act" id="fs-dm" aria-label="弹幕设置">' + ico('sliders') + '</button>' +
        '<button type="button" class="fs-act" id="fs-lock" aria-label="锁定屏幕，防误触">' + ico('lock') + '</button>' +
      '</div>';
    root.appendChild(chrome);

    hud = document.createElement('div');
    hud.id = 'fs-hud';
    hud.className = 'fs-hud';
    hud.hidden = true;
    hud.setAttribute('role', 'status');
    hud.setAttribute('aria-live', 'polite');
    hud.innerHTML = '<span class="fs-hud__ico" aria-hidden="true"></span>' +
      '<span class="fs-hud__mid"><b class="fs-hud__t">音量</b><span class="fs-hud__bar"><i></i></span></span>' +
      '<span class="fs-hud__v num">0%</span>';
    root.appendChild(hud);

    hintEl = document.createElement('div');
    hintEl.id = 'fs-hint';
    hintEl.className = 'fs-hint';
    hintEl.setAttribute('aria-hidden', 'true');
    root.appendChild(hintEl);

    unlock = document.createElement('button');
    unlock.type = 'button';
    unlock.id = 'fs-unlock';
    unlock.className = 'fs-unlock';
    unlock.hidden = true;
    unlock.setAttribute('aria-label', '解除锁定');
    unlock.innerHTML = ico('lock', 22) + '<span class="sr-only">解除锁定</span>';
    root.appendChild(unlock);

    bind();
    return true;
  }

  function bind() {
    byId('fs-exit').addEventListener('click', function () { exitFs(); });
    byId('fs-orient').addEventListener('click', function () { toggleOrientLock(); });
    byId('fs-sub').addEventListener('click', openSubtitle);
    byId('fs-shot').addEventListener('click', doShot);
    byId('fs-dm').addEventListener('click', openDm);
    byId('fs-lock').addEventListener('click', function () { setLock(true); });
    unlock.addEventListener('click', function () { setLock(false); });
    chrome.addEventListener('pointerdown', function () { armHide(); }, { passive: true });
  }

  function shown() { return !!(root && root.classList.contains('rr-shown')); }

  function playerFn(name) {
    var p = RR.player;
    return (p && typeof p[name] === 'function') ? p[name] : null;
  }

  function showUI() {
    if (!fsOn || !root) { return; }
    uiHidden = false;
    root.classList.add('rr-shown');
    root.classList.remove('is-away');
    var f = playerFn('uiShow');
    if (f) { try { f.call(RR.player); } catch (e) { err('uiShow', e); } }
    armHide();
  }

  function hideUI() {
    uiHidden = true;
    clearTimeout(hideTimer);
    if (root) { root.classList.remove('rr-shown'); }
    hideHint();
    var f = playerFn('uiHide');
    if (f) { try { f.call(RR.player); } catch (e) { err('uiHide', e); } }
  }

  function toggleUI() { if (uiHidden || !shown()) { showUI(); } else { hideUI(); } }

  function armHide() {
    clearTimeout(hideTimer);
    if (!fsOn || locked) { return; }
    hideTimer = setTimeout(function () {
      if (fsOn && !locked) { hideUI(); }
    }, HIDE_MS);
  }

  function exitFs() {
    if (RR.fs && typeof RR.fs.exit === 'function') { RR.fs.exit(); return; }
    var p = RR.player;
    if (p && typeof p.setFullscreen === 'function') { try { p.setFullscreen(false); } catch (e) { err('exitFs', e); } }
  }

  /* ---------- 提示 ---------- */
  function showHint(text) {
    if (!hintEl) { return; }
    hintEl.textContent = text;
    hintEl.classList.add('is-on');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(hideHint, 1500);
  }
  function hideHint() {
    clearTimeout(hintTimer);
    if (hintEl) { hintEl.classList.remove('is-on'); }
  }

  /* ---------- 音量/亮度 HUD ---------- */
  function showHud(kind, v) {
    if (!hud) { return; }
    hud.dataset.kind = kind;
    hud.hidden = false;
    var t = hud.querySelector('.fs-hud__t');
    var i = hud.querySelector('.fs-hud__ico');
    if (t) { t.textContent = kind === 'vol' ? '音量' : '亮度'; }
    if (i) { i.innerHTML = ico(kind === 'vol' ? 'volume' : 'sun', 22); }
    paintHud(v);
    clearTimeout(hudTimer);
    // 先显示再跑一帧加 class，避免 hidden 元素拿不到过渡
    requestAnimationFrame(function () { if (hud) { hud.classList.add('is-on'); } });
  }

  function paintHud(v) {
    if (!hud) { return; }
    var pct = Math.round(clamp01(v) * 100);
    var bar = hud.querySelector('.fs-hud__bar i');
    var val = hud.querySelector('.fs-hud__v');
    if (bar) { bar.style.width = pct + '%'; }
    if (val) { val.textContent = pct + '%'; }
  }

  function fadeHud(ms) {
    clearTimeout(hudTimer);
    hudTimer = setTimeout(function () {
      if (!hud) { return; }
      hud.classList.remove('is-on');
      setTimeout(function () {
        if (hud && !hud.classList.contains('is-on')) { hud.hidden = true; }
      }, 260);
    }, ms || 700);
  }

  /* ---------- 防误触锁 ---------- */
  function syncLock() {
    var p = RR.player;
    var is = p && typeof p.isLocked === 'function' ? !!p.isLocked() : locked;
    locked = is;
    if (root && root.classList.contains('is-locked') !== is) {
      root.classList.toggle('is-locked', is);
    }
    if (is && unlock) { unlock.hidden = true; }
    return is;
  }

  function setLock(next) {
    next = !!next;
    locked = next;
    lockShown = false;
    if (root) { root.classList.toggle('is-locked', next); }
    if (unlock) { unlock.hidden = true; }
    var p = RR.player;
    if (p && typeof p.lock === 'function') {
      try { p.lock(next); } catch (e) { err('lock', e); }
    }
    if (next) {
      hideUI();
      if (chrome) { chrome.hidden = false; }
      showHint('已锁定，点一下解锁');
    } else {
      showHint('已解锁');
      showUI();
    }
    RR.emit('rr:lock', { locked: next });
    return next;
  }

  function isLocked() {
    var p = RR.player;
    if (p && typeof p.isLocked === 'function') {
      try { return !!p.isLocked(); } catch (e) { err('isLocked', e); }
    }
    return locked;
  }

  function lockTap() {
    var f = playerFn('lockHint');
    if (f) { try { f.call(RR.player, true); return; } catch (e) { err('lockHint', e); } }
    if (!unlock) { return; }
    lockShown = !lockShown;
    unlock.hidden = !lockShown;
  }

  /* ---------- 旋屏 ---------- */
  function setOrientation(mode) {
    if (MODES.indexOf(mode) < 0) { mode = 'auto'; }
    orient = mode;
    orientLocked = mode.indexOf('lock-') === 0;
    var b = br();
    if (b && typeof b.setOrientation === 'function') {
      try { b.setOrientation(mode); } catch (e) { err('orientation', e); }
    }
    updateOrientBtn();
    RR.emit('rr:orientation', { mode: mode });
    return mode;
  }

  function toggleOrientLock() {
    if (!orientLocked) {
      setOrientation('lock-landscape');
      showHint('已锁定横屏');
    } else {
      setOrientation('landscape');
      showHint('自动旋转');
    }
  }

  function updateOrientBtn() {
    var b = byId('fs-orient');
    if (!b) { return; }
    b.setAttribute('aria-pressed', String(orientLocked));
    b.setAttribute('aria-label', orientLocked ? '解除横屏锁定' : '锁定横屏');
    b.classList.toggle('is-on', orientLocked);
  }

  /* ---------- 全屏状态进出 ---------- */
  function onFs(d) {
    var next = !!(d && d.on);
    if (next === fsOn) { return; }
    if (!build()) { return; }
    fsOn = next;
    if (next) {
      chrome.hidden = false;
      unlock.hidden = true;
      lockShown = false;
      syncLock();
      if (locked) { hideUI(); }
      if (!orientLocked) { setOrientation('landscape'); }
      ensureBottom();
      showUI();
      updateOrientBtn();
    } else {
      clearTimeout(hideTimer);
      clearTimeout(G.tapT);
      clearTimeout(G.longT);
      if (G.boost) { endBoost(); }
      if (locked) { setLock(false); }
      chrome.hidden = true;
      if (hud) { hud.hidden = true; hud.classList.remove('is-on'); }
      if (unlock) { unlock.hidden = true; }
      hideHint();
      if (root) { root.classList.remove('rr-shown'); }
      dropBottom();
      setOrientation('auto');
    }
  }

  /* ---------- 底部兜底条：内核没给进度条时才补 ---------- */
  function ensureBottom() {
    if (byId('ch-track') || document.querySelector('#view-channel .ch-body')) { return; }
    if (bottom) { return; }
    bottom = document.createElement('div');
    bottom.id = 'fs-bottom';
    bottom.className = 'fs-bottom';
    bottom.innerHTML =
      '<button type="button" class="fs-act fsb-play" id="fsb-play" aria-label="播放">' + RR.ICO('play', 20) + '</button>' +
      '<span class="fsb-time num" id="fsb-cur">0:00</span>' +
      '<div class="fsb-track" id="fsb-track" role="slider" tabindex="0" aria-label="播放进度" ' +
        'aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><i class="fsb-fill" id="fsb-fill"></i>' +
        '<i class="fsb-knob" id="fsb-knob"></i></div>' +
      '<span class="fsb-time num" id="fsb-dur">--:--</span>';
    root.appendChild(bottom);

    var play = byId('fsb-play');
    if (play) {
      play.addEventListener('click', function () {
        var p = RR.player;
        if (p && typeof p.toggle === 'function') { try { p.toggle(); } catch (e) { err('toggle', e); } }
        paintBottom();
      });
    }
    var track = byId('fsb-track'), drag = null;
    function seekAt(clientX) {
      var r = track.getBoundingClientRect();
      var pct = Math.max(0, Math.min(1, (clientX - r.left) / (r.width || 1)));
      var p = RR.player;
      var dur = bottomDur();
      if (p && typeof p.seek === 'function' && dur > 0) {
        try { p.seek(pct * dur); } catch (e) { err('seek', e); }
      }
    }
    if (track) {
      track.addEventListener('pointerdown', function (e) {
        drag = e.pointerId;
        try { track.setPointerCapture(e.pointerId); } catch (e2) { }
        seekAt(e.clientX);
      });
      track.addEventListener('pointermove', function (e) { if (drag === e.pointerId) { seekAt(e.clientX); } });
      var stop = function (e) { if (drag === e.pointerId) { drag = null; } };
      track.addEventListener('pointerup', stop);
      track.addEventListener('pointercancel', stop);
      track.addEventListener('keydown', function (e) {
        var p = RR.player;
        var cur = (p && typeof p.time === 'function') ? p.time() : 0;
        if (e.key === 'ArrowLeft' && p && p.seek) { e.preventDefault(); p.seek(Math.max(0, cur - 5)); }
        if (e.key === 'ArrowRight' && p && p.seek) { e.preventDefault(); p.seek(cur + 5); }
      });
    }
    bottom._t = setInterval(paintBottom, 500);
    paintBottom();
  }

  function bottomDur() {
    var p = RR.player;
    if (p && typeof p.audioState === 'function') {
      try { var st = p.audioState(); if (st && st.duration) { return st.duration; } } catch (e) { }
    }
    var v = byId('player');
    return (v && isFinite(v.duration)) ? v.duration : 0;
  }

  function paintBottom() {
    if (!bottom) { return; }
    var p = RR.player;
    var cur = (p && typeof p.time === 'function') ? p.time() : 0;
    var dur = bottomDur();
    var pct = dur > 0 ? Math.max(0, Math.min(100, (cur / dur) * 100)) : 0;
    var fill = byId('fsb-fill'), knob = byId('fsb-knob');
    if (fill) { fill.style.width = pct + '%'; }
    if (knob) { knob.style.left = pct + '%'; }
    var c = byId('fsb-cur'), d = byId('fsb-dur'), play = byId('fsb-play');
    if (c) { c.textContent = RR.fmtTime(cur); }
    if (d) { d.textContent = dur > 0 ? RR.fmtTime(dur) : '--:--'; }
    var track = byId('fsb-track');
    if (track) {
      track.setAttribute('aria-valuenow', String(Math.round(cur)));
      track.setAttribute('aria-valuemax', String(Math.round(dur)));
      track.setAttribute('aria-valuetext', RR.fmtTime(cur));
    }
    if (play) {
      var playing = p && typeof p.isPlaying === 'function' ? !!p.isPlaying() : false;
      play.innerHTML = RR.ICO(playing ? 'pause' : 'play', 20);
      play.setAttribute('aria-label', playing ? '暂停' : '播放');
    }
  }

  function dropBottom() {
    if (!bottom) { return; }
    clearInterval(bottom._t);
    if (bottom.parentNode) { bottom.parentNode.removeChild(bottom); }
    bottom = null;
  }

  /* ============================================================
     二、竖滑：音量 / 亮度
     ============================================================ */
  function mediaEl() { return media || (media = byId('ch-media')); }
  function isMediaTarget(t) {
    var m = mediaEl();
    return !!(m && t && t.nodeType === 1 && (t === m || m.contains(t)));
  }
  function isControl(t) {
    return !!(t && t.closest && t.closest(CONTROL));
  }
  function zoneOf(x) {
    var m = mediaEl();
    if (!m) { return 'mid'; }
    var r = m.getBoundingClientRect();
    if (!r.width) { return 'mid'; }
    var t = (x - r.left) / r.width;
    return t < .3 ? 'vol' : (t > .7 ? 'bri' : 'mid');
  }
  function readVal(kind) {
    var b = br();
    if (!b) { return .5; }
    var v;
    try {
      v = kind === 'vol'
        ? (typeof b.getVolume === 'function' ? b.getVolume() : null)
        : (typeof b.getBrightness === 'function' ? b.getBrightness() : null);
    } catch (e) { v = null; }
    v = Number(v);
    if (!isFinite(v) || v < 0) { return .5; }
    return clamp01(v);
  }
  function applyVal(v) {
    var b = br();
    var name = G.zone === 'vol' ? 'setVolume' : 'setBrightness';
    if (b && typeof b[name] === 'function') {
      try { b[name](Math.round(v * 1000) / 1000); } catch (e) { err('apply', e); }
    }
    RR.emit('rr:gesture', { kind: G.zone, value: v });
  }

  function startSwipe() {
    var m = mediaEl();
    if (!m) { return; }
    G.active = true;
    clearTimeout(G.longT);
    if (!G.fs) { cancelPlayerGesture(); }   /* 竖屏：把这一下从播放器手里拿走 */
    var r = m.getBoundingClientRect();
    G.span = Math.max(200, Math.min(560, (r.height || 320) * .78));
    G.start = readVal(G.zone);
    G.val = G.start;
    G.lastApply = 0;
    showHud(G.zone, G.val);
    if (G.fs) { armHide(); }
  }

  /* 竖屏把这一下从播放器手里拿走：补一个 pointercancel。
     它也会冒泡回本层，所以打上 __rrSynthetic，自己的 onCancel 认出来跳过。 */
  function cancelPlayerGesture() {
    var m = mediaEl();
    if (!m) { return; }
    try {
      var ev = new PointerEvent('pointercancel', {
        bubbles: true, cancelable: false, pointerId: G.id == null ? 1 : G.id
      });
      ev.__rrSynthetic = true;
      m.dispatchEvent(ev);
    } catch (e) { err('cancel', e); }
  }

  function updateSwipe(dy) {
    var v = clamp01(G.start - dy / G.span);
    G.val = v;
    paintHud(v);
    var now = Date.now();
    if (now - G.lastApply > 32) { G.lastApply = now; applyVal(v); }
  }

  function endSwipe() {
    if (!G.active) { return; }
    G.active = false;
    applyVal(G.val);
    fadeHud(650);
    if (G.fs) { armHide(); }
  }

  /* ============================================================
     三、指针状态机（与播放器手势互斥）
     ============================================================ */
  function onDown(e) {
    try {
      if (e.button && e.button !== 0) { return; }
      if (fsOn) { syncLock(); }
      var t = e.target;
      if (!fsOn && !isMediaTarget(t)) { return; }
      if (!isMediaTarget(t)) { if (fsOn) { armHide(); } return; }
      if (isControl(t)) { if (fsOn) { armHide(); } return; }
      if (fsOn) { armHide(); }

      G.id = e.pointerId;
      G.x0 = e.clientX; G.y0 = e.clientY;
      G.t0 = Date.now();
      G.active = false;
      G.fs = fsOn;
      G.zone = zoneOf(e.clientX);
      G.lastApply = 0;

      /* 横屏：内核的 onDown 已经 return（它只做竖屏），这里不抢事件传播 */
      if (locked) { return; }

      if (fsOn) {
        clearTimeout(G.longT);
        G.longT = setTimeout(onLong, LONG_MS);
      }
    } catch (err0) { err('down', err0); }
  }

  function onMove(e) {
    try {
      if (G.id !== e.pointerId) { return; }
      var dx = e.clientX - G.x0, dy = e.clientY - G.y0;
      if (!G.active) {
        if (!locked && G.zone !== 'mid' && Math.abs(dy) > TOL && Math.abs(dy) > Math.abs(dx) * 1.12) {
          startSwipe();
        } else if (Math.abs(dy) > 12 || Math.abs(dx) > 12) {
          clearTimeout(G.longT);
          if (G.boost) { endBoost(); }
        }
        if (!G.active) { return; }
      }
      if (e.cancelable) { e.preventDefault(); }
      updateSwipe(dy);
    } catch (err0) { err('move', err0); }
  }

  function onUp(e) {
    try {
      if (G.id !== e.pointerId) { return; }
      var dx = e.clientX - G.x0, dy = e.clientY - G.y0;
      G.id = null;
      clearTimeout(G.longT);

      if (G.active) {
        endSwipe();
        if (e.cancelable) { e.preventDefault(); }
        return;
      }
      if (G.boost) { endBoost(); return; }
      if (!G.fs) { return; }          /* 竖屏：单击/双击/长按仍归播放器 */

      if (locked) { lockTap(); return; }
      if (Math.abs(dx) > TOL || Math.abs(dy) > TOL) { return; }
      if (Date.now() - G.t0 > 520) { return; }

      var now = Date.now();
      if (now - G.lastTap < 320) {
        clearTimeout(G.tapT);
        G.lastTap = 0;
        onDouble(e.clientX);
      } else {
        G.lastTap = now;
        clearTimeout(G.tapT);
        G.tapT = setTimeout(onSingle, TAP_MS);
      }
    } catch (err0) { err('up', err0); }
  }

  function onCancel(e) {
    if (e && e.__rrSynthetic) { return; }
    if (G.id !== e.pointerId) { return; }
    G.id = null;
    clearTimeout(G.longT);
    if (G.active) { G.active = false; fadeHud(400); }
    if (G.boost) { endBoost(); }
  }

  function onSingle() {
    if (!fsOn || locked) { return; }
    toggleUI();
  }

  function onDouble(clientX) {
    if (!fsOn) { return; }
    var m = mediaEl();
    var r = m ? m.getBoundingClientRect() : { left: 0, width: 1 };
    var t = (clientX - r.left) / (r.width || 1);
    if (t < .38) { seekBy(-10, '-10 秒'); }
    else if (t > .62) { seekBy(10, '+10 秒'); }
    else {
      var p = RR.player;
      if (p && typeof p.toggle === 'function') { try { p.toggle(); } catch (e) { err('doubleToggle', e); } }
      armHide();
    }
  }

  function curTime() {
    var p = RR.player;
    if (p && typeof p.time === 'function') {
      try { var t = p.time(); if (isFinite(t)) { return Number(t); } } catch (e) { }
    }
    var v = byId('player');
    return (v && isFinite(v.currentTime)) ? v.currentTime : 0;
  }

  function seekBy(delta, label) {
    var p = RR.player;
    if (!p || typeof p.seek !== 'function') { return; }
    var dur = bottomDur();
    var cur = curTime();
    var next = Math.max(0, Math.min(dur > 0 ? dur - .3 : 1e9, cur + delta));
    try { p.seek(next); } catch (e) { err('seek', e); }
    showHint(label);
    armHide();
  }

  /* ---------- 长按 2× ---------- */
  function setSpeed(v) {
    var p = RR.player;
    if (!p) { return; }
    if (typeof p.setSpeed === 'function') { try { p.setSpeed(v); } catch (e) { err('setSpeed', e); } return; }
    if (typeof p.setRate === 'function') { try { p.setRate(v); } catch (e) { err('setRate', e); } }
  }

  function onLong() {
    if (!fsOn || locked || G.active) { return; }
    var p = RR.player;
    if (!p) { return; }
    var playing = typeof p.isPlaying === 'function' ? !!p.isPlaying() : false;
    if (!playing) { return; }
    G.boost = true;
    G.prevRate = 1;
    if (typeof p.rate === 'function') {
      try { var r0 = p.rate(); if (typeof r0 === 'number' && r0 > 0) { G.prevRate = r0; } } catch (e) { }
    } else if (RR.settings) {
      G.prevRate = RR.settings().rate || 1;
    }
    setSpeed(2);
    showHint('2× 快进中');
    armHide();
  }

  function endBoost() {
    if (!G.boost) { return; }
    G.boost = false;
    setSpeed(G.prevRate || 1);
    hideHint();
  }

  /* ============================================================
     四、右上四个入口
     ============================================================ */
  function openSubtitle() {
    var sub = RR.subtitle;
    if (sub && typeof sub.openPanel === 'function') {
      try { sub.openPanel(); return; } catch (e) { err('sub.title', e); }
    }
    var b = br();
    if (b && typeof b.pickSubtitle === 'function') {
      try { b.pickSubtitle(); return; } catch (e) { err('sub.bridge', e); }
    }
    if (sub && typeof sub.loadText === 'function') { pickSubtitleFile(sub); return; }
    if (RR.toast) { RR.toast('字幕还没准备好'); }
  }

  function pickSubtitleFile(sub) {
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.srt,.vtt,text/plain';
    input.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';
    document.body.appendChild(input);
    input.addEventListener('change', function () {
      var f = input.files && input.files[0];
      if (!f) { if (input.parentNode) { input.parentNode.removeChild(input); } return; }
      var fr = new FileReader();
      fr.onload = function () {
        try {
          sub.loadText(f.name, String(fr.result || ''));
          if (RR.toast) { RR.toast('字幕已载入'); }
        } catch (e) {
          err('sub.load', e);
          if (RR.toast) { RR.toast('字幕载入失败', 'err'); }
        }
        if (input.parentNode) { input.parentNode.removeChild(input); }
      };
      fr.onerror = function () {
        if (input.parentNode) { input.parentNode.removeChild(input); }
        if (RR.toast) { RR.toast('读不到这个字幕文件', 'err'); }
      };
      fr.readAsText(f, 'utf-8');
    });
    input.click();
  }

  function doShot() {
    if (RR.shot && typeof RR.shot.open === 'function') {
      try { RR.shot.open(); return; } catch (e) { err('shot.open', e); }
    }
    var p = RR.player;
    if (!p || typeof p.captureFrame !== 'function') {
      if (RR.toast) { RR.toast('截图还没准备好'); }
      return;
    }
    try {
      var cv = p.captureFrame();
      if (!cv || typeof cv.toDataURL !== 'function') { throw new Error('no frame'); }
      var b64 = String(cv.toDataURL('image/png')).split(',')[1] || '';
      var b = br();
      if (b && typeof b.saveImage === 'function') {
        var res = b.saveImage(b64, 'rr-' + Date.now() + '.png');
        if (RR.toast) { RR.toast(res === 'ok' ? '已存到相册' : '保存失败', res === 'ok' ? '' : 'err'); }
      } else if (RR.toast) {
        RR.toast('这一帧已经取好了');
      }
    } catch (e) {
      err('shot', e);
      if (RR.toast) { RR.toast('截图失败', 'err'); }
    }
  }

  function openDm() {
    var dm = RR.danmaku;
    if (!dm || typeof RR.sheet !== 'function') {
      if (RR.toast) { RR.toast('弹幕设置还没准备好'); }
      return;
    }
    var s = RR.settings ? RR.settings() : {};
    var op = s.dmOpacity == null ? .85 : s.dmOpacity;
    var sp = s.dmSpeed || 1;
    var sz = s.dmSize || 1;
    var area = s.dmArea || 'all';

    var box = document.createElement('div');
    box.className = 'fs-dm-panel stack';
    box.innerHTML =
      dmRow('透明度', 'opacity', 0, 1, .05, op, Math.round(op * 100) + '%') +
      dmRow('速度', 'speed', .5, 2, .1, sp, sp + '×') +
      dmRow('字号', 'size', .7, 1.6, .1, sz, Math.round(sz * 100) + '%') +
      '<div class="dm-chips" role="group" aria-label="显示区域">' +
        ['all|全屏', 'scroll|滚动', 'top|顶部', 'bottom|底部'].map(function (p) {
          var kv = p.split('|');
          return '<button type="button" class="dm-chip' + (area === kv[0] ? ' is-on' : '') +
            '" data-area="' + kv[0] + '">' + kv[1] + '</button>';
        }).join('') +
      '</div>';

    var sh = RR.sheet({ title: '弹幕设置', body: box });

    function save(patch) { if (RR.saveSettings) { RR.saveSettings(patch); } }
    function applyDm(kind, v) {
      if (kind === 'opacity') {
        if (typeof dm.setOpacity === 'function') { try { dm.setOpacity(v); } catch (e) { err('dm.op', e); } }
        save({ dmOpacity: v });
      } else if (kind === 'speed') {
        if (typeof dm.setSpeed === 'function') { try { dm.setSpeed(v); } catch (e) { err('dm.sp', e); } }
        save({ dmSpeed: v });
      } else if (kind === 'size') {
        if (typeof dm.setSize === 'function') { try { dm.setSize(v); } catch (e) { err('dm.sz', e); } }
        save({ dmSize: v });
      }
    }

    Array.prototype.forEach.call(box.querySelectorAll('input[type=range]'), function (inp) {
      inp.addEventListener('input', function () {
        var kind = inp.getAttribute('data-kind');
        var v = Number(inp.value);
        var out = box.querySelector('[data-out="' + kind + '"]');
        if (out) {
          out.textContent = kind === 'opacity' ? Math.round(v * 100) + '%'
            : kind === 'speed' ? v + '×' : Math.round(v * 100) + '%';
        }
        applyDm(kind, v);
      });
    });

    Array.prototype.forEach.call(box.querySelectorAll('.dm-chip'), function (b) {
      b.addEventListener('click', function () {
        Array.prototype.forEach.call(box.querySelectorAll('.dm-chip'), function (x) {
          x.classList.toggle('is-on', x === b);
        });
        var a = b.getAttribute('data-area');
        if (typeof dm.setArea === 'function') { try { dm.setArea(a); } catch (e) { err('dm.area', e); } }
        if (RR.saveSettings) { RR.saveSettings({ dmArea: a }); }
        if (RR.toast) { RR.toast('显示区域已切换'); }
      });
    });
    return sh;
  }

  function dmRow(label, kind, min, max, step, value, text) {
    return '<label class="dm-row"><span class="dm-row__t">' + label + '</span>' +
      '<input type="range" data-kind="' + kind + '" min="' + min + '" max="' + max +
      '" step="' + step + '" value="' + value + '" aria-label="' + label + '">' +
      '<span class="dm-row__v num" data-out="' + kind + '">' + text + '</span></label>';
  }

  /* ============================================================
     五、挂载
     ============================================================ */
  function mount() {
    if (mounted) { return true; }
    if (!build()) { return false; }
    mounted = true;
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('blur', function () {
      clearTimeout(G.longT);
      if (G.boost) { endBoost(); }
    });
    RR.on('rr:fs', onFs);

    /* 内核的锁键也能锁/解锁（竖屏、以及它自己的 lockHint），这里跟着同步一次 */
    var stage = byId('ch-stage');
    var syncing = false;
    if (stage && typeof MutationObserver === 'function') {
      new MutationObserver(function () {
        if (syncing) { return; }
        syncing = true;
        var was = locked;
        var is = syncLock();
        if (is !== was && fsOn) { if (is) { hideUI(); } else { showUI(); } }
        syncing = false;
      }).observe(stage, { attributes: true, attributeFilter: ['class'] });
    }

    /* native 的 pickSubtitle 回调：转发给字幕模块（不覆盖别人先挂的） */
    var prevSub = window.__rrSubtitleFile;
    window.__rrSubtitleFile = function (name, text) {
      if (RR.subtitle && typeof RR.subtitle.loadText === 'function') {
        try { RR.subtitle.loadText(name, text); if (RR.toast) { RR.toast('字幕已载入'); } } catch (e) { err('subFile', e); }
      }
      return prevSub ? prevSub(name, text) : undefined;
    };

    fsOn = !!(RR.fs && typeof RR.fs.isOn === 'function' && RR.fs.isOn());
    if (fsOn) { chrome.hidden = false; showUI(); ensureBottom(); }
    updateOrientBtn();
    return true;
  }

  RR.gesture = {
    mount: mount,
    setOrientation: setOrientation,
    orientation: function () { return orient; },
    isLocked: isLocked,
    lock: function (on) { return setLock(on); },
    show: showUI,
    hide: hideUI,
    fs: function () { return fsOn; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
