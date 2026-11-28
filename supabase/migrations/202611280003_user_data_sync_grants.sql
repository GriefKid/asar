begin;

-- RLS already limits each signed-in user to their own row. PostgREST also
-- needs table privileges before it can evaluate those policies.
grant select, insert, update on public.user_data to authenticated;
grant select on public.profiles to authenticated;

commit;
