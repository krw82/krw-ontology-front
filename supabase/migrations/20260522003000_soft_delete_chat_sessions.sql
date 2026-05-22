-- Hide deleted chat sessions without immediately cascading historical messages,
-- runs, citations, artifacts, or share records.

ALTER TABLE chat_sessions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_visible_updated
  ON chat_sessions (user_id, updated_at DESC)
  WHERE deleted_at IS NULL;
