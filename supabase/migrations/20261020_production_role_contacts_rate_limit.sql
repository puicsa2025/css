-- PUICSA production hardening: remove the information role, restore member forms,
-- isolate privileged RPC implementations, and rate-limit public event registration.
begin;

-- Preserve any legacy contact details before removing the broadly readable columns.
insert into public.css_member_contacts(member_id,email,phone)
select id,nullif(email,''),nullif(phone,'')
from public.css_members
where nullif(email,'') is not null or nullif(phone,'') is not null
on conflict (member_id) do update
set email=coalesce(nullif(public.css_member_contacts.email,''),excluded.email),
    phone=coalesce(nullif(public.css_member_contacts.phone,''),excluded.phone),
    updated_at=now();

update public.css_members
set department='晶片設計學士學位學程'
where department is null or btrim(department)='';

alter table public.css_members
  alter column department set default '晶片設計學士學位學程';
alter table public.css_members
  alter column department set not null;
alter table public.css_members
  drop column if exists email,
  drop column if exists phone;

-- No information department and no legacy "admin => information" escalation.
create or replace function css_private.staff_role()
returns text language sql stable set search_path='' as $$
  select coalesce((select auth.jwt())->'app_metadata'->>'css_role','')
$$;
create or replace function css_private.staff()
returns boolean language sql stable set search_path='' as $$
 select css_private.staff_role() in
 ('president','vice_president','secretary','treasurer','activities',
  'public_relations','design','academic','sports','equipment','affairs')
$$;
create or replace function css_private.senior()
returns boolean language sql stable set search_path='' as $$
 select css_private.staff_role() in ('president','vice_president')
$$;
create or replace function css_private.finance_writer()
returns boolean language sql stable set search_path='' as $$
 select css_private.staff_role() in
 ('president','vice_president','secretary','treasurer')
$$;
create or replace function css_private.archive_writer()
returns boolean language sql stable set search_path='' as $$
 select css_private.staff_role() in ('president','vice_president')
$$;
create or replace function css_private.event_editor()
returns boolean language sql stable set search_path='' as $$
 select css_private.staff_role() in ('president','vice_president','secretary','activities')
$$;
create or replace function css_private.asset_editor()
returns boolean language sql stable set search_path='' as $$
 select css_private.staff_role() in ('president','vice_president','equipment','affairs')
$$;

-- Tighten explicit role policies that previously listed the removed information role.
drop policy if exists css_members_insert on public.css_members;
create policy css_members_insert on public.css_members for insert to authenticated
with check (css_private.staff_role() in ('president','vice_president','secretary','treasurer'));
drop policy if exists css_members_update on public.css_members;
create policy css_members_update on public.css_members for update to authenticated
using (css_private.staff_role() in ('president','vice_president','secretary','treasurer'))
with check (css_private.staff_role() in ('president','vice_president','secretary','treasurer'));

drop policy if exists css_contact_insert on public.css_member_contacts;
create policy css_contact_insert on public.css_member_contacts for insert to authenticated
with check (css_private.staff_role() in ('president','vice_president','secretary','treasurer'));
drop policy if exists css_contact_select on public.css_member_contacts;
create policy css_contact_select on public.css_member_contacts for select to authenticated
using (css_private.staff_role() in ('president','vice_president','secretary','treasurer'));
drop policy if exists css_contact_update on public.css_member_contacts;
create policy css_contact_update on public.css_member_contacts for update to authenticated
using (css_private.staff_role() in ('president','vice_president','secretary','treasurer'))
with check (css_private.staff_role() in ('president','vice_president','secretary','treasurer'));

drop policy if exists css_announcements_insert on public.css_announcements;
create policy css_announcements_insert on public.css_announcements for insert to authenticated
with check (css_private.staff_role() in ('president','vice_president','secretary','public_relations'));
drop policy if exists css_announcements_update on public.css_announcements;
create policy css_announcements_update on public.css_announcements for update to authenticated
using (css_private.staff_role() in ('president','vice_president','secretary','public_relations'))
with check (css_private.staff_role() in ('president','vice_president','secretary','public_relations'));

drop policy if exists css_staff_audit_select on public.css_staff_role_audit;
create policy css_staff_audit_select on public.css_staff_role_audit for select to authenticated
using (css_private.senior());

-- Finance data and financial audit records are readable by all assigned association staff.
drop policy if exists css_finance_audit_select on public.css_finance_audit;
create policy css_finance_audit_select on public.css_finance_audit for select to authenticated
using (css_private.staff());

-- Move elevated RPC bodies to an unexposed schema. Public wrappers are invoker-only.
grant usage on schema css_private to anon,authenticated,service_role;
alter function public.css_public_event(uuid) set schema css_private;
alter function public.css_register_event(uuid,text,text,text,text) set schema css_private;
alter function public.css_staff_directory() set schema css_private;
alter function public.css_assign_staff_role(uuid,text) set schema css_private;

create or replace function css_private.css_staff_directory()
returns table(user_id uuid,email text,staff_role text)
language plpgsql stable security definer set search_path='' as $$
declare caller_role text;
begin
 select raw_app_meta_data->>'css_role' into caller_role
 from auth.users where id=auth.uid();
 if coalesce(caller_role,'') not in ('president','vice_president') then
   raise exception '只有會長與副會長可檢視幹部帳號';
 end if;
 return query
 select u.id,u.email::text,coalesce(u.raw_app_meta_data->>'css_role','')
 from auth.users u order by u.created_at;
end $$;

create or replace function css_private.css_assign_staff_role(p_user_id uuid,p_role text)
returns text language plpgsql security definer set search_path='' as $$
declare actor_role text; previous_role text;
begin
 if auth.uid() is null then raise exception '需要先登入'; end if;
 select raw_app_meta_data->>'css_role' into actor_role from auth.users where id=auth.uid();
 if coalesce(actor_role,'') not in ('president','vice_president') then
   raise exception '僅會長與副會長可指派職務';
 end if;
 if p_role not in ('president','vice_president','secretary','treasurer','activities',
  'public_relations','design','academic','sports','equipment','affairs')
 then raise exception '職務代碼無效'; end if;
 select raw_app_meta_data->>'css_role' into previous_role
 from auth.users where id=p_user_id for update;
 if not found then raise exception '帳號不存在'; end if;
 if p_role='president' and previous_role is distinct from 'president'
    and exists(select 1 from auth.users where raw_app_meta_data->>'css_role'='president')
 then raise exception '會長帳號已存在，請先處理現任會長交接'; end if;
 if p_role='vice_president' and previous_role is distinct from 'vice_president'
    and exists(select 1 from auth.users where raw_app_meta_data->>'css_role'='vice_president')
 then raise exception '副會長帳號已存在，請先處理現任副會長交接'; end if;
 if previous_role='president' and p_role<>'president'
    and (select count(*) from auth.users where raw_app_meta_data->>'css_role'='president')<=1
 then raise exception '不得移除唯一的會長管理員'; end if;
 update auth.users set raw_app_meta_data=
  jsonb_set(coalesce(raw_app_meta_data,'{}'::jsonb),'{css_role}',to_jsonb(p_role),true)
 where id=p_user_id;
 insert into public.css_staff_role_audit(user_id,old_role,new_role,changed_by)
 values(p_user_id,previous_role,p_role,auth.uid());
 return '職務已更新，請該使用者登出後重新登入以更新權限';
end $$;

-- One legacy admin account exists in Auth. Promote that account to president, rather than
-- retaining a fictitious information department. Other legacy information roles are disabled.
insert into public.css_staff_role_audit(user_id,old_role,new_role,changed_by)
select id,'admin','president',id from auth.users
where raw_app_meta_data->>'css_role'='admin';
update auth.users
set raw_app_meta_data=jsonb_set(coalesce(raw_app_meta_data,'{}'::jsonb),'{css_role}','"president"',true)
where raw_app_meta_data->>'css_role'='admin';
update auth.users
set raw_app_meta_data=jsonb_set(coalesce(raw_app_meta_data,'{}'::jsonb),'{css_role}','"unassigned"',true)
where raw_app_meta_data->>'css_role'='information';

-- Public wrappers have no elevated execution context. Registration writes are available only
-- to the rate-limited Edge Function using service_role.
create function public.css_public_event(p_event_id uuid)
returns table(id uuid,title text,starts_at timestamptz,location text,description text,capacity integer,registered bigint)
language sql stable security invoker set search_path='' as $$
 select * from css_private.css_public_event(p_event_id)
$$;
create function public.css_register_event(p_event_id uuid,p_name text,p_student_id text,p_email text,p_hp text default null)
returns text language sql security invoker set search_path='' as $$
 select css_private.css_register_event(p_event_id,p_name,p_student_id,p_email,p_hp)
$$;
create function public.css_staff_directory()
returns table(user_id uuid,email text,staff_role text)
language sql stable security invoker set search_path='' as $$
 select * from css_private.css_staff_directory()
$$;
create function public.css_assign_staff_role(p_user_id uuid,p_role text)
returns text language sql security invoker set search_path='' as $$
 select css_private.css_assign_staff_role(p_user_id,p_role)
$$;

create table if not exists public.css_registration_rate_limits(
 ip_hash text not null check(ip_hash ~ '^[0-9a-f]{64}$'),
 window_start timestamptz not null,
 hits integer not null default 0 check(hits>=0),
 primary key(ip_hash,window_start)
);
alter table public.css_registration_rate_limits enable row level security;
revoke all on public.css_registration_rate_limits from public,anon,authenticated;
grant all on public.css_registration_rate_limits to service_role;

create function css_private.css_consume_registration_rate_limit(p_ip_hash text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_hits integer; v_bucket timestamptz:=date_trunc('minute',now());
begin
 if coalesce(p_ip_hash,'') !~ '^[0-9a-f]{64}$' then raise exception '限流識別碼格式錯誤'; end if;
 insert into public.css_registration_rate_limits(ip_hash,window_start,hits)
 values(p_ip_hash,v_bucket,1)
 on conflict(ip_hash,window_start) do update
 set hits=public.css_registration_rate_limits.hits+1
 returning hits into v_hits;
 if v_hits=1 and extract(minute from now())::integer % 15=0 then
  delete from public.css_registration_rate_limits where window_start < v_bucket-interval '2 hours';
 end if;
 return v_hits<=60;
end $$;
create function public.css_consume_registration_rate_limit(p_ip_hash text)
returns boolean language sql security invoker set search_path='' as $$
 select css_private.css_consume_registration_rate_limit(p_ip_hash)
$$;

revoke all on function css_private.css_public_event(uuid),
 css_private.css_register_event(uuid,text,text,text,text),
 css_private.css_staff_directory(),
 css_private.css_assign_staff_role(uuid,text),
 css_private.css_consume_registration_rate_limit(text)
 from public,anon,authenticated,service_role;
grant execute on function css_private.css_public_event(uuid) to anon,authenticated;
grant execute on function css_private.css_register_event(uuid,text,text,text,text) to service_role;
grant execute on function css_private.css_staff_directory(),
 css_private.css_assign_staff_role(uuid,text) to authenticated;
grant execute on function css_private.css_consume_registration_rate_limit(text) to service_role;

revoke all on function public.css_public_event(uuid),
 public.css_register_event(uuid,text,text,text,text),
 public.css_staff_directory(),
 public.css_assign_staff_role(uuid,text),
 public.css_consume_registration_rate_limit(text)
 from public,anon,authenticated,service_role;
grant execute on function public.css_public_event(uuid) to anon,authenticated;
grant execute on function public.css_register_event(uuid,text,text,text,text) to service_role;
grant execute on function public.css_staff_directory(),
 public.css_assign_staff_role(uuid,text) to authenticated;
grant execute on function public.css_consume_registration_rate_limit(text) to service_role;

notify pgrst,'reload schema';
commit;
