-- ─────────────────────────────────────────────────────────────────────────────
-- Sales table — add missing columns only (safe, keeps all existing data)
-- Run in Supabase → SQL Editor. No DROP TABLE required. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- Optional: rename legacy columns if your DB still uses old names
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

-- Add any columns the app expects (existing rows are untouched)
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
alter table public.sales add column if not exists total_sgst      numeric not null default 0;
alter table public.sales add column if not exists total_cgst      numeric not null default 0;
alter table public.sales add column if not exists commission      numeric not null default 0;
alter table public.sales add column if not exists postage         numeric not null default 0;
alter table public.sales add column if not exists vehicle_no      text;
alter table public.sales add column if not exists lines_total     numeric not null default 0;
alter table public.sales add column if not exists round_off       numeric not null default 0;
alter table public.sales add column if not exists grand_total     numeric not null default 0;
alter table public.sales add column if not exists payment_amount  numeric not null default 0;
alter table public.sales add column if not exists payment_mode    text not null default 'Cash';
alter table public.sales add column if not exists balance         numeric not null default 0;
alter table public.sales add column if not exists payment_status  text not null default 'Paid';
alter table public.sales add column if not exists created_at      timestamp with time zone default timezone('utc'::text, now()) not null;

-- Reload API schema cache so the app sees new columns immediately
notify pgrst, 'reload schema';
