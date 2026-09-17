alter table public.knowledge_items
  drop constraint if exists knowledge_items_source_type_check;

alter table public.knowledge_items
  add constraint knowledge_items_source_type_check check (
    source_type in (
      'manual','youtube','uploaded_video','manufacturer_manual','book','article',
      'video','podcast','race_observation','test_result','other'
    )
  ),
  add column if not exists source_platform text,
  add column if not exists source_upload_id uuid,
  add column if not exists knowledge_category text check (
    knowledge_category is null or knowledge_category in (
      'definition','general_principle','specific_numeric_recommendation','disputed_or_opinion'
    )
  ),
  add column if not exists confidence_note text;

create table public.knowledge_upload_jobs (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references auth.users(id) on delete cascade,
  original_filename text not null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint not null check (size_bytes > 0),
  source_platform text,
  status text not null default 'queued' check (
    status in ('queued','uploading','transcribing','extracting','completed','failed')
  ),
  knowledge_points_added integer not null default 0 check (knowledge_points_added >= 0),
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.knowledge_items
  add constraint knowledge_items_source_upload_id_fkey
  foreign key (source_upload_id) references public.knowledge_upload_jobs(id) on delete set null;

create index knowledge_upload_jobs_status_created_idx
  on public.knowledge_upload_jobs(status, created_at);
create index knowledge_upload_jobs_uploader_created_idx
  on public.knowledge_upload_jobs(uploader_id, created_at desc);

alter table public.knowledge_upload_jobs enable row level security;

create policy "knowledge_upload_admin_select" on public.knowledge_upload_jobs
for select to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'rivali_admin');

create policy "knowledge_upload_admin_insert" on public.knowledge_upload_jobs
for insert to authenticated
with check (
  (select auth.uid()) = uploader_id
  and ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'rivali_admin'
);

grant select, insert on public.knowledge_upload_jobs to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'knowledge-video-intake',
  'knowledge-video-intake',
  false,
  524288000,
  array[
    'video/mp4','video/quicktime','video/webm','video/x-matroska','video/x-msvideo',
    'audio/mpeg','audio/mp4','audio/wav','audio/x-wav','audio/webm'
  ]
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create policy "knowledge_video_admin_insert" on storage.objects
for insert to authenticated
with check (
  bucket_id='knowledge-video-intake'
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'rivali_admin'
);

create policy "knowledge_video_admin_delete" on storage.objects
for delete to authenticated
using (
  bucket_id='knowledge-video-intake'
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'rivali_admin'
);

create index knowledge_items_source_upload_idx on public.knowledge_items(source_upload_id)
  where source_upload_id is not null;
create index knowledge_items_supersedes_idx on public.knowledge_items(supersedes_id)
  where supersedes_id is not null;
create index knowledge_items_track_user_idx on public.knowledge_items(track_id, user_id)
  where track_id is not null;
create index knowledge_items_kart_user_idx on public.knowledge_items(kart_id, user_id)
  where kart_id is not null;
