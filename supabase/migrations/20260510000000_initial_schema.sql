-- KRW Ontology Web Chat - initial local Supabase schema.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_scope_type') THEN
    CREATE TYPE session_scope_type AS ENUM ('global', 'company');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_role') THEN
    CREATE TYPE message_role AS ENUM ('user', 'assistant', 'system');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'message_status') THEN
    CREATE TYPE message_status AS ENUM ('pending', 'streaming', 'completed', 'failed', 'cancelled');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'run_status') THEN
    CREATE TYPE run_status AS ENUM ('pending', 'queued', 'running', 'completed', 'failed', 'cancelled', 'expired');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT 'New Chat',
  claude_session_id TEXT,
  scope_type session_scope_type NOT NULL DEFAULT 'global',
  default_tickers TEXT[],
  default_document_types TEXT[],
  last_message_preview TEXT,
  last_message_at TIMESTAMPTZ,
  latest_run_status run_status,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role message_role NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  status message_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  user_message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  assistant_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  request_id TEXT NOT NULL,
  claude_session_id TEXT,
  model TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
  status run_status NOT NULL DEFAULT 'pending',
  lease_expires_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  estimated_cost_usd NUMERIC(10, 6),
  web_commit TEXT,
  krw_ontology_commit TEXT,
  ontology_release_id TEXT,
  index_generated_at TIMESTAMPTZ,
  company_count INTEGER,
  document_count INTEGER,
  error_code TEXT,
  error_message TEXT,
  CONSTRAINT uq_agent_runs_request_id UNIQUE (request_id)
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  tool_name TEXT NOT NULL,
  arguments_json JSONB NOT NULL DEFAULT '{}',
  result_summary TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE TABLE IF NOT EXISTS citations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  object_id TEXT,
  ticker TEXT,
  document_type TEXT,
  period TEXT,
  section TEXT,
  quote_text TEXT,
  claim_text TEXT,
  evidence_grade TEXT,
  source_quality TEXT,
  trace_json JSONB
);

CREATE TABLE IF NOT EXISTS usage_daily (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT current_date,
  question_count INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

CREATE TABLE IF NOT EXISTS concurrency_leases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  released_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON chat_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created_at_desc ON chat_sessions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages (session_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_agent_runs_session ON agent_runs (session_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_request_id ON agent_runs (request_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs (session_id, status);
CREATE INDEX IF NOT EXISTS idx_tool_calls_run_id ON tool_calls (run_id);
CREATE INDEX IF NOT EXISTS idx_citations_message_id ON citations (message_id);
CREATE INDEX IF NOT EXISTS idx_citations_run_id ON citations (run_id);
CREATE INDEX IF NOT EXISTS idx_citations_ticker ON citations (ticker) WHERE ticker IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usage_daily_user_date ON usage_daily (user_id, date);
CREATE INDEX IF NOT EXISTS idx_leases_expires ON concurrency_leases (expires_at) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_leases_released ON concurrency_leases (released_at) WHERE released_at IS NULL;

CREATE OR REPLACE FUNCTION session_owner(p_session_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT user_id FROM chat_sessions WHERE id = p_session_id;
$$;

CREATE OR REPLACE FUNCTION run_session(p_run_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT session_id FROM agent_runs WHERE id = p_run_id;
$$;

ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE citations ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE concurrency_leases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions_select_own" ON chat_sessions
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "sessions_insert_own" ON chat_sessions
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "sessions_update_own" ON chat_sessions
  FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "sessions_delete_own" ON chat_sessions
  FOR DELETE USING (user_id = auth.uid());

CREATE POLICY "messages_select_own" ON messages
  FOR SELECT USING (session_owner(session_id) = auth.uid());
CREATE POLICY "messages_insert_own" ON messages
  FOR INSERT WITH CHECK (session_owner(session_id) = auth.uid());
CREATE POLICY "messages_update_own" ON messages
  FOR UPDATE USING (session_owner(session_id) = auth.uid());

CREATE POLICY "runs_select_own" ON agent_runs
  FOR SELECT USING (session_owner(session_id) = auth.uid());
CREATE POLICY "runs_insert_own" ON agent_runs
  FOR INSERT WITH CHECK (session_owner(session_id) = auth.uid());
CREATE POLICY "runs_update_own" ON agent_runs
  FOR UPDATE USING (session_owner(session_id) = auth.uid());

CREATE POLICY "tool_calls_select_own" ON tool_calls
  FOR SELECT USING (session_owner(run_session(run_id)) = auth.uid());
CREATE POLICY "tool_calls_insert_own" ON tool_calls
  FOR INSERT WITH CHECK (session_owner(run_session(run_id)) = auth.uid());
CREATE POLICY "tool_calls_update_own" ON tool_calls
  FOR UPDATE USING (session_owner(run_session(run_id)) = auth.uid());

CREATE POLICY "citations_select_own" ON citations
  FOR SELECT USING (session_owner(run_session(run_id)) = auth.uid());
CREATE POLICY "citations_insert_own" ON citations
  FOR INSERT WITH CHECK (session_owner(run_session(run_id)) = auth.uid());
CREATE POLICY "citations_update_own" ON citations
  FOR UPDATE USING (session_owner(run_session(run_id)) = auth.uid());

CREATE POLICY "usage_select_own" ON usage_daily
  FOR SELECT USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sessions_updated_at ON chat_sessions;
CREATE TRIGGER trg_sessions_updated_at
  BEFORE UPDATE ON chat_sessions
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
