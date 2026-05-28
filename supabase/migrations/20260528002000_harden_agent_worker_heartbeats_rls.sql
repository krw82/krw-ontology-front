-- agent_worker_heartbeats is an internal operations table.
-- Keep it in public for server-side Supabase access, but block PostgREST
-- access from browser-facing anon/authenticated roles.

ALTER TABLE public.agent_worker_heartbeats ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.agent_worker_heartbeats
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_worker_heartbeats
  TO service_role;
