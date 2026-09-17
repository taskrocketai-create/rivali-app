create table public.voice_debriefs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  audio_storage_path text not null unique,
  audio_mime_type text not null,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  transcript text,
  status text not null default 'uploaded' check (status in ('uploaded','transcribing','completed','failed')),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (session_id, user_id) references public.sessions(id, user_id) on delete cascade
);

create index voice_debriefs_user_created_idx on public.voice_debriefs(user_id, created_at desc);
create index voice_debriefs_session_idx on public.voice_debriefs(session_id, created_at desc);

alter table public.voice_debriefs enable row level security;

create policy "voice_debriefs_select_own" on public.voice_debriefs for select to authenticated
using ((select auth.uid()) = user_id);
create policy "voice_debriefs_insert_own" on public.voice_debriefs for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "voice_debriefs_update_own" on public.voice_debriefs for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "voice_debriefs_delete_own" on public.voice_debriefs for delete to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.voice_debriefs to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'voice-debriefs',
  'voice-debriefs',
  false,
  26214400,
  array['audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav','audio/x-wav']
)
on conflict(id) do update set
  public=false,
  file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;

create policy "voice_debrief_files_select_own" on storage.objects for select to authenticated
using (bucket_id='voice-debriefs' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "voice_debrief_files_insert_own" on storage.objects for insert to authenticated
with check (bucket_id='voice-debriefs' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "voice_debrief_files_delete_own" on storage.objects for delete to authenticated
using (bucket_id='voice-debriefs' and (storage.foldername(name))[1]=(select auth.uid())::text);
