import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260607001000_agent_run_queue_state.sql",
  ),
  "utf8",
);

describe("agent run queue state migration", () => {
  it("calculates queue position with the same FIFO keys as claim_agent_run", () => {
    expect(migration).toContain(
      "create or replace function public.get_agent_run_queue_state",
    );
    expect(migration).toContain("r.status = 'queued'");
    expect(migration).toContain("r.ontology_env = v_run.ontology_env");
    expect(migration).toContain("r.cancel_requested_at is null");
    expect(migration).toContain("r.queued_at < v_run.queued_at");
    expect(migration).toContain("r.queued_at = v_run.queued_at and r.id < v_run.id");
  });

  it("reports running count by live lease and blocks public execution", () => {
    expect(migration).toContain("r.status = 'running'");
    expect(migration).toContain("r.lease_expires_at > now()");
    expect(migration).toContain(
      "revoke all on function public.get_agent_run_queue_state(uuid, integer)",
    );
    expect(migration).toContain(
      "grant execute on function public.get_agent_run_queue_state(uuid, integer)",
    );
  });
});
