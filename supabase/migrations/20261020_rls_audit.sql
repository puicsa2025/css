-- PUICSA migration 2: optimize RLS JWT evaluation and add finance audit
alter policy css_members_read on public.css_members using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','treasurer','officer'));
alter policy css_members_write on public.css_members using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer')) with check ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer'));
alter policy css_payments_read on public.css_payments using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','treasurer','officer'));
alter policy css_payments_write on public.css_payments with check ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','treasurer'));
alter policy css_payments_update on public.css_payments using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','treasurer')) with check ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','treasurer'));
alter policy css_ledger_read on public.css_ledger using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','treasurer','officer'));
alter policy css_ledger_insert on public.css_ledger with check ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','treasurer') and payment_id is null);
alter policy css_ledger_update on public.css_ledger using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','treasurer') and payment_id is null) with check ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','treasurer') and payment_id is null);
alter policy css_ledger_delete on public.css_ledger using ((select auth.jwt())->'app_metadata'->>'css_role' = 'admin' and payment_id is null);
alter policy css_events_read on public.css_events using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','treasurer','officer'));
alter policy css_events_write on public.css_events using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer')) with check ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer'));
alter policy css_assets_read on public.css_assets using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','treasurer','officer'));
alter policy css_assets_write on public.css_assets using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer')) with check ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer'));
alter policy css_announcements_read on public.css_announcements using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','treasurer','officer'));
alter policy css_announcements_write on public.css_announcements using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer')) with check ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','officer'));
-- Append-only financial audit. Triggers capture all changes; clients can only read according to RLS.
create table if not exists public.css_finance_audit (
 id bigint generated always as identity primary key,
 source_table text not null check(source_table in ('css_ledger','css_payments')),
 operation text not null check(operation in('INSERT','UPDATE','DELETE')),
 record_id uuid not null,
 actor_uid uuid,
 old_data jsonb,
 new_data jsonb,
 changed_at timestamptz not null default now()
);
create index if not exists css_audit_created_idx on public.css_finance_audit(changed_at desc);
alter table public.css_finance_audit enable row level security;
revoke all on public.css_finance_audit from anon, authenticated;
grant select on public.css_finance_audit to authenticated;
create policy css_finance_audit_read on public.css_finance_audit for select to authenticated
 using ((select auth.jwt())->'app_metadata'->>'css_role' in ('admin','treasurer'));
create or replace function public.css_audit_finances() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 insert into public.css_finance_audit(source_table,operation,record_id,actor_uid,old_data,new_data)
 values (tg_table_name,tg_op,
  case when tg_op='DELETE' then old.id else new.id end,
  auth.uid(),
  case when tg_op='INSERT' then null else to_jsonb(old) end,
  case when tg_op='DELETE' then null else to_jsonb(new) end
 );
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function public.css_audit_finances() from public, anon, authenticated;
drop trigger if exists css_audit_payments on public.css_payments;
create trigger css_audit_payments after insert or update or delete on public.css_payments
for each row execute function public.css_audit_finances();
drop trigger if exists css_audit_ledger on public.css_ledger;
create trigger css_audit_ledger after insert or update or delete on public.css_ledger
for each row execute function public.css_audit_finances();
