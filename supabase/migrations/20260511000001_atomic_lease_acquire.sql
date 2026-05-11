-- Atomic lease acquisition function.
-- Eliminates the TOCTOU race condition in lease.ts tryAcquireLease.
-- Also cleans up expired leases atomically.
CREATE OR REPLACE FUNCTION try_acquire_lease(
  p_session_id UUID,
  p_user_message_id UUID,
  p_request_id TEXT,
  p_model TEXT,
  p_web_commit TEXT,
  p_krw_ontology_commit TEXT,
  p_expires_at TIMESTAMPTZ,
  p_global_limit INTEGER
)
RETURNS TABLE (id UUID)
LANGUAGE sql
AS $$
  -- First, clean up expired leases
  UPDATE agent_runs
  SET status = 'failed',
      error_code = 'lease_expired',
      error_message = 'Lease expired',
      finished_at = NOW()
  WHERE status = 'running'
    AND lease_expires_at < NOW();

  -- Then, conditionally insert a new run only if:
  -- 1. No active/pending run exists for this session
  -- 2. Global concurrent limit is not reached
  INSERT INTO agent_runs (
    session_id, user_message_id, request_id, model,
    status, lease_expires_at, started_at,
    web_commit, krw_ontology_commit
  )
  SELECT
    p_session_id, p_user_message_id, p_request_id, p_model,
    'running', p_expires_at, NOW(),
    p_web_commit, p_krw_ontology_commit
  WHERE NOT EXISTS (
    SELECT 1 FROM agent_runs
    WHERE session_id = p_session_id
      AND status IN ('pending', 'running')
  )
  AND (
    SELECT COUNT(*) FROM agent_runs
    WHERE status = 'running'
      AND lease_expires_at > NOW()
  ) < p_global_limit
  RETURNING agent_runs.id;
$$;
