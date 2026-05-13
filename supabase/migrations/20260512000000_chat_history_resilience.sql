-- Make chat history resilient to refreshes and streaming reconnects.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION touch_message_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_updated_at ON messages;
CREATE TRIGGER trg_messages_updated_at
  BEFORE UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION touch_message_updated_at();

CREATE OR REPLACE FUNCTION touch_session_from_message()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE chat_sessions
  SET updated_at = now()
  WHERE id = COALESCE(NEW.session_id, OLD.session_id);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_touch_session_insert ON messages;
CREATE TRIGGER trg_messages_touch_session_insert
  AFTER INSERT ON messages
  FOR EACH ROW
  EXECUTE FUNCTION touch_session_from_message();

DROP TRIGGER IF EXISTS trg_messages_touch_session_update ON messages;
CREATE TRIGGER trg_messages_touch_session_update
  AFTER UPDATE ON messages
  FOR EACH ROW
  EXECUTE FUNCTION touch_session_from_message();
