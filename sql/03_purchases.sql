-- Create a table for wholesale purchase invoices
create table if not exists public.purchases (
  bill_no text primary key,
  supplier_name text not null,
  purchase_date date not null,
  amount numeric not null,
  tax_amount numeric default 0 not null,
  payment_status text default 'Pending' not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
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
