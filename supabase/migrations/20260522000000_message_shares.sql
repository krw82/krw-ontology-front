-- Public answer sharing stores immutable assistant-message snapshots behind
-- unguessable tokens. Source chat ownership is checked by server routes before
-- insert; public reads are served through server routes, not direct table grants.

CREATE TABLE IF NOT EXISTS message_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE,
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  source_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '공유된 답변',
  answer_content TEXT NOT NULL,
  answer_created_at TIMESTAMPTZ NOT NULL,
  tickers TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_message_shares_active_message
  ON message_shares (source_message_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_message_shares_token_active
  ON message_shares (token)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_message_shares_owner_created
  ON message_shares (owner_user_id, created_at DESC);

ALTER TABLE message_shares ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE message_shares FROM anon, authenticated, PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE message_shares TO service_role;
