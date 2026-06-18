-- ─────────────────────────────────────────────────────────────────────────────
-- Support requests — bugs, bill/amount issues, feature requests
-- Run in Supabase → SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.support_requests (
  id             uuid default gen_random_uuid() primary key,
  request_kind   text not null default 'issue',
  category       text not null,
  module         text not null default 'General',
  subject        text not null,
  description    text not null,
  reference_no   text,
  priority       text not null default 'Normal',
  status         text not null default 'Open',
  reporter_name  text,
  reporter_email text,
  created_at     timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.support_requests add column if not exists request_kind   text not null default 'issue';
alter table public.support_requests add column if not exists category       text not null default 'Other';
alter table public.support_requests add column if not exists module         text not null default 'General';
alter table public.support_requests add column if not exists subject        text not null;
alter table public.support_requests add column if not exists description    text not null;
alter table public.support_requests add column if not exists reference_no   text;
alter table public.support_requests add column if not exists priority       text not null default 'Normal';
alter table public.support_requests add column if not exists status         text not null default 'Open';
alter table public.support_requests add column if not exists reporter_name  text;
alter table public.support_requests add column if not exists reporter_email text;
alter table public.support_requests add column if not exists created_at     timestamp with time zone default timezone('utc'::text, now()) not null;

create index if not exists support_requests_created_at_idx
  on public.support_requests (created_at desc);

create index if not exists support_requests_status_idx
  on public.support_requests (status);

alter table public.support_requests enable row level security;

drop policy if exists "Allow read access to anyone" on public.support_requests;
create policy "Allow read access to anyone" on public.support_requests
  for select using (true);

drop policy if exists "Allow insert access to authenticated users" on public.support_requests;
create policy "Allow insert access to authenticated users" on public.support_requests
  for insert with check (true);

drop policy if exists "Allow update access to authenticated users" on public.support_requests;
create policy "Allow update access to authenticated users" on public.support_requests
  for update using (true);

drop policy if exists "Allow delete access to authenticated users" on public.support_requests;
create policy "Allow delete access to authenticated users" on public.support_requests
  for delete using (true);

notify pgrst, 'reload schema';
