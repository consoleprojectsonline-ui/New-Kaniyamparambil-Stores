-- ─────────────────────────────────────────────────────────────────────────────
-- Sales B2B — GST-registered buyers & B2B tax invoices
-- Safe to re-run. Keeps existing data.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) GST-registered business buyers
create table if not exists public.b2b_buyers (
  id                uuid primary key default gen_random_uuid(),
  legal_name        text not null,
  trade_name        text,
  gstin             text not null,
  pan               text,
  contact_person    text,
  phone             text,
  email             text,
  billing_address   text not null,
  ship_to_address   text,
  city              text,
  state             text not null default 'Kerala',
  state_code        text not null default '32',
  pincode           text,
  business_type     text not null default 'Business',
  notes             text,
  is_active         boolean not null default true,
  created_at        timestamp with time zone default timezone('utc'::text, now()) not null
);

create unique index if not exists b2b_buyers_gstin_unique
  on public.b2b_buyers (upper(trim(gstin)));

-- 2) B2B sales bills (same core fields as sales + buyer snapshot)
create table if not exists public.sales_b2b (
  bill_no               text primary key,
  buyer_id              uuid references public.b2b_buyers(id) on delete set null,
  buyer_legal_name      text not null,
  buyer_trade_name      text,
  buyer_gstin           text not null,
  buyer_pan             text,
  buyer_contact_person  text,
  buyer_phone           text,
  buyer_email           text,
  buyer_billing_address text not null,
  buyer_ship_to         text,
  buyer_city            text,
  buyer_state           text,
  buyer_state_code      text,
  buyer_pincode         text,
  form_type             text not null default 'Tax Invoice',
  bill_date             date not null default current_date,
  customer_name         text not null,
  customer_phone        text,
  ship_to               text,
  salesman              text,
  branch_godown         text not null default 'Shop (Main Showroom)',
  rate_tp               text not null default 'Wholesale',
  items                 jsonb not null default '[]',
  subtotal              numeric not null default 0,
  f_cess                numeric not null default 0,
  discount              numeric not null default 0,
  total_gst             numeric not null default 0,
  commission            numeric not null default 0,
  postage               numeric not null default 0,
  vehicle_no            text,
  round_off             numeric not null default 0,
  grand_total           numeric not null default 0,
  payment_amount        numeric not null default 0,
  payment_mode          text not null default 'Bank Transfer',
  balance               numeric not null default 0,
  payment_status        text not null default 'Credit',
  created_at            timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 3) Add any missing columns on existing installs
alter table public.b2b_buyers add column if not exists trade_name        text;
alter table public.b2b_buyers add column if not exists pan                 text;
alter table public.b2b_buyers add column if not exists contact_person      text;
alter table public.b2b_buyers add column if not exists phone               text;
alter table public.b2b_buyers add column if not exists email               text;
alter table public.b2b_buyers add column if not exists ship_to_address     text;
alter table public.b2b_buyers add column if not exists city                text;
alter table public.b2b_buyers add column if not exists state               text not null default 'Kerala';
alter table public.b2b_buyers add column if not exists state_code          text not null default '32';
alter table public.b2b_buyers add column if not exists pincode             text;
alter table public.b2b_buyers add column if not exists business_type       text not null default 'Business';
alter table public.b2b_buyers add column if not exists notes               text;
alter table public.b2b_buyers add column if not exists is_active           boolean not null default true;
alter table public.b2b_buyers add column if not exists created_at          timestamp with time zone default timezone('utc'::text, now()) not null;

alter table public.sales_b2b add column if not exists buyer_id              uuid references public.b2b_buyers(id) on delete set null;
alter table public.sales_b2b add column if not exists buyer_legal_name      text;
alter table public.sales_b2b add column if not exists buyer_trade_name      text;
alter table public.sales_b2b add column if not exists buyer_gstin           text;
alter table public.sales_b2b add column if not exists buyer_pan             text;
alter table public.sales_b2b add column if not exists buyer_contact_person  text;
alter table public.sales_b2b add column if not exists buyer_phone           text;
alter table public.sales_b2b add column if not exists buyer_email           text;
alter table public.sales_b2b add column if not exists buyer_billing_address text;
alter table public.sales_b2b add column if not exists buyer_ship_to         text;
alter table public.sales_b2b add column if not exists buyer_city            text;
alter table public.sales_b2b add column if not exists buyer_state           text;
alter table public.sales_b2b add column if not exists buyer_state_code      text;
alter table public.sales_b2b add column if not exists buyer_pincode         text;
alter table public.sales_b2b add column if not exists form_type             text not null default 'Tax Invoice';
alter table public.sales_b2b add column if not exists bill_date             date;
alter table public.sales_b2b add column if not exists customer_name         text;
alter table public.sales_b2b add column if not exists customer_phone        text;
alter table public.sales_b2b add column if not exists ship_to               text;
alter table public.sales_b2b add column if not exists salesman              text;
alter table public.sales_b2b add column if not exists branch_godown         text not null default 'Shop (Main Showroom)';
alter table public.sales_b2b add column if not exists rate_tp               text not null default 'Wholesale';
alter table public.sales_b2b add column if not exists items                 jsonb not null default '[]';
alter table public.sales_b2b add column if not exists subtotal              numeric not null default 0;
alter table public.sales_b2b add column if not exists f_cess                numeric not null default 0;
alter table public.sales_b2b add column if not exists discount              numeric not null default 0;
alter table public.sales_b2b add column if not exists total_gst             numeric not null default 0;
alter table public.sales_b2b add column if not exists commission            numeric not null default 0;
alter table public.sales_b2b add column if not exists postage               numeric not null default 0;
alter table public.sales_b2b add column if not exists vehicle_no            text;
alter table public.sales_b2b add column if not exists round_off             numeric not null default 0;
alter table public.sales_b2b add column if not exists grand_total           numeric not null default 0;
alter table public.sales_b2b add column if not exists payment_amount        numeric not null default 0;
alter table public.sales_b2b add column if not exists payment_mode          text not null default 'Bank Transfer';
alter table public.sales_b2b add column if not exists balance               numeric not null default 0;
alter table public.sales_b2b add column if not exists payment_status        text not null default 'Credit';
alter table public.sales_b2b add column if not exists reverse_charge        boolean not null default false;
alter table public.sales_b2b add column if not exists total_sgst            numeric not null default 0;
alter table public.sales_b2b add column if not exists total_cgst            numeric not null default 0;
alter table public.sales_b2b add column if not exists total_igst            numeric not null default 0;
alter table public.sales_b2b add column if not exists created_at            timestamp with time zone default timezone('utc'::text, now()) not null;

-- 4) Row Level Security
alter table public.b2b_buyers enable row level security;
alter table public.sales_b2b enable row level security;

drop policy if exists "Allow read access to anyone" on public.b2b_buyers;
create policy "Allow read access to anyone" on public.b2b_buyers
  for select using (true);

drop policy if exists "Allow insert access to authenticated users" on public.b2b_buyers;
create policy "Allow insert access to authenticated users" on public.b2b_buyers
  for insert with check (true);

drop policy if exists "Allow update access to authenticated users" on public.b2b_buyers;
create policy "Allow update access to authenticated users" on public.b2b_buyers
  for update using (true);

drop policy if exists "Allow delete access to authenticated users" on public.b2b_buyers;
create policy "Allow delete access to authenticated users" on public.b2b_buyers
  for delete using (true);

drop policy if exists "Allow read access to anyone" on public.sales_b2b;
create policy "Allow read access to anyone" on public.sales_b2b
  for select using (true);

drop policy if exists "Allow insert access to authenticated users" on public.sales_b2b;
create policy "Allow insert access to authenticated users" on public.sales_b2b
  for insert with check (true);

drop policy if exists "Allow update access to authenticated users" on public.sales_b2b;
create policy "Allow update access to authenticated users" on public.sales_b2b
  for update using (true);

drop policy if exists "Allow delete access to authenticated users" on public.sales_b2b;
create policy "Allow delete access to authenticated users" on public.sales_b2b
  for delete using (true);

notify pgrst, 'reload schema';
