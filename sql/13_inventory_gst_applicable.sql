-- ─────────────────────────────────────────────────────────────────────────────
-- Inventory — GST applicability flag per catalog item
-- Run in Supabase → SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.inventory add column if not exists gst_applicable boolean not null default true;

-- Known GST-exempt items (e.g. agricultural hand tools billed at 0% in supplier invoices)
update public.inventory
set gst_applicable = false
where upper(trim(code)) in ('017', '167');

notify pgrst, 'reload schema';
