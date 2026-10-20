-- PUICSA v1 / first run in Supabase SQL editor (project owner only)
-- Accounts: create users via Auth > Users; disable public signup in Auth settings.
-- Assign internal staff role via Auth > Users > app_metadata, e.g. {"css_role":"admin"}.
-- Never use user_metadata for authorization.
create extension if not exists pgcrypto;
create table if not exists public.css_members (
 id uuid primary key default gen_random_uuid(), student_id text unique not null,
 name text not null, department text, class_name text, year_level smallint check(year_level between 1 and 8),
 email text, phone text, status text not null default 'active' check(status in('active','inactive')),
 joined_at date default current_date, created_at timestamptz not null default now()
);
create table if not exists public.css_payments (
 id uuid primary key default gen_random_uuid(), member_id uuid not null references public.css_members(id),
 academic_year text not null, semester smallint not null check(semester in(1,2)),
 amount numeric(12,2) not null check(amount>0), paid_at date not null default current_date,
 payment_method text not null default 'cash', note text, created_at timestamptz not null default now(),
 unique(member_id,academic_year,semester)
);
create table if not exists public.css_ledger (
 id uuid primary key default gen_random_uuid(), occurred_on date not null default current_date,
 direction text not null check(direction in('income','expense')),
 category text not null, description text not null,
 amount numeric(12,2) not null check(amount>0),
 reimbursement_status text not null default 'none' check(reimbursement_status in('none','pending','approved','rejected')),
 receipt_url text, payment_id uuid unique references public.css_payments(id),
 created_at timestamptz not null default now()
);
create table if not exists public.css_events (
 id uuid primary key default gen_random_uuid(), title text not null,
 starts_at timestamptz not null, ends_at timestamptz,
 location text, budget numeric(12,2) not null default 0 check(budget>=0),
 status text not null default 'planning' check(status in('planning','open','completed','cancelled')),
 description text, created_at timestamptz not null default now(),
 check(ends_at is null or ends_at >= starts_at)
);
create table if not exists public.css_assets (
 id uuid primary key default gen_random_uuid(), name text not null, code text unique,
 quantity integer not null default 1 check(quantity>=0),
 condition text not null default 'good', location text, note text,
 created_at timestamptz not null default now()
);
create table if not exists public.css_announcements (
 id uuid primary key default gen_random_uuid(), title text not null, content text not null,
 published_at timestamptz not null default now(), created_at timestamptz not null default now()
);
create index if not exists css_payments_member_idx on public.css_payments(member_id);
create index if not exists css_ledger_date_idx on public.css_ledger(occurred_on desc);
create index if not exists css_events_start_idx on public.css_events(starts_at);
-- Payments to ledger: same database transaction via trigger; no duplicate entry.
-- SECURITY DEFINER is required for this private trigger because client INSERT policies
-- deliberately forbid inserting payment_id into the ledger directly. No exposed direct EXECUTE grants.
create or replace function public.css_sync_payment_ledger() returns trigger language plpgsql
security definer set search_path = '' as $$
begin
 insert into public.css_ledger(payment_id, occurred_on,direction,category,description,amount)
 values(new.id,new.paid_at,'income','系費','系費 '||new.academic_year||'-'||new.semester,new.amount)
 on conflict (payment_id) do update set occurred_on=excluded.occurred_on, amount=excluded.amount, description=excluded.description;
 return new;
end $$;
revoke all on function public.css_sync_payment_ledger() from public, anon, authenticated;
drop trigger if exists css_payment_sync on public.css_payments;
create trigger css_payment_sync after insert or update of amount,paid_at,academic_year,semester on public.css_payments
for each row execute function public.css_sync_payment_ledger();
-- auth role is immutable by end users; SQL authorization always on server
alter table public.css_members enable row level security;
alter table public.css_payments enable row level security;
alter table public.css_ledger enable row level security;
alter table public.css_events enable row level security;
alter table public.css_assets enable row level security;
alter table public.css_announcements enable row level security;
revoke all on public.css_members,public.css_payments,public.css_ledger,public.css_events,public.css_assets,public.css_announcements from anon;
grant usage on schema public to authenticated;
grant select on public.css_members,public.css_payments,public.css_ledger,public.css_events,public.css_assets,public.css_announcements to authenticated;
grant insert,update,delete on public.css_members,public.css_events,public.css_assets,public.css_announcements to authenticated;
grant insert,update on public.css_payments to authenticated;
grant insert,update,delete on public.css_ledger to authenticated;
-- Authorization roles: admin, treasurer, officer; Auth app_metadata only
create policy css_members_read on public.css_members for select to authenticated
 using (auth.jwt()->'app_metadata'->>'css_role' in ('admin','treasurer','officer'));
create policy css_members_write on public.css_members for all to authenticated
 using (auth.jwt()->'app_metadata'->>'css_role' in ('admin','officer'))
 with check (auth.jwt()->'app_metadata'->>'css_role' in ('admin','officer'));
create policy css_payments_read on public.css_payments for select to authenticated
 using (auth.jwt()->'app_metadata'->>'css_role' in ('admin','treasurer','officer'));
create policy css_payments_write on public.css_payments for insert to authenticated
 with check (auth.jwt()->'app_metadata'->>'css_role' in ('admin','treasurer'));
create policy css_payments_update on public.css_payments for update to authenticated
 using (auth.jwt()->'app_metadata'->>'css_role' in ('admin','treasurer'))
 with check (auth.jwt()->'app_metadata'->>'css_role' in ('admin','treasurer'));
create policy css_ledger_read on public.css_ledger for select to authenticated
 using (auth.jwt()->'app_metadata'->>'css_role' in ('admin','treasurer','officer'));
create policy css_ledger_insert on public.css_ledger for insert to authenticated
 with check (auth.jwt()->'app_metadata'->>'css_role' in ('admin','treasurer') and payment_id is null);
create policy css_ledger_update on public.css_ledger for update to authenticated
 using (auth.jwt()->'app_metadata'->>'css_role' in ('admin','treasurer') and payment_id is null)
 with check (auth.jwt()->'app_metadata'->>'css_role' in ('admin','treasurer') and payment_id is null);
create policy css_ledger_delete on public.css_ledger for delete to authenticated
 using (auth.jwt()->'app_metadata'->>'css_role' = 'admin' and payment_id is null);
create policy css_events_read on public.css_events for select to authenticated
 using (auth.jwt()->'app_metadata'->>'css_role' in ('admin','treasurer','officer'));
create policy css_events_write on public.css_events for all to authenticated
 using (auth.jwt()->'app_metadata'->>'css_role' in ('admin','officer'))
 with check (auth.jwt()->'app_metadata'->>'css_role' in ('admin','officer'));
create policy css_assets_read on public.css_assets for select to authenticated
 using (auth.jwt()->'app_metadata'->>'css_role' in ('admin','treasurer','officer'));
create policy css_assets_write on public.css_assets for all to authenticated
 using (auth.jwt()->'app_metadata'->>'css_role' in ('admin','officer'))
 with check (auth.jwt()->'app_metadata'->>'css_role' in ('admin','officer'));
create policy css_announcements_read on public.css_announcements for select to authenticated
 using (auth.jwt()->'app_metadata'->>'css_role' in ('admin','treasurer','officer'));
create policy css_announcements_write on public.css_announcements for all to authenticated
 using (auth.jwt()->'app_metadata'->>'css_role' in ('admin','officer'))
 with check (auth.jwt()->'app_metadata'->>'css_role' in ('admin','officer'));
-- Important: css_ledger is intentionally non-deletable for regular users.
-- Payments are append-only for client: removing a member with transactions is disallowed by FK.
