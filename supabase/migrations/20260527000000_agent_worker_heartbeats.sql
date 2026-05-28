CREATE TABLE IF NOT EXISTS public.agent_worker_heartbeats (
  worker_id text PRIMARY KEY,
  status text NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'running', 'stopped', 'unhealthy')),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_expires_at timestamptz NOT NULL,
  claude_code_version text,
  web_commit text,
  krw_ontology_commit text,
  ontology_release_id text,
  index_generated_at text,
  company_count integer,
  document_count integer,
  object_count integer,
  tool_count integer,
  root text,
  plugin_path text,
  error text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_worker_heartbeats_ready
  ON public.agent_worker_heartbeats (status, heartbeat_expires_at DESC, last_seen_at DESC);
