-- Keep server-owned chat lifecycle tables readable through RLS, but prevent
-- browser Supabase clients from forging run/message/tool state over Data API.

REVOKE INSERT, UPDATE, DELETE ON TABLE
  messages,
  agent_runs,
  tool_calls,
  citations,
  research_artifacts,
  usage_daily,
  concurrency_leases
FROM anon, authenticated, PUBLIC;

GRANT SELECT ON TABLE
  messages,
  agent_runs,
  tool_calls,
  citations,
  research_artifacts,
  usage_daily
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  messages,
  agent_runs,
  tool_calls,
  citations,
  research_artifacts,
  usage_daily,
  concurrency_leases
TO service_role;

DROP POLICY IF EXISTS "messages_insert_own" ON messages;
DROP POLICY IF EXISTS "messages_update_own" ON messages;

DROP POLICY IF EXISTS "runs_insert_own" ON agent_runs;
DROP POLICY IF EXISTS "runs_update_own" ON agent_runs;

DROP POLICY IF EXISTS "tool_calls_insert_own" ON tool_calls;
DROP POLICY IF EXISTS "tool_calls_update_own" ON tool_calls;

DROP POLICY IF EXISTS "citations_insert_own" ON citations;
DROP POLICY IF EXISTS "citations_update_own" ON citations;

DROP POLICY IF EXISTS "research_artifacts_insert_own" ON research_artifacts;
DROP POLICY IF EXISTS "research_artifacts_update_own" ON research_artifacts;
