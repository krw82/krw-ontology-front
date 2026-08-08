-- Session-level chat sharing stores immutable snapshots of all completed Q&A
-- in a chat session behind unguessable tokens. Separate from message_shares
-- (single-answer sharing) to keep the two systems independent.

CREATE TABLE IF NOT EXISTS session_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '공유된 대화',
  tickers TEXT[],
  locale TEXT NOT NULL DEFAULT 'ko',
  messages JSONB NOT NULL,
  message_count INT NOT NULL,
  share_context JSONB DEFAULT '{}'::jsonb,
  snapshot_version INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_session_shares_active_session
  ON session_shares (source_session_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_session_shares_token_active
  ON session_shares (token)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_session_shares_owner_created
  ON session_shares (owner_user_id, created_at DESC);

ALTER TABLE session_shares ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE session_shares FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE session_shares TO service_role;
