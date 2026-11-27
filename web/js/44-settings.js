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
