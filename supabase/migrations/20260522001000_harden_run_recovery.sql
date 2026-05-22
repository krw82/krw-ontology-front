-- Keep long agent runs recoverable across reconnects and refreshes.

DO $$
DECLARE
  expired_run_ids UUID[];
BEGIN
  SELECT COALESCE(array_agg(agent_runs.id), ARRAY[]::UUID[])
  INTO expired_run_ids
  FROM agent_runs
  WHERE status = 'running'
    AND lease_expires_at < NOW();

  IF array_length(expired_run_ids, 1) IS NOT NULL THEN
    UPDATE agent_runs
    SET status = 'failed',
        error_code = 'lease_expired',
        error_message = 'Lease expired',
        finished_at = NOW()
    WHERE agent_runs.id = ANY(expired_run_ids);

    UPDATE messages
    SET status = 'failed',
        content = '분석 시간이 초과되었습니다. 다시 시도해주세요.'
    WHERE messages.id IN (
      SELECT assistant_message_id
      FROM agent_runs
      WHERE agent_runs.id = ANY(expired_run_ids)
        AND assistant_message_id IS NOT NULL
    );

    UPDATE concurrency_leases
    SET released_at = NOW()
    WHERE run_id = ANY(expired_run_ids)
      AND released_at IS NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_one_active_per_session
  ON agent_runs (session_id)
  WHERE status IN ('pending', 'running');

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
LANGUAGE plpgsql
AS $$
DECLARE
  expired_run_ids UUID[];
BEGIN
  SELECT COALESCE(array_agg(agent_runs.id), ARRAY[]::UUID[])
  INTO expired_run_ids
  FROM agent_runs
  WHERE status = 'running'
    AND lease_expires_at < NOW();

  IF array_length(expired_run_ids, 1) IS NOT NULL THEN
    UPDATE agent_runs
    SET status = 'failed',
        error_code = 'lease_expired',
        error_message = 'Lease expired',
        finished_at = NOW()
    WHERE agent_runs.id = ANY(expired_run_ids);

    UPDATE messages
    SET status = 'failed',
        content = '분석 시간이 초과되었습니다. 다시 시도해주세요.'
    WHERE messages.id IN (
      SELECT assistant_message_id
      FROM agent_runs
      WHERE agent_runs.id = ANY(expired_run_ids)
        AND assistant_message_id IS NOT NULL
    );

    UPDATE concurrency_leases
    SET released_at = NOW()
    WHERE run_id = ANY(expired_run_ids)
      AND released_at IS NULL;
  END IF;

  RETURN QUERY
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
END;
$$;
