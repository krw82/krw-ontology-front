-- Make chat run creation idempotent before agent_runs is inserted.
--
-- agent_runs.request_id is already unique, but duplicate requests could still
-- create extra chat_sessions/messages before the run row existed. These keys
-- close that gap for session-less first messages and user message inserts.

ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS client_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_sessions_user_client_request
  ON chat_sessions (user_id, client_request_id)
  WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_client_request
  ON chat_sessions (client_request_id)
  WHERE client_request_id IS NOT NULL;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_messages_user_request_id
  ON messages (request_id)
  WHERE role = 'user'
    AND request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_request_id
  ON messages (request_id)
  WHERE request_id IS NOT NULL;

-- Pre-production cleanup: old containers or browser disconnects can leave runs
-- marked running even after the process has gone away. Clear those before the
-- new idempotency path is used.
DO $$
DECLARE
  expired_run_ids UUID[];
BEGIN
  SELECT COALESCE(array_agg(agent_runs.id), ARRAY[]::UUID[])
  INTO expired_run_ids
  FROM agent_runs
  WHERE status = 'running'
    AND (
      lease_expires_at < NOW()
      OR started_at < NOW() - INTERVAL '15 minutes'
    );

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

-- Keep the database-side lease function aligned with the runtime hard timeout.
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
    AND (
      lease_expires_at < NOW()
      OR started_at < NOW() - INTERVAL '15 minutes'
    );

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
      AND started_at >= NOW() - INTERVAL '15 minutes'
  ) < p_global_limit
  RETURNING agent_runs.id;
END;
$$;
