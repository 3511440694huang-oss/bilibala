/* ============================================================
   31-mini.js · 小窗播放 + 系统画中画（8.0）
   ------------------------------------------------------------
   硬约定（CONTRACT-800 §4-1 / §4-3）：
   - 唯一的 video 节点 #player 在 #ch-media 与 #mini-stage 之间**移动**，
     绝不 clone、绝不新建 video；位置只由 video.currentTime 决定。
   - 触发：路由离开 channel 且「当前有条目 + 在播」才自动出小窗；回频道还原。
   - 暂停 ≠ 结束：用户暂停时小窗留着（图标翻成 play），只有 stop() 才收掉。
   - #mini-close = RR.player.stop()（真的停播），不是单纯隐藏。
   - html.is-pip 由 window.__rrPip(on) 切，规则都在 css/17-mini.css。
   - 本文件不写任何 fixed 行内样式到 #player 上：样式全靠容器，还原时清干净。
   ============================================================ */
(function () {
  'use strict';
  var RR = window.RR;
  if (!RR) { return; }

  var M = {
    on: false, el: null, stage: null, title: null,
    btnToggle: null, btnClose: null, btnOpen: null,
    video: null, home: null, corner: null, safe: null,
    x: 0, y: 0, w: 0, h: 0,
    drag: null, dragged: false, suppressClick: 0,
    bound: false, pipWasMini: false
  };

  function byId(id) { return document.getElementById(id); }

  function safe(fn, tag) {
    try { return fn(); } catch (e) { if (window.__E) { __E.push('mini:' + (tag || '') + ':' + (e && e.message)); } }
    return undefined;
  }

  /* 节点接齐一次就够：shell.html 里的 #mini 是 lead 写死的，本文件只认它 */
  function ready() {
    if (M.el && M.stage) { return true; }
    M.el = byId('mini');
    M.stage = byId('mini-stage');
    M.title = byId('mini-title');
    M.btnToggle = byId('mini-toggle');
    M.btnClose = byId('mini-close');
    M.btnOpen = byId('mini-open');
    return !!(M.el && M.stage);
  }

  function videoEl() {
    if (M.video && M.video.parentNode) { return M.video; }
    M.video = byId('player');
    return M.video;
  }

  function state() {
    try { return (RR.player && RR.player.audioState()) || {}; } catch (e) { return {}; }
  }

  function playingNow(v) {
    if (v && !v.paused && !v.ended) { return true; }
    return !!state().playing;
  }

  /* 桥接会拦 video.play() 去重启原生；小窗只是换承载节点，不该让原生从头再来 */
  function keepNative(fn) {
    var prev = !!window.__rrKeepNative;
    window.__rrKeepNative = true;
    try { fn(); } catch (e) { }
    window.__rrKeepNative = prev;
  }

  function playQuiet(v) {
    if (!v) { return; }
    keepNative(function () {
      var p = v.play();
      if (p && p.catch) { p.catch(function () { }); }
    });
  }

  /* ---------- 几何：安全区 / 角落 / 位置 ---------- */
  function safeArea() {
    if (M.safe) { return M.safe; }
    M.safe = { t: 0, b: 0, l: 0, r: 0 };
    try {
      var probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:0;height:0;' +
        'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);' +
        'padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px)';
      document.body.appendChild(probe);
      var cs = getComputedStyle(probe);
      M.safe = {
        t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0,
        l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0
      };
      probe.remove();
    } catch (e) { }
    return M.safe;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function measure() {
    if (!ready()) { return false; }
    var w = M.el.offsetWidth, h = M.el.offsetHeight;
    if (!w || !h) { return false; }
    M.w = w;
    M.h = h;
    return true;
  }

  /* 四个角的可用坐标：右下角避开 dock（84px + 安全区），其余角留 12px */
  function bounds() {
    var s = safeArea();
    var gapR = 12 + s.r, gapL = 12 + s.l, gapT = 12 + s.t;
    var maxX = window.innerWidth - M.w - gapR;
    var maxY = window.innerHeight - M.h - 84 - s.b;
    return {
      left: gapL,
      right: Math.max(gapL, maxX),
      top: gapT,
      bottom: Math.max(gapT, maxY)
    };
  }

  function place(x, y) {
    if (!ready()) { return; }
    if (!M.w || !M.h) { if (!measure()) { return; } }
    var b = bounds();
    M.x = clamp(x, b.left, b.right);
    M.y = clamp(y, b.top, b.bottom);
    M.el.style.transform = 'translate3d(' + Math.round(M.x) + 'px,' + Math.round(M.y) + 'px,0)';
  }

  /* 吸附：不带动效时先挂 is-drag 再写位置（同一帧生效，绝不从 0,0 滑一下）；
     带动效时先摘掉 is-drag、下一帧再写位置，220ms 过渡才真的跑起来。 */
  function snapTo(corner, animate) {
    if (!M.w || !M.h) { if (!measure()) { return; } }
    var b = bounds();
    var x = corner.x === 'l' ? b.left : b.right;
    var y = corner.y === 't' ? b.top : b.bottom;
    if (!animate) {
      M.el.classList.add('is-drag');
      place(x, y);
      return;
    }
    M.el.classList.remove('is-drag');
    requestAnimationFrame(function () { if (M.el) { place(x, y); } });
  }

  function cornerOf(x, y) {
    var cx = x + M.w / 2, cy = y + M.h / 2;
    return { x: cx < window.innerWidth / 2 ? 'l' : 'r', y: cy < window.innerHeight / 2 ? 't' : 'b' };
  }

  function wantCorner() {
    if (!M.corner) {
      var saved = RR.store ? RR.store.get('miniCorner', null) : null;
      M.corner = (saved && (saved.x === 'l' || saved.x === 'r') && (saved.y === 't' || saved.y === 'b'))
        ? { x: saved.x, y: saved.y } : { x: 'r', y: 'b' };
    }
    return M.corner;
  }

  /* 容器固定在 left/top:0，靠 transform 定位；先把 CSS 的 right/bottom 交出来，
     否则两个方向的定位会叠加。只做一次，重复调用无副作用。 */
  function detachEdges() {
    if (!ready()) { return; }
    if (M.el.style.right === 'auto') { return; }
    M.el.style.left = '0px';
    M.el.style.top = '0px';
    M.el.style.right = 'auto';
    M.el.style.bottom = 'auto';
  }

  /* ---------- 图标 / 标题 ---------- */
  function paintToggle(on) {
    if (!M.btnToggle) { return; }
    var key = on ? 'pause' : 'play';
    if (M.btnToggle.getAttribute('data-state') !== key) {
      M.btnToggle.setAttribute('data-state', key);
      M.btnToggle.innerHTML = RR.ICO(key);
    }
    M.btnToggle.setAttribute('aria-label', on ? '暂停' : '播放');
  }

  function sync() {
    if (!ready()) { return; }
    var s = state();
    if (!s.item || s.stopped || s.error) { hide(); return; }   /* 真的停了：立刻收窗 */
    if (!M.on) { return; }
    var t = s.title || s.item.title || '正在播放';
    if (M.title && M.title.textContent !== t) {
      M.title.textContent = t;
      M.title.setAttribute('title', t);
    }
    paintToggle(playingNow(videoEl()));
  }

  /* ---------- 打开 / 关闭 ---------- */
  function open(force) {
    if (!ready()) { return false; }
    var s = state();
    if (!s.item || s.stopped || s.error) { return false; }
    /* 自动出现只在真的在播时；用户自己点开（public show）允许暂停态 */
    if (!force && !(s.playing || s.loading)) { return false; }
    if (M.on) { sync(); return true; }
    if (RR.player && typeof RR.player.fullscreen === 'function' && RR.player.fullscreen()) {
      safe(function () { RR.player.setFullscreen(false); }, 'exitfs');
    }
    var v = videoEl();
    if (!v || !v.parentNode) { return false; }
    if (M.stage.contains(v)) { M.on = true; M.el.hidden = false; sync(); return true; }

    var wasPlaying = playingNow(v);
    M.drag = null;
    M.dragged = false;
    M.suppressClick = 0;
    M.home = { parent: v.parentNode, next: v.nextSibling };
    M.el.hidden = false;
    detachEdges();
    M.el.classList.add('is-drag');          /* 第一次定位不要从 0,0 滑过来 */
    measure();
    snapTo(wantCorner(), false);
    M.stage.appendChild(v);                 /* 移动，不复制、不新建 */
    M.on = true;
    sync();
    if (wasPlaying) {
      playQuiet(v);
      /* 节点离开文档时浏览器会「稳定态后」暂停一次；补一枪并让 syncNative 兜底 */
      setTimeout(function () {
        if (M.on && wasPlaying && v.paused && RR.player && RR.player.isPlaying && RR.player.isPlaying()) { playQuiet(v); }
      }, 80);
    }
    requestAnimationFrame(function () { if (M.el) { M.el.classList.remove('is-drag'); } });
    RR.emit('rr:mini', { on: true });
    return true;
  }

  /* 把 video 插回频道的 #ch-media（.ch-hold 之前），并擦掉任何行内残留 */
  function restore() {
    var v = videoEl();
    if (!v) { return false; }
    var home = M.home;
    /* 兜底：home 丢了但画面还在小窗里，就按 DOM 约定插回 #ch-hold 之前 */
    if (!home && M.stage && M.stage.contains(v)) {
      var media = byId('ch-media');
      if (media) { home = { parent: media, next: byId('ch-hold') }; }
    }
    var back = false;
    if (home && home.parent) {
      if (v.parentNode !== home.parent) {
        if (home.next && home.next.parentNode === home.parent) { home.parent.insertBefore(v, home.next); }
        else { home.parent.appendChild(v); }
        back = true;
      }
    }
    M.home = null;
    var props = ['position', 'inset', 'left', 'top', 'right', 'bottom', 'width', 'height',
      'transform', 'border-radius', 'box-shadow', 'object-fit', 'z-index', 'margin'];
    for (var i = 0; i < props.length; i++) { try { v.style.removeProperty(props[i]); } catch (e) { } }
    return back;
  }

  function hide() {
    if (!ready()) { return false; }
    var was = M.on;
    M.drag = null;
    M.dragged = false;
    var v = videoEl();
    var wasPlaying = v ? playingNow(v) : false;
    restore();                              /* 幂等：已经在原位就只是擦行内样式 */
    M.on = false;
    M.el.hidden = true;
    M.el.classList.remove('is-drag');
    if (was) {
      safe(function () { if (RR.player && RR.player.repaint) { RR.player.repaint(); } }, 'repaint');
      if (wasPlaying) {
        playQuiet(v);
        setTimeout(function () {
          if (!M.on && wasPlaying && v && v.paused && RR.player && RR.player.isPlaying && RR.player.isPlaying()) { playQuiet(v); }
        }, 80);
      }
      RR.emit('rr:mini', { on: false });
    }
    return was;
  }

  /* 关闭 = 真的停播（不是藏起来），并确保画面已经还回频道 */
  function close() {
    M.on = false;
    safe(function () { if (RR.player && RR.player.stop) { RR.player.stop(); } }, 'stop');
    hide();
  }

  /* ---------- 拖动：>6px 才算拖，拖过就不导航 ---------- */
  function endDrag(commit) {
    if (!M.drag) { return; }
    var dragged = M.dragged;
    M.drag = null;
    M.dragged = false;
    if (!dragged) { M.el.classList.remove('is-drag'); return; }
    M.suppressClick = Date.now() + 450;
    var c = cornerOf(M.x, M.y);
    M.corner = { x: c.x, y: c.y };
    if (RR.store) { safe(function () { RR.store.set('miniCorner', M.corner); }, 'corner'); }
    if (commit) { snapTo(M.corner, true); }
    else { M.el.classList.remove('is-drag'); }
  }

  function bindDrag() {
    M.el.addEventListener('pointerdown', function (e) {
      if (e.button && e.button !== 0) { return; }
      var t = e.target;
      if (t && t.closest && t.closest('#mini-toggle,#mini-close')) { return; }   /* 条上的按钮不拖 */
      M.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, bx: M.x, by: M.y };
      M.dragged = false;
    }, { passive: true });

    document.addEventListener('pointermove', function (e) {
      var d = M.drag;
      if (!d || e.pointerId !== d.id) { return; }
      var dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!M.dragged) {
        if (dx * dx + dy * dy < 36) { return; }     /* 6px 内算点击 */
        M.dragged = true;
        M.el.classList.add('is-drag');
      }
      if (e.cancelable) { e.preventDefault(); }
      place(d.bx + dx, d.by + dy);
    }, { capture: true, passive: false });

    document.addEventListener('pointerup', function (e) {
      if (!M.drag || e.pointerId !== M.drag.id) { return; }
      endDrag(true);
    }, true);

    document.addEventListener('pointercancel', function (e) {
      if (!M.drag || e.pointerId !== M.drag.id) { return; }
      endDrag(false);
    }, true);

    window.addEventListener('resize', function () {
      M.safe = null;
      if (!M.on) { return; }
      measure();
      snapTo(wantCorner(), false);
    }, { passive: true });
    window.addEventListener('orientationchange', function () {
      M.safe = null;
      if (!M.on) { return; }
      setTimeout(function () { if (M.on) { measure(); snapTo(wantCorner(), false); } }, 260);
    }, { passive: true });
  }

  /* ---------- 绑定 ---------- */
  function bind() {
    if (M.bound || !ready()) { return; }
    M.bound = true;

    if (M.btnClose) {
      M.btnClose.innerHTML = RR.ICO('close');
      M.btnClose.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (Date.now() < M.suppressClick) { return; }
        close();
      });
    }
    if (M.btnToggle) {
      paintToggle(false);
      M.btnToggle.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (Date.now() < M.suppressClick) { return; }
        if (RR.player && RR.player.toggle) { RR.player.toggle(); }
        setTimeout(sync, 0);
      });
    }
    if (M.btnOpen) {
      M.btnOpen.addEventListener('click', function (e) {
        if (Date.now() < M.suppressClick) { e.preventDefault(); e.stopPropagation(); return; }
        e.preventDefault();
        RR.go('channel');
      });
    }

    bindDrag();

    /* 播放态/暂停态已经由内核广播，图标与标题跟着它走，不轮询 */
    RR.on('playing', function () { safe(sync, 'playing'); });
    RR.on('station', function () { safe(sync, 'station'); });

    RR.on('route', function (d) {
      safe(function () {
        var to = d && d.to;
        if (to === 'channel') { hide(); return; }
        var s = state();
        if (s.item && !s.stopped && !s.error && (s.playing || s.loading)) { open(false); }
        else { sync(); }
      }, 'route');
    });

    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) { safe(sync, 'visible'); }
    });
  }

  /* ---------- 系统画中画：只切 html.is-pip，样式全在 css/17-mini.css ----------
     原生 PiP 里 WebView 会整块缩小：这时把小窗收回 #view-channel，让
     「#view-channel 铺满 + video contain」这套规则有画面可铺。
     进入 PiP 时若不在频道，先回频道（否则 PiP 窗口里是歌单/监控页，看不到画面）；
     退出 PiP 不往回跳，停在频道即可。 */
  var prevPip = window.__rrPip;
  window.__rrPip = function (on) {
    on = !!on;
    document.documentElement.classList.toggle('is-pip', on);
    safe(function () {
      if (on) {
        M.pipWasMini = !!M.on;
        var off = !!(RR.route && RR.route() !== 'channel');
        if (M.on) { hide(); }
        if (off) { try { RR.go('channel'); } catch (e) { } }
      } else if (M.pipWasMini) {
        M.pipWasMini = false;
        if (RR.route && RR.route() !== 'channel') { open(true); }
      }
    }, 'pip');
    if (typeof prevPip === 'function') {
      try { return prevPip.apply(this, arguments); } catch (e) { }
    }
    return on;
  };

  /* ---------- 8.1 原生悬浮窗（盖在别的 App 上方） ----------
     原生关窗或回 App 时回调：
       __rrOverlay(false, pos)  pos >= 0：带位置回来，接着播；pos < 0：用户主动关闭，停止。
     进窗时网页这路已经 pause，这里只负责把状态接回来。 */
  window.__rrOverlay = function (on, pos) {
    if (on) {
      /* 小窗已经接上：网页这路必须让位——回放的声音在原生（已被服务停掉），
         直播的声音在 <video> 自己身上，不静音就会和悬浮窗一起响。 */
      safe(function () {
        var route = RR.route ? RR.route() : '';
        if (route === 'live' && RR.live && RR.live.mute) {
          try { RR.live.mute(); } catch (e) { }
        }
        if (RR.player && RR.player.pause) {
          try { RR.player.pause(); } catch (e) { }
        }
        ['player', 'live-video'].forEach(function (id) {
          var v = document.getElementById(id);
          if (!v) { return; }
          try { v.muted = true; v.pause(); } catch (e) { }
        });
      }, 'overlay-on');
      return;
    }
    safe(function () {
      pos = Number(pos);
      var closed = isFinite(pos) && pos < 0;
      if (closed) {
        if (RR.player && RR.player.stop) { try { RR.player.stop(); } catch (e) { } }
        return;
      }
      var route = RR.route ? RR.route() : '';
      if (route === 'live' && RR.live && RR.live.reconnect) {
        try { RR.live.reconnect(); } catch (e) { }
        return;
      }
      if (RR.player && RR.player.nowPlaying) {
        var np = RR.player.nowPlaying();
        if (!np) { return; }
        if (isFinite(pos) && pos >= 0) {
          try { RR.player.seek(pos / 1000); } catch (e) { }
        }
        try { RR.player.resume(); } catch (e) { }
      }
    }, 'overlay');
  };

  RR.mini = {
    show: function () { return open(true); },
    hide: hide,
    isOn: function () { return !!M.on; },
    sync: function () { safe(sync, 'sync'); },
    close: close
  };

  function boot() {
    if (!ready()) { return; }
    bind();
    safe(sync, 'boot');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
