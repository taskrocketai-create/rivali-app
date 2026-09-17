-- Knowledge is curated by Rivali staff and consumed globally by the worker.
-- Authorization is held in app_metadata because user_metadata is user-editable.
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"rivali_admin"}'::jsonb
where lower(email) = 'ahoward@taskrocket.org';

create or replace function private.assign_rivali_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if lower(new.email) = 'ahoward@taskrocket.org' then
    new.raw_app_meta_data := coalesce(new.raw_app_meta_data, '{}'::jsonb) || '{"role":"rivali_admin"}'::jsonb;
  end if;
  return new;
end;
$$;

revoke all on function private.assign_rivali_admin() from public, anon, authenticated;
drop trigger if exists assign_rivali_admin_before_signup on auth.users;
create trigger assign_rivali_admin_before_signup before insert on auth.users
for each row execute function private.assign_rivali_admin();

drop policy if exists "knowledge_select_own" on public.knowledge_items;
drop policy if exists "knowledge_insert_own" on public.knowledge_items;
drop policy if exists "knowledge_update_own" on public.knowledge_items;
drop policy if exists "knowledge_delete_own" on public.knowledge_items;

create policy "knowledge_admin_select" on public.knowledge_items for select to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'rivali_admin');
create policy "knowledge_admin_insert" on public.knowledge_items for insert to authenticated
with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'rivali_admin' and (select auth.uid()) = user_id);
create policy "knowledge_admin_update" on public.knowledge_items for update to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'rivali_admin')
with check (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'rivali_admin' and (select auth.uid()) = user_id);
create policy "knowledge_admin_delete" on public.knowledge_items for delete to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'rivali_admin');

drop policy if exists "knowledge_files_select_own" on storage.objects;
drop policy if exists "knowledge_files_insert_own" on storage.objects;
drop policy if exists "knowledge_files_update_own" on storage.objects;
drop policy if exists "knowledge_files_delete_own" on storage.objects;

create policy "knowledge_files_admin_select" on storage.objects for select to authenticated
using (bucket_id = 'knowledge' and ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'rivali_admin');
create policy "knowledge_files_admin_insert" on storage.objects for insert to authenticated
with check (bucket_id = 'knowledge' and ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'rivali_admin' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "knowledge_files_admin_update" on storage.objects for update to authenticated
using (bucket_id = 'knowledge' and ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'rivali_admin')
with check (bucket_id = 'knowledge' and ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'rivali_admin' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "knowledge_files_admin_delete" on storage.objects for delete to authenticated
using (bucket_id = 'knowledge' and ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'rivali_admin');
