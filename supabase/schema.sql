-- 루트로그 Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에 통째로 붙여넣고 실행하세요. 여러 번 실행해도 안전합니다.


-- ---------- 테이블 ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '여행자' check (char_length(name) between 1 and 20),
  bio text not null default '' check (char_length(bio) <= 80),
  color text not null default '#2563eb' check (color ~ '^#[0-9a-fA-F]{6}$'),
  active_trip_id uuid,
  terms_agreed_at timestamptz,
  location_agreed_at timestamptz,
  marketing_agreed boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.spots (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  cat text not null default 'etc' check (cat in ('sight', 'food', 'cafe', 'shop', 'stay', 'etc')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  area text not null default '' check (char_length(area) <= 40),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  spot_id uuid not null references public.spots (id) on delete restrict,
  at timestamptz not null default now(),
  text text not null default '' check (char_length(text) <= 300),
  rating smallint check (rating between 1 and 5),
  cost integer not null default 0 check (cost >= 0),
  currency text not null default 'JPY' check (currency in ('KRW', 'JPY', 'USD', 'CNY')),
  tags text[] not null default '{}',
  photo_url text,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.guides (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  city text not null default '' check (char_length(city) <= 40),
  descr text not null default '' check (char_length(descr) <= 200),
  start_date date,
  forked_from uuid references public.guides (id) on delete set null,
  forked_from_title text,
  tags text[] not null default '{}',
  visibility text not null default 'public' check (visibility in ('public', 'link', 'private')),
  like_count integer not null default 0,
  save_count integer not null default 0,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.guide_items (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.guides (id) on delete cascade,
  position integer not null default 0,
  day integer not null default 1 check (day between 1 and 60),
  post_id uuid references public.posts (id) on delete set null,
  spot_id uuid not null references public.spots (id) on delete restrict,
  note text not null default '' check (char_length(note) <= 200),
  added_by uuid references public.profiles (id) on delete set null
);

create table if not exists public.likes (
  user_id uuid not null references public.profiles (id) on delete cascade,
  guide_id uuid not null references public.guides (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, guide_id)
);

create table if not exists public.saves (
  user_id uuid not null references public.profiles (id) on delete cascade,
  guide_id uuid not null references public.guides (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, guide_id)
);

create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  followee_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);

create table if not exists public.guide_progress (
  user_id uuid not null references public.profiles (id) on delete cascade,
  guide_id uuid not null references public.guides (id) on delete cascade,
  following boolean not null default true,
  done jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, guide_id)
);

create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'guide', 'user', 'comment')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 1 and 300),
  status text not null default 'open' check (status in ('open', 'resolved', 'rejected')),
  created_at timestamptz not null default now(),
  unique (reporter_id, target_type, target_id)
);

-- 사진(포스팅) 덧글
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  body text not null check (char_length(body) between 1 and 300),
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists comments_post_idx on public.comments (post_id, created_at);
-- 이미 만든 DB에서 덧글도 신고할 수 있게 한다
alter table public.reports drop constraint if exists reports_target_type_check;
alter table public.reports add constraint reports_target_type_check check (target_type in ('post', 'guide', 'user', 'comment'));

-- 이미 만든 DB에 쓴 돈 통화 열을 더한다 (원·엔은 그대로, 달러·위안은 1/100 단위로 cost에 저장)
alter table public.posts add column if not exists currency text not null default 'JPY' check (currency in ('KRW', 'JPY', 'USD', 'CNY'));

create index if not exists posts_user_idx on public.posts (user_id, at desc);
create index if not exists posts_spot_idx on public.posts (spot_id);
create index if not exists guides_owner_idx on public.guides (owner_id);
create index if not exists guides_created_idx on public.guides (created_at desc);
create index if not exists guides_forked_idx on public.guides (forked_from);
create index if not exists items_guide_idx on public.guide_items (guide_id, position);
create index if not exists items_spot_idx on public.guide_items (spot_id);
create index if not exists reports_target_idx on public.reports (target_type, target_id);

-- ---------- 트리거 ----------
-- 가입하면 프로필 자동 생성
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, color)
  values (
    new.id,
    left(coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(coalesce(new.email, '여행자'), '@', 1), '여행자'), 20),
    (array['#0f766e', '#b45309', '#be185d', '#2563eb', '#7c3aed', '#0891b2', '#c2410c'])[1 + floor(random() * 7)::int]
  )
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- 좋아요·저장 수 집계
create or replace function public.bump_guide_counts() returns trigger
language plpgsql security definer set search_path = public as $$
declare col text := case when tg_table_name = 'likes' then 'like_count' else 'save_count' end;
begin
  if tg_op = 'INSERT' then
    execute format('update public.guides set %I = %I + 1 where id = $1', col, col) using new.guide_id;
  elsif tg_op = 'DELETE' then
    execute format('update public.guides set %I = greatest(%I - 1, 0) where id = $1', col, col) using old.guide_id;
  end if;
  return null;
end $$;
drop trigger if exists likes_count on public.likes;
create trigger likes_count after insert or delete on public.likes for each row execute function public.bump_guide_counts();
drop trigger if exists saves_count on public.saves;
create trigger saves_count after insert or delete on public.saves for each row execute function public.bump_guide_counts();

-- 수정 시각
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists guides_touch on public.guides;
create trigger guides_touch before update on public.guides for each row execute function public.touch_updated_at();

-- 집계 컬럼과 숨김은 사용자가 직접 바꿀 수 없음 (트리거·관리자만)
create or replace function public.protect_guide_columns() returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.like_count := 0; new.save_count := 0; new.hidden := false;
    else
      new.like_count := old.like_count; new.save_count := old.save_count; new.hidden := old.hidden;
      new.owner_id := old.owner_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists guides_protect on public.guides;
create trigger guides_protect before insert or update on public.guides for each row execute function public.protect_guide_columns();

create or replace function public.protect_post_columns() returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then new.hidden := false;
    else new.hidden := old.hidden; new.user_id := old.user_id; end if;
  end if;
  return new;
end $$;
drop trigger if exists posts_protect on public.posts;
create trigger posts_protect before insert or update on public.posts for each row execute function public.protect_post_columns();

create or replace function public.protect_comment_columns() returns trigger language plpgsql as $$
begin
  if current_user in ('authenticated', 'anon') then new.hidden := false; new.created_at := now(); end if;
  return new;
end $$;
drop trigger if exists comments_protect on public.comments;
create trigger comments_protect before insert on public.comments for each row execute function public.protect_comment_columns();

-- 서로 다른 사용자 3명 이상이 신고하면 자동 숨김 (관리자가 대시보드에서 hidden=false 로 복구)
create or replace function public.auto_hide_reported() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  select count(distinct reporter_id) into n from public.reports
    where target_type = new.target_type and target_id = new.target_id and status = 'open';
  if n >= 3 then
    if new.target_type = 'post' then update public.posts set hidden = true where id = new.target_id;
    elsif new.target_type = 'guide' then update public.guides set hidden = true where id = new.target_id;
    elsif new.target_type = 'comment' then update public.comments set hidden = true where id = new.target_id;
    end if;
  end if;
  return null;
end $$;
drop trigger if exists reports_hide on public.reports;
create trigger reports_hide after insert on public.reports for each row execute function public.auto_hide_reported();

-- 회원 탈퇴: 본인 계정과 모든 데이터 삭제 (사진 파일은 앱이 먼저 지움)
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  update public.spots set created_by = null where created_by = auth.uid();
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------- 행 단위 보안 (RLS) ----------
alter table public.profiles enable row level security;
alter table public.spots enable row level security;
alter table public.posts enable row level security;
alter table public.guides enable row level security;
alter table public.guide_items enable row level security;
alter table public.likes enable row level security;
alter table public.saves enable row level security;
alter table public.follows enable row level security;
alter table public.guide_progress enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.comments enable row level security;

create or replace function public.can_read_guide(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.guides g
    where g.id = gid and ((g.visibility in ('public', 'link') and not g.hidden) or g.owner_id = auth.uid())
  )
$$;
create or replace function public.owns_guide(gid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.guides g where g.id = gid and g.owner_id = auth.uid())
$$;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select using (true);
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists spots_read on public.spots;
create policy spots_read on public.spots for select using (true);
drop policy if exists spots_insert on public.spots;
create policy spots_insert on public.spots for insert to authenticated with check (created_by = auth.uid());
drop policy if exists spots_update on public.spots;
create policy spots_update on public.spots for update to authenticated using (created_by = auth.uid()) with check (created_by = auth.uid());

drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts for select using (not hidden or user_id = auth.uid());
drop policy if exists posts_insert on public.posts;
create policy posts_insert on public.posts for insert to authenticated with check (user_id = auth.uid());
drop policy if exists posts_update on public.posts;
create policy posts_update on public.posts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists posts_delete on public.posts;
create policy posts_delete on public.posts for delete to authenticated using (user_id = auth.uid());

drop policy if exists guides_read on public.guides;
create policy guides_read on public.guides for select using ((visibility in ('public', 'link') and not hidden) or owner_id = auth.uid());
drop policy if exists guides_insert on public.guides;
create policy guides_insert on public.guides for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists guides_update on public.guides;
create policy guides_update on public.guides for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists guides_delete on public.guides;
create policy guides_delete on public.guides for delete to authenticated using (owner_id = auth.uid());

drop policy if exists items_read on public.guide_items;
create policy items_read on public.guide_items for select using (public.can_read_guide(guide_id));
drop policy if exists items_write on public.guide_items;
create policy items_write on public.guide_items for all to authenticated using (public.owns_guide(guide_id)) with check (public.owns_guide(guide_id));

drop policy if exists likes_own on public.likes;
create policy likes_own on public.likes for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists saves_own on public.saves;
create policy saves_own on public.saves for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists progress_own on public.guide_progress;
create policy progress_own on public.guide_progress for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists blocks_own on public.blocks;
create policy blocks_own on public.blocks for all to authenticated using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

drop policy if exists follows_read on public.follows;
create policy follows_read on public.follows for select using (true);
drop policy if exists follows_write on public.follows;
create policy follows_write on public.follows for insert to authenticated with check (follower_id = auth.uid());
drop policy if exists follows_delete on public.follows;
create policy follows_delete on public.follows for delete to authenticated using (follower_id = auth.uid());

-- 덧글: 볼 수 있는 포스팅의 덧글만 읽고, 내 이름으로만 달고, 내 덧글이나 내 포스팅의 덧글만 지운다
drop policy if exists comments_read on public.comments;
create policy comments_read on public.comments for select
  using ((not hidden or user_id = auth.uid()) and exists (select 1 from public.posts p where p.id = post_id));
drop policy if exists comments_insert on public.comments;
create policy comments_insert on public.comments for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id and not p.hidden));
drop policy if exists comments_delete on public.comments;
create policy comments_delete on public.comments for delete to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.posts p where p.id = post_id and p.user_id = auth.uid()));
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports for insert to authenticated with check (reporter_id = auth.uid());

-- ---------- 사진 저장소 ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists photos_read on storage.objects;
create policy photos_read on storage.objects for select using (bucket_id = 'photos');
drop policy if exists photos_insert on storage.objects;
create policy photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists photos_delete on storage.objects;
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
