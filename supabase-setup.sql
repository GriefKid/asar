-- ══════════════════════════════════════════════════════════════
-- اثر — Supabase Database Setup
-- این SQL رو توی Supabase Dashboard → SQL Editor اجرا کن
-- ══════════════════════════════════════════════════════════════

-- 1. جداول ─────────────────────────────────────────────────────

create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  display_name text,
  is_admin boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.user_data (
  id uuid references auth.users on delete cascade primary key,
  library jsonb default '[]'::jsonb,
  events jsonb default '{}'::jsonb,
  habits jsonb default '[]'::jsonb,
  goals jsonb default '[]'::jsonb,
  updated_at timestamptz default now()
);

create table if not exists public.community (
  key text primary key,
  type text not null,
  title text not null,
  artist text default '',
  cover text default '',
  votes jsonb default '{}'::jsonb,
  avg float8 default 0,
  count int default 0
);

-- 2. Row Level Security ────────────────────────────────────────

alter table public.profiles enable row level security;
alter table public.user_data enable row level security;
alter table public.community enable row level security;

-- profiles: هر کاربر پروفایل خودشو میتونه ببینه و ویرایش کنه
-- ادمین همه رو میتونه ببینه
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (true);

create policy "profiles_insert" on public.profiles
  for insert to authenticated
  with check (auth.uid() = id);

create policy "profiles_update" on public.profiles
  for update to authenticated
  using (auth.uid() = id);

-- user_data: فقط صاحبش + ادمین میتونن ببینن
create policy "userdata_select_own" on public.user_data
  for select to authenticated
  using (
    auth.uid() = id
    or exists (
      select 1 from public.profiles
      where id = auth.uid() and is_admin = true
    )
  );

create policy "userdata_upsert" on public.user_data
  for all to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- community: همه میتونن بخونن، کاربران لاگین‌کرده میتونن بنویسن
create policy "community_read" on public.community
  for select
  using (true);

create policy "community_write" on public.community
  for all to authenticated
  using (true)
  with check (true);

-- 3. Trigger: ساخت پروفایل بعد از ثبت‌نام ──────────────────────

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ══════════════════════════════════════════════════════════════
-- 4. ادمین کردن یه کاربر (بعد از اینکه اکانت ساخته شد)
-- ══════════════════════════════════════════════════════════════
-- update public.profiles set is_admin = true where email = 'your@email.com';
