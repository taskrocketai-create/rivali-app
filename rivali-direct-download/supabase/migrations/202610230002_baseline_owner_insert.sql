create policy "Baseline owner insert" on public.kart_setup_baselines
  for insert to authenticated with check ((select auth.uid()) = user_id);
grant insert on public.kart_setup_baselines to authenticated;
