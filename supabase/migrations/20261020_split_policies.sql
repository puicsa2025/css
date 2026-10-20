-- Convert overlapping FOR ALL RLS policies into insert/update/delete policies
drop policy if exists css_members_write on public.css_members;
create policy css_members_insert on public.css_members for insert to authenticated with check ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer'));
create policy css_members_update on public.css_members for update to authenticated using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer')) with check ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer'));
create policy css_members_delete on public.css_members for delete to authenticated using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer'));
drop policy if exists css_events_write on public.css_events;
create policy css_events_insert on public.css_events for insert to authenticated with check ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer'));
create policy css_events_update on public.css_events for update to authenticated using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer')) with check ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer'));
create policy css_events_delete on public.css_events for delete to authenticated using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer'));
drop policy if exists css_assets_write on public.css_assets;
create policy css_assets_insert on public.css_assets for insert to authenticated with check ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer'));
create policy css_assets_update on public.css_assets for update to authenticated using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer')) with check ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer'));
create policy css_assets_delete on public.css_assets for delete to authenticated using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer'));
drop policy if exists css_announcements_write on public.css_announcements;
create policy css_announcements_insert on public.css_announcements for insert to authenticated with check ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer'));
create policy css_announcements_update on public.css_announcements for update to authenticated using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer')) with check ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer'));
create policy css_announcements_delete on public.css_announcements for delete to authenticated using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer'));
