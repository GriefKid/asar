begin;

-- Only profiles that opted into discovery appear here. Private account data
-- and shared works remain protected by their existing policies.
create or replace function public.asar_discover_profiles(search_text text default '', page_limit integer default 50)
returns table (id uuid, username text, display_name text, bio text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.username, p.display_name, p.bio
  from public.asar_profiles p
  where auth.uid() is not null
    and p.discoverable
    and p.id <> auth.uid()
    and not public.asar_blocked(p.id)
    and (
      coalesce(trim(search_text), '') = ''
      or p.username ilike '%' || left(trim(search_text), 60) || '%'
      or p.display_name ilike '%' || left(trim(search_text), 60) || '%'
    )
  order by p.username
  limit least(greatest(coalesce(page_limit, 50), 1), 50)
$$;

revoke execute on function public.asar_discover_profiles(text, integer) from public, anon;
grant execute on function public.asar_discover_profiles(text, integer) to authenticated;

commit;
