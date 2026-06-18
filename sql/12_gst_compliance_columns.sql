-- ─────────────────────────────────────────────────────────────────────────────
-- GST compliance fields — sales & B2B (customer GSTIN, reverse charge, IGST split)
-- Run in Supabase → SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- Retail / B2C sales
alter table public.sales add column if not exists customer_gstin text;
alter table public.sales add column if not exists reverse_charge boolean not null default false;
alter table public.sales add column if not exists total_igst numeric not null default 0;

-- B2B tax invoices
alter table public.sales_b2b add column if not exists reverse_charge boolean not null default false;
alter table public.sales_b2b add column if not exists total_sgst numeric not null default 0;
alter table public.sales_b2b add column if not exists total_cgst numeric not null default 0;
alter table public.sales_b2b add column if not exists total_igst numeric not null default 0;

notify pgrst, 'reload schema';
