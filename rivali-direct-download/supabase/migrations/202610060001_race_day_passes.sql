create table public.race_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id uuid not null,
  name text not null check (char_length(name) between 1 and 160),
  event_date date not null,
  status text not null default 'open' check (status in ('open','closed','cancelled')),
  default_price_cents integer not null default 10000 check (default_price_cents between 0 and 1000000),
  conditions jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (track_id, user_id) references public.tracks(id, user_id)
);

create table public.race_day_passes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  race_day_id uuid not null,
  code text not null unique check (char_length(code) between 6 and 20),
  status text not null default 'paid' check (status in ('paid','active','expired','revoked')),
  price_cents integer not null check (price_cents between 0 and 1000000),
  class_name text not null check (char_length(class_name) between 1 and 120),
  driver_name text,
  phone text,
  email text,
  driving_style text check (driving_style is null or driving_style in ('lift','burp_throttle','full_throttle_brake_drag','other')),
  racer_id uuid,
  kart_id uuid,
  access_token_hash text unique,
  claimed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (race_day_id, user_id) references public.race_days(id, user_id) on delete cascade,
  foreign key (racer_id, user_id) references public.racers(id, user_id),
  foreign key (kart_id, user_id) references public.karts(id, user_id)
);

alter table public.sessions
  add column race_day_pass_id uuid references public.race_day_passes(id) on delete set null,
  add column report_status text not null default 'not_requested' check (report_status in ('not_requested','processing','pending_approval','approved','sent','rejected')),
  add column report_approved_at timestamptz,
  add column report_sent_at timestamptz;

create index race_days_user_date_idx on public.race_days(user_id, event_date desc);
create index race_day_passes_user_day_idx on public.race_day_passes(user_id, race_day_id, created_at desc);
create index race_day_passes_code_idx on public.race_day_passes(code);
create index race_day_passes_access_token_idx on public.race_day_passes(access_token_hash) where access_token_hash is not null;
create index sessions_race_day_pass_idx on public.sessions(race_day_pass_id) where race_day_pass_id is not null;
create index sessions_report_queue_idx on public.sessions(user_id, report_status, created_at desc);

alter table public.race_days enable row level security;
alter table public.race_day_passes enable row level security;

create policy "race_days_select_own" on public.race_days for select to authenticated using ((select auth.uid()) = user_id);
create policy "race_days_insert_own" on public.race_days for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "race_days_update_own" on public.race_days for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "race_days_delete_own" on public.race_days for delete to authenticated using ((select auth.uid()) = user_id);

create policy "race_day_passes_select_own" on public.race_day_passes for select to authenticated using ((select auth.uid()) = user_id);
create policy "race_day_passes_insert_own" on public.race_day_passes for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "race_day_passes_update_own" on public.race_day_passes for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "race_day_passes_delete_own" on public.race_day_passes for delete to authenticated using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.race_days, public.race_day_passes to authenticated;
