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
