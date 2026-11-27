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
