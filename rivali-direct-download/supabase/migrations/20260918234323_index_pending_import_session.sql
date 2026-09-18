create index pending_imports_session_owner_idx
on public.pending_imports(imported_session_id, user_id)
where imported_session_id is not null;
