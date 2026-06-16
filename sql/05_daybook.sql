-- Create a table for general ledger daily transactions
create table if not exists public.transactions (
  id uuid default gen_random_uuid() primary key,
  description text not null,
  type text check (type in ('Income', 'Expense')) not null,
  amount numeric not null,
  payment_mode text check (payment_mode in ('Cash', 'Bank', 'UPI')) not null,
  date date not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table public.transactions enable row level security;

-- RLS Policies
create policy "Allow read access to anyone" on public.transactions
  for select using (true);

create policy "Allow insert access to authenticated users" on public.transactions
  for insert with check (true);

create policy "Allow update access to authenticated users" on public.transactions
  for update using (true);

create policy "Allow delete access to authenticated users" on public.transactions
  for delete using (true);
