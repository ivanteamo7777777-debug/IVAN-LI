-- Supabase production projects grant the server-only service role table access
-- by default. Keep freshly migrated local and CI databases equivalent so
-- server-side plan writes can reach the hierarchy trigger and its lookups.
grant select, insert, update, delete on table public.plans to service_role;
grant select on table public.directions to service_role;
