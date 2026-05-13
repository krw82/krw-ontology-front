-- Prevent concurrent active runs for the same chat session.
-- The RPC already checks NOT EXISTS, but this index makes the invariant
-- database-enforced under concurrent transactions.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_runs_active_session
ON agent_runs (session_id)
WHERE status IN ('pending', 'running');
