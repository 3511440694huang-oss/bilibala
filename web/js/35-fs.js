/* ============================================================
   35-fs.js · 横屏全屏宿主（RR.fs）
   ------------------------------------------------------------
   全屏状态的唯一真相是 #view-channel.is-fs —— 30-player 的 setFs() 负责
   切换它，本文件只「跟进」：
     · 系统栏（AndroidRadio.setFullscreen，沉浸式）
     · 顶部由视频画面取色的暗渐变保护层（canvas 采样，零 backdrop-filter）
     · html.rr-fs（横屏时隐藏 dock / 顶栏）
     · 广播 rr:fs，交给 36-gesture 做旋屏与横屏 UI
   对外：RR.fs.isOn() enter() exit() toggle() refreshTint()
   ============================================================ */
(function () {
  'use strict';
  var RR = window.RR;
  if (!RR) { return; }

  var root = null, media = null, tint = null, cv = null, ctx = null;
  var on = false, applied = false, inited = false, timer = 0, lastAt = 0;

  function q(id) { return document.getElementById(id); }
  function br() { return window.AndroidRadio || null; }
  function brCall(name, args) {
    var b = br();
    if (!b) { return undefined; }
    var f = b[name];
    if (typeof f !== 'function') { return undefined; }
    try { return f.apply(b, args || []); } catch (e) { return undefined; }
  }

  function els() {
    if (!root) { root = q('view-channel'); }
    if (!media) { media = q('ch-media'); }
    return root;
  }
  function isOn() { return !!(els() && root.classList.contains('is-fs')); }

  /* ---------- ① 顶部取色保护层 ---------- */
  function ensureTint() {
    if (tint || !media) { return; }
    tint = document.createElement('span');
    tint.className = 'fs-tint';
    tint.setAttribute('aria-hidden', 'true');
    media.appendChild(tint);

    cv = document.createElement('canvas');
    cv.width = 24; cv.height = 14;
    cv.className = 'fs-tint-cv';
    cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(cv);
    try { ctx = cv.getContext('2d', { willReadFrequently: true }); } catch (e) { ctx = null; }
  }

  /* 取画面顶部约 1/3 的平均色，压暗到 60% 作为遮罩底色。
     取不到（跨域/还没帧）就退回夜色，绝不报错。 */
  function sampleTint(force) {
    if (!isOn()) { return; }
    ensureTint();
    if (!tint) { return; }
    var now = Date.now();
    if (!force && now - lastAt < 900) { return; }
    lastAt = now;

    var v = q('player');
    var r = 16, g = 18, b = 24;
    if (v && ctx && cv && v.videoWidth && v.readyState >= 2) {
      try {
        ctx.drawImage(v, 0, 0, cv.width, cv.height);
        var d = ctx.getImageData(0, 0, cv.width, cv.height).data;
        var rows = Math.max(3, Math.round(cv.height * .34));
        var n = 0, sr = 0, sg = 0, sb = 0, y, x, i;
        for (y = 0; y < rows; y++) {
          for (x = 0; x < cv.width; x++) {
            i = (y * cv.width + x) * 4;
            sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; n++;
          }
        }
        if (n) {
          r = Math.round(sr / n); g = Math.round(sg / n); b = Math.round(sb / n);
        }
      } catch (e) { /* 帧读不了：保持夜色 */ }
    }
    tint.style.setProperty('--tint-rgb',
      Math.round(r * .6) + ',' + Math.round(g * .6) + ',' + Math.round(b * .6));
  }

  function tickTint() {
    clearTimeout(timer);
    if (!isOn()) { return; }
    sampleTint();
    timer = setTimeout(tickTint, 1200);
  }

  /* ---------- ② 状态跟进 ---------- */
  function apply(next) {
    if (!els()) { return; }
    on = !!next;
    document.documentElement.classList.toggle('rr-fs', on);
    /* 播放内核自己会调 setFullscreen；它已经在位时不再重复调，避免一次切换两条系统栏指令 */
    var p = RR.player;
    var playerSide = !!(p && typeof p.setFullscreen === 'function' &&
      typeof p.fullscreen === 'function' && !!p.fullscreen() === on);
    if (applied !== on && !playerSide) { brCall('setFullscreen', [on]); }
    if (applied !== on) { applied = on; }
    if (on) { ensureTint(); sampleTint(true); tickTint(); }
    else { clearTimeout(timer); }
    RR.emit('rr:fs', { on: on });
    RR.emit('fs', { on: on });
  }

  /* ---------- ③ 对外 ---------- */
  function setClass(next) {
    if (!els()) { return false; }
    root.classList.toggle('is-fs', next);
    document.body.style.overflow = next ? 'hidden' : '';
    var btn = q('ch-fs');
    if (btn) {
      btn.innerHTML = RR.ICO(next ? 'collapse' : 'expand');
      btn.setAttribute('aria-label', next ? '退出全屏' : '全屏播放');
    }
    return true;
  }

  function enter() {
    if (!els()) { return false; }
    if (isOn()) { return true; }
    var p = RR.player;
    if (p && typeof p.setFullscreen === 'function') {
      try { p.setFullscreen(true); } catch (e) { }
      if (isOn()) { return true; }
    }
    setClass(true);
    return true;
  }

  function exit() {
    if (!els()) { return false; }
    if (!isOn()) { return false; }
    var p = RR.player;
    if (p && typeof p.setFullscreen === 'function') {
      try { p.setFullscreen(false); } catch (e) { }
      if (!isOn()) { return true; }
    }
    setClass(false);
    return true;
  }

  function toggle() { return isOn() ? exit() : enter(); }

  function init() {
    if (inited) { return; }
    if (!els()) { return; }
    inited = true;
    ensureTint();
    applied = isOn();
    if (typeof MutationObserver === 'function') {
      new MutationObserver(function () {
        var s = isOn();
        if (s !== on) { apply(s); }
      }).observe(root, { attributes: true, attributeFilter: ['class'] });
    }
    /* 播放器内核没提供 setFullscreen 时兜底接管全屏按钮 */
    var btn = q('ch-fs');
    var p = RR.player;
    if (btn && !(p && typeof p.setFullscreen === 'function')) {
      btn.addEventListener('click', function () { toggle(); });
    }
    apply(isOn());
  }

  RR.fs = {
    isOn: isOn,
    enter: enter,
    exit: exit,
    toggle: toggle,
    refreshTint: function () { sampleTint(true); }
  };

  /* 退出全屏的统一入口（41-live 也在调） */
  var prevExit = window.__rrExitFs;
  window.__rrExitFs = function () {
    if (isOn()) { exit(); return true; }
    return prevExit ? prevExit() : false;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
