import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("agent queue expiry migration", () => {
  it("closes open tool calls when claim_agent_run expires stale worker runs", () => {
    const migration = readFileSync(
      "supabase/migrations/20260526000000_close_open_tool_calls_on_expiry.sql",
      "utf8",
    );

    expect(migration).toContain("create index if not exists idx_tool_calls_open_run");
    expect(migration).toContain("create or replace function public.claim_agent_run");
    expect(migration).toContain("update public.tool_calls as tc");
    expect(migration).toContain("tc.finished_at is null");
    expect(migration).toContain(
      "Worker lease expired before tool result was received",
    );
    expect(migration).toContain("insert into public.agent_run_events");
    expect(migration).toContain(
      "grant execute on function public.claim_agent_run(text, integer, integer)",
    );
  });

  it("backfills previously open tool calls on terminal runs", () => {
    const migration = readFileSync(
      "supabase/migrations/20260526001000_backfill_terminal_open_tool_calls.sql",
      "utf8",
    );

    expect(migration).toContain("update public.tool_calls as tc");
    expect(migration).toContain("from public.agent_runs as ar");
    expect(migration).toContain("tc.finished_at is null");
    expect(migration).toContain(
      "ar.status in ('completed', 'failed', 'cancelled', 'expired')",
    );
    expect(migration).toContain("Worker lease expired before tool result was received");
  });

  it("isolates claim_agent_run by ontology environment", () => {
    const migration = readFileSync(
      "supabase/migrations/20260528001000_agent_queue_env_isolation.sql",
      "utf8",
    );

    expect(migration).toContain("add column if not exists ontology_env text");
    expect(migration).toContain("add column if not exists worker_env text");
    expect(migration).toContain("p_worker_env text");
    expect(migration).toContain("p_ontology_env text");
    expect(migration).toContain("r.ontology_env = v_ontology_env");
    expect(migration).toContain("worker_env = v_worker_env");
    expect(migration).toContain(
      "grant execute on function public.claim_agent_run(text, text, text, integer, integer)",
    );
    expect(migration).toContain("from public.claim_agent_run(");
  });

  it("centralizes terminal run updates in a reusable database function", () => {
    const migration = readFileSync(
      "supabase/migrations/20260528007000_agent_run_terminal_lifecycle.sql",
      "utf8",
    );

    expect(migration).toContain(
      "create or replace function public.mark_agent_run_terminal",
    );
    expect(migration).toContain("p_status public.run_status");
    expect(migration).toContain("status must be terminal");
    expect(migration).toContain("finished_at = v_finished_at");
    expect(migration).toContain("lease_expires_at = null");
    expect(migration).toContain("update public.tool_calls as tc");
    expect(migration).toContain("tc.finished_at is null");
    expect(migration).toContain(
      "grant execute on function public.mark_agent_run_terminal",
    );
  });

  it("routes claim_agent_run stale lease expiry through the terminal lifecycle helper", () => {
    const migration = readFileSync(
      "supabase/migrations/20260528007000_agent_run_terminal_lifecycle.sql",
      "utf8",
    );

    expect(migration).toContain("perform public.mark_agent_run_terminal");
    expect(migration).toContain("'expired'::public.run_status");
    expect(migration).toContain("'lease_expired'");
    expect(migration).toContain(
      "Worker lease expired before tool result was received",
    );
    expect(migration).toContain(
      "grant execute on function public.claim_agent_run(text, text, text, integer, integer)",
    );
  });
});
