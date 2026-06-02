-- Keep chat session list summaries on the session row so list pages do not
-- fan out over every message and run in the visible page.

ALTER TABLE public.chat_sessions
  ADD COLUMN IF NOT EXISTS last_message_preview TEXT,
  ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS latest_run_status run_status;

CREATE OR REPLACE FUNCTION public.build_chat_session_message_preview(
  p_content TEXT,
  p_status message_status
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_status = 'failed' THEN '응답 생성에 실패했습니다.'
    WHEN p_status = 'cancelled' THEN '응답 생성을 취소했습니다.'
    WHEN COALESCE(p_content, '') ~* '(not logged in|please run /login)' THEN 'KRW-AI 인증이 필요합니다.'
    ELSE LEFT(BTRIM(REGEXP_REPLACE(COALESCE(p_content, ''), '\s+', ' ', 'g')), 100)
  END
$$;

CREATE OR REPLACE FUNCTION public.refresh_chat_session_message_summary(
  p_session_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_content TEXT;
  v_status message_status;
  v_created_at TIMESTAMPTZ;
BEGIN
  SELECT m.content, m.status, m.created_at
    INTO v_content, v_status, v_created_at
  FROM public.messages AS m
  WHERE m.session_id = p_session_id
  ORDER BY m.created_at DESC, m.id DESC
  LIMIT 1;

  UPDATE public.chat_sessions
  SET last_message_preview = CASE
        WHEN v_created_at IS NULL THEN NULL
        ELSE public.build_chat_session_message_preview(v_content, v_status)
      END,
      last_message_at = v_created_at
  WHERE id = p_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_chat_session_run_summary(
  p_session_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_status run_status;
BEGIN
  SELECT r.status
    INTO v_status
  FROM public.agent_runs AS r
  WHERE r.session_id = p_session_id
  ORDER BY r.queued_at DESC NULLS LAST, r.started_at DESC NULLS LAST, r.id DESC
  LIMIT 1;

  UPDATE public.chat_sessions
  SET latest_run_status = v_status
  WHERE id = p_session_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_chat_session_message_summary_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_chat_session_message_summary(OLD.session_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.refresh_chat_session_message_summary(NEW.session_id);
    RETURN NEW;
  END IF;

  IF NEW.session_id IS DISTINCT FROM OLD.session_id THEN
    PERFORM public.refresh_chat_session_message_summary(OLD.session_id);
  END IF;

  PERFORM public.refresh_chat_session_message_summary(NEW.session_id);

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_chat_session_run_summary_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_chat_session_run_summary(OLD.session_id);
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public.refresh_chat_session_run_summary(NEW.session_id);
    RETURN NEW;
  END IF;

  IF NEW.session_id IS DISTINCT FROM OLD.session_id THEN
    PERFORM public.refresh_chat_session_run_summary(OLD.session_id);
  END IF;

  PERFORM public.refresh_chat_session_run_summary(NEW.session_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_session_summary_insert ON public.messages;
CREATE TRIGGER trg_messages_session_summary_insert
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_chat_session_message_summary_trigger();

DROP TRIGGER IF EXISTS trg_messages_session_summary_update ON public.messages;
CREATE TRIGGER trg_messages_session_summary_update
  AFTER UPDATE OF session_id, content, status, created_at ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_chat_session_message_summary_trigger();

DROP TRIGGER IF EXISTS trg_messages_session_summary_delete ON public.messages;
CREATE TRIGGER trg_messages_session_summary_delete
  AFTER DELETE ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_chat_session_message_summary_trigger();

DROP TRIGGER IF EXISTS trg_agent_runs_session_summary_insert ON public.agent_runs;
CREATE TRIGGER trg_agent_runs_session_summary_insert
  AFTER INSERT ON public.agent_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_chat_session_run_summary_trigger();

DROP TRIGGER IF EXISTS trg_agent_runs_session_summary_update ON public.agent_runs;
CREATE TRIGGER trg_agent_runs_session_summary_update
  AFTER UPDATE OF session_id, status, queued_at, started_at ON public.agent_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_chat_session_run_summary_trigger();

DROP TRIGGER IF EXISTS trg_agent_runs_session_summary_delete ON public.agent_runs;
CREATE TRIGGER trg_agent_runs_session_summary_delete
  AFTER DELETE ON public.agent_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.refresh_chat_session_run_summary_trigger();

SELECT public.refresh_chat_session_message_summary(id)
FROM public.chat_sessions;

SELECT public.refresh_chat_session_run_summary(id)
FROM public.chat_sessions;

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_visible_summary
  ON public.chat_sessions (user_id, updated_at DESC)
  WHERE deleted_at IS NULL
    AND (
      last_message_at IS NOT NULL
      OR latest_run_status IN ('pending', 'queued', 'running')
    );
