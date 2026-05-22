-- Hide soft-deleted sessions and their child records from browser clients.

CREATE OR REPLACE FUNCTION session_owner(p_session_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id
  FROM chat_sessions
  WHERE id = p_session_id
    AND deleted_at IS NULL;
$$;

DROP POLICY IF EXISTS "sessions_select_own" ON chat_sessions;
CREATE POLICY "sessions_select_own" ON chat_sessions
  FOR SELECT USING (user_id = auth.uid() AND deleted_at IS NULL);

DROP POLICY IF EXISTS "sessions_update_own" ON chat_sessions;
CREATE POLICY "sessions_update_own" ON chat_sessions
  FOR UPDATE
  USING (user_id = auth.uid() AND deleted_at IS NULL)
  WITH CHECK (user_id = auth.uid() AND deleted_at IS NULL);

DROP POLICY IF EXISTS "sessions_delete_own" ON chat_sessions;
CREATE POLICY "sessions_delete_own" ON chat_sessions
  FOR DELETE USING (user_id = auth.uid() AND deleted_at IS NULL);
