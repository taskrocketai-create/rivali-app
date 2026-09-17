create table public.knowledge_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 3 and 200),
  body text not null check (char_length(body) between 10 and 50000),
  source_type text not null check (source_type in ('manual','manufacturer_manual','book','article','video','podcast','race_observation','test_result','other')),
  source_name text,
  source_url text,
  source_file_path text,
  evidence_level text not null check (evidence_level in ('opinion','anecdotal','manufacturer','measured','controlled_test')),
  confidence text not null check (confidence in ('low','medium','high')),
  status text not null default 'draft' check (status in ('draft','active','disputed','archived')),
  track_id uuid,
  kart_id uuid,
  class_name text,
  tire_compound text,
  tags text[] not null default '{}',
  effective_date date,
  supersedes_id uuid references public.knowledge_items(id),
  search_vector tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(body, '')), 'B') ||
    setweight(to_tsvector('english', array_to_string(tags, ' ')), 'C')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (track_id, user_id) references public.tracks(id, user_id),
  foreign key (kart_id, user_id) references public.karts(id, user_id)
);

create index knowledge_items_user_status_idx on public.knowledge_items(user_id, status, updated_at desc);
create index knowledge_items_track_idx on public.knowledge_items(track_id) where track_id is not null;
create index knowledge_items_kart_idx on public.knowledge_items(kart_id) where kart_id is not null;
create index knowledge_items_search_idx on public.knowledge_items using gin(search_vector);
create index knowledge_items_tags_idx on public.knowledge_items using gin(tags);

alter table public.knowledge_items enable row level security;
create policy "knowledge_select_own" on public.knowledge_items for select to authenticated using ((select auth.uid()) = user_id);
create policy "knowledge_insert_own" on public.knowledge_items for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "knowledge_update_own" on public.knowledge_items for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "knowledge_delete_own" on public.knowledge_items for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.knowledge_items to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('knowledge','knowledge',false,26214400,array['application/pdf','text/plain','text/markdown','text/csv','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/octet-stream'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy "knowledge_files_select_own" on storage.objects for select to authenticated
using (bucket_id='knowledge' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "knowledge_files_insert_own" on storage.objects for insert to authenticated
with check (bucket_id='knowledge' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "knowledge_files_update_own" on storage.objects for update to authenticated
using (bucket_id='knowledge' and (storage.foldername(name))[1]=(select auth.uid())::text)
with check (bucket_id='knowledge' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "knowledge_files_delete_own" on storage.objects for delete to authenticated
using (bucket_id='knowledge' and (storage.foldername(name))[1]=(select auth.uid())::text);
