-- Create a table for wholesale purchase invoices (full schema with SGST/CGST)
create table if not exists public.purchases (
  invoice_no    text primary key,
  serial_no     text,                                  -- internal serial / reference number
  supplier_name text not null,
  purchase_type text not null default 'Local Purchase',
  branch_godown text not null default 'Shop (Main Showroom)',
  entry_date    date not null,
  invoice_date  date not null,
  vehicle_no    text,
  items         jsonb not null default '[]',            -- array of PurchaseItem { code, name, hsn_code, qty, unit, rate, disc, sgst, cgst, s_rate, mrp }
  expenses      numeric not null default 0,
  subtotal      numeric not null default 0,             -- base value before tax/discount
  total_sgst    numeric not null default 0,             -- aggregate SGST across all items
  total_cgst    numeric not null default 0,             -- aggregate CGST across all items
  net_amount    numeric not null default 0,             -- final payable = subtotal - discount + sgst + cgst + expenses
  paid_amount   numeric not null default 0,
  payment_status text not null default 'Pending',       -- 'Paid' | 'Partial' | 'Pending'
  created_at    timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
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
