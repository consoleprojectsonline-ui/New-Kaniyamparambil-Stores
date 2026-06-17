-- ─────────────────────────────────────────────────────────────────────────────
-- Quotations — safe setup / migration (keeps existing data)
-- Run the whole script in Supabase SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.quotations (
  quotation_no    text primary key,
  serial_no       text not null,
  quotation_date  date not null default current_date,
  valid_till      date not null,
  ref_no          text,
  rate_type       text not null default 'Bill',
  customer_name   text not null,
  customer_address text,
  customer_gstin  text,
  customer_phone  text,
  items           jsonb not null default '[]',
  remarks         text,
  total_cost      numeric not null default 0,
  subtotal        numeric not null default 0,
  total_gst       numeric not null default 0,
  f_cess          numeric not null default 0,
  round_off       numeric not null default 0,
  net_amount      numeric not null default 0,
  status          text not null default 'Pending',
  items_summary   text,
  amount          numeric,
  created_at      timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Add columns when upgrading an existing quotations table
alter table public.quotations add column if not exists serial_no       text;
alter table public.quotations add column if not exists quotation_date  date;
alter table public.quotations add column if not exists ref_no          text;
alter table public.quotations add column if not exists rate_type       text not null default 'Bill';
alter table public.quotations add column if not exists customer_address text;
alter table public.quotations add column if not exists customer_gstin  text;
alter table public.quotations add column if not exists items           jsonb not null default '[]';
alter table public.quotations add column if not exists remarks         text;
alter table public.quotations add column if not exists total_cost      numeric not null default 0;
alter table public.quotations add column if not exists subtotal        numeric not null default 0;
alter table public.quotations add column if not exists total_gst       numeric not null default 0;
alter table public.quotations add column if not exists f_cess          numeric not null default 0;
alter table public.quotations add column if not exists round_off       numeric not null default 0;
alter table public.quotations add column if not exists net_amount      numeric not null default 0;

update public.quotations
set serial_no = coalesce(serial_no, quotation_no)
where serial_no is null;

update public.quotations
set quotation_date = coalesce(quotation_date, created_at::date, current_date)
where quotation_date is null;

update public.quotations
set net_amount = coalesce(nullif(net_amount, 0), amount, 0)
where net_amount = 0 and coalesce(amount, 0) > 0;

update public.quotations
set remarks = coalesce(nullif(remarks, ''), items_summary)
where (remarks is null or remarks = '') and items_summary is not null;

update public.quotations
set items = '[]'::jsonb
where items is null;

create index if not exists quotations_quotation_date_idx
  on public.quotations (quotation_date desc);

create index if not exists quotations_status_idx
  on public.quotations (status);

alter table public.quotations enable row level security;

drop policy if exists "Allow read access to anyone" on public.quotations;
create policy "Allow read access to anyone" on public.quotations
  for select using (true);

drop policy if exists "Allow insert access to authenticated users" on public.quotations;
create policy "Allow insert access to authenticated users" on public.quotations
  for insert with check (true);

drop policy if exists "Allow update access to authenticated users" on public.quotations;
create policy "Allow update access to authenticated users" on public.quotations
  for update using (true);

drop policy if exists "Allow delete access to authenticated users" on public.quotations;
create policy "Allow delete access to authenticated users" on public.quotations
  for delete using (true);

notify pgrst, 'reload schema';
