-- Create a table for public user details
create table if not exists public.users (
  id uuid references auth.users on delete cascade primary key,
  email text not null unique,
  gst_id text,
  password text, -- Hashed password stored for reference
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable Row Level Security (RLS) to secure the data
alter table public.users enable row level security;

-- Create policies for RLS
create policy "Allow read access to authenticated users" on public.users
  for select to authenticated using (true);

create policy "Allow users to update their own profile" on public.users
  for update to authenticated using (auth.uid() = id);

-- Trigger to automatically insert user details from auth.users on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.users (id, email, gst_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'gst_number', '')
  );
  return new;
end;
$$ language plpgsql security definer;

-- Trigger execution
create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
