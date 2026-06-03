-- Extend public answer shares into read-only shared chat snapshots.
-- Public pages continue to read immutable snapshot fields only; they do not
-- follow source sessions or expose the full chat history.

ALTER TABLE message_shares
  ADD COLUMN IF NOT EXISTS source_question_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS question_content TEXT,
  ADD COLUMN IF NOT EXISTS question_created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS snapshot_version SMALLINT NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_message_shares_question_message
  ON message_shares (source_question_message_id)
  WHERE source_question_message_id IS NOT NULL;

-- Backfill exact run-linked questions where possible. Attachment snapshots are
-- intentionally not backfilled; split_part keeps only visible text before the
-- first attachment marker.
WITH run_questions AS (
  SELECT
    ms.id AS share_id,
    um.id AS question_message_id,
    NULLIF(LEFT(BTRIM(SPLIT_PART(um.content, '<attached_file', 1)), 8000), '') AS visible_question,
    um.created_at AS question_created_at
  FROM message_shares ms
  JOIN agent_runs ar
    ON ar.assistant_message_id = ms.source_message_id
   AND ar.session_id = ms.source_session_id
  JOIN messages um
    ON um.id = ar.user_message_id
   AND um.role = 'user'
  WHERE ms.question_content IS NULL
)
UPDATE message_shares ms
SET
  source_question_message_id = run_questions.question_message_id,
  question_content = run_questions.visible_question,
  question_created_at = run_questions.question_created_at
FROM run_questions
WHERE ms.id = run_questions.share_id
  AND run_questions.visible_question IS NOT NULL;

-- Fallback for older rows where the run link is absent: use the closest prior
-- user message in the same session.
WITH previous_questions AS (
  SELECT DISTINCT ON (ms.id)
    ms.id AS share_id,
    um.id AS question_message_id,
    NULLIF(LEFT(BTRIM(SPLIT_PART(um.content, '<attached_file', 1)), 8000), '') AS visible_question,
    um.created_at AS question_created_at
  FROM message_shares ms
  JOIN messages answer
    ON answer.id = ms.source_message_id
  JOIN messages um
    ON um.session_id = ms.source_session_id
   AND um.role = 'user'
   AND um.created_at <= answer.created_at
  WHERE ms.question_content IS NULL
  ORDER BY ms.id, um.created_at DESC
)
UPDATE message_shares ms
SET
  source_question_message_id = previous_questions.question_message_id,
  question_content = previous_questions.visible_question,
  question_created_at = previous_questions.question_created_at
FROM previous_questions
WHERE ms.id = previous_questions.share_id
  AND previous_questions.visible_question IS NOT NULL;
