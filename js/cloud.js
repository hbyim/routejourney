/* 서버(Supabase) 연동 계층. 앱은 화면용 메모리 데이터(db)를 쓰고, 이 모듈이 서버와 맞춰준다. */
(function () {
  'use strict';

  const CHUNK = 100;
  const chunks = (arr, n = CHUNK) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
  const uniq = arr => Array.from(new Set(arr.filter(Boolean)));
  // 공개 사진 주소에서 photos 버킷 안의 경로만 꺼낸다 (?v= 같은 뒷부분은 뺀다)
  const photoPath = url => { const m = /\/object\/public\/photos\/([^?#]+)/.exec(url || ''); return m ? decodeURIComponent(m[1]) : null; };

  function create(cfg) {
    const webBase = () => (window.Capacitor && window.Capacitor.isNativePlatform() && cfg.publicUrl) || location.origin + location.pathname;
    if (!cfg || !cfg.supabaseUrl || !cfg.supabaseAnonKey || !window.supabase) return null;
    // 앱: 웹뷰 localStorage는 앱을 껐다 켜거나 iOS가 저장 공간을 정리할 때 지워질 수 있어서,
    // 로그인 정보는 기기 저장소(iOS UserDefaults, 안드로이드 SharedPreferences)에 둔다.
    // 예전 버전이 localStorage에 남긴 로그인 정보가 있으면 처음 한 번 옮겨 온다.
    const Prefs = window.Capacitor && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;
    const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, del: k => { try { localStorage.removeItem(k); } catch (e) { /* noop */ } } };
    const storage = Prefs ? {
      async getItem(key) {
        const { value } = await Prefs.get({ key });
        if (value != null) return value;
        const old = ls.get(key);
        if (old != null) { await Prefs.set({ key, value: old }); ls.del(key); }
        return old;
      },
      setItem: (key, value) => Prefs.set({ key, value }),
      removeItem: key => Prefs.remove({ key })
    } : undefined;
    const sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      // 로그인 링크를 요청한 브라우저가 아닌 곳(메일 앱 안 브라우저, 다른 기기)에서 열어도 로그인되도록 implicit 방식을 쓴다.
      // pkce는 요청한 브라우저에만 남는 검증값이 필요해서, 다른 곳에서 링크를 열면 조용히 실패한다.
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storage }
    });

    // 앱: 소셜 로그인을 마친 브라우저가 com.mytripatoz.routelog://auth#access_token=... 로 앱을 다시 연다
    const Plugins = window.Capacitor && window.Capacitor.isNativePlatform() && window.Capacitor.Plugins;
    const NATIVE_AUTH = 'com.mytripatoz.routelog://auth';
    if (Plugins && Plugins.App) {
      Plugins.App.addListener('appUrlOpen', async ({ url }) => {
        if (!url || !url.startsWith(NATIVE_AUTH)) return;
        if (Plugins.Browser) Plugins.Browser.close().catch(() => {});
        const p = new URLSearchParams(url.slice(NATIVE_AUTH.length).replace(/^[/?#]+/, '').replace('#', '&'));
        try {
          if (p.get('access_token')) ok(await sb.auth.setSession({ access_token: p.get('access_token'), refresh_token: p.get('refresh_token') }));
          else if (p.get('code')) ok(await sb.auth.exchangeCodeForSession(p.get('code')));
          else throw new Error(p.get('error_description') || p.get('error') || 'no token');
        } catch (err) {
          console.error(err);
          window.dispatchEvent(new CustomEvent('routelog:oauth-error', { detail: String(err && err.message || err) }));
        }
      });
    }

    // posts.weather 열을 아직 추가하지 않은 DB: 날씨만 빼고 다시 저장한다 (나머지 기록은 잃지 않게)
    const withoutMissingWeather = async (row, send) => {
      const res = await send(row);
      if (!res.error || !/weather/.test(res.error.message || '')) return res;
      console.warn('posts.weather 열이 없어 날씨 없이 저장해요. supabase/schema.sql 끝의 날씨 열 추가 SQL을 실행하세요.');
      delete row.weather;
      return send(row);
    };

    // 쓰기는 한 줄로 세워 순서를 지킨다 (스팟 → 포스트 → 가이드 → 항목 순으로 외래키가 맞도록)
    let chain = Promise.resolve();
    const q = fn => { const p = chain.then(fn); chain = p.catch(() => {}); return p; };
    const ok = ({ data, error }) => { if (error) throw error; return data; };

    /* ---------- 행 ↔ 앱 모델 ---------- */
    const toUser = r => ({ id: r.id, name: r.name, bio: r.bio || '', color: r.color, activeTripId: r.active_trip_id, termsAgreedAt: r.terms_agreed_at, locationAgreedAt: r.location_agreed_at, marketing: r.marketing_agreed });
    const toSpot = r => ({ id: r.id, name: r.name, cat: r.cat, lat: r.lat, lng: r.lng, area: r.area || '' });
    const toPost = r => ({ id: r.id, userId: r.user_id, spotId: r.spot_id, at: r.at, text: r.text || '', rating: r.rating, cost: r.cost || 0, currency: r.currency || 'JPY', weather: r.weather || null, tags: r.tags || [], photo: r.photo_url, hidden: r.hidden });
    const toComment = r => ({ id: r.id, postId: r.post_id, userId: r.user_id, body: r.body, at: r.created_at, hidden: r.hidden });
    // 덧글 테이블을 아직 안 만들었으면(서버 SQL 미실행) 알아들을 수 있는 말로 바꾼다
    const noTable = err => {
      if (err && (err.code === 'PGRST205' || err.code === '42P01')) err.userMessage = '덧글 기능은 서버 설정(SQL 실행)을 마치면 쓸 수 있어요.';
      throw err;
    };
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
      authError: null,
      recovery: false,
      async init() {
        // 만료되거나 이미 쓴 링크로 돌아오면 주소에 error_code가 붙어 온다
        const h = new URLSearchParams(location.hash.slice(1)), qs = new URLSearchParams(location.search);
        api.recovery = h.get('type') === 'recovery';
        const code = h.get('error_code') || qs.get('error_code') || h.get('error') || qs.get('error');
        const { data, error } = await sb.auth.getSession();
        api.user = data.session ? data.session.user : null;
        if (code || (error && !api.user)) api.authError = code || error.code || error.message || 'unknown';
        // 주소창에 남은 인증 값(토큰, 코드, 오류)을 지운다
        const authHash = /(^|[#&])(access_token|refresh_token|error|error_code|error_description)=/.test(location.hash);
        if (qs.has('code') || qs.has('error') || qs.has('error_code') || authHash) {
          history.replaceState(null, '', location.pathname + (authHash ? '' : location.hash));
        }
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
      async listComments(db, postId) {
        const rows = await sb.from('comments').select('*').eq('post_id', postId).order('created_at').limit(300).then(ok).catch(noTable);
        Object.keys(db.comments).forEach(k => { if (db.comments[k].postId === postId) delete db.comments[k]; });
        rows.forEach(r => { db.comments[r.id] = toComment(r); });
        const ids = uniq(rows.map(r => r.user_id)).filter(id => !db.users[id]);
        if (ids.length) (await sb.from('profiles').select('id,name,bio,color').in('id', ids).then(ok)).forEach(r => { db.users[r.id] = toUser(r); });
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
      addComment: c => q(() => sb.from('comments').insert({ id: c.id, post_id: c.postId, user_id: api.user.id, body: c.body }).then(ok).catch(noTable)),
      deleteComment: id => q(() => sb.from('comments').delete().eq('id', id).then(ok)),
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
      async uploadPhoto(postId, dataUrl, name = postId) {
        const blob = await (await fetch(dataUrl)).blob();
        const path = `${api.user.id}/${name}.jpg`;
        // 포스팅마다 새 경로라 덮어쓰기(upsert)가 필요 없다. upsert는 저장소 UPDATE 권한까지 요구하는데 photos 버킷에는 그 정책이 없어 업로드가 거부됐다.
        await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000' }).then(ok);
        return sb.storage.from('photos').getPublicUrl(path).data.publicUrl;
      },
      createPost: (p, photoDataUrl) => q(async () => {
        let url = null;
        if (photoDataUrl) url = await api.uploadPhoto(p.id, photoDataUrl);
        const row = { id: p.id, user_id: api.user.id, spot_id: p.spotId, at: p.at, text: p.text, rating: p.rating, cost: p.cost, currency: p.currency || 'JPY', weather: p.weather || null, tags: p.tags, photo_url: url };
        const res = await withoutMissingWeather(row, r => sb.from('posts').insert(r));
        if (res.error && /currency/.test(res.error.message || '')) {
          // posts.currency 열을 아직 추가하지 않은 DB: 엔은 예전처럼 저장하고, 다른 통화는 잘못된 금액이 남지 않게 막는다
          if (row.currency !== 'JPY') throw Object.assign(new Error(res.error.message), { userMessage: '아직 엔 외의 통화는 저장할 수 없어요. 운영자에게 알려주세요.' });
          delete row.currency;
          await sb.from('posts').insert(row).then(ok);
        } else ok(res);
        return url;
      }),
      // 사진을 바꾸면 새 파일 이름으로 먼저 올리고, 포스팅이 새 주소를 가리킨 뒤에 예전 파일을 지운다.
      // 덮어쓰기 권한이 없고, 중간에 실패해도 포스팅이 없는 파일을 가리키지 않게 하기 위해서다.
      updatePost: (p, photoDataUrl, oldPhotoUrl) => q(async () => {
        let url = null;
        if (photoDataUrl) url = await api.uploadPhoto(p.id, photoDataUrl, `${p.id}-${Date.now().toString(36)}`);
        const row = { spot_id: p.spotId, at: p.at, text: p.text, rating: p.rating, cost: p.cost, currency: p.currency || 'JPY', weather: p.weather || null, tags: p.tags };
        if (url) row.photo_url = url;
        ok(await withoutMissingWeather(row, r => sb.from('posts').update(r).eq('id', p.id).eq('user_id', api.user.id)));
        const old = url && photoPath(oldPhotoUrl);
        if (old) await sb.storage.from('photos').remove([old]);
        return url;
      }),
      deletePost: (id, photoUrl) => q(async () => {
        await sb.from('posts').delete().eq('id', id).then(ok);
        await sb.storage.from('photos').remove(uniq([`${api.user.id}/${id}.jpg`, photoPath(photoUrl)].filter(Boolean)));
      }),

      /* ---------- 계정 ---------- */
      // 메일 인증 없이 바로 가입한다 (Supabase의 Confirm email 설정을 끈 경우). 켜져 있으면 session 없이 돌아온다.
      async signUp(email, password) {
        return ok(await sb.auth.signUp({ email, password, options: { data: { has_password: true }, emailRedirectTo: webBase() } }));
      },
      async resetPassword(email) {
        return ok(await sb.auth.resetPasswordForEmail(email, { redirectTo: webBase() }));
      },
      // 메일로 받은 인증번호 확인. type: signup(가입 확인) | recovery(비밀번호 재설정)
      async verifyEmailCode(email, token, type) {
        const data = ok(await sb.auth.verifyOtp({ email, token, type }));
        if (data && data.user) api.user = data.user;
        return data;
      },
      async resendSignupCode(email) {
        return ok(await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: webBase() } }));
      },
      async signInPassword(email, password) {
        return ok(await sb.auth.signInWithPassword({ email, password }));
      },
      hasPassword() { return !!(api.user && api.user.user_metadata && api.user.user_metadata.has_password); },
      async setPassword(password) {
        const data = ok(await sb.auth.updateUser({ password, data: { has_password: true } }));
        if (data && data.user) api.user = data.user;
        return data;
      },
      async signInOAuth(provider) {
        // 앱 안에서는 구글이 웹뷰 로그인을 막으므로 기기 브라우저로 열고, 끝나면 앱 주소(NATIVE_AUTH)로 돌아온다
        if (Plugins && Plugins.Browser) {
          // 웹 주소(app-auth.html)로 받아서 앱 주소로 넘긴다. 앱 주소를 바로 쓰면 서버 허용 목록에 없을 때 웹사이트로 가 버리고,
          // 일부 브라우저는 사용자가 누르지 않은 앱 주소 이동을 막는다.
          const redirectTo = cfg.publicUrl ? cfg.publicUrl.replace(/\/?$/, '/') + 'app-auth.html' : NATIVE_AUTH;
          const data = ok(await sb.auth.signInWithOAuth({ provider, options: { redirectTo, skipBrowserRedirect: true } }));
          await Plugins.Browser.open({ url: data.url, presentationStyle: 'popover' });
          return data;
        }
        return ok(await sb.auth.signInWithOAuth({ provider, options: { redirectTo: webBase() } }));
      },
      // 서버에서 켜 둔 소셜 로그인 목록 ({ google: true, apple: false, ... })
      async providers() {
        const r = await fetch(cfg.supabaseUrl + '/auth/v1/settings', { headers: { apikey: cfg.supabaseAnonKey } });
        if (!r.ok) throw new Error('settings ' + r.status);
        return (await r.json()).external || {};
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
