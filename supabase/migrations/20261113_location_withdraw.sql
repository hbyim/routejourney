-- 2026-11-13 위치기반서비스 동의 철회·탈퇴 시 위치정보 이용사실 확인자료 파기
-- 「위치정보의 보호 및 이용 등에 관한 법률」 제24조 제4항: 동의를 철회하면 확인자료를 지체 없이 파기한다.
-- 프로필의 위치기반서비스 동의를 끄거나(location_agreed_at → null) 계정을 삭제하면(프로필 삭제) 그 이용자의 확인자료를 지운다.
-- 여러 번 실행해도 안전하다.

create or replace function public.purge_my_location_logs() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.location_logs where user_id = old.id;
  return null;
end $$;
revoke all on function public.purge_my_location_logs() from public, anon, authenticated;

drop trigger if exists profiles_location_withdraw on public.profiles;
create trigger profiles_location_withdraw after update of location_agreed_at on public.profiles
  for each row when (old.location_agreed_at is not null and new.location_agreed_at is null)
  execute function public.purge_my_location_logs();

drop trigger if exists profiles_deleted_location_logs on public.profiles;
create trigger profiles_deleted_location_logs after delete on public.profiles
  for each row execute function public.purge_my_location_logs();
