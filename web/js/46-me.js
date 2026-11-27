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
