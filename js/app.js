/* 루트로그 RouteLog: 포스팅이 여행가이드가 되고, 가이드를 포크해 다시 공유하는 여행 SNS */
(function () {
  'use strict';

  const CFG = window.RL_CONFIG || {};
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
  const VIS = { public: '전체 공개', link: '링크가 있는 사람만', private: '나만 보기' };
  const REPORT_REASONS = ['스팸·광고', '허위 정보', '음란·폭력·혐오', '저작권 침해(남의 사진·글)', '개인정보·위치 노출', '기타'];

  /* ---------- 저장소 ----------
   * 로컬 모드: 모든 데이터가 이 브라우저 localStorage 에 있다 (샘플 데이터로 시작).
   * 서버 모드: config.js 에 Supabase 키가 있으면 cloud.js 가 서버에서 읽고 쓴다. db 는 화면용 캐시다. */
  let cloud = null;
  let db = null;
  const emptyDb = () => ({ version: 1, me: null, users: {}, spots: {}, posts: {}, guides: {}, likes: {}, saves: {}, follows: {}, progress: {}, blocks: {}, activeTripId: null, seq: 100 });
  function loadLocal() {
    try {
      const raw = localStorage.getItem(DB_KEY);
      if (raw) return Object.assign(emptyDb(), JSON.parse(raw));
    } catch (e) { /* 저장소 접근 불가: 샘플로 시작 */ }
    return Object.assign(emptyDb(), window.RL_SEED());
  }
  function save() {
    if (cloud) return true;
    try { localStorage.setItem(DB_KEY, JSON.stringify(db)); return true; } catch (e) {
      toast('기기 저장 공간이 부족해요. 사진 수를 줄여주세요.');
      return false;
    }
  }
  // 서버 쓰기 결과 처리: 화면은 먼저 바꾸고, 실패하면 알려준다
  function push(p) {
    if (!p || !p.then) return p;
    return p.catch(err => {
      console.error(err);
      toast(navigator.onLine === false ? '오프라인이에요. 연결되면 다시 시도해주세요.' : '서버에 저장하지 못했어요. 잠시 후 다시 시도해주세요.');
      throw err;
    });
  }
  const quiet = p => { if (p && p.catch) p.catch(() => {}); };
  const uid = p => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : p + '_' + Date.now().toString(36) + (db.seq++).toString(36);
  const me = () => db.me ? db.users[db.me] : null;

  /* ---------- 유틸 ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const yen = n => n ? '¥' + Number(n).toLocaleString('ko-KR') : '무료';
  function fmtTime(iso) {
    // 현지 시차가 적힌 기록(예: +09:00)은 그 현지 시각 그대로 보여준다
    const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d).*([+-]\d\d:\d\d)$/.exec(iso || '');
    if (m && m[6] !== '+00:00') return `${+m[2]}월 ${+m[3]}일 ${m[4]}:${m[5]}`;
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
  /* 비밀번호 규칙: KISA 권고 수준(문자 종류 조합 + 길이)에 흔한 패턴 차단을 더했다. 서버(Supabase)에도 최소 길이·문자 조건을 같이 건다. */
  const COMMON_PW = ['password', 'passwd', 'qwerty', 'asdf', 'zxcv', '1q2w3e', 'q1w2e3', 'iloveyou', 'admin', 'letmein', 'welcome', 'routelog', 'abc123', '123qwe', 'qwe123', 'p@ssw0rd', 'passw0rd'];
  function passwordRules(pw, email) {
    pw = pw || '';
    const low = pw.toLowerCase();
    const id = String(email || '').split('@')[0].toLowerCase();
    let seq = false;
    for (let i = 0; i + 3 < low.length; i++) {
      const c = [0, 1, 2, 3].map(k => low.charCodeAt(i + k));
      if (c.every((x, k) => !k || x - c[k - 1] === 1) || c.every((x, k) => !k || x - c[k - 1] === -1)) { seq = true; break; }
    }
    return [
      { ok: pw.length >= 10 && pw.length <= 72, text: '10자 이상' },
      { ok: /[a-z]/i.test(pw) && /\d/.test(pw) && /[^a-z0-9\s]/i.test(pw), text: '영문, 숫자, 특수문자를 모두 포함' },
      { ok: pw.length > 0 && !/(.)\1\1/.test(pw) && !seq, text: '같은 문자 3번 반복이나 1234·abcd 같은 연속 문자 없음' },
      { ok: pw.length > 0 && !(id.length >= 3 && low.includes(id)) && !COMMON_PW.some(w => low.includes(w)) && !/\s/.test(pw), text: '이메일 아이디, 흔한 단어(password, qwerty 등), 공백 없음' }
    ];
  }
  const passwordOk = (pw, email) => passwordRules(pw, email).every(r => r.ok);
  function pwRulesHtml(pw, email) {
    return passwordRules(pw, email).map(r => `<li class="${r.ok ? 'ok' : ''}">${r.ok ? '✓' : '·'} ${esc(r.text)}</li>`).join('');
  }
  function pwFields(label) {
    return `<label>${label}<input class="input" type="password" name="password" required minlength="10" maxlength="72" autocomplete="new-password" data-pw></label>
      <ul class="pw-rules" aria-live="polite">${pwRulesHtml('', '')}</ul>
      <label>비밀번호 확인<input class="input" type="password" name="password2" required minlength="10" maxlength="72" autocomplete="new-password"></label>`;
  }
  function passwordError(err) {
    const m = (err && ((err.code || '') + ' ' + (err.message || ''))) || '';
    if (/weak|short|characters|pwned|leaked/i.test(m)) return '서버에서 비밀번호가 약하다고 판단했어요. 규칙에 맞게 더 길고 복잡하게 정해주세요.';
    if (/same/i.test(m)) return '지금 비밀번호와 같아요.';
    if (/reauth/i.test(m)) return '보안을 위해 다시 로그인한 뒤 바꿔주세요.';
    return '비밀번호를 저장하지 못했어요.';
  }
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }
  function avatar(u, size = 36) {
    u = u || { name: '?', color: '#94a3b8' };
    return `<span class="avatar" style="--av:${esc(u.color)};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px">${esc((u.name || '?').slice(0, 1))}</span>`;
  }
  const userOf = id => db.users[id] || { id, name: '알 수 없음', color: '#94a3b8', bio: '' };
  function catChip(cat) {
    const c = CATS[cat] || CATS.etc;
    return `<span class="chip" style="--chip:${c.color}">${c.label}</span>`;
  }
  function photoBox(post, spot, cls = '') {
    if (post && post.photo) return `<img class="photo ${cls}" src="${esc(post.photo)}" alt="${esc(spot.name)} 사진" loading="lazy">`;
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
  const forkIcon = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="12" cy="19" r="2"/><path d="M6 7v2a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V7M12 13v4"/></svg>';

  /* ---------- 로그인·동의 확인 ---------- */
  function needsConsent() { return !!(cloud && db.me && me() && !me().termsAgreedAt); }
  // 쓰기 전에 호출: 로그인과 약관 동의가 안 돼 있으면 안내 화면으로 보낸다
  function requireAuth() {
    if (!cloud) return true;
    if (!db.me) {
      sessionStorageSet('routelog.next', location.hash);
      location.hash = '#/login';
      toast('로그인하면 이용할 수 있어요.');
      return false;
    }
    if (needsConsent()) { location.hash = '#/welcome'; return false; }
    return true;
  }
  function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { /* noop */ } }
  function sessionStorageTake(k) { try { const v = sessionStorage.getItem(k); sessionStorage.removeItem(k); return v; } catch (e) { return null; } }

  /* ---------- 도메인 ---------- */
  const guidesArr = () => Object.values(db.guides);
  const isMine = g => g.ownerId === db.me;
  // 목록에 보여도 되는 가이드: 공개 + 차단하지 않은 작성자 + 숨김 아님 (내 것은 항상)
  const listable = g => isMine(g) || (g.visibility !== 'private' && g.visibility !== 'link' && !g.hidden && !db.blocks[g.ownerId]);
  const postVisible = p => p && (p.userId === db.me || (!p.hidden && !db.blocks[p.userId]));
  const children = g => guidesArr().filter(x => x.forkedFrom === g.id && listable(x));
  function likeCount(g) { return (g.baseLikes || 0) + (db.likes[g.id] ? 1 : 0); }
  function saveCount(g) { return (g.baseSaves || 0) + (db.saves[g.id] ? 1 : 0); }
  function forkCount(g) {
    let n = 0;
    const seen = new Set();
    const walk = id => guidesArr().forEach(x => { if (x.forkedFrom === id && !seen.has(x.id)) { seen.add(x.id); if (listable(x)) n++; walk(x.id); } });
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
  const orderedItems = g => days(g).flatMap(([, list]) => list.map(x => x.it));
  const itemSpot = it => db.spots[it.spotId];
  const itemPost = it => {
    const p = it.postId ? db.posts[it.postId] : null;
    return postVisible(p) ? p : null;
  };
  function addedVsParent(g) {
    if (!g.forkedFrom || !db.guides[g.forkedFrom]) return new Set();
    const parentSpots = new Set(db.guides[g.forkedFrom].items.map(i => i.spotId));
    return new Set(g.items.filter(i => !parentSpots.has(i.spotId)).map(i => i.id));
  }
  function coverOf(g) {
    const withPhoto = g.items.map(itemPost).find(p => p && p.photo);
    const first = g.items.find(itemSpot);
    return { post: withPhoto || (first && itemPost(first)), spot: withPhoto ? db.spots[withPhoto.spotId] : (first ? itemSpot(first) : { name: g.title, cat: 'etc' }) };
  }
  function dayOf(g, iso) {
    if (!g.startDate) return 1;
    const start = new Date(g.startDate + 'T00:00:00');
    const d = new Date(iso);
    const n = Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()) - start) / 86400000) + 1;
    return Math.min(60, Math.max(1, n));
  }
  function newGuide(fields) {
    return Object.assign({
      id: uid('g'), ownerId: db.me, title: '', city: '도쿄', desc: '', startDate: new Date().toISOString().slice(0, 10),
      forkedFrom: null, createdAt: new Date().toISOString(), baseLikes: 0, baseSaves: 0, tags: [], items: [], visibility: 'public'
    }, fields);
  }
  function fork(g) {
    const ng = newGuide({
      title: (g.title + ' (내 버전)').slice(0, 60), city: g.city, forkedFrom: g.id,
      forkedFromTitle: `${userOf(g.ownerId).name}님의 「${g.title}」`.slice(0, 120), tags: [...(g.tags || [])],
      items: g.items.filter(itemSpot).map(it => ({ ...it, id: uid('i') }))
    });
    db.guides[ng.id] = ng;
    save();
    return ng;
  }
  function findOrCreateSpot({ name, cat, lat, lng, area }) {
    const near = Object.values(db.spots).find(s => s.name.trim() === name.trim() && distM(s, { lat, lng }) < 300);
    if (near) return { spot: near, created: false };
    const s = { id: uid('s'), name: name.trim().slice(0, 80), cat, lat, lng, area: (area || '').slice(0, 40) };
    db.spots[s.id] = s;
    return { spot: s, created: true };
  }
  const syncGuide = g => cloud && push(cloud.saveGuide(g));

  /* ---------- 공유 ----------
   * 서버 모드: 가이드 주소를 그대로 공유한다.
   * 로컬 모드: 가이드 전체를 압축해 주소에 담는다 (사진 제외). */
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
    if (parent) us[parent.ownerId] = db.users[parent.ownerId];
    const payload = { v: 1, g, ps, ss, us, parent: parent ? { id: parent.id, title: parent.title, ownerId: parent.ownerId } : null };
    let bytes = new TextEncoder().encode(JSON.stringify(payload));
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
    const bin = atob(str.slice(1).replace(/-/g, '+').replace(/_/g, '/'));
    let bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    if (tag === 'z') {
      const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      bytes = new Uint8Array(await new Response(ds).arrayBuffer());
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  async function shareUrl(g) {
    const base = location.origin + location.pathname;
    return cloud ? base + '#/guide/' + g.id : base + '#/import/' + await packGuide(g);
  }
  async function shareGuide(g) {
    if (cloud && g.visibility === 'private') { toast('나만 보기 가이드예요. 편집에서 공개 범위를 바꾼 뒤 공유해주세요.'); return; }
    const url = await shareUrl(g);
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: g.title, text: `${userOf(g.ownerId).name}님의 여행가이드: ${g.title}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast('공유 링크를 복사했어요. 카톡이나 DM에 붙여넣으세요.');
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      openModal(`<h2>공유 링크</h2><p class="muted">아래 링크를 복사해 보내주세요.</p><textarea class="input" rows="4" readonly data-select>${esc(url)}</textarea><div class="row end"><button class="btn" data-close>닫기</button></div>`);
    }
  }

  /* ---------- 지도 ---------- */
  const maps = [];
  function clearMaps() { while (maps.length) { try { maps.pop().remove(); } catch (e) { /* noop */ } } }
  function makeMap(el, opts = {}) {
    if (!el) return null;
    if (!window.L) { el.innerHTML = '<p class="muted pad">지도를 불러오지 못했어요.</p>'; return null; }
    const m = L.map(el, { zoomControl: true, scrollWheelZoom: !!opts.scroll }).setView(opts.center || TOKYO, opts.zoom || 12);
    L.tileLayer(CFG.tileUrl || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: CFG.tileAttribution || '&copy; OpenStreetMap'
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
  const dayColor = d => ['#0f766e', '#c2410c', '#7c3aed', '#2563eb', '#be185d', '#a16207'][(d - 1) % 6];
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

  /* ---------- 내비게이션 ---------- */
  const NAV = [
    { href: '#/', key: 'feed', label: '홈', icon: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>' },
    { href: '#/explore', key: 'explore', label: '탐색', icon: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>' },
    { href: '#/new', key: 'new', label: '포스팅', icon: '<rect x="3" y="3" width="18" height="18" rx="5"/><path d="M12 8v8M8 12h8"/>' },
    { href: '#/trips', key: 'trips', label: '내 여행', icon: '<path d="M4 19c4-1 3-7 8-8s5-5 8-6"/><circle cx="4" cy="19" r="2"/><circle cx="20" cy="5" r="2"/>' },
    { href: '#/me', key: 'me', label: '프로필', icon: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>' }
  ];
  function renderNav(active) {
    const html = NAV.map(n => {
      const label = n.key === 'me' && cloud && !db.me ? '로그인' : n.label;
      return `<a href="${n.href}" class="${n.key === active ? 'on' : ''}${n.key === 'new' ? ' cta' : ''}" ${n.key === active ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${n.icon}</svg><span>${label}</span></a>`;
    }).join('');
    $('#navlinks').innerHTML = html;
    $('#tabbar').innerHTML = html;
    $('#sidefoot').innerHTML = window.RL_LEGAL ? window.RL_LEGAL.footer() : '';
  }

  /* ---------- 공통 조각 ---------- */
  function guideCard(g) {
    const owner = userOf(g.ownerId);
    const c = coverOf(g);
    const parent = g.forkedFrom && db.guides[g.forkedFrom];
    return `<article class="card guide-card">
      <a href="#/guide/${esc(g.id)}" class="cover-link">${photoBox(c.post, c.spot, 'cover')}
        <span class="cover-badge">${esc(g.city)} · ${days(g).length}일 · 스팟 ${g.items.length}</span>
        ${isMine(g) && g.visibility !== 'public' ? `<span class="vis-badge">${VIS[g.visibility]}</span>` : ''}</a>
      <div class="card-body">
        <a href="#/guide/${esc(g.id)}" class="title-link"><h3>${esc(g.title)}</h3></a>
        ${parent ? `<p class="fork-line">${forkIcon}${esc(userOf(parent.ownerId).name)}님의 「${esc(parent.title)}」에서 포크</p>` : ''}
        ${isMine(g) && g.hidden ? '<p class="warn small">신고 누적으로 숨김 처리됐어요. 문의로 검토를 요청할 수 있어요.</p>' : ''}
        <p class="muted clamp2">${esc(g.desc)}</p>
        <div class="meta-row">
          <a class="who" href="#/user/${esc(owner.id)}">${avatar(owner, 24)}<span>${esc(owner.name)}</span></a>
          <span class="stats"><span title="좋아요">♥ ${likeCount(g)}</span><span title="포크">⑂ ${forkCount(g)}</span></span>
        </div>
      </div>
    </article>`;
  }
  function postCard(p) {
    const s = db.spots[p.spotId], u = userOf(p.userId);
    if (!s) return '';
    const inGuides = guidesArr().filter(g => listable(g) && g.items.some(i => i.postId === p.id));
    const mine = p.userId === db.me;
    return `<article class="card post-card">
      <header class="post-head"><a class="who" href="#/user/${esc(u.id)}">${avatar(u, 32)}<span><b>${esc(u.name)}</b><small class="muted">${ago(p.at)}</small></span></a>
        <button class="btn sm ghost more" data-act="post-menu" data-id="${esc(p.id)}" aria-label="더보기">⋯</button></header>
      ${photoBox(p, s)}
      <div class="card-body">
        <a href="#/spot/${esc(s.id)}" class="spot-line">${catChip(s.cat)}<b>${esc(s.name)}</b><span class="muted">${esc(s.area || '')}</span></a>
        ${mine && p.hidden ? '<p class="warn small">신고 누적으로 숨김 처리된 포스팅이에요.</p>' : ''}
        <p>${esc(p.text)}</p>
        <div class="meta-row">${stars(p.rating)}<span class="muted">${yen(p.cost)}</span></div>
        ${inGuides.length ? `<p class="small muted">수록 가이드: ${inGuides.slice(0, 2).map(g => `<a href="#/guide/${esc(g.id)}">${esc(g.title)}</a>`).join(', ')}${inGuides.length > 2 ? ` 외 ${inGuides.length - 2}개` : ''}</p>` : ''}
      </div>
    </article>`;
  }
  function tripBanner() {
    const g = db.activeTripId && db.guides[db.activeTripId];
    if (!g || !isMine(g)) return '';
    const day = dayOf(g, new Date().toISOString());
    return `<div class="trip-banner"><span class="dot-live"></span><div><b>여행 중 · Day ${day}</b><span>${esc(g.title)}</span></div>
      <a class="btn sm light" href="#/new">지금 포스팅</a><a class="btn sm ghost-light" href="#/guide/${esc(g.id)}">가이드 보기</a></div>`;
  }
  const loading = (msg = '불러오는 중…') => `<div class="card pad center loading"><span class="spinner" aria-hidden="true"></span><p>${esc(msg)}</p></div>`;

  /* ---------- 화면: 홈 피드 ---------- */
  function viewFeed() {
    const guides = guidesArr().filter(listable).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 24);
    const posts = Object.values(db.posts).filter(postVisible).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 12);
    let introSeen = false;
    try { introSeen = !!localStorage.getItem('routelog.intro'); } catch (e) { /* noop */ }
    return `${tripBanner()}
    ${!cloud ? `<p class="demo-note">체험 모드예요. 작성한 내용은 이 브라우저에만 저장돼요.</p>` : ''}
    ${!introSeen ? `<section class="intro card">
      <div><h1>여행을 올리면, 가이드가 됩니다</h1>
      <p>스팟마다 사진 한 장을 올리면 시간순 여행가이드가 자동으로 완성돼요. 친구의 가이드를 <b>포크</b>해서 가게와 루트를 더하고 다시 공유해보세요.</p></div>
      <div class="row"><a class="btn" href="#/trips">여행 시작하기</a>${db.guides.g_tokyo3 ? '<a class="btn ghost" href="#/guide/g_tokyo3">샘플 가이드 보기</a>' : '<a class="btn ghost" href="#/explore">가이드 둘러보기</a>'}<button class="btn ghost" data-act="dismiss-intro">닫기</button></div>
    </section>` : ''}
    <section>
      <div class="sec-head"><h2>새로 올라온 여행가이드</h2><a href="#/explore" class="small">전체 보기</a></div>
      ${guides.length ? `<div class="hscroll">${guides.map(guideCard).join('')}</div>` : '<p class="empty">아직 공개된 가이드가 없어요. 첫 여행을 기록해보세요!</p>'}
    </section>
    <section>
      <div class="sec-head"><h2>최근 스팟 포스팅</h2></div>
      ${posts.length ? `<div class="post-grid">${posts.map(postCard).join('')}</div>` : '<p class="empty">아직 포스팅이 없어요.</p>'}
    </section>`;
  }

  /* ---------- 화면: 탐색 ---------- */
  function viewExplore(q) {
    const qs = (q.get('q') || '').trim();
    const sort = q.get('sort') || 'popular';
    const cat = q.get('cat') || '';
    let list = guidesArr().filter(g => listable(g) && g.visibility !== 'private');
    if (qs) {
      const k = qs.toLowerCase();
      list = list.filter(g => [g.title, g.desc, g.city, ...(g.tags || []), ...g.items.map(i => (itemSpot(i) || {}).name)].join(' ').toLowerCase().includes(k));
    }
    if (cat) list = list.filter(g => g.items.some(i => (itemSpot(i) || {}).cat === cat));
    list.sort((a, b) => sort === 'forks' ? forkCount(b) - forkCount(a) : sort === 'new' ? new Date(b.createdAt) - new Date(a.createdAt) : likeCount(b) - likeCount(a));
    return `<div class="page-head"><h1>탐색</h1></div>
    <form class="search" data-form="search">
      <input class="input" name="q" value="${esc(qs)}" placeholder="도시, 스팟, 태그로 검색 (예: 시부야, 쇼핑)" aria-label="검색어" maxlength="40">
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
    const visible = guidesArr().filter(listable);
    Object.values(db.spots).forEach(s => {
      const n = visible.filter(g => g.items.some(i => i.spotId === s.id)).length;
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
    if (!isMine(g) && db.blocks[g.ownerId]) return `<div class="card pad center"><h2>차단한 사용자의 가이드예요</h2><p class="muted">프로필에서 차단을 풀면 볼 수 있어요.</p><a class="btn" href="#/user/${esc(g.ownerId)}">프로필로</a></div>`;
    const owner = userOf(g.ownerId);
    const mine = isMine(g);
    const parent = g.forkedFrom && db.guides[g.forkedFrom];
    const added = addedVsParent(g);
    const following = !!(db.progress[g.id] && db.progress[g.id].__on);
    const doneMap = db.progress[g.id] || {};
    const total = g.items.length;
    const doneN = g.items.filter(i => doneMap[i.id]).length;
    const nextIt = following ? orderedItems(g).find(i => !doneMap[i.id] && itemSpot(i)) : null;
    const nextSpot = nextIt && itemSpot(nextIt);
    const totalCost = g.items.reduce((sum, it) => sum + ((itemPost(it) || {}).cost || 0), 0);
    let n = 0;

    return `<div class="guide-page">
    <div class="guide-main">
      <a class="back" href="#/" data-act="back">← 뒤로</a>
      <header class="guide-head">
        <div class="tags">${(g.tags || []).map(t => `<a class="tag" href="#/explore?q=${encodeURIComponent(t)}">#${esc(t)}</a>`).join('')}${mine && g.visibility !== 'public' ? `<span class="tag">${VIS[g.visibility]}</span>` : ''}</div>
        <h1>${esc(g.title)}</h1>
        ${parent ? `<p class="fork-line big">${forkIcon}원본: <a href="#/guide/${esc(parent.id)}">${esc(userOf(parent.ownerId).name)}님의 「${esc(parent.title)}」</a>${added.size ? ` · 새로 추가한 스팟 ${added.size}곳` : ''}</p>` : (g.forkedFromTitle ? `<p class="fork-line big">${forkIcon}원본: ${esc(g.forkedFromTitle)}</p>` : '')}
        ${mine && g.hidden ? '<p class="warn">신고 누적으로 다른 사람에게 숨김 처리된 가이드예요. 문의로 검토를 요청할 수 있어요.</p>' : ''}
        <p>${esc(g.desc)}</p>
        <div class="meta-row">
          <a class="who" href="#/user/${esc(owner.id)}">${avatar(owner, 32)}<span><b>${esc(owner.name)}</b><small class="muted">${esc(g.city)} · ${days(g).length}일 · 스팟 ${total}곳 · 지출 약 ${yen(totalCost)}</small></span></a>
        </div>
        <div class="action-row">
          <button class="btn icon-btn ${db.likes[g.id] ? 'on' : ''}" data-act="like" data-id="${esc(g.id)}" aria-pressed="${!!db.likes[g.id]}">♥ ${likeCount(g)}</button>
          <button class="btn icon-btn ${db.saves[g.id] ? 'on' : ''}" data-act="save" data-id="${esc(g.id)}" aria-pressed="${!!db.saves[g.id]}">저장 ${saveCount(g)}</button>
          <button class="btn" data-act="fork" data-id="${esc(g.id)}" title="이 가이드를 복사해 내 버전으로 고치기">⑂ 포크해서 내 가이드로</button>
          <button class="btn ghost" data-act="follow" data-id="${esc(g.id)}">${following ? '따라가기 끄기' : '이 가이드 따라가기'}</button>
          <button class="btn ghost" data-act="share" data-id="${esc(g.id)}">공유</button>
          ${mine ? `<a class="btn ghost" href="#/guide/${esc(g.id)}/edit">편집</a>` : `<button class="btn ghost" data-act="report" data-type="guide" data-id="${esc(g.id)}">신고</button>`}
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
            const s = itemSpot(it);
            if (!s) return '';
            n++;
            const p = itemPost(it), by = db.users[it.by];
            const done = doneMap[it.id];
            return `<li class="stop ${done ? 'done' : ''}" id="stop-${esc(it.id)}">
              <span class="num" style="--pin:${(CATS[s.cat] || CATS.etc).color}">${n}</span>
              <div class="stop-card card">
                <div class="stop-top">
                  <a href="#/spot/${esc(s.id)}" class="spot-line">${catChip(s.cat)}<b>${esc(s.name)}</b></a>
                  ${added.has(it.id) ? '<span class="badge-new">포크에서 추가</span>' : ''}
                  ${following ? `<label class="check"><input type="checkbox" data-act="done" data-g="${esc(g.id)}" data-i="${esc(it.id)}" ${done ? 'checked' : ''}> 방문</label>` : ''}
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
    const seen = new Set([g.id]);
    while (root.forkedFrom && db.guides[root.forkedFrom] && !seen.has(root.forkedFrom)) { root = db.guides[root.forkedFrom]; seen.add(root.id); }
    const node = (x, depth) => {
      const kids = depth < 8 ? children(x) : [];
      const u = userOf(x.ownerId);
      return `<li><a href="#/guide/${esc(x.id)}" class="${x.id === g.id ? 'here' : ''}">${avatar(u, 20)} ${esc(x.title)}</a> <span class="small muted">${esc(u.name)} · 스팟 ${x.items.length}</span>
        ${kids.length ? `<ul>${kids.map(k => node(k, depth + 1)).join('')}</ul>` : ''}</li>`;
    };
    return `<p class="small muted">원본에서 갈라져 나온 가이드 ${forkCount(root)}개</p><ul class="tree">${node(root, 0)}</ul>`;
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
    document.title = `${g.title} · 루트로그`;
  }

  /* ---------- 화면: 가이드 편집 (리믹스) ---------- */
  function viewEdit(id) {
    const g = db.guides[id];
    if (!g) return notFound();
    if (!isMine(g)) return `<p class="empty">내 가이드만 편집할 수 있어요. 먼저 포크해주세요.</p>`;
    let n = 0;
    return `<a class="back" href="#/guide/${esc(g.id)}">← 가이드로</a>
    <div class="page-head"><h1>가이드 편집</h1></div>
    <form class="card form" data-form="guide-meta" data-id="${esc(g.id)}">
      <label>제목<input class="input" name="title" value="${esc(g.title)}" required maxlength="60"></label>
      <label>소개<textarea class="input" name="desc" rows="2" maxlength="200">${esc(g.desc)}</textarea></label>
      <div class="grid3">
        <label>도시<input class="input" name="city" value="${esc(g.city)}" maxlength="40"></label>
        <label>시작일<input class="input" type="date" name="startDate" value="${esc(g.startDate || '')}"></label>
        <label>공개 범위<select class="input" name="visibility">${Object.entries(VIS).map(([k, v]) => `<option value="${k}" ${(g.visibility || 'public') === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      </div>
      <label>태그 (쉼표로 구분)<input class="input" name="tags" value="${esc((g.tags || []).join(', '))}" maxlength="100"></label>
      <div class="row end"><button class="btn">정보 저장</button></div>
    </form>

    <div class="sec-head"><h2>스팟 순서</h2><button class="btn sm" data-act="add-spot" data-id="${esc(g.id)}">+ 가게·쇼핑·스팟 추가</button></div>
    <ul class="edit-list">
      ${days(g).map(([day, list]) => list.map(({ it, idx }) => {
        const s = itemSpot(it);
        if (!s) return '';
        n++;
        return `<li class="card edit-item">
          <span class="num" style="--pin:${(CATS[s.cat] || CATS.etc).color}">${n}</span>
          <div class="grow"><b>${esc(s.name)}</b> ${catChip(s.cat)}<br>
            <input class="input sm" data-act="note" data-g="${esc(g.id)}" data-i="${esc(it.id)}" value="${esc(it.note)}" maxlength="200" placeholder="메모 추가 (예: 오전 10시 입장 추천)" aria-label="${esc(s.name)} 메모"></div>
          <label class="day-sel">Day <input class="input sm" type="number" min="1" max="60" value="${day}" data-act="setday" data-g="${esc(g.id)}" data-i="${esc(it.id)}"></label>
          <div class="btns">
            <button class="btn sm ghost" data-act="up" data-g="${esc(g.id)}" data-idx="${idx}" aria-label="위로">↑</button>
            <button class="btn sm ghost" data-act="down" data-g="${esc(g.id)}" data-idx="${idx}" aria-label="아래로">↓</button>
            <button class="btn sm danger" data-act="remove" data-g="${esc(g.id)}" data-i="${esc(it.id)}">삭제</button>
          </div>
        </li>`;
      }).join('')).join('')}
    </ul>
    <div class="row end"><a class="btn" href="#/guide/${esc(g.id)}">완료</a><button class="btn danger ghost" data-act="delete-guide" data-id="${esc(g.id)}">가이드 삭제</button></div>`;
  }

  function openAddSpot(gid) {
    const g = db.guides[gid];
    const maxDay = Math.max(1, ...g.items.map(i => i.day));
    openModal(`<h2>스팟 추가</h2>
      <form class="form" data-form="add-spot" data-id="${esc(gid)}">
        <label>기존 스팟에서 고르기
          <select class="input" name="existing"><option value="">새 스팟 직접 입력</option>
          ${Object.values(db.spots).sort((a, b) => a.name.localeCompare(b.name, 'ko')).map(s => `<option value="${esc(s.id)}">${esc(s.name)}${s.area ? ` (${esc(s.area)})` : ''}</option>`).join('')}</select></label>
        <div class="new-spot">
          <div class="grid2"><label>이름<input class="input" name="name" placeholder="예: 돈키호테 시부야점" maxlength="80"></label>
          <label>종류<select class="input" name="cat">${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label></div>
          <p class="small muted">지도를 눌러 위치를 정하세요.</p>
          <div class="map-box small-map" id="pickMap"></div>
          <input type="hidden" name="lat"><input type="hidden" name="lng">
        </div>
        <div class="grid2"><label>Day<input class="input" type="number" name="day" min="1" max="60" value="${maxDay}"></label>
        <label>메모<input class="input" name="note" placeholder="왜 추천하나요?" maxlength="200"></label></div>
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
      if (mk) mk.setLatLng([lat, lng]);
      else mk = L.marker([lat, lng], { draggable: true, icon: pin('●', '#0f766e', true) }).addTo(m).on('dragend', e => { const p = e.target.getLatLng(); set(p.lat, p.lng); });
    };
    m.on('click', e => set(e.latlng.lat, e.latlng.lng));
    if (start) { set(start[0], start[1]); m.setView(start, 15); }
    return set;
  }

  /* ---------- 화면: 포스팅 ---------- */
  function viewNew() {
    const mine = guidesArr().filter(isMine);
    const active = db.activeTripId;
    const now = new Date();
    const local = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    return `<div class="page-head"><h1>스팟 포스팅</h1><p class="muted">사진 한 장과 한 줄이면 충분해요. 올리면 선택한 가이드에 시간순으로 쌓여요.</p></div>
    <form class="card form" data-form="post">
      <label class="photo-drop" id="photoDrop">
        <input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" name="photo" hidden>
        <span id="photoPreview" class="photo-preview"><b>사진 추가</b><small>탭해서 사진 선택 · 촬영 위치 정보는 지워져요</small></span>
      </label>
      <div class="grid2">
        <label>스팟 이름<input class="input" name="name" required maxlength="80" placeholder="예: 시부야 스카이 전망대" list="spotNames"></label>
        <label>종류<select class="input" name="cat">${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select></label>
      </div>
      <datalist id="spotNames">${Object.values(db.spots).map(s => `<option value="${esc(s.name)}">`).join('')}</datalist>
      <div class="row between"><span class="small muted" id="locLabel">지도를 눌러 위치를 정하거나 현재 위치를 쓰세요.</span><button type="button" class="btn sm ghost" data-act="geo">현재 위치</button></div>
      <div class="map-box small-map" id="postMap"></div>
      <input type="hidden" name="lat"><input type="hidden" name="lng">
      <label>한 줄 기록<textarea class="input" name="text" rows="3" maxlength="300" placeholder="여기서 뭐가 좋았나요? 다음 사람을 위한 팁도요."></textarea></label>
      <div class="grid3">
        <label>별점<select class="input" name="rating"><option value="5">★★★★★</option><option value="4">★★★★</option><option value="3">★★★</option><option value="2">★★</option><option value="1">★</option></select></label>
        <label>쓴 돈 (엔)<input class="input" type="number" name="cost" min="0" max="100000000" step="10" placeholder="0"></label>
        <label>방문 시각<input class="input" type="datetime-local" name="at" value="${local}"></label>
      </div>
      <label>태그 (쉼표로 구분)<input class="input" name="tags" placeholder="야경, 예약필수" maxlength="100"></label>
      <label>담을 가이드
        <select class="input" name="guide">
          <option value="__new" ${!active ? 'selected' : ''}>새 여행 가이드 만들기</option>
          ${mine.map(g => `<option value="${esc(g.id)}" ${g.id === active ? 'selected' : ''}>${esc(g.title)}${g.id === active ? ' (여행 중)' : ''}</option>`).join('')}
          <option value="__none">가이드에 넣지 않기</option>
        </select></label>
      <p class="small muted">올린 포스팅과 장소는 공개 가이드에 담기면 다른 사람에게 보여요. 남의 사진이나 다른 사람의 얼굴이 크게 나온 사진은 올리지 말아주세요.</p>
      <div class="row end"><button class="btn big" type="submit">올리기</button></div>
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
      if (f.size > 25 * 1024 * 1024) { toast('25MB 이하 사진만 올릴 수 있어요.'); return; }
      try {
        const data = await resizeImage(f, 1280, 0.8);
        form.dataset.photo = data;
        $('#photoPreview').innerHTML = `<img src="${data}" alt="미리보기">`;
      } catch (e) { toast('이 사진 형식은 읽지 못했어요. JPG나 PNG로 올려주세요.'); }
    });
    form.name.addEventListener('change', () => {
      const s = Object.values(db.spots).find(x => x.name === form.name.value.trim());
      if (s && postPicker && m) { form.cat.value = s.cat; postPicker(s.lat, s.lng); m.setView([s.lat, s.lng], 15); $('#locLabel').textContent = '저장된 스팟 위치를 불러왔어요.'; }
    });
  }
  // 캔버스로 다시 그려서 크기를 줄인다. 이 과정에서 EXIF(촬영 위치 등) 메타데이터가 사라진다.
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
        let data = c.toDataURL('image/jpeg', q);
        if (data.length > 2.6e6) data = c.toDataURL('image/jpeg', 0.6);
        resolve(data);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode')); };
      img.src = url;
    });
  }

  /* ---------- 화면: 내 여행 ---------- */
  function viewTrips() {
    const mine = guidesArr().filter(isMine).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const saved = guidesArr().filter(g => db.saves[g.id] && !isMine(g) && listableOrLinked(g));
    const following = guidesArr().filter(g => db.progress[g.id] && db.progress[g.id].__on && listableOrLinked(g));
    const active = db.activeTripId && db.guides[db.activeTripId];
    const today = new Date().toISOString().slice(0, 10);
    return `<div class="page-head"><h1>내 여행</h1></div>
    ${active ? tripBanner() + `<div class="row end"><button class="btn ghost" data-act="end-trip">여행 끝내기</button></div>` : `
    <form class="card form" data-form="start-trip">
      <h2>여행 시작하기</h2>
      <p class="muted small">여행 모드를 켜면 이후 포스팅이 이 가이드에 날짜별로 자동으로 쌓여요.</p>
      <div class="grid3">
        <label>여행 이름<input class="input" name="title" required maxlength="60" placeholder="예: 10월 도쿄 먹방 여행"></label>
        <label>도시<input class="input" name="city" value="도쿄" maxlength="40"></label>
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
  const listableOrLinked = g => isMine(g) || (!g.hidden && !db.blocks[g.ownerId] && g.visibility !== 'private');

  /* ---------- 화면: 프로필 / 사용자 ---------- */
  function viewUser(id) {
    const u = db.users[id];
    if (!u) return notFound();
    const isMe = id === db.me;
    const blocked = !!db.blocks[id];
    const gs = guidesArr().filter(g => g.ownerId === id && (isMe || listable(g)));
    const ps = Object.values(db.posts).filter(p => p.userId === id && (isMe || postVisible(p))).sort((a, b) => new Date(b.at) - new Date(a.at));
    const forksOfMine = gs.reduce((s, g) => s + forkCount(g), 0);
    return `<section class="profile card">
      ${avatar(u, 72)}
      <div class="grow">
        <h1>${esc(u.name)}${u.sample ? ' <span class="tag">샘플</span>' : ''}</h1>
        <p class="muted">${esc(u.bio || (isMe ? '소개를 적어보세요.' : ''))}</p>
        <div class="stats big"><span><b>${gs.length}</b> 가이드</span><span><b>${ps.length}</b> 포스팅</span><span><b>${forksOfMine}</b> 포크됨</span></div>
      </div>
      <div class="row">
      ${isMe ? `<button class="btn ghost" data-act="edit-profile">프로필 수정</button>` : `
        ${blocked ? '' : `<button class="btn ${db.follows[id] ? 'ghost' : ''}" data-act="follow-user" data-id="${esc(id)}">${db.follows[id] ? '팔로잉' : '팔로우'}</button>`}
        <button class="btn ghost" data-act="block" data-id="${esc(id)}">${blocked ? '차단 해제' : '차단'}</button>
        <button class="btn ghost" data-act="report" data-type="user" data-id="${esc(id)}">신고</button>`}
      </div>
    </section>
    ${blocked ? '<p class="empty">차단한 사용자예요. 이 사용자의 가이드와 포스팅은 목록에 보이지 않아요.</p>' : `
    <section><div class="sec-head"><h2>가이드</h2></div>
      ${gs.length ? `<div class="card-grid">${gs.map(guideCard).join('')}</div>` : '<p class="empty">아직 가이드가 없어요.</p>'}</section>
    <section><div class="sec-head"><h2>포스팅</h2></div>
      ${ps.length ? `<div class="post-grid">${ps.map(postCard).join('')}</div>` : '<p class="empty">아직 포스팅이 없어요.</p>'}</section>`}
    ${isMe ? accountSection() : ''}`;
  }
  function accountSection() {
    if (!cloud) {
      return `<section class="card pad"><h2>데이터</h2><p class="small muted">체험 모드라서 서버 없이 이 브라우저에만 저장돼요. 다른 사람과는 공유 링크로 가이드를 주고받아요.</p>
      <div class="row"><button class="btn ghost" data-act="reset">샘플 데이터로 초기화</button></div></section>`;
    }
    const u = me();
    return `<section class="card pad account"><h2>계정</h2>
      <p class="small muted">${esc(cloud.user && cloud.user.email || '')}</p>
      <label class="switch"><input type="checkbox" data-act="toggle-location" ${u.locationAgreedAt ? 'checked' : ''}> 위치기반서비스 이용 동의 (현재 위치 버튼)</label>
      <label class="switch"><input type="checkbox" data-act="toggle-marketing" ${u.marketing ? 'checked' : ''}> 이벤트·소식 알림 받기</label>
      <div class="row"><button class="btn ghost" data-act="set-password">${cloud.hasPassword() ? '비밀번호 변경' : '비밀번호 설정'}</button></div>
      <div class="row"><button class="btn ghost" data-act="logout">로그아웃</button><button class="btn danger" data-act="delete-account">회원 탈퇴</button></div>
    </section>`;
  }

  /* ---------- 화면: 스팟 ---------- */
  function viewSpot(id) {
    const s = db.spots[id];
    if (!s) return notFound();
    const ps = Object.values(db.posts).filter(p => p.spotId === id && postVisible(p)).sort((a, b) => new Date(b.at) - new Date(a.at));
    const gs = guidesArr().filter(g => listable(g) && g.items.some(i => i.spotId === id));
    const rated = ps.filter(p => p.rating);
    const avg = rated.length ? (rated.reduce((a, p) => a + p.rating, 0) / rated.length).toFixed(1) : '-';
    return `<a class="back" href="#/" data-act="back">← 뒤로</a>
    <section class="card pad spot-head">
      <div>${catChip(s.cat)}<h1>${esc(s.name)}</h1><p class="muted">${esc(s.area)}${s.area ? ' · ' : ''}평균 ★ ${avg} · 포스팅 ${ps.length} · 가이드 ${gs.length}</p>
      ${ps[0] ? `<p class="small muted">최근 방문 기록: ${ago(ps[0].at)}. 영업시간·가격은 바뀌었을 수 있어요.</p>` : ''}
      <div class="row"><a class="btn sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${s.lat},${s.lng}">지도 앱에서 열기</a></div></div>
      <div class="map-box small-map" id="spotMap"></div>
    </section>
    <section><div class="sec-head"><h2>이 스팟이 들어간 가이드</h2></div>${gs.length ? `<div class="card-grid">${gs.map(guideCard).join('')}</div>` : '<p class="empty">아직 없어요.</p>'}</section>
    <section><div class="sec-head"><h2>방문 기록</h2></div>${ps.length ? `<div class="post-grid">${ps.map(postCard).join('')}</div>` : '<p class="empty">아직 없어요.</p>'}</section>`;
  }
  function mountSpot(id) {
    const s = db.spots[id];
    const m = makeMap($('#spotMap'), { center: [s.lat, s.lng], zoom: 15 });
    if (m) L.marker([s.lat, s.lng], { icon: pin('●', (CATS[s.cat] || CATS.etc).color, true) }).addTo(m);
  }

  /* ---------- 화면: 로그인 / 가입 동의 / 약관 ---------- */
  function viewLogin(mode) {
    if (!cloud) return `<div class="card pad center"><h2>체험 모드</h2><p class="muted">지금은 서버 없이 이 브라우저에서만 동작해요.</p><a class="btn" href="#/">홈으로</a></div>`;
    if (db.me) return `<div class="card pad center"><h2>이미 로그인했어요</h2><a class="btn" href="#/">홈으로</a></div>`;
    const a = CFG.auth || { email: true };
    const signup = mode === 'signup';
    return `<div class="auth-box card">
      <h1>${signup ? '회원가입' : '로그인'}</h1>
      <div class="seg" role="tablist"><a href="#/login" role="tab" class="${signup ? '' : 'on'}" aria-selected="${!signup}">로그인</a><a href="#/signup" role="tab" class="${signup ? 'on' : ''}" aria-selected="${signup}">회원가입</a></div>
      ${a.kakao ? '<button class="btn big block kakao" data-act="oauth" data-provider="kakao">카카오로 계속하기</button>' : ''}
      ${a.google ? '<button class="btn big block ghost" data-act="oauth" data-provider="google">Google로 계속하기</button>' : ''}
      ${a.email !== false ? `${a.kakao || a.google ? '<p class="or"><span>또는</span></p>' : ''}
      ${signup ? `<form class="form flat" data-form="signup">
        <label>이메일<input class="input" type="email" name="email" required autocomplete="email" placeholder="you@example.com" data-pw-email></label>
        ${pwFields('비밀번호')}
        <button class="btn big block">가입하기</button>
        <p class="small muted">다른 사이트에서 쓰는 비밀번호는 피하고, 비밀번호 관리 앱(iCloud 키체인, Google 비밀번호 관리자 등)이 만들어주는 비밀번호를 쓰면 가장 안전해요.</p>
      </form>` : `<form class="form flat" data-form="login">
        <label>이메일<input class="input" type="email" name="email" required autocomplete="email" placeholder="you@example.com"></label>
        <label>비밀번호<input class="input" type="password" name="password" required autocomplete="current-password"></label>
        <button class="btn big block">로그인</button>
        <div class="row between small"><a href="#/signup">처음이면 회원가입</a><button type="button" class="linkish" data-act="forgot-password">비밀번호를 잊었어요</button></div>
      </form>`}` : ''}
      <p class="small muted">${signup ? '가입하면' : '계속하면'} <a href="#/legal/terms">이용약관</a>과 <a href="#/legal/privacy">개인정보처리방침</a>을 확인한 것으로 봐요. 가입 직후 동의 화면이 한 번 더 나와요.</p>
    </div>`;
  }
  function openSetPassword(title) {
    const email = cloud.user && cloud.user.email || '';
    openModal(`<h2>${title || (cloud.hasPassword() ? '비밀번호 변경' : '비밀번호 설정')}</h2><form class="form flat" data-form="password">
      <input type="email" name="email" value="${esc(email)}" autocomplete="username" hidden data-pw-email>
      ${pwFields('새 비밀번호')}
      <div class="row end"><button type="button" class="btn ghost" data-close>취소</button><button class="btn">저장</button></div>
    </form>`);
  }
  function viewWelcome() {
    const u = me();
    if (!u) return viewLogin();
    return `<div class="auth-box card">
      <h1>환영해요!</h1>
      <p class="muted">시작하기 전에 이름과 약관 동의를 확인해주세요.</p>
      <form class="form flat" data-form="consent">
        <label>이름 (다른 사람에게 보여요)<input class="input" name="name" value="${esc(u.name)}" required maxlength="20"></label>
        <label class="check-line"><input type="checkbox" data-act="agree-all"> <b>모두 동의</b></label>
        <hr>
        <label class="check-line"><input type="checkbox" name="age" required> [필수] 만 14세 이상이에요</label>
        <label class="check-line"><input type="checkbox" name="terms" required> [필수] <a href="#/legal/terms" target="_blank">이용약관</a> 동의</label>
        <label class="check-line"><input type="checkbox" name="privacy" required> [필수] <a href="#/legal/privacy" target="_blank">개인정보 수집·이용</a> 동의</label>
        <label class="check-line"><input type="checkbox" name="location"> [선택] <a href="#/legal/location" target="_blank">위치기반서비스 이용약관</a> 동의 (현재 위치 버튼)</label>
        <label class="check-line"><input type="checkbox" name="marketing"> [선택] 이벤트·소식 알림 받기</label>
        <button class="btn big block">시작하기</button>
      </form>
      <div class="row center"><button class="btn sm ghost" data-act="logout">다른 계정으로 로그인</button></div>
    </div>`;
  }
  function viewLegal(kind) {
    const doc = window.RL_LEGAL && window.RL_LEGAL.docs[kind];
    if (!doc) return notFound();
    return `<a class="back" href="#/" data-act="back">← 뒤로</a><article class="card pad legal"><h1>${doc.title}</h1>${doc.body()}</article>`;
  }

  /* ---------- 화면: 공유 링크 가져오기 (로컬 모드) ---------- */
  let importCache = null;
  async function mountImport(code) {
    const box = $('#importBox');
    try {
      const data = await unpackGuide(code);
      importCache = data;
      const g = data.g, owner = data.us[g.ownerId] || { name: '친구' };
      const exists = db.guides[g.id];
      box.innerHTML = `<h1>${esc(owner.name)}님이 여행가이드를 공유했어요</h1>
        <h2>${esc(g.title)}</h2>
        <p class="muted">${esc(g.city)} · 스팟 ${g.items.length}곳${data.parent ? ` · 원본 「${esc(data.parent.title)}」` : ''}</p>
        <p>${esc(g.desc)}</p>
        <div class="row center">${exists ? `<a class="btn" href="#/guide/${esc(g.id)}">가이드 열기</a>` : `<button class="btn" data-act="import">내 앱에 담고 보기</button>`}</div>
        <p class="small muted">사진은 링크에 담기지 않아요. 스팟·순서·기록은 그대로 옮겨져요.</p>`;
    } catch (e) {
      box.innerHTML = '<h2>링크를 열 수 없어요</h2><p class="muted">링크가 잘렸거나 손상됐을 수 있어요.</p><a class="btn" href="#/">홈으로</a>';
    }
  }
  function doImport() {
    const d = importCache;
    if (!d) return;
    // 상대방의 '나'(u_me)는 내 계정과 겹치지 않게 별도 사용자로 옮긴다
    const remap = id => id === 'u_me' ? 'u_friend_' + d.g.id : id;
    Object.values(d.us).forEach(u => {
      if (!u) return;
      const id = remap(u.id);
      if (!db.users[id]) db.users[id] = { id, name: u.id === 'u_me' && u.name === '나' ? '친구' : String(u.name || '친구').slice(0, 20), bio: String(u.bio || '').slice(0, 80), color: /^#[0-9a-f]{6}$/i.test(u.color) ? u.color : '#0891b2' };
    });
    Object.values(d.ss).forEach(s => { if (s && !db.spots[s.id]) db.spots[s.id] = s; });
    Object.values(d.ps).forEach(p => { if (p && !db.posts[p.id]) db.posts[p.id] = { ...p, photo: null, userId: remap(p.userId) }; });
    const g = { ...d.g, ownerId: remap(d.g.ownerId), items: d.g.items.map(i => ({ ...i, by: remap(i.by) })), baseLikes: d.g.baseLikes || 0, baseSaves: d.g.baseSaves || 0 };
    if (g.forkedFrom && !db.guides[g.forkedFrom] && d.parent) {
      g.forkedFromTitle = `${(d.us[d.parent.ownerId] || {}).name || ''}님의 「${d.parent.title}」`;
      g.forkedFrom = null;
    }
    db.guides[g.id] = g;
    save();
    location.hash = '#/guide/' + g.id;
    toast('가이드를 담았어요. 포크해서 내 버전으로 고쳐보세요.');
  }

  function notFound() { return '<div class="card pad center"><h2>찾을 수 없어요</h2><p class="muted">삭제됐거나 공개 범위가 바뀐 페이지일 수 있어요.</p><a class="btn" href="#/">홈으로</a></div>'; }

  /* ---------- 모달 ---------- */
  let lastFocus = null;
  function openModal(html) {
    const m = $('#modal');
    lastFocus = document.activeElement;
    m.innerHTML = `<div class="modal-back" data-close></div><div class="modal-card" role="dialog" aria-modal="true">${html}</div>`;
    m.hidden = false;
    document.body.classList.add('no-scroll');
    const f = m.querySelector('input:not([type=hidden]), select, textarea, button');
    if (f) f.focus();
  }
  function closeModal() {
    const m = $('#modal');
    if (m.hidden) return;
    m.hidden = true; m.innerHTML = '';
    document.body.classList.remove('no-scroll');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  function confirmModal(title, body, okLabel, danger) {
    return new Promise(resolve => {
      openModal(`<h2>${esc(title)}</h2><p>${body}</p><div class="row end"><button class="btn ghost" data-confirm="0">취소</button><button class="btn ${danger ? 'danger solid' : ''}" data-confirm="1">${esc(okLabel)}</button></div>`);
      $('#modal').addEventListener('click', function h(e) {
        const b = e.target.closest('[data-confirm],[data-close]');
        if (!b) return;
        $('#modal').removeEventListener('click', h);
        closeModal();
        resolve(b.dataset.confirm === '1');
      });
    });
  }
  function openReport(type, id) {
    if (!requireAuth()) return;
    openModal(`<h2>신고하기</h2><p class="small muted">신고는 익명으로 처리돼요. 여러 사람이 신고하면 검토 전까지 자동으로 숨겨져요.</p>
      <form class="form flat" data-form="report" data-type="${esc(type)}" data-id="${esc(id)}">
        ${REPORT_REASONS.map((r, i) => `<label class="check-line"><input type="radio" name="reason" value="${esc(r)}" ${i === 0 ? 'checked' : ''}> ${esc(r)}</label>`).join('')}
        <label>자세한 내용 (선택)<textarea class="input" name="detail" rows="2" maxlength="200"></textarea></label>
        <div class="row end"><button type="button" class="btn ghost" data-close>취소</button><button class="btn">신고</button></div>
      </form>`);
  }

  /* ---------- 라우터 ---------- */
  const fetching = new Set(), fetched = new Set();
  // 서버 모드에서 가이드·사용자·스팟을 (한 번) 불러온 뒤 다시 그린다
  function ensure(kind, id) {
    const key = kind + ':' + id;
    if (!cloud || !id || fetching.has(key)) return;
    fetching.add(key);
    const fn = kind === 'guide' ? cloud.ensureGuide : kind === 'user' ? cloud.ensureUser : cloud.ensureSpot;
    fn(db, id).catch(e => console.error(e)).then(() => { fetched.add(key); if (location.hash.includes(id)) route(true); });
  }
  // 'ok' 이면 그리고, 'loading' 이면 불러오는 중, 'missing' 이면 없음
  function status(kind, id, exists) {
    const key = kind + ':' + id;
    if (cloud && (kind !== 'guide' || !exists)) ensure(kind, id);
    if (exists) return 'ok';
    return cloud && !fetched.has(key) ? 'loading' : 'missing';
  }
  function route(keep) {
    const sy = window.scrollY;
    clearMaps();
    closeModal();
    document.title = '루트로그 RouteLog';
    const raw = location.hash.slice(1) || '/';
    const [path, qstr] = raw.split('?');
    const q = new URLSearchParams(qstr || '');
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    const app = $('#app');
    let html = '', mount = null, nav = '';
    const head = parts[0] || '';

    if (needsConsent() && !['welcome', 'legal'].includes(head)) { location.replace('#/welcome'); return; }
    const needLogin = cloud && !db.me && ['new', 'trips', 'me', 'welcome'].includes(head) || (cloud && !db.me && head === 'guide' && parts[2] === 'edit');

    if (needLogin) { if (head !== 'welcome') sessionStorageSet('routelog.next', '#' + raw); html = viewLogin(); nav = 'me'; }
    else if (!head) { html = viewFeed(); nav = 'feed'; }
    else if (head === 'explore') { html = viewExplore(q); mount = mountExplore; nav = 'explore'; }
    else if (head === 'new') { html = viewNew(); mount = mountNew; nav = 'new'; }
    else if (head === 'trips') { html = viewTrips(); nav = 'trips'; }
    else if (head === 'me') { html = viewUser(db.me); nav = 'me'; }
    else if (head === 'login' || head === 'signup') { html = viewLogin(head); nav = 'me'; }
    else if (head === 'welcome') { html = viewWelcome(); nav = 'me'; }
    else if (head === 'legal') { html = viewLegal(parts[1]); }
    else if (head === 'user') {
      const st = status('user', parts[1], !!db.users[parts[1]]);
      html = st === 'ok' ? viewUser(parts[1]) : st === 'loading' ? loading() : notFound();
      nav = parts[1] === db.me ? 'me' : '';
    }
    else if (head === 'spot') {
      const st = status('spot', parts[1], !!db.spots[parts[1]]);
      html = st === 'ok' ? viewSpot(parts[1]) : st === 'loading' ? loading() : notFound();
      if (st === 'ok') mount = () => mountSpot(parts[1]);
    }
    else if (head === 'guide' && parts[2] === 'edit') { html = viewEdit(parts[1]); nav = 'trips'; }
    else if (head === 'guide') {
      const st = status('guide', parts[1], !!db.guides[parts[1]]);
      html = st === 'ok' ? viewGuide(parts[1]) : st === 'loading' ? loading('가이드를 불러오는 중…') : notFound();
      if (st === 'ok') mount = () => mountGuide(parts[1]);
    }
    else if (head === 'import') { html = `<div class="card pad center" id="importBox">${loading('공유받은 가이드를 여는 중…')}</div>`; mount = () => mountImport(parts.slice(1).join('/')); }
    else html = notFound();

    renderNav(nav);
    app.innerHTML = html + (window.RL_LEGAL ? `<footer class="sitefoot mobile-foot">${window.RL_LEGAL.footer()}</footer>` : '');
    if (mount) mount();
    window.scrollTo(0, keep === true ? sy : 0);
  }

  /* ---------- 이벤트 ---------- */
  document.addEventListener('click', async e => {
    const closer = e.target.closest('[data-close]');
    if (closer) { e.preventDefault(); closeModal(); return; }
    const sel = e.target.closest('[data-select]');
    if (sel) { sel.select(); return; }
    const el = e.target.closest('[data-act]');
    if (!el || el.matches('input')) return;
    const act = el.dataset.act;
    const id = el.dataset.id;
    switch (act) {
      case 'back':
        e.preventDefault();
        if (history.length > 1) history.back(); else location.hash = '#/';
        break;
      case 'dismiss-intro':
        try { localStorage.setItem('routelog.intro', '1'); } catch (_) { /* noop */ }
        el.closest('.intro').remove();
        break;
      case 'like':
        if (!requireAuth()) break;
        db.likes[id] = !db.likes[id]; save(); route(true);
        if (cloud) quiet(push(cloud.setLike(id, db.likes[id])));
        break;
      case 'save':
        if (!requireAuth()) break;
        db.saves[id] = !db.saves[id]; save(); route(true);
        toast(db.saves[id] ? '내 여행에 저장했어요.' : '저장을 취소했어요.');
        if (cloud) quiet(push(cloud.setSave(id, db.saves[id])));
        break;
      case 'fork': {
        if (!requireAuth()) break;
        const ng = fork(db.guides[id]);
        if (cloud) quiet(syncGuide(ng));
        toast('포크했어요. 스팟을 더하거나 순서를 바꿔보세요.');
        location.hash = '#/guide/' + ng.id + '/edit';
        break;
      }
      case 'follow': {
        if (!requireAuth()) break;
        const p = db.progress[id] || (db.progress[id] = {});
        p.__on = !p.__on; save(); route(true);
        if (p.__on) toast('따라가기를 시작했어요. 방문한 스팟을 체크하세요.');
        if (cloud) quiet(push(cloud.setProgress(id, p)));
        break;
      }
      case 'share': shareGuide(db.guides[id]); break;
      case 'report': openReport(el.dataset.type, id); break;
      case 'post-menu': {
        const p = db.posts[id];
        const mine = p && p.userId === db.me;
        openModal(`<h2>포스팅</h2><div class="menu-list">
          ${mine ? `<button class="btn ghost block danger" data-act="delete-post" data-id="${esc(id)}">포스팅 삭제</button>` : `<button class="btn ghost block" data-act="report" data-type="post" data-id="${esc(id)}">신고</button><button class="btn ghost block" data-act="block" data-id="${esc(p.userId)}">${esc(userOf(p.userId).name)}님 차단</button>`}
          <button class="btn ghost block" data-close>닫기</button></div>`);
        break;
      }
      case 'delete-post': {
        closeModal();
        if (!(await confirmModal('포스팅을 삭제할까요?', '사진과 기록이 지워지고, 이 포스팅이 들어간 가이드에는 스팟만 남아요.', '삭제', true))) break;
        delete db.posts[id];
        guidesArr().forEach(g => g.items.forEach(i => { if (i.postId === id) i.postId = null; }));
        save(); route(true); toast('삭제했어요.');
        if (cloud) quiet(push(cloud.deletePost(id)));
        break;
      }
      case 'block': {
        if (!requireAuth()) break;
        closeModal();
        if (id === db.me) break;
        const on = !db.blocks[id];
        if (on && !(await confirmModal(`${userOf(id).name}님을 차단할까요?`, '차단하면 이 사용자의 가이드와 포스팅이 목록에서 보이지 않아요. 상대방에게는 알리지 않아요.', '차단', true))) break;
        db.blocks[id] = on;
        if (on) delete db.follows[id];
        save(); route(true); toast(on ? '차단했어요.' : '차단을 풀었어요.');
        if (cloud) { quiet(push(cloud.setBlock(id, on))); if (on) quiet(cloud.setFollow(id, false)); }
        break;
      }
      case 'up': case 'down': {
        const g = db.guides[el.dataset.g];
        const ordered = orderedItems(g);
        const it = g.items[Number(el.dataset.idx)];
        const pos = ordered.indexOf(it);
        const swap = ordered[act === 'up' ? pos - 1 : pos + 1];
        if (!swap) break;
        if (swap.day !== it.day) it.day = swap.day;
        else {
          const a = g.items.indexOf(it), b = g.items.indexOf(swap);
          [g.items[a], g.items[b]] = [g.items[b], g.items[a]];
        }
        g.items = orderedItems(g);
        save(); route(true); quiet(syncGuide(g));
        break;
      }
      case 'remove': {
        const g = db.guides[el.dataset.g];
        g.items = g.items.filter(i => i.id !== el.dataset.i);
        save(); route(true); toast('스팟을 뺐어요.'); quiet(syncGuide(g));
        break;
      }
      case 'add-spot': openAddSpot(id); break;
      case 'delete-guide':
        if (await confirmModal('이 가이드를 삭제할까요?', '포스팅은 남아요. 이 가이드를 포크한 다른 가이드는 그대로 남고 원본 연결만 끊겨요.', '삭제', true)) {
          const g = db.guides[id];
          children(g).forEach(c => { c.forkedFromTitle = `${userOf(g.ownerId).name}님의 「${g.title}」`; c.forkedFrom = null; });
          delete db.guides[id];
          if (db.activeTripId === id) db.activeTripId = null;
          save(); location.hash = '#/trips';
          if (cloud) quiet(push(cloud.deleteGuide(id)));
        }
        break;
      case 'end-trip':
        db.activeTripId = null; save(); route(); toast('여행을 마쳤어요. 가이드를 공유해보세요!');
        if (cloud) quiet(push(cloud.updateProfile({ active_trip_id: null })));
        break;
      case 'geo':
        if (cloud && me() && !me().locationAgreedAt) {
          if (!(await confirmModal('위치기반서비스 이용에 동의할까요?', '현재 위치는 포스팅의 장소 입력에만 쓰고 따로 저장하지 않아요. <a href="#/legal/location" target="_blank">약관 보기</a>', '동의하고 사용'))) break;
          me().locationAgreedAt = new Date().toISOString();
          quiet(push(cloud.updateProfile({ location_agreed_at: me().locationAgreedAt })));
        }
        if (!navigator.geolocation) { toast('이 브라우저는 위치를 지원하지 않아요.'); break; }
        navigator.geolocation.getCurrentPosition(pos => {
          const { latitude, longitude } = pos.coords;
          if (postPicker) postPicker(latitude, longitude);
          const m = maps[maps.length - 1];
          if (m) m.setView([latitude, longitude], 16);
          const label = $('#locLabel');
          if (label) label.textContent = '현재 위치를 넣었어요. 핀을 끌어 조정할 수 있어요.';
        }, () => toast('위치 권한이 없어 지도로 직접 골라주세요.'), { enableHighAccuracy: true, timeout: 8000 });
        break;
      case 'follow-user':
        if (!requireAuth()) break;
        db.follows[id] = !db.follows[id]; save(); route(true);
        if (cloud) quiet(push(cloud.setFollow(id, db.follows[id])));
        break;
      case 'edit-profile': {
        const u = me();
        openModal(`<h2>프로필 수정</h2><form class="form flat" data-form="profile">
          <label>이름<input class="input" name="name" value="${esc(u.name)}" maxlength="20" required></label>
          <label>소개<input class="input" name="bio" value="${esc(u.bio)}" maxlength="80"></label>
          <div class="row end"><button type="button" class="btn ghost" data-close>취소</button><button class="btn">저장</button></div></form>`);
        break;
      }
      case 'reset':
        if (await confirmModal('샘플 데이터로 초기화할까요?', '내가 만든 가이드와 포스팅이 모두 지워져요.', '초기화', true)) {
          db = Object.assign(emptyDb(), window.RL_SEED()); save(); location.hash = '#/'; route();
        }
        break;
      case 'import': doImport(); break;
      case 'reload': location.reload(); break;
      case 'oauth':
        try { await cloud.signInOAuth(el.dataset.provider); } catch (err) { console.error(err); toast('로그인을 시작하지 못했어요. 잠시 후 다시 시도해주세요.'); }
        break;
      case 'set-password':
        openSetPassword();
        break;
      case 'forgot-password': {
        const em = ($('form[data-form=login] input[name=email]') || {}).value || '';
        openModal(`<h2>비밀번호 재설정</h2><form class="form flat" data-form="forgot">
          <p class="small muted">가입한 이메일로 재설정 링크를 보내요. 링크를 누르면 새 비밀번호를 정하는 창이 열려요.</p>
          <label>이메일<input class="input" type="email" name="email" required autocomplete="email" value="${esc(em)}"></label>
          <div class="row end"><button type="button" class="btn ghost" data-close>취소</button><button class="btn">링크 보내기</button></div>
        </form>`);
        break;
      }
      case 'logout':
        await cloud.signOut();
        break;
      case 'delete-account':
        if (!(await confirmModal('정말 탈퇴할까요?', '계정, 프로필, 내가 만든 가이드와 포스팅, 사진이 모두 바로 삭제되고 되돌릴 수 없어요.', '탈퇴', true))) break;
        try {
          $('#app').innerHTML = loading('탈퇴 처리 중…');
          await cloud.flush();
          await cloud.deleteAccount();
          toast('탈퇴가 완료됐어요. 그동안 이용해주셔서 감사해요.');
        } catch (err) {
          console.error(err);
          toast('탈퇴 처리에 실패했어요. 문의 메일로 요청해주세요.');
          route();
        }
        break;
    }
  });

  document.addEventListener('change', e => {
    const el = e.target;
    const act = el.dataset && el.dataset.act;
    if (!act) return;
    if (act === 'done') {
      const p = db.progress[el.dataset.g] || (db.progress[el.dataset.g] = { __on: true });
      p[el.dataset.i] = el.checked; save(); route(true);
      if (cloud) quiet(push(cloud.setProgress(el.dataset.g, p)));
      const g = db.guides[el.dataset.g];
      if (g.items.every(i => p[i.id])) toast('가이드 완주! 포크해서 내 기록을 더해 공유해보세요.');
    } else if (act === 'note' || act === 'setday') {
      const g = db.guides[el.dataset.g];
      const it = g.items.find(i => i.id === el.dataset.i);
      if (act === 'note') it.note = el.value.trim().slice(0, 200);
      else { it.day = Math.max(1, Math.min(60, parseInt(el.value, 10) || 1)); g.items = orderedItems(g); }
      save(); quiet(syncGuide(g));
      if (act === 'setday') route(true); else toast('메모를 저장했어요.');
    } else if (act === 'agree-all') {
      el.form.querySelectorAll('input[type=checkbox]').forEach(c => { c.checked = el.checked; });
    } else if (act === 'toggle-location') {
      me().locationAgreedAt = el.checked ? new Date().toISOString() : null;
      quiet(push(cloud.updateProfile({ location_agreed_at: me().locationAgreedAt })));
      toast(el.checked ? '위치기반서비스 이용에 동의했어요.' : '위치기반서비스 동의를 철회했어요.');
    } else if (act === 'toggle-marketing') {
      me().marketing = el.checked;
      quiet(push(cloud.updateProfile({ marketing_agreed: el.checked })));
      toast(el.checked ? `소식 알림 수신에 동의했어요 (${new Date().toLocaleDateString('ko-KR')}).` : '소식 알림 수신을 거부했어요.');
    }
  });

  document.addEventListener('input', e => {
    const f = e.target.form;
    if (!f || !f.querySelector('[data-pw]') || !(e.target.matches('[data-pw]') || e.target.matches('[data-pw-email]'))) return;
    const ul = f.querySelector('.pw-rules');
    const em = f.querySelector('[data-pw-email]');
    if (ul) ul.innerHTML = pwRulesHtml(f.querySelector('[data-pw]').value, em ? em.value : '');
  });

  document.addEventListener('submit', async e => {
    const f = e.target;
    const kind = f.dataset.form;
    if (!kind) return;
    e.preventDefault();
    const v = Object.fromEntries(new FormData(f).entries());
    const btn = e.submitter || f.querySelector('button:not([type=button])');
    const busy = on => { if (btn) { btn.disabled = on; btn.classList.toggle('busy', on); } };
    const tags = s => (s || '').split(',').map(t => t.trim().slice(0, 20)).filter(Boolean).slice(0, 10);

    if (kind === 'search') {
      if (cloud && v.q.trim()) { busy(true); try { await cloud.search(db, v.q); } catch (err) { console.error(err); } busy(false); }
      location.hash = '#/explore?' + new URLSearchParams({ q: v.q, sort: v.sort });
    } else if (kind === 'login') {
      busy(true);
      try {
        await cloud.signInPassword(v.email.trim(), v.password);
      } catch (err) {
        console.error(err);
        busy(false);
        const m = (err.code || '') + ' ' + (err.message || '');
        toast(/rate|limit|too many/i.test(m) ? '시도가 너무 많아요. 잠시 후 다시 시도해주세요.' : /not.?confirmed/i.test(m) ? '메일 인증이 끝나지 않은 계정이에요. 가입 확인 메일의 링크를 눌러주세요.' : '이메일 또는 비밀번호가 맞지 않아요.');
      }
    } else if (kind === 'signup') {
      const email = v.email.trim();
      if (!passwordOk(v.password, email)) { toast('비밀번호 규칙을 모두 지켜주세요.'); return; }
      if (v.password !== v.password2) { toast('두 비밀번호가 달라요.'); return; }
      busy(true);
      try {
        const data = await cloud.signUp(email, v.password);
        if (!data.session) {
          f.outerHTML = `<div class="form flat"><p><b>${esc(email)}</b>로 가입 확인 메일을 보냈어요.</p><p class="small muted">메일의 링크를 누르면 가입이 끝나요.</p></div>`;
        }
        // session이 있으면 onAuth(SIGNED_IN)가 동의 화면으로 보낸다
      } catch (err) {
        console.error(err);
        busy(false);
        const m = (err.code || '') + ' ' + (err.message || '');
        toast(/already|exists|registered/i.test(m) ? '이미 가입된 이메일이에요. 로그인해주세요.'
          : /rate|limit|too many/i.test(m) ? '시도가 너무 많아요. 잠시 후 다시 시도해주세요.'
          : /email.*invalid|invalid.*email/i.test(m) ? '이메일 주소를 확인해주세요.'
          : /weak|password/i.test(m) ? passwordError(err) : '가입하지 못했어요. 잠시 후 다시 시도해주세요.');
      }
    } else if (kind === 'password') {
      if (!passwordOk(v.password, v.email)) { toast('비밀번호 규칙을 모두 지켜주세요.'); return; }
      if (v.password !== v.password2) { toast('두 비밀번호가 달라요.'); return; }
      busy(true);
      try {
        await cloud.setPassword(v.password);
        closeModal(); toast('비밀번호를 저장했어요.'); route(true);
      } catch (err) { console.error(err); busy(false); toast(passwordError(err)); }
    } else if (kind === 'forgot') {
      busy(true);
      try {
        await cloud.resetPassword(v.email.trim());
        closeModal(); toast('재설정 링크를 보냈어요. 메일함(스팸함 포함)을 확인해주세요.');
      } catch (err) {
        console.error(err); busy(false);
        toast(/rate|limit/i.test(err.message || '') ? '잠시 후 다시 시도해주세요. 메일 요청이 너무 잦아요.' : '메일을 보내지 못했어요. 주소를 확인해주세요.');
      }
    } else if (kind === 'consent') {
      if (!v.age || !v.terms || !v.privacy) { toast('필수 항목에 동의해주세요.'); return; }
      busy(true);
      const now = new Date().toISOString();
      const fields = { name: v.name.trim().slice(0, 20) || '여행자', terms_agreed_at: now, location_agreed_at: v.location ? now : null, marketing_agreed: !!v.marketing };
      try {
        await push(cloud.updateProfile(fields));
        Object.assign(me(), { name: fields.name, termsAgreedAt: now, locationAgreedAt: fields.location_agreed_at, marketing: fields.marketing_agreed });
        toast('가입이 완료됐어요!');
        location.hash = sessionStorageTake('routelog.next') || '#/';
      } catch (err) { busy(false); }
    } else if (kind === 'report') {
      const reason = (v.reason + (v.detail ? ': ' + v.detail.trim() : '')).slice(0, 300);
      closeModal();
      if (cloud) { try { await push(cloud.report(f.dataset.type, f.dataset.id, reason)); } catch (err) { return; } }
      toast('신고가 접수됐어요. 검토 후 조치할게요.');
    } else if (kind === 'start-trip') {
      if (!requireAuth()) return;
      const g = newGuide({ title: v.title.trim().slice(0, 60), city: v.city.trim().slice(0, 40) || '도쿄', startDate: v.startDate || null });
      db.guides[g.id] = g; db.activeTripId = g.id; save();
      if (cloud) { quiet(syncGuide(g)); quiet(push(cloud.updateProfile({ active_trip_id: g.id }))); }
      toast('여행 모드를 켰어요. 스팟에 도착하면 포스팅하세요!');
      location.hash = '#/new';
    } else if (kind === 'guide-meta') {
      const g = db.guides[f.dataset.id];
      Object.assign(g, { title: v.title.trim().slice(0, 60), desc: v.desc.trim().slice(0, 200), city: v.city.trim().slice(0, 40), startDate: v.startDate || null, visibility: VIS[v.visibility] ? v.visibility : 'public', tags: tags(v.tags) });
      save(); toast('저장했어요.'); quiet(syncGuide(g));
    } else if (kind === 'profile') {
      const fields = { name: v.name.trim().slice(0, 20) || '여행자', bio: v.bio.trim().slice(0, 80) };
      Object.assign(me(), fields);
      save(); closeModal(); route();
      if (cloud) quiet(push(cloud.updateProfile(fields)));
    } else if (kind === 'add-spot') {
      const g = db.guides[f.dataset.id];
      let s;
      if (v.existing) s = db.spots[v.existing];
      else {
        if (!v.name.trim()) { toast('스팟 이름을 적어주세요.'); return; }
        if (!v.lat) { toast('지도를 눌러 위치를 정해주세요.'); return; }
        const r = findOrCreateSpot({ name: v.name, cat: v.cat, lat: +v.lat, lng: +v.lng, area: g.city });
        s = r.spot;
        if (r.created && cloud) quiet(push(cloud.addSpot(s)));
      }
      g.items.push({ id: uid('i'), postId: null, spotId: s.id, day: Math.max(1, Math.min(60, parseInt(v.day, 10) || 1)), note: v.note.trim().slice(0, 200), by: db.me });
      g.items = orderedItems(g);
      save(); closeModal(); route(true); toast(`「${s.name}」을 추가했어요.`);
      quiet(syncGuide(g));
    } else if (kind === 'post') {
      if (!requireAuth()) return;
      if (!v.lat) { toast('지도를 눌러 위치를 정해주세요.'); return; }
      busy(true);
      const at = v.at ? new Date(v.at).toISOString() : new Date().toISOString();
      let gid = v.guide;
      let g = null, newTrip = false;
      if (gid === '__new') {
        g = newGuide({ title: `${v.name.trim()}에서 시작한 여행`.slice(0, 60), startDate: at.slice(0, 10) });
        db.guides[g.id] = g; db.activeTripId = g.id; gid = g.id; newTrip = true;
      } else if (gid !== '__none') g = db.guides[gid];
      const r = findOrCreateSpot({ name: v.name, cat: v.cat, lat: +v.lat, lng: +v.lng, area: g ? g.city : '' });
      const s = r.spot;
      const photo = f.dataset.photo || null;
      const p = {
        id: uid('p'), userId: db.me, spotId: s.id, at, text: v.text.trim().slice(0, 300), rating: +v.rating || null,
        cost: Math.max(0, Math.round(+v.cost || 0)), tags: tags(v.tags), photo
      };
      db.posts[p.id] = p;
      if (g) {
        g.items.push({ id: uid('i'), postId: p.id, spotId: s.id, day: dayOf(g, at), note: '', by: db.me });
        // 같은 날 안에서는 방문 시각 순으로 정렬
        g.items.sort((a, b) => a.day - b.day || ((db.posts[a.postId] || {}).at || '').localeCompare((db.posts[b.postId] || {}).at || ''));
      }
      if (cloud) {
        try {
          if (r.created) push(cloud.addSpot(s)).catch(() => {});
          const url = await push(cloud.createPost(p, photo));
          p.photo = url;
          if (g) await syncGuide(g);
          if (newTrip) quiet(push(cloud.updateProfile({ active_trip_id: g.id })));
        } catch (err) {
          // 실패하면 화면에서도 되돌린다
          delete db.posts[p.id];
          if (g) g.items = g.items.filter(i => i.postId !== p.id);
          if (newTrip) { delete db.guides[g.id]; db.activeTripId = null; }
          busy(false);
          return;
        }
      } else if (!save() && p.photo) { p.photo = null; save(); }
      toast(g ? '올렸어요. 가이드에 추가됐어요.' : '올렸어요.');
      location.hash = g ? '#/guide/' + g.id : '#/';
    }
  });

  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  window.addEventListener('hashchange', () => route());
  window.addEventListener('offline', () => toast('오프라인이에요. 연결되면 다시 저장할 수 있어요.'));
  let lastWide = matchMedia('(min-width: 1024px)').matches;
  window.addEventListener('resize', () => {
    const wide = matchMedia('(min-width: 1024px)').matches;
    if (wide !== lastWide && /^#\/guide\/[^/]+$/.test(location.hash)) route(true);
    lastWide = wide;
  });

  /* ---------- 시작 ---------- */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  async function boot() {
    if (CFG.supabaseUrl && CFG.supabaseAnonKey) {
      db = emptyDb();
      $('#app').innerHTML = loading();
      try {
        if (!window.supabase) await loadScript('vendor/supabase/supabase.js');
        cloud = window.RLCloud.create(CFG);
        await cloud.init();
        await cloud.loadAll(db);
        if (cloud.authError && !db.me) {
          const e = cloud.authError;
          setTimeout(() => toast(/expired|invalid|otp/i.test(e) ? '메일 링크가 만료됐거나 이미 사용됐어요. 다시 요청해주세요.' : '인증하지 못했어요. 다시 시도해주세요.'), 300);
          if (!location.hash || location.hash === '#/') location.hash = '#/login';
        }
      } catch (err) {
        console.error(err);
        if (cloud) {
          $('#app').innerHTML = `<div class="card pad center"><h2>서버에 연결하지 못했어요</h2><p class="muted">잠시 후 다시 시도해주세요.</p><button class="btn" data-act="reload">다시 시도</button></div>`;
          renderNav('');
          return;
        }
      }
      if (cloud) {
        cloud.onAuth(async (evt, user) => {
          const uidNow = user ? user.id : null;
          if (evt === 'TOKEN_REFRESHED' || evt === 'INITIAL_SESSION' || uidNow === db.me) return;
          db = emptyDb();
          $('#app').innerHTML = loading();
          try { await cloud.loadAll(db); } catch (err) { console.error(err); }
          if (evt === 'SIGNED_IN') {
            const next = sessionStorageTake('routelog.next');
            if (needsConsent()) { sessionStorageSet('routelog.next', next || '#/'); location.hash = '#/welcome'; }
            else if (next && next !== location.hash) location.hash = next;
            else route();
          } else { location.hash = '#/'; route(); }
        });
        route();
        if (cloud.recovery && db.me) setTimeout(() => openSetPassword('새 비밀번호 정하기'), 300);
        return;
      }
    }
    db = loadLocal();
    save();
    route();
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  boot();
})();
