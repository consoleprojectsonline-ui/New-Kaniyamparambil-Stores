-- ─────────────────────────────────────────────────────────────────────────────
-- Sales table — full bill sections (header, line items, financial summary)
-- Run in Supabase → SQL Editor. Safe to re-run. Keeps existing data.
--
-- Section 1 (Bill Header): form_type, bill_no, bill_date, customer_*, ship_to,
--   salesman, vehicle_no, branch_godown, rate_tp
-- Section 2 (Item Grid): stored in `items` jsonb — each element should include:
--   code, name, hsn_code, qty, unit, rate (cost), mrp (unit price), amount,
--   disc_pct, sgst (%), cgst (%), taxable_value, discount_amount,
--   sgst_amount, cgst_amount, line_total
-- Section 3 (Financial Summary): subtotal, lines_total, f_cess, discount,
--   total_gst, total_sgst, total_cgst, commission, postage (travel expense),
--   round_off, grand_total, payment_amount, payment_mode, balance, payment_status
-- ─────────────────────────────────────────────────────────────────────────────

-- Bill header extras
alter table public.sales add column if not exists vehicle_no      text;

-- Financial summary (section 3)
alter table public.sales add column if not exists lines_total     numeric not null default 0;
alter table public.sales add column if not exists total_sgst      numeric not null default 0;
alter table public.sales add column if not exists total_cgst      numeric not null default 0;
alter table public.sales add column if not exists round_off         numeric not null default 0;

-- Ensure other app columns exist (no-op if already present)
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
alter table public.sales add column if not exists grand_total     numeric not null default 0;
alter table public.sales add column if not exists payment_amount  numeric not null default 0;
alter table public.sales add column if not exists payment_mode    text not null default 'Cash';
alter table public.sales add column if not exists balance         numeric not null default 0;
alter table public.sales add column if not exists payment_status  text not null default 'Paid';

-- Backfill split GST totals where only total_gst was stored
update public.sales
set
  total_sgst = round(total_gst / 2, 2),
  total_cgst = round(total_gst - round(total_gst / 2, 2), 2)
where total_gst > 0
  and total_sgst = 0
  and total_cgst = 0;

-- Backfill lines_total from grand_total when missing (approximate for legacy rows)
update public.sales
set lines_total = grand_total
where lines_total = 0
  and grand_total > 0;

-- Backfill per-line sgst/cgst inside items jsonb from legacy gst_percent
update public.sales s
set items = (
  select coalesce(jsonb_agg(
    case
      when (elem ? 'sgst') or (elem ? 'cgst') then elem
      when coalesce((elem->>'gst_percent')::numeric, 0) > 0 then
        elem
        || jsonb_build_object(
          'sgst', round((elem->>'gst_percent')::numeric / 2, 2),
          'cgst', round((elem->>'gst_percent')::numeric / 2, 2)
        )
      else
        elem || jsonb_build_object('sgst', 9, 'cgst', 9)
    end
  ), '[]'::jsonb)
  from jsonb_array_elements(s.items) as elem
)
where jsonb_array_length(coalesce(s.items, '[]'::jsonb)) > 0;

notify pgrst, 'reload schema';
