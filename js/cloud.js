/* 서버(Supabase) 연동 계층. 앱은 화면용 메모리 데이터(db)를 쓰고, 이 모듈이 서버와 맞춰준다. */
(function () {
  'use strict';

  const CHUNK = 100;
  const chunks = (arr, n = CHUNK) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
  const uniq = arr => Array.from(new Set(arr.filter(Boolean)));

  function create(cfg) {
    if (!cfg || !cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return null;
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
    });

    // 쓰기는 한 줄로 세워 순서를 지킨다 (스팟 → 포스트 → 가이드 → 항목 순으로 외래키가 맞도록)
    let chain = Promise.resolve();
    const q = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
    const ok = ({ data, error }) => { if (error) throw error; return data; };

    /* ---------- 행 ↔ 앱 모델 ---------- */
    const toUser = r => ({ id: r.id, name: r.name, bio: r.bio || '', color: r.color, activeTripId: r.active_trip_id, termsAgreedAt: r.terms_agreed_at, locationAgreedAt: r.location_agreed_at, marketing: r.marketing_agreed });
    const toSpot = r => ({ id: r.id, name: r.name, cat: r.cat, lat: r.lat, lng: r.lng, area: r.area || '' });
    const toPost = r => ({ id: r.id, userId: r.user_id, spotId: r.spot_id, at: r.at, text: r.text || '', rating: r.rating, cost: r.cost || 0, tags: r.tags || [], photo: r.photo_url, hidden: r.hidden });
    const toGuide = (r, likes, saves) => ({
      id: r.id, ownerId: r.owner_id, title: r.title, city: r.city || '', desc: r.descr || '', startDate: r.start_date,
      forkedFrom: r.forked_from, forkedFromTitle: r.forked_from_title, tags: r.tags || [], visibility: r.visibility,
      createdAt: r.created_at, hidden: r.hidden,
      baseLikes: Math.max(0, r.like_count - (likes[r.id] ? 1 : 0)),
      baseSaves: Math.max(0, r.save_count - (saves[r.id] ? 1 : 0)),
      items: (r.guide_items || []).sort((a, b) => a.position - b.position)
        .map(i => ({ id: i.id, postId: i.post_id, spotId: i.spot_id, day: i.day, note: i.note || '', by: i.added_by }))
    });
    const guideRow = g => ({
      id: g.id, owner_id: g.ownerId, title: g.title, city: g.city || '', descr: g.desc || '', start_date: g.startDate || null,
      forked_from: g.forkedFrom || null, forked_from_title: g.forkedFromTitle || null, tags: g.tags || [], visibility: g.visibility || 'public'
    });

    const api = {
      sb,
      user: null,
      async init() {
        const { data } = await sb.auth.getSession();
        api.user = data.session ? data.session.user : null;
        // 로그인 링크로 돌아왔으면 주소창의 인증 코드를 지운다
        if (/[?&]code=/.test(location.search)) history.replaceState(null, '', location.pathname + location.hash);
        return api.user;
      },
      onAuth(cb) { sb.auth.onAuthStateChange((evt, session) => { api.user = session ? session.user : null; cb(evt, api.user); }); },

      /* ---------- 읽기 ---------- */
      async loadAll(db) {
        const me = api.user && api.user.id;
        const [likes, saves, follows, progress, blocks, myProfile] = me ? await Promise.all([
          sb.from('likes').select('guide_id').eq('user_id', me).then(ok),
          sb.from('saves').select('guide_id').eq('user_id', me).then(ok),
          sb.from('follows').select('followee_id').eq('follower_id', me).then(ok),
          sb.from('guide_progress').select('*').eq('user_id', me).then(ok),
          sb.from('blocks').select('blocked_id').eq('blocker_id', me).then(ok),
          sb.from('profiles').select('*').eq('id', me).maybeSingle().then(ok)
        ]) : [[], [], [], [], [], null];
        db.likes = {}; likes.forEach(r => { db.likes[r.guide_id] = true; });
        db.saves = {}; saves.forEach(r => { db.saves[r.guide_id] = true; });
        db.follows = {}; follows.forEach(r => { db.follows[r.followee_id] = true; });
        db.blocks = {}; blocks.forEach(r => { db.blocks[r.blocked_id] = true; });
        db.progress = {}; progress.forEach(r => { db.progress[r.guide_id] = Object.assign({ __on: r.following }, r.done || {}); });
        db.me = me || null;
        if (myProfile) { db.users[me] = toUser(myProfile); db.activeTripId = myProfile.active_trip_id; }

        const recentGuides = sb.from('guides').select('*, guide_items(*)').eq('visibility', 'public').order('created_at', { ascending: false }).limit(200).then(ok);
        const mineGuides = me ? sb.from('guides').select('*, guide_items(*)').eq('owner_id', me).then(ok) : Promise.resolve([]);
        const savedIds = Object.keys(db.saves).concat(Object.keys(db.progress));
        const [recent, mine, extra, posts] = await Promise.all([
          recentGuides, mineGuides,
          savedIds.length ? sb.from('guides').select('*, guide_items(*)').in('id', savedIds.slice(0, CHUNK)).then(ok) : Promise.resolve([]),
          sb.from('posts').select('*').order('at', { ascending: false }).limit(40).then(ok)
        ]);
        recent.concat(mine, extra).forEach(r => { db.guides[r.id] = toGuide(r, db.likes, db.saves); });
        posts.forEach(r => { db.posts[r.id] = toPost(r); });
        await api.fillRefs(db);
      },
      // 가이드·포스트가 가리키는 포스트, 스팟, 사용자, 원본 가이드를 채운다
      async fillRefs(db) {
        const guides = Object.values(db.guides);
        const postIds = uniq(guides.flatMap(g => g.items.map(i => i.postId))).filter(id => !db.posts[id]);
        for (const ids of chunks(postIds)) (await sb.from('posts').select('*').in('id', ids).then(ok)).forEach(r => { db.posts[r.id] = toPost(r); });
        const parentIds = uniq(guides.map(g => g.forkedFrom)).filter(id => !db.guides[id]);
        for (const ids of chunks(parentIds)) (await sb.from('guides').select('*, guide_items(*)').in('id', ids).then(ok)).forEach(r => { db.guides[r.id] = toGuide(r, db.likes, db.saves); });
        const spotIds = uniq(Object.values(db.guides).flatMap(g => g.items.map(i => i.spotId)).concat(Object.values(db.posts).map(p => p.spotId))).filter(id => !db.spots[id]);
        for (const ids of chunks(spotIds)) (await sb.from('spots').select('*').in('id', ids).then(ok)).forEach(r => { db.spots[r.id] = toSpot(r); });
        const userIds = uniq(Object.values(db.guides).flatMap(g => [g.ownerId, ...g.items.map(i => i.by)]).concat(Object.values(db.posts).map(p => p.userId))).filter(id => !db.users[id]);
        for (const ids of chunks(userIds)) (await sb.from('profiles').select('id,name,bio,color').in('id', ids).then(ok)).forEach(r => { db.users[r.id] = toUser(r); });
        // 원본 가이드가 지워져서 못 불러온 경우 화면이 깨지지 않게 연결을 끊는다
        Object.values(db.guides).forEach(g => { if (g.forkedFrom && !db.guides[g.forkedFrom]) g.forkedFrom = null; });
      },
      async ensureGuide(db, id) {
        if (db.guides[id]) return db.guides[id];
        const r = await sb.from('guides').select('*, guide_items(*)').eq('id', id).maybeSingle().then(ok);
        if (!r) return null;
        db.guides[r.id] = toGuide(r, db.likes, db.saves);
        const kids = await sb.from('guides').select('*, guide_items(*)').eq('forked_from', id).eq('visibility', 'public').limit(50).then(ok);
        kids.forEach(k => { db.guides[k.id] = toGuide(k, db.likes, db.saves); });
        await api.fillRefs(db);
        return db.guides[id];
      },
      async ensureUser(db, id) {
        const [prof, guides, posts] = await Promise.all([
          sb.from('profiles').select('id,name,bio,color').eq('id', id).maybeSingle().then(ok),
          sb.from('guides').select('*, guide_items(*)').eq('owner_id', id).limit(100).then(ok),
          sb.from('posts').select('*').eq('user_id', id).order('at', { ascending: false }).limit(60).then(ok)
        ]);
        if (!prof) return null;
        if (!db.users[id] || id !== db.me) db.users[id] = Object.assign(db.users[id] || {}, toUser(prof));
        guides.forEach(r => { db.guides[r.id] = toGuide(r, db.likes, db.saves); });
        posts.forEach(r => { db.posts[r.id] = toPost(r); });
        await api.fillRefs(db);
        return db.users[id];
      },
      async ensureSpot(db, id) {
        const [spot, posts, items] = await Promise.all([
          sb.from('spots').select('*').eq('id', id).maybeSingle().then(ok),
          sb.from('posts').select('*').eq('spot_id', id).order('at', { ascending: false }).limit(60).then(ok),
          sb.from('guide_items').select('guide_id').eq('spot_id', id).limit(100).then(ok)
        ]);
        if (!spot) return null;
        db.spots[id] = toSpot(spot);
        posts.forEach(r => { db.posts[r.id] = toPost(r); });
        const gids = uniq(items.map(i => i.guide_id)).filter(g => !db.guides[g]);
        for (const ids of chunks(gids)) (await sb.from('guides').select('*, guide_items(*)').in('id', ids).then(ok)).forEach(r => { db.guides[r.id] = toGuide(r, db.likes, db.saves); });
        await api.fillRefs(db);
        return db.spots[id];
      },
      async search(db, text) {
        const k = text.replace(/[%,()]/g, ' ').trim();
        if (!k) return;
        const like = `%${k}%`;
        const [byGuide, bySpot] = await Promise.all([
          sb.from('guides').select('*, guide_items(*)').eq('visibility', 'public').or(`title.ilike.${like},city.ilike.${like},descr.ilike.${like}`).limit(60).then(ok),
          sb.from('spots').select('id').ilike('name', like).limit(50).then(ok)
        ]);
        byGuide.forEach(r => { db.guides[r.id] = toGuide(r, db.likes, db.saves); });
        if (bySpot.length) {
          const items = await sb.from('guide_items').select('guide_id').in('spot_id', bySpot.map(s => s.id)).limit(200).then(ok);
          const gids = uniq(items.map(i => i.guide_id)).filter(g => !db.guides[g]);
          for (const ids of chunks(gids)) (await sb.from('guides').select('*, guide_items(*)').in('id', ids).eq('visibility', 'public').then(ok)).forEach(r => { db.guides[r.id] = toGuide(r, db.likes, db.saves); });
        }
        await api.fillRefs(db);
      },

      /* ---------- 쓰기 ---------- */
      setLike: (gid, on) => q(() => on
        ? sb.from('likes').upsert({ user_id: api.user.id, guide_id: gid }, { onConflict: 'user_id,guide_id', ignoreDuplicates: true }).then(ok)
        : sb.from('likes').delete().eq('user_id', api.user.id).eq('guide_id', gid).then(ok)),
      setSave: (gid, on) => q(() => on
        ? sb.from('saves').upsert({ user_id: api.user.id, guide_id: gid }, { onConflict: 'user_id,guide_id', ignoreDuplicates: true }).then(ok)
        : sb.from('saves').delete().eq('user_id', api.user.id).eq('guide_id', gid).then(ok)),
      setFollow: (uid, on) => q(() => on
        ? sb.from('follows').upsert({ follower_id: api.user.id, followee_id: uid }, { onConflict: 'follower_id,followee_id', ignoreDuplicates: true }).then(ok)
        : sb.from('follows').delete().eq('follower_id', api.user.id).eq('followee_id', uid).then(ok)),
      setBlock: (uid, on) => q(() => on
        ? sb.from('blocks').upsert({ blocker_id: api.user.id, blocked_id: uid }, { onConflict: 'blocker_id,blocked_id', ignoreDuplicates: true }).then(ok)
        : sb.from('blocks').delete().eq('blocker_id', api.user.id).eq('blocked_id', uid).then(ok)),
      setProgress: (gid, prog) => q(() => {
        const done = {};
        Object.keys(prog).forEach(k => { if (k !== '__on' && prog[k]) done[k] = true; });
        return sb.from('guide_progress').upsert({ user_id: api.user.id, guide_id: gid, following: !!prog.__on, done, updated_at: new Date().toISOString() }, { onConflict: 'user_id,guide_id' }).then(ok);
      }),
      report: (type, id, reason) => q(() => sb.from('reports').upsert({ reporter_id: api.user.id, target_type: type, target_id: id, reason }, { onConflict: 'reporter_id,target_type,target_id', ignoreDuplicates: true }).then(ok)),
      updateProfile: fields => q(() => sb.from('profiles').update(fields).eq('id', api.user.id).then(ok)),
      addSpot: s => q(() => sb.from('spots').upsert({ id: s.id, name: s.name, cat: s.cat, lat: s.lat, lng: s.lng, area: s.area || '', created_by: api.user.id }, { onConflict: 'id', ignoreDuplicates: true }).then(ok)),
      // 가이드 정보와 항목 목록을 화면 상태 그대로 맞춘다
      saveGuide: g => q(async () => {
        await sb.from('guides').upsert(guideRow(g), { onConflict: 'id' }).then(ok);
        const rows = g.items.map((it, i) => ({ id: it.id, guide_id: g.id, position: i, day: it.day, post_id: it.postId || null, spot_id: it.spotId, note: it.note || '', added_by: it.by || null }));
        if (rows.length) await sb.from('guide_items').upsert(rows, { onConflict: 'id' }).then(ok);
        let del = sb.from('guide_items').delete().eq('guide_id', g.id);
        if (rows.length) del = del.not('id', 'in', `(${rows.map(r => r.id).join(',')})`);
        await del.then(ok);
      }),
      deleteGuide: id => q(() => sb.from('guides').delete().eq('id', id).then(ok)),
      async uploadPhoto(postId, dataUrl) {
        const blob = await (await fetch(dataUrl)).blob();
        const path = `${api.user.id}/${postId}.jpg`;
        await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', upsert: true, cacheControl: '31536000' }).then(ok);
        return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
      },
      createPost: (p, photoDataUrl) => q(async () => {
        let url = null;
        if (photoDataUrl) url = await api.uploadPhoto(p.id, photoDataUrl);
        await sb.from('posts').insert({ id: p.id, user_id: api.user.id, spot_id: p.spotId, at: p.at, text: p.text, rating: p.rating, cost: p.cost, tags: p.tags, photo_url: url }).then(ok);
        return url;
      }),
      deletePost: id => q(async () => {
        await sb.from('posts').delete().eq('id', id).then(ok);
        await sb.storage.from('photos').remove([`${api.user.id}/${id}.jpg`]);
      }),

      /* ---------- 계정 ---------- */
      async signInEmail(email) {
        const redirectTo = location.origin + location.pathname;
        return ok(await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } }));
      },
      async signInOAuth(provider) {
        return ok(await sb.auth.signInWithOAuth({ provider, options: { redirectTo: location.origin + location.pathname } }));
      },
      async signOut() { await sb.auth.signOut(); api.user = null; },
      async deleteAccount() {
        // 사진 파일을 먼저 지우고, 계정과 데이터는 DB 함수가 한 번에 지운다
        const uid = api.user.id;
        for (;;) {
          const files = await sb.storage.from('photos').list(uid, { limit: 100 }).then(ok);
          if (!files || !files.length) break;
          await sb.storage.from('photos').remove(files.map(f => `${uid}/${f.name}`)).then(ok);
          if (files.length < 100) break;
        }
        await sb.rpc('delete_my_account').then(ok);
        await sb.auth.signOut();
        api.user = null;
      },
      flush: () => chain
    };
    return api;
  }

  window.RLCloud = { create };
})();
