/* ============================================================
   39-shot.js · 截图微调（RR.shot）
   契约：open() / step(±1) / save() / close()
   链路：<video id="player"> 当前帧 → canvas（满分辨率）→ 预览浮层
         → 上一帧/下一帧（±1/30s，经 RR.player.seek）
         → 保存：AndroidRadio.saveImage(b64, name)；无桥接时降级下载。
   说明：打开预览时暂停播放（拿到稳定帧才谈得上「逐帧」），
         关闭时若原本在播则调 RR.player.resume() 复原。
   能力检测：RR.player.captureFrame / seek / pause / resume 都可能还没实现，
         缺哪个就退到同源的 <video> 取帧或直接改 currentTime。
   ============================================================ */
(function () {
  'use strict';
  var RR = window.RR;
  if (!RR) { return; }

  var FRAME = 1 / 30;

  var S = {
    node: null, cv: null, ctx: null, timeEl: null, hintEl: null,
    frame: null, time: 0, open: false, wasPlaying: false, keyed: false,
    busy: false
  };

  function playerVideo() { return document.getElementById('player'); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function fmtPrecise(t) {
    t = Math.max(0, Number(t) || 0);
    var h = Math.floor(t / 3600);
    var m = Math.floor((t % 3600) / 60);
    var s = t % 60;
    var ss = s < 10 ? '0' + s.toFixed(2) : s.toFixed(2);
    return h ? (h + ':' + pad2(m) + ':' + ss) : (m + ':' + ss);
  }

  function fileName() {
    var d = new Date();
    return '哔哩吧啦_' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) +
      '_' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()) + '.png';
  }

  function hint(msg, isErr) {
    if (!S.hintEl) { return; }
    S.hintEl.textContent = msg || '';
    S.hintEl.dataset.kind = isErr ? 'err' : '';
  }

  /* ---------- DOM ---------- */
  function mkBtn(label, ico, fn) {
    var b = RR.el('button', 'rr-shot__btn');
    b.type = 'button';
    b.innerHTML = RR.ICO(ico, 18) + '<span>' + label + '</span>';
    b.addEventListener('click', fn);
    return b;
  }

  function build() {
    if (S.node) { return S.node; }
    var n = RR.el('div', 'rr-shot');
    n.id = 'rr-shot';
    n.hidden = true;
    n.setAttribute('role', 'dialog');
    n.setAttribute('aria-modal', 'true');
    n.setAttribute('aria-label', '截图预览');

    var top = RR.el('div', 'rr-shot__top');
    var ttl = RR.el('span', 'rr-shot__ttl', '截图预览');
    var time = RR.el('span', 'rr-shot__time num');
    time.textContent = '0:00.00';
    var x = RR.el('button', 'rr-shot__x');
    x.type = 'button';
    x.innerHTML = RR.ICO('close', 20);
    x.setAttribute('aria-label', '关闭截图预览');
    x.addEventListener('click', close);
    top.appendChild(ttl);
    top.appendChild(time);
    top.appendChild(x);

    var stage = RR.el('div', 'rr-shot__stage');
    var cv = document.createElement('canvas');
    cv.className = 'rr-shot__cv';
    cv.width = 16;
    cv.height = 9;
    stage.appendChild(cv);

    var bar = RR.el('div', 'rr-shot__bar');
    bar.appendChild(mkBtn('上一帧', 'back10', function () { step(-1); }));
    bar.appendChild(mkBtn('下一帧', 'fwd10', function () { step(1); }));
    var sv = mkBtn('保存', 'download', save);
    sv.classList.add('rr-shot__btn--save');
    bar.appendChild(sv);

    var h = RR.el('div', 'rr-shot__hint');
    h.setAttribute('role', 'status');

    n.appendChild(top);
    n.appendChild(stage);
    n.appendChild(h);
    n.appendChild(bar);
    document.body.appendChild(n);

    S.node = n; S.cv = cv; S.ctx = cv.getContext('2d');
    S.timeEl = time; S.hintEl = h;
    return n;
  }

  function paint() {
    var c = S.cv, f = S.frame;
    if (!c || !f) { return; }
    if (c.width !== f.width) { c.width = f.width; }
    if (c.height !== f.height) { c.height = f.height; }
    try {
      S.ctx.clearRect(0, 0, c.width, c.height);
      S.ctx.drawImage(f, 0, 0);
    } catch (e) { }
    if (S.timeEl) { S.timeEl.textContent = fmtPrecise(S.time); }
  }

  /* ---------- 取帧 ---------- */
  function capture() {
    var pf = RR.player && RR.player.captureFrame;
    if (typeof pf === 'function') {
      try {
        var c = pf();
        if (c && c.width > 0 && c.height > 0) { return c; }
      } catch (e) { }
    }
    var v = playerVideo();
    if (!v || !v.videoWidth) { return null; }
    var cv = document.createElement('canvas');
    cv.width = v.videoWidth;
    cv.height = v.videoHeight;
    var ctx = cv.getContext('2d');
    try {
      ctx.drawImage(v, 0, 0, cv.width, cv.height);
    } catch (e) {
      return null;
    }
    return cv;
  }

  /* seeked 之后再等一帧真正呈现 */
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

  function settle(v, t) {
    return new Promise(function (res) {
      var to = 0, poll = 0, done = false;
      function fin() {
        if (done) { return; }
        done = true;
        clearTimeout(to);
        clearTimeout(poll);
        v.removeEventListener('seeked', fin);
        res();
      }
      function check() {
        if (done) { return; }
        if (v.readyState >= 2 && Math.abs((v.currentTime || 0) - t) < 0.02) { fin(); return; }
        poll = setTimeout(check, 50);
      }
      v.addEventListener('seeked', fin);
      to = setTimeout(fin, 900);
      check();
    }).then(function () { return frameReady(v); });
  }

  function seekTo(t) {
    var v = playerVideo();
    if (!v) { return Promise.resolve(); }
    var p = null;
    if (RR.player && typeof RR.player.seek === 'function') {
      try { p = RR.player.seek(t); } catch (e) { p = null; }
    } else {
      try { v.currentTime = t; } catch (e) { }
    }
    return Promise.resolve(p).then(function () { return settle(v, t); });
  }

  /* ---------- 对外：开 / 步进 / 保存 / 关 ---------- */
  function open() {
    build();
    if (RR.preview && typeof RR.preview.close === 'function') {
      try { RR.preview.close(); } catch (e) { }
    }
    var v = playerVideo();
    if (!v || !v.videoWidth) {
      RR.toast('画面还没出来，等一秒再截', 'err');
      return false;
    }
    S.wasPlaying = !v.paused;
    if (S.wasPlaying && RR.player && typeof RR.player.pause === 'function') {
      try { RR.player.pause(); } catch (e) { }
    }
    var f = capture();
    if (!f) {
      RR.toast('这一帧取不到，稍后再试', 'err');
      if (S.wasPlaying && RR.player && typeof RR.player.resume === 'function') {
        try { RR.player.resume(); } catch (e) { }
      }
      S.wasPlaying = false;
      return false;
    }
    S.frame = f;
    S.time = v.currentTime || 0;
    S.open = true;
    S.busy = false;
    paint();
    hint('', false);
    S.node.hidden = false;
    document.body.classList.add('rr-shot-open');
    bindKeys();
    return true;
  }

  function step(delta) {
    if (!S.open) { return false; }
    var v = playerVideo();
    if (!v) { return false; }
    /* 逐帧要稳定：万一播放被外部恢复（同步循环 / 桥接），先按回暂停 */
    if (!v.paused && RR.player && typeof RR.player.pause === 'function') {
      try { RR.player.pause(); } catch (e) { }
    }
    var sign = delta < 0 ? -1 : 1;
    var d = (isFinite(v.duration) && v.duration > 0) ? v.duration : 0;
    var next = S.time + sign * FRAME;
    if (d) { next = Math.min(next, d - 0.03); }
    next = Math.max(0, next);
    if (Math.abs(next - S.time) < 1e-4) { return false; }
    S.time = next;
    if (S.timeEl) { S.timeEl.textContent = fmtPrecise(S.time); }
    S.busy = true;
    seekTo(next).then(function () {
      if (!S.open) { return; }
      var vv = playerVideo();
      var f = capture();
      if (f) {
        S.frame = f;
        if (vv) { S.time = vv.currentTime || S.time; }
        paint();
      }
      S.busy = false;
    }, function () {
      S.busy = false;
      hint('这一帧没取到，再点一次', true);
    });
    return true;
  }

  function download(dataUrl, name) {
    try {
      var a = document.createElement('a');
      a.href = dataUrl;
      a.download = name;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { if (a.parentNode) { a.parentNode.removeChild(a); } }, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

  function finish(msg, isErr) {
    close();
    RR.toast(msg, isErr ? 'err' : undefined);
  }

  function save() {
    if (!S.open || !S.frame) { return false; }
    var dataUrl = '';
    try { dataUrl = S.frame.toDataURL('image/png'); } catch (e) { dataUrl = ''; }
    var b64 = dataUrl ? String(dataUrl).split(',')[1] : '';
    if (!b64) {
      hint('这一帧存不下来，换个位置再截一次', true);
      RR.toast('这一帧存不下来', 'err');
      return false;
    }
    var name = fileName();
    var BR = window.AndroidRadio;
    if (BR && typeof BR.saveImage === 'function') {
      var ret = null;
      try {
        ret = BR.saveImage(b64, name);
      } catch (e) {
        hint('存进相册失败，可以再试一次', true);
        RR.toast('存进相册失败', 'err');
        return false;
      }
      Promise.resolve(ret).then(function (r) {
        var s = String(r == null ? 'ok' : r);
        if (/^err/i.test(s)) {
          finish('存进相册失败：' + s.replace(/^err:?/i, '').replace(/^\s+/, ''), true);
        } else {
          finish('已存到相册', false);
        }
      }, function () {
        finish('存进相册失败，可以再试一次', true);
      });
      return true;
    }
    /* 没有桥接（浏览器里调试 / 老版本 APK）：降级成下载 */
    if (!download(dataUrl, name)) {
      hint('这个环境不能直接下载，长按图片保存试试', true);
      RR.toast('这个环境不能直接下载', 'err');
      return false;
    }
    finish('已下载这张截图', false);
    return true;
  }

  function close() {
    if (!S.open) { return; }
    S.open = false;
    S.busy = false;
    if (S.node) { S.node.hidden = true; }
    document.body.classList.remove('rr-shot-open');
    unbindKeys();
    S.frame = null;
    if (S.wasPlaying) {
      S.wasPlaying = false;
      var v = playerVideo();
      if (v && v.paused) {
        if (RR.player && typeof RR.player.resume === 'function') {
          try { RR.player.resume(); } catch (e) { }
        } else if (RR.player && typeof RR.player.toggle === 'function') {
          try { RR.player.toggle(); } catch (e) { }
        }
      }
    }
  }

  function onKey(e) {
    if (!S.open) { return; }
    var t = e.target;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '')) { return; }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  }

  function bindKeys() {
    if (S.keyed) { return; }
    S.keyed = true;
    document.addEventListener('keydown', onKey);
  }

  function unbindKeys() {
    if (!S.keyed) { return; }
    S.keyed = false;
    document.removeEventListener('keydown', onKey);
  }

  RR.shot = {
    open: open,
    step: step,
    save: save,
    close: close,
    mount: build,
    isOpen: function () { return S.open; },
    frame: function () { return S.frame; },
    time: function () { return S.time; }
  };

  if (RR.on) {
    RR.on('rr:route', function () { close(); });
  }
})();
