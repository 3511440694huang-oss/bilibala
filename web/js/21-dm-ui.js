/* ============================================================
   21-dm-ui.js · 弹幕输入条 + 设置面板（频道页 / 横屏）
   - 竖屏：输入框常驻在播放卡底部，Enter 或「发送」发出
   - 横屏（#view-channel.is-fs）：收起时是一枚「发个弹幕」胶囊，
     点开才展开输入行；展开/收起/聚焦都不暂停视频（不碰 player/video）
   - 设置 5 项全部调 RR.danmaku.setXxx → RR.saveSettings 持久化，实时生效
   - pointerdown 一律不 preventDefault（只监听 click/input/keydown）
   ============================================================ */
(function () {
  'use strict';
  var RR = window.RR;
  if (!RR) { return; }

  var U = {
    mounted: false, tries: 0, root: null, stage: null,
    bar: null, pill: null, edit: null, inp: null, send: null, gear: null, fold: null,
    pop: null, sw: null, op: null, opv: null, sp: null, spv: null, sz: null, ar: null,
    note: null, noteBtn: null, ro: null,
    open: false, sending: false, composing: false, statusProbed: false, lpTouched: false
  };

  var SIZE_OPTS = [[.8, '小'], [1, '标准'], [1.25, '大'], [1.5, '特大']];
  var AREA_OPTS = [['all', '全屏'], ['scroll', '滚动'], ['top', '顶部'], ['bottom', '底部']];
  /* 横屏只有 390 高：弹幕字号基准降 10%（只改运行时，不写 settings；退出横屏立刻还原） */
  var FS_DM_FACTOR = .9;
  var FS_CHROME_GAP = 8;   /* 与 gesture 横屏底部 chrome 的间距 */
  var FS_POP_GAP = 8;      /* 设置面板底边与进度条的间距 */
  var FS_POP_TOP = 8;      /* 面板顶多长到视口上沿 8px，再高就面板内滚动 */

  function settings() { try { return RR.settings ? RR.settings() : {}; } catch (e) { return {}; } }
  function eng() { return RR.danmaku; }
  function el(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  /* ---------- 建 DOM ---------- */
  function build() {
    if (U.mounted) { return; }
    var root = el('view-channel');
    if (!root) {
      if (U.tries++ < 20) { setTimeout(build, 300); }
      return;
    }
    if (el('dm-bar')) { U.mounted = true; bindExisting(); return; }
    var stage = el('ch-stage') || root.querySelector('.ch-stage');
    var media = el('ch-media') || root.querySelector('.ch-media');
    var host = stage || (media && media.parentElement) || root.querySelector('.ch__main') || root;
    if (!host) {
      if (U.tries++ < 20) { setTimeout(build, 300); }
      return;
    }

    var bar = document.createElement('div');
    bar.className = 'dm-bar';
    bar.id = 'dm-bar';
    bar.innerHTML =
      '<button class="dm-pill" id="dm-pill" type="button" aria-label="发个弹幕" aria-expanded="false">' +
      '<span data-ico="chat"></span><span class="dm-pill__t">发个弹幕</span></button>' +
      '<div class="dm-edit">' +
      '<label class="sr-only" for="dm-inp">弹幕内容</label>' +
      '<input class="dm-inp" id="dm-inp" type="text" maxlength="100" autocomplete="off" enterkeyhint="send" placeholder="发个弹幕…">' +
      '<button class="dm-send" id="dm-send" type="button" aria-label="发送弹幕">发送</button>' +
      '<button class="dm-gear" id="dm-gear" type="button" aria-label="弹幕设置" aria-haspopup="dialog" aria-expanded="false"><span data-ico="gear"></span></button>' +
      '<button class="dm-fold" id="dm-fold" type="button" aria-label="收起弹幕输入"><span data-ico="chevron"></span></button>' +
      '</div>' +
      '<p class="dm-note" id="dm-note" hidden><span>先在设置里扫码登录</span>' +
      '<button class="dm-note__btn" id="dm-note-btn" type="button">去登录</button></p>' +
      '<div class="dm-pop" id="dm-pop" role="dialog" aria-modal="false" aria-label="弹幕设置" hidden>' +
      '<div class="dm-pop__head"><b>弹幕设置</b><span>改完立即生效</span>' +
      '<button class="dm-pop__x" id="dm-pop-x" type="button" aria-label="关闭弹幕设置"><span data-ico="close"></span></button></div>' +
      '<div class="dm-prow"><span class="dm-plabel">显示弹幕</span>' +
      '<span class="dm-pctrl"><button class="dm-sw" id="dm-sw" type="button" role="switch" aria-checked="true" aria-label="显示弹幕"></button></span></div>' +
      '<div class="dm-prow"><span class="dm-plabel">透明度</span>' +
      '<span class="dm-pctrl"><input class="dm-rng" id="dm-op" type="range" min="15" max="100" step="1" aria-label="弹幕透明度">' +
      '<output class="dm-val" id="dm-op-v" for="dm-op">85%</output></span></div>' +
      '<div class="dm-prow"><span class="dm-plabel">速度</span>' +
      '<span class="dm-pctrl"><input class="dm-rng" id="dm-sp" type="range" min="50" max="200" step="5" aria-label="弹幕速度">' +
      '<output class="dm-val" id="dm-sp-v" for="dm-sp">1.0×</output></span></div>' +
      '<div class="dm-prow"><span class="dm-plabel">字号</span>' +
      '<span class="dm-pctrl"><span class="dm-chips" id="dm-sz" role="group" aria-label="弹幕字号">' +
      SIZE_OPTS.map(function (o) {
        return '<button class="dm-chip" type="button" data-v="' + o[0] + '" aria-pressed="false">' + o[1] + '</button>';
      }).join('') + '</span></span></div>' +
      '<div class="dm-prow"><span class="dm-plabel">显示区域</span>' +
      '<span class="dm-pctrl"><span class="dm-chips" id="dm-ar" role="group" aria-label="弹幕显示区域">' +
      AREA_OPTS.map(function (o) {
        return '<button class="dm-chip" type="button" data-v="' + o[0] + '" aria-pressed="false">' + o[1] + '</button>';
      }).join('') + '</span></span></div>' +
      '</div>';

    /* 放在 ch-body 之后：竖屏是卡片底行，横屏由 CSS 变浮层 */
    var body = host.querySelector ? host.querySelector('.ch-body') : null;
    if (body && body.parentNode === host && body.nextSibling) { host.insertBefore(bar, body.nextSibling); }
    else { host.appendChild(bar); }

    U.root = root; U.stage = host;
    U.bar = bar;
    U.pill = el('dm-pill'); U.edit = bar.querySelector('.dm-edit');
    U.inp = el('dm-inp'); U.send = el('dm-send'); U.gear = el('dm-gear'); U.fold = el('dm-fold');
    U.pop = el('dm-pop'); U.sw = el('dm-sw'); U.op = el('dm-op'); U.opv = el('dm-op-v');
    U.sp = el('dm-sp'); U.spv = el('dm-sp-v'); U.sz = el('dm-sz'); U.ar = el('dm-ar');
    U.note = el('dm-note'); U.noteBtn = el('dm-note-btn');

    if (RR.iconize) { RR.iconize(bar); }
    bindExisting();
    U.mounted = true;
    U.tries = 0;
    paint();
    probeLogin();
    observeAway();
    place();
    watchChrome();
    syncFsDmScale();
    window.addEventListener('resize', place, { passive: true });
    window.addEventListener('orientationchange', place, { passive: true });
  }

  function bindExisting() {
    var bar = el('dm-bar');
    if (!bar || bar.getAttribute('data-bound') === '1') { return; }
    bar.setAttribute('data-bound', '1');
    U.bar = bar;
    U.pill = el('dm-pill'); U.inp = el('dm-inp'); U.send = el('dm-send');
    U.gear = el('dm-gear'); U.fold = el('dm-fold');
    U.pop = el('dm-pop'); U.sw = el('dm-sw'); U.op = el('dm-op'); U.opv = el('dm-op-v');
    U.sp = el('dm-sp'); U.spv = el('dm-sp-v'); U.sz = el('dm-sz'); U.ar = el('dm-ar');
    U.note = el('dm-note'); U.noteBtn = el('dm-note-btn');

    on(U.pill, 'click', open);
    on(U.fold, 'click', function () { close(); });
    on(U.send, 'click', doSend);
    on(U.gear, 'click', function (e) {
      e.stopPropagation();
      if (U.pop.hidden) { openPop(); } else { closePop(); }
    });
    on(el('dm-pop-x'), 'click', closePop);

    on(U.inp, 'keydown', function (e) {
      if (e.key === 'Enter' && !U.composing && e.keyCode !== 229) {
        e.preventDefault();
        doSend();
      }
    });
    on(U.inp, 'compositionstart', function () { U.composing = true; });
    on(U.inp, 'compositionend', function () { U.composing = false; });
    on(U.inp, 'focus', function () { U.bar.classList.add('is-focus'); });
    on(U.inp, 'blur', function () { U.bar.classList.remove('is-focus'); });
    on(U.sw, 'click', function () {
      var on = settings().dmOn !== false;
      if (eng()) { eng().setEnabled(!on); }
      paint();
    });
    bindRange(U.op, function (v) { return eng() && eng().setOpacity(v / 100, false); },
      function (v) { return eng() && eng().setOpacity(v / 100, true); },
      function (v) { U.opv.textContent = Math.round(v) + '%'; });
    bindRange(U.sp, function (v) { return eng() && eng().setSpeed(v / 100, false); },
      function (v) { return eng() && eng().setSpeed(v / 100, true); },
      function (v) { U.spv.textContent = (v / 100).toFixed(1) + '×'; });

    bindChips(U.sz, function (btn) {
      var v = parseFloat(btn.getAttribute('data-v'));
      if (eng()) { eng().setSize(v); }
      /* 点的是当前已选档（settings 不变、不会发 settings 事件）时也要把横屏的 0.9 补回去 */
      syncFsDmScale();
      paint();
    });
    bindChips(U.ar, function (btn) {
      var v = btn.getAttribute('data-v');
      if (eng()) { eng().setArea(v); }
      paint();
    });

    /* 传输条上的「弹幕」键：长按直达设置面板（短按仍由播放内核开关弹幕） */
    var dmBtn = document.getElementById('ch-dm'), lpTimer = 0;
    if (dmBtn) {
      dmBtn.addEventListener('pointerdown', function () {
        clearTimeout(lpTimer);
        lpTimer = setTimeout(function () {
          U.lpTouched = true;
          openSettings();
        }, 520);
      }, { passive: true });
      ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
        dmBtn.addEventListener(ev, function () { clearTimeout(lpTimer); }, { passive: true });
      });
      dmBtn.addEventListener('click', function (e) {
        if (!U.lpTouched) { return; }
        U.lpTouched = false;
        e.stopPropagation();
        e.preventDefault();
      }, true);
    }

    if (U.noteBtn) {
      U.noteBtn.addEventListener('click', function () {
        if (RR.go) { RR.go('me'); }
        if (RR.toast) { RR.toast('在「我的」里点扫码登录'); }
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') { return; }
      if (U.pop && !U.pop.hidden) { closePop(); return; }
      if (U.open && isFs()) { close(); }
    }, true);
    document.addEventListener('pointerdown', function (e) {
      if (!U.pop || U.pop.hidden) { return; }
      var t = e.target;
      if (U.pop.contains(t) || (U.gear && U.gear.contains(t))) { return; }
      closePop();
    }, true);

    if (RR.on) {
      RR.on('settings', function () { paint(); syncFsDmScale(); });
      RR.on('dm-sent', hideNote);
      RR.on('route', function (d) {
        if (!d || d.to !== 'channel') { closePop(); close(); }
      });
      RR.on('fs', function () { place(); syncFsDmScale(); });
      RR.on('rr:fs', function () { place(); syncFsDmScale(); });
      RR.on('dm-size', function () { syncFsDmScale(); });   /* 别人直接 setSize 也把横屏系数补上 */
      RR.on('dm:settings', openSettings);
      RR.on('danmaku-settings', openSettings);
      RR.on('station', function () { closePop(); close(); });
    }
  }

  function on(node, evt, fn) {
    if (node) { node.addEventListener(evt, fn); }
  }
  function bindRange(input, live, commit, show) {
    if (!input) { return; }
    input.addEventListener('input', function () {
      var v = parseFloat(input.value);
      if (live) { live(v); }
      if (show) { show(v); }
      paintChips();
    });
    input.addEventListener('change', function () {
      var v = parseFloat(input.value);
      if (commit) { commit(v); }
      if (show) { show(v); }
    });
  }
  function bindChips(box, fn) {
    if (!box) { return; }
    box.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('.dm-chip') : null;
      if (!b || !box.contains(b)) { return; }
      fn(b);
    });
  }

  /* ---------- 开合 ---------- */
  function isFs() { return !!(U.root && U.root.classList.contains('is-fs')); }

  function open() {
    if (!U.bar) { return; }
    place();
    U.open = true;
    U.bar.classList.add('is-open');
    if (U.pill) { U.pill.setAttribute('aria-expanded', 'true'); }
    /* 只聚焦，不碰视频/播放内核 */
    requestAnimationFrame(function () {
      try { U.inp.focus({ preventScroll: true }); } catch (e) { try { U.inp.focus(); } catch (e2) { } }
    });
  }
  function close() {
    if (!U.bar) { return; }
    U.open = false;
    U.bar.classList.remove('is-open');
    if (U.pill) { U.pill.setAttribute('aria-expanded', 'false'); }
    if (U.inp && document.activeElement === U.inp) {
      try { U.inp.blur(); } catch (e) { }
    }
  }

  function openSettings() {
    /* 只开设置面板：不抢输入框焦点、不动播放 */
    openPop();
  }
  function openPop() {
    if (!U.pop) { return; }
    paint();
    /* 竖屏：先按输入条上沿算高度（is-pop 会把输入行 display:none，之后量就晚了） */
    if (!isFs()) { if (U.pop.style.bottom) { U.pop.style.bottom = ''; } fitPop(); }
    U.pop.hidden = false;
    /* 横屏：面板 fixed 钉在 chrome 上沿 8px，先摆位置再按可用高度钳 */
    if (isFs()) { popBottomFs(); fitPop(); }
    if (U.bar) { U.bar.classList.add('is-pop'); }
    if (U.gear) { U.gear.setAttribute('aria-expanded', 'true'); }
  }
  /* 竖屏：面板只能长到播放卡顶部为止，超了就在面板里滚 */
  function fitPop() {
    if (!U.pop) { return; }
    if (isFs()) { fitPopFs(); return; }
    var stageTop = U.stage ? U.stage.getBoundingClientRect().top : 0;
    var barTop = U.bar ? U.bar.getBoundingClientRect().top : 0;
    var avail = Math.max(180, Math.min(380, barTop - stageTop - 16));
    U.pop.style.maxHeight = Math.round(avail) + 'px';
  }
  /* 横屏：面板底边必须停在底部进度条（.ch-body）上沿 8px 之外，绝不压住它；
     390 高放不下就在面板内部滚动，不越界、不遮 chrome。 */
  function fitPopFs() {
    /* 面板底边 = chrome 上沿 - 8（见 popBottomFs）。用视口高 - chrome 高来算，
       不受 chrome 收起时 translateY(10px) 的影响，也不会出现测量抖动。 */
    var vh = window.innerHeight || 390;
    var avail = Math.max(96, Math.floor(vh - chromeH() - FS_POP_GAP - FS_POP_TOP));
    var mh = avail + 'px';
    if (U.pop.style.maxHeight !== mh) { U.pop.style.maxHeight = mh; }
  }
  /* 横屏面板的底边：钉在 chrome 上沿 8px（与输入条同一把尺子） */
  function popBottomFs() {
    if (!U.pop) { return; }
    var want = 'calc(' + (chromeH() + FS_POP_GAP) + 'px + env(safe-area-inset-bottom,0px))';
    if (U.pop.style.bottom !== want) { U.pop.style.bottom = want; }
  }

  function closePop() {
    if (!U.pop) { return; }
    U.pop.hidden = true;
    if (U.bar) { U.bar.classList.remove('is-pop'); }
    if (U.gear) { U.gear.setAttribute('aria-expanded', 'false'); }
  }

  /* 横屏：输入条贴在底部 chrome（.ch-body）上沿 8px，用它的真实高度算，不写死 */
  function chromeEl() { return U.stage ? U.stage.querySelector('.ch-body') : null; }
  function chromeH() {
    var b = chromeEl();
    var h = b ? Math.round(b.getBoundingClientRect().height) : 0;
    return (!h || h < 40) ? 150 : h;
  }
  function place() {
    if (!U.bar) { return; }
    if (U.pop && !U.pop.hidden) { if (isFs()) { popBottomFs(); } fitPop(); }
    if (!isFs()) {
      if (U.bar.style.bottom !== '') { U.bar.style.bottom = ''; }
      return;
    }
    var want = 'calc(' + (chromeH() + FS_CHROME_GAP) + 'px + env(safe-area-inset-bottom,0px))';
    if (U.bar.style.bottom !== want) { U.bar.style.bottom = want; }
  }

  /* 底部 chrome 会随 gesture 的显隐/过渡改高度：跟着量，始终留 8px、面板始终不压进度条 */
  function watchChrome() {
    if (U.ro || !window.ResizeObserver || !U.stage) { return; }
    var body = chromeEl();
    if (!body) { return; }
    try {
      U.ro = new ResizeObserver(function () {
        place();
        if (U.pop && !U.pop.hidden && isFs()) { popBottomFs(); fitPop(); }
      });
      U.ro.observe(body);
    } catch (e) { U.ro = null; }
  }

  /* 横屏弹幕字号基准 ×0.9：只改渲染层，不落盘、不动 settings；退出横屏马上还原 */
  function syncFsDmScale() {
    var d = eng();
    if (!d || typeof d.setSize !== 'function') { return; }
    var base = clamp(Number(settings().dmSize == null ? 1 : settings().dmSize), .6, 1.8);
    var want = isFs() ? clamp(Math.round(base * FS_DM_FACTOR * 100) / 100, .6, 1.8) : base;
    try { d.setSize(want, false); } catch (e) { }
  }

  /* 横屏播放器会把 ch-body 收起来（.is-away）：输入没聚焦时跟着收起，别挡画面 */
  function observeAway() {
    if (!U.root || !window.MutationObserver) { return; }
    try {
      var mo = new MutationObserver(function () {
        place();
        syncFsDmScale();
        if (!U.root.classList.contains('is-away')) { return; }
        if (U.open && document.activeElement !== U.inp && U.pop && U.pop.hidden) { close(); }
      });
      mo.observe(U.root, { attributes: true, attributeFilter: ['class'] });
    } catch (e) { }
  }

  /* ---------- 发送 ---------- */
  function doSend() {
    if (U.sending || !U.inp) { return; }
    var text = (U.inp.value || '').trim();
    if (!text) {
      if (RR.toast) { RR.toast('先写点什么'); }
      try { U.inp.focus(); } catch (e) { }
      return;
    }
    if (!eng() || !eng().send) { if (RR.toast) { RR.toast('弹幕还没准备好', 'err'); } return; }
    U.sending = true;
    var old = U.send ? U.send.textContent : '';
    if (U.send) { U.send.disabled = true; U.send.textContent = '发送中'; }
    eng().send(text).then(function () {
      if (U.inp) { U.inp.value = ''; }
      hideNote();
      if (RR.toast) { RR.toast('弹幕发出去了'); }
    }).catch(function (e) {
      var msg = (e && e.message) || '弹幕没发出去';
      if (e && e.code === 'need-login') { showNote(); }
      if (RR.toast) { RR.toast(msg, 'err'); }
    }).then(function () {
      U.sending = false;
      if (U.send) { U.send.disabled = false; U.send.textContent = old || '发送'; }
    });
  }

  function showNote() { if (U.note) { U.note.hidden = false; } }
  function hideNote() { if (U.note) { U.note.hidden = true; } }

  function probeLogin() {
    if (U.statusProbed || !RR.api) { return; }
    U.statusProbed = true;
    RR.api('/api/status').then(function (d) {
      if (d && d.logged === false) { showNote(); } else if (d && (d.logged === true || d.mid || d.uname)) { hideNote(); }
    }).catch(function () { });
  }

  /* ---------- 同步显示 ---------- */
  function paint() {
    var s = settings();
    var on = s.dmOn !== false;
    if (U.sw) { U.sw.setAttribute('aria-checked', on ? 'true' : 'false'); }
    if (U.op) {
      var op = Math.round(clamp(Number(s.dmOpacity == null ? .85 : s.dmOpacity) * 100, 0, 100));
      U.op.value = String(clamp(op, 15, 100));
      if (U.opv) { U.opv.textContent = U.op.value + '%'; }
    }
    if (U.sp) {
      var sp = clamp(Number(s.dmSpeed == null ? 1 : s.dmSpeed) * 100, 50, 200);
      U.sp.value = String(Math.round(sp / 5) * 5);
      if (U.spv) { U.spv.textContent = (U.sp.value / 100).toFixed(1) + '×'; }
    }
    paintChips();
  }

  function paintChips() {
    var s = settings();
    if (U.sz) {
      var size = clamp(Number(s.dmSize == null ? 1 : s.dmSize), .6, 1.8);
      setPressed(U.sz, function (v) { return Math.abs(parseFloat(v) - size) < .01; });
    }
    if (U.ar) {
      var area = s.dmArea || 'all';
      setPressed(U.ar, function (v) { return v === area; });
    }
  }
  function setPressed(box, fn) {
    var chips = box.querySelectorAll('.dm-chip'), i;
    for (i = 0; i < chips.length; i++) {
      chips[i].setAttribute('aria-pressed', fn(chips[i].getAttribute('data-v')) ? 'true' : 'false');
    }
  }

  /* ---------- 对外 ---------- */
  RR.dmUI = {
    mount: build,
    openSettings: openSettings,
    open: open,
    close: close,
    refresh: paint,
    el: function () { return U.bar; }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
  /* 视图在 boot 后才挂载的极端情况下再补一次（幂等） */
  setTimeout(build, 900);
})();
