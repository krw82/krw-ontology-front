-- Lock down the run-event notify trigger function ACL.
-- The function is used only by the agent_run_events trigger.

revoke all on function public.notify_agent_run_event()
from public, anon, authenticated;
