alter table public.session_telemetry
  add column if not exists report_analysis jsonb not null default '{}'::jsonb;
