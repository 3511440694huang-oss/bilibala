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
