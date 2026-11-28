begin;

-- Auth creates both the private account row and the followable profile.
-- A generated handle avoids asking new users to configure a profile first.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', ''))
  on conflict (id) do nothing;

  insert into public.asar_profiles (id, username, display_name, discoverable)
  values (
    new.id,
    'asar_' || left(md5(new.id::text), 19),
    left(coalesce(new.raw_user_meta_data->>'display_name', ''), 60),
    coalesce(new.raw_user_meta_data->>'asar_discoverable', 'false') = 'true'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Older accounts receive a profile without changing their privacy choice.
insert into public.asar_profiles (id, username, display_name, discoverable)
select u.id,
       'asar_' || left(md5(u.id::text), 19),
       left(coalesce(p.display_name, u.raw_user_meta_data->>'display_name', ''), 60),
       false
from auth.users u
left join public.profiles p on p.id = u.id
on conflict (id) do nothing;

commit;
