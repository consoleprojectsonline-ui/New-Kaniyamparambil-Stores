-- Create a table for inventory catalog items
create table if not exists public.inventory (
  code text primary key,
  name text not null,
  company_code text,
  "group" text not null,
  sub_group text,
  brand text,
  type text default 'Goods' not null,
  hsn_code text,
  uom text not null,
  enable_batch text default 'N' not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS)
alter table public.inventory enable row level security;

-- RLS Policies
create policy "Allow read access to anyone" on public.inventory
  for select using (true);

create policy "Allow insert access to authenticated users" on public.inventory
  for insert with check (true);

create policy "Allow update access to authenticated users" on public.inventory
  for update using (true);

create policy "Allow delete access to authenticated users" on public.inventory
  for delete using (true);
