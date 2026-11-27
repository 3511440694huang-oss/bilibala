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
