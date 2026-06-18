-- ─────────────────────────────────────────────────────────────────────────────
-- Purchases table — full bill sections (header, line items, financial summary)
-- Run in Supabase → SQL Editor. Safe to re-run. Keeps existing data.
--
-- Section 1 (Invoice Header): serial_no, invoice_no, supplier_name, purchase_type,
--   branch_godown, entry_date, invoice_date, vehicle_no
-- Section 2 (Product Grid): stored in `items` jsonb — each element should include:
--   code, name, hsn_code, qty, unit, rate, amount, disc, sgst (%), cgst (%),
--   taxable_value, sgst_amount, cgst_amount, s_rate, mrp, line_total
-- Section 3 (Financials): subtotal, total_discount, total_sgst, total_cgst,
--   expenses, round_off, net_amount, paid_amount, payment_status
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.purchases add column if not exists serial_no       text;
alter table public.purchases add column if not exists branch_godown   text not null default 'Shop (Main Showroom)';
alter table public.purchases add column if not exists invoice_date    date;
alter table public.purchases add column if not exists vehicle_no      text;
alter table public.purchases add column if not exists expenses        numeric not null default 0;
alter table public.purchases add column if not exists subtotal        numeric not null default 0;
alter table public.purchases add column if not exists total_discount  numeric not null default 0;
alter table public.purchases add column if not exists total_sgst      numeric not null default 0;
alter table public.purchases add column if not exists total_cgst      numeric not null default 0;
alter table public.purchases add column if not exists round_off       numeric not null default 0;
alter table public.purchases add column if not exists net_amount      numeric not null default 0;
alter table public.purchases add column if not exists paid_amount     numeric not null default 0;
alter table public.purchases add column if not exists payment_status  text not null default 'Pending';

update public.purchases
set invoice_date = coalesce(invoice_date, entry_date, created_at::date, current_date)
where invoice_date is null;

-- Backfill per-line sgst/cgst inside items jsonb from legacy gst field
update public.purchases p
set items = (
  select coalesce(jsonb_agg(
    case
      when (elem ? 'sgst') or (elem ? 'cgst') then elem
      when coalesce((elem->>'gst')::numeric, 0) > 0 then
        elem
        || jsonb_build_object(
          'sgst', round((elem->>'gst')::numeric / 2, 2),
          'cgst', round((elem->>'gst')::numeric / 2, 2)
        )
      else
        elem || jsonb_build_object('sgst', 9, 'cgst', 9)
    end
  ), '[]'::jsonb)
  from jsonb_array_elements(p.items) as elem
)
where jsonb_array_length(coalesce(p.items, '[]'::jsonb)) > 0;

notify pgrst, 'reload schema';
