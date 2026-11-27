/* ============================================================
   05-motion.js · 动效（8.0）
   ① 顶栏滚动投影 / 减少动效 / 平滑滚动（7.x 保留）
   ② 按下反馈：WAAPI 只压独立的 scale 属性，不碰 transform ——
      悬浮位移、抽屉位移、定位用的 transform 都不会被覆盖
   ③ dock 指示胶囊：往 #dock 里插真实节点，按 offsetLeft/offsetWidth 落位
   视图进场的关键帧在 css/18-motion.css（只认 core 给的 .is-entering）
   ============================================================ */
(function () {
  'use strict';
  var RR = window.RR;

  /* 顶栏：滚过 4px 才加投影，避免静态时也带一层阴影 */
  var top = null, ticking = false;
  function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () {
      ticking = false;
      if (!top) top = RR.$('#top');
      if (top) top.classList.toggle('is-scrolled', window.scrollY > 4);
    });
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* 减少动效：设置项 + 系统偏好，两边都尊重 */
  function syncReduce() {
    var sys = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    document.documentElement.classList.toggle('reduce-motion', !!(RR.settings().reduceMotion || sys));
  }
  RR.on('settings', syncReduce);
  syncReduce();

  /* ============================================================
     ② 按下反馈
     小控件 .94、大块 .985，90ms 下压；松手 200ms 先过冲 1.015 再落回 1。
     只动 scale 属性：transform 留给元素自己的悬浮/定位/抽屉位移。
     ============================================================ */
  var PRESS = [
    'button', 'a[href]', '[role="button"]', '[role="tab"]',
    '.chip', '.cell', '.srow', '.pl-card', '.dy-card', '.ch-row', '.day-block',
    '.day-cell', '.pl-row', '.mon-cell__hit', '.dock__item', '.station',
    '.ch-tbtn', '.lv-qn'
  ].join(',');
  var DOWN_SMALL = 0.94, DOWN_BIG = 0.985, UP_OVER = 1.015;
  var EASE = 'cubic-bezier(.2,.8,.2,1)';
  var downNode = null, downAnim = null, downScale = DOWN_SMALL;

  function isReduced() {
    return document.documentElement.classList.contains('reduce-motion');
  }
  function pressTarget(t) {
    if (!t || !t.closest) return null;
    var n = t.closest(PRESS);
    if (!n) return null;
    /* 禁用态（含祖先上的 disabled / aria-disabled）不给反馈 */
    if (n.closest('[disabled],[aria-disabled="true"]')) return null;
    return n;
  }
  function pressScale(n) {
    var r = n.getBoundingClientRect();
    return (r.width > 300 || r.height > 180) ? DOWN_BIG : DOWN_SMALL;
  }
  /* 取当前实际 scale：松手时若下压动画还没走完，从这里接着回弹，不会跳一下 */
  function curScale(n, fallback) {
    try {
      var s = parseFloat(window.getComputedStyle(n).scale);
      if (s > 0 && s < 2) return s;
    } catch (e) { }
    return fallback;
  }
  function stopDown() {
    if (downAnim) { try { downAnim.cancel(); } catch (e) { } }
    downAnim = null;
    downNode = null;
  }
  function pressDown(e) {
    if (!e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var n = pressTarget(e.target);
    if (!n) return;
    if (n === downNode) return;
    /* 上一个还没松手（多点触控 / 事件丢失）：先让它正常回弹 */
    if (downNode) pressUp();
    downNode = n;
    var reduced = isReduced();
    downScale = reduced ? 1 : pressScale(n);
    var frames = reduced
      ? [{ opacity: 1 }, { opacity: .72 }]
      : [{ scale: curScale(n, 1) }, { scale: downScale }];
    try {
      downAnim = n.animate(frames, { duration: 90, easing: EASE, fill: 'forwards' });
    } catch (err) { downAnim = null; }
  }
  function pressUp() {
    var n = downNode, a = downAnim;
    if (!n) return;
    var reduced = isReduced();
    var from = reduced ? 1 : curScale(n, downScale);
    downNode = null; downAnim = null;
    /* 元素已被重绘/销毁（抽屉关闭、列表刷新）时只清动画，不再回弹 */
    if (!n.isConnected) { if (a) { try { a.cancel(); } catch (e) { } } return; }
    try {
      if (reduced) {
        /* 减少动效：只留透明度反馈 */
        n.animate([{ opacity: .72 }, { opacity: 1 }], { duration: 140, easing: EASE });
      } else {
        /* 两段（过冲 + 落定）用一个 200ms 动画表达；不 fill，结束后不留 scale */
        n.animate([
          { scale: from },
          { scale: UP_OVER, offset: .55 },
          { scale: 1 }
        ], { duration: 200, easing: EASE });
      }
    } catch (e2) { }
    if (a) { try { a.cancel(); } catch (e3) { } }
  }
  document.addEventListener('pointerdown', pressDown, { passive: true, capture: true });
  document.addEventListener('pointerup', pressUp, { passive: true, capture: true });
  document.addEventListener('pointercancel', pressUp, { passive: true, capture: true });
  window.addEventListener('blur', pressUp);
  /* 切后台时 pointerup 可能收不到：把下压态收回，避免回来还“按着” */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopDown();
  });

  /* ============================================================
     ③ dock 指示胶囊：真实节点 <span class="dock__pill">，不是伪元素
     dock 自己带 transform:translateX(-50%)，但 offsetLeft 是布局值、
     不受 transform 影响，所以「left:0 + translateX(offsetLeft)」始终对齐。
     ============================================================ */
  var pill = null, pillSeeded = false;

  function pillNode() {
    var dock = RR.$('#dock');
    if (!dock) return null;
    if (pill && pill.parentNode === dock) return pill;
    pill = dock.querySelector('.dock__pill');
    if (!pill) {
      pill = document.createElement('span');
      pill.className = 'dock__pill';
      pill.setAttribute('aria-hidden', 'true');
      dock.insertBefore(pill, dock.firstChild);
    }
    return pill;
  }

  /* animate=false：直接落位（首屏 / resize / 字体就绪），不播过渡 */
  function placePill(animate) {
    var dock = RR.$('#dock');
    if (!dock) return;
    var p = pillNode();
    if (!p) return;
    var btn = dock.querySelector('.dock__item[aria-selected="true"]');
    if (!btn) { p.style.opacity = '0'; return; }
    if (!animate) p.style.transition = 'none';
    p.style.opacity = '1';
    p.style.width = btn.offsetWidth + 'px';
    p.style.height = btn.offsetHeight + 'px';
    p.style.top = btn.offsetTop + 'px';
    p.style.transform = 'translate3d(' + btn.offsetLeft + 'px,0,0)';
    if (!animate) {
      void p.offsetWidth;   /* 先落到目标位置，再恢复过渡 */
      p.style.transition = '';
    }
  }

  /* 首次落位不播动画 */
  function syncPill(animate) {
    placePill(!!animate && pillSeeded);
    pillSeeded = true;
  }
  syncPill(false);

  /* 选中项变化：core 只改 aria-selected，这里监听属性即可，不依赖路由时序 */
  var dockHandled = false;
  try {
    if (window.MutationObserver) {
      new MutationObserver(function () { syncPill(true); }).observe(RR.$('#dock'), {
        attributes: true, attributeFilter: ['aria-selected'], subtree: true
      });
      dockHandled = true;
    }
  } catch (e4) { dockHandled = false; }
  if (!dockHandled) RR.on('route', function () { syncPill(true); });

  /* 横竖屏 / 尺寸变化后重新落位（不播动画，免得跟 dock 自身的布局抖动打架） */
  var reseat = RR.debounce(function () { placePill(false); }, 120);
  window.addEventListener('resize', reseat, { passive: true });
  window.addEventListener('orientationchange', reseat, { passive: true });
  /* 字体晚到会改按钮宽度：就绪后再对一次 */
  try {
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { placePill(false); });
  } catch (e5) { }

  /* 键盘用户才显示焦点环 */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') document.documentElement.classList.add('kb');
  }, true);
  document.addEventListener('pointerdown', function () {
    document.documentElement.classList.remove('kb');
  }, true);

  /* 平滑滚动到元素（自动避让顶栏） */
  RR.scrollToEl = function (el, offset) {
    if (!el) return;
    var y = el.getBoundingClientRect().top + window.scrollY - (offset || 64);
    window.scrollTo({ top: Math.max(0, y), behavior: document.documentElement.classList.contains('reduce-motion') ? 'auto' : 'smooth' });
  };
})();
