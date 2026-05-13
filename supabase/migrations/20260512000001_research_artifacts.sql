-- Add durable evidence and canonical research artifacts.

ALTER TABLE tool_calls
  ADD COLUMN IF NOT EXISTS tool_use_id TEXT,
  ADD COLUMN IF NOT EXISTS result_json JSONB,
  ADD COLUMN IF NOT EXISTS result_text TEXT;

CREATE TABLE IF NOT EXISTS research_artifacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL DEFAULT 'research_brief',
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  blocks_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs JSONB,
  quality_json JSONB,
  source_json JSONB,
  html_snapshot TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT research_artifacts_type_check CHECK (
    artifact_type IN (
      'company_snapshot',
      'scenario_impact',
      'comparison',
      'timeline',
      'evidence_chain',
      'research_brief'
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_use_id
  ON tool_calls (tool_use_id)
  WHERE tool_use_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_research_artifacts_session
  ON research_artifacts (session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_research_artifacts_run
  ON research_artifacts (run_id);

CREATE INDEX IF NOT EXISTS idx_research_artifacts_message
  ON research_artifacts (message_id);

ALTER TABLE research_artifacts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON TABLE research_artifacts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE research_artifacts TO service_role;

DROP POLICY IF EXISTS "research_artifacts_select_own" ON research_artifacts;
CREATE POLICY "research_artifacts_select_own" ON research_artifacts
  FOR SELECT USING (session_owner(session_id) = auth.uid());

DROP POLICY IF EXISTS "research_artifacts_insert_own" ON research_artifacts;
CREATE POLICY "research_artifacts_insert_own" ON research_artifacts
  FOR INSERT WITH CHECK (session_owner(session_id) = auth.uid());

DROP POLICY IF EXISTS "research_artifacts_update_own" ON research_artifacts;
CREATE POLICY "research_artifacts_update_own" ON research_artifacts
  FOR UPDATE USING (session_owner(session_id) = auth.uid())
  WITH CHECK (session_owner(session_id) = auth.uid());
