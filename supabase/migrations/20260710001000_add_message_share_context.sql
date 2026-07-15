-- Store immutable public-share surface metadata. Public share pages should not
-- follow mutable source runs to decide how to label an already-created share.

ALTER TABLE message_shares
  ADD COLUMN IF NOT EXISTS share_context JSONB NOT NULL DEFAULT '{}'::jsonb;
