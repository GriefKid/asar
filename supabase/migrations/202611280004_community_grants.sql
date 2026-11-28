begin;

-- The existing RLS policies allow everyone to read ratings and signed-in
-- users to submit ratings. PostgREST also needs matching table privileges.
grant select on public.community to anon, authenticated;
grant insert, update on public.community to authenticated;

commit;
