-- Create a table for customer sales invoices
create table if not exists public.sales (
  invoice_no text primary key,
  customer_name text not null,
  customer_phone text,
  invoice_date date not null,
  amount numeric not null,
  tax_amount numeric default 0 not null,
  payment_status text default 'Paid' not null,
  payment_mode text default 'UPI' not null,
  items_summary text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
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
