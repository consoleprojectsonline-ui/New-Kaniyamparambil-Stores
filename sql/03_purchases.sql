-- ─────────────────────────────────────────────────────────────────────────────
-- Full schema: drop & recreate with correct columns
-- WARNING: this deletes all existing purchase records.
-- If you want to keep existing data, use the MIGRATION block below instead.
-- ─────────────────────────────────────────────────────────────────────────────
drop table if exists public.purchases;

create table public.purchases (
  invoice_no      text primary key,
  serial_no       text,
  supplier_name   text not null,
  purchase_type   text not null default 'Local Purchase',
  branch_godown   text not null default 'Shop (Main Showroom)',
  entry_date      date not null,
  invoice_date    date not null,
  vehicle_no      text,
  items           jsonb not null default '[]',
  expenses        numeric not null default 0,
  subtotal        numeric not null default 0,
  total_discount  numeric not null default 0,
  total_sgst      numeric not null default 0,
  total_cgst      numeric not null default 0,
  round_off       numeric not null default 0,
  net_amount      numeric not null default 0,
  paid_amount     numeric not null default 0,
  payment_status  text not null default 'Pending',
  created_at      timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security
alter table public.purchases enable row level security;

-- RLS Policies
create policy "Allow read access to anyone" on public.purchases
  for select using (true);

create policy "Allow insert access to authenticated users" on public.purchases
  for insert with check (true);

create policy "Allow update access to authenticated users" on public.purchases
  for update using (true);

create policy "Allow delete access to authenticated users" on public.purchases
  for delete using (true);

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';


-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION ONLY (use this instead if you want to KEEP existing data):
-- Run each line individually if the table already has records you need.
-- ─────────────────────────────────────────────────────────────────────────────
-- alter table public.purchases rename column bill_no       to invoice_no;
-- alter table public.purchases rename column purchase_date to entry_date;
-- alter table public.purchases add column if not exists serial_no      text;
-- alter table public.purchases add column if not exists branch_godown  text not null default 'Shop (Main Showroom)';
-- alter table public.purchases add column if not exists invoice_date   date;
-- alter table public.purchases add column if not exists vehicle_no     text;
-- alter table public.purchases add column if not exists total_discount numeric not null default 0;
-- alter table public.purchases add column if not exists total_sgst     numeric not null default 0;
-- alter table public.purchases add column if not exists total_cgst     numeric not null default 0;
-- update public.purchases set invoice_date = entry_date where invoice_date is null;
-- notify pgrst, 'reload schema';
