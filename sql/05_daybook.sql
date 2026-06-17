-- ─────────────────────────────────────────────────────────────────────────────
-- Day book ledger — safe setup / migration (keeps existing data)
-- Run the whole script in Supabase SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Create table when missing (fresh installs)
create table if not exists public.daybook_entries (
  id            uuid default gen_random_uuid() primary key,
  entry_date    date not null default current_date,
  description   text not null,
  type          text not null default 'Income',
  category      text not null default 'General',
  amount        numeric not null default 0,
  payment_mode  text not null default 'Cash',
  source        text not null default 'manual',
  reference_no  text,
  notes         text,
  created_at    timestamp with time zone default timezone('utc'::text, now()) not null
);

-- 2) Migrate legacy public.transactions rows into daybook_entries (one-time safe copy)
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'transactions'
  ) then
    insert into public.daybook_entries (
      entry_date, description, type, category, amount, payment_mode, source, reference_no, created_at
    )
    select
      t.date,
      t.description,
      t.type,
      'General',
      t.amount,
      t.payment_mode,
      'manual',
      null,
      coalesce(t.created_at, timezone('utc'::text, now()))
    from public.transactions t
    where not exists (
      select 1 from public.daybook_entries d
      where d.source = 'manual'
        and d.entry_date = t.date
        and d.description = t.description
        and d.amount = t.amount
        and d.type = t.type
        and d.payment_mode = t.payment_mode
    );
  end if;
end $$;

-- 3) Add missing columns when upgrading an existing daybook_entries table
alter table public.daybook_entries add column if not exists entry_date   date;
alter table public.daybook_entries add column if not exists description  text;
alter table public.daybook_entries add column if not exists type         text not null default 'Income';
alter table public.daybook_entries add column if not exists category     text not null default 'General';
alter table public.daybook_entries add column if not exists amount       numeric not null default 0;
alter table public.daybook_entries add column if not exists payment_mode text not null default 'Cash';
alter table public.daybook_entries add column if not exists source       text not null default 'manual';
alter table public.daybook_entries add column if not exists reference_no text;
alter table public.daybook_entries add column if not exists notes        text;
alter table public.daybook_entries add column if not exists created_at   timestamp with time zone default timezone('utc'::text, now()) not null;

-- 4) Backfill entry_date from created_at when missing
update public.daybook_entries
set entry_date = coalesce(entry_date, created_at::date, current_date)
where entry_date is null;

-- 5) Drop old strict checks so payment modes match Sales / Purchase modules
alter table public.daybook_entries drop constraint if exists daybook_entries_type_check;
alter table public.daybook_entries drop constraint if exists daybook_entries_payment_mode_check;
alter table public.daybook_entries drop constraint if exists daybook_entries_category_check;
alter table public.daybook_entries drop constraint if exists daybook_entries_source_check;

alter table public.daybook_entries
  add constraint daybook_entries_type_check
  check (type in ('Income', 'Expense'));

alter table public.daybook_entries
  add constraint daybook_entries_category_check
  check (category in ('General', 'Sales', 'Purchase', 'Other'));

alter table public.daybook_entries
  add constraint daybook_entries_source_check
  check (source in ('manual', 'sales', 'purchase', 'system'));

-- 6) Indexes for date filtering (day book opens on today, filter any date)
create index if not exists daybook_entries_entry_date_idx
  on public.daybook_entries (entry_date desc);

create index if not exists daybook_entries_source_idx
  on public.daybook_entries (source);

-- 7) Row Level Security (idempotent)
alter table public.daybook_entries enable row level security;

drop policy if exists "Allow read access to anyone" on public.daybook_entries;
create policy "Allow read access to anyone" on public.daybook_entries
  for select using (true);

drop policy if exists "Allow insert access to authenticated users" on public.daybook_entries;
create policy "Allow insert access to authenticated users" on public.daybook_entries
  for insert with check (true);

drop policy if exists "Allow update access to authenticated users" on public.daybook_entries;
create policy "Allow update access to authenticated users" on public.daybook_entries
  for update using (true);

drop policy if exists "Allow delete access to authenticated users" on public.daybook_entries;
create policy "Allow delete access to authenticated users" on public.daybook_entries
  for delete using (true);

-- 8) Reload PostgREST schema cache
notify pgrst, 'reload schema';
