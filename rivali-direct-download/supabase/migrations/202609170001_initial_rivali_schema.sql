create schema if not exists private;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.racers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  driver_weight_lb numeric(6,2) check (driver_weight_lb > 0),
  experience_level text check (experience_level in ('rookie','intermediate','advanced')),
  primary_class text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create table public.karts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  racer_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  chassis_make text,
  chassis_model text,
  chassis_year smallint check (chassis_year between 1980 and 2100),
  chassis_dry_weight_lb numeric(6,2) check (chassis_dry_weight_lb > 0),
  engine_make text,
  engine_model text,
  tire_brand text,
  tire_compound text,
  lf_tire_size text,
  rf_tire_size text,
  lr_tire_size text,
  rr_tire_size text,
  seat_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (racer_id, user_id) references public.racers(id, user_id) on delete cascade
);

create table public.tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 160),
  location text,
  surface_type text,
  size_notes text,
  banking_notes text,
  direction text check (direction is null or direction in ('clockwise','counterclockwise')),
  typical_prep_notes text,
  start_finish jsonb,
  turns jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, name)
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  racer_id uuid not null,
  kart_id uuid not null,
  track_id uuid not null,
  session_date date not null,
  session_type text not null check (session_type in ('practice','hot laps','heat','feature')),
  run_number smallint check (run_number > 0),
  day_sequence smallint check (day_sequence > 0),
  raw_file_name text not null,
  raw_storage_path text not null unique,
  setup jsonb not null default '{}'::jsonb,
  conditions jsonb not null default '{}'::jsonb,
  handling_feedback jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  parse_error text,
  lap_count smallint check (lap_count >= 0),
  best_lap_sec numeric(9,4) check (best_lap_sec > 0),
  average_lap_sec numeric(9,4) check (average_lap_sec > 0),
  consistency_stdev_sec numeric(9,4) check (consistency_stdev_sec >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (racer_id, user_id) references public.racers(id, user_id),
  foreign key (kart_id, user_id) references public.karts(id, user_id),
  foreign key (track_id, user_id) references public.tracks(id, user_id)
);

create table public.session_telemetry (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  laps jsonb not null default '[]'::jsonb,
  gps_trace jsonb not null default '[]'::jsonb,
  corner_analysis jsonb not null default '{}'::jsonb,
  channel_manifest jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (session_id, user_id) references public.sessions(id, user_id) on delete cascade
);

create table public.processing_jobs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  status text not null default 'queued' check (status in ('queued','processing','completed','failed')),
  attempts smallint not null default 0 check (attempts between 0 and 10),
  locked_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (session_id),
  foreign key (session_id, user_id) references public.sessions(id, user_id) on delete cascade
);

create table public.recommendations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null,
  recommendation text not null,
  evidence jsonb not null default '[]'::jsonb,
  confidence text not null check (confidence in ('low','medium','high')),
  created_at timestamptz not null default now(),
  unique (session_id),
  foreign key (session_id, user_id) references public.sessions(id, user_id) on delete cascade
);

create index racers_user_id_idx on public.racers(user_id);
create index karts_user_id_idx on public.karts(user_id);
create index karts_racer_id_idx on public.karts(racer_id);
create index tracks_user_id_idx on public.tracks(user_id);
create index sessions_user_date_idx on public.sessions(user_id, session_date desc);
create index sessions_racer_track_idx on public.sessions(racer_id, track_id, session_date desc);
create index sessions_kart_id_idx on public.sessions(kart_id);
create index session_telemetry_user_id_idx on public.session_telemetry(user_id);
create index processing_jobs_queue_idx on public.processing_jobs(status, created_at) where status = 'queued';
create index processing_jobs_user_id_idx on public.processing_jobs(user_id);
create index recommendations_user_id_idx on public.recommendations(user_id);
create index recommendations_session_id_idx on public.recommendations(session_id);

alter table public.profiles enable row level security;
alter table public.racers enable row level security;
alter table public.karts enable row level security;
alter table public.tracks enable row level security;
alter table public.sessions enable row level security;
alter table public.session_telemetry enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.recommendations enable row level security;

create policy "profiles_select_own" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "profiles_update_own" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

create policy "racers_select_own" on public.racers for select to authenticated using ((select auth.uid()) = user_id);
create policy "racers_insert_own" on public.racers for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "racers_update_own" on public.racers for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "racers_delete_own" on public.racers for delete to authenticated using ((select auth.uid()) = user_id);

create policy "karts_select_own" on public.karts for select to authenticated using ((select auth.uid()) = user_id);
create policy "karts_insert_own" on public.karts for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "karts_update_own" on public.karts for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "karts_delete_own" on public.karts for delete to authenticated using ((select auth.uid()) = user_id);

create policy "tracks_select_own" on public.tracks for select to authenticated using ((select auth.uid()) = user_id);
create policy "tracks_insert_own" on public.tracks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "tracks_update_own" on public.tracks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "tracks_delete_own" on public.tracks for delete to authenticated using ((select auth.uid()) = user_id);

create policy "sessions_select_own" on public.sessions for select to authenticated using ((select auth.uid()) = user_id);
create policy "sessions_insert_own" on public.sessions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "sessions_update_own" on public.sessions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "sessions_delete_own" on public.sessions for delete to authenticated using ((select auth.uid()) = user_id);

create policy "telemetry_select_own" on public.session_telemetry for select to authenticated using ((select auth.uid()) = user_id);
create policy "telemetry_insert_own" on public.session_telemetry for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "telemetry_update_own" on public.session_telemetry for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "jobs_select_own" on public.processing_jobs for select to authenticated using ((select auth.uid()) = user_id);
create policy "jobs_insert_own" on public.processing_jobs for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "recommendations_select_own" on public.recommendations for select to authenticated using ((select auth.uid()) = user_id);

grant usage on schema public to authenticated;
grant select, insert, update, delete on public.profiles, public.racers, public.karts, public.tracks, public.sessions, public.session_telemetry, public.processing_jobs, public.recommendations to authenticated;
grant usage, select on all sequences in schema public to authenticated;

create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name) values(new.id, new.raw_user_meta_data ->> 'display_name');
  return new;
end; $$;
revoke all on function private.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

create or replace function public.claim_processing_job()
returns table(job_id bigint, session_id uuid, user_id uuid, raw_storage_path text)
language sql security invoker set search_path = '' as $$
  with candidate as (
    select j.id from public.processing_jobs j
    where j.status = 'queued' and j.attempts < 10
    order by j.created_at for update skip locked limit 1
  ), claimed as (
    update public.processing_jobs j set status='processing', attempts=j.attempts+1, locked_at=now(), updated_at=now()
    from candidate c where j.id=c.id
    returning j.id, j.session_id, j.user_id
  )
  select c.id, c.session_id, c.user_id, s.raw_storage_path
  from claimed c join public.sessions s on s.id=c.session_id;
$$;
revoke all on function public.claim_processing_job() from public, anon, authenticated;
grant execute on function public.claim_processing_job() to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('telemetry','telemetry',false,104857600,array['application/octet-stream','application/x-binary'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy "telemetry_files_select_own" on storage.objects for select to authenticated
using (bucket_id='telemetry' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "telemetry_files_insert_own" on storage.objects for insert to authenticated
with check (bucket_id='telemetry' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "telemetry_files_update_own" on storage.objects for update to authenticated
using (bucket_id='telemetry' and (storage.foldername(name))[1]=(select auth.uid())::text)
with check (bucket_id='telemetry' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "telemetry_files_delete_own" on storage.objects for delete to authenticated
using (bucket_id='telemetry' and (storage.foldername(name))[1]=(select auth.uid())::text);
