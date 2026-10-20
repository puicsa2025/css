-- Fail closed for accounts without an assigned role and fix return type.
create or replace function public.css_staff_directory()
returns table (user_id uuid,email text,staff_role text)
language plpgsql stable security definer set search_path='' as $$
declare caller_role text;
begin
 select raw_app_meta_data->>'css_role' into caller_role from auth.users where id=auth.uid();
 if coalesce(caller_role,'') not in ('president','vice_president','information','admin') then
   raise exception '無權限檢視帳號名單'; end if;
 return query select u.id,u.email::text,
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
 if coalesce(actor_role,'') not in ('president','vice_president') then raise exception '僅會長與副會長可指派職務'; end if;
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