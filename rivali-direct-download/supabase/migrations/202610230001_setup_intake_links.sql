create table if not exists public.setup_intake_invites (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  recipient_name text,
  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.kart_setup_baselines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  racer_id uuid not null,
  kart_id uuid not null,
  source_invite_id uuid references public.setup_intake_invites(id) on delete set null,
  setup jsonb not null default '{}'::jsonb,
  status text not null default 'pending_review' check (status in ('pending_review','approved','rejected')),
  submitted_at timestamptz not null default now(),
  foreign key (racer_id,user_id) references public.racers(id,user_id),
  foreign key (kart_id,user_id) references public.karts(id,user_id)
);
create index if not exists kart_setup_baselines_owner_idx on public.kart_setup_baselines(user_id,kart_id,submitted_at desc);
create index if not exists setup_intake_invites_owner_idx on public.setup_intake_invites(owner_id,created_at desc);
alter table public.setup_intake_invites enable row level security;
alter table public.kart_setup_baselines enable row level security;
create policy "Invite owner select" on public.setup_intake_invites for select to authenticated using ((select auth.uid())=owner_id);
create policy "Invite owner insert" on public.setup_intake_invites for insert to authenticated with check ((select auth.uid())=owner_id);
create policy "Invite owner revoke" on public.setup_intake_invites for update to authenticated using ((select auth.uid())=owner_id) with check ((select auth.uid())=owner_id);
create policy "Baseline owner select" on public.kart_setup_baselines for select to authenticated using ((select auth.uid())=user_id);
create policy "Baseline owner update" on public.kart_setup_baselines for update to authenticated using ((select auth.uid())=user_id) with check ((select auth.uid())=user_id);
revoke all on public.setup_intake_invites from anon;
revoke all on public.kart_setup_baselines from anon;
grant select,insert,update on public.setup_intake_invites to authenticated;
grant select,update on public.kart_setup_baselines to authenticated;

create or replace function public.check_setup_intake_link(p_token text)
returns table(valid boolean, recipient_name text)
language plpgsql security definer
set search_path = ''
as $$
begin
 return query
 select true, i.recipient_name
 from public.setup_intake_invites i
 where i.token_hash = encode(sha256(convert_to(p_token,'UTF8')),'hex')
   and i.revoked_at is null and i.expires_at > now()
   and length(p_token)=64
 limit 1;
end
$$;
revoke all on function public.check_setup_intake_link(text) from public;
grant execute on function public.check_setup_intake_link(text) to anon,authenticated;

create or replace function public.submit_kart_setup_intake(
 p_token text, p_driver_name text, p_karts jsonb
)
returns jsonb language plpgsql security definer
set search_path = ''
as $$
declare
 inv public.setup_intake_invites%rowtype;
 driver_id uuid; kart_id uuid; item jsonb; kart_label text; setup_value jsonb;
 created_ids uuid[] := array[]::uuid[];
begin
 if length(coalesce(p_token,''))<>64 or length(trim(coalesce(p_driver_name,''))) not between 1 and 120
    or jsonb_typeof(p_karts)<>'array' or jsonb_array_length(p_karts) not between 1 and 5
    or octet_length(p_karts::text)>30000
 then raise exception 'Invalid setup form'; end if;
 select * into inv from public.setup_intake_invites i
 where i.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
 and i.revoked_at is null and i.expires_at>now() for update;
 if not found then raise exception 'The setup link has expired or is invalid'; end if;
 if (select count(*) from public.kart_setup_baselines b where b.source_invite_id=inv.id and b.submitted_at>now()-interval '1 hour') >= 20
 then raise exception 'This link has reached the hourly submission limit'; end if;
 select r.id into driver_id from public.racers r
 where r.user_id=inv.owner_id and lower(r.name)=lower(trim(p_driver_name))
 order by r.created_at limit 1;
 if driver_id is null then
  insert into public.racers(user_id,name)
  values(inv.owner_id,trim(p_driver_name)) returning id into driver_id;
 end if;
 for item in select value from jsonb_array_elements(p_karts) as t(value)
 loop
  if jsonb_typeof(item)<>'object' then raise exception 'Invalid kart'; end if;
  kart_label=trim(coalesce(item->>'kart_number',''));
  setup_value=coalesce(item->'setup','{}'::jsonb);
  if length(kart_label) not between 1 and 120
     or jsonb_typeof(setup_value)<>'object' or octet_length(setup_value::text)>10000
  then raise exception 'Invalid kart number or setup'; end if;
  select k.id into kart_id from public.karts k
  where k.user_id=inv.owner_id and k.racer_id=driver_id and lower(k.name)=lower(kart_label)
  order by k.created_at limit 1;
  if kart_id is null then
   insert into public.karts(user_id,racer_id,name,chassis_make,chassis_model,engine_make,engine_model,tire_brand,tire_compound)
   values(inv.owner_id,driver_id,kart_label,
    nullif(left(coalesce(setup_value->>'chassis_make',''),120),''),
    nullif(left(coalesce(setup_value->>'chassis_model',''),120),''),
    nullif(left(coalesce(setup_value->>'engine_make',''),120),''),
    nullif(left(coalesce(setup_value->>'engine_model',''),120),''),
    nullif(left(coalesce(setup_value->>'tire_brand',''),120),''),
    nullif(left(coalesce(setup_value->>'tire_compound',''),120),''))
   returning id into kart_id;
  end if;
  insert into public.kart_setup_baselines(user_id,racer_id,kart_id,source_invite_id,setup,status)
  values(inv.owner_id,driver_id,kart_id,inv.id,setup_value,'pending_review');
  created_ids := array_append(created_ids,kart_id);
  kart_id:=null;
 end loop;
 return jsonb_build_object('ok',true,'driver_id',driver_id,'kart_ids',to_jsonb(created_ids));
end
$$;
revoke all on function public.submit_kart_setup_intake(text,text,jsonb) from public;
grant execute on function public.submit_kart_setup_intake(text,text,jsonb) to anon,authenticated;

alter table public.setup_intake_invites
  add column if not exists voice_parse_count integer not null default 0;

create or replace function public.reserve_setup_intake_dictation(p_token text)
returns boolean language plpgsql security definer
set search_path = ''
as $$
declare valid_id uuid;
begin
 if p_token is null or length(p_token) <> 64 then return false; end if;
 update public.setup_intake_invites i
 set voice_parse_count=i.voice_parse_count+1
 where i.token_hash=encode(sha256(convert_to(p_token,'UTF8')),'hex')
   and i.revoked_at is null and i.expires_at>now()
   and i.voice_parse_count<40
 returning id into valid_id;
 return valid_id is not null;
end
$$;
revoke all on function public.reserve_setup_intake_dictation(text) from public;
grant execute on function public.reserve_setup_intake_dictation(text) to anon,authenticated;
