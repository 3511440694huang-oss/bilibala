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
