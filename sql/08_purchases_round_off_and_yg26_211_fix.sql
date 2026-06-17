-- ─────────────────────────────────────────────────────────────────────────────
-- Purchases: round_off column + fix invoice YG26-211 totals per supplier tax bill
-- Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.purchases add column if not exists round_off numeric not null default 0;

-- YES GUARD POLYMERS · Invoice YG26-211 · Grand Total ₹1,13,140.00
update public.purchases
set
  items = '[
    {"code":"260","name":"RED GOLD HIGH PRESSURE 5 LAYER HOSE 50M","hsn_code":"39173990","qty":30,"unit":"Nos","rate":1779.66,"disc":0,"sgst":9,"cgst":9},
    {"code":"261","name":"LS-2 FT STRAIGHT SPRAY GUN B4","hsn_code":"84242000","qty":50,"unit":"Nos","rate":847.46,"disc":4237.30,"sgst":9,"cgst":9},
    {"code":"262","name":"OR-3/4 BS THREAD PVC BALL VALVE B4","hsn_code":"39174000","qty":50,"unit":"Nos","rate":53.47,"disc":267.35,"sgst":9,"cgst":9},
    {"code":"263","name":"CLASSIC HEALTH FAUCET SET","hsn_code":"39249090","qty":10,"unit":"Nos","rate":205.19,"disc":102.60,"sgst":9,"cgst":9}
  ]'::jsonb,
  subtotal        = 100488.20,
  total_discount  = 4607.25,
  total_sgst      = 8629.30,
  total_cgst      = 8629.30,
  round_off       = 0.45,
  net_amount      = 113140.00,
  paid_amount     = 113140.00,
  payment_status  = 'Paid'
where invoice_no = 'YG26-211';

notify pgrst, 'reload schema';
