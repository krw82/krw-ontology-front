-- Supports the V10 completed-research notification lane: a 24-hour window of
-- recently finished company-scoped analyses. This partial index keeps that
-- lookup cheap as agent_runs grows.
create index if not exists idx_agent_runs_completed_finished
  on public.agent_runs (session_id, finished_at desc)
  where status = 'completed';
