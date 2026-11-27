begin;

alter table public.user_data add column if not exists actual_events jsonb not null default '{}'::jsonb;
alter table public.user_data add column if not exists extra_data jsonb not null default '{}'::jsonb;

create or replace function public.asar_is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.profiles where id = auth.uid() and is_admin) $$;
revoke execute on function public.asar_is_admin() from public, anon;
grant execute on function public.asar_is_admin() to authenticated;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.asar_is_admin());
revoke insert, update on public.profiles from public, anon, authenticated;
grant insert (id, email, display_name), update (email, display_name) on public.profiles to authenticated;
drop policy if exists userdata_select_own on public.user_data;
create policy userdata_select_own on public.user_data for select to authenticated
  using (id = auth.uid() or public.asar_is_admin());

create table if not exists public.asar_profiles (
  id uuid primary key references auth.users on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
  display_name text not null default '' check (length(display_name) <= 60),
  bio text not null default '' check (length(bio) <= 280),
  avatar text not null default '' check (length(avatar) <= 200000 and (avatar = '' or avatar ~ '^data:image/jpeg;base64,[A-Za-z0-9+/=]+$')),
  discoverable boolean not null default false
);
create table if not exists public.asar_follows (
  requester uuid references public.asar_profiles on delete cascade,
  owner uuid references public.asar_profiles on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  primary key (requester, owner),
  check (requester <> owner)
);
create index if not exists asar_follows_owner on public.asar_follows(owner);
create table if not exists public.asar_blocks (
  owner uuid references public.asar_profiles on delete cascade,
  blocked uuid references public.asar_profiles on delete cascade,
  primary key (owner, blocked),
  check (owner <> blocked)
);
create index if not exists asar_blocks_blocked on public.asar_blocks(blocked);
create table if not exists public.asar_shared_works (
  owner uuid references public.asar_profiles on delete cascade,
  work_id text check (length(work_id) <= 120),
  title text not null check (length(title) between 1 and 300),
  creator text not null default '' check (length(creator) <= 160),
  kind text not null check (kind in ('book', 'film', 'music')),
  stage text not null check (stage in ('queue', 'active', 'done')),
  rating integer not null default 0 check (rating between 0 and 5),
  collection text not null default '' check (length(collection) <= 70),
  pinned boolean not null default false,
  primary key (owner, work_id)
);

create or replace function public.asar_blocked(other_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.asar_blocks
  where (owner = auth.uid() and blocked = other_id) or (blocked = auth.uid() and owner = other_id)) $$;

create or replace function public.asar_can_view(target_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() = target_id or (
    not public.asar_blocked(target_id) and exists (
      select 1 from public.asar_follows
      where requester = auth.uid() and owner = target_id and status = 'accepted'
    )
  )
$$;

create or replace function public.asar_find_profile(handle text)
returns table (id uuid, username text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.username from public.asar_profiles p
  where auth.uid() is not null and p.discoverable and p.username = lower(trim(handle))
    and p.id <> auth.uid() and not public.asar_blocked(p.id)
$$;

create or replace function public.asar_follow_handles()
returns table (peer_id uuid, username text)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.username
  from public.asar_profiles p
  where auth.uid() is not null and (
    exists (select 1 from public.asar_blocks b where b.owner = auth.uid() and b.blocked = p.id) or
    (not public.asar_blocked(p.id) and exists (
      select 1 from public.asar_follows f
      where (f.requester = auth.uid() and f.owner = p.id) or (f.owner = auth.uid() and f.requester = p.id)
    ))
  )
$$;

create or replace function public.asar_block_profile(other_id uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or auth.uid() = other_id then raise exception 'Invalid account'; end if;
  insert into public.asar_blocks(owner, blocked) values (auth.uid(), other_id) on conflict do nothing;
  delete from public.asar_follows
  where (requester = auth.uid() and owner = other_id) or (owner = auth.uid() and requester = other_id);
end
$$;

revoke execute on function public.asar_blocked(uuid), public.asar_can_view(uuid), public.asar_find_profile(text),
  public.asar_follow_handles(), public.asar_block_profile(uuid) from public, anon;
grant execute on function public.asar_blocked(uuid), public.asar_can_view(uuid), public.asar_find_profile(text),
  public.asar_follow_handles(), public.asar_block_profile(uuid) to authenticated;

alter table public.asar_profiles enable row level security;
alter table public.asar_follows enable row level security;
alter table public.asar_blocks enable row level security;
alter table public.asar_shared_works enable row level security;

revoke all on public.asar_profiles, public.asar_follows, public.asar_blocks, public.asar_shared_works from public, anon, authenticated;
grant select, insert, update on public.asar_profiles to authenticated;
grant select, insert, delete on public.asar_follows to authenticated;
grant update (status) on public.asar_follows to authenticated;
grant select, delete on public.asar_blocks to authenticated;
grant select, insert, update, delete on public.asar_shared_works to authenticated;

drop policy if exists asar_profile_read on public.asar_profiles;
create policy asar_profile_read on public.asar_profiles for select to authenticated using (public.asar_can_view(id));
drop policy if exists asar_profile_create on public.asar_profiles;
create policy asar_profile_create on public.asar_profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists asar_profile_edit on public.asar_profiles;
create policy asar_profile_edit on public.asar_profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists asar_follow_read on public.asar_follows;
create policy asar_follow_read on public.asar_follows for select to authenticated using (requester = auth.uid() or owner = auth.uid());
drop policy if exists asar_follow_request on public.asar_follows;
create policy asar_follow_request on public.asar_follows for insert to authenticated
  with check (requester = auth.uid() and status = 'pending' and not public.asar_blocked(owner));
drop policy if exists asar_follow_approve on public.asar_follows;
create policy asar_follow_approve on public.asar_follows for update to authenticated
  using (owner = auth.uid()) with check (owner = auth.uid() and status = 'accepted' and not public.asar_blocked(requester));
drop policy if exists asar_follow_remove on public.asar_follows;
create policy asar_follow_remove on public.asar_follows for delete to authenticated using (requester = auth.uid() or owner = auth.uid());
drop policy if exists asar_blocks_self on public.asar_blocks;
create policy asar_blocks_self on public.asar_blocks for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

drop policy if exists asar_work_read on public.asar_shared_works;
create policy asar_work_read on public.asar_shared_works for select to authenticated using (public.asar_can_view(owner));
drop policy if exists asar_work_write on public.asar_shared_works;
create policy asar_work_write on public.asar_shared_works for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

commit;
