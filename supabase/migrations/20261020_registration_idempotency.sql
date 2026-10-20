-- Idempotent signups even at capacity
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
 if exists (select 1 from public.css_event_registrations where event_id=p_event_id and student_id=trim(p_student_id))
 then return '此學號已報名，請勿重複送出'; end if;
 select count(*) into registered from public.css_event_registrations where event_id=p_event_id;
 if ev.capacity is not null and registered>=ev.capacity then raise exception '活動名額已滿'; end if;
 insert into public.css_event_registrations(event_id,participant_name,student_id,email)
 values(p_event_id,trim(p_name),trim(p_student_id),trim(p_email));
 return '報名成功';
exception when unique_violation then
 return '此學號已報名，請勿重複送出';
end $$;
