create table public.shortcut_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'iPhone Shortcut' check (char_length(label) between 1 and 80),
  token_hash text not null unique check (char_length(token_hash) = 64),
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.pending_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  raw_file_name text not null,
  raw_storage_path text not null unique,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 104857600),
  source text not null default 'ios_shortcut' check (source in ('ios_shortcut','web')),
  status text not null default 'pending' check (status in ('pending','imported')),
  imported_session_id uuid,
  created_at timestamptz not null default now(),
  imported_at timestamptz,
  foreign key (imported_session_id, user_id) references public.sessions(id, user_id) on delete set null
);

create index shortcut_tokens_user_id_idx on public.shortcut_tokens(user_id);
create index pending_imports_user_status_idx on public.pending_imports(user_id, status, created_at desc);

alter table public.shortcut_tokens enable row level security;
alter table public.pending_imports enable row level security;

create policy "shortcut_tokens_select_own" on public.shortcut_tokens for select to authenticated
using ((select auth.uid()) = user_id);
create policy "shortcut_tokens_insert_own" on public.shortcut_tokens for insert to authenticated
with check ((select auth.uid()) = user_id);
create policy "shortcut_tokens_update_own" on public.shortcut_tokens for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "shortcut_tokens_delete_own" on public.shortcut_tokens for delete to authenticated
using ((select auth.uid()) = user_id);

create policy "pending_imports_select_own" on public.pending_imports for select to authenticated
using ((select auth.uid()) = user_id);
create policy "pending_imports_update_own" on public.pending_imports for update to authenticated
using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "pending_imports_delete_own" on public.pending_imports for delete to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.shortcut_tokens to authenticated;
grant select, update, delete on public.pending_imports to authenticated;

comment on table public.shortcut_tokens is 'Hashed, revocable bearer tokens for user-owned iOS Shortcut uploads.';
comment on table public.pending_imports is 'XRK files staged by external upload clients before race metadata is assigned.';
