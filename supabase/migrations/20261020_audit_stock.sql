-- Additional audited financial approvals and stock protection.
create table if not exists public.css_reimbursement_audit(
 id bigint generated always as identity primary key,
 reimbursement_id uuid not null,
 operation text not null check(operation in ('INSERT','UPDATE')),
 actor_uid uuid,
 before_data jsonb,
 after_data jsonb,
 changed_at timestamptz not null default now()
);
alter table public.css_reimbursement_audit enable row level security;
revoke all on public.css_reimbursement_audit from anon,authenticated;
grant select on public.css_reimbursement_audit to authenticated;
create policy css_reimbursement_audit_read on public.css_reimbursement_audit for select to authenticated
using ((select css_private.staff()));

create or replace function css_private.audit_reimbursement() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 insert into public.css_reimbursement_audit(reimbursement_id,operation,actor_uid,before_data,after_data)
 values(new.id,tg_op,auth.uid(),case when tg_op='INSERT' then null else to_jsonb(old) end,to_jsonb(new));
 return new;
end $$;
revoke all on function css_private.audit_reimbursement() from public,anon,authenticated;
drop trigger if exists css_reimbursement_audit_trg on public.css_reimbursements;
create trigger css_reimbursement_audit_trg after insert or update on public.css_reimbursements
for each row execute function css_private.audit_reimbursement();

create or replace function css_private.prevent_approved_reimbursement_edits() returns trigger
language plpgsql set search_path='' as $$
begin
 if old.status in ('approved','rejected') then
 raise exception '已簽核的核銷不可直接變更；請用更正流程記錄新申請'; end if;
 return new;
end $$;
revoke all on function css_private.prevent_approved_reimbursement_edits() from public,anon,authenticated;
drop trigger if exists css_approved_immutable on public.css_reimbursements;
create trigger css_approved_immutable before update on public.css_reimbursements
for each row execute function css_private.prevent_approved_reimbursement_edits();

create or replace function css_private.check_asset_stock() returns trigger
language plpgsql security definer set search_path='' as $$
declare owned integer; outstanding bigint;
begin
 select quantity into owned from public.css_assets where id=new.asset_id for update;
 if not found then raise exception '借用器材不存在'; end if;
 if tg_op='UPDATE' and new.asset_id is distinct from old.asset_id then
 raise exception '借用紀錄不能更換器材';end if;
 if new.returned_at is null then
   select coalesce(sum(quantity),0) into outstanding from public.css_asset_loans
   where asset_id=new.asset_id and returned_at is null
   and (tg_op='INSERT' or id<>new.id);
   if outstanding+new.quantity>owned then raise exception '可借器材數不足';end if;
 end if;
 return new;
end $$;
revoke all on function css_private.check_asset_stock() from public,anon,authenticated;
drop trigger if exists css_stock_guard on public.css_asset_loans;
create trigger css_stock_guard before insert or update on public.css_asset_loans
for each row execute function css_private.check_asset_stock();
