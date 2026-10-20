-- PUICSA v2: staff role matrix, period closing, reimbursement, event enrolment and asset loans.
-- This migration is additive; no account, member, or transaction is deleted.
create schema if not exists css_private;
revoke all on schema css_private from public, anon;
grant usage on schema css_private to authenticated;
create or replace function css_private.staff_role() returns text language sql stable
set search_path='' as $$
  select case when (select auth.jwt())->'app_metadata'->>'css_role'='admin' then 'information'
  else coalesce((select auth.jwt())->'app_metadata'->>'css_role','') end
$$;
revoke all on function css_private.staff_role() from public, anon;
grant execute on function css_private.staff_role() to authenticated;

create or replace function css_private.finance_writer() returns boolean language sql stable set search_path='' as $$
 select css_private.staff_role() in ('president','vice_president','secretary','treasurer','information')
$$;
create or replace function css_private.archive_writer() returns boolean language sql stable set search_path='' as $$
 select css_private.staff_role() in ('president','vice_president','information')
$$;
create or replace function css_private.senior() returns boolean language sql stable set search_path='' as $$
 select css_private.staff_role() in ('president','vice_president')
$$;
create or replace function css_private.staff() returns boolean language sql stable set search_path='' as $$
 select css_private.staff_role() in ('president','vice_president','secretary','treasurer',
 'activities','public_relations','design','academic','sports','equipment','affairs','information')
$$;
create or replace function css_private.event_editor() returns boolean language sql stable set search_path='' as $$
 select css_private.staff_role() in ('president','vice_president','secretary','activities','information')
$$;
create or replace function css_private.asset_editor() returns boolean language sql stable set search_path='' as $$
 select css_private.staff_role() in ('president','vice_president','equipment','affairs','information')
$$;
revoke all on function css_private.finance_writer(),css_private.archive_writer(),css_private.senior(),
css_private.staff(),css_private.event_editor(),css_private.asset_editor() from public, anon;
grant execute on function css_private.finance_writer(),css_private.archive_writer(),css_private.senior(),
css_private.staff(),css_private.event_editor(),css_private.asset_editor() to authenticated;

create table if not exists public.css_periods (
 id uuid primary key default gen_random_uuid(),
 academic_year text not null, semester smallint not null check(semester in (1,2)),
 status text not null default 'open' check(status in ('open','closed')),
 closed_at timestamptz, closed_by uuid, close_note text,
 created_at timestamptz not null default now(),
 unique(academic_year,semester),
 check ((status='open') or closed_at is not null)
);
insert into public.css_periods(academic_year,semester) values('115',1)
on conflict(academic_year,semester) do nothing;
alter table public.css_ledger add column if not exists period_id uuid references public.css_periods(id);
update public.css_ledger l set period_id=p.id
from public.css_payments m join public.css_periods p
on p.academic_year=m.academic_year and p.semester=m.semester
where l.payment_id=m.id and l.period_id is null;
alter table public.css_events
 add column if not exists capacity integer check(capacity is null or capacity > 0),
 add column if not exists registration_enabled boolean not null default false,
 add column if not exists registration_deadline timestamptz;
create table if not exists public.css_reimbursements (
 id uuid primary key default gen_random_uuid(),
 ledger_id uuid not null unique references public.css_ledger(id),
 requested_by uuid not null, requested_at timestamptz not null default now(),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 reviewed_by uuid, reviewed_at timestamptz, review_note text,
 attachment_url text,
 created_at timestamptz not null default now(),
 check (reviewed_by is null or reviewed_by <> requested_by),
 check ((status='pending' and reviewed_by is null and reviewed_at is null)
 or (status in ('approved','rejected') and reviewed_by is not null and reviewed_at is not null))
);
create table if not exists public.css_period_audit(
 id bigint generated always as identity primary key,
 period_id uuid not null,
 old_status text, new_status text not null,
 changed_by uuid, changed_at timestamptz not null default now(),
 note text not null
);
create table if not exists public.css_asset_loans(
 id uuid primary key default gen_random_uuid(),
 asset_id uuid not null references public.css_assets(id),
 borrower text not null, quantity integer not null check(quantity>0),
 borrowed_at timestamptz not null default now(),
 due_at timestamptz, returned_at timestamptz,
 notes text, created_at timestamptz not null default now(),
 check (returned_at is null or returned_at>=borrowed_at)
);
create table if not exists public.css_event_registrations (
 id uuid primary key default gen_random_uuid(),
 event_id uuid not null references public.css_events(id),
 participant_name text not null check(length(participant_name) between 1 and 80),
 student_id text not null check(length(student_id) between 3 and 30),
 email text not null check(length(email) between 5 and 150),
 checked_in_at timestamptz,
 created_at timestamptz not null default now(),
 unique(event_id,student_id)
);
create index if not exists css_event_registrations_event_idx on public.css_event_registrations(event_id);
create index if not exists css_asset_loans_asset_idx on public.css_asset_loans(asset_id);
create index if not exists css_ledger_period_idx on public.css_ledger(period_id);
create index if not exists css_period_audit_period_idx on public.css_period_audit(period_id);
alter table public.css_periods enable row level security;
alter table public.css_period_audit enable row level security;
alter table public.css_reimbursements enable row level security;
alter table public.css_asset_loans enable row level security;
alter table public.css_event_registrations enable row level security;
revoke all on public.css_periods,public.css_period_audit,public.css_reimbursements,public.css_asset_loans,public.css_event_registrations from anon;
grant select on public.css_periods,public.css_period_audit,public.css_reimbursements,public.css_asset_loans,public.css_event_registrations to authenticated;
grant insert,update on public.css_periods,public.css_reimbursements,public.css_asset_loans,public.css_event_registrations to authenticated;
grant insert,update,delete on public.css_events,public.css_assets,public.css_announcements,public.css_members to authenticated;
grant insert,update,delete on public.css_ledger to authenticated;

-- The previous policies are superseded completely. No overlapping permissive policies.
do $$
declare rec record;
begin
 for rec in select schemaname,tablename,policyname from pg_policies
 where schemaname='public' and tablename in
 ('css_members','css_payments','css_ledger','css_events','css_assets','css_announcements',
 'css_finance_audit','css_periods','css_period_audit','css_reimbursements','css_asset_loans','css_event_registrations')
 loop
 execute format('drop policy if exists %I on %I.%I',rec.policyname,rec.schemaname,rec.tablename);
 end loop;
end $$;
create policy css_members_select on public.css_members for select to authenticated using ((select css_private.staff()));
create policy css_members_insert on public.css_members for insert to authenticated with check ((select css_private.staff_role()) in ('president','vice_president','secretary','treasurer','information'));
create policy css_members_update on public.css_members for update to authenticated using ((select css_private.staff_role()) in ('president','vice_president','secretary','treasurer','information'))
with check ((select css_private.staff_role()) in ('president','vice_president','secretary','treasurer','information'));
create policy css_members_delete on public.css_members for delete to authenticated using ((select css_private.senior()));

create policy css_payments_select on public.css_payments for select to authenticated using ((select css_private.staff()));
create policy css_payments_insert on public.css_payments for insert to authenticated with check ((select css_private.finance_writer()));
create policy css_payments_update on public.css_payments for update to authenticated using ((select css_private.finance_writer())) with check ((select css_private.finance_writer()));

create policy css_ledger_select on public.css_ledger for select to authenticated using ((select css_private.staff()));
create policy css_ledger_insert on public.css_ledger for insert to authenticated with check ((select css_private.finance_writer()) and payment_id is null);
create policy css_ledger_update on public.css_ledger for update to authenticated using ((select css_private.finance_writer()) and payment_id is null)
with check ((select css_private.finance_writer()) and payment_id is null);
create policy css_ledger_delete on public.css_ledger for delete to authenticated using ((select css_private.senior()) and payment_id is null);
create policy css_finance_audit_select on public.css_finance_audit for select to authenticated
using ((select css_private.finance_writer()));

create policy css_events_select on public.css_events for select to authenticated using ((select css_private.staff()));
create policy css_events_insert on public.css_events for insert to authenticated with check ((select css_private.event_editor()));
create policy css_events_update on public.css_events for update to authenticated using ((select css_private.event_editor())) with check ((select css_private.event_editor()));
create policy css_events_delete on public.css_events for delete to authenticated using ((select css_private.senior()));
create policy css_assets_select on public.css_assets for select to authenticated using ((select css_private.staff()));
create policy css_assets_insert on public.css_assets for insert to authenticated with check ((select css_private.asset_editor()));
create policy css_assets_update on public.css_assets for update to authenticated using ((select css_private.asset_editor())) with check ((select css_private.asset_editor()));
create policy css_assets_delete on public.css_assets for delete to authenticated using ((select css_private.senior()));
create policy css_announcements_select on public.css_announcements for select to authenticated using ((select css_private.staff()));
create policy css_announcements_insert on public.css_announcements for insert to authenticated with check ((select css_private.staff_role()) in ('president','vice_president','secretary','public_relations','information'));
create policy css_announcements_update on public.css_announcements for update to authenticated
using ((select css_private.staff_role()) in ('president','vice_president','secretary','public_relations','information'))
with check ((select css_private.staff_role()) in ('president','vice_president','secretary','public_relations','information'));
create policy css_announcements_delete on public.css_announcements for delete to authenticated using ((select css_private.senior()));

create policy css_periods_select on public.css_periods for select to authenticated using ((select css_private.staff()));
create policy css_periods_insert on public.css_periods for insert to authenticated with check ((select css_private.archive_writer()));
create policy css_periods_update on public.css_periods for update to authenticated using ((select css_private.archive_writer())) with check ((select css_private.archive_writer()));
create policy css_period_audit_select on public.css_period_audit for select to authenticated using ((select css_private.staff()));
create policy css_reimbursements_select on public.css_reimbursements for select to authenticated using ((select css_private.staff()));
create policy css_reimbursements_insert on public.css_reimbursements for insert to authenticated with check ((select css_private.finance_writer()));
create policy css_reimbursements_update on public.css_reimbursements for update to authenticated
using ((select css_private.finance_writer())) with check ((select css_private.finance_writer()));
create policy css_asset_loans_select on public.css_asset_loans for select to authenticated using ((select css_private.staff()));
create policy css_asset_loans_insert on public.css_asset_loans for insert to authenticated with check ((select css_private.asset_editor()));
create policy css_asset_loans_update on public.css_asset_loans for update to authenticated using ((select css_private.asset_editor())) with check ((select css_private.asset_editor()));
create policy css_event_registrations_select on public.css_event_registrations for select to authenticated using ((select css_private.event_editor()));
create policy css_event_registrations_update on public.css_event_registrations for update to authenticated using ((select css_private.event_editor())) with check ((select css_private.event_editor()));

-- Finance invariant: original payment and its ledger row always correspond.
-- Privileged archive changes remain recorded by immutable finance audit triggers.
create or replace function css_private.check_financial_period() returns trigger
language plpgsql security definer set search_path='' as $$
declare old_period uuid; new_period uuid; old_state text; new_state text;
begin
 if tg_table_name='css_payments' then
   if tg_op<>'INSERT' then
     select id,status into old_period,old_state from public.css_periods
       where academic_year=old.academic_year and semester=old.semester;
   end if;
   if tg_op<>'DELETE' then
     select id,status into new_period,new_state from public.css_periods
       where academic_year=new.academic_year and semester=new.semester;
     if new_period is null then raise exception '學期尚未建立，無法記帳'; end if;
   end if;
 else
   if tg_op<>'INSERT' then
     old_period:=old.period_id;
     select status into old_state from public.css_periods where id=old_period;
   end if;
   if tg_op<>'DELETE' then
     new_period:=new.period_id;
     if new_period is null then raise exception '請指定帳務所屬學期'; end if;
     select status into new_state from public.css_periods where id=new_period;
     if new_state is null then raise exception '帳務學期不存在'; end if;
   end if;
 end if;
 if (old_state='closed' or new_state='closed') and not
  (coalesce((select auth.jwt())->'app_metadata'->>'css_role','') in ('president','vice_president','information','admin'))
 then raise exception '學期已封存，只有會長、副會長與資訊部可更正'; end if;
 if tg_op='DELETE' then return old; else return new; end if;
end $$;
revoke all on function css_private.check_financial_period() from public,anon,authenticated;
drop trigger if exists css_period_check_payments on public.css_payments;
create trigger css_period_check_payments before insert or update or delete on public.css_payments
for each row execute function css_private.check_financial_period();
drop trigger if exists css_period_check_ledger on public.css_ledger;
create trigger css_period_check_ledger before insert or update or delete on public.css_ledger
for each row execute function css_private.check_financial_period();

create or replace function css_private.assign_payment_period() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 select id into new.period_id from public.css_periods where academic_year=
 (select academic_year from public.css_payments where id=new.payment_id)
 and semester=(select semester from public.css_payments where id=new.payment_id);
 return new;
end $$;
revoke all on function css_private.assign_payment_period() from public,anon,authenticated;
drop trigger if exists css_ledger_link_period on public.css_ledger;
create trigger css_ledger_link_period before insert or update of payment_id on public.css_ledger
for each row when (new.payment_id is not null) execute function css_private.assign_payment_period();

-- Closing and reopening periods requires a reason and writes an independent audit event.
create or replace function css_private.audit_period() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and (old.status is distinct from new.status) then
   if new.close_note is null or length(trim(new.close_note))<4 then
     raise exception '封存或重新開啟學期必須提供原因';
   end if;
   if new.status='closed' then
     new.closed_at:=now(); new.closed_by:=auth.uid();
   else
     new.closed_at:=null; new.closed_by:=null;
   end if;
   insert into public.css_period_audit(period_id,old_status,new_status,changed_by,note)
   values(new.id,old.status,new.status,auth.uid(),new.close_note);
 end if;
 return new;
end $$;
revoke all on function css_private.audit_period() from public,anon,authenticated;
drop trigger if exists css_period_audit_trg on public.css_periods;
create trigger css_period_audit_trg before update on public.css_periods
for each row execute function css_private.audit_period();

-- Prevent the requester from approving their own reimbursement.
create or replace function css_private.guard_reimbursement() returns trigger
language plpgsql security definer set search_path='' as $$
declare state text;
begin
 select p.status into state from public.css_ledger l join public.css_periods p on p.id=l.period_id
 where l.id=new.ledger_id;
 if state is null then raise exception '核銷帳務不存在或未指定學期'; end if;
 if state='closed' and (select auth.jwt())->'app_metadata'->>'css_role'
 not in ('president','vice_president','information','admin')
 then raise exception '封存學期不得進行核銷修改'; end if;
 if tg_op='INSERT' then
   new.requested_by:=auth.uid();
   new.status:='pending';
   new.reviewed_by:=null;
   new.reviewed_at:=null;
 else
   if new.requested_by is distinct from old.requested_by or new.ledger_id is distinct from old.ledger_id
   then raise exception '不能更換核銷申請人或帳務'; end if;
   if new.status is distinct from old.status then
      if old.status<>'pending' then raise exception '已審核項目不得直接覆寫，請走更正流程'; end if;
      if new.status not in('approved','rejected') then raise exception '核銷狀態無效'; end if;
      new.reviewed_by:=auth.uid();new.reviewed_at:=now();
      if new.reviewed_by=new.requested_by then raise exception '申請人不能審核自己的核銷'; end if;
   end if;
 end if;
 return new;
end $$;
revoke all on function css_private.guard_reimbursement() from public,anon,authenticated;
drop trigger if exists css_reimbursement_guard_trg on public.css_reimbursements;
create trigger css_reimbursement_guard_trg before insert or update on public.css_reimbursements
for each row execute function css_private.guard_reimbursement();

-- Public registration: only these two narrowly scoped functions are exposed.
create or replace function public.css_public_event(p_event_id uuid)
returns table(id uuid,title text,starts_at timestamptz,location text,description text,capacity integer,registered bigint)
language sql stable security definer set search_path='' as $$
 select e.id,e.title,e.starts_at,e.location,e.description,e.capacity,
 (select count(*) from public.css_event_registrations r where r.event_id=e.id)
 from public.css_events e
 where e.id=p_event_id and e.registration_enabled=true and e.status='open'
 and (e.registration_deadline is null or e.registration_deadline>now())
$$;
revoke all on function public.css_public_event(uuid) from public,anon,authenticated;
grant execute on function public.css_public_event(uuid) to anon,authenticated;
create or replace function public.css_register_event(
 p_event_id uuid,p_name text,p_student_id text,p_email text,p_hp text default null)
returns text language plpgsql security definer set search_path='' as $$
declare ev public.css_events%rowtype; registered integer;
begin
 -- Honeypot and minimum validation prevent accidental/obvious spam; dedicated CAPTCHA/rate limits remain required for large events.
 if coalesce(p_hp,'')<>'' then raise exception '報名表單驗證失敗'; end if;
 if length(trim(coalesce(p_name,''))) not between 1 and 80
 or length(trim(coalesce(p_student_id,''))) not between 3 and 30
 or length(trim(coalesce(p_email,''))) not between 5 and 150
 or position('@' in coalesce(p_email,''))<2
 then raise exception '報名資料格式不正確'; end if;
 select * into ev from public.css_events where id=p_event_id for update;
 if not found or not ev.registration_enabled or ev.status<>'open'
 or (ev.registration_deadline is not null and ev.registration_deadline<=now())
 then raise exception '活動尚未開放報名或已截止'; end if;
 select count(*) into registered from public.css_event_registrations where event_id=p_event_id;
 if ev.capacity is not null and registered>=ev.capacity then raise exception '活動名額已滿'; end if;
 insert into public.css_event_registrations(event_id,participant_name,student_id,email)
 values(p_event_id,trim(p_name),trim(p_student_id),trim(p_email));
 return '報名成功';
exception when unique_violation then
 return '此學號已報名，請勿重複送出';
end $$;
revoke all on function public.css_register_event(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.css_register_event(uuid,text,text,text,text) to anon,authenticated;

-- Restrict who can see contact details; keep legacy phone/email columns private.
revoke select on public.css_members from authenticated;
grant select (id,student_id,name,department,class_name,year_level,status,joined_at,created_at)
 on public.css_members to authenticated;
-- Contact fields remain on the table for existing data, but are accessible to admins only via trusted backend in v2.


-- Contact information is separated from directory data: all staff can see financial rows,
-- but only privileged staff can see students' private phone/email.
create table if not exists public.css_member_contacts(
 member_id uuid primary key references public.css_members(id) on delete cascade,
 email text, phone text, updated_at timestamptz not null default now()
);
insert into public.css_member_contacts(member_id,email,phone)
select id,email,phone from public.css_members
where email is not null or phone is not null
on conflict (member_id) do nothing;
alter table public.css_member_contacts enable row level security;
revoke all on public.css_member_contacts from anon;
grant select,insert,update,delete on public.css_member_contacts to authenticated;
create policy css_contact_select on public.css_member_contacts for select to authenticated
using ((select css_private.staff_role()) in ('president','vice_president','secretary','treasurer','information'));
create policy css_contact_insert on public.css_member_contacts for insert to authenticated
with check ((select css_private.staff_role()) in ('president','vice_president','secretary','treasurer','information'));
create policy css_contact_update on public.css_member_contacts for update to authenticated
using ((select css_private.staff_role()) in ('president','vice_president','secretary','treasurer','information'))
with check ((select css_private.staff_role()) in ('president','vice_president','secretary','treasurer','information'));
create policy css_contact_delete on public.css_member_contacts for delete to authenticated
using ((select css_private.senior()));

-- The equipment stock figure denotes owned units, not remaining units.
create or replace function css_private.guard_asset_loan() returns trigger
language plpgsql security definer set search_path='' as $$
declare owned integer; active_count bigint;
begin
 select quantity into owned from public.css_assets where id=new.asset_id for update;
 if owned is null then raise exception '器材不存在'; end if;
 if tg_op='UPDATE' and new.asset_id is distinct from old.asset_id then
   raise exception '借用中途不可更換器材';
 end if;
 if new.returned_at is null then
   select coalesce(sum(quantity),0) into active_count
     from public.css_asset_loans where asset_id=new.asset_id
     and returned_at is null and (tg_op='INSERT' or id<>new.id);
   if active_count+new.quantity>owned then raise exception '器材剩餘可借數不足'; end if;
 end if;
 return new;
end $$;
revoke all on function css_private.guard_asset_loan() from public,anon,authenticated;
drop trigger if exists css_guard_asset_loan on public.css_asset_loans;
create trigger css_guard_asset_loan before insert or update on public.css_asset_loans
for each row execute function css_private.guard_asset_loan();

-- Auditable account role administration. Only an existing president/vice-president
-- can change roles; security definer checks the current database role, not a stale JWT.
create table if not exists public.css_staff_role_audit(
 id bigint generated always as identity primary key,
 user_id uuid not null,
 old_role text, new_role text not null,
 changed_by uuid not null, changed_at timestamptz not null default now()
);
alter table public.css_staff_role_audit enable row level security;
revoke all on public.css_staff_role_audit from anon,authenticated;
grant select on public.css_staff_role_audit to authenticated;
create policy css_staff_audit_select on public.css_staff_role_audit for select to authenticated
using ((select css_private.staff_role()) in ('president','vice_president','information'));

create or replace function public.css_staff_directory()
returns table (user_id uuid,email text,staff_role text)
language plpgsql stable security definer set search_path='' as $$
declare caller_role text;
begin
 select raw_app_meta_data->>'css_role' into caller_role from auth.users where id=auth.uid();
 if caller_role not in ('president','vice_president','information','admin') then
   raise exception '無權限檢視帳號名單'; end if;
 return query select u.id,u.email,
 case when u.raw_app_meta_data->>'css_role'='admin' then 'information'
 else coalesce(u.raw_app_meta_data->>'css_role','') end
 from auth.users u order by u.created_at;
end $$;
revoke all on function public.css_staff_directory() from public,anon,authenticated;
grant execute on function public.css_staff_directory() to authenticated;

create or replace function public.css_assign_staff_role(p_user_id uuid,p_role text)
returns text language plpgsql security definer set search_path='' as $$
declare actor_role text; previous_role text;
begin
 if auth.uid() is null then raise exception '需要先登入'; end if;
 select raw_app_meta_data->>'css_role' into actor_role from auth.users where id=auth.uid();
 if actor_role not in ('president','vice_president') then raise exception '僅會長與副會長可指派職務'; end if;
 if p_role not in ('president','vice_president','secretary','treasurer','activities',
  'public_relations','design','academic','sports','equipment','affairs','information')
 then raise exception '職務代碼無效'; end if;
 select raw_app_meta_data->>'css_role' into previous_role from auth.users where id=p_user_id for update;
 if not found then raise exception '帳號不存在'; end if;
 if previous_role='president' and p_role<>'president' and
  (select count(*) from auth.users where raw_app_meta_data->>'css_role'='president')<=1 then
 raise exception '不得移除唯一的會長管理員'; end if;
 update auth.users set raw_app_meta_data=
 jsonb_set(coalesce(raw_app_meta_data,'{}'::jsonb),'{css_role}',to_jsonb(p_role),true)
 where id=p_user_id;
 insert into public.css_staff_role_audit(user_id,old_role,new_role,changed_by)
 values(p_user_id,previous_role,p_role,auth.uid());
 return '職務已更新，請該使用者重新登入以更新權限';
end $$;
revoke all on function public.css_assign_staff_role(uuid,text) from public,anon,authenticated;
grant execute on function public.css_assign_staff_role(uuid,text) to authenticated;
