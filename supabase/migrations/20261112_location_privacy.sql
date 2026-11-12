-- 2026-11-12 위치정보 보완
-- 1) 포스팅 읽기 규칙: 가이드 공개 범위를 따른다
--    작성자 본인은 항상, 다른 사람은 '전체 공개' 또는 '링크 공유' 가이드에 들어간 포스팅만 읽을 수 있다.
--    '나만 보기' 가이드에만 있는 포스팅의 장소·방문 시각은 다른 사람이 조회할 수 없다.
-- 2) 목록 노출 여부(listed): 피드·프로필·스팟 화면에는 '전체 공개' 가이드의 포스팅만 띄운다.
-- 3) 위치정보 이용·제공사실 확인자료(location_logs): '현재 위치'를 쓸 때마다 자동 기록하고 6개월 보관 후 파기한다.
-- 여러 번 실행해도 안전하다.

create index if not exists items_post_idx on public.guide_items (post_id);

create or replace function public.can_read_post(pid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.guide_items gi join public.guides g on g.id = gi.guide_id
    where gi.post_id = pid and g.visibility in ('public', 'link') and not g.hidden
  )
$$;

drop policy if exists posts_read on public.posts;
create policy posts_read on public.posts for select
  using (user_id = auth.uid() or (not hidden and public.can_read_post(id)));

-- PostgREST 계산 열: select=*,listed
create or replace function public.listed(p public.posts) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.guide_items gi join public.guides g on g.id = gi.guide_id
    where gi.post_id = p.id and g.visibility = 'public' and not g.hidden
  )
$$;

-- 위치정보 이용·제공사실 확인자료. 탈퇴해도 법정 보관 기간 동안 남도록 계정과 연결(FK)하지 않는다.
create table if not exists public.location_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid(),
  used_at timestamptz not null default now(),
  purpose text not null check (purpose in ('post_location')),
  service text not null default '포스팅 장소 입력(현재 위치)',
  provided_to text
);
create index if not exists location_logs_user_idx on public.location_logs (user_id, used_at desc);
create index if not exists location_logs_used_idx on public.location_logs (used_at);
alter table public.location_logs enable row level security;
drop policy if exists location_logs_insert on public.location_logs;
create policy location_logs_insert on public.location_logs for insert to authenticated
  with check (user_id = auth.uid() and used_at > now() - interval '1 minute' and used_at < now() + interval '1 minute');
drop policy if exists location_logs_read on public.location_logs;
create policy location_logs_read on public.location_logs for select to authenticated using (user_id = auth.uid());

create or replace function public.purge_location_logs() returns integer
language sql security definer set search_path = public as $$
  with d as (delete from public.location_logs where used_at < now() - interval '6 months 1 day' returning 1)
  select count(*)::integer from d
$$;
revoke all on function public.purge_location_logs() from public, anon, authenticated;

-- 매일 새벽 3시 30분(UTC)에 6개월 지난 확인자료를 지운다. pg_cron을 쓸 수 없으면 안내만 남긴다.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('purge-location-logs', '30 3 * * *', 'select public.purge_location_logs()');
exception when others then
  raise notice 'pg_cron 예약 실패(수동으로 purge_location_logs()를 주기적으로 실행하세요): %', sqlerrm;
end $$;
