-- ─────────────────────────────────────────────────────────────────────────────
-- Sales table — safe setup / migration (keeps existing data)
-- Run the whole script in Supabase SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Create table when missing (fresh installs only)
create table if not exists public.sales (
  bill_no         text primary key,
  form_type       text not null default 'Tax Invoice',
  bill_date       date not null default current_date,
  customer_name   text not null default 'Walk-in Customer',
  customer_phone  text,
  ship_to         text,
  salesman        text,
  branch_godown   text not null default 'Shop (Main Showroom)',
  rate_tp         text not null default 'Retail',
  items           jsonb not null default '[]',
  subtotal        numeric not null default 0,
  f_cess          numeric not null default 0,
  discount        numeric not null default 0,
  total_gst       numeric not null default 0,
  total_sgst      numeric not null default 0,
  total_cgst      numeric not null default 0,
  commission      numeric not null default 0,
  postage         numeric not null default 0,
  vehicle_no      text,
  lines_total     numeric not null default 0,
  round_off       numeric not null default 0,
  grand_total     numeric not null default 0,
  payment_amount  numeric not null default 0,
  payment_mode    text not null default 'Cash',
  balance         numeric not null default 0,
  payment_status  text not null default 'Paid',
  created_at      timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2) Rename legacy columns when present (existing databases)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = 'invoice_no'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = 'bill_no'
  ) then
    alter table public.sales rename column invoice_no to bill_no;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = 'invoice_date'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = 'bill_date'
  ) then
    alter table public.sales rename column invoice_date to bill_date;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = 'amount'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = 'grand_total'
  ) then
    alter table public.sales rename column amount to grand_total;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = 'total_amount'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = 'grand_total'
  ) then
    alter table public.sales rename column total_amount to grand_total;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = 'tax_amount'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = 'total_gst'
  ) then
    alter table public.sales rename column tax_amount to total_gst;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = 'outstanding_amount'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'sales' and column_name = 'balance'
  ) then
    alter table public.sales rename column outstanding_amount to balance;
  end if;
end $$;

-- 3) Add any missing columns (existing rows keep their data)
alter table public.sales add column if not exists form_type       text not null default 'Tax Invoice';
alter table public.sales add column if not exists bill_date       date;
alter table public.sales add column if not exists customer_name   text;
alter table public.sales add column if not exists customer_phone  text;
alter table public.sales add column if not exists ship_to         text;
alter table public.sales add column if not exists salesman        text;
alter table public.sales add column if not exists branch_godown   text not null default 'Shop (Main Showroom)';
alter table public.sales add column if not exists rate_tp         text not null default 'Retail';
alter table public.sales add column if not exists items           jsonb not null default '[]';
alter table public.sales add column if not exists subtotal        numeric not null default 0;
alter table public.sales add column if not exists f_cess          numeric not null default 0;
alter table public.sales add column if not exists discount        numeric not null default 0;
alter table public.sales add column if not exists total_gst       numeric not null default 0;
alter table public.sales add column if not exists commission      numeric not null default 0;
alter table public.sales add column if not exists postage         numeric not null default 0;
alter table public.sales add column if not exists vehicle_no      text;
alter table public.sales add column if not exists round_off       numeric not null default 0;
alter table public.sales add column if not exists grand_total      numeric not null default 0;
alter table public.sales add column if not exists payment_amount  numeric not null default 0;
alter table public.sales add column if not exists payment_mode    text not null default 'Cash';
alter table public.sales add column if not exists balance         numeric not null default 0;
alter table public.sales add column if not exists payment_status  text not null default 'Paid';
alter table public.sales add column if not exists created_at      timestamp with time zone default timezone('utc'::text, now()) not null;

-- 4) Backfill nullable / legacy rows without overwriting good data
update public.sales
set bill_date = coalesce(bill_date, created_at::date, current_date)
where bill_date is null;

update public.sales
set customer_name = coalesce(nullif(customer_name, ''), 'Walk-in Customer')
where customer_name is null or customer_name = '';

update public.sales
set payment_amount = grand_total
where payment_amount = 0
  and grand_total > 0
  and payment_status = 'Paid';

update public.sales
set balance = grand_total - payment_amount
where balance = 0
  and grand_total <> payment_amount;

-- 5) Row Level Security (idempotent)
alter table public.sales enable row level security;

drop policy if exists "Allow read access to anyone" on public.sales;
create policy "Allow read access to anyone" on public.sales
  for select using (true);

drop policy if exists "Allow insert access to authenticated users" on public.sales;
create policy "Allow insert access to authenticated users" on public.sales
  for insert with check (true);

drop policy if exists "Allow update access to authenticated users" on public.sales;
create policy "Allow update access to authenticated users" on public.sales
  for update using (true);

drop policy if exists "Allow delete access to authenticated users" on public.sales;
create policy "Allow delete access to authenticated users" on public.sales
  for delete using (true);

-- 6) Reload PostgREST schema cache
notify pgrst, 'reload schema';
