-- Create a table for sales estimations / quotations
create table if not exists public.quotations (
  quotation_no text primary key,
  customer_name text not null,
  customer_phone text,
  valid_till date not null,
  amount numeric not null,
  status text default 'Pending' not null,
  items_summary text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table public.quotations enable row level security;

-- RLS Policies
create policy "Allow read access to anyone" on public.quotations
  for select using (true);

create policy "Allow insert access to authenticated users" on public.quotations
  for insert with check (true);

create policy "Allow update access to authenticated users" on public.quotations
  for update using (true);

create policy "Allow delete access to authenticated users" on public.quotations
  for delete using (true);
