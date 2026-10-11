/* 루트로그 RouteLog: 포스팅이 여행가이드가 되고, 가이드를 포크해 다시 공유하는 여행 SNS (정적 프로토타입) */
(function () {
  'use strict';

  const DB_KEY = 'routelog.v1';
  const TOKYO = [35.6812, 139.7671];
  const CATS = {
    sight: { label: '관광', color: '#0f766e' },
    food: { label: '식당', color: '#c2410c' },
    cafe: { label: '카페', color: '#a16207' },
    shop: { label: '쇼핑', color: '#7c3aed' },
    stay: { label: '숙소', color: '#2563eb' },
    etc: { label: '기타', color: '#64748b' }
  };

  /* ---------- 저장소 ---------- */
  let db = load();
  function load() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* 저장소 접근 불가: 샘플로 시작 */ }
    return window.RL_SEED();
  }
  function save() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); return true; } catch (e) {
      toast('기기 저장 공간이 부족해요. 사진 수를 줄여주세요.');
      return false;
    }
  }
  const uid = p => p + '_' + Date.now().toString(36) + (db.seq++).toString(36);
  const me = () => db.users[db.me];

  /* ---------- 유틸 ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yen = n => n ? '¥' + Number(n).toLocaleString('ko-KR') : '무료';
  function fmtTime(iso) {
    // 시차가 적힌 기록은 그 현지 시각 그대로 보여준다
    const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d).*[+-]\d\d:\d\d$/.exec(iso);
    if (m) return `${+m[2]}월 ${+m[3]}일 ${m[4]}:${m[5]}`;
    const d = new Date(iso);
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  function ago(iso) {
    const m = Math.round((Date.now() - new Date(iso)) / 60000);
    if (m < 1) return '방금';
    if (m < 60) return m + '분 전';
    if (m < 1440) return Math.round(m / 60) + '시간 전';
    if (m < 43200) return Math.round(m / 1440) + '일 전';
    return fmtTime(iso);
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2400);
  }
  function avatar(u, size = 36) {
    return `<span class="avatar" style="--av:${esc(u.color)};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px">${esc(u.name.slice(0, 1))}</span>`;
  }
  function catChip(cat) {
    const c = CATS[cat] || CATS.etc;
    return `<span class="chip" style="--chip:${c.color}">${c.label}</span>`;
  }
  function photoBox(post, spot, cls = '') {
    if (post && post.photo) return `<img class="photo ${cls}" src="${post.photo}" alt="${esc(spot.name)} 사진" loading="lazy">`;
    const c = CATS[spot.cat] || CATS.etc;
    return `<div class="photo ph ${cls}" style="--ph:${c.color}" role="img" aria-label="${esc(spot.name)}"><span>${esc(spot.name)}</span></div>`;
  }
  function stars(n) {
    if (!n) return '';
    return `<span class="stars" aria-label="별점 ${n}점">${'★'.repeat(n)}<span class="dim">${'★'.repeat(5 - n)}</span></span>`;
  }
  function distM(a, b) {
    const R = 6371000, toR = x => x * Math.PI / 180;
    const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* ---------- 도메인 ---------- */
  const guidesArr = () => Object.values(db.guides);
  const children = g => guidesArr().filter(x => x.forkedFrom === g.id);
  function likeCount(g) { return (g.baseLikes || 0) + (db.likes[g.id] ? 1 : 0); }
  function saveCount(g) { return (g.baseSaves || 0) + (db.saves[g.id] ? 1 : 0); }
  function forkCount(g) {
    let n = 0;
    const walk = id => guidesArr().forEach(x => { if (x.forkedFrom === id) { n++; walk(x.id); } });
    walk(g.id);
    return n;
  }
  function days(g) {
    const map = new Map();
    g.items.forEach((it, idx) => {
      if (!map.has(it.day)) map.set(it.day, []);
      map.get(it.day).push({ it, idx });
    });
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }
  function orderedItems(g) {
    return days(g).flatMap(([, list]) => list.map(x => x.it));
  }
  function itemSpot(it) { return db.spots[it.spotId]; }
  function itemPost(it) { return it.postId ? db.posts[it.postId] : null; }
  function addedVsParent(g) {
    if (!g.forkedFrom || !db.guides[g.forkedFrom]) return new Set();
    const parentSpots = new Set(db.guides[g.forkedFrom].items.map(i => i.spotId));
    return new Set(g.items.filter(i => !parentSpots.has(i.spotId)).map(i => i.id));
  }
  function coverOf(g) {
    const withPhoto = g.items.map(itemPost).find(p => p && p.photo);
    const first = g.items[0];
    return { post: withPhoto || (first && itemPost(first)), spot: withPhoto ? db.spots[withPhoto.spotId] : (first ? itemSpot(first) : { name: g.title, cat: 'etc' }) };
  }
  function dayOf(g, iso) {
    if (!g.startDate) return 1;
    const start = new Date(g.startDate + 'T00:00:00');
    const d = new Date(iso);
    const n = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - start) / 86400000) + 1;
    return Math.max(1, n);
  }
  function fork(g) {
    const ng = {
      id: uid('g'), ownerId: db.me, title: g.title + ' (내 버전)', city: g.city, desc: '',
      startDate: new Date().toISOString().slice(0, 10), forkedFrom: g.id,
      createdAt: new Date().toISOString(), baseLikes: 0, baseSaves: 0, tags: [...(g.tags || [])],
      items: g.items.map(it => ({ ...it, id: uid('i') }))
    };
    db.guides[ng.id] = ng;
    save();
    return ng;
  }
  function findOrCreateSpot({ name, cat, lat, lng, area }) {
    const near = Object.values(db.spots).find(s => s.name.trim() === name.trim() && distM(s, { lat, lng }) < 300);
    if (near) return near;
    const s = { id: uid('s'), name: name.trim(), cat, lat, lng, area: area || '' };
    db.spots[s.id] = s;
    return s;
  }

  /* ---------- 공유 링크 (가이드 전체를 URL에 담아 앱 없이도 전달) ---------- */
  async function packGuide(g) {
    const ps = {}, ss = {}, us = {};
    g.items.forEach(it => {
      ss[it.spotId] = db.spots[it.spotId];
      const p = itemPost(it);
      if (p) { ps[p.id] = { ...p, photo: null }; us[p.userId] = db.users[p.userId]; }
      if (db.users[it.by]) us[it.by] = db.users[it.by];
    });
    us[g.ownerId] = db.users[g.ownerId];
    const parent = g.forkedFrom && db.guides[g.forkedFrom];
    const payload = { v: 1, g, ps, ss, us, parent: parent ? { id: parent.id, title: parent.title, ownerId: parent.ownerId } : null };
    if (parent) us[parent.ownerId] = db.users[parent.ownerId];
    const json = JSON.stringify(payload);
    let bytes = new TextEncoder().encode(json);
    let tag = 'r';
    if ('CompressionStream' in window) {
      const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(cs).arrayBuffer());
      tag = 'z';
    }
    let bin = '';
    bytes.forEach(b => { bin += String.fromCharCode(b); });
    return tag + btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  async function unpackGuide(str) {
    const tag = str[0];
    const b64 = str.slice(1).replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(b64);
    let bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    if (tag === 'z') {
      const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(ds).arrayBuffer());
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  async function shareGuide(g) {
    try {
      const code = await packGuide(g);
      const url = location.origin + location.pathname + '#/import/' + code;
      const owner = db.users[g.ownerId];
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: g.title, text: `${owner.name}님의 여행가이드: ${g.title}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast('공유 링크를 복사했어요. 카톡이나 DM에 붙여넣으세요.');
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      openModal(`<h2>공유 링크</h2><p class="muted">아래 링크를 복사해 보내주세요.</p><textarea class="input" rows="4" readonly onclick="this.select()">${esc(location.origin + location.pathname + '#/import/' + (await packGuide(g)))}</textarea><div class="row end"><button class="btn" data-close>닫기</button></div>`);
    }
  }

  /* ---------- 지도 ---------- */
  const maps = [];
  function clearMaps() { while (maps.length) { try { maps.pop().remove(); } catch (e) { /* noop */ } } }
  function makeMap(el, opts = {}) {
    if (!window.L) { el.innerHTML = '<p class="muted pad">지도를 불러오지 못했어요.</p>'; return null; }
    const m = L.map(el, { zoomControl: true, scrollWheelZoom: !!opts.scroll, attributionControl: true }).setView(opts.center || TOKYO, opts.zoom || 12);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap'
    }).addTo(m);
    maps.push(m);
    setTimeout(() => m.invalidateSize(), 50);
    return m;
  }
  function pin(label, color, active) {
    return L.divIcon({
      className: 'pin-wrap',
      html: `<span class="pin${active ? ' active' : ''}" style="--pin:${color}">${esc(label)}</span>`,
      iconSize: [28, 28], iconAnchor: [14, 14]
    });
  }
  function drawRoute(m, g, onClick) {
    const pts = [];
    let n = 0;
    days(g).forEach(([day, list]) => {
      const dayPts = [];
      list.forEach(({ it }) => {
        const s = itemSpot(it);
        if (!s) return;
        n++;
        const done = db.progress[g.id] && db.progress[g.id][it.id];
        const mk = L.marker([s.lat, s.lng], { icon: pin(String(n), done ? '#94a3b8' : (CATS[s.cat] || CATS.etc).color) }).addTo(m);
        mk.bindTooltip(`Day ${day} · ${s.name}`);
        if (onClick) mk.on('click', () => onClick(it));
        dayPts.push([s.lat, s.lng]);
        pts.push([s.lat, s.lng]);
      });
      if (dayPts.length > 1) L.polyline(dayPts, { color: dayColor(day), weight: 4, opacity: 0.75, dashArray: '2 8', lineCap: 'round' }).addTo(m);
    });
    if (pts.length) m.fitBounds(pts, { padding: [30, 30], maxZoom: 15 });
  }
  const dayColor = d => ['#0f766e', '#c2410c', '#7c3aed', '#2563eb', '#be185d', '#a16207'][(d - 1) % 6];

  /* ---------- 내비게이션 ---------- */
  const NAV = [
    { href: '#/', key: 'feed', label: '홈', icon: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>' },
    { href: '#/explore', key: 'explore', label: '탐색', icon: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>' },
    { href: '#/new', key: 'new', label: '포스팅', icon: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v8M8 12h8"/>' },
    { href: '#/trips', key: 'trips', label: '내 여행', icon: '<path d="M4 19c4-1 3-7 8-8s5-5 8-6"/><circle cx="4" cy="19" r="2"/><circle cx="20" cy="5" r="2"/>' },
    { href: '#/me', key: 'me', label: '프로필', icon: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>' }
  ];
  function renderNav(active) {
    const html = NAV.map(n => `<a href="${n.href}" class="${n.key === active ? 'on' : ''}${n.key === 'new' ? ' cta' : ''}" ${n.key === active ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${n.icon}</svg><span>${n.label}</span></a>`).join('');
    $('#navlinks').innerHTML = html;
    $('#tabbar').innerHTML = html;
  }

  /* ---------- 공통 조각 ---------- */
  function guideCard(g) {
    const owner = db.users[g.ownerId];
    const c = coverOf(g);
    const dcount = days(g).length;
    const parent = g.forkedFrom && db.guides[g.forkedFrom];
    return `<article class="card guide-card">
      <a href="#/guide/${g.id}" class="cover-link">${photoBox(c.post, c.spot, 'cover')}
        <span class="cover-badge">${esc(g.city)} · ${dcount}일 · 스팟 ${g.items.length}</span></a>
      <div class="card-body">
        <a href="#/guide/${g.id}" class="title-link"><h3>${esc(g.title)}</h3></a>
        ${parent ? `<p class="fork-line"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v2a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V7M12 13v4"/></svg>${esc(db.users[parent.ownerId].name)}님의 「${esc(parent.title)}」에서 포크</p>` : ''}
        <p class="muted clamp2">${esc(g.desc)}</p>
        <div class="meta-row">
          <a class="who" href="#/user/${owner.id}">${avatar(owner, 24)}<span>${esc(owner.name)}</span></a>
          <span class="stats"><span title="좋아요">♥ ${likeCount(g)}</span><span title="포크">⑂ ${forkCount(g)}</span></span>
        </div>
      </div>
    </article>`;
  }
  function postCard(p) {
    const s = db.spots[p.spotId], u = db.users[p.userId];
    const inGuides = guidesArr().filter(g => g.items.some(i => i.postId === p.id));
    return `<article class="card post-card">
      <header class="post-head"><a class="who" href="#/user/${u.id}">${avatar(u, 32)}<span><b>${esc(u.name)}</b><small class="muted">${ago(p.at)}</small></span></a></header>
      ${photoBox(p, s)}
      <div class="card-body">
        <a href="#/spot/${s.id}" class="spot-line">${catChip(s.cat)}<b>${esc(s.name)}</b><span class="muted">${esc(s.area || '')}</span></a>
        <p>${esc(p.text)}</p>
        <div class="meta-row">${stars(p.rating)}<span class="muted">${yen(p.cost)}</span></div>
        ${inGuides.length ? `<p class="small muted">수록 가이드: ${inGuides.slice(0, 2).map(g => `<a href="#/guide/${g.id}">${esc(g.title)}</a>`).join(', ')}${inGuides.length > 2 ? ` 외 ${inGuides.length - 2}개` : ''}</p>` : ''}
      </div>
    </article>`;
  }
  function tripBanner() {
    const g = db.activeTripId && db.guides[db.activeTripId];
    if (!g) return '';
    const day = dayOf(g, new Date().toISOString());
    return `<div class="trip-banner"><span class="dot-live"></span><div><b>여행 중 · Day ${day}</b><span>${esc(g.title)}</span></div>
      <a class="btn sm light" href="#/new">지금 포스팅</a><a class="btn sm ghost-light" href="#/guide/${g.id}">가이드 보기</a></div>`;
  }

  /* ---------- 화면: 홈 피드 ---------- */
  function viewFeed() {
    const guides = guidesArr().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const posts = Object.values(db.posts).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 8);
    const first = !localStorage.getItem('routelog.intro');
    return `${tripBanner()}
    ${first ? `<section class="intro card">
      <div><h1>여행을 올리면, 가이드가 됩니다</h1>
      <p>스팟마다 사진 한 장을 올리면 시간순 여행가이드가 자동으로 완성돼요. 친구의 가이드를 <b>포크</b>해서 가게와 루트를 더하고 다시 공유해보세요.</p></div>
      <div class="row"><a class="btn" href="#/trips">여행 시작하기</a><a class="btn ghost" href="#/guide/g_tokyo3">샘플 가이드 보기</a><button class="btn ghost" data-act="dismiss-intro">닫기</button></div>
    </section>` : ''}
    <section>
      <div class="sec-head"><h2>새로 올라온 여행가이드</h2><a href="#/explore" class="small">전체 보기</a></div>
      <div class="hscroll">${guides.map(guideCard).join('')}</div>
    </section>
    <section>
      <div class="sec-head"><h2>최근 스팟 포스팅</h2></div>
      <div class="post-grid">${posts.map(postCard).join('')}</div>
    </section>`;
  }

  /* ---------- 화면: 탐색 ---------- */
  function viewExplore(q) {
    const qs = (q.get('q') || '').trim();
    const sort = q.get('sort') || 'popular';
    const cat = q.get('cat') || '';
    let list = guidesArr();
    if (qs) {
      const k = qs.toLowerCase();
      list = list.filter(g => [g.title, g.desc, g.city, ...(g.tags || []), ...g.items.map(i => (itemSpot(i) || {}).name)].join(' ').toLowerCase().includes(k));
    }
    if (cat) list = list.filter(g => g.items.some(i => (itemSpot(i) || {}).cat === cat));
    list.sort((a, b) => sort === 'forks' ? forkCount(b) - forkCount(a) : sort === 'new' ? new Date(b.createdAt) - new Date(a.createdAt) : likeCount(b) - likeCount(a));
    return `<div class="page-head"><h1>탐색</h1></div>
    <form class="search" data-form="search">
      <input class="input" name="q" value="${esc(qs)}" placeholder="도시, 스팟, 태그로 검색 (예: 시부야, 쇼핑)" aria-label="검색어">
      <select class="input" name="sort" aria-label="정렬">
        <option value="popular" ${sort === 'popular' ? 'selected' : ''}>인기순</option>
        <option value="forks" ${sort === 'forks' ? 'selected' : ''}>포크 많은 순</option>
        <option value="new" ${sort === 'new' ? 'selected' : ''}>최신순</option>
      </select>
      <button class="btn">검색</button>
    </form>
    <div class="chips-row">
      <a class="chip-btn ${!cat ? 'on' : ''}" href="#/explore?${new URLSearchParams({ q: qs, sort })}">전체</a>
      ${Object.entries(CATS).filter(([k]) => k !== 'etc').map(([k, v]) => `<a class="chip-btn ${cat === k ? 'on' : ''}" href="#/explore?${new URLSearchParams({ q: qs, sort, cat: k })}">${v.label}</a>`).join('')}
    </div>
    <div class="explore-layout">
      <div class="map-box tall" id="exploreMap"></div>
      <div class="guide-list">${list.length ? list.map(guideCard).join('') : '<p class="empty">조건에 맞는 가이드가 없어요.</p>'}</div>
    </div>`;
  }
  function mountExplore() {
    const m = makeMap($('#exploreMap'), { zoom: 11 });
    if (!m) return;
    const pts = [];
    Object.values(db.spots).forEach(s => {
      const n = guidesArr().filter(g => g.items.some(i => i.spotId === s.id)).length;
      if (!n) return;
      L.marker([s.lat, s.lng], { icon: pin(String(n), (CATS[s.cat] || CATS.etc).color) }).addTo(m)
        .bindTooltip(`${s.name} · 가이드 ${n}개`).on('click', () => { location.hash = '#/spot/' + s.id; });
      pts.push([s.lat, s.lng]);
    });
    if (pts.length) m.fitBounds(pts, { padding: [24, 24] });
  }

  /* ---------- 화면: 가이드 상세 ---------- */
  function viewGuide(id) {
    const g = db.guides[id];
    if (!g) return notFound();
    const owner = db.users[g.ownerId];
    const mine = g.ownerId === db.me;
    const parent = g.forkedFrom && db.guides[g.forkedFrom];
    const kids = children(g);
    const added = addedVsParent(g);
    const following = !!(db.progress[g.id] && db.progress[g.id].__on);
    const doneMap = db.progress[g.id] || {};
    const total = g.items.length;
    const doneN = g.items.filter(i => doneMap[i.id]).length;
    const nextIt = following ? orderedItems(g).find(i => !doneMap[i.id]) : null;
    const nextSpot = nextIt && itemSpot(nextIt);
    const totalCost = g.items.reduce((sum, it) => sum + ((itemPost(it) || {}).cost || 0), 0);
    let n = 0;

    return `<div class="guide-page">
    <div class="guide-main">
      <a class="back" href="javascript:history.back()">← 뒤로</a>
      <header class="guide-head">
        <div class="tags">${(g.tags || []).map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>
        <h1>${esc(g.title)}</h1>
        ${parent ? `<p class="fork-line big"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v2a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V7M12 13v4"/></svg>원본: <a href="#/guide/${parent.id}">${esc(db.users[parent.ownerId].name)}님의 「${esc(parent.title)}」</a>${added.size ? ` · 새로 추가한 스팟 ${added.size}곳` : ''}</p>` : (g.forkedFromTitle ? `<p class="fork-line big">원본: ${esc(g.forkedFromTitle)}</p>` : '')}
        <p>${esc(g.desc)}</p>
        <div class="meta-row">
          <a class="who" href="#/user/${owner.id}">${avatar(owner, 32)}<span><b>${esc(owner.name)}</b><small class="muted">${esc(g.city)} · ${days(g).length}일 · 스팟 ${total}곳 · 지출 약 ${yen(totalCost)}</small></span></a>
        </div>
        <div class="action-row">
          <button class="btn icon-btn ${db.likes[g.id] ? 'on' : ''}" data-act="like" data-id="${g.id}" aria-pressed="${!!db.likes[g.id]}">♥ ${likeCount(g)}</button>
          <button class="btn icon-btn ${db.saves[g.id] ? 'on' : ''}" data-act="save" data-id="${g.id}" aria-pressed="${!!db.saves[g.id]}">저장 ${saveCount(g)}</button>
          <button class="btn" data-act="fork" data-id="${g.id}" title="이 가이드를 복사해 내 버전으로 고치기">⑂ 포크해서 내 가이드로</button>
          <button class="btn ghost" data-act="follow" data-id="${g.id}">${following ? '따라가기 끄기' : '이 가이드 따라가기'}</button>
          <button class="btn ghost" data-act="share" data-id="${g.id}">공유</button>
          ${mine ? `<a class="btn ghost" href="#/guide/${g.id}/edit">편집</a>` : ''}
        </div>
      </header>

      ${following ? `<div class="follow-box">
        <div class="row between"><b>따라가기 진행 ${doneN}/${total}</b>${nextSpot ? `<a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=${nextSpot.lat},${nextSpot.lng}">다음: ${esc(nextSpot.name)} 길찾기</a>` : '<span>모든 스팟 완료!</span>'}</div>
        <div class="bar"><span style="width:${total ? Math.round(doneN / total * 100) : 0}%"></span></div>
        <p class="small muted">방문한 스팟을 체크하세요. 가게를 더 넣고 싶다면 포크해서 내 가이드로 만들면 돼요.</p>
      </div>` : ''}

      <div class="map-box mobile-only" id="guideMapM"></div>

      <ol class="timeline">
        ${days(g).map(([day, list]) => `<li class="day">
          <h2 class="day-head" style="--day:${dayColor(day)}">Day ${day}${g.startDate ? `<small>${dateOfDay(g.startDate, day)}</small>` : ''}</h2>
          <ol class="stops">
          ${list.map(({ it }) => {
            n++;
            const s = itemSpot(it), p = itemPost(it), by = db.users[it.by];
            if (!s) return '';
            const isNew = added.has(it.id);
            const done = doneMap[it.id];
            return `<li class="stop ${done ? 'done' : ''}" id="stop-${it.id}">
              <span class="num" style="--pin:${(CATS[s.cat] || CATS.etc).color}">${n}</span>
              <div class="stop-card card">
                <div class="stop-top">
                  <a href="#/spot/${s.id}" class="spot-line">${catChip(s.cat)}<b>${esc(s.name)}</b></a>
                  ${isNew ? '<span class="badge-new">포크에서 추가</span>' : ''}
                  ${following ? `<label class="check"><input type="checkbox" data-act="done" data-g="${g.id}" data-i="${it.id}" ${done ? 'checked' : ''}> 방문</label>` : ''}
                </div>
                ${p ? `<div class="stop-post">${photoBox(p, s, 'thumb')}<div>
                  <p>${esc(p.text)}</p>
                  <p class="small muted">${stars(p.rating)} ${yen(p.cost)} · ${fmtTime(p.at)}${by && by.id !== g.ownerId ? ` · ${esc(by.name)}님의 기록` : ''}</p>
                </div></div>` : ''}
                ${it.note ? `<p class="note">메모: ${esc(it.note)}</p>` : ''}
              </div>
            </li>`;
          }).join('')}
          </ol>
        </li>`).join('')}
      </ol>
      ${!g.items.length ? `<p class="empty">아직 스팟이 없어요. ${mine ? '<a href="#/new">첫 포스팅</a>을 올리면 여기에 쌓여요.' : ''}</p>` : ''}

      <section class="lineage card">
        <h2>계보</h2>
        ${lineageTree(g)}
      </section>
    </div>
    <aside class="guide-side"><div class="map-box sticky" id="guideMap"></div></aside>
    </div>`;
  }
  function dateOfDay(start, day) {
    const d = new Date(start + 'T00:00:00');
    d.setDate(d.getDate() + day - 1);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  }
  function lineageTree(g) {
    let root = g;
    while (root.forkedFrom && db.guides[root.forkedFrom]) root = db.guides[root.forkedFrom];
    const node = x => {
      const kids = children(x);
      const u = db.users[x.ownerId];
      return `<li><a href="#/guide/${x.id}" class="${x.id === g.id ? 'here' : ''}">${avatar(u, 20)} ${esc(x.title)}</a> <span class="small muted">${esc(u.name)} · 스팟 ${x.items.length}</span>
        ${kids.length ? `<ul>${kids.map(node).join('')}</ul>` : ''}</li>`;
    };
    const total = forkCount(root);
    return `<p class="small muted">원본에서 갈라져 나온 가이드 ${total}개</p><ul class="tree">${node(root)}</ul>`;
  }
  function mountGuide(id) {
    const g = db.guides[id];
    if (!g) return;
    const go = it => {
      const el = document.getElementById('stop-' + it.id);
      if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1200); }
    };
    const desktop = matchMedia('(min-width: 1024px)').matches;
    const m = makeMap(desktop ? $('#guideMap') : $('#guideMapM'));
    if (m) drawRoute(m, g, go);
  }

  /* ---------- 화면: 가이드 편집 (리믹스) ---------- */
  function viewEdit(id) {
    const g = db.guides[id];
    if (!g) return notFound();
    if (g.ownerId !== db.me) return `<p class="empty">내 가이드만 편집할 수 있어요. 먼저 포크해주세요.</p>`;
    let n = 0;
    return `<a class="back" href="#/guide/${g.id}">← 가이드로</a>
    <div class="page-head"><h1>가이드 편집</h1></div>
    <form class="card form" data-form="guide-meta" data-id="${g.id}">
      <label>제목<input class="input" name="title" value="${esc(g.title)}" required maxlength="60"></label>
      <label>소개<textarea class="input" name="desc" rows="2" maxlength="200">${esc(g.desc)}</textarea></label>
      <div class="grid2">
        <label>도시<input class="input" name="city" value="${esc(g.city)}"></label>
        <label>시작일<input class="input" type="date" name="startDate" value="${esc(g.startDate || '')}"></label>
      </div>
      <label>태그 (쉼표로 구분)<input class="input" name="tags" value="${esc((g.tags || []).join(', '))}"></label>
      <div class="row end"><button class="btn">정보 저장</button></div>
    </form>

    <div class="sec-head"><h2>스팟 순서</h2><button class="btn sm" data-act="add-spot" data-id="${g.id}">+ 가게·쇼핑·스팟 추가</button></div>
    <ul class="edit-list">
      ${days(g).map(([day, list]) => list.map(({ it, idx }) => {
        n++;
        const s = itemSpot(it);
        if (!s) return '';
        return `<li class="card edit-item">
          <span class="num" style="--pin:${(CATS[s.cat] || CATS.etc).color}">${n}</span>
          <div class="grow"><b>${esc(s.name)}</b> ${catChip(s.cat)}<br>
            <input class="input sm" data-act="note" data-g="${g.id}" data-i="${it.id}" value="${esc(it.note)}" placeholder="메모 추가 (예: 오전 10시 입장 추천)"></div>
          <label class="day-sel">Day <input class="input sm" type="number" min="1" max="30" value="${day}" data-act="setday" data-g="${g.id}" data-i="${it.id}"></label>
          <div class="btns">
            <button class="btn sm ghost" data-act="up" data-g="${g.id}" data-idx="${idx}" aria-label="위로">↑</button>
            <button class="btn sm ghost" data-act="down" data-g="${g.id}" data-idx="${idx}" aria-label="아래로">↓</button>
            <button class="btn sm danger" data-act="remove" data-g="${g.id}" data-i="${it.id}" aria-label="삭제">삭제</button>
          </div>
        </li>`;
      }).join('')).join('')}
    </ul>
    <div class="row end"><a class="btn" href="#/guide/${g.id}">완료</a><button class="btn danger ghost" data-act="delete-guide" data-id="${g.id}">가이드 삭제</button></div>`;
  }

  function openAddSpot(gid) {
    const g = db.guides[gid];
    const maxDay = Math.max(1, ...g.items.map(i => i.day));
    openModal(`<h2>스팟 추가</h2>
      <form class="form" data-form="add-spot" data-id="${gid}">
        <label>기존 스팟에서 고르기
          <select class="input" name="existing"><option value="">새 스팟 직접 입력</option>
          ${Object.values(db.spots).sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(s => `<option value="${s.id}">${esc(s.name)} (${esc(s.area)})</option>`).join('')}</select></label>
        <div class="new-spot">
          <div class="grid2"><label>이름<input class="input" name="name" placeholder="예: 돈키호테 시부야점"></label>
          <label>종류<select class="input" name="cat">${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label></div>
          <p class="small muted">지도를 눌러 위치를 정하세요.</p>
          <div class="map-box small-map" id="pickMap"></div>
          <input type="hidden" name="lat"><input type="hidden" name="lng">
        </div>
        <div class="grid2"><label>Day<input class="input" type="number" name="day" min="1" max="30" value="${maxDay}"></label>
        <label>메모<input class="input" name="note" placeholder="왜 추천하나요?"></label></div>
        <div class="row end"><button type="button" class="btn ghost" data-close>취소</button><button class="btn">추가</button></div>
      </form>`);
    const m = makeMap($('#pickMap'), { zoom: 12 });
    if (m) attachPicker(m, $('#modal form'));
    $('#modal select[name=existing]').addEventListener('change', e => {
      $('#modal .new-spot').style.display = e.target.value ? 'none' : '';
    });
  }
  function attachPicker(m, form, start) {
    let mk = null;
    const set = (lat, lng) => {
      form.lat.value = lat.toFixed(6); form.lng.value = lng.toFixed(6);
      if (mk) mk.setLatLng([lat, lng]); else mk = L.marker([lat, lng], { draggable: true, icon: pin('●', '#0f766e', true) }).addTo(m).on('dragend', e => { const p = e.target.getLatLng(); set(p.lat, p.lng); });
    };
    m.on('click', e => set(e.latlng.lat, e.latlng.lng));
    if (start) { set(start[0], start[1]); m.setView(start, 15); }
    return set;
  }

  /* ---------- 화면: 포스팅 ---------- */
  function viewNew() {
    const mine = guidesArr().filter(g => g.ownerId === db.me);
    const active = db.activeTripId;
    const now = new Date();
    const local = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    return `<div class="page-head"><h1>스팟 포스팅</h1><p class="muted">사진 한 장과 한 줄이면 충분해요. 올리면 선택한 가이드에 시간순으로 쌓여요.</p></div>
    <form class="card form" data-form="post">
      <label class="photo-drop" id="photoDrop">
        <input type="file" accept="image/*" name="photo" hidden>
        <span id="photoPreview" class="photo-preview"><b>사진 추가</b><small>탭해서 사진 선택</small></span>
      </label>
      <div class="grid2">
        <label>스팟 이름<input class="input" name="name" required placeholder="예: 시부야 스카이 전망대" list="spotNames"></label>
        <label>종류<select class="input" name="cat">${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
      </div>
      <datalist id="spotNames">${Object.values(db.spots).map(s => `<option value="${esc(s.name)}">`).join('')}</datalist>
      <div class="row between"><span class="small muted" id="locLabel">지도를 눌러 위치를 정하거나 현재 위치를 쓰세요.</span><button type="button" class="btn sm ghost" data-act="geo">현재 위치</button></div>
      <div class="map-box small-map" id="postMap"></div>
      <input type="hidden" name="lat"><input type="hidden" name="lng">
      <label>한 줄 기록<textarea class="input" name="text" rows="3" maxlength="300" placeholder="여기서 뭐가 좋았나요? 다음 사람을 위한 팁도요."></textarea></label>
      <div class="grid3">
        <label>별점<select class="input" name="rating"><option value="5">★★★★★</option><option value="4">★★★★</option><option value="3">★★★</option><option value="2">★★</option><option value="1">★</option></select></label>
        <label>쓴 돈 (엔)<input class="input" type="number" name="cost" min="0" step="10" placeholder="0"></label>
        <label>방문 시각<input class="input" type="datetime-local" name="at" value="${local}"></label>
      </div>
      <label>태그 (쉼표로 구분)<input class="input" name="tags" placeholder="야경, 예약필수"></label>
      <label>담을 가이드
        <select class="input" name="guide">
          <option value="__new">새 여행 가이드 만들기</option>
          ${mine.map(g => `<option value="${g.id}" ${g.id === active ? 'selected' : ''}>${esc(g.title)}${g.id === active ? ' (여행 중)' : ''}</option>`).join('')}
          <option value="__none" ${!mine.length ? '' : ''}>가이드에 넣지 않기</option>
        </select></label>
      <div class="row end"><button class="btn big">올리기</button></div>
    </form>`;
  }
  let postPicker = null;
  function mountNew() {
    const form = $('form[data-form=post]');
    const m = makeMap($('#postMap'), { zoom: 12 });
    if (m) postPicker = attachPicker(m, form);
    const input = form.photo;
    input.addEventListener('change', async () => {
      const f = input.files[0];
      if (!f) return;
      try {
        const data = await resizeImage(f, 900, 0.72);
        form.dataset.photo = data;
        $('#photoPreview').innerHTML = `<img src="${data}" alt="미리보기">`;
      } catch (e) { toast('사진을 읽지 못했어요.'); }
    });
    form.name.addEventListener('change', () => {
      const s = Object.values(db.spots).find(x => x.name === form.name.value.trim());
      if (s && postPicker && m) { form.cat.value = s.cat; postPicker(s.lat, s.lng); m.setView([s.lat, s.lng], 15); $('#locLabel').textContent = '저장된 스팟 위치를 불러왔어요.'; }
    });
  }
  function resizeImage(file, max, q) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        const r = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', q));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  /* ---------- 화면: 내 여행 ---------- */
  function viewTrips() {
    const mine = guidesArr().filter(g => g.ownerId === db.me).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const saved = guidesArr().filter(g => db.saves[g.id]);
    const following = guidesArr().filter(g => db.progress[g.id] && db.progress[g.id].__on);
    const active = db.activeTripId && db.guides[db.activeTripId];
    const today = new Date().toISOString().slice(0, 10);
    return `<div class="page-head"><h1>내 여행</h1></div>
    ${active ? tripBanner() + `<div class="row end"><button class="btn ghost" data-act="end-trip">여행 끝내기</button></div>` : `
    <form class="card form" data-form="start-trip">
      <h2>여행 시작하기</h2>
      <p class="muted small">여행 모드를 켜면 이후 포스팅이 이 가이드에 날짜별로 자동으로 쌓여요.</p>
      <div class="grid3">
        <label>여행 이름<input class="input" name="title" required placeholder="예: 10월 도쿄 먹방 여행"></label>
        <label>도시<input class="input" name="city" value="도쿄"></label>
        <label>시작일<input class="input" type="date" name="startDate" value="${today}"></label>
      </div>
      <div class="row end"><button class="btn">여행 모드 켜기</button></div>
    </form>`}
    ${following.length ? `<section><div class="sec-head"><h2>따라가는 중</h2></div><div class="card-grid">${following.map(guideCard).join('')}</div></section>` : ''}
    <section><div class="sec-head"><h2>내 가이드</h2></div>
      ${mine.length ? `<div class="card-grid">${mine.map(guideCard).join('')}</div>` : '<p class="empty">아직 내 가이드가 없어요. 여행을 시작하거나 마음에 드는 가이드를 포크해보세요.</p>'}</section>
    <section><div class="sec-head"><h2>저장한 가이드</h2></div>
      ${saved.length ? `<div class="card-grid">${saved.map(guideCard).join('')}</div>` : '<p class="empty">저장한 가이드가 없어요.</p>'}</section>`;
  }

  /* ---------- 화면: 프로필 / 사용자 ---------- */
  function viewUser(id) {
    const u = db.users[id];
    if (!u) return notFound();
    const isMe = id === db.me;
    const gs = guidesArr().filter(g => g.ownerId === id);
    const ps = Object.values(db.posts).filter(p => p.userId === id).sort((a, b) => new Date(b.at) - new Date(a.at));
    const forksOfMine = gs.reduce((s, g) => s + forkCount(g), 0);
    return `<section class="profile card">
      ${avatar(u, 72)}
      <div class="grow">
        <h1>${esc(u.name)}${u.sample ? ' <span class="tag">샘플</span>' : ''}</h1>
        <p class="muted">${esc(u.bio || (isMe ? '소개를 적어보세요.' : ''))}</p>
        <div class="stats big"><span><b>${gs.length}</b> 가이드</span><span><b>${ps.length}</b> 포스팅</span><span><b>${forksOfMine}</b> 포크됨</span></div>
      </div>
      ${isMe ? `<button class="btn ghost" data-act="edit-profile">프로필 수정</button>` : `<button class="btn ${db.follows[id] ? 'ghost' : ''}" data-act="follow-user" data-id="${id}">${db.follows[id] ? '팔로잉' : '팔로우'}</button>`}
    </section>
    <section><div class="sec-head"><h2>가이드</h2></div>
      ${gs.length ? `<div class="card-grid">${gs.map(guideCard).join('')}</div>` : '<p class="empty">아직 가이드가 없어요.</p>'}</section>
    <section><div class="sec-head"><h2>포스팅</h2></div>
      ${ps.length ? `<div class="post-grid">${ps.map(postCard).join('')}</div>` : '<p class="empty">아직 포스팅이 없어요.</p>'}</section>
    ${isMe ? `<section class="card pad"><h2>데이터</h2><p class="small muted">이 프로토타입은 서버 없이 이 브라우저에만 저장돼요. 다른 사람과는 공유 링크로 가이드를 주고받아요.</p>
      <div class="row"><button class="btn ghost" data-act="reset">샘플 데이터로 초기화</button></div></section>` : ''}`;
  }

  /* ---------- 화면: 스팟 ---------- */
  function viewSpot(id) {
    const s = db.spots[id];
    if (!s) return notFound();
    const ps = Object.values(db.posts).filter(p => p.spotId === id).sort((a, b) => new Date(b.at) - new Date(a.at));
    const gs = guidesArr().filter(g => g.items.some(i => i.spotId === id));
    const avg = ps.length ? (ps.reduce((a, p) => a + (p.rating || 0), 0) / ps.length).toFixed(1) : '-';
    return `<a class="back" href="javascript:history.back()">← 뒤로</a>
    <section class="card pad spot-head">
      <div>${catChip(s.cat)}<h1>${esc(s.name)}</h1><p class="muted">${esc(s.area)} · 평균 ★ ${avg} · 포스팅 ${ps.length} · 가이드 ${gs.length}</p>
      ${ps[0] ? `<p class="small muted">최근 방문 기록: ${ago(ps[0].at)}</p>` : ''}
      <div class="row"><a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}">지도 앱에서 열기</a></div></div>
      <div class="map-box small-map" id="spotMap"></div>
    </section>
    <section><div class="sec-head"><h2>이 스팟이 들어간 가이드</h2></div><div class="card-grid">${gs.map(guideCard).join('') || '<p class="empty">아직 없어요.</p>'}</div></section>
    <section><div class="sec-head"><h2>방문 기록</h2></div><div class="post-grid">${ps.map(postCard).join('') || '<p class="empty">아직 없어요.</p>'}</div></section>`;
  }
  function mountSpot(id) {
    const s = db.spots[id];
    const m = makeMap($('#spotMap'), { center: [s.lat, s.lng], zoom: 15 });
    if (m) L.marker([s.lat, s.lng], { icon: pin('●', (CATS[s.cat] || CATS.etc).color, true) }).addTo(m);
  }

  /* ---------- 화면: 공유 링크 가져오기 ---------- */
  let importCache = null;
  function viewImport() {
    return `<div class="card pad center" id="importBox"><p>공유받은 가이드를 여는 중…</p></div>`;
  }
  async function mountImport(code) {
    const box = $('#importBox');
    try {
      const data = await unpackGuide(code);
      importCache = data;
      const g = data.g, owner = data.us[g.ownerId];
      const exists = db.guides[g.id];
      box.innerHTML = `<h1>${esc(owner.name)}님이 여행가이드를 공유했어요</h1>
        <h2>${esc(g.title)}</h2>
        <p class="muted">${esc(g.city)} · 스팟 ${g.items.length}곳${data.parent ? ` · 원본 「${esc(data.parent.title)}」` : ''}</p>
        <p>${esc(g.desc)}</p>
        <div class="row center">${exists ? `<a class="btn" href="#/guide/${g.id}">가이드 열기</a>` : `<button class="btn" data-act="import">내 앱에 담고 보기</button>`}</div>
        <p class="small muted">사진은 링크에 담기지 않아요. 스팟·순서·기록은 그대로 옮겨져요.</p>`;
    } catch (e) {
      box.innerHTML = '<h2>링크를 열 수 없어요</h2><p class="muted">링크가 잘렸거나 손상됐을 수 있어요.</p><a class="btn" href="#/">홈으로</a>';
    }
  }
  function doImport() {
    const d = importCache;
    if (!d) return;
    Object.values(d.us).forEach(u => { if (u && u.id !== 'u_me' && !db.users[u.id]) db.users[u.id] = u; });
    // 상대방의 '나'(u_me)는 내 계정과 겹치지 않게 별도 사용자로 옮긴다
    const remap = id => id === 'u_me' ? 'u_friend_' + d.g.id : id;
    if (Object.values(d.us).some(u => u && u.id === 'u_me')) {
      const src = d.us.u_me;
      db.users[remap('u_me')] = { id: remap('u_me'), name: src.name === '나' ? '친구' : src.name, bio: '', color: '#0891b2' };
    }
    Object.values(d.ss).forEach(s => { if (s && !db.spots[s.id]) db.spots[s.id] = s; });
    Object.values(d.ps).forEach(p => { if (p && !db.posts[p.id]) db.posts[p.id] = { ...p, userId: remap(p.userId) }; });
    const g = { ...d.g, ownerId: remap(d.g.ownerId), items: d.g.items.map(i => ({ ...i, by: remap(i.by) })), baseLikes: d.g.baseLikes || 0, baseSaves: d.g.baseSaves || 0 };
    if (g.forkedFrom && !db.guides[g.forkedFrom] && d.parent) g.forkedFromTitle = `${(d.us[d.parent.ownerId] || {}).name || ''}님의 「${d.parent.title}」`;
    db.guides[g.id] = g;
    save();
    location.hash = '#/guide/' + g.id;
    toast('가이드를 담았어요. 포크해서 내 버전으로 고쳐보세요.');
  }

  function notFound() { return '<div class="card pad center"><h2>찾을 수 없어요</h2><a class="btn" href="#/">홈으로</a></div>'; }

  /* ---------- 모달 ---------- */
  function openModal(html) {
    const m = $('#modal');
    m.innerHTML = `<div class="modal-back" data-close></div><div class="modal-card" role="dialog" aria-modal="true">${html}</div>`;
    m.hidden = false;
    document.body.classList.add('no-scroll');
    const f = m.querySelector('input, select, textarea, button');
    if (f) f.focus();
  }
  function closeModal() {
    const m = $('#modal');
    m.hidden = true; m.innerHTML = '';
    document.body.classList.remove('no-scroll');
  }

  /* ---------- 라우터 ---------- */
  function route(keep) {
    const sy = window.scrollY;
    clearMaps();
    closeModal();
    const raw = location.hash.slice(1) || '/';
    const [path, qstr] = raw.split('?');
    const q = new URLSearchParams(qstr || '');
    const parts = path.split('/').filter(Boolean);
    const app = $('#app');
    let html = '', mount = null, nav = '';

    if (!parts.length) { html = viewFeed(); nav = 'feed'; }
    else if (parts[0] === 'explore') { html = viewExplore(q); mount = mountExplore; nav = 'explore'; }
    else if (parts[0] === 'new') { html = viewNew(); mount = mountNew; nav = 'new'; }
    else if (parts[0] === 'trips') { html = viewTrips(); nav = 'trips'; }
    else if (parts[0] === 'me') { html = viewUser(db.me); nav = 'me'; }
    else if (parts[0] === 'user') { html = viewUser(parts[1]); nav = parts[1] === db.me ? 'me' : ''; }
    else if (parts[0] === 'spot') { html = viewSpot(parts[1]); mount = db.spots[parts[1]] ? () => mountSpot(parts[1]) : null; }
    else if (parts[0] === 'guide' && parts[2] === 'edit') { html = viewEdit(parts[1]); nav = 'trips'; }
    else if (parts[0] === 'guide') { html = viewGuide(parts[1]); mount = () => mountGuide(parts[1]); }
    else if (parts[0] === 'import') { html = viewImport(); mount = () => mountImport(parts.slice(1).join('/')); }
    else html = notFound();

    renderNav(nav);
    app.innerHTML = html;
    if (mount) mount();
    window.scrollTo(0, keep === true ? sy : 0);
  }

  /* ---------- 이벤트 ---------- */
  document.addEventListener('click', async e => {
    const closer = e.target.closest('[data-close]');
    if (closer) { e.preventDefault(); closeModal(); return; }
    const el = e.target.closest('[data-act]');
    if (!el || el.matches('input')) return;
    const act = el.dataset.act;
    const id = el.dataset.id;
    switch (act) {
      case 'dismiss-intro':
        try { localStorage.setItem('routelog.intro', '1'); } catch (_) { /* noop */ }
        el.closest('.intro').remove();
        break;
      case 'like':
        db.likes[id] = !db.likes[id]; save(); route(true); break;
      case 'save':
        db.saves[id] = !db.saves[id]; save(); route(true);
        toast(db.saves[id] ? '내 여행에 저장했어요.' : '저장을 취소했어요.');
        break;
      case 'fork': {
        const ng = fork(db.guides[id]);
        toast('포크했어요. 스팟을 더하거나 순서를 바꿔보세요.');
        location.hash = '#/guide/' + ng.id + '/edit';
        break;
      }
      case 'follow': {
        const p = db.progress[id] || (db.progress[id] = {});
        p.__on = !p.__on; save(); route(true);
        if (p.__on) toast('따라가기를 시작했어요. 방문한 스팟을 체크하세요.');
        break;
      }
      case 'share': shareGuide(db.guides[id]); break;
      case 'up': case 'down': {
        const g = db.guides[el.dataset.g];
        const ordered = orderedItems(g);
        const it = g.items[Number(el.dataset.idx)];
        const pos = ordered.indexOf(it);
        const swap = ordered[act === 'up' ? pos - 1 : pos + 1];
        if (!swap) break;
        if (swap.day !== it.day) { it.day = swap.day; }
        else {
          const a = g.items.indexOf(it), b = g.items.indexOf(swap);
          [g.items[a], g.items[b]] = [g.items[b], g.items[a]];
        }
        g.items = orderedItems(g);
        save(); route(true);
        break;
      }
      case 'remove': {
        const g = db.guides[el.dataset.g];
        g.items = g.items.filter(i => i.id !== el.dataset.i);
        save(); route(true); toast('스팟을 뺐어요.');
        break;
      }
      case 'add-spot': openAddSpot(id); break;
      case 'delete-guide':
        if (confirm('이 가이드를 삭제할까요? 포스팅은 남아요.')) {
          children(db.guides[id]).forEach(c => { c.forkedFromTitle = db.guides[id].title; });
          delete db.guides[id];
          if (db.activeTripId === id) db.activeTripId = null;
          save(); location.hash = '#/trips';
        }
        break;
      case 'end-trip':
        db.activeTripId = null; save(); route(); toast('여행을 마쳤어요. 가이드를 공유해보세요!'); break;
      case 'geo':
        if (!navigator.geolocation) { toast('이 브라우저는 위치를 지원하지 않아요.'); break; }
        navigator.geolocation.getCurrentPosition(pos => {
          const { latitude, longitude } = pos.coords;
          if (postPicker) postPicker(latitude, longitude);
          const m = maps[maps.length - 1];
          if (m) m.setView([latitude, longitude], 16);
          $('#locLabel').textContent = '현재 위치를 넣었어요. 핀을 끌어 조정할 수 있어요.';
        }, () => toast('위치 권한이 없어 지도로 직접 골라주세요.'), { enableHighAccuracy: true, timeout: 8000 });
        break;
      case 'follow-user':
        db.follows[id] = !db.follows[id]; save(); route(true); break;
      case 'edit-profile': {
        const u = me();
        openModal(`<h2>프로필 수정</h2><form class="form" data-form="profile">
          <label>이름<input class="input" name="name" value="${esc(u.name)}" maxlength="20" required></label>
          <label>소개<input class="input" name="bio" value="${esc(u.bio)}" maxlength="80"></label>
          <div class="row end"><button type="button" class="btn ghost" data-close>취소</button><button class="btn">저장</button></div></form>`);
        break;
      }
      case 'reset':
        if (confirm('내가 만든 가이드와 포스팅이 모두 지워지고 샘플 데이터로 돌아가요. 계속할까요?')) {
          db = window.RL_SEED(); save(); location.hash = '#/'; route();
        }
        break;
      case 'import': doImport(); break;
    }
  });

  document.addEventListener('change', e => {
    const el = e.target;
    const act = el.dataset && el.dataset.act;
    if (!act) return;
    if (act === 'done') {
      const p = db.progress[el.dataset.g] || (db.progress[el.dataset.g] = { __on: true });
      p[el.dataset.i] = el.checked; save(); route(true);
      const g = db.guides[el.dataset.g];
      if (g.items.every(i => p[i.id])) toast('가이드 완주! 포크해서 내 기록을 더해 공유해보세요.');
    } else if (act === 'note' || act === 'setday') {
      const g = db.guides[el.dataset.g];
      const it = g.items.find(i => i.id === el.dataset.i);
      if (act === 'note') it.note = el.value.trim();
      else { it.day = Math.max(1, Math.min(30, parseInt(el.value, 10) || 1)); g.items = orderedItems(g); }
      save();
      if (act === 'setday') route(true); else toast('메모를 저장했어요.');
    }
  });

  document.addEventListener('submit', e => {
    const f = e.target;
    const kind = f.dataset.form;
    if (!kind) return;
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f).entries());
    if (kind === 'search') {
      location.hash = '#/explore?' + new URLSearchParams({ q: v.q, sort: v.sort });
    } else if (kind === 'start-trip') {
      const g = {
        id: uid('g'), ownerId: db.me, title: v.title.trim(), city: v.city.trim() || '도쿄', desc: '',
        startDate: v.startDate, forkedFrom: null, createdAt: new Date().toISOString(), baseLikes: 0, baseSaves: 0, tags: [], items: []
      };
      db.guides[g.id] = g; db.activeTripId = g.id; save();
      toast('여행 모드를 켰어요. 스팟에 도착하면 포스팅하세요!');
      location.hash = '#/new';
    } else if (kind === 'guide-meta') {
      const g = db.guides[f.dataset.id];
      Object.assign(g, { title: v.title.trim(), desc: v.desc.trim(), city: v.city.trim(), startDate: v.startDate, tags: v.tags.split(',').map(t => t.trim()).filter(Boolean) });
      save(); toast('저장했어요.');
    } else if (kind === 'profile') {
      Object.assign(me(), { name: v.name.trim() || '나', bio: v.bio.trim() });
      save(); closeModal(); route();
    } else if (kind === 'add-spot') {
      const g = db.guides[f.dataset.id];
      let s;
      if (v.existing) s = db.spots[v.existing];
      else {
        if (!v.name.trim()) { toast('스팟 이름을 적어주세요.'); return; }
        if (!v.lat) { toast('지도를 눌러 위치를 정해주세요.'); return; }
        s = findOrCreateSpot({ name: v.name, cat: v.cat, lat: +v.lat, lng: +v.lng, area: g.city });
      }
      g.items.push({ id: uid('i'), postId: null, spotId: s.id, day: Math.max(1, parseInt(v.day, 10) || 1), note: v.note.trim(), by: db.me });
      g.items = orderedItems(g);
      save(); closeModal(); route(true); toast(`「${s.name}」을 추가했어요.`);
    } else if (kind === 'post') {
      if (!v.lat) { toast('지도를 눌러 위치를 정해주세요.'); return; }
      const at = v.at ? new Date(v.at).toISOString() : new Date().toISOString();
      let gid = v.guide;
      if (gid === '__new') {
        const g = {
          id: uid('g'), ownerId: db.me, title: `${v.name.trim()}에서 시작한 여행`, city: '도쿄', desc: '',
          startDate: at.slice(0, 10), forkedFrom: null, createdAt: new Date().toISOString(), baseLikes: 0, baseSaves: 0, tags: [], items: []
        };
        db.guides[g.id] = g; db.activeTripId = g.id; gid = g.id;
      }
      const s = findOrCreateSpot({ name: v.name, cat: v.cat, lat: +v.lat, lng: +v.lng, area: '' });
      const p = {
        id: uid('p'), userId: db.me, spotId: s.id, at, text: v.text.trim(), rating: +v.rating, cost: +v.cost || 0,
        tags: v.tags.split(',').map(t => t.trim()).filter(Boolean), photo: f.dataset.photo || null
      };
      db.posts[p.id] = p;
      if (gid !== '__none') {
        const g = db.guides[gid];
        g.items.push({ id: uid('i'), postId: p.id, spotId: s.id, day: dayOf(g, at), note: '', by: db.me });
        // 같은 날 안에서는 방문 시각 순으로 정렬
        g.items.sort((a, b) => a.day - b.day || ((itemPost(a) || {}).at || '').localeCompare((itemPost(b) || {}).at || ''));
      }
      if (!save() && p.photo) { p.photo = null; save(); }
      toast(gid !== '__none' ? '올렸어요. 가이드에 추가됐어요.' : '올렸어요.');
      location.hash = gid !== '__none' ? '#/guide/' + gid : '#/';
    }
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });
  window.addEventListener('hashchange', route);
  let lastWide = matchMedia('(min-width: 1024px)').matches;
  window.addEventListener('resize', () => {
    const wide = matchMedia('(min-width: 1024px)').matches;
    if (wide !== lastWide && /^#\/guide\/[^/]+$/.test(location.hash)) { lastWide = wide; route(); }
    lastWide = wide;
  });
  save();
  route();
})();
