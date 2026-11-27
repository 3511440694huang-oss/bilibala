/* ============================================================
   00-core.js · 共享运行时（lead 维护，视图只调用不要改）
   RR.$ RR.$$ RR.el RR.fmtTime RR.fmtCount RR.toast RR.sheet
   RR.api RR.post RR.store RR.settings RR.saveSettings RR.go RR.back
   RR.on RR.emit RR.stations RR.station RR.view RR.ICO RR.iconize
   ============================================================ */
(function () {
  'use strict';
  var RR = window.RR = { version: '8.2.0', modules: {}, _subs: {} };

  /* ---------- DOM ---------- */
  RR.$ = function (sel, root) { return (root || document).querySelector(sel); };
  RR.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  RR.el = function (tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  RR.clamp = function (v, a, b) { return v < a ? a : v > b ? b : v; };
  RR.debounce = function (fn, ms) { var t; return function () { var a = arguments, s = this; clearTimeout(t); t = setTimeout(function () { fn.apply(s, a); }, ms); }; };

  /* ---------- 格式化 ---------- */
  RR.fmtTime = function (sec) {
    sec = Math.max(0, Math.floor(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    var mm = h ? (m < 10 ? '0' + m : '' + m) : '' + m;
    var ss = s < 10 ? '0' + s : '' + s;
    return h ? h + ':' + mm + ':' + ss : mm + ':' + ss;
  };
  RR.fmtCount = function (n) {
    n = Number(n) || 0;
    if (n >= 1e8) return (n / 1e8).toFixed(1).replace(/\.0$/, '') + '亿';
    if (n >= 1e4) return (n / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
    return String(n);
  };
  RR.fmtAgo = function (ts) {
    var d = Math.max(0, (Date.now() / 1000) - Number(ts || 0));
    if (d < 60) return '刚刚';
    if (d < 3600) return Math.floor(d / 60) + ' 分钟前';
    if (d < 86400) return Math.floor(d / 3600) + ' 小时前';
    if (d < 86400 * 30) return Math.floor(d / 86400) + ' 天前';
    return new Date(Number(ts) * 1000).toLocaleDateString('zh-CN');
  };

  /* ---------- 图标（内联 SVG，stroke 1.75 圆头） ---------- */
  var P = {
    broadcast: '<path d="M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"/><path d="M6.4 6.4a7.9 7.9 0 0 0 0 11.2M17.6 6.4a7.9 7.9 0 0 1 0 11.2M3.5 3.5a12 12 0 0 0 0 17M20.5 3.5a12 12 0 0 1 0 17"/>',
    live: '<rect x="3" y="5.5" width="18" height="13" rx="3"/><path d="m10 10 4.5 2.5L10 15z"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/>',
    music: '<path d="M9 18V7.2l9-2v10.6"/><circle cx="6.6" cy="18" r="2.4"/><circle cx="15.6" cy="15.8" r="2.4"/>',
    grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/>',
    play: '<path d="M8.2 5.2v13.6L19 12z" fill="currentColor" stroke="none"/>',
    pause: '<rect x="7.4" y="5.2" width="3.4" height="13.6" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.2" y="5.2" width="3.4" height="13.6" rx="1.2" fill="currentColor" stroke="none"/>',
    back10: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4.5V9h4.5"/>',
    fwd10: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5V9h-4.5"/>',
    list: '<path d="M4 7h16M4 12h16M4 17h10"/>',
    expand: '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>',
    collapse: '<path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5"/>',
    chat: '<path d="M20.5 12c0 4.1-3.8 7.4-8.5 7.4-1 0-2-.2-2.9-.4L4 20.5l1.6-3.7C4.6 15.5 4 13.8 4 12c0-4.1 3.8-7.4 8.5-7.4S20.5 7.9 20.5 12Z"/>',
    user: '<circle cx="12" cy="8.4" r="3.9"/><path d="M4.8 20.2c1.2-3.5 3.9-5.4 7.2-5.4s6 1.9 7.2 5.4"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 14.5a7.7 7.7 0 0 0 0-5l1.6-1.3-2-3.4-1.9.8a7.6 7.6 0 0 0-4.3-2.5L12.4 1h-4l-.4 2.1a7.6 7.6 0 0 0-4.3 2.5l-1.9-.8-2 3.4L1.4 9.5a7.7 7.7 0 0 0 0 5l-1.6 1.3 2 3.4 1.9-.8a7.6 7.6 0 0 0 4.3 2.5L8.4 23h4l.4-2.1a7.6 7.6 0 0 0 4.3-2.5l1.9.8 2-3.4z" transform="translate(1.2 0) scale(.94)"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.4"/><path d="m15.6 15.6 4 4"/>',
    refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    chevron: '<path d="m6 9.5 6 6 6-6"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
    more: '<circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    volume: '<path d="M4 9.5h3l4-3.4v11.8l-4-3.4H4z"/><path d="M15 9a4 4 0 0 1 0 6M17.6 6.6a7.4 7.4 0 0 1 0 10.8"/>',
    mute: '<path d="M4 9.5h3l4-3.4v11.8l-4-3.4H4z"/><path d="m15.5 9.5 5 5M20.5 9.5l-5 5"/>',
    heart: '<path d="M12 20.2S4 15.4 4 9.9A4.2 4.2 0 0 1 12 7.6a4.2 4.2 0 0 1 8 2.3c0 5.5-8 10.3-8 10.3Z"/>',
    clockplus: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.6V12l2.6 1.5"/>',
    download: '<path d="M12 4v10m0 0 3.6-3.6M12 14l-3.6-3.6"/><path d="M5 17.5v1.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-1.5"/>',
    external: '<path d="M14 4h6v6"/><path d="M20 4 11 13"/><path d="M18.5 14v5a1.5 1.5 0 0 1-1.5 1.5H5.5A1.5 1.5 0 0 1 4 19V7.5A1.5 1.5 0 0 1 5.5 6H11"/>',
    trash: '<path d="M5 7h14M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.6 7.6 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.8-11.4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    link: '<path d="M10 13.8a4 4 0 0 0 5.7 0l2.6-2.6a4 4 0 0 0-5.7-5.7L11.3 6.8"/><path d="M14 10.2a4 4 0 0 0-5.7 0L5.7 12.8a4 4 0 0 0 5.7 5.7l1.3-1.3"/>',
    image: '<rect x="3.5" y="4.5" width="17" height="15" rx="3"/><circle cx="8.6" cy="9.6" r="1.5"/><path d="m4.5 17 4.8-4.4 3.6 3.2 2.6-2.4 3.6 3.6"/>',
    send: '<path d="M4.5 12 20 4.5 15.6 20l-3.4-5.4z"/><path d="m12.2 14.6 7.8-10.1"/>'
  };
  RR.ICO = function (name, size) {
    var d = P[name] || P.more;
    return '<svg viewBox="0 0 24 24" width="' + (size || 20) + '" height="' + (size || 20) +
      '" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + d + '</svg>';
  };
  RR.iconize = function (root) {
    RR.$$('[data-ico]', root || document).forEach(function (n) {
      if (n.dataset.iconized) return;
      n.innerHTML = RR.ICO(n.dataset.ico);
      n.dataset.iconized = '1';
    });
    RR.$$('[data-ico-slot]', root || document).forEach(function (n) {
      if (n.dataset.iconized) return;
      n.innerHTML = RR.ICO(n.dataset.icoSlot);
      n.dataset.iconized = '1';
    });
  };

  /* ---------- 存储 ---------- */
  var NS = 'rr7_';
  RR.store = {
    get: function (k, def) {
      try { var v = localStorage.getItem(NS + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
    },
    set: function (k, v) {
      try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) { }
    },
    del: function (k) { try { localStorage.removeItem(NS + k); } catch (e) { } }
  };

  /* ---------- 设置 ---------- */
  var DEF = {
    theme: 'dark', muted: false, rate: 1, qn: 0, dmOn: true, dmOpacity: .85, dmSize: 1,
    liveMuted: true, sleep: 0, reduceMotion: false, autoplay: true, monitorMuted: true,
    dmSpeed: 1, dmArea: 'all', subSize: 18, subColor: '#ffffff', subBg: .55, subPos: 'bottom',
    uiAutoHide: true, pip: true, resumeLast: true, overlayOn: true
  };
  var S = null;
  RR.settings = function () {
    if (!S) {
      var saved = RR.store.get('settings', {}) || {};
      S = {};
      for (var k in DEF) S[k] = (saved[k] === undefined ? DEF[k] : saved[k]);
    }
    return S;
  };
  RR.saveSettings = function (patch) {
    var s = RR.settings();
    for (var k in patch) s[k] = patch[k];
    RR.store.set('settings', s);
    RR.applyTheme();
    document.documentElement.classList.toggle('reduce-motion', !!s.reduceMotion);
    RR.emit('settings', s);
    return s;
  };
  RR.applyTheme = function () {
    var t = RR.settings().theme;
    if (t === 'system') t = (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches) ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    var m = document.querySelector('meta[name=theme-color]');
    if (m) m.setAttribute('content', t === 'light' ? '#F8FAFD' : '#131314');
  };
  if (window.matchMedia) {
    try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () { if (RR.settings().theme === 'system') RR.applyTheme(); }); } catch (e) { }
  }

  /* ---------- 事件 ---------- */
  RR.on = function (evt, fn) { (RR._subs[evt] || (RR._subs[evt] = [])).push(fn); return fn; };
  RR.off = function (evt, fn) {
    var a = RR._subs[evt]; if (!a) return;
    var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
  };
  RR.emit = function (evt, data) {
    var a = RR._subs[evt]; if (!a) return;
    a.slice().forEach(function (fn) { try { fn(data); } catch (e) { if (window.__E) __E.push('emit:' + evt + ':' + e.message); } });
  };

  /* ---------- 网络 ---------- */
  RR.api = function (path, opts) {
    opts = opts || {};
    var init = { method: opts.method || 'GET', headers: {}, cache: 'no-store' };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    }
    if (opts.timeout) {
      var ctl = new AbortController();
      init.signal = ctl.signal;
      setTimeout(function () { ctl.abort(); }, opts.timeout);
    }
    return fetch(path, init).then(function (r) {
      return r.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : {}; } catch (e) { data = { raw: txt }; }
        if (!r.ok) {
          var err = new Error((data && data.error) || ('请求失败 ' + r.status));
          err.status = r.status; err.data = data;
          throw err;
        }
        return data;
      });
    });
  };
  RR.post = function (path, body) { return RR.api(path, { method: 'POST', body: body }); };
  RR.ping = function () { return RR.api('/api/ping').catch(function () { return null; }); };

  /* ---------- toast ---------- */
  var toastTimer = 0;
  RR.toast = function (text, kind) {
    var n = RR.$('#toast'); if (!n) return;
    n.textContent = text;
    n.dataset.kind = kind === 'err' ? 'err' : '';
    n.hidden = false;
    requestAnimationFrame(function () { n.classList.add('is-on'); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      n.classList.remove('is-on');
      setTimeout(function () { n.hidden = true; n.dataset.kind = ''; }, 220);
    }, kind === 'err' ? 3200 : 2000);
  };

  /* ---------- 底部抽屉 ---------- */
  var sheetOpen = false, sheetDrag = null;
  RR.sheet = function (opt) {
    opt = opt || {};
    var sheet = RR.$('#sheet'), scrim = RR.$('#scrim'), body = RR.$('#sheet-body'), foot = RR.$('#sheet-foot');
    if (!sheet) return { close: function () { } };
    RR.$('#sheet-ttl').textContent = opt.title || '';
    body.innerHTML = '';
    if (opt.body instanceof Node) body.appendChild(opt.body);
    else body.innerHTML = opt.body || '';
    foot.innerHTML = '';
    (opt.actions || []).forEach(function (a) {
      var b = RR.el('button', 'btn ' + (a.primary ? 'btn--primary' : ''), a.label);
      b.type = 'button';
      b.addEventListener('click', function () { try { a.onClick && a.onClick(); } finally { if (a.keepOpen !== true) close(); } });
      foot.appendChild(b);
    });
    foot.hidden = !foot.children.length;
    scrim.hidden = false;
    sheet.hidden = false;
    RR.iconize(body); RR.iconize(foot); RR.iconize(sheet);
    requestAnimationFrame(function () { scrim.classList.add('is-on'); sheet.classList.add('is-on'); });
    sheetOpen = true;
    if (!opt.keepScroll) body.scrollTop = 0;
    return { close: close };
  };
  function close() {
    if (!sheetOpen) return;
    sheetOpen = false;
    var sheet = RR.$('#sheet'), scrim = RR.$('#scrim');
    sheet.classList.remove('is-on'); scrim.classList.remove('is-on');
    setTimeout(function () {
      if (sheetOpen) return;
      sheet.hidden = true; scrim.hidden = true;
      RR.$('#sheet-body').innerHTML = ''; RR.$('#sheet-foot').innerHTML = '';
    }, 300);
  }
  RR.closeSheet = close;
  RR.sheetOpen = function () { return sheetOpen; };

  /* ---------- 路由 ---------- */
  /* 8.1：24H（day）入口下线 —— 路由表不再收，旧深链 #/day 自动落回 channel */
  var ROUTES = ['channel', 'live', 'playlist', 'monitor', 'me'];
  var cur = '';
  var booted = false;
  RR.route = function () { return cur; };
  RR.go = function (name, params) {
    if (ROUTES.indexOf(name) < 0) return;
    if (params) RR.routeParams = params;
    if (name === cur && location.hash === '#/' + name) { return; }
    location.hash = '#/' + name;
  };
  RR.back = function () {
    if (history.length > 1) history.back(); else RR.go('channel');
  };
  function apply(name) {
    var from = cur;
    if (booted && from === name) {
      RR.modules[name] && RR.modules[name].enter && RR.modules[name].enter(RR.routeParams);
      return;
    }
    var oldEl = RR.$('#view-' + from), newEl = RR.$('#view-' + name);
    if (oldEl) { oldEl.classList.remove('is-active'); oldEl.hidden = true; }
    var om = RR.modules[from];
    if (om && om.leave) { try { om.leave(); } catch (e) { __E.push('leave:' + from + ':' + e.message); } }
    if (newEl) {
      newEl.hidden = false;
      // 强制回流，让进入动画每次都重新播
      void newEl.offsetWidth;
      newEl.classList.add('is-active');
      /* 8.0：给过渡层留一个稳定的钩子 —— 420ms 内保持 .is-entering，
         动画模块只认这个类，不猜路由时序 */
      newEl.classList.add('is-entering');
      clearTimeout(RR._enterTimer);
      RR._enterTimer = setTimeout(function () {
        var list = RR.$$('.view.is-entering');
        for (var i = 0; i < list.length; i++) list[i].classList.remove('is-entering');
      }, 420);
    }
    cur = name; booted = true;
    document.body.dataset.route = name;
    var nm = RR.modules[name];
    if (nm && nm.enter) { try { nm.enter(RR.routeParams); } catch (e) { __E.push('enter:' + name + ':' + e.message); } }
    RR.$$('#dock .dock__item').forEach(function (b) {
      var on = b.dataset.go === name;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (name !== 'me') window.scrollTo(0, 0);
    RR.emit('rr:route', { from: from, to: name });
    RR.emit('route', { from: from, to: name });
  }
  function fromHash() {
    var m = /^#\/([a-z0-9]+)/.exec(location.hash || '');
    var name = m ? m[1] : 'channel';
    return ROUTES.indexOf(name) < 0 ? 'channel' : name;
  }
  RR.view = function (name, mod) { RR.modules[name] = mod; };

  /* ---------- 主播 ---------- */
  var stations = [], curStation = null;
  RR.stations = function () { return stations; };
  RR.station = function () { return curStation; };
  RR.loadStations = function () {
    return RR.api('/api/stations').then(function (d) {
      stations = (d && d.stations) || [];
      var want = RR.store.get('station_id', '');
      curStation = stations.filter(function (s) { return s.id === want; })[0] ||
        stations.filter(function (s) { return s.main; })[0] || stations[0] || null;
      if (curStation) RR.store.set('station_id', curStation.id);
      RR.emit('station', curStation);
      return stations;
    }).catch(function () { return stations; });
  };
  RR.setStation = function (id) {
    var s = stations.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    curStation = s; RR.store.set('station_id', id);
    RR.emit('station', s);
  };
  RR.stationName = function () { return curStation ? (curStation.name || '这位主播') : '还没有主播'; };

  /* ---------- 启动 ---------- */
  RR.boot = function () {
    RR.applyTheme();
    if (RR.settings().reduceMotion) document.documentElement.classList.add('reduce-motion');
    RR.iconize(document);
    RR.$$('#dock .dock__item').forEach(function (b) {
      b.addEventListener('click', function () { RR.go(b.dataset.go); });
    });
    var me = RR.$('#btn-me');
    if (me) me.addEventListener('click', function () { RR.go('me'); });
    var x = RR.$('#sheet-x');
    if (x) { x.innerHTML = RR.ICO('close', 18); x.addEventListener('click', close); }
    var scrim = RR.$('#scrim');
    if (scrim) scrim.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sheetOpen) close(); });
    // 抽屉跟手拖拽关闭
    var grip = RR.$('#sheet-grip'), sheet = RR.$('#sheet');
    if (grip && sheet) {
      grip.addEventListener('pointerdown', function (e) {
        sheetDrag = { y: e.clientY, dy: 0 };
        sheet.style.transition = 'none';
        grip.setPointerCapture(e.pointerId);
      });
      grip.addEventListener('pointermove', function (e) {
        if (!sheetDrag) return;
        sheetDrag.dy = Math.max(0, e.clientY - sheetDrag.y);
        sheet.style.transform = 'translateY(' + sheetDrag.dy + 'px)';
      });
      var endDrag = function () {
        if (!sheetDrag) return;
        sheet.style.transition = '';
        sheet.style.transform = '';
        var closeIt = sheetDrag.dy > 96;
        sheetDrag = null;
        if (closeIt) close();
      };
      grip.addEventListener('pointerup', endDrag);
      grip.addEventListener('pointercancel', endDrag);
    }
    window.addEventListener('hashchange', function () { apply(fromHash()); });
    apply(fromHash());
  };
})();
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
/* ============================================================
   38-subtitle.js · 外挂字幕（RR.subtitle）
   契约：mount() / loadText(name, text) / setStyle({size,color,bg,pos}) / clear()
   入口：<input type="file" accept=".srt,.vtt">（APK 里由 native 的
        WebChromeClient.onShowFileChooser 支持）；另接
        window.__rrSubtitleFile(name, text)（native pickSubtitle 回调）。
   解析：SRT / VTT 同一套扫描器 —— 容忍 BOM、CRLF、`-->` 两侧空格、
        时间轴毫秒 1–3 位、VTT 的 cue settings / NOTE / 内联标签。
   渲染：#ch-media 内的安全区层，按播放时间（<video> currentTime）切换 cue。
   ============================================================ */
(function () {
  'use strict';
  var RR = window.RR;
  if (!RR) { return; }

  var TICK_MS = 120;
  var COLORS = [
    { key: 'white', label: '白', hex: '#ffffff' },
    { key: 'yellow', label: '黄', hex: '#ffd84d' },
    { key: 'cyan', label: '青', hex: '#7fe9e9' }
  ];
  var SIZES = [14, 16, 18, 20, 22, 24, 26];

  var S = {
    layer: null, cues: [], name: '', idx: 0, shown: undefined,
    timer: 0, input: null, boundVideo: false,
    stroke: null, style: null, panelEl: null, panelBody: null
  };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function videoEl() { return document.getElementById('player'); }

  function host() {
    return document.getElementById('ch-media') ||
      document.getElementById('stage') ||
      document.getElementById('ch-stage') ||
      document.body;
  }

  /* ---------- 时间轴解析 ---------- */
  function msOf(frac) {
    if (frac == null || frac === '') { return 0; }
    var s = (String(frac) + '00').slice(0, 3);
    return Number(s) || 0;
  }

  function parseTs(raw) {
    var s = String(raw == null ? '' : raw).replace(/\s+/g, '').replace(/^\uFEFF/, '');
    if (!s) { return NaN; }
    var m = /^(?:(\d{1,3}):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(s);
    if (!m) { return NaN; }
    var h = m[1] ? Number(m[1]) : 0;
    return h * 3600 + Number(m[2]) * 60 + Number(m[3]) + msOf(m[4]) / 1000;
  }

  var RE_TIME_LINE = /^\s*(\S+)\s*-->\s*(\S+)(?:\s+.*)?$/;

  function cleanCueText(raw) {
    var t = String(raw == null ? '' : raw)
      .replace(/\{\\[^}]*\}/g, '')            /* ASS 覆盖标记 {\an8} */
      .replace(/<\/?[a-zA-Z][^>]*>/g, '')     /* <i> <b> <c.xx> <v 名字> */
      .replace(/<[0-9:.,]{6,}>/g, '')         /* VTT 内联时间戳 */
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>');
    var lines = t.split('\n');
    for (var i = 0; i < lines.length; i++) { lines[i] = lines[i].replace(/^\s+|\s+$/g, ''); }
    while (lines.length && !lines[0]) { lines.shift(); }
    while (lines.length && !lines[lines.length - 1]) { lines.pop(); }
    return lines.join('\n');
  }

  /* 行扫描：只认含 --> 的时间行，其后的行到空行（或下一条时间行）都是字幕正文。
     这样 SRT 的序号行、VTT 的 WEBVTT/NOTE/STYLE 头自然被跳过。 */
  function parseCues(raw) {
    var text = String(raw == null ? '' : raw)
      .replace(/^\uFEFF/, '')
      .replace(/\r\n?/g, '\n')
      .replace(/\u0000/g, '');
    if (!text) { return []; }
    var lines = text.split('\n');
    var cues = [];
    for (var i = 0; i < lines.length; i++) {
      var m = RE_TIME_LINE.exec(lines[i]);
      if (!m) { continue; }
      var start = parseTs(m[1]);
      var end = parseTs(m[2]);
      if (!isFinite(start) || !isFinite(end)) { continue; }
      var buf = [];
      var j = i + 1;
      for (; j < lines.length; j++) {
        if (!lines[j].replace(/\s+/g, '')) { break; }
        if (RE_TIME_LINE.test(lines[j])) { j--; break; }
        buf.push(lines[j]);
      }
      var body = cleanCueText(buf.join('\n'));
      if (body) {
        cues.push({
          start: start,
          end: Math.max(end, start + 0.05),
          text: body
        });
      }
      i = j;
    }
    cues.sort(function (a, b) { return a.start - b.start || a.end - b.end; });
    return cues;
  }

  /* ---------- 样式 ---------- */
  function normColor(v) {
    var s = String(v == null ? '' : v).replace(/\s+/g, '').toLowerCase();
    for (var i = 0; i < COLORS.length; i++) {
      if (s === COLORS[i].key || s === COLORS[i].hex) { return COLORS[i].hex; }
    }
    if (/^#[0-9a-f]{6}$/.test(s)) { return s; }
    if (/^#[0-9a-f]{3}$/.test(s)) { return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]; }
    return '#ffffff';
  }

  function strokeOn() {
    if (S.stroke === null) {
      S.stroke = RR.store.get('subStroke', true) !== false;
    }
    return S.stroke;
  }

  function applyStyle() {
    var L = S.layer;
    if (!L) { return; }
    var st = RR.settings ? RR.settings() : {};
    var size = clamp(Math.round(Number(st.subSize) || 18), 14, 26);
    var ink = normColor(st.subColor);
    var bg = Number(st.subBg);
    if (!isFinite(bg)) { bg = 0.55; }
    bg = clamp(bg, 0, 0.95);
    var pos = st.subPos === 'top' ? 'top' : 'bottom';
    L.style.setProperty('--rr-sub-size', size + 'px');
    L.style.setProperty('--rr-sub-ink', ink);
    L.style.setProperty('--rr-sub-bg', String(bg));
    L.dataset.pos = pos;
    L.dataset.stroke = strokeOn() ? 'on' : 'off';
    S.style = { size: size, color: ink, bg: bg, pos: pos, stroke: strokeOn() };
  }

  function setStyle(opt) {
    opt = opt || {};
    var patch = {};
    if (opt.size != null) { patch.subSize = clamp(Math.round(Number(opt.size) || 18), 14, 26); }
    if (opt.color != null) { patch.subColor = normColor(opt.color); }
    if (opt.bg != null) { patch.subBg = clamp(Number(opt.bg) || 0, 0, 0.95); }
    if (opt.pos != null) { patch.subPos = opt.pos === 'top' ? 'top' : 'bottom'; }
    if (opt.stroke != null) {
      S.stroke = !!opt.stroke;
      RR.store.set('subStroke', S.stroke);
    }
    if (Object.keys(patch).length && RR.saveSettings) { RR.saveSettings(patch); }
    applyStyle();
    refreshPanel();
    return S.style;
  }

  function currentStyle() {
    if (!S.style) { applyStyle(); }
    return S.style ? {
      size: S.style.size, color: S.style.color, bg: S.style.bg,
      pos: S.style.pos, stroke: S.style.stroke
    } : null;
  }

  /* ---------- 图层 ---------- */
  function ensureLayer() {
    if (!S.layer) {
      var L = RR.el('div', 'rr-sub');
      L.id = 'rr-sub';
      L.hidden = true;
      L.setAttribute('aria-hidden', 'true');
      L.dataset.pos = 'bottom';
      L.dataset.stroke = 'on';
      S.layer = L;
    }
    var h = host();
    if (S.layer.parentNode !== h) { h.appendChild(S.layer); }
    S.layer.classList.toggle('rr-sub--fixed', h === document.body);
    applyStyle();
    return S.layer;
  }

  function render(cue) {
    if (cue === S.shown) { return; }
    S.shown = cue;
    var L = S.layer || ensureLayer();
    while (L.firstChild) { L.removeChild(L.firstChild); }
    if (!cue) { L.hidden = true; return; }
    var parts = String(cue.text || '').split('\n');
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) { continue; }
      var ln = document.createElement('span');
      ln.className = 'rr-sub__ln';
      ln.textContent = parts[i];
      L.appendChild(ln);
    }
    L.hidden = !L.firstChild;
  }

  function findCue(t) {
    var a = S.cues;
    if (!a.length) { return null; }
    var i = S.idx;
    if (i < 0) { i = 0; }
    if (i > a.length - 1) { i = a.length - 1; }
    while (i > 0 && t < a[i].start) { i--; }
    while (i < a.length - 1 && t >= a[i + 1].start) { i++; }
    S.idx = i;
    var c = a[i];
    return (t >= c.start && t <= c.end) ? c : null;
  }

  function tick() {
    /* 不在后台时省电由浏览器定时器节流负责；这里不按 document.hidden 短路，
       否则 WebView 在某些「报告为隐藏但实际可见」的形态下字幕会整段不刷新 */
    if (!S.cues.length) { return; }
    if (!S.layer) { ensureLayer(); }
    else if (S.layer.parentNode !== host()) { ensureLayer(); }
    if (RR.route && RR.route() !== 'channel') { render(null); return; }
    /* 空闲态（还没选节目）不往画面上贴字幕 */
    if (RR.player && typeof RR.player.current === 'function' && !RR.player.current()) { render(null); return; }
    var v = videoEl();
    if (!v) { render(null); return; }
    render(findCue(v.currentTime || 0));
  }

  function start() {
    if (S.timer) { return; }
    S.timer = setInterval(tick, TICK_MS);
  }

  function stop() {
    if (S.timer) { clearInterval(S.timer); S.timer = 0; }
  }

  function bindVideo() {
    if (S.boundVideo) { return; }
    var v = videoEl();
    if (!v) { return; }
    S.boundVideo = true;
    v.addEventListener('seeked', tick);
    v.addEventListener('play', tick);
    v.addEventListener('loadedmetadata', tick);
  }

  /* ---------- 载入 ---------- */
  function loadText(name, text) {
    ensureLayer();
    var cues = parseCues(text);
    if (!cues.length) {
      RR.toast('这份字幕读不出时间轴，换份 .srt / .vtt 试试', 'err');
      return false;
    }
    S.cues = cues;
    S.name = String(name || '字幕');
    S.idx = 0;
    S.shown = undefined;
    resetInput();
    ensureLayer();
    start();
    tick();
    RR.toast('字幕已载入 · ' + cues.length + ' 条');
    refreshPanel();
    return true;
  }

  function resetInput() {
    if (S.input) { try { S.input.value = ''; } catch (e) { } }
  }

  function clear() {
    stop();
    S.cues = [];
    S.name = '';
    S.idx = 0;
    S.shown = undefined;
    if (S.layer) { render(null); S.layer.hidden = true; }
    resetInput();
    refreshPanel();
    return true;
  }

  function decode(buf) {
    try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { }
    try { return new TextDecoder('gbk').decode(buf); } catch (e) { }
    try { return new TextDecoder('utf-8').decode(buf); } catch (e) { }
    return '';
  }

  function loadFile(file) {
    if (!file) { return; }
    var name = file.name || '字幕';
    var done = false;
    function ok(text) {
      if (done) { return; }
      done = true;
      if (!text || !String(text).replace(/\s+/g, '')) {
        RR.toast('这个文件是空的，换一份试试', 'err');
        return;
      }
      loadText(name, text);
    }
    function bad() {
      if (done) { return; }
      done = true;
      RR.toast('字幕没读出来，再选一次', 'err');
    }
    /* 先按字节读，UTF-8 不成立再退 GBK（B 站老字幕常见 GBK） */
    try {
      var fr = new FileReader();
      fr.onload = function () { ok(decode(fr.result)); };
      fr.onerror = function () {
        try {
          if (typeof file.text === 'function') { file.text().then(ok, bad); return; }
        } catch (e) { }
        bad();
      };
      fr.readAsArrayBuffer(file);
      return;
    } catch (e) { }
    try {
      if (typeof file.text === 'function') {
        file.text().then(ok, bad);
        return;
      }
    } catch (e) { }
    bad();
  }

  function ensureInput() {
    if (S.input) { return S.input; }
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = '.srt,.vtt';
    inp.className = 'sr-only';
    inp.id = 'rr-sub-file';
    inp.tabIndex = -1;
    inp.setAttribute('aria-hidden', 'true');
    inp.addEventListener('change', function () {
      var f = inp.files && inp.files[0];
      loadFile(f);
      /* 允许连续选同一个文件 */
      setTimeout(resetInput, 0);
    });
    document.body.appendChild(inp);
    S.input = inp;
    return inp;
  }

  function pick() {
    ensureInput();
    try {
      S.input.click();
      return true;
    } catch (e) {
      var BR = window.AndroidRadio;
      if (BR && typeof BR.pickSubtitle === 'function') {
        try { BR.pickSubtitle(); return true; } catch (e2) { }
      }
      RR.toast('这个环境打不开文件选择器', 'err');
      return false;
    }
  }

  /* ---------- 样式面板 ---------- */
  function optBtn(html, on, fn) {
    var b = RR.el('button', 'rr-opt' + (on ? ' is-on' : ''));
    b.type = 'button';
    b.innerHTML = html;
    b.addEventListener('click', fn);
    return b;
  }

  function renderPanel() {
    var body = S.panelBody;
    if (!body) { return; }
    body.innerHTML = '';
    var cur = currentStyle() || { size: 18, color: '#ffffff', bg: 0.55, pos: 'bottom', stroke: true };

    function row(label, opts) {
      var r = RR.el('div', 'rr-subcfg__row');
      var l = RR.el('span', 'rr-subcfg__lbl', label);
      var o = RR.el('div', 'rr-subcfg__opts');
      opts.forEach(function (n) { o.appendChild(n); });
      r.appendChild(l); r.appendChild(o);
      body.appendChild(r);
    }

    row('字号', SIZES.map(function (n) {
      return optBtn(String(n), n === cur.size, function () {
        setStyle({ size: n });
        RR.toast('字幕字号 ' + n);
      });
    }));

    row('颜色', COLORS.map(function (c) {
      var html = '<i class="rr-opt__dot" style="background:' + c.hex + '"></i>' + c.label;
      return optBtn(html, normColor(cur.color) === c.hex, function () {
        setStyle({ color: c.hex });
      });
    }));

    row('描边', [
      optBtn('开', !!cur.stroke, function () { setStyle({ stroke: true }); }),
      optBtn('关', !cur.stroke, function () { setStyle({ stroke: false }); })
    ]);

    row('位置', [
      optBtn('底部', cur.pos !== 'top', function () { setStyle({ pos: 'bottom' }); }),
      optBtn('顶部', cur.pos === 'top', function () { setStyle({ pos: 'top' }); })
    ]);

    var note = RR.el('p', 'rr-subcfg__note');
    note.textContent = S.cues.length
      ? ('正在用：' + S.name + ' · ' + S.cues.length + ' 条')
      : '还没加载字幕。选一个 .srt 或 .vtt 文件，字幕会跟着播放时间出现在画面上。';
    body.appendChild(note);
  }

  function refreshPanel() {
    if (S.panelBody && S.panelBody.isConnected) { renderPanel(); }
  }

  function panel() {
    ensureLayer();
    var body = RR.el('div', 'rr-subcfg');
    S.panelBody = body;
    renderPanel();
    S.panelEl = RR.sheet({
      title: '字幕',
      body: body,
      actions: [
        {
          label: '选字幕文件',
          primary: true,
          onClick: function () { setTimeout(function () { pick(); }, 320); }
        },
        {
          label: S.cues.length ? '关掉字幕' : '取消',
          onClick: function () { if (S.cues.length) { clear(); } }
        }
      ]
    });
    return S.panelEl;
  }

  /* ---------- 对外 ---------- */
  function mount() {
    ensureLayer();
    bindVideo();
    /* 没有 cue 就不开定时器：字幕加载后才 start()，闲时零开销 */
    if (S.cues.length) { start(); tick(); }
  }

  RR.subtitle = {
    mount: mount,
    loadText: loadText,
    setStyle: setStyle,
    clear: clear,
    pick: pick,
    panel: panel,
    open: panel,
    openPanel: panel,
    style: currentStyle,
    cues: function () {
      return S.cues.map(function (c) { return { start: c.start, end: c.end, text: c.text }; });
    },
    count: function () { return S.cues.length; },
    name: function () { return S.name; }
  };

  /* native pickSubtitle 回调（契约 §2） */
  window.__rrSubtitleFile = function (name, text) {
    try { return loadText(name, text); } catch (e) { return false; }
  };

  if (RR.on) {
    RR.on('rr:route', function (d) {
      if (!S.cues.length) { return; }
      if (d && d.to !== 'channel') { render(null); }
      else { ensureLayer(); tick(); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
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
/* ============================================================
   live · 直播视图（js/41-live.js）
   - FLV 舞台：mpegts.js 优先 playinfo.flv 直连，失败回落 /api/live/stream?room=&qn=
   - 全屏：#view-live.is-fs + AndroidRadio.setFullscreen/setOrientation（DOM 全屏只兜底）
   - 实时弹幕：SSE /api/live/chat/stream?station=
   - 发送：POST /api/live/send（表情带 emoticonOptions）
   - 表情：GET /api/live/emoticons?room=
   单个 IIFE + 'use strict'；只往 RR 挂模块，不污染其它全局。
   依赖 00-core 的 RR.*；缺什么就用本文件的局部 helper 兜住，绝不硬崩。
   ============================================================ */
(function () {
  'use strict';

  var RR = window.RR || (window.RR = {});

  /* WebView 对无源 <video> 的默认占位是「灰底 + 黑椭圆 + 三角」，用海报盖掉；
     出帧后浏览器自动隐藏 poster，不用手动清。 */
  var IDLE_ART = '/assets/idle.webp';
  var DIRECT_FIRST_FRAME_MS = 8000;

  /* ---------------- 局部 helper（00-core 尚未落地时的兜底） ---------------- */

  function q(sel, root) {
    if (typeof RR.$ === 'function') { try { return RR.$(sel, root); } catch (e) {} }
    return (root || document).querySelector(sel);
  }

  function mk(tag, cls, text) {
    var n = null;
    if (typeof RR.el === 'function') { try { n = RR.el(tag, cls); } catch (e) { n = null; } }
    if (!n) { n = document.createElement(tag); if (cls) n.className = cls; }
    if (text != null) n.textContent = text;
    return n;
  }

  function cnt(n) {
    n = Number(n) || 0;
    if (typeof RR.fmtCount === 'function') { try { return RR.fmtCount(n); } catch (e) {} }
    if (n >= 100000000) return (n / 100000000).toFixed(1) + '亿';
    if (n >= 10000) return (n / 10000).toFixed(1) + '万';
    return String(Math.round(n));
  }

  function toast(text, kind) {
    if (typeof RR.toast === 'function') { try { RR.toast(text, kind); } catch (e) {} }
  }

  function emit(evt, data) {
    if (typeof RR.emit === 'function') { try { RR.emit(evt, data); } catch (e) {} }
  }

  function settings() {
    if (typeof RR.settings === 'function') { try { return RR.settings() || {}; } catch (e) {} }
    return {};
  }

  function saveSettings(patch) {
    if (typeof RR.saveSettings === 'function') { try { RR.saveSettings(patch); } catch (e) {} }
  }

  function storeGet(key, def) {
    if (RR.store && typeof RR.store.get === 'function') { try { return RR.store.get(key, def); } catch (e) {} }
    return def;
  }

  function storeSet(key, val) {
    if (RR.store && typeof RR.store.set === 'function') { try { RR.store.set(key, val); } catch (e) {} }
  }

  // RR.api 缺位时用 fetch 兜一份同样「失败即抛、带 .status」的语义
  function api(path, opts) {
    if (typeof RR.api === 'function') { try { return RR.api(path, opts); } catch (e) { return Promise.reject(e); } }
    var init = { method: (opts && opts.method) || 'GET', headers: { Accept: 'application/json' } };
    if (opts && opts.body != null) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch(path, init).then(function (r) {
      return r.text().then(function (t) {
        var j = {};
        try { j = t ? JSON.parse(t) : {}; } catch (e) { j = {}; }
        if (!r.ok) {
          var err = new Error((j && j.error) || ('HTTP ' + r.status));
          err.status = r.status;
          throw err;
        }
        return j;
      });
    });
  }

  function post(path, body) {
    if (typeof RR.post === 'function') { try { return RR.post(path, body); } catch (e) { return Promise.reject(e); } }
    return api(path, { method: 'POST', body: body });
  }

  /* 图标：优先 RR.ICO；只有 00-core 缺位时才用下面的等价兜底（同样 24 网格 / 1.75 描边 / 圆头） */
  var FALLBACK_ICON = {
    expand: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4H4v5"/><path d="M15 4h5v5"/><path d="M20 15v5h-5"/><path d="M4 15v5h5"/></svg>',
    collapse: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h5V4"/><path d="M20 9h-5V4"/><path d="M15 20v-5h5"/><path d="M9 20v-5H4"/></svg>',
    volume: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 6a9 9 0 0 1 0 12"/></svg>',
    mute: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6.5 9H3v6h3.5L11 19z"/><path d="M16 9.5l5 5"/><path d="M21 9.5l-5 5"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-2.35-5.66"/><path d="M20 4v4.5h-4.5"/></svg>',
    check: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>'
  };

  function ico(name) {
    if (typeof RR.ICO === 'function') { try { var s = RR.ICO(name); if (s) return s; } catch (e) {} }
    return FALLBACK_ICON[name] || '';
  }

  function humanErr(msg) {
    var m = String(msg == null ? '' : msg);
    if (!m || /failed to fetch|networkerror|network error|load failed|timeout/i.test(m)) return '网络没有响应，等一下再试';
    if (/unknown endpoint|not found/i.test(m)) return '这个接口还没接通';
    return m.slice(0, 46) || '出了点问题，等一下再试';
  }

  function errText(err) {
    var s = err && err.status;
    if (s === 404) return '本机服务里还没有这个接口';
    if (!s || s >= 500) return '网络没有响应';
    return humanErr(err && err.message);
  }

  /* ---------------- 状态 ---------------- */

  var D = {};          // DOM 引用
  var st = {
    mounted: false,
    active: false,
    living: false,
    state: 'idle',
    info: null,
    stationId: '',
    room: '',
    qn: 0,
    qualities: [],
    online: 0,
    muted: true,
    player: null,
    pendDestroy: null,
    pendTimer: 0,
    streamTimer: 0,
    streamRetry: 0,
    chaseTimer: 0,
    wdTimer: 0,
    lastChase: 0,
    wdAt: 0,
    stall: 0,
    lastPlayTry: 0,
    directUrl: '',        // playinfo.flv：B 站 CDN 直连 FLV
    directQn: 0,          // playinfo.flv_qn：这条直连对应的画质
    noDirect: false,      // 这一路直连失败过，别再试
    curDirect: false,     // 当前这次 attempt 是不是直连
    firstTimer: 0,        // 直连首帧超时
    fbTimer: 0,           // 直连 → 中转的下一拍
    es: null,
    esTimer: 0,
    esRetry: 0,
    follow: true,
    unseen: 0,
    feedCount: 0,
    sending: false,
    needLogin: false,
    acct: null,
    loginHintAt: 0,
    fsOn: false,
    fsApplied: false,     // 真的动过系统栏/方向，退出时要还回去
    fsTimer: 0,           // 旋屏/系统栏的二次确认（有些机型第一下会被忽略）
    bodyOverflow: null,
    chromeHidden: null,   // 全屏时临时藏起来的顶栏 / dock / mini
    emo: { packs: [], pack: 0, loaded: false, loading: false, room: '', picked: null, open: false },
    sw: null,        // 切档现场：{ target, from, tries, armed, timer }
    swPill: null,    // 舞台右上角「正在切到 X…」
    hold: null,      // 切档定格帧 canvas
    holdTimer: 0
  };

  /* ---------------- 挂载 ---------------- */

  function mount() {
    if (st.mounted) return true;
    var root = document.getElementById('view-live');
    if (!root) return false;
    st.root = root;

    D = {
      stage: q('#live-stage', root),
      video: q('#live-video', root),
      badge: q('#live-badge', root),
      badgetxt: q('#live-badgetxt', root),
      fs: q('#live-fs', root),
      note: q('#live-note', root),
      noteT: q('#live-note-t', root),
      retry: q('#live-retry', root),
      off: q('#live-offline', root),
      offS: q('#live-off-s', root),
      goChannel: q('#live-go-channel', root),
      title: q('#live-title', root),
      uname: q('#live-uname', root),
      online: q('#live-online', root),
      ctl: q('#live-ctl', root),
      qn: q('#live-qn', root),
      mute: q('#live-mute', root),
      refresh: q('#live-refresh', root),
      panel: q('#live-panel', root),
      conn: q('#live-conn', root),
      connTxt: q('#live-conntxt', root),
      feed: q('#live-chat', root),
      empty: q('#live-chat-empty', root),
      neu: q('#live-new', root),
      neuTxt: q('#live-newtxt', root),
      loginbar: q('#live-loginbar', root),
      login: q('#live-login', root),
      form: q('#live-form', root),
      input: q('#live-input', root),
      send: q('#live-send', root),
      emoBtn: q('#live-emo-btn', root),
      emo: q('#live-emo', root),
      emoTabs: q('#live-emotabs', root),
      emoGrid: q('#live-emogrid', root),
      emoMsgWrap: q('#live-emomsgwrap', root),
      emoMsg: q('#live-emomsg', root),
      emoRetry: q('#live-emoretry', root),
      emoPrev: q('#live-emoprev', root),
      emoImg: q('#live-emoimg', root),
      emoName: q('#live-emoname', root),
      emoSend: q('#live-emosend', root),
      emoCancel: q('#live-emocancel', root)
    };

    if (!D.stage || !D.video) return false;
    st.mounted = true;

    /* 海报双保险：views/live.html 已写死 poster，装配/替换时丢了也能补回来 */
    if (D.video && !D.video.getAttribute('poster')) D.video.setAttribute('poster', IDLE_ART);

    if (D.fs) D.fs.innerHTML = ico('expand');
    if (D.mute) D.mute.innerHTML = ico('mute');
    if (D.refresh) D.refresh.innerHTML = ico('refresh');
    bind();
    return true;
  }

  function on(node, evt, fn, opts) {
    if (node) node.addEventListener(evt, fn, opts || false);
  }

  function bind() {
    on(D.fs, 'click', toggleFs);
    on(D.retry, 'click', function () { retryNow(); });
    on(D.goChannel, 'click', function () {
      if (typeof RR.go === 'function') RR.go('channel');
    });
    on(D.qn, 'click', pickQuality);
    on(D.mute, 'click', toggleMute);
    on(D.refresh, 'click', function () {
      if (!st.living) return;
      st.streamRetry = 0;
      toast('正在刷新直播流');
      setState('reconnect', '正在重新拉流…', false);
      startStream();
    });

    on(D.video, 'playing', function () {
      clearFirstFrame();
      if (st.living && st.state !== 'live') setState('live');
      if (st.sw) onSwitchFrame();
    });
    on(D.video, 'loadeddata', clearFirstFrame);
    on(D.video, 'error', function () {
      if (!st.living || !st.player) return;
      if (fallbackDirect()) return;
      scheduleReconnect('播放器报错');
    });

    on(D.form, 'submit', function (e) {
      if (e && e.preventDefault) e.preventDefault();
      submit();
    });
    on(D.input, 'input', updateSend);
    on(D.input, 'keydown', function (e) {
      if (e && (e.key === 'Enter' || e.keyCode === 13)) {
        if (e.preventDefault) e.preventDefault();
        submit();
      }
    });
    on(D.input, 'focus', function () {
      if (st.needLogin || loggedOut()) hintLogin();
    });

    on(D.feed, 'scroll', onFeedScroll, { passive: true });
    on(D.neu, 'click', toBottom);

    on(D.login, 'click', function () {
      toast('扫码登录在「我的」里');
      if (typeof RR.go === 'function') RR.go('me');
    });

    on(D.emoBtn, 'click', toggleEmo);
    on(D.emoSend, 'click', sendEmoji);
    on(D.emoCancel, 'click', closeEmoPick);
    on(D.emoRetry, 'click', function () { loadEmoticons(true); });

    if (typeof RR.on === 'function') {
      try { RR.on('station', onStationEvt); } catch (e) {}
    }
    document.addEventListener('fullscreenchange', onFsChange, false);
    document.addEventListener('webkitfullscreenchange', onFsChange, false);
    document.addEventListener('keydown', onKeyDown, true);
  }

  /* 系统返回/物理键盘退出：能收到 DOM 全屏事件就摘 class，
     收不到的话 native 会调 window.__rrExitFs（见文件末尾的包装）。 */
  function onKeyDown(e) {
    if (!e || !st.fsOn) return;
    if (e.key !== 'Escape' && e.key !== 'Esc' && e.keyCode !== 27) return;
    if (e.preventDefault) e.preventDefault();
    exitFs();
  }

  /* ---------------- 生命周期 ---------------- */

  function enter() {
    if (!mount()) return;
    if (st.active) return;
    st.active = true;

    /* 音频仲裁（8.0 新口径）：进直播页不再停回放，回放跨界面继续；
       只有用户把直播开声（applyMute 非静音路径 / 流带声起播）时才先停回放。 */
    abortSwitch();

    var sst = station();
    var sid = String(sst.id || sst.mid || '');
    // 离开直播页时也可能切过台：换了主播就不认上次记的画质，也重新给直连机会
    var switched = !!(sid && st.stationId && sid !== st.stationId);
    if (switched) {
      storeSet('liveQn', 0);
      resetDirect();
    }

    var s = settings();
    st.muted = s.liveMuted !== false;      // 契约：直播默认静音
    st.qn = Number(storeGet('liveQn', 0)) || 0;
    st.streamRetry = 0;
    st.esRetry = 0;
    st.online = 0;
    st.feedCount = 0;
    st.needLogin = false;
    st.sending = false;
    st.unseen = 0;
    st.follow = true;

    st.stationId = sid || st.stationId;
    st.room = String(sst.room || st.room || '');

    if (D.feed) D.feed.innerHTML = '';
    if (D.empty) D.empty.hidden = false;
    if (D.neu) D.neu.hidden = true;
    if (D.panel) D.panel.hidden = true;
    if (D.emo) D.emo.hidden = true;
    if (D.emoBtn) D.emoBtn.setAttribute('aria-expanded', 'false');
    closeEmoPick();
    applyMute(true);       // 进门只同步静音态，不动回放；真正出声在 startStream/取消静音时仲裁
    updateSend();
    refreshAccount();
    emit('live-state', { living: false, room: st.room });

    loadInfo();
  }

  function leave() {
    if (!st.mounted) return;
    st.active = false;
    st.living = false;
    st.state = 'idle';
    st.sending = false;
    abortSwitch();                 // 切档定格帧/胶囊跟着离场，别留在隐藏视图里
    closeChat();
    stopTimers();
    exitFs(true);
    if (D.emo) D.emo.hidden = true;
    if (D.emoBtn) D.emoBtn.setAttribute('aria-expanded', 'false');
    closeEmoPick();
    // 保最后一帧：先暂停，destroy 延后 60ms（契约 §task 4）
    stopStream(true);
    if (D.send) D.send.disabled = true;
    emit('live-state', { living: false, room: st.room });
  }

  function onStationEvt() {
    if (!st.active) return;
    var s = station();
    var id = String(s.id || s.mid || '');
    if (id && id === st.stationId) return;
    st.stationId = id;
    st.room = String(s.room || '');
    st.qn = 0;
    storeSet('liveQn', 0);         // 切台重置画质记忆
    resetDirect();                 // 换主播：直连地址和失败标记一起清零
    st.streamRetry = 0;
    st.online = 0;
    st.feedCount = 0;
    st.emo.loaded = false;
    st.emo.packs = [];
    st.emo.pack = 0;
    st.emo.room = '';
    abortSwitch();
    closeEmoPick();
    closeChat();
    stopTimers();
    stopStream(true);
    if (D.feed) D.feed.innerHTML = '';
    if (D.empty) D.empty.hidden = false;
    if (D.panel) D.panel.hidden = true;
    loadInfo();
  }

  function station() {
    var s = null;
    if (typeof RR.station === 'function') { try { s = RR.station(); } catch (e) { s = null; } }
    if (!s && typeof RR.stations === 'function') {
      try { var all = RR.stations() || []; s = all[0] || null; } catch (e) { s = null; }
    }
    return s || {};
  }

  /* ---------------- 直播信息 ---------------- */

  function loadInfo() {
    var s = station();
    if (s && s.id) st.stationId = String(s.id);
    if (s && s.room) st.room = String(s.room);
    if (!st.stationId && !st.room) {
      setState('error', '还没选主播，先在顶部挑一位。', true);
      return;
    }

    var p1 = '/api/live/playinfo?station=' + encodeURIComponent(st.stationId) +
      (st.room ? '&room=' + encodeURIComponent(st.room) : '');
    setState('loading', '正在连到直播间…', false);

    api(p1).then(null, function (e1) {
      if (!st.room) throw e1;
      // playinfo 不可用时退到轻量 brief（形状见契约 §7）
      return api('/api/live/brief?room=' + encodeURIComponent(st.room)).then(function (b) {
        return {
          living: !!(b && b.living),
          title: (b && b.title) || '',
          online: (b && b.online) || 0,
          room: (b && b.room) || st.room,
          uname: s && s.name,
          qualities: []
        };
      });
    }).then(onInfo).catch(function (err) {
      st.info = null;
      st.living = false;
      abortSwitch();
      if (D.panel) D.panel.hidden = true;
      setState('error', '连不上直播间：' + errText(err) + '。', true);
      emit('live-state', { living: false, room: st.room });
    });
  }

  function onInfo(info) {
    st.info = info || {};
    st.online = Number(st.info.online) || 0;
    if (st.info.room) st.room = String(st.info.room);

    /* 8.0.1 playinfo 会带 B 站 CDN 直连 FLV（CORS *）与它对应的画质；
       没有（或退回 brief）就留空，取流自动走本机中转。 */
    st.directUrl = typeof st.info.flv === 'string' ? st.info.flv : '';
    st.directQn = Number(st.info.flv_qn) || 0;
    st.curDirect = false;

    /* 接口只回 1 档（HLS-only 房间很常见）时补齐常见档，让画质按钮可点；
       后端给了 accept_qn 就以它为准过滤（不可用档不显示，后端也会兜底回落）。 */
    st.qualities = normalizeQualities(st.info);
    if (!st.qn) {
      st.qn = Number(st.info.current_qn) || Number(st.info.qn) ||
        (st.qualities[0] ? Number(st.qualities[0].qn) : 0) || 0;
    }
    if (st.qn && st.qualities.length && !hasQuality(st.qn)) {
      st.qn = Number(st.qualities[0].qn) || 0;
      storeSet('liveQn', st.qn);
    }

    renderMeta();

    var living = !!st.info.living;
    st.living = living;

    if (living) {
      st.streamRetry = 0;
      st.wdAt = 0;
      st.stall = 0;
      setState('live');
      if (D.panel) D.panel.hidden = false;
      if (D.empty) D.empty.hidden = !!st.feedCount;
      updateSend();
      startStream();
      openChat();
      loadEmoticons(false);
      startTimers();
      emit('live-state', { living: true, room: st.room });
    } else {
      abortSwitch();
      setState('offline');
      if (D.panel) D.panel.hidden = true;
      closeChat();
      stopTimers();
      stopStream(false);
      emit('live-state', { living: false, room: st.room });
    }
  }

  function renderMeta() {
    var info = st.info || {};
    var s = station();
    var name = info.uname || s.name || '主播';
    if (D.title) D.title.textContent = info.title ? String(info.title) : '直播间';
    if (D.uname) D.uname.textContent = name;
    if (D.offS) D.offS.textContent = name + ' 这会儿不在直播间。节目带里存着每一次现场。';
    if (D.online) D.online.textContent = st.online > 0 ? cnt(st.online) + ' 人气' : '人气统计中';
    renderQuality();
  }

  function renderQuality() {
    if (!D.qn) return;
    var qn = Number(st.qn) || (st.qualities[0] ? Number(st.qualities[0].qn) : 0);
    var label = qn ? qnLabel(qn) : (st.qualities.length ? (st.qualities[0].desc || '原画') : '原画');
    D.qn.textContent = label;
    D.qn.setAttribute('aria-label', '清晰度：' + label);
    D.qn.hidden = st.qualities.length < 2;
  }

  function setPopularity(v) {
    st.online = Number(v) || 0;
    if (D.online) D.online.textContent = st.online > 0 ? cnt(st.online) + ' 人气' : '人气统计中';
  }

  /* ---------------- 舞台状态 ---------------- */

  function setState(s, t, retry) {
    st.state = s;
    if (!D.stage) return;
    D.stage.setAttribute('data-state', s);

    var living = (s === 'live' || s === 'reconnect');
    if (D.badge) {
      D.badge.hidden = !living;
      if (living) {
        D.badge.classList.toggle('is-warn', s === 'reconnect');
        if (D.badgetxt) D.badgetxt.textContent = s === 'reconnect' ? '重连中' : '直播中';
      }
    }

    var showNote = (s === 'loading' || s === 'reconnect' || s === 'error');
    if (D.note) D.note.hidden = !showNote;
    if (showNote) {
      if (t != null && D.noteT) D.noteT.textContent = t;
      if (D.retry) D.retry.hidden = !retry;
    }
    if (D.off) D.off.hidden = (s !== 'offline');
    if (D.fs) D.fs.hidden = !living;
    setControls(living);
  }

  function setControls(on2) {
    if (D.ctl) D.ctl.classList.toggle('is-off', !on2);
    var b = [D.qn, D.mute, D.refresh];
    for (var i = 0; i < b.length; i++) if (b[i]) b[i].disabled = !on2;
    if (D.qn) D.qn.hidden = st.qualities.length < 2;
  }

  function retryNow() {
    if (!st.active) return;
    st.streamRetry = 0;
    st.esRetry = 0;
    if (st.info && st.info.living) {
      setState('loading', '正在重连…', false);
      startStream();
      openChat();
    } else {
      loadInfo();
    }
  }

  /* ---------------- 直播流（mpegts） ---------------- */

  // 换主播 / 首进：直连地址与失败标记整组清零
  function resetDirect() {
    st.directUrl = '';
    st.directQn = 0;
    st.noDirect = false;
    st.curDirect = false;
  }

  // 直连优先；没有地址 / 这一路失败过 / 画质和 flv_qn 对不上，就回本机中转
  function directFor(qn) {
    if (st.noDirect || !st.directUrl) return '';
    var dq = Number(st.directQn) || 0;
    if (dq && qn && dq !== Number(qn)) return '';
    return st.directUrl;
  }

  function relayUrl() {
    return '/api/live/stream?room=' + encodeURIComponent(st.room || st.stationId) +
      (st.qn ? '&qn=' + encodeURIComponent(st.qn) : '');
  }

  function clearFirstFrame() {
    if (st.firstTimer) { clearTimeout(st.firstTimer); st.firstTimer = 0; }
  }

  // 直连 8s 还没数据就当这一路不可用（中转很慢的房间靠这条兜住）
  function armFirstFrame(player) {
    clearFirstFrame();
    st.firstTimer = setTimeout(function () {
      st.firstTimer = 0;
      if (!st.active || !st.living || st.player !== player) return;
      if (D.video && D.video.readyState >= 2) return;   // 有数据了，只是还没起播，交给 tryPlay/看门狗
      fallbackDirect();
    }, DIRECT_FIRST_FRAME_MS);
  }

  /* 直连失败：清掉直连地址、记住这一路别再试，回中转重连。
     返回 true = 这次错误已被接管，调用方不要再 scheduleReconnect。 */
  function fallbackDirect() {
    if (!st.curDirect) return false;
    st.curDirect = false;
    st.directUrl = '';
    st.noDirect = true;
    st.streamRetry = 0;
    clearFirstFrame();
    if (!st.active || !st.living) return true;
    if (st.streamTimer) { clearTimeout(st.streamTimer); st.streamTimer = 0; }
    if (st.fbTimer) return true;          // 已经排好下一拍，别重复拉流
    setState('reconnect', '直连画面没接上，改走本机中转…', false);
    st.fbTimer = setTimeout(function () {
      st.fbTimer = 0;
      if (!st.active || !st.living) return;
      startStream();
    }, 0);
    return true;
  }

  // mpegts.js 由 shell.html 在 app.js 之前内联，这里只取现成的，绝不自己再注入 <script>
  function startStream() {
    if (!D.video || !st.active || !st.living) return;

    // 单音源：这次拉流会出声（非静音）时，先停回放再起播
    if (!st.muted) silenceReplay();

    stopStream(true);
    flushPendingDestroy();   // 旧播放器立刻销毁，别在 60ms 后把新播放器 detach 掉

    var MT = window.mpegts;
    if (!MT || typeof MT.createPlayer !== 'function') {
      setState('error', '直播组件没加载，先看节目带吧。', true);
      return;
    }

    var direct = directFor(st.qn);
    var isDirect = !!direct;
    var url = direct || relayUrl();
    st.mediaUrl = url;

    D.video.muted = st.muted;
    var player = null;
    st.curDirect = isDirect;
    try {
      player = MT.createPlayer({ type: 'flv', url: url, isLive: true, hasAudio: true, hasVideo: true }, isDirect ? {
        enableWorker: false,
        enableStashBuffer: false,
        stashInitialSize: 384,
        lazyLoad: false,
        liveBufferLatencyChasing: true,    // 直连不过 Kotlin 改时间戳，交给 mpegts 追帧
        autoCleanupSourceBuffer: true,
        fixAudioTimestampGap: false
      } : {
        enableWorker: false,
        enableStashBuffer: false,
        stashInitialSize: 128,
        lazyLoad: false,
        liveBufferLatencyChasing: false,   // 追帧自己算，避免 mpegts 反复 seek 拉偏音画
        autoCleanupSourceBuffer: true,
        fixAudioTimestampGap: false
      });
      player.attachMediaElement(D.video);
      player.on(MT.Events.ERROR, function (type, detail) {
        if (st.player !== player) return;  // 旧播放器的尾巴不算
        onMpegErr(type, detail);
      });
      st.player = player;          // 先挂引用：playing 首帧判定要能看到新播放器
      player.load();
      st.wdAt = 0;
      st.stall = 0;
      tryPlay();
      syncNowPlaying(true);
      if (isDirect) armFirstFrame(player);
    } catch (e) {
      try { if (player) player.destroy(); } catch (e2) {}
      st.player = null;
      st.curDirect = isDirect;
      if (fallbackDirect()) return;            // 直连打不开：先回中转
      if (st.sw) { switchFailed(); return; }   // 切档中途打不开：回原档，不落 error
      setState('error', '直播流打不开：' + humanErr(e && e.message) + '。', true);
    }
  }

  function onMpegErr(type, detail) {
    var ts = String(type || '');
    // mpegts 的 RuntimeException 多为偶发解析告警，不据此弹错；真断了交给看门狗与重连
    if (/RuntimeException/.test(ts)) return;
    if (fallbackDirect()) return;
    scheduleReconnect(/Network/i.test(ts) ? '网络断了' : '画面停了');
  }

  function scheduleReconnect(reason) {
    if (!st.active || !st.living) return;
    if (st.fbTimer) return;          // 正要切回中转，让那次重连先做
    if (st.streamTimer) return;
    // 切档期间：重连 2 次仍失败就回原档，别卡在 reconnect
    if (st.sw) {
      st.sw.tries++;
      if (st.sw.tries > 2) { switchFailed(); return; }
    }
    if (st.streamRetry >= 4) {
      if (st.sw) { switchFailed(); return; }
      setState('error', '直播流断了，试了 ' + st.streamRetry + ' 次都没接上。', true);
      return;
    }
    st.streamRetry++;
    var wait = [800, 1600, 3200, 4800][Math.min(st.streamRetry - 1, 3)];
    setState('reconnect', '画面断了，正在重连…（第 ' + st.streamRetry + ' 次）', true);
    st.streamTimer = setTimeout(function () {
      st.streamTimer = 0;
      if (!st.active || !st.living) return;
      startStream();
    }, wait);
  }

  /* 音频仲裁（8.0）：直播要出声时先停回放，同一秒只留一个音源。
     回放没在播就不动它 —— 不抢暂停中的回放，也不替用户恢复回放。 */
  /* 8.1：把「正在播的直播」镜像给原生，退后台时原生才能自己起悬浮窗 */
  function syncNowPlaying(on) {
    var BR = window.AndroidRadio;
    if (!BR || typeof BR.setNowPlaying !== 'function') { return; }
    try {
      if (on && st.living && st.mediaUrl) {
        BR.setNowPlaying(st.mediaUrl,
          (D.title && D.title.textContent) || '直播',
          0, true, true);
      } else {
        BR.setNowPlaying('', '', 0, false, false);
      }
    } catch (e) { }
  }

  function silenceReplay() {
    var pl = RR.player;
    if (!pl || typeof pl.stop !== 'function') return;
    var a = null;
    if (typeof pl.audioState === 'function') {
      try { a = pl.audioState(); } catch (e) { a = null; }
    }
    if (a) {
      // 正在播 / 正在缓冲：都算「将要出声」，一起停掉，别等它突然响
      if (a.item && (a.playing || a.loading || a.pending)) { try { pl.stop(); } catch (e) {} }
      return;
    }
    var on2 = false;
    if (typeof pl.isPlaying === 'function') {
      try { on2 = !!pl.isPlaying(); } catch (e) { on2 = false; }
    }
    if (on2) { try { pl.stop(); } catch (e) {} }
  }

  function tryPlay() {
    if (!D.video) return;
    if (!st.muted) silenceReplay();   // 这一下 play() 会出声：先让回放闭嘴
    try {
      var p = D.video.play();
      if (p && typeof p.catch === 'function') p.catch(function () { onAutoplayBlocked(); });
    } catch (e) {}
  }

  function onAutoplayBlocked() {
    if (st.muted) {
      // 静音都起不来：多半是流本身还没到，稍后再试一次
      setTimeout(function () {
        if (!st.active || !st.living || !D.video) return;
        if (!D.video.paused) return;
        try { var p = D.video.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
      }, 600);
      return;
    }
    // 带声音的自动播放被策略拒绝：退回静音并说人话，别静默失败
    st.muted = true;
    applyMute();
    saveSettings({ liveMuted: true });
    tryPlay();
    toast('浏览器先静音了画面，点喇叭开声');
  }

  function applyMute(quiet) {
    // 用户把直播开声（applyMute(false) 路径）：先停回放，再让直播出声
    if (!st.muted && !quiet) silenceReplay();
    if (D.video) D.video.muted = st.muted;
    if (D.mute) {
      D.mute.innerHTML = ico(st.muted ? 'mute' : 'volume');
      D.mute.setAttribute('aria-pressed', st.muted ? 'true' : 'false');
      D.mute.setAttribute('aria-label', st.muted ? '声音：已静音' : '声音：开');
      D.mute.classList.toggle('is-off', st.muted);
    }
  }

  function toggleMute() {
    if (!st.living) return;
    st.muted = !st.muted;
    applyMute();
    saveSettings({ liveMuted: st.muted });
    if (!st.muted) {
      tryPlay();
      toast('声音开了');
    }
  }

  // 离开 / 换台：保最后一帧，destroy 延后 60ms
  function stopStream(keepFrame) {
    syncNowPlaying(false);
    clearFirstFrame();
    st.curDirect = false;      // 旧 attempt 的尾巴不再算直连失败
    if (st.fbTimer) { clearTimeout(st.fbTimer); st.fbTimer = 0; }
    var p = st.player;
    st.player = null;
    flushPendingDestroy();     // 上一个延后销毁的播放器先清掉（这之后到的 error 一律不算）
    if (D.video) { try { D.video.pause(); } catch (e) {} }
    if (!p) {
      if (!keepFrame) releaseVideo();
      return;
    }
    var destroy = function () {
      try { p.pause(); } catch (e) {}
      try { p.unload(); } catch (e) {}
      try { p.detachMediaElement(); } catch (e) {}
      try { p.destroy(); } catch (e) {}
      if (!keepFrame) releaseVideo();
    };
    if (keepFrame) {
      st.pendDestroy = destroy;
      st.pendTimer = setTimeout(function () {
        st.pendTimer = 0;
        var d = st.pendDestroy;
        st.pendDestroy = null;
        if (d) d();
      }, 60);
    } else {
      destroy();
    }
  }

  function flushPendingDestroy() {
    if (st.pendTimer) { clearTimeout(st.pendTimer); st.pendTimer = 0; }
    var d = st.pendDestroy;
    st.pendDestroy = null;
    if (d) d();
  }

  function releaseVideo() {
    if (!D.video) return;
    try {
      D.video.removeAttribute('src');
      D.video.load();
    } catch (e) {}
  }

  /* ---------------- 计时：追帧 + 看门狗 ---------------- */

  function startTimers() {
    stopTimers();
    st.chaseTimer = setInterval(chaseTick, 1000);
    st.wdTimer = setInterval(watchdog, 2000);
  }

  function stopTimers() {
    if (st.chaseTimer) { clearInterval(st.chaseTimer); st.chaseTimer = 0; }
    if (st.wdTimer) { clearInterval(st.wdTimer); st.wdTimer = 0; }
    if (st.streamTimer) { clearTimeout(st.streamTimer); st.streamTimer = 0; }
    if (st.esTimer) { clearTimeout(st.esTimer); st.esTimer = 0; }
  }

  function chaseTick() {
    if (!st.active || !st.living) return;
    var v = D.video;
    if (!v) return;
    try {
      var b = v.buffered;
      if (!b || !b.length) return;
      var end = b.end(b.length - 1);
      var behind = end - v.currentTime;
      if (behind > 4.5 && Date.now() - st.lastChase > 8000) {
        st.lastChase = Date.now();
        v.currentTime = Math.max(0, end - 1.2);
      }
    } catch (e) {}
  }

  function watchdog() {
    if (!st.active || !st.living || !st.player) return;
    var v = D.video;
    if (!v) return;
    var t = v.currentTime;

    if (v.paused) {
      if (Date.now() - st.lastPlayTry > 4000) {
        st.lastPlayTry = Date.now();
        tryPlay();
      }
      return;
    }
    if (Math.abs(t - st.wdAt) < 0.08) {
      st.stall++;
      if (st.stall >= 4) {
        st.stall = 0;
        if (fallbackDirect()) return;   // 直连卡死：先降级，别在原地址上重试到死
        scheduleReconnect('画面没有前进');
      }
    } else {
      st.stall = 0;
      st.wdAt = t;
      st.streamRetry = 0;
    }
  }

  /* ---------------- 弹幕 SSE ---------------- */

  function openChat() {
    closeChat();
    if (typeof window.EventSource !== 'function') {
      setConn('off', '不支持');
      return;
    }
    setConn('idle', '连接中');
    var es;
    try {
      es = new window.EventSource('/api/live/chat/stream?station=' + encodeURIComponent(st.stationId));
    } catch (e) {
      setConn('err', '连不上');
      scheduleChat();
      return;
    }
    st.es = es;

    es.onopen = function () {
      if (st.es !== es) return;
      st.esRetry = 0;
      setConn('on', '已连接');
    };
    es.onmessage = function (ev) {
      if (st.es !== es) return;
      onChatMsg(ev && ev.data);
    };
    es.onerror = function () {
      if (st.es !== es) return;
      if (es.readyState === 2) {
        setConn('err', '断开');
        closeChat();
        scheduleChat();
      } else {
        setConn('err', '重连中');
      }
    };
  }

  function scheduleChat() {
    if (st.esTimer) return;
    var wait = Math.min(15000, 2500 * Math.pow(2, Math.min(st.esRetry, 3)));
    st.esRetry++;
    st.esTimer = setTimeout(function () {
      st.esTimer = 0;
      if (st.active && st.living) openChat();
    }, wait);
  }

  function closeChat() {
    var es = st.es;
    st.es = null;
    if (es) {
      try { es.onopen = es.onmessage = es.onerror = null; } catch (e) {}
      try { es.close(); } catch (e) {}
    }
  }

  function setConn(state, text) {
    if (D.conn) D.conn.setAttribute('data-state', state);
    if (D.connTxt) D.connTxt.textContent = text || '';
  }

  function onChatMsg(raw) {
    if (typeof raw !== 'string' || !raw) return;
    var m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;

    var type = String(m.type || '');
    if (type === 'danmaku') {
      addLine('dm', m.uname, m.text);
    } else if (type === 'superchat') {
      addLine('sc', m.uname, m.text, m.price);
    } else if (type === 'state') {
      setConn('on', '已连接');
    } else if (type === 'popularity') {
      setPopularity(m.value);
    } else if (type === 'gift') {
      if (m.text) addLine('sys', '', '收到礼物 · ' + m.text);
    }
    // 其它类型安静忽略，不打扰
  }

  function addLine(kind, user, text, price) {
    if (!D.feed) return;
    var body = String(text == null ? '' : text).replace(/\s+$/, '');
    if (!body) return;
    if (body.length > 140) body = body.slice(0, 140) + '…';

    var near = nearBottom();
    var li = mk('li', 'chat-line' + (kind === 'sc' ? ' is-sc' : kind === 'sys' ? ' is-sys' : ''));

    if (kind === 'sc' && price) {
      var p = mk('span', 'chat-line__price num', '¥' + price);
      li.appendChild(p);
    }
    if (user) {
      var u = mk('span', 'chat-line__u truncate', String(user).slice(0, 18));
      li.appendChild(u);
    }
    li.appendChild(mk('span', 'chat-line__t', body));
    D.feed.appendChild(li);

    st.feedCount++;
    while (D.feed.children.length > 120) {
      D.feed.removeChild(D.feed.firstChild);
    }
    if (D.empty) D.empty.hidden = true;

    if (near || st.follow) toBottom();
    else bump();
  }

  function nearBottom() {
    var f = D.feed;
    if (!f) return true;
    return f.scrollHeight - f.scrollTop - f.clientHeight < 28;
  }

  function toBottom() {
    var f = D.feed;
    if (!f) return;
    f.scrollTop = f.scrollHeight;
    st.follow = true;
    st.unseen = 0;
    if (D.neu) D.neu.hidden = true;
  }

  function bump() {
    st.follow = false;
    st.unseen++;
    if (D.neu) D.neu.hidden = false;
    if (D.neuTxt) D.neuTxt.textContent = st.unseen > 1 ? ('有新弹幕 ' + st.unseen) : '有新弹幕';
  }

  function onFeedScroll() {
    if (nearBottom()) {
      st.follow = true;
      st.unseen = 0;
      if (D.neu) D.neu.hidden = true;
    } else {
      st.follow = false;
    }
  }

  /* ---------------- 发送 ---------------- */

  function account() {
    // 真源：/api/status 的 {logged,jct,mid}；其次看别的模块有没有共享 account 对象
    if (st.acct && typeof st.acct === 'object') return st.acct;
    try {
      if (RR.account && typeof RR.account === 'object') return RR.account;
      if (RR.me && typeof RR.me.account === 'function') {
        var a = RR.me.account();
        if (a && typeof a === 'object') return a;
      }
    } catch (e) {}
    return null;
  }

  function loggedOut() {
    var a = account();
    if (!a) return false;                     // 不知道就别拦，别把能发的人锁死
    if (typeof a.logged === 'boolean') return !a.logged;
    if (typeof a.jct === 'boolean') return !a.jct;
    if (a.mid != null) return !(Number(a.mid) > 0);
    return false;
  }

  function refreshAccount() {
    api('/api/status').then(function (d) {
      if (!d || typeof d !== 'object') return;
      st.acct = { logged: d.logged !== false, jct: !!d.jct, mid: d.mid, uname: d.uname || '' };
      updateSend();
    }, function () { /* 取不到就维持未知，不拦发送 */ });
  }

  function hintLogin() {
    var now = Date.now();
    if (now - st.loginHintAt < 4000) return;
    st.loginHintAt = now;
    toast('发弹幕要先用 B 站账号扫码登录');
  }

  function updateSend() {
    var off = st.needLogin || loggedOut();
    var val = D.input ? String(D.input.value || '').trim() : '';
    if (D.send) D.send.disabled = !val || off || st.sending || !st.living;
    if (D.input) D.input.placeholder = off ? '说点什么…（需登录）' : '说点什么…';
    if (D.loginbar) D.loginbar.hidden = !off;
  }

  function submit() {
    if (!D.input) return;
    sendText(D.input.value, null);
  }

  function sendText(text, emo) {
    if (!st.active || !st.living) { toast('现在没有开播，发不了弹幕', 'err'); return; }
    if (st.needLogin || loggedOut()) { hintLogin(); return; }

    var body = String(text == null ? '' : text).trim();
    if (!body) return;
    if (body.length > 20) { toast('弹幕最多 20 个字', 'err'); return; }
    if (st.sending) return;

    st.sending = true;
    updateSend();

    var payload = { text: body };
    if (emo) payload.emoticonOptions = emo;

    post('/api/live/send', payload).then(function () {
      st.sending = false;
      if (emo) closeEmoPick();
      else if (D.input) D.input.value = '';
      updateSend();
      toast(emo ? '表情发出去了' : '弹幕发出去了');
    }, function (err) {
      st.sending = false;
      var status = err && err.status;
      var msg = (err && err.message) || '';
      if (status === 401 || status === 403 || /登录|未登录|身份|token|验证/i.test(msg)) {
        st.needLogin = true;
        updateSend();
        hintLogin();
        return;
      }
      updateSend();
      toast(humanErr(msg), 'err');
    });
  }

  /* ---------------- 表情 ---------------- */

  function emoErrText(err) {
    var s = err && err.status;
    if (s === 404) return '表情库还没接通，后端还在做——先打字吧。';
    if (!s || s >= 500) return '表情库暂时取不到，等一下再试。';
    return '表情库暂不可用，先打字吧。';
  }

  function setEmoMsg(text, retry) {
    if (D.emoMsg) D.emoMsg.textContent = text || '';
    if (D.emoMsgWrap) D.emoMsgWrap.hidden = !text;
    if (D.emoRetry) D.emoRetry.hidden = !retry;
  }

  function loadEmoticons(force) {
    var E = st.emo;
    if (E.loading) return;
    if (!force && E.loaded && E.room === st.room) { renderEmo(); return; }
    E.loading = true;
    E.room = st.room;
    setEmoMsg('正在取表情…');
    api('/api/live/emoticons?room=' + encodeURIComponent(st.room || st.stationId)).then(function (res) {
      E.loading = false;
      var packs = (res && res.packs) || [];
      var clean = [];
      for (var i = 0; i < packs.length; i++) {
        var p = packs[i];
        if (!p || !p.items || !p.items.length) continue;
        clean.push({ name: p.name || ('表情 ' + (clean.length + 1)), items: p.items });
      }
      E.packs = clean;
      E.loaded = true;
      E.pack = 0;
      E.picked = null;
      if (D.emoPrev) D.emoPrev.hidden = true;
      if (!clean.length) setEmoMsg('这个房间还没有可用表情，先打字吧。');
      else setEmoMsg('');
      renderEmo();
    }, function (err) {
      E.loading = false;
      E.loaded = false;
      E.packs = [];
      E.room = '';
      setEmoMsg(emoErrText(err), true);
      renderEmo();
    });
  }

  function renderEmo() {
    renderEmoTabs();
    renderEmoGrid();
  }

  function renderEmoTabs() {
    var wrap = D.emoTabs;
    if (!wrap) return;
    wrap.innerHTML = '';
    var packs = st.emo.packs;
    for (var i = 0; i < packs.length; i++) {
      var b = mk('button', 'lv-etab' + (i === st.emo.pack ? ' is-on' : ''), packs[i].name);
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', i === st.emo.pack ? 'true' : 'false');
      b.setAttribute('data-i', String(i));
      b.addEventListener('click', (function (idx) {
        return function () { st.emo.pack = idx; renderEmo(); };
      })(i));
      wrap.appendChild(b);
    }
    wrap.hidden = packs.length < 2;
  }

  function renderEmoGrid() {
    var grid = D.emoGrid;
    if (!grid) return;
    grid.innerHTML = '';
    var pack = st.emo.packs[st.emo.pack];
    if (!pack) return;
    var items = pack.items.slice(0, 96);
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it || !it.url) continue;
      var b = mk('button', 'lv-eitem');
      b.type = 'button';
      b.setAttribute('aria-label', it.name || '表情');
      if (it.name) b.title = it.name;
      var img = document.createElement('img');
      img.className = 'lv-eimg';
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.width = 32;
      img.height = 32;
      img.src = it.url;
      (function (node, item, btn) {
        img.addEventListener('error', function () {
          try { node.remove(); } catch (e) {}
          if (!btn.querySelector('.lv-efb')) {
            btn.appendChild(mk('span', 'lv-efb', String(item.name || '?').slice(0, 2)));
            btn.classList.add('is-broken');
          }
        }, { once: true });
        btn.addEventListener('click', function () { pickEmo(item, btn); });
      })(img, it, b);
      b.appendChild(img);
      grid.appendChild(b);
    }
  }

  function pickEmo(item, btn) {
    st.emo.picked = item;
    if (D.emoPrev) D.emoPrev.hidden = false;
    if (D.emoImg) { D.emoImg.src = item.url; D.emoImg.alt = ''; }
    if (D.emoName) D.emoName.textContent = item.name || '表情';
    if (D.emoSend) D.emoSend.disabled = false;
    var prev = D.emoGrid ? D.emoGrid.querySelector('.lv-eitem.is-sel') : null;
    if (prev) prev.classList.remove('is-sel');
    if (btn) btn.classList.add('is-sel');
    keepAboveDock(D.emoPrev, 40);
  }

  function closeEmoPick() {
    st.emo.picked = null;
    if (D.emoPrev) D.emoPrev.hidden = true;
    var prev = D.emoGrid ? D.emoGrid.querySelector('.lv-eitem.is-sel') : null;
    if (prev) prev.classList.remove('is-sel');
  }

  // 面板贴底，底部还压着悬浮 dock：把节点滚到 dock 上方
  function keepAboveDock(node, delay) {
    if (!node) return;
    setTimeout(function () {
      try {
        var r = node.getBoundingClientRect();
        var room = window.innerHeight - 96;
        if (r.bottom > room) window.scrollBy(0, Math.min(r.bottom - room + 8, 460));
      } catch (e) {}
    }, delay || 90);
  }

  function toggleEmo() {
    if (!D.emo) return;
    var open = !!D.emo.hidden;
    D.emo.hidden = !open;
    if (D.emoBtn) D.emoBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (D.panel) D.panel.classList.toggle('is-emo', open);
    if (!open) return;
    loadEmoticons(false);
    keepAboveDock(D.emo, 90);
  }

  function sendEmoji() {
    var it = st.emo.picked;
    if (!it) return;
    var opt = {
      unique: it.unique || '',
      name: it.name || '',
      url: it.url || '',
      w: Number(it.w) || 0,
      h: Number(it.h) || 0
    };
    sendText('[' + (it.name || '表情') + ']', opt);
  }

  /* ---------------- 画质 ---------------- */

  // 常见档位兜底（接口只回 1 档时补全；后端对不可用档会回落到可用档）
  var QN_TIERS = [10000, 400, 250, 150, 80];
  var QN_DESC = { 10000: '原画', 400: '蓝光', 250: '超清', 150: '高清', 80: '流畅' };
  var SW_TEXT = '正在切到';
  var HOLD_MAX = 2500;    // 定格帧最多铺 2.5s，兜底移除
  var SW_MAX = 10000;     // 切档整体超时：再等就回原档，不卡在 reconnect

  function hasQuality(qn) {
    qn = Number(qn) || 0;
    for (var i = 0; i < st.qualities.length; i++) {
      if (Number(st.qualities[i].qn) === qn) return true;
    }
    return false;
  }

  function qnLabel(qn) {
    qn = Number(qn) || 0;
    for (var i = 0; i < st.qualities.length; i++) {
      if (Number(st.qualities[i].qn) === qn) {
        return st.qualities[i].desc || QN_DESC[qn] || ('QN ' + qn);
      }
    }
    return QN_DESC[qn] || (qn ? ('QN ' + qn) : '原画');
  }

  // 接口档位 + 常见档兜底 + accept_qn 过滤（accept_qn 为空时保留补全结果）
  function normalizeQualities(info) {
    var out = [], seen = {}, i, q, qn;
    var src = (info && info.qualities) || [];
    for (i = 0; i < src.length; i++) {
      q = src[i];
      if (!q || !q.qn) continue;
      qn = Number(q.qn);
      if (!qn || seen[qn]) continue;
      seen[qn] = 1;
      out.push({ qn: qn, desc: q.desc || QN_DESC[qn] || ('QN ' + qn) });
    }
    if (out.length < 2) {
      for (i = 0; i < QN_TIERS.length; i++) {
        qn = QN_TIERS[i];
        if (seen[qn]) continue;
        seen[qn] = 1;
        out.push({ qn: qn, desc: QN_DESC[qn] });
      }
    }
    var accept = info && info.accept_qn;
    if (typeof accept === 'string') accept = accept.split(',');
    if (accept && accept.length) {
      var allowed = {};
      for (i = 0; i < accept.length; i++) {
        qn = Number(accept[i]);
        if (qn) allowed[qn] = 1;
      }
      var keep = [];
      for (i = 0; i < out.length; i++) {
        if (allowed[out[i].qn]) keep.push(out[i]);
      }
      if (keep.length) out = keep;
    }
    return out;
  }

  function setQuality(qn) {
    qn = Number(qn) || 0;
    if (!qn || qn === st.qn) return;
    var from = st.qn;
    st.qn = qn;
    st.noDirect = false;       // 换清晰度：重新给直连一次机会（直连只对应 flv_qn 那一档）
    storeSet('liveQn', qn);
    renderQuality();
    if (!st.living) {
      toast('画质：' + qnLabel(qn));
      return;
    }
    st.streamRetry = 0;
    beginSwitch(qn, from);
    startStream();
  }

  /* ---- 切档现场：定格帧铺住舞台 → 换流 → 首帧上屏再撤 ---- */

  function captureFrame() {
    var v = D.video;
    if (!v || !v.videoWidth || !v.videoHeight) return null;
    if (v.readyState < 2) return null;
    var cv = document.createElement('canvas');
    cv.className = 'lv-hold';
    cv.width = v.videoWidth;
    cv.height = v.videoHeight;
    try {
      cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height);
    } catch (e) {
      return null;
    }
    return cv;
  }

  function removeNode(n) {
    if (!n) return;
    try { if (n.parentNode) n.parentNode.removeChild(n); } catch (e) {}
  }

  // 抓当前帧铺在 video 之上（z-index 低于提示层），切完淡出移除
  function showHold() {
    dropHold(true);
    var cv = captureFrame();
    if (!cv || !D.stage) return;
    D.stage.appendChild(cv);
    st.hold = cv;
  }

  function dropHold(now) {
    if (st.holdTimer) { clearTimeout(st.holdTimer); st.holdTimer = 0; }
    var cv = st.hold;
    st.hold = null;
    if (!cv) return;
    if (now) { removeNode(cv); return; }
    try { cv.classList.add('is-out'); } catch (e) {}
    setTimeout(function () { removeNode(cv); }, 240);
  }

  function setSwPill(text) {
    if (!D.stage) return;
    if (!st.swPill || st.swPill.parentNode !== D.stage) {
      st.swPill = mk('div', 'lv-sw');
      st.swPill.setAttribute('role', 'status');
      D.stage.appendChild(st.swPill);
    }
    st.swPill.textContent = text || '';
  }

  function clearSwPill() {
    removeNode(st.swPill);
    st.swPill = null;
  }

  function beginSwitch(target, from) {
    abortSwitch();
    showHold();
    if (st.hold) {
      st.holdTimer = setTimeout(function () {
        st.holdTimer = 0;
        dropHold();
      }, HOLD_MAX);
    }
    var sw = { target: target, from: from, tries: 0, armed: false, timer: 0 };
    sw.timer = setTimeout(function () {
      if (st.sw !== sw) return;
      switchFailed();
    }, SW_MAX);
    st.sw = sw;
    var text = SW_TEXT + qnLabel(target) + '…';
    setSwPill(text);
    setState('reconnect', text, false);
  }

  // playing 之后等这一帧真的呈现（rVFC），没有就用 playing+120ms
  function onSwitchFrame() {
    var sw = st.sw;
    if (!sw || sw.armed) return;
    // 只认「新播放器已挂上 + 视频真的在走」的那一次 playing，旧流的尾巴不算
    var v = D.video;
    if (!v || !st.player || v.paused) return;
    sw.armed = true;
    var fin = function () {
      if (st.sw !== sw) return;
      switchDone(sw);
    };
    if (typeof v.requestVideoFrameCallback === 'function') {
      try {
        v.requestVideoFrameCallback(function () { setTimeout(fin, 30); });
        return;
      } catch (e) {}
    }
    setTimeout(fin, 120);
  }

  function switchDone(sw) {
    if (sw.timer) { clearTimeout(sw.timer); sw.timer = 0; }
    if (st.sw === sw) st.sw = null;
    dropHold();
    setTimeout(function () {
      if (!st.sw) clearSwPill();
    }, 220);
    toast('画质：' + qnLabel(sw.target));
  }

  function switchFailed() {
    var sw = st.sw;
    if (!sw) return;
    st.sw = null;
    if (sw.timer) { clearTimeout(sw.timer); sw.timer = 0; }
    if (st.streamTimer) { clearTimeout(st.streamTimer); st.streamTimer = 0; }
    var back = Number(sw.from) || 0;
    if (!back) {
      for (var i = 0; i < st.qualities.length; i++) {
        var q = Number(st.qualities[i].qn);
        if (q && q !== Number(sw.target)) { back = q; break; }
      }
    }
    st.qn = back;
    storeSet('liveQn', back);
    renderQuality();
    dropHold(true);
    clearSwPill();
    toast('切到' + qnLabel(sw.target) + '没成功，' + (back ? ('回到' + qnLabel(back)) : '先按默认画质播'), 'err');
    if (!st.active || !st.living) return;
    st.streamRetry = 0;
    setState('reconnect', back ? ('正在回到' + qnLabel(back) + '…') : '正在按默认画质重连…', false);
    // 下一拍再拉流：别在 mpegts 的 error 回调里同步销毁它自己
    setTimeout(function () {
      if (st.active && st.living && !st.sw) startStream();
    }, 0);
  }

  // 离场 / 切台 / 信息刷新：清掉定格帧与状态，不做回退
  function abortSwitch() {
    var sw = st.sw;
    st.sw = null;
    if (sw && sw.timer) clearTimeout(sw.timer);
    dropHold(true);
    clearSwPill();
  }

  function pickQuality() {
    if (!st.living || st.qualities.length < 2) return;

    if (typeof RR.sheet !== 'function') {
      // 没有抽屉就顺序切，别让按钮变成死的
      var idx = 0;
      for (var i = 0; i < st.qualities.length; i++) {
        if (Number(st.qualities[i].qn) === Number(st.qn)) { idx = i; break; }
      }
      setQuality(st.qualities[(idx + 1) % st.qualities.length].qn);
      return;
    }

    // 抽屉在 #view-live 之外，样式只能用基础类 + 行内变量，别写越界的 CSS 选择器
    var body = mk('div', 'stack');
    st.qualities.forEach(function (q) {
      var cur = Number(q.qn) === Number(st.qn);
      var row = mk('button', 'btn');
      row.type = 'button';
      row.style.width = '100%';
      row.style.height = '48px';
      row.style.justifyContent = 'space-between';
      row.style.marginBottom = 'var(--sp-2)';
      row.style.background = cur ? 'var(--accent-soft)' : 'var(--bg-surface-tonal)';
      if (cur) row.style.color = 'var(--accent)';
      row.appendChild(mk('span', '', q.desc || ('QN ' + q.qn)));
      row.appendChild(mk('span', 'num', cur ? '当前' : String(q.qn)));
      row.addEventListener('click', function () {
        try { if (sheet && sheet.close) sheet.close(); } catch (e) {}
        setQuality(q.qn);
      });
      body.appendChild(row);
    });

    var sheet = null;
    try {
      sheet = RR.sheet({ title: '画质', body: body });
    } catch (e) {
      sheet = null;
    }
  }

  /* ---------------- 全屏 ---------------- */

  function liveRoot() {
    return st.root || document.getElementById('view-live');
  }

  /* 顶栏 / dock / 小窗在 #view-live 之外，视图 CSS 不能越界选它们，
     这里临时把 visibility / pointer-events 藏起来，退出时原样还回去。 */
  function setChromeHidden(hide) {
    if (hide) {
      if (st.chromeHidden) return;
      var list = [document.querySelector('.top'), document.getElementById('dock'), document.querySelector('.mini')];
      var saved = [];
      for (var i = 0; i < list.length; i++) {
        var n = list[i];
        if (!n) continue;
        saved.push({ n: n, vis: n.style.visibility || '', pe: n.style.pointerEvents || '' });
        n.style.visibility = 'hidden';
        n.style.pointerEvents = 'none';
      }
      st.chromeHidden = saved;
      return;
    }
    var back = st.chromeHidden;
    st.chromeHidden = null;
    if (!back) return;
    for (var j = 0; j < back.length; j++) {
      try {
        back[j].n.style.visibility = back[j].vis;
        back[j].n.style.pointerEvents = back[j].pe;
      } catch (e) {}
    }
  }

  function toggleFs() {
    if (!st.living) return;
    if (st.fsOn) exitFs();
    else enterFs();
  }

  /* 全屏真相是 #view-live 的 .is-fs：WebView 里 DOM fullscreen 经常不生效，
     所以横屏 + 系统栏一律走原生桥接为主，DOM 请求只在桥接缺失时兜底。 */
  function enterFs() {
    var root = liveRoot();
    if (!root || st.fsOn) return;
    st.fsOn = true;
    st.fsApplied = false;
    root.classList.add('is-fs');
    setChromeHidden(true);                         // 顶栏 / dock / mini 让位
    if (st.bodyOverflow == null) st.bodyOverflow = document.body.style.overflow || '';
    document.body.style.overflow = 'hidden';
    setFsIcon(true);

    var br = window.AndroidRadio || null;
    var hasBridge = false;
    if (br) {
      if (typeof br.setFullscreen === 'function') {
        hasBridge = true;
        try { br.setFullscreen(true); } catch (e) {}
      }
      if (typeof br.setOrientation === 'function') {
        hasBridge = true;
        try { br.setOrientation('landscape'); } catch (e) {}
      }
    }
    st.fsApplied = hasBridge;
    if (!hasBridge) { requestDomFs(root); return; }

    /* 有些机型/主题下第一下 setFullscreen + 旋屏会被忽略（尤其是刚进页面就点全屏），
       过一拍再确认一次；用户已经退出就什么都不做。 */
    if (st.fsTimer) { clearTimeout(st.fsTimer); st.fsTimer = 0; }
    st.fsTimer = setTimeout(function () {
      st.fsTimer = 0;
      if (!st.fsOn) return;
      var b = window.AndroidRadio || null;
      if (!b) return;
      if (typeof b.setOrientation === 'function') { try { b.setOrientation('landscape'); } catch (e) {} }
      if (typeof b.setFullscreen === 'function') { try { b.setFullscreen(true); } catch (e) {} }
    }, 280);
  }

  function requestDomFs(root) {
    var fn = root.requestFullscreen || root.webkitRequestFullscreen;
    if (typeof fn !== 'function') return;
    var p = null;
    try { p = fn.call(root); } catch (e) { p = null; }
    if (p && typeof p.then === 'function') {
      p.then(function () { st.fsApplied = true; }, function () {});
    } else {
      st.fsApplied = true;
    }
  }

  function exitFs(quiet) {
    var was = st.fsOn;
    var applied = st.fsApplied;
    st.fsOn = false;
    st.fsApplied = false;
    if (st.fsTimer) { clearTimeout(st.fsTimer); st.fsTimer = 0; }
    setFsIcon(false);
    var root = liveRoot();
    if (root) root.classList.remove('is-fs');
    setChromeHidden(false);
    if (st.bodyOverflow != null) {
      try { document.body.style.overflow = st.bodyOverflow; } catch (e) {}
      st.bodyOverflow = null;
    }
    if (!was && !applied && quiet) return;   // 没真进过全屏：不用碰系统栏/方向

    var br = window.AndroidRadio || null;
    if (br) {
      if (typeof br.setFullscreen === 'function') { try { br.setFullscreen(false); } catch (e) {} }
      if (typeof br.setOrientation === 'function') { try { br.setOrientation('portrait'); } catch (e) {} }
    }
    try {
      if (document.fullscreenElement && typeof document.exitFullscreen === 'function') {
        var p = document.exitFullscreen();
        if (p && p.catch) p.catch(function () {});
      } else if (document.webkitFullscreenElement && typeof document.webkitExitFullscreen === 'function') {
        document.webkitExitFullscreen();
      }
    } catch (e) {}
  }

  function setFsIcon(on2) {
    if (!D.fs) return;
    D.fs.innerHTML = ico(on2 ? 'collapse' : 'expand');
    D.fs.setAttribute('aria-label', on2 ? '退出全屏' : '全屏观看');
  }

  // DOM 兜底全屏被系统退出时，class / 方向也要跟着收回来
  function onFsChange() {
    if (!st.fsOn) return;
    if (document.fullscreenElement || document.webkitFullscreenElement) return;
    exitFs(true);
  }

  /* 系统返回键等原生统一退出入口（35-fs / 30-player 也是这么串的） */
  var prevExitFs = window.__rrExitFs;
  window.__rrExitFs = function () {
    if (st.fsOn) { exitFs(); return true; }
    return typeof prevExitFs === 'function' ? prevExitFs() : false;
  };

  /* ---------------- 对外 ---------------- */

  RR.live = {
    mount: mount,
    enter: enter,
    leave: leave,
    state: function () {
      return {
        state: st.state,
        living: st.living,
        room: st.room,
        station: st.stationId,
        qn: st.qn,
        muted: st.muted,
        chat: st.feedCount,
        unseen: st.unseen,
        emoticons: st.emo.packs.length
      };
    },
    send: sendText,
    refresh: function () { if (st.active) retryNow(); },
    /* 从原生悬浮窗回到 App：按当前画质重新拉一次流 */
    reconnect: function () { if (st.active) { retryNow(); } },
    toggleEmoji: toggleEmo
  };

  // 90-boot 按 RR.modules[name] 挂载，必须走 RR.view 注册
  if (typeof RR.view === 'function') RR.view('live', RR.live);
})();
/* ============================================================
   42-day.js · 24H 时间带（view-day）
   数据：GET /api/cycle?station=<id> → {total, position, segments[]}
   位置 = 取到排期的 position + 真实流逝，按 total 取模；
   切台：监听 RR.on('station'/'station-changed')，作废缓存并按当前主播重取；
        返回的排期与当前主播对不上时（旧后端忽略 station 参数）强取一次；
        只有最新一次请求能落画，避免快速切台时旧响应盖回新排期。
   只在「当前段」变化时重画高亮，指针每 1s 只动 transform。
   8.0.0：进入页面与刷新排期都不再自动滚到「现在」（无 scheduleScroll 调用点），
          只在用户点 #day-jump「回到现在」时执行 scrollToNow。
   ============================================================ */
(function () {
  'use strict';
  var RR = window.RR;
  if (!RR) return;

  var PX_PER_MIN = 1.6;       /* 时间带比例：1 分钟 = 1.6px；保持真实比例，不随切台变 */
  var PAD = 14;               /* 带内上下留白 */
  var CELL_MIN = 30;          /* 点击格：30 分钟一格 */
  var SCROLL_DELAY = 420;     /* 8.0.0 起不再自动滚；只为保留的 scheduleScroll 定义留着 */
  var STALE = 60000;          /* 排期多久算旧 */
  var MIN_HIT = 44;           /* 命中格最小高度 */
  var BLOCK_GAP = 3;          /* 段块之间的视觉缝隙 */
  var EVT_GAP = 400;          /* station / station-changed 双事件的去重窗口 */
  var SAME_MAX = 2500;        /* 同一主播重复事件在这个窗口内不重复取 */

  var st = {
    mounted: false,
    alive: false,
    loading: false,
    loadingSid: '',
    data: null,
    stationId: '',
    fetchedAt: 0,
    dirty: true,
    mismatch: false,
    reqSeq: 0,
    evtSid: '',
    evtAt: 0,
    curIdx: -1,
    curGroup: -1,
    ticker: 0,
    scrollTimer: 0,
    nowEl: null,
    blockEls: [],
    jumpRaf: 0
  };

  var el = {};

  /* ---------- 小工具 ---------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function fmtHMS(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return pad2(h) + ':' + pad2(m) + ':' + pad2(s);
  }
  function hm(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
    return pad2(h) + ':' + pad2(m);
  }
  function durText(sec) {
    var m = Math.max(1, Math.round((Number(sec) || 0) / 60));
    if (m >= 60) {
      var h = Math.floor(m / 60), mm = m % 60;
      return mm ? (h + ' 小时 ' + mm + ' 分') : (h + ' 小时');
    }
    return m + ' 分钟';
  }
  function reduced() {
    return document.documentElement.classList.contains('reduce-motion');
  }
  function segAt(list, t) {
    var a = list || (st.data && st.data.segments) || [];
    if (!a.length) return 0;
    var lo = 0, hi = a.length - 1, ans = 0;
    while (lo <= hi) {
      var mid = (lo + hi) >> 1;
      if (a[mid].start <= t) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    return ans;
  }

  /* ---------- 当前主播 ---------- */
  function stationNow() {
    try { return (RR.station && RR.station()) || null; } catch (e) { return null; }
  }
  function sidOf(s) {
    if (!s) return '';
    var id = (s.id != null) ? s.id : s.mid;
    return (id == null) ? '' : String(id);
  }
  function sidNow() { return sidOf(stationNow()); }

  /* ---------- 数据规整 ---------- */
  function indexPrograms(d) {
    var map = {};
    ((d && d.programs) || []).forEach(function (p) {
      if (!p) return;
      var cat = String(p.category || p.cat || p.kind || '');
      var parts = p.parts || [];
      if (!parts.length) {
        map[String(p.bvid || '') + '|' + String(p.cid || '')] = { category: cat, dm: +p.dm_total || 0 };
        return;
      }
      parts.forEach(function (pt) {
        map[String(p.bvid || '') + '|' + String(pt.cid || '')] = {
          category: String(pt.category || cat),
          dm: +pt.dm_total || +pt.dm || 0
        };
      });
    });
    return map;
  }

  function applyMeta(d, map) {
    if (!map) return d;
    d.segments.forEach(function (s) {
      var m = map[s.bvid + '|' + s.cid];
      if (!m) return;
      s.cat = m.category || '';
      s.dm = +m.dm || 0;
    });
    d.groups.forEach(function (g) {
      var cat = '', dm = 0;
      for (var i = g.from; i <= g.to; i++) {
        var sg = d.segments[i];
        if (!sg) continue;
        if (!cat && sg.cat) cat = sg.cat;
        dm += sg.dm || 0;
      }
      g.cat = cat;
      g.dm = dm;
    });
    return d;
  }

  function normalize(d, metaMap) {
    if (!d || !Array.isArray(d.segments)) throw new Error('排期是空的');
    var segs = d.segments.filter(function (s) { return s && +s.duration > 0; })
      .map(function (s) {
        return {
          bvid: String(s.bvid || ''),
          cid: String(s.cid || ''),
          title: String(s.title || '未命名节目'),
          cover: String(s.cover || ''),
          start: Math.max(0, Number(s.start) || 0),
          duration: Math.max(0.1, Number(s.duration) || 0)
        };
      })
      .sort(function (a, b) { return a.start - b.start; });
    if (!segs.length) throw new Error('排期还是空的');
    var total = Number(d.total) || (segs[segs.length - 1].start + segs[segs.length - 1].duration);
    var pos = Number(d.position) || 0;
    pos = Math.max(0, Math.min(total - 0.1, pos));

    var groups = [];
    var groupOf = [];
    segs.forEach(function (s, i) {
      var g = groups[groups.length - 1];
      if (g && g.title === s.title && Math.abs(g.end - s.start) < 1.5) {
        g.end = s.start + s.duration;
        g.to = i;
      } else {
        groups.push({ title: s.title, start: s.start, end: s.start + s.duration, from: i, to: i });
      }
      groupOf[i] = groups.length - 1;
    });

    var out = {
      total: total,
      position: pos,
      segments: segs,
      groups: groups,
      groupOf: groupOf,
      baseAt: Date.now(),
      fetchedAt: Date.now()
    };
    return applyMeta(out, metaMap);
  }

  function cyclePos() {
    var d = st.data;
    if (!d) return 0;
    var p = d.position + (Date.now() - d.baseAt) / 1000;
    p = p % d.total;
    if (p < 0) p += d.total;
    return p;
  }

  /* ---------- 接口地址 / 校验 ---------- */
  function cycleUrl(sid, bust) {
    var q = [];
    if (sid) q.push('station=' + encodeURIComponent(sid));
    if (bust) q.push('_=' + Date.now());
    return '/api/cycle' + (q.length ? ('?' + q.join('&')) : '');
  }

  function declaredStation(d) {
    if (!d) return '';
    var v = d.station;
    if (v == null) v = (d.station_id != null) ? d.station_id : d.stationId;
    if (v && typeof v === 'object') v = (v.id != null) ? v.id : v.mid;
    if (v == null && d.meta && d.meta.station) {
      var m = d.meta.station;
      v = (m && typeof m === 'object') ? ((m.id != null) ? m.id : m.mid) : m;
    }
    return (v == null || v === '') ? '' : String(v);
  }

  /* 判断 /api/cycle 返回的排期是否属于当前主播：
     ① 响应显式带了 station 就用它；
     ② 没带就与 /api/programs?station= 的 bvid/cid 做一次交集采样。 */
  function matchesStation(d, map, sid) {
    if (!sid) return true;
    var declared = declaredStation(d);
    if (declared) return declared === sid;
    if (!map) return true;
    if (!Object.keys(map).length) return true;
    var segs = (d && d.segments) || [];
    if (!segs.length) return true;
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      if (s && map[String(s.bvid || '') + '|' + String(s.cid || '')]) return true;
    }
    return false;
  }

  /* ---------- 骨架 / 状态 ---------- */
  function showSkeleton(on) {
    if (el.skel) el.skel.hidden = !on;
  }
  function showState(on, title, desc) {
    if (!el.state) return;
    el.state.hidden = !on;
    if (on) {
      if (title) el.stateT.textContent = title;
      if (desc) el.stateS.textContent = desc;
    }
  }

  function metaText(g) {
    var bits = [];
    if (g.cat) bits.push(g.cat);
    if (g.dm) bits.push(RR.fmtCount(g.dm) + ' 弹幕');
    if (!bits.length) bits.push('直播回放');
    return bits.join(' · ');
  }

  /* ---------- 画时间带 ---------- */
  function paint() {
    var d = st.data;
    if (!d) return;

    var track = el.track;
    track.innerHTML = '';
    track.dataset.station = st.stationId;

    var totalPx = d.total / 60 * PX_PER_MIN;
    track.style.height = (PAD * 2 + totalPx) + 'px';

    /* 小时刻度：位置只由 start/total 决定，切台不改变比例 */
    var hours = Math.ceil(d.total / 3600);
    for (var h = 0; h <= hours; h++) {
      var top = PAD + h * 60 * PX_PER_MIN;
      if (top > PAD + totalPx + 1) break;
      var hEl = RR.el('div', 'day-hour');
      hEl.style.top = top + 'px';
      var line = RR.el('i');
      var label = RR.el('span', '', pad2(h) + ':00');
      hEl.appendChild(line);
      hEl.appendChild(label);
      track.appendChild(hEl);
    }

    /* 分段块：高度按真实时长；内容贴成一组，不再把标题/元信息钉到上下两端 */
    st.blockEls = [];
    d.groups.forEach(function (g, gi) {
      var topPx = PAD + g.start / 60 * PX_PER_MIN;
      var hPx = Math.max(16, (g.end - g.start) / 60 * PX_PER_MIN - BLOCK_GAP);
      var b = RR.el('div', 'day-block');
      b.dataset.g = String(gi);
      b.style.top = topPx + 'px';
      b.style.height = hPx + 'px';

      var big = hPx >= 132;      /* 够高：标题给两行 */
      var full = hPx >= 78;      /* 够高：时间 + 标题 + 元信息 */
      var slim = hPx >= 58;      /* 够高：时间 + 标题；再矮只留标题 */
      if (!slim) b.classList.add('day-block--tiny');
      else if (!full) b.classList.add('day-block--slim');
      else if (big) b.classList.add('day-block--roomy');

      if (slim) {
        var topRow = RR.el('div', 'day-block__top');
        var time = RR.el('span', 'day-block__time num');
        time.textContent = hm(g.start) + '–' + hm(g.end);
        topRow.appendChild(time);
        var dur = RR.el('span', 'day-block__dur num');
        dur.textContent = durText(g.end - g.start);
        topRow.appendChild(dur);
        b.appendChild(topRow);
      }

      var t = RR.el('div', 'day-block__t');
      t.textContent = g.title;
      if (!big) t.classList.add('truncate');
      b.appendChild(t);

      if (full) {
        var m = RR.el('div', 'day-block__m truncate');
        m.textContent = metaText(g);
        b.appendChild(m);
      }

      b.title = g.title + ' · ' + hm(g.start) + '–' + hm(g.end);
      track.appendChild(b);
      st.blockEls.push(b);
    });

    /* 点击格：按段/节目切成 30 分钟一块，最后一块不足 44px 并进前一块 */
    d.groups.forEach(function (g) {
      var chunks = [];
      var t = g.start;
      while (t < g.end - 0.5) {
        var e = Math.min(g.end, t + CELL_MIN * 60);
        chunks.push([t, e]);
        t = e;
      }
      while (chunks.length > 1 && (chunks[chunks.length - 1][1] - chunks[chunks.length - 1][0]) / 60 * PX_PER_MIN < MIN_HIT) {
        var last = chunks.pop();
        chunks[chunks.length - 1][1] = last[1];
      }
      chunks.forEach(function (c, ci) {
        var cellTop = PAD + c[0] / 60 * PX_PER_MIN;
        var cellH = Math.max(MIN_HIT, (c[1] - c[0]) / 60 * PX_PER_MIN);
        var segIdx = segAt(d.segments, c[0]);
        var seg = d.segments[segIdx];
        var btn = RR.el('button', 'day-cell');
        btn.type = 'button';
        btn.style.top = cellTop + 'px';
        btn.style.height = cellH + 'px';
        btn.dataset.top = String(c[0] / 60);   /* 分钟：点格按 (格顶-该段起点)×60 */
        btn.dataset.seg = String(segIdx);
        btn.tabIndex = ci === 0 ? 0 : -1;
        btn.setAttribute('aria-label', '从 ' + hm(c[0]) + ' 开始听：' + (seg ? seg.title : ''));
        track.appendChild(btn);
      });
    });

    /* 现在线 */
    var now = RR.el('div', 'day-now');
    now.innerHTML = '<span class="day-now__dot"></span><span class="day-now__line"></span>' +
      '<span class="day-now__t num"></span>';
    track.appendChild(now);
    st.nowEl = now;

    /* 头部元信息 */
    if (el.count) el.count.textContent = d.groups.length + ' 期';
    if (el.loop) el.loop.textContent = '循环 ' + fmtHMS(d.total);
    if (el.foot) {
      el.foot.textContent = '共 ' + d.groups.length + ' 期 · ' + d.segments.length +
        ' 段，点时间带上的任意一刻，从那里开始听。';
    }
    if (el.station) el.station.textContent = '当前主播 ' + ((stationNow() && (stationNow().name || stationNow().mid)) || '未选择');

    el.band.hidden = false;
    st.curIdx = -1;
    st.curGroup = -1;
    tick();
  }

  /* ---------- 时间指针 ---------- */
  function tick() {
    if (!st.data) return;
    var pos = cyclePos();
    var idx = segAt(null, pos);
    var y = PAD + pos / 60 * PX_PER_MIN;

    if (st.nowEl) {
      st.nowEl.style.transform = 'translate3d(0,' + y.toFixed(2) + 'px,0)';
      st.nowEl.classList.toggle('is-low', y < 56);
      var tEl = RR.$('.day-now__t', st.nowEl);
      if (tEl) tEl.textContent = hm(pos);
    }
    if (el.clock) el.clock.textContent = hm(pos);

    if (idx !== st.curIdx) {
      st.curIdx = idx;
      updateCurrent(idx);
    }
    updateJump();
  }

  function updateCurrent(idx) {
    var d = st.data;
    if (!d) return;
    var seg = d.segments[idx];
    if (!seg) return;
    if (el.current) el.current.textContent = seg.title;
    var g = d.groupOf[idx];
    if (g === st.curGroup) return;
    st.curGroup = g;
    st.blockEls.forEach(function (b, i) {
      b.classList.toggle('is-now', i === g);
    });
  }

  function updateJump() {
    if (!st.alive || !st.nowEl || !st.data) {
      if (el.jump) el.jump.hidden = true;
      return;
    }
    var r = st.nowEl.getBoundingClientRect();
    var inView = r.top > 96 && r.top < window.innerHeight - 150;
    if (el.jump) el.jump.hidden = inView;
  }

  function onScroll() {
    if (!st.alive) return;
    if (st.jumpRaf) return;
    st.jumpRaf = requestAnimationFrame(function () {
      st.jumpRaf = 0;
      updateJump();
    });
  }

  function scrollToNow() {
    if (!st.alive || !st.nowEl) return;
    var r = st.nowEl.getBoundingClientRect();
    /* 「现在」已经在首屏舒适区（页头下面、屏幕 70% 以上）时不要硬滚，
       否则凌晨这类位置会把页头卷走，反而像页面错位 */
    if (r.top >= 120 && r.top <= window.innerHeight * 0.7) return;
    var y = r.top + window.scrollY - Math.max(120, Math.round(window.innerHeight * 0.38));
    if (y < 96) y = 0;
    window.scrollTo({ top: Math.max(0, y), behavior: reduced() ? 'auto' : 'smooth' });
  }

  /* 8.0.0：保留函数体，但**不得有任何自动调用点**（进入 / 切台 / 刷新 / retry 都不滚）。
     页面里唯一的滚动入口是 #day-jump 的点击 → scrollToNow。 */
  function scheduleScroll() {
    clearTimeout(st.scrollTimer);
    st.scrollTimer = setTimeout(function () {
      if (st.alive) scrollToNow();
    }, SCROLL_DELAY);
  }

  /* ---------- 取排期 ---------- */
  function fetchCycle(sid, bust) {
    return RR.api(cycleUrl(sid, bust));
  }

  function ensureCycle(cycle, map, sid, seq) {
    if (!cycle) return Promise.reject(new Error('排期是空的'));
    if (!sid || matchesStation(cycle, map, sid)) {
      return Promise.resolve({ cycle: cycle, map: map, mismatch: false });
    }
    /* 兼容：旧后端会忽略 station 参数、返回上一位主播的排期。
       带缓存参数强取一次；只重取一次，防止接口异常时来回打。 */
    return fetchCycle(sid, true).then(function (d) {
      if (seq !== st.reqSeq) return null;
      if (!d) return { cycle: cycle, map: map, mismatch: true };
      return { cycle: d, map: map, mismatch: !matchesStation(d, map, sid) };
    }, function () {
      return { cycle: cycle, map: map, mismatch: true };
    });
  }

  /* 8.0.0：不再接收 scroll 选项 —— 任何来源的刷新（进入 / 切台 / STALE / retry）
     都不滚页面，用户当前滚动位置原样保留。 */
  function load() {
    var sid = sidNow();
    var seq = ++st.reqSeq;
    st.loading = true;
    st.loadingSid = sid;

    if (!st.data) {
      showSkeleton(true);
      showState(false);
    } else if (el.band) {
      el.band.classList.add('is-swapping');
      el.band.setAttribute('aria-busy', 'true');
    }

    var progP = sid
      ? RR.api('/api/programs?station=' + encodeURIComponent(sid)).then(indexPrograms, function () { return null; })
      : Promise.resolve(null);

    Promise.all([fetchCycle(sid, false), progP]).then(function (res) {
      if (seq !== st.reqSeq) return null;
      return ensureCycle(res[0], res[1], sid, seq);
    }).then(function (out) {
      if (!out || seq !== st.reqSeq) return null;
      var next = normalize(out.cycle, out.map);
      st.data = next;
      st.stationId = sid;
      st.fetchedAt = Date.now();
      st.dirty = false;
      st.mismatch = !!out.mismatch;
      showSkeleton(false);
      showState(false);
      paint();
      if (out.mismatch) {
        try {
          console.warn('[day] /api/cycle 返回的排期与主播 ' + sid + ' 对不上（已带缓存参数重取一次）');
        } catch (e) { }
      }
      return true;
    }).catch(function (e) {
      if (seq !== st.reqSeq) return;
      var msg = (e && e.message) ? e.message : '取排期失败';
      st.dirty = true;
      if (!st.data) {
        showSkeleton(false);
        showState(true, '排期没取到', msg + '。点一下重新取。');
        if (el.foot) el.foot.textContent = '时间带要等排期到了才有内容。';
      } else {
        RR.toast('排期刷新失败：' + msg, 'err');
      }
    }).then(function () {
      if (seq !== st.reqSeq) return;
      st.loading = false;
      st.loadingSid = '';
      if (el.band) {
        el.band.classList.remove('is-swapping');
        el.band.removeAttribute('aria-busy');
      }
    });
  }

  /* ---------- 切台 ---------- */
  function onStation(evt) {
    var s = evt || stationNow();
    var sid = sidOf(s) || sidNow();
    var t = Date.now();

    /* setStation 先 emit('station')，boot 再 emit('station-changed')，只处理一次 */
    if (sid && sid === st.evtSid && (t - st.evtAt) < EVT_GAP) return;
    st.evtSid = sid;
    st.evtAt = t;

    /* 同一位主播的重复事件、且排期刚取过：不用重取 */
    if (sid && sid === st.stationId && st.data && !st.dirty && (t - st.fetchedAt) < SAME_MAX) return;

    st.dirty = true;
    st.fetchedAt = 0;

    if (!sid) return;
    if (!st.alive) return;                        /* 不在 24H 页：标脏，等 enter 再取 */
    if (st.loading && st.loadingSid === sid) return;  /* 已经在取这位主播 */
    load();
  }

  /* ---------- 点格续播 ---------- */
  function onTrackClick(e) {
    /* 换台请求还没落画时，点击格属于旧主播的排期，先别放出去 */
    if (st.loading && st.loadingSid && st.loadingSid !== st.stationId) {
      RR.toast('正在换台，排期马上到');
      return;
    }
    var node = e.target;
    while (node && node !== el.track) {
      if (node.classList && node.classList.contains('day-cell')) break;
      node = node.parentNode;
    }
    if (!node || node === el.track || !st.data) return;

    var topMin = parseFloat(node.dataset.top);
    var segIdx = parseInt(node.dataset.seg, 10);
    var seg = st.data.segments[segIdx];
    if (!seg || isNaN(topMin)) return;

    var sec = (topMin - seg.start / 60) * 60;
    sec = Math.max(0, Math.min(seg.duration - 1, sec));

    var item = {
      bvid: seg.bvid,
      cid: seg.cid,
      title: seg.title,
      cover: seg.cover,
      duration: seg.duration,
      dur: seg.duration
    };
    var p = RR.player;
    if (!p || typeof p.playItemAt !== 'function') {
      RR.toast('播放器还没准备好，稍等一秒再点', 'err');
      return;
    }
    try {
      p.playItemAt(item, sec);
    } catch (err) {
      RR.toast('这一格没起来，再点一次', 'err');
      return;
    }
    RR.toast('从 ' + hm(topMin * 60) + ' 开始 · ' + seg.title);
  }

  /* ---------- 生命周期 ---------- */
  function mount() {
    if (st.mounted) return;
    if (!RR.$('#view-day')) return;
    st.mounted = true;

    el.skel = RR.$('#day-skel');
    el.state = RR.$('#day-state');
    el.stateT = RR.$('#day-state-t');
    el.stateS = RR.$('#day-state-s');
    el.band = RR.$('#day-band');
    el.track = RR.$('#day-track');
    el.retry = RR.$('#day-retry');
    el.count = RR.$('#day-count');
    el.loop = RR.$('#day-loop');
    el.clock = RR.$('#day-clock');
    el.current = RR.$('#day-current');
    el.station = RR.$('#day-station');
    el.jump = RR.$('#day-jump');
    el.foot = RR.$('#day-foot');

    if (el.retry) el.retry.addEventListener('click', function () {
      showState(false);
      load();   /* 重取排期同样不自动滚，用户停在哪就停在哪 */
    });
    if (el.jump) el.jump.addEventListener('click', scrollToNow);
    if (el.track) el.track.addEventListener('click', onTrackClick);
    window.addEventListener('scroll', onScroll, { passive: true });
    if (RR.on) {
      RR.on('station', onStation);
      RR.on('station-changed', onStation);
    }
  }

  function startTicker() {
    if (st.ticker) return;
    st.ticker = setInterval(tick, 1000);
  }

  function enter() {
    if (!st.mounted) mount();
    if (!el.track) return;
    st.alive = true;
    startTicker();

    var sid = sidNow();
    var needs = !st.data || st.dirty || (sid && st.stationId !== sid) ||
      (Date.now() - st.fetchedAt > STALE);

    if (needs) {
      if (st.loading && st.loadingSid === sid) {
        if (st.data) tick();
        return;
      }
      /* 首次/切台/STALE 重取：只取数据，不滚到「现在」 */
      load();
      return;
    }
    tick();
  }

  function leave() {
    st.alive = false;
    if (st.ticker) { clearInterval(st.ticker); st.ticker = 0; }
    clearTimeout(st.scrollTimer);
    if (el.jump) el.jump.hidden = true;
  }

  /* ---------- 对外 ---------- */
  var mod = {
    mount: mount,
    enter: enter,
    leave: leave,
    /* 给其它视图复用排期的只读入口（同样按当前主播取） */
    cycle: function () {
      var sid = sidNow();
      return RR.api(cycleUrl(sid, false)).then(function (d) { return normalize(d, null); });
    },
    data: function () { return st.data; },
    station: function () { return st.stationId; },
    debug: function () {
      return {
        station: st.stationId,
        loading: st.loading,
        loadingSid: st.loadingSid,
        dirty: st.dirty,
        mismatch: st.mismatch,
        groups: st.data ? st.data.groups.length : 0,
        segments: st.data ? st.data.segments.length : 0,
        fetchedAt: st.fetchedAt
      };
    },
    segAt: function (sec) {
      if (!st.data) return null;
      return st.data.segments[segAt(null, sec)];
    }
  };

  if (RR.view) RR.view('day', mod);
  RR.day = mod;
})();
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
/* ============================================================
   js/44-settings.js —「我的 · 设置」分组（library 所有权）
   只做：设置行渲染 / 交互 / 调用 RR.saveSettings 立即生效。
   RR.settings() / RR.saveSettings() / RR.applyTheme() 由 00-core 提供，
   本文件不重新定义、不重复切主题（core 的 saveSettings 会切 html[data-theme]、
   加 .reduce-motion 并 emit('settings')）。
   ============================================================ */
(function () {
  'use strict';

  var RR = window.RR;

  /* ---------- 状态 ---------- */
  var root = null;      // #me-settings
  var built = false;    // 行是否已渲染
  var fallbackSleep = 0; // 播放器没有 sleep API 时的兜底定时器

  /* ---------- 小工具 ---------- */
  function each(list, fn) { for (var i = 0; i < list.length; i++) fn(list[i], i); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function closest(node, sel) {
    while (node && node !== document) {
      if (node.nodeType === 1 && node.matches && node.matches(sel)) return node;
      node = node.parentNode;
    }
    return null;
  }
  function settings() {
    try { return RR.settings() || {}; } catch (e) { return {}; }
  }
  function toast(msg, kind) {
    try { RR.toast(msg, kind); } catch (e) {}
  }

  /* ---------- 生效调用 ---------- */
  function applyRate(rate) {
    try {
      if (RR.player && typeof RR.player.setRate === 'function') { RR.player.setRate(rate); return; }
    } catch (e) {}
    try {
      var v = document.getElementById('player');
      if (v && v.playbackRate !== rate) v.playbackRate = rate;
    } catch (e) {}
  }

  function stopFallbackSleep() {
    if (fallbackSleep) { clearTimeout(fallbackSleep); fallbackSleep = 0; }
  }
  function armFallbackSleep() {
    stopFallbackSleep();
    var end = 0;
    try { end = Number(RR.store.get('sleepEnd', 0)) || 0; } catch (e) {}
    if (!end) return;
    var left = end - Date.now();
    if (left <= 0) { fireFallbackSleep(); return; }
    fallbackSleep = setTimeout(armFallbackSleep, Math.min(left + 30, 30000));
  }
  function fireFallbackSleep() {
    stopFallbackSleep();
    try { RR.store.del('sleepEnd'); } catch (e) {}
    try {
      var v = document.getElementById('player');
      if (v && !v.paused) { window.__rrKeepNative = false; v.pause(); }
      else if (RR.player && typeof RR.player.stop === 'function') RR.player.stop();
    } catch (e) {}
    toast('定时关闭了，晚安');
    try { RR.saveSettings({ sleep: 0 }); } catch (e) {}
    paint();
  }
  function applySleep(min) {
    var m = Math.max(0, Math.round(Number(min) || 0));
    var handled = false;
    try {
      if (RR.player && typeof RR.player.sleep === 'function') { RR.player.sleep(m); handled = true; }
      else if (RR.player && typeof RR.player.setSleep === 'function') { RR.player.setSleep(m); handled = true; }
    } catch (e) { handled = false; }
    if (handled) { stopFallbackSleep(); return; }
    if (!m) {
      stopFallbackSleep();
      try { RR.store.del('sleepEnd'); } catch (e) {}
      return;
    }
    try { RR.store.set('sleepEnd', Date.now() + m * 60000); } catch (e) {}
    armFallbackSleep();
    toast('到点会自动暂停，先听着');
  }

  /* ---------- 清缓存 ---------- */
  function clearCache() {
    var removed = 0, i, k;
    try {
      for (i = localStorage.length - 1; i >= 0; i--) {
        k = localStorage.key(i);
        if (!k || k.indexOf('rr7_') !== 0) continue;
        if (/^rr7_(settings|rooms|stations|station_id|seed|sleepEnd)/i.test(k)) continue;
        localStorage.removeItem(k);
        removed++;
      }
    } catch (e) {}
    try {
      for (i = sessionStorage.length - 1; i >= 0; i--) { sessionStorage.removeItem(sessionStorage.key(i)); removed++; }
    } catch (e) {}
    try {
      if (window.caches && typeof window.caches.keys === 'function') {
        window.caches.keys().then(function (keys) {
          keys.forEach(function (name) { try { window.caches.delete(name); } catch (e) {} });
        }).catch(function () {});
      }
    } catch (e) {}
    toast('缓存已清 · 设置与已添加的房间保留');
  }
  function askClearCache() {
    var body = '会清掉封面、接口与弹幕的临时缓存；登录状态、设置和监控房间都会保留。';
    try {
      RR.sheet({
        title: '清缓存',
        body: body,
        actions: [
          { label: '取消' },
          { label: '清理', primary: true, onClick: clearCache }
        ]
      });
    } catch (e) {
      if (window.confirm && window.confirm('清缓存\n' + body)) clearCache();
    }
  }

  /* ---------- 设置行定义 ---------- */
  var GROUPS = [
    {
      title: '外观', note: '随系统或手动锁定',
      rows: [
        {
          type: 'seg', key: 'theme', label: '主题',
          hint: '「跟随」会跟着系统深浅色切换',
          opts: [['system', '跟随'], ['light', '浅色'], ['dark', '深色']]
        },
        {
          type: 'switch', key: 'reduceMotion', label: '减少动效',
          hint: '减少抬升、转场与呼吸动画'
        }
      ]
    },
    {
      title: '播放', note: '改完立即生效',
      rows: [
        {
          type: 'seg', key: 'qn', label: '默认画质',
          hint: '「自动」= 取这台设备当前能拿到的最高档；登录与否、网络好坏还会自动降级',
          opts: [[0, '自动'], [80, '1080P'], [64, '720P'], [32, '480P']]
        },
        {
          type: 'seg', key: 'rate', label: '默认倍速',
          hint: '回放与歌单都按这个速度播',
          opts: [[0.75, '0.75×'], [1, '1×'], [1.25, '1.25×'], [1.5, '1.5×'], [2, '2×']]
        },
        {
          type: 'switch', key: 'dmOn', label: '弹幕',
          hint: '关掉后舞台上不再飘字'
        },
        {
          type: 'range', key: 'dmOpacity', label: '弹幕透明度',
          hint: '40% 左右最不挡画面',
          min: 0.15, max: 1, step: 0.05, unit: '%'
        },
        {
          type: 'switch', key: 'liveMuted', label: '进入直播时静音',
          hint: '先安静地看，点音量再开声'
        },
        {
          type: 'switch', key: 'monitorMuted', label: '监控默认静音',
          hint: '多路同看时只给当前放大的一格出声'
        },
        {
          type: 'switch', key: 'overlayOn', label: '退后台用悬浮窗',
          hint: '在别的 App 上方继续看；第一次要允许「显示在其他应用上方」'
        },
        {
          type: 'seg', key: 'sleep', label: '定时关闭',
          hint: '到点自动暂停，适合睡前听',
          opts: [[0, '关'], [15, '15 分'], [30, '30 分'], [60, '60 分'], [90, '90 分']]
        }
      ]
    },
    {
      title: '存储', note: '',
      rows: [
        {
          type: 'act', act: 'clearCache', label: '清缓存',
          hint: '封面与接口缓存，不影响登录和设置',
          button: '清理'
        }
      ]
    }
  ];

  /* ---------- 渲染 ---------- */
  function rowHtml(row) {
    var text = '<div class="srow__text"><span class="srow__label">' + esc(row.label) + '</span>' +
      (row.hint ? '<span class="srow__hint">' + esc(row.hint) + '</span>' : '') + '</div>';
    var ctrl = '';

    if (row.type === 'seg') {
      var btns = [];
      for (var i = 0; i < row.opts.length; i++) {
        var val = row.opts[i][0], lbl = row.opts[i][1];
        btns.push('<button type="button" class="me-seg__btn" data-set="' + esc(row.key) +
          '" data-val="' + esc(val) + '"' + (typeof val === 'number' ? ' data-num="1"' : '') +
          ' aria-pressed="false">' + esc(lbl) + '</button>');
      }
      var wide = row.opts.length > 3;
      ctrl = '<div class="srow__ctrl' + (wide ? ' is-wide' : '') + '"><div class="me-seg" role="group" aria-label="' +
        esc(row.label) + '">' + btns.join('') + '</div></div>';
    } else if (row.type === 'switch') {
      ctrl = '<div class="srow__ctrl"><button type="button" class="me-switch" role="switch" ' +
        'aria-checked="false" aria-label="' + esc(row.label) + '" data-set="' + esc(row.key) + '"></button></div>';
    } else if (row.type === 'range') {
      ctrl = '<div class="srow__ctrl is-wide"><div class="me-range">' +
        '<input class="me-range__input" type="range" min="' + row.min + '" max="' + row.max +
        '" step="' + row.step + '" value="' + row.min + '" data-set="' + esc(row.key) +
        '" aria-label="' + esc(row.label) + '">' +
        '<output class="me-range__val num" data-out="' + esc(row.key) + '">' +
        (row.unit === '%' ? Math.round(row.min * 100) + '%' : row.min) + '</output></div></div>';
    } else if (row.type === 'act') {
      ctrl = '<div class="srow__ctrl"><button type="button" class="btn" data-act="' +
        esc(row.act) + '">' + esc(row.button) + '</button></div>';
    }
    return '<div class="srow">' + text + ctrl + '</div>';
  }

  function groupHtml(group) {
    var rows = [], i;
    for (i = 0; i < group.rows.length; i++) rows.push(rowHtml(group.rows[i]));
    return '<div class="me-group">' +
      '<div class="me-group__head"><span class="me-group__title">' + esc(group.title) + '</span>' +
      (group.note ? '<span class="me-group__note">' + esc(group.note) + '</span>' : '') + '</div>' +
      rows.join('') + '</div>';
  }

  function build() {
    if (!root) return;
    var html = [], i;
    for (i = 0; i < GROUPS.length; i++) html.push(groupHtml(GROUPS[i]));
    root.innerHTML = html.join('');
    built = true;
  }

  function paint() {
    if (!root) return;
    var s = settings();
    each(root.querySelectorAll('[data-set]'), function (el) {
      var key = el.getAttribute('data-set');
      if (el.classList.contains('me-switch')) {
        el.setAttribute('aria-checked', s[key] ? 'true' : 'false');
      } else if (el.classList.contains('me-seg__btn')) {
        var on = String(s[key]) === el.getAttribute('data-val');
        el.classList.toggle('is-on', on);
        el.setAttribute('aria-pressed', on ? 'true' : 'false');
      } else if (el.classList.contains('me-range__input')) {
        if (document.activeElement !== el) el.value = String(s[key] == null ? 0.85 : s[key]);
      }
    });
    each(root.querySelectorAll('[data-out]'), function (el) {
      var key = el.getAttribute('data-out');
      if (key === 'dmOpacity') el.textContent = Math.round((Number(s[key]) || 0) * 100) + '%';
      else el.textContent = String(s[key] == null ? '' : s[key]);
    });
  }

  /* ---------- 交互 ---------- */
  function save(patch) {
    try {
      RR.saveSettings(patch);
    } catch (e) {
      toast('设置没存上，再点一次', 'err');
      return;
    }
    if (patch.rate !== undefined) applyRate(patch.rate);
    if (patch.sleep !== undefined) applySleep(patch.sleep);
    paint();
  }
  function patchOf(key, value) { var p = {}; p[key] = value; return p; }

  function onClick(e) {
    var btn = closest(e.target, '[data-set],[data-act]');
    if (!btn || !root || !root.contains(btn)) return;

    var act = btn.getAttribute('data-act');
    if (act) {
      if (act === 'clearCache') askClearCache();
      return;
    }

    var key = btn.getAttribute('data-set');
    if (btn.classList.contains('me-switch')) {
      var next = !settings()[key];
      save(patchOf(key, next));
      /* 悬浮窗是特殊权限：开关打开时顺手把人送到系统授权页，不然退后台会「没反应」 */
      if (key === 'overlayOn' && next) {
        var BR = window.AndroidRadio;
        var allowed = false;
        try { allowed = !!(BR && BR.isOverlayAllowed && BR.isOverlayAllowed()); } catch (e) { }
        if (BR && !allowed) {
          try { if (BR.openOverlaySettings) { BR.openOverlaySettings(); } } catch (e) { }
          toast('去打开「显示在其他应用上方」，之后退后台就是悬浮窗', 'ok');
        }
      }
      return;
    }
    if (btn.classList.contains('me-seg__btn')) {
      var raw = btn.getAttribute('data-val');
      save(patchOf(key, btn.getAttribute('data-num') === '1' ? Number(raw) : raw));
    }
  }
  function onInput(e) {
    var el = e.target;
    if (!el || !el.classList || !el.classList.contains('me-range__input')) return;
    var key = el.getAttribute('data-set');
    var val = parseFloat(el.value);
    var out = root ? root.querySelector('[data-out="' + key + '"]') : null;
    if (out) out.textContent = Math.round(val * 100) + '%';
    // 拖动时先改内存里的值，弹幕层下一帧就能读到；松手再落盘
    if (key === 'dmOpacity') { try { RR.settings().dmOpacity = val; } catch (err) {} }
  }
  function onChange(e) {
    var el = e.target;
    if (!el || !el.classList || !el.classList.contains('me-range__input')) return;
    save(patchOf(el.getAttribute('data-set'), parseFloat(el.value)));
  }

  function bind() {
    if (!root || root.getAttribute('data-bound') === '1') return;
    root.setAttribute('data-bound', '1');
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    try { RR.on('settings', paint); } catch (e) {}
  }

  /* ---------- 模块 ---------- */
  function mount() {
    root = document.getElementById('me-settings');
    if (!root) return;
    if (!built) build();
    bind();
    paint();
    armFallbackSleep();
  }
  function enter() { mount(); paint(); }
  function leave() {}

  RR.settingsUI = { mount: mount, enter: enter, leave: leave, paint: paint, settings: settings };
})();
/* ============================================================
   js/45-playlist.js — 歌单视图（library 所有权）
   GET /api/playlists → GET /api/playlist?id= → 点曲目 RR.player.playItemAt
   POST /api/playlist/import / POST /api/playlist/delete
   点曲目不跳页；页顶「正在播」条可点进频道看画面。
   ============================================================ */
(function () {
  'use strict';

  var RR = window.RR;
  var VIEW = 'playlist';

  /* ---------- 状态 ---------- */
  var el = {};                // 静态节点引用
  var mounted = false;
  var S = {
    lists: null, listsErr: '', listsAt: 0, listsLoading: false,
    detail: null, detailId: '', detailErr: '', detailAt: 0, detailLoading: false,
    now: null, nowKey: ''
  };
  var press = null;           // 长按
  var suppressClick = 0;      // 长按后的 click 屏蔽

  /* ---------- 小工具 ---------- */
  function each(list, fn) { for (var i = 0; i < list.length; i++) fn(list[i], i); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function closest(node, sel) {
    while (node && node !== document) {
      if (node.nodeType === 1 && node.matches && node.matches(sel)) return node;
      node = node.parentNode;
    }
    return null;
  }
  function ico(name, size) {
    try { return RR.ICO(name, size || 20); } catch (e) { return ''; }
  }
  function toast(msg, kind) {
    try { RR.toast(msg, kind); } catch (e) {}
  }
  function fmtTime(sec) {
    try {
      if (RR.fmtTime) return RR.fmtTime(sec);
    } catch (e) {}
    sec = Math.max(0, Math.floor(sec || 0));
    var m = Math.floor(sec / 60), s = sec % 60;
    return m + ':' + (s < 10 ? '0' + s : s);
  }
  function fmtCount(n) {
    try { if (RR.fmtCount) return RR.fmtCount(n); } catch (e) {}
    return String(Number(n) || 0);
  }
  function coverUrl(u) {
    if (!u) return '';
    u = String(u);
    if (u.indexOf('//') === 0) return 'https:' + u;
    return u;
  }
  function humanError(e, fallback) {
    var msg = e && e.message ? String(e.message) : '';
    if (!msg) return fallback;
    if (/Failed to fetch|NetworkError|Load failed|network|aborted|请求失败|unknown endpoint/i.test(msg)) return fallback;
    if (/HTTP\s*\d{3}/i.test(msg)) return fallback;
    return msg;
  }
  function listById(id) {
    var arr = S.lists || [];
    for (var i = 0; i < arr.length; i++) if (String(arr[i].id) === String(id)) return arr[i];
    return null;
  }
  function relDate(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number' || /^\d{9,13}$/.test(String(v))) {
      var n = Number(v);
      if (n < 1e12) n *= 1000;
      try {
        var d = new Date(n);
        return (d.getMonth() + 1) + '月' + d.getDate() + '日更新';
      } catch (e) { return ''; }
    }
    var s = String(v);
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
    if (m) return Number(m[2]) + '月' + Number(m[3]) + '日更新';
    return s;
  }
  function api(path, opts) {
    try { return RR.api(path, opts); } catch (e) { return Promise.reject(e); }
  }

  /* ---------- 骨架 / 空态 ---------- */
  function skeletonRows(n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push('<div class="pl-skel" aria-hidden="true">' +
        '<span class="pl-skel__cover"></span>' +
        '<span class="pl-skel__lines"><i style="width:62%"></i><i style="width:38%"></i></span>' +
        '</div>');
    }
    return out.join('');
  }
  function noteHtml(title, text, action, actionLabel, icon) {
    return '<div class="pl-empty">' +
      '<span class="pl-empty__ico">' + ico(icon || 'music', 24) + '</span>' +
      '<h3 class="h3">' + esc(title) + '</h3>' +
      '<p class="pl-empty__text muted">' + esc(text) + '</p>' +
      (action ? '<button type="button" class="btn" data-act="' + esc(action) + '">' +
        esc(actionLabel) + '</button>' : '') +
      '</div>';
  }

  /* ---------- 渲染：歌单列表 ---------- */
  function renderLists() {
    var box = el.lists;
    if (!box) return;
    if (S.listsLoading && !S.lists) { box.innerHTML = '<div class="pl-grid">' + skeletonRows(3) + '</div>'; return; }
    if (S.listsErr && !S.lists) {
      box.innerHTML = noteHtml('歌单没加载出来', S.listsErr, 'retry-lists', '重试', 'refresh');
      return;
    }
    var lists = S.lists || [];
    if (!lists.length) {
      box.innerHTML = noteHtml(
        '歌单还是空的',
        '粘一个 B 站合集、收藏夹或分 P 链接，导进来就能按顺序听。',
        'import', '粘贴链接', 'link'
      );
      return;
    }
    var html = [];
    for (var i = 0; i < lists.length; i++) {
      var l = lists[i];
      var tags = [];
      if (l.tags && l.tags.length) {
        for (var t = 0; t < l.tags.length && t < 3; t++) tags.push('<span class="tag">' + esc(l.tags[t]) + '</span>');
      }
      html.push(
        '<div class="pl-card">' +
          '<button type="button" class="pl-card__main" data-open="' + esc(l.id) +
            '" aria-label="打开歌单 ' + esc(l.name) + '">' +
            '<span class="pl-cover">' + coverHtml(l.cover) + '</span>' +
            '<span class="pl-card__text">' +
              '<span class="pl-card__name truncate">' + esc(l.name || '未命名歌单') + '</span>' +
              '<span class="pl-card__meta num">' + esc((l.count || 0) + ' 首') +
                (relDate(l.updated) ? ' · ' + esc(relDate(l.updated)) : '') + '</span>' +
              (tags.length ? '<span class="pl-card__tags">' + tags.join('') + '</span>' : '') +
            '</span>' +
          '</button>' +
          '<button type="button" class="icon-btn pl-card__more" data-more="' + esc(l.id) +
            '" aria-label="管理歌单 ' + esc(l.name) + '">' + ico('more') + '</button>' +
        '</div>');
    }
    box.innerHTML = '<div class="pl-grid">' + html.join('') + '</div>';
    bindCoverFallbacks(box);
  }

  function coverHtml(src) {
    var url = coverUrl(src);
    return '<span class="pl-cover__ph" aria-hidden="true">' + ico('music') + '</span>' +
      (url ? '<img class="pl-cover__img" src="' + esc(url) + '" alt="" loading="lazy" ' +
        'referrerpolicy="no-referrer" data-cover>' : '');
  }
  function bindCoverFallbacks(box) {
    each(box.querySelectorAll('img[data-cover]'), function (img) {
      img.addEventListener('error', function () { img.style.visibility = 'hidden'; });
    });
  }

  /* ---------- 渲染：歌单详情 ---------- */
  function renderDetail() {
    var box = el.detail;
    if (!box) return;
    if (S.detailLoading && !S.detail) {
      box.innerHTML =
        '<div class="pl-hero pl-hero--skel"><span class="pl-cover pl-cover--lg"></span>' +
        '<span class="pl-skel__lines"><i style="width:52%"></i><i style="width:30%"></i></span></div>' +
        skeletonRows(4);
      return;
    }
    if (S.detailErr && !S.detail) {
      box.innerHTML = '<button type="button" class="btn btn--ghost pl-back" data-act="back">' +
        ico('chevron') + '<span>全部歌单</span></button>' +
        noteHtml('这个歌单没打开', S.detailErr, 'retry-detail', '重试', 'refresh');
      return;
    }
    var d = S.detail;
    if (!d) { box.innerHTML = ''; return; }
    var items = d.items || [];
    var total = 0;
    for (var i = 0; i < items.length; i++) total += Number(items[i].dur) || 0;

    var head =
      '<button type="button" class="btn btn--ghost pl-back" data-act="back">' +
        ico('chevron') + '<span>全部歌单</span></button>' +
      '<div class="pl-hero">' +
        '<span class="pl-cover pl-cover--lg">' + coverHtml(d.cover || (items[0] && items[0].cover)) + '</span>' +
        '<div class="pl-hero__text">' +
          '<h2 class="h2 pl-hero__name">' + esc(d.name || '歌单') + '</h2>' +
          '<p class="pl-hero__meta dim num">' + esc(items.length + ' 首') +
            (total ? ' · ' + fmtTime(total) : '') + '</p>' +
          '<button type="button" class="btn pl-hero__play" data-act="play-all"' +
            (items.length ? '' : ' disabled') + '>' + ico('play', 18) + '<span>从第一首开始</span></button>' +
        '</div>' +
      '</div>';

    if (!items.length) {
      box.innerHTML = head + noteHtml('这个歌单还没有曲目', '换一个合集或收藏夹试试，单视频也支持。', 'back', '换一个歌单', 'music');
      return;
    }

    var rows = [];
    for (var k = 0; k < items.length; k++) {
      var it = items[k];
      var key = String(it.bvid || '') + '|' + String(it.cid || '');
      rows.push(
        '<button type="button" class="pl-track' + (S.nowKey && S.nowKey === key ? ' is-playing' : '') +
          '" data-play="' + k + '" data-key="' + esc(key) + '" aria-label="播放 ' + esc(it.title) + '">' +
          '<span class="pl-track__idx num">' + (k + 1 < 10 ? '0' : '') + (k + 1) + '</span>' +
          '<span class="pl-track__text">' +
            '<span class="pl-track__title truncate">' + esc(it.title || '未命名曲目') + '</span>' +
            '<span class="pl-track__sub truncate">' + esc(it.author || '未知作者') + '</span>' +
          '</span>' +
          '<span class="pl-track__dur num">' + fmtTime(it.dur) + '</span>' +
          '<span class="pl-track__go">' + ico('play', 18) + '</span>' +
        '</button>');
    }
    box.innerHTML = head + '<div class="pl-tracks">' + rows.join('') + '</div>';
    bindCoverFallbacks(box);
  }

  /* ---------- 正在播条 ---------- */
  function renderNow() {
    var bar = el.now;
    if (!bar) return;
    var it = S.now;
    if (!it) { bar.hidden = true; return; }
    bar.hidden = false;
    var title = bar.querySelector('[data-now-title]');
    var sub = bar.querySelector('[data-now-sub]');
    if (title) title.textContent = it.title || '正在播放';
    if (sub) sub.textContent = '正在播 · 点进频道看画面';
  }

  /* ---------- 数据 ---------- */
  function loadLists(force) {
    if (!el.view) return Promise.resolve();
    if (S.listsLoading) return Promise.resolve();
    if (!force && S.lists && Date.now() - S.listsAt < 15000) { renderLists(); return Promise.resolve(); }
    S.listsLoading = true;
    S.listsErr = '';
    if (!S.lists) renderLists();
    return api('/api/playlists').then(function (d) {
      S.lists = (d && d.lists) || [];
      S.listsAt = Date.now();
    }).catch(function (e) {
      S.listsErr = humanError(e, '网络不太顺，稍后再试');
    }).then(function () {
      S.listsLoading = false;
      renderLists();
    });
  }

  function loadDetail(id, force) {
    id = String(id || '');
    if (!id) return Promise.resolve();
    if (S.detailLoading) return Promise.resolve();
    if (!force && S.detail && String(S.detail.id) === id && Date.now() - S.detailAt < 15000) {
      renderDetail();
      return Promise.resolve();
    }
    S.detail = null;
    S.detailId = id;
    S.detailErr = '';
    S.detailLoading = true;
    show(['detail']);
    renderDetail();
    return api('/api/playlist?id=' + encodeURIComponent(id)).then(function (d) {
      S.detail = d || {};
      if (!S.detail.id) S.detail.id = id;
      S.detailAt = Date.now();
      var l = listById(id);
      if (l && l.cover && !S.detail.cover) S.detail.cover = l.cover;
    }).catch(function (e) {
      S.detailErr = humanError(e, '这个歌单暂时打不开');
    }).then(function () {
      S.detailLoading = false;
      renderDetail();
    });
  }

  function show(parts) {
    var lists = parts.indexOf('lists') >= 0;
    if (el.listsWrap) el.listsWrap.hidden = !lists;
    if (el.detail) el.detail.hidden = lists;
    if (el.lists) el.lists.hidden = false;
  }

  function openDetail(id) {
    loadDetail(id);
  }
  function backToLists() {
    show(['lists']);
    if (el.detail) el.detail.innerHTML = '';
    renderLists();
  }

  /* ---------- 导入（底部 sheet） ---------- */
  function looksLikeBiliLink(url) {
    return /(?:^|\/\/|\.)bilibili\.com|b23\.tv|(?:^|\s)(?:BV[0-9A-Za-z]{8,}|av\d+)/i.test(url);
  }
  function openImportSheet() {
    var body = document.createElement('div');
    body.className = 'stack gap-3';

    var hint = document.createElement('p');
    hint.className = 'muted';
    hint.textContent = '支持：合集 / 收藏夹 / 分 P / 单视频 / b23.tv 短链。';

    var input = document.createElement('input');
    input.className = 'fld';
    input.id = 'pl-import-url';
    input.type = 'url';
    input.setAttribute('inputmode', 'url');
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.placeholder = '粘贴 B 站链接';
    input.setAttribute('aria-label', '歌单链接');

    var err = document.createElement('p');
    err.className = 'muted';
    err.style.cssText = 'margin:0;font-size:13px;line-height:1.6;color:var(--text-primary);';
    err.hidden = true;

    body.appendChild(hint);
    body.appendChild(input);
    body.appendChild(err);

    var busy = false;
    function showErr(msg) { err.textContent = msg || ''; err.hidden = !msg; }

    function doImport() {
      if (busy) return;
      var url = (input.value || '').trim();
      if (!url) { showErr('先粘一个 B 站合集、收藏夹或视频链接'); return; }
      if (!looksLikeBiliLink(url)) {
        showErr('这不像 B 站链接，合集 / 收藏夹 / 分 P 都可以');
        return;
      }
      showErr('');
      busy = true;
      var btns = RR.$$ ? RR.$$('#sheet-foot .btn') : [];
      var go = btns[1];
      if (go) { go.disabled = true; go.textContent = '导入中…'; }
      api('/api/playlist/import', { method: 'POST', body: { url: url } }).then(function (d) {
        if (d && d.ok === false) throw new Error((d && d.error) || '导入失败');
        var count = d && d.count ? Number(d.count) : 0;
        var name = (d && d.name) || '歌单';
        try { RR.closeSheet(); } catch (e) {}
        toast(count ? '已导入 ' + count + ' 首' : '已导入《' + name + '》');
        return loadLists(true).then(function () {
          var id = d && d.id;
          if (id && listById(id)) openDetail(id);
        });
      }).catch(function (e2) {
        busy = false;
        if (go) { go.disabled = false; go.textContent = '导入'; }
        showErr(humanError(e2, '导入失败：确认链接公开可访问，或稍后再试'));
      });
    }

    try {
      RR.sheet({
        title: '导入歌单',
        body: body,
        actions: [
          { label: '取消' },
          { label: '导入', primary: true, keepOpen: true, onClick: doImport }
        ]
      });
    } catch (e) {
      toast('导入面板没打开，稍后再试', 'err');
      return;
    }
    setTimeout(function () { try { input.focus(); } catch (e) {} }, 320);
  }

  /* ---------- 删除 ---------- */
  function openManage(id) {
    var l = listById(id);
    if (!l) return;
    var body = '《' + (l.name || '这个歌单') + '》会从本机歌单里移除；B 站上的原合集/收藏夹不受影响。';
    try {
      RR.sheet({
        title: '删除歌单',
        body: body,
        actions: [
          { label: '取消' },
          {
            label: '删除', primary: true, onClick: function () {
              api('/api/playlist/delete', { method: 'POST', body: { id: l.id } }).then(function () {
                toast('已删除《' + (l.name || '歌单') + '》');
                S.lists = (S.lists || []).filter(function (x) { return String(x.id) !== String(l.id); });
                if (S.detailId && String(S.detailId) === String(l.id)) { S.detail = null; S.detailId = ''; backToLists(); }
                renderLists();
                loadLists(true);
              }).catch(function (e) {
                toast(humanError(e, '删除失败，稍后再试'), 'err');
              });
            }
          }
        ]
      });
    } catch (e) {
      if (window.confirm && window.confirm('删除歌单？\n' + body)) {
        api('/api/playlist/delete', { method: 'POST', body: { id: l.id } }).catch(function (err) {
          toast(humanError(err, '删除失败'), 'err');
        });
      }
    }
  }

  /* ---------- 播放 ---------- */
  function playTrack(item) {
    if (!item) return;
    if (!RR.player || typeof RR.player.playItemAt !== 'function') {
      toast('播放器还没准备好，稍后再点');
      return;
    }
    var key = String(item.bvid || '') + '|' + String(item.cid || '');
    try {
      RR.player.playItemAt(item, 0);
      S.now = item;
      S.nowKey = key;
      renderNow();
      renderDetail();
    } catch (e) {
      toast('这首歌没播起来，再点一次', 'err');
    }
  }
  function playIndex(i) {
    var items = (S.detail && S.detail.items) || [];
    if (!items[i]) return;
    playTrack(items[i]);
  }

  /* ---------- 事件 ---------- */
  function onClick(e) {
    if (!el.view) return;
    if (Date.now() < suppressClick) return;
    var t = e.target;

    var open = closest(t, '[data-open]');
    if (open) { openDetail(open.getAttribute('data-open')); return; }

    var more = closest(t, '[data-more]');
    if (more) { openManage(more.getAttribute('data-more')); return; }

    var play = closest(t, '[data-play]');
    if (play) { playIndex(Number(play.getAttribute('data-play'))); return; }

    var go = closest(t, '[data-act]');
    if (!go) return;
    var act = go.getAttribute('data-act');
    if (act === 'import') { openImportSheet(); return; }
    if (act === 'retry-lists') { loadLists(true); return; }
    if (act === 'retry-detail') { loadDetail(S.detailId, true); return; }
    if (act === 'back') { backToLists(); return; }
    if (act === 'play-all') { playIndex(0); return; }
    if (act === 'now-channel') { try { RR.go('channel'); } catch (err) {} return; }
  }

  function onPointerDown(e) {
    var main = closest(e.target, '[data-open]');
    if (!main) return;
    var id = main.getAttribute('data-open');
    press = { x: e.clientX, y: e.clientY, id: id, timer: 0 };
    press.timer = setTimeout(function () {
      if (!press) return;
      var pid = press.id;
      press = null;
      suppressClick = Date.now() + 500;
      openManage(pid);
    }, 560);
  }
  function cancelPress() {
    if (press) { clearTimeout(press.timer); press = null; }
  }
  function onPointerMove(e) {
    if (!press) return;
    if (Math.abs(e.clientX - press.x) > 8 || Math.abs(e.clientY - press.y) > 8) cancelPress();
  }
  function onContextMenu(e) {
    var main = closest(e.target, '[data-open]');
    if (!main) return;
    e.preventDefault();
    openManage(main.getAttribute('data-open'));
  }

  function onPlaying(d) {
    var item = null;
    if (d && (d.title || d.bvid)) item = d;
    else if (d && d.item) item = d.item;
    if (!item) return;
    S.now = item;
    S.nowKey = String(item.bvid || '') + '|' + String(item.cid || '');
    renderNow();
    renderDetail();
  }
  function onEnded() {
    S.now = null;
    S.nowKey = '';
    renderNow();
    renderDetail();
  }

  /* ---------- 模块 ---------- */
  function mount() {
    if (mounted) return;
    el.view = document.getElementById('view-playlist');
    if (!el.view) return;
    el.listsWrap = document.getElementById('pl-lists-wrap');
    el.lists = document.getElementById('pl-lists');
    el.detail = document.getElementById('pl-detail');
    el.importOpen = document.getElementById('pl-import-open');
    el.now = document.getElementById('pl-now');

    el.view.addEventListener('click', onClick);
    el.view.addEventListener('pointerdown', onPointerDown, { passive: true });
    el.view.addEventListener('pointermove', onPointerMove, { passive: true });
    el.view.addEventListener('pointerup', cancelPress);
    el.view.addEventListener('pointercancel', cancelPress);
    el.view.addEventListener('pointerleave', cancelPress);
    el.view.addEventListener('contextmenu', onContextMenu);
    el.view.addEventListener('scroll', cancelPress, { passive: true });

    el.refresh = document.getElementById('pl-refresh');
    if (el.refresh) {
      el.refresh.addEventListener('click', function () {
        refresh();
        el.refresh.classList.add('is-spinning');
        setTimeout(function () { el.refresh.classList.remove('is-spinning'); }, 700);
      });
    }
    if (el.importOpen) el.importOpen.addEventListener('click', openImportSheet);

    try {
      RR.iconize(el.view);
    } catch (e) {}
    renderNow();
    mounted = true;
  }

  function enter() {
    mount();
    if (!el.view) return;
    if (S.detail && S.detailId) {
      show(['detail']);
      renderDetail();
      return;
    }
    show(['lists']);
    loadLists(false);
  }
  function leave() {
    cancelPress();
  }
  function refresh() {
    S.lists = null;
    S.listsErr = '';
    return loadLists(true);
  }

  var mod = { mount: mount, enter: enter, leave: leave, refresh: refresh, open: openDetail };
  RR.playlist = mod;
  if (typeof RR.view === 'function') RR.view('playlist', mod);

  if (typeof RR.on === 'function') {
    RR.on('playing', onPlaying);
    RR.on('ended', onEnded);
  }
})();
/* ============================================================
   js/46-me.js —「我的」全屏页（library 所有权）
   账号 / 扫码登录 / 动态流 / 关于；设置分组由 44-settings.js 渲染。
   接口：/api/status、/api/login/qrcode|poll、/api/logout、
         /api/dynamic?mid=、/api/ping
   ============================================================ */
(function () {
  'use strict';

  var RR = window.RR;

  /* ---------- 状态 ---------- */
  var el = {};
  var mounted = false;
  var S = {
    status: null, statusErr: '', statusAt: 0, statusLoading: false,
    feed: null, feedErr: '', feedAt: 0, feedLoading: false, feedMid: '', feedAgain: false,
    ping: null, pingErr: '', pingAt: 0,
    qr: null, qrTimer: 0, qrSheet: null, qrBusy: false
  };

  /* ---------- 小工具 ---------- */
  function each(list, fn) { for (var i = 0; i < list.length; i++) fn(list[i], i); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function closest(node, sel) {
    while (node && node !== document) {
      if (node.nodeType === 1 && node.matches && node.matches(sel)) return node;
      node = node.parentNode;
    }
    return null;
  }
  function ico(name, size) {
    try { return RR.ICO(name, size || 20); } catch (e) { return ''; }
  }
  function toast(msg, kind) {
    try { RR.toast(msg, kind); } catch (e) {}
  }
  function fmtCount(n) {
    try { if (RR.fmtCount) return RR.fmtCount(n); } catch (e) {}
    return String(Number(n) || 0);
  }
  function coverUrl(u) {
    if (!u) return '';
    u = String(u);
    if (u.indexOf('//') === 0) return 'https:' + u;
    return u;
  }
  function cssUrl(u) { return String(u).replace(/"/g, '%22').replace(/\\/g, '%5C'); }
  function probeImage(url, cb) {
    if (!url) { cb(false); return; }
    try {
      var img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.onload = function () { cb(img.naturalWidth >= 8 && img.naturalHeight >= 8); };
      img.onerror = function () { cb(false); };
      img.src = url;
    } catch (e) { cb(false); }
  }
  function humanError(e, fallback) {
    var msg = e && e.message ? String(e.message) : '';
    if (!msg) return fallback;
    if (/Failed to fetch|NetworkError|Load failed|network|aborted|请求失败|unknown endpoint/i.test(msg)) return fallback;
    if (/HTTP\s*\d{3}/i.test(msg)) return fallback;
    return msg;
  }
  function ago(ts) {
    var n = Number(ts) || 0;
    if (!n) return '';
    if (n > 1e12) n = Math.floor(n / 1000);
    try { if (RR.fmtAgo) return RR.fmtAgo(n); } catch (e) {}
    try {
      var d = new Date(n * 1000);
      return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    } catch (e) { return ''; }
  }
  function api(path) { try { return RR.api(path); } catch (e) { return Promise.reject(e); } }
  function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(function () {});
        return true;
      }
    } catch (e) {}
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }
  function openExternal(url) {
    if (!url) { toast('这条没有外链'); return; }
    // 原生 WebView 会把外部 http(s) 交给系统浏览器（MainActivity 拦截）
    if (window.AndroidRadio) {
      try { window.location.href = url; return; } catch (e) {}
    }
    try {
      var w = window.open(url, '_blank', 'noopener');
      if (w) return;
    } catch (e) {}
    if (copyText(url)) toast('链接已复制，去浏览器打开');
  }

  /* ---------- 账号 ---------- */
  function paintTopAvatar() {
    var av = document.getElementById('acct-av');
    if (!av) return;
    var st = S.status;
    var logged = !!(st && st.logged);
    var face = logged ? coverUrl(st.face) : '';
    var initial = (logged && st.uname) ? st.uname.slice(0, 1) : '我';
    av.textContent = initial;
    av.style.backgroundImage = '';
    av.style.backgroundSize = 'cover';
    av.style.backgroundPosition = 'center';
    av.style.color = '';
    if (!face) return;
    probeImage(face, function (ok) {
      if (!ok || !av.parentNode) return;
      av.textContent = '';
      av.style.backgroundImage = 'url("' + cssUrl(face) + '")';
      av.style.color = 'transparent';
    });
  }

  function heroSkeleton() {
    return '<div class="me-hero">' +
      '<span class="me-avatar me-avatar--skel" aria-hidden="true"></span>' +
      '<span class="me-hero__text"><i class="me-skel-line" style="width:40%"></i>' +
      '<i class="me-skel-line" style="width:66%"></i></span>' +
      '</div>';
  }

  function renderAccount() {
    if (!el.account) return;
    var st = S.status;

    if (!st && S.statusLoading) { el.account.innerHTML = heroSkeleton(); return; }
    if (!st && S.statusErr) {
      el.account.innerHTML = '<div class="me-hero">' +
        '<span class="me-avatar me-avatar--ghost" aria-hidden="true">' + ico('user', 28) + '</span>' +
        '<div class="me-hero__text"><h2 class="h2">账号状态没取到</h2>' +
        '<p class="me-hero__meta muted">' + esc(S.statusErr) + '</p></div>' +
        '<div class="me-hero__acts"><button type="button" class="btn" data-act="retry-status">重试</button></div>' +
        '</div>';
      return;
    }

    if (!st || !st.logged) {
      el.account.innerHTML = '<div class="me-hero">' +
        '<span class="me-avatar me-avatar--ghost" aria-hidden="true">' + ico('user', 28) + '</span>' +
        '<div class="me-hero__text"><h2 class="h2">还没登录</h2>' +
        '<p class="me-hero__meta muted">' + esc(S.statusErr || '登录后同步头像、动态和收藏夹歌单。') + '</p></div>' +
        '<div class="me-hero__acts">' +
        '<button type="button" class="btn btn--primary" data-act="login">扫码登录</button>' +
        '</div></div>';
      return;
    }

    var initial = (st.uname || '').slice(0, 1) || '我';
    var face = coverUrl(st.face);
    var meta = [];
    if (st.mid) meta.push('UID ' + esc(st.mid));
    meta.push(esc(st.status || '已登录'));
    el.account.innerHTML = '<div class="me-hero me-hero--account">' +
      '<span class="me-avatar" aria-hidden="true">' + esc(initial) + '</span>' +
      '<div class="me-hero__text">' +
        '<div class="me-hero__name">' +
          '<h2 class="h2 truncate">' + esc(st.uname || 'B 站用户') + '</h2>' +
          (st.vip ? '<span class="badge">大会员</span>' : '') +
        '</div>' +
        '<p class="me-hero__meta dim num">' + meta.join(' · ') + '</p>' +
      '</div>' +
      '<button type="button" class="btn btn--sm btn--ghost me-hero__logout" data-act="logout">退出</button>' +
      '</div>';
    if (face) {
      var av = el.account.querySelector('.me-avatar');
      probeImage(face, function (ok) {
        if (!ok || !av || !av.parentNode) return;
        av.textContent = '';
        av.style.backgroundImage = 'url("' + cssUrl(face) + '")';
      });
    }
  }

  function loadStatus() {
    if (!el.view) return Promise.resolve();
    if (S.statusLoading) return Promise.resolve();
    S.statusLoading = true;
    if (!S.status) renderAccount();
    return api('/api/status').then(function (d) {
      var logged = !!(d && d.logged !== false && (d.logged === true || d.mid || d.uname));
      S.status = {
        logged: logged,
        uname: (d && d.uname) || '',
        mid: (d && d.mid) || '',
        face: (d && d.face) || '',
        vip: !!(d && d.vip),
        status: (d && d.status) || ''
      };
      S.statusErr = '';
      S.statusAt = Date.now();
      paintTopAvatar();
    }).catch(function (e) {
      if (!S.status) S.statusErr = humanError(e, '网络不太顺，点重试');
    }).then(function () {
      S.statusLoading = false;
      renderAccount();
      if (S.status && S.status.logged) loadFeed();
      else renderFeed();
    });
  }

  /* ---------- 动态 ---------- */
  function feedSkeleton(n) {
    var out = [];
    for (var i = 0; i < n; i++) {
      out.push('<div class="me-skel" aria-hidden="true">' +
        '<i class="me-skel__cover"></i><span class="me-skel__lines">' +
        '<i style="width:70%"></i><i style="width:44%"></i><i style="width:56%"></i></span></div>');
    }
    return out.join('');
  }
  function noteHtml(title, text, action, actionLabel, icon) {
    return '<div class="me-note">' +
      '<span class="me-note__ico">' + ico(icon || 'refresh', 20) + '</span>' +
      '<div class="me-note__text"><h3 class="h3">' + esc(title) + '</h3>' +
      '<p class="muted">' + esc(text) + '</p></div>' +
      (action ? '<button type="button" class="btn" data-act="' + esc(action) + '">' +
        esc(actionLabel) + '</button>' : '') +
      '</div>';
  }
  function kindLabel(kind) {
    if (kind === 'video') return '视频';
    if (kind === 'live') return '直播';
    if (kind === 'dynamic') return '动态';
    return '最近';
  }
  function postHtml(it) {
    var cover = coverUrl(it.cover);
    var stats = [];
    if (it.stat && it.stat.like) stats.push('赞 ' + fmtCount(it.stat.like));
    if (it.stat && it.stat.comment) stats.push('评论 ' + fmtCount(it.stat.comment));
    var text = it.text || '（没有配文，点开看看）';
    return '<a class="me-post" href="' + esc(it.url || '#') + '" target="_blank" rel="noopener noreferrer"' +
      ' data-url="' + esc(it.url || '') + '" aria-label="打开动态：' + esc(text.slice(0, 24)) + '">' +
      '<span class="me-post__cover">' +
        '<span class="me-post__ph" aria-hidden="true">' + ico(it.kind === 'live' ? 'live' : 'image', 20) + '</span>' +
        (cover ? '<img data-cover src="' + esc(cover) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') +
      '</span>' +
      '<span class="me-post__body">' +
        '<span class="me-post__top"><span class="tag">' + kindLabel(it.kind) + '</span>' +
        '<span class="me-post__time dim num">' + esc(ago(it.at)) + '</span></span>' +
        '<span class="me-post__text clamp-2">' + esc(text) + '</span>' +
        (stats.length ? '<span class="me-post__meta dim num">' + stats.join(' · ') + '</span>' : '') +
      '</span>' +
      '<span class="me-post__go" aria-hidden="true">' + ico('external', 18) + '</span>' +
      '</a>';
  }
  function bindCoverFallbacks(box) {
    each(box.querySelectorAll('img[data-cover]'), function (img) {
      img.addEventListener('error', function () { img.style.visibility = 'hidden'; });
    });
  }
  function renderFeed() {
    if (!el.feed) return;
    if (el.feedNote) el.feedNote.textContent = '';

    if ((S.statusLoading && !S.status) || (S.feedLoading && !S.feed && !S.feedErr)) {
      el.feed.innerHTML = feedSkeleton(3);
      return;
    }
    if (!S.status || !S.status.logged) {
      el.feed.innerHTML = noteHtml('登录后同步动态', '扫码登录，就能在这里看到主播的新视频、直播预告和碎碎念。',
        'login', '扫码登录', 'user');
      return;
    }
    if (S.feedErr && !S.feed) {
      el.feed.innerHTML = noteHtml('动态暂时取不到', S.feedErr, 'feed-retry', '重试', 'refresh');
      return;
    }
    var items = S.feed || [];
    if (!items.length) {
      el.feed.innerHTML = noteHtml('这个账号最近没有动态', '新视频、直播预告和图文动态会出现在这里。',
        'feed-retry', '刷新看看', 'refresh');
      return;
    }
    var html = [];
    for (var i = 0; i < items.length; i++) html.push(postHtml(items[i]));
    el.feed.innerHTML = html.join('');
    bindCoverFallbacks(el.feed);
    if (el.feedNote) el.feedNote.textContent = items.length + ' 条 · ' + ago(S.feedAt / 1000);
  }
  function loadFeed(force) {
    if (!el.view) return Promise.resolve();
    var mid = feedMidNow();
    if (!S.status || !S.status.logged) { renderFeed(); return Promise.resolve(); }
    // 同一目标已有请求在飞：回来后再补一次，别把上一位主播的结果当成新的提交
    if (S.feedLoading) { S.feedAgain = true; return Promise.resolve(); }
    if (!force && S.feed && S.feedMid === mid && Date.now() - S.feedAt < 60000) { renderFeed(); return Promise.resolve(); }
    S.feedLoading = true;
    S.feedAgain = false;
    S.feedErr = '';
    // 只有手上真没内容时才出骨架：切台重取时保留旧列表，避免闪一下
    if (!S.feed) renderFeed();
    return api('/api/dynamic?mid=' + encodeURIComponent(mid) + '&page=1').then(function (d) {
      if (mid !== feedMidNow()) { S.feedAgain = true; return; }  // 期间又切了台，这条丢弃
      S.feed = (d && d.items) || [];
      S.feedMid = mid;
      S.feedAt = Date.now();
    }).catch(function (e) {
      if (mid !== feedMidNow()) { S.feedAgain = true; return; }
      S.feedErr = humanError(e, '动态暂时取不到，稍后再试');
    }).then(function () {
      S.feedLoading = false;
      renderFeed();
      if (S.feedAgain) { S.feedAgain = false; loadFeed(true); }
    });
  }
  /* 动态是「主播级」数据：mid 取当前主播，切台要换；登录账号只决定账号区 */
  function feedMidNow() {
    var st = null;
    try { st = RR.station ? RR.station() : null; } catch (e) {}
    var mid = st && (st.mid || st.id) ? String(st.mid || st.id) : '';
    if (mid) return mid;
    return (S.status && S.status.mid) ? String(S.status.mid) : '';
  }
  /* 切主播：作废动态缓存。正在看 me 就静默重取（不动滚动位置），否则留到下次 enter */
  function onStationChange() {
    S.feedAt = 0;
    S.feedErr = '';
    if (!el.view) return;
    var here = false;
    try { here = !!(RR.route && RR.route() === 'me'); } catch (e) {}
    if (here) loadFeed(true);
  }

  /* ---------- 关于 ---------- */
  function renderAbout() {
    if (!el.about) return;
    var p = S.ping;
    var version = p && (p.version || p.appVersion) ? String(p.version || p.appVersion) : '--';
    // #me-about 自己就是卡片（.me-about），这里不要再套一层卡片
    el.about.innerHTML =
      '<p class="me-about__version">版本 <span class="num">' + esc(version) + '</span>（基于上游 v1.9.34）</p>' +
      '<p class="me-about__note dim">个人作品，与哔哩哔哩官方无关；内容版权归原作者所有。</p>' +
      '<div class="me-about__acts">' +
        '<button type="button" class="btn" data-act="license">开源许可</button>' +
        (S.pingErr ? '<button type="button" class="btn btn--ghost" data-act="retry-ping">重试版本</button>' : '') +
      '</div>';
  }
  function loadPing() {
    return api('/api/ping').then(function (d) {
      S.ping = d || {};
      S.pingErr = '';
      S.pingAt = Date.now();
    }).catch(function (e) {
      S.pingErr = humanError(e, '版本信息没取到');
    }).then(function () {
      renderAbout();
    });
  }
  function licenseSheet() {
    var box = document.createElement('div');
    box.className = 'stack gap-3';
    box.innerHTML =
      '<p class="muted">哔哩吧啦是个人作品，与哔哩哔哩官方无关。' +
      '直播回放、动态与封面等内容版权归 B 站与原作者所有。</p>' +
      '<p class="h3">上游</p>' +
      '<p class="muted">播放与接口逻辑基于上游 v1.9.34 重写，7.0.0 重做了歌单、我的与设置层。</p>' +
      '<p class="h3">第三方组件</p>' +
      '<p class="muted">mpegts.js — Apache-2.0<br>' +
      'qrcode.js — MIT<br>' +
      'AndroidX / Media3 ExoPlayer — Apache-2.0<br>' +
      '界面字体走系统字体栈，不加载网络字体。</p>';
    try {
      RR.sheet({ title: '开源许可', body: box, actions: [{ label: '知道了' }] });
    } catch (e) {
      toast('许可信息打不开');
    }
  }

  /* ---------- 扫码登录 ---------- */
  function setQrStatus(text) {
    if (S.qr && S.qr.status) S.qr.status.textContent = text || '';
  }
  function stopQrPoll() {
    if (S.qrTimer) { clearInterval(S.qrTimer); S.qrTimer = 0; }
    S.qrBusy = false;
  }
  function drawQr(url) {
    if (!S.qr || !S.qr.host) return;
    var host = S.qr.host;
    host.innerHTML = '';
    host.style.padding = '12px';
    if (window.QRCode) {
      try {
        var level = (window.QRCode.CorrectLevel && window.QRCode.CorrectLevel.M) || 1;
        new window.QRCode(host, {
          text: String(url), width: 196, height: 196,
          colorDark: '#1F1F1F', colorLight: '#FFFFFF', correctLevel: level
        });
        return;
      } catch (e) {}
    }
    host.style.padding = '8px';
    var a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = '二维码组件未就绪，点这里打开登录页';
    a.className = 'muted';
    a.style.cssText = 'font-size:12px;line-height:1.6;text-align:center;word-break:break-all;padding:8px;';
    host.appendChild(a);
  }
  function qrExpired() {
    stopQrPoll();
    setQrStatus('二维码过期了，点下面刷新');
    if (S.qr && S.qr.refresh) S.qr.refresh.hidden = false;
  }
  function onLoginSuccess() {
    stopQrPoll();
    try { RR.closeSheet(); } catch (e) {}
    S.qr = null;
    toast('登录成功');
    S.status = null; S.statusAt = 0; S.feed = null; S.feedAt = 0;
    renderAccount();
    renderFeed();
    loadStatus().then(function () { if (S.status && S.status.logged) loadFeed(true); });
  }
  function startQrPoll() {
    stopQrPoll();
    S.qrTimer = setInterval(function () {
      if (!S.qr) { stopQrPoll(); return; }
      if (typeof RR.sheetOpen === 'function' && !RR.sheetOpen()) { stopQrPoll(); S.qr = null; return; }
      if (S.qrBusy) return;
      if (S.qr.expiresAt && Date.now() > S.qr.expiresAt) { qrExpired(); return; }
      S.qrBusy = true;
      api('/api/login/poll').then(function (d) {
        if (!S.qr) return;
        S.qrBusy = false;
        var code = d && d.code;
        var msg = (d && (d.message || d.msg)) || '';
        if (code === 0 || code === '0' || (d && (d.ok === true || d.logged === true))) { onLoginSuccess(); return; }
        if (code === 86038 || code === '86038' || /过期|失效/.test(msg)) { qrExpired(); return; }
        setQrStatus(msg || (String(code) === '86090' ? '已扫码，请在手机上确认' : '等待扫码…'));
      }).catch(function () {
        if (S.qr) S.qrBusy = false;
        setQrStatus('网络抖了一下，继续等…');
      });
    }, 2000);
  }
  function requestQr() {
    if (!S.qr) return;
    stopQrPoll();
    setQrStatus('正在生成二维码…');
    S.qr.host.innerHTML = '';
    S.qr.refresh.hidden = true;
    api('/api/login/qrcode').then(function (d) {
      var url = d && (d.url || d.qr_url || d.code_url || d.qr);
      if (!url) throw new Error('没取到二维码链接');
      S.qr.url = url;
      S.qr.expiresAt = Date.now() + 180000;
      drawQr(url);
      setQrStatus('用哔哩哔哩 App 扫一扫');
      startQrPoll();
    }).catch(function (e) {
      setQrStatus(humanError(e, '二维码没取到，点下面刷新'));
      if (S.qr) S.qr.refresh.hidden = false;
    });
  }
  function openLogin() {
    if (S.qr) {
      var open = typeof RR.sheetOpen === 'function' ? RR.sheetOpen() : true;
      if (open) return; // 已经开着
      S.qr = null;
      stopQrPoll();
    }
    var box = document.createElement('div');
    box.className = 'stack gap-3';

    var host = document.createElement('div');
    host.setAttribute('aria-label', '登录二维码');
    host.style.cssText = 'width:220px;height:220px;margin:0 auto;background:#FFFFFF;border-radius:16px;' +
      'display:grid;place-items:center;padding:12px;box-sizing:border-box;overflow:hidden;';

    var status = document.createElement('p');
    status.className = 'muted';
    status.style.cssText = 'text-align:center;font-size:13px;line-height:1.6;margin:0;';
    status.textContent = '正在生成二维码…';

    var tip = document.createElement('p');
    tip.className = 'dim';
    tip.style.cssText = 'text-align:center;font-size:12px;line-height:1.6;margin:0;';
    tip.textContent = '用哔哩哔哩 App 扫一扫；登录信息只留在本机，不会上传。';

    var refresh = document.createElement('button');
    refresh.type = 'button';
    refresh.className = 'btn';
    refresh.textContent = '刷新二维码';
    refresh.hidden = true;
    refresh.addEventListener('click', requestQr);

    box.appendChild(host);
    box.appendChild(status);
    box.appendChild(tip);
    box.appendChild(refresh);

    S.qr = { host: host, status: status, refresh: refresh, url: '', expiresAt: 0 };
    try {
      S.qrSheet = RR.sheet({
        title: '扫码登录',
        body: box,
        actions: [{ label: '关闭' }]
      });
    } catch (e) {
      S.qr = null;
      toast('登录面板没打开，稍后再试');
      return;
    }
    requestQr();
  }
  function stopQr() {
    stopQrPoll();
    S.qr = null;
    S.qrSheet = null;
    try {
      if (typeof RR.sheetOpen === 'function' && RR.sheetOpen()) RR.closeSheet();
    } catch (e) {}
  }

  /* ---------- 退出登录 ---------- */
  function askLogout() {
    try {
      RR.sheet({
        title: '退出登录',
        body: '退出后「我的」不再显示动态，歌单与设置会保留在本机。',
        actions: [
          { label: '取消' },
          {
            label: '退出', primary: true, onClick: function () {
              api('/api/logout').then(function () {
                toast('已退出登录');
                S.status = null; S.statusAt = 0;
                S.feed = null; S.feedAt = 0; S.feedErr = '';
                paintTopAvatar();
                renderAccount();
                renderFeed();
                loadStatus();
              }).catch(function (e) {
                toast(humanError(e, '退出失败，稍后再试'), 'err');
              });
            }
          }
        ]
      });
    } catch (e) {
      if (window.confirm && window.confirm('退出登录？')) {
        api('/api/logout').catch(function () {});
      }
    }
  }

  /* ---------- 刷新 ---------- */
  function setSpin(on) {
    if (!el.refresh) return;
    el.refresh.classList.toggle('is-spinning', !!on);
    el.refresh.disabled = !!on;
  }
  function refreshAll() {
    setSpin(true);
    S.statusAt = 0; S.feedAt = 0; S.pingAt = 0;
    var started = Date.now();
    loadPing();
    loadStatus().then(function () {
      if (S.status && S.status.logged) return loadFeed(true);
    }).then(function () {
      var wait = Math.max(0, 520 - (Date.now() - started));
      setTimeout(function () { setSpin(false); }, wait);
    }).catch(function () {
      setSpin(false);
    });
  }

  /* ---------- 事件 ---------- */
  function onClick(e) {
    if (!el.view) return;
    var t = e.target;

    var postEl = closest(t, '.me-post');
    if (postEl && window.AndroidRadio) {
      e.preventDefault();
      openExternal(postEl.getAttribute('data-url'));
      return;
    }

    var btn = closest(t, '[data-act]');
    if (!btn) return;
    var act = btn.getAttribute('data-act');
    if (act === 'login') { openLogin(); return; }
    if (act === 'logout') { askLogout(); return; }
    if (act === 'license') { licenseSheet(); return; }
    if (act === 'retry-status') { loadStatus(); return; }
    if (act === 'feed-retry') { loadFeed(true); return; }
    if (act === 'retry-ping') { loadPing(); return; }
  }

  /* ---------- 滚动：页头吸顶投影 + 位置复位 ---------- */
  var scrollTicking = false;
  function setStuck(on) {
    if (!el.top) return;
    var has = el.top.classList.contains('is-stuck');
    if (has !== !!on) el.top.classList.toggle('is-stuck', !!on);
  }
  function onViewScroll() {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(function () {
      scrollTicking = false;
      if (!el.view) return;
      setStuck(el.view.scrollTop > 2);
    });
  }
  function resetScroll() {
    if (!el.view) return;
    try { el.view.scrollTop = 0; } catch (e) {}
    setStuck(false);
  }

  /* ---------- 模块 ---------- */
  function mount() {
    if (mounted) return;
    el.view = document.getElementById('view-me');
    if (!el.view) return;
    el.top = el.view.querySelector('.me-top');
    el.account = document.getElementById('me-account');
    el.feed = document.getElementById('me-feed');
    el.feedNote = document.getElementById('me-feed-note');
    el.settings = document.getElementById('me-settings');
    el.about = document.getElementById('me-about');
    el.refresh = document.getElementById('me-refresh');
    el.close = document.getElementById('me-close');

    el.view.addEventListener('click', onClick);
    el.view.addEventListener('scroll', onViewScroll, { passive: true });

    // 老 WebView 没有 position:sticky 时，CSS 里退化成 fixed 页头 + 内容让位
    try {
      var stickyOK = !!(window.CSS && window.CSS.supports && window.CSS.supports('position', 'sticky'));
      el.view.classList.toggle('is-nosticky', !stickyOK);
    } catch (e) {
      el.view.classList.add('is-nosticky');
    }

    // 切台后动态要跟着换（主播级数据）；账号区是登录态，不跟着重取
    try {
      RR.on('station', onStationChange);
      RR.on('station-changed', onStationChange);
    } catch (e) {}

    if (el.close) {
      el.close.addEventListener('click', function () {
        try { RR.back(); } catch (e) {}
      });
    }
    if (el.refresh) {
      el.refresh.addEventListener('click', refreshAll);
    }
    if (RR.settingsUI && RR.settingsUI.mount) {
      try { RR.settingsUI.mount(); } catch (e) {}
    }

    renderAccount();
    renderFeed();
    renderAbout();
    try { RR.iconize(el.view); } catch (e) {}
    mounted = true;
  }

  function enter() {
    mount();
    if (!el.view) return;
    resetScroll();
    if (RR.settingsUI && RR.settingsUI.enter) {
      try { RR.settingsUI.enter(); } catch (e) {}
    }
    if (!S.status || Date.now() - S.statusAt > 30000) loadStatus();
    else renderAccount();
    if (!S.ping || Date.now() - S.pingAt > 300000) loadPing();
    if (S.status && S.status.logged) loadFeed(false);
    else renderFeed();
  }

  function leave() {
    stopQr();
    resetScroll();   // 关闭时把滚动位置复位，下次进来从顶部开始
  }

  var mod = { mount: mount, enter: enter, leave: leave, refresh: refreshAll, openLogin: openLogin };
  RR.me = mod;
  if (typeof RR.view === 'function') RR.view('me', mod);
})();
/* ============================================================
   90-boot.js · 启动顺序：主题 → 主播 → 视图挂载 → 路由
   ============================================================ */
(function () {
  'use strict';
  var RR = window.RR;
  var ORDER = ['channel', 'live', 'playlist', 'monitor', 'me'];

  function paintStation(st) {
    var name = RR.$('#st-name'), sub = RR.$('#st-sub'), av = RR.$('#st-av');
    if (!name) return;
    if (!st) {
      name.textContent = '还没有主播';
      sub.textContent = '点这里添加';
      if (av) av.style.backgroundImage = '';
      return;
    }
    name.textContent = st.name || ('主播 ' + (st.mid || ''));
    var bits = [];
    if (st.room) bits.push('房间 ' + st.room);
    sub.textContent = bits.join(' · ') || '回放频道';
    if (av) av.style.backgroundImage = st.face ? 'url("' + st.face + '")' : '';
  }

  function checkLive() {
    var st = RR.station();
    var dot = RR.$('#top-live');
    if (!dot) return;
    if (!st || !st.mid) { dot.hidden = true; return; }
    RR.api('/api/live/playinfo?mid=' + encodeURIComponent(st.mid)).then(function (d) {
      dot.hidden = !(d && d.living);
      if (d && d.living) dot.dataset.room = d.room_id || d.room || '';
    }).catch(function () { });
  }

  /* ---------- 添加主播 ---------- */
  function onboarding() {
    var box = RR.el('div', 'stack gap-3');
    box.innerHTML =
      '<p class="muted" style="font-size:13px;line-height:1.6">填一位 B 站主播的 UID（个人主页那串数字），' +
      'TA 的直播回放会被排成一条不停的频道。</p>' +
      '<label class="sr-only" for="ob-mid">B 站 UID</label>' +
      '<input id="ob-mid" class="fld" inputmode="numeric" autocomplete="off" placeholder="B 站 UID，例如 123456">' +
      '<div id="ob-res" class="ob-res" hidden></div>';
    var sh = RR.sheet({
      title: '先加一位主播',
      body: box,
      actions: [
        { label: '检测', onClick: function () { } , keepOpen: true },
        { label: '就听 TA 的', primary: true, onClick: function () { } , keepOpen: true }
      ]
    });
    var input = RR.$('#ob-mid'), res = RR.$('#ob-res');
    var probed = null;
    var btns = RR.$$('#sheet-foot .btn');
    btns[0].addEventListener('click', function () {
      var mid = (input.value || '').trim();
      if (!/^\d{1,12}$/.test(mid)) { RR.toast('UID 是一串数字', 'err'); return; }
      btns[0].disabled = true; btns[0].textContent = '检测中…';
      RR.post('/api/stations/probe', { mid: mid }).then(function (d) {
        var p = d.probe || {};
        if (!p.name) throw new Error('没找到这位主播');
        probed = { mid: mid, name: p.name, room: p.room, face: p.face, sourceId: (p.suggested || '') };
        res.hidden = false;
        res.innerHTML = '<div class="row gap-3"><span class="avatar" style="background:#0000 center/cover no-repeat' +
          (p.face ? ';background-image:url(&quot;' + p.face + '&quot;)' : '') + '"></span><span class="grow"><b>' +
          (p.name || '') + '</b><i class="dim" style="display:block;font-size:12px">' +
          (p.room ? '直播间 ' + p.room : '没有绑定直播间') + '</i></span></div>';
      }).catch(function (e) {
        RR.toast(e.message || '检测失败', 'err');
      }).then(function () {
        btns[0].disabled = false; btns[0].textContent = '检测';
      });
    });
    btns[1].addEventListener('click', function () {
      if (!probed) { RR.toast('先点一下「检测」', 'err'); return; }
      RR.post('/api/stations/save', { mid: probed.mid, sourceId: probed.sourceId }).then(function () {
        return RR.loadStations();
      }).then(function () {
        RR.toast('加好了');
        RR.closeSheet();
        RR.emit('station', RR.station());
        RR.go('channel');
        checkLive();
      }).catch(function (e) { RR.toast(e.message || '保存失败', 'err'); });
    });
    setTimeout(function () { try { input.focus(); } catch (e) { } }, 260);
    return sh;
  }

  /* ---------- 主播切换 ---------- */
  function stationSheet() {
    var box = RR.el('div', 'stack gap-2');
    var list = RR.stations();
    if (!list.length) {
      box.innerHTML = '<p class="muted" style="font-size:13px">还没添加主播。</p>';
    } else {
      list.forEach(function (s) {
        var b = RR.el('button', 'sheet-row');
        b.type = 'button';
        b.innerHTML = '<span class="avatar" style="background:#0000 center/cover no-repeat' +
          (s.face ? ';background-image:url(&quot;' + s.face + '&quot;)' : '') + '"></span>' +
          '<span class="sheet-row__t"><b>' + (s.name || s.mid) + '</b><i>' +
          (s.room ? '房间 ' + s.room : '未绑定直播间') + '</i></span>' +
          (RR.station() && RR.station().id === s.id ? '<span class="badge">当前</span>' : '');
        b.addEventListener('click', function () {
          RR.setStation(s.id); paintStation(s); RR.closeSheet();
          RR.toast('切到 ' + (s.name || s.mid)); checkLive();
          RR.emit('station-changed', s);
        });
        box.appendChild(b);
      });
    }
    RR.sheet({
      title: '主播',
      body: box,
      actions: [{ label: '添加一位主播', primary: true, onClick: function () { setTimeout(onboarding, 320); } }]
    });
  }

  /* ---------- 顶栏主播：左右滑动快捷切换（8.1） ----------
     用户的话：「左上角主播那一个按钮…左右滑动可以快捷切换主播，不用二次选择和确认」。
     手势只挂在 #st-btn 自己身上，判定分三层：
       1. 8px 阈值：位移没过 8px 一律当点按，原 click 照旧开切换 sheet；
       2. 30ms 方向窗：起手 30ms 内除非横向已过 24px，不抢方向，避免把页面滚动带偏；
          过了窗口就按「|dx| > |dy|*1.2」一次定轴，整个手势不再改判；
       3. 24px 触发：定轴为横向且 |dx|>24 才切台（左滑下一台 / 右滑上一台）。
     纵向手势一个字节都不拦（不 preventDefault），页面滚动不受影响；
     只有横向成立后才 preventDefault + 吞掉随后的 click，避免切完又弹 sheet。
     切台只调 RR.setStation()：它 emit('station')，顶栏重画 / 直播角标 / 频道重载
     都跟着现有事件走，这里不额外拉数据、也不弹二次确认。 */
  var SW = { on: false, x: 0, y: 0, t0: 0, axis: '' };
  var swallowClick = false;

  function stationStep(dir) {
    var list = RR.stations() || [];
    if (list.length < 2) {
      RR.toast(list.length ? '只有一位主播' : '还没有主播');
      return;
    }
    var cur = RR.station(), i = -1, k;
    for (k = 0; k < list.length; k++) {
      if (cur && list[k].id === cur.id) { i = k; break; }
    }
    if (i < 0) { i = 0; }
    var next = list[(i + dir + list.length) % list.length];
    if (!next || (cur && next.id === cur.id)) { return; }
    RR.setStation(next.id);
    RR.toast('切到 ' + (next.name || next.mid || '这位主播'));
  }

  function bindStationSwipe(btn) {
    var TH = 8, TRIGGER = 24, RATIO = 1.2, LOCK_MS = 30;
    btn.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) { SW.on = false; return; }
      var t = e.touches[0];
      swallowClick = false;                 /* 新手势起手：清掉上一手势可能留下的吞点击标记 */
      SW = { on: true, x: t.clientX, y: t.clientY, t0: Date.now(), axis: '' };
    }, { passive: true });
    /* 只有 touchmove 需要 preventDefault，所以必须 passive:false；
       纵向分支直接 return，不调 preventDefault，滚动照常。 */
    btn.addEventListener('touchmove', function (e) {
      if (!SW.on || e.touches.length !== 1) { return; }
      var t = e.touches[0], dx = t.clientX - SW.x, dy = t.clientY - SW.y;
      var ax = Math.abs(dx), ay = Math.abs(dy);
      if (!SW.axis) {
        var early = Date.now() - SW.t0 < LOCK_MS;
        if (early && ax < TRIGGER) { return; }      /* 起手 30ms：不到 24px 不抢方向 */
        if (ax < TH && ay < TH) { return; }         /* 8px 阈值 */
        SW.axis = ax > ay * RATIO ? 'x' : 'y';      /* 一次定轴，之后不改判 */
      }
      if (SW.axis !== 'x') { return; }              /* 纵向：放行给页面滚动 */
      if (ax > ay * RATIO) {
        if (e.cancelable) { e.preventDefault(); }
        if (ax > TRIGGER && !swallowClick) {
          swallowClick = true;
          stationStep(dx < 0 ? 1 : -1);
        }
      }
    }, { passive: false });
    var end = function () {
      SW.on = false;
      if (swallowClick) { setTimeout(function () { swallowClick = false; }, 420); }
    };
    btn.addEventListener('touchend', end, { passive: true });
    btn.addEventListener('touchcancel', end, { passive: true });
    /* 捕获段先于 90-boot 自己的 click（开 sheet）：滑动过就吞掉这一次点按 */
    btn.addEventListener('click', function (e) {
      if (!swallowClick) { return; }
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    }, true);
  }

  /* ---------- 启动 ---------- */
  function mountAll() {
    ORDER.forEach(function (name) {
      var m = RR.modules[name];
      if (m && m.mount) {
        try { m.mount(); } catch (e) { __E.push('mount:' + name + ':' + e.message); }
      }
    });
  }

  function start() {
    RR.loadStations().then(function () {
      paintStation(RR.station());
      mountAll();
      RR.boot();
      var boot = RR.$('#boot');
      if (boot) { boot.classList.add('is-done'); setTimeout(function () { boot.remove(); }, 420); }
      checkLive();
      setInterval(checkLive, 60000);
      if (!RR.station()) {
        setTimeout(onboarding, 420);
      }
    });
    var stBtn = RR.$('#st-btn');
    if (stBtn) {
      bindStationSwipe(stBtn);
      stBtn.addEventListener('click', stationSheet);
    }
    var dot = RR.$('#top-live');
    if (dot) dot.addEventListener('click', function () { RR.go('live'); });
    RR.on('station', function (st) { paintStation(st); checkLive(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
