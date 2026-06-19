-- ─────────────────────────────────────────────────────────────────────────────
-- HSN / SAC master — valid tax classification codes for purchases & inventory
-- Run in Supabase → SQL Editor. Safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.hsn_codes (
  code             text primary key,
  description      text not null default '',
  chapter          text,
  default_gst_rate numeric,
  is_active        boolean not null default true,
  created_at       timestamp with time zone default timezone('utc'::text, now()) not null
);

alter table public.hsn_codes add column if not exists description      text not null default '';
alter table public.hsn_codes add column if not exists chapter          text;
alter table public.hsn_codes add column if not exists default_gst_rate numeric;
alter table public.hsn_codes add column if not exists is_active        boolean not null default true;
alter table public.hsn_codes add column if not exists created_at       timestamp with time zone default timezone('utc'::text, now()) not null;

create index if not exists hsn_codes_description_idx
  on public.hsn_codes (description);

create index if not exists hsn_codes_active_idx
  on public.hsn_codes (is_active) where is_active = true;

-- Seed from existing inventory catalog (distinct valid codes)
insert into public.hsn_codes (code, description)
select distinct on (trim(hsn_code))
  trim(hsn_code),
  coalesce(nullif(trim(name), ''), 'From inventory')
from public.inventory
where trim(hsn_code) ~ '^\d{4,8}$'
order by trim(hsn_code), trim(name)
on conflict (code) do nothing;

-- Common hardware / store HSN references
insert into public.hsn_codes (code, description, chapter) values
  ('82011000', 'Agricultural hand tools', '82'),
  ('8201',     'Hand tools', '82'),
  ('39173990', 'Plastic tubes and hoses', '39'),
  ('39174000', 'Plastic fittings', '39'),
  ('84242000', 'Spray guns', '84'),
  ('73063090', 'Steel conduit pipes', '73'),
  ('85444990', 'Electric conductors', '85'),
  ('85365090', 'Electrical switches', '85'),
  ('8481',     'Taps, cocks, valves', '84'),
  ('39249090', 'Plastic sanitary ware', '39'),
  ('84248200', 'Agricultural sprayers', '84')
on conflict (code) do nothing;

alter table public.hsn_codes enable row level security;

drop policy if exists "Allow read access to anyone" on public.hsn_codes;
create policy "Allow read access to anyone" on public.hsn_codes
  for select using (true);

drop policy if exists "Allow insert access to authenticated users" on public.hsn_codes;
create policy "Allow insert access to authenticated users" on public.hsn_codes
  for insert with check (true);

drop policy if exists "Allow update access to authenticated users" on public.hsn_codes;
create policy "Allow update access to authenticated users" on public.hsn_codes
  for update using (true);

drop policy if exists "Allow delete access to authenticated users" on public.hsn_codes;
create policy "Allow delete access to authenticated users" on public.hsn_codes
  for delete using (true);

notify pgrst, 'reload schema';
