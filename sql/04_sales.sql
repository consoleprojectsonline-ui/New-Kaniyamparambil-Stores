-- ─────────────────────────────────────────────────────────────────────────────
-- Full schema: drop & recreate with correct columns
-- WARNING: this deletes all existing sales records.
-- If you want to keep existing data, use the MIGRATION block below instead.
-- ─────────────────────────────────────────────────────────────────────────────
drop table if exists public.sales;

create table public.sales (
  bill_no         text primary key,
  form_type       text not null default 'Tax Invoice',     -- 'Tax Invoice' | 'Retail Invoice' | 'Estimate' | 'Delivery Note'
  bill_date       date not null,
  customer_name   text not null,
  customer_phone  text,
  ship_to         text,                                    -- shipping address / destination
  salesman        text,                                    -- salesman / staff name
  branch_godown   text not null default 'Shop (Main Showroom)',
  rate_tp         text not null default 'Retail',          -- Rate TP / GST classification applied
  items           jsonb not null default '[]',             -- array of SaleItem { code, name, qty, unit, rate, amount, disc_pct, remarks, tp_points, barcode, sgst, cgst, hsn_code }
  subtotal        numeric not null default 0,              -- sum of taxable line values before GST
  f_cess          numeric not null default 0,              -- F.Cess (additional cess if applicable)
  discount        numeric not null default 0,              -- overall bill discount
  total_gst       numeric not null default 0,              -- SGST + CGST combined
  commission      numeric not null default 0,              -- salesman commission
  postage         numeric not null default 0,              -- courier / postage charges
  round_off       numeric not null default 0,              -- rounding adjustment (±)
  grand_total     numeric not null default 0,              -- final payable
  payment_amount  numeric not null default 0,              -- amount received
  payment_mode    text not null default 'Cash',            -- 'Cash' | 'UPI' | 'Card' | 'Bank Transfer' | 'Credit'
  balance         numeric not null default 0,              -- grand_total - payment_amount
  payment_status  text not null default 'Paid',            -- 'Paid' | 'Partial' | 'Credit'
  created_at      timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security
alter table public.sales enable row level security;

-- RLS Policies
create policy "Allow read access to anyone" on public.sales
  for select using (true);

create policy "Allow insert access to authenticated users" on public.sales
  for insert with check (true);

create policy "Allow update access to authenticated users" on public.sales
  for update using (true);

create policy "Allow delete access to authenticated users" on public.sales
  for delete using (true);

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';


-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATION ONLY (keep existing data — run line by line):
-- ─────────────────────────────────────────────────────────────────────────────
-- alter table public.sales rename column invoice_no    to bill_no;
-- alter table public.sales rename column invoice_date  to bill_date;
-- alter table public.sales rename column amount        to grand_total;
-- alter table public.sales rename column tax_amount    to total_gst;
-- alter table public.sales rename column payment_mode  to payment_mode;
-- alter table public.sales add column if not exists form_type      text not null default 'Tax Invoice';
-- alter table public.sales add column if not exists ship_to        text;
-- alter table public.sales add column if not exists salesman       text;
-- alter table public.sales add column if not exists branch_godown  text not null default 'Shop (Main Showroom)';
-- alter table public.sales add column if not exists rate_tp        text not null default 'Retail';
-- alter table public.sales add column if not exists items          jsonb not null default '[]';
-- alter table public.sales add column if not exists subtotal       numeric not null default 0;
-- alter table public.sales add column if not exists f_cess         numeric not null default 0;
-- alter table public.sales add column if not exists discount       numeric not null default 0;
-- alter table public.sales add column if not exists commission     numeric not null default 0;
-- alter table public.sales add column if not exists postage        numeric not null default 0;
-- alter table public.sales add column if not exists round_off      numeric not null default 0;
-- alter table public.sales add column if not exists payment_amount numeric not null default 0;
-- alter table public.sales add column if not exists balance        numeric not null default 0;
-- update public.sales set payment_amount = grand_total where payment_status = 'Paid';
-- notify pgrst, 'reload schema';
