import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationRoot = join(process.cwd(), "supabase", "migrations");

describe("Agent V1 research run-kind migrations", () => {
  it("keeps the v7 enqueue allowlist aligned with front routing", () => {
    const source = readFileSync(
      join(migrationRoot, "20260812090000_agent_v1_contract_v7_compatibility.sql"),
      "utf8",
    );
    for (const runKind of [
      "wide_research",
      "guru_ackman",
      "guru_buffett",
      "guru_flatt",
      "guru_marks",
      "guru_terry_smith",
    ]) {
      expect(source).toContain(`'${runKind}'`);
    }
  });

  it("broadens the existing public run-kind constraint additively", () => {
    const source = readFileSync(
      join(migrationRoot, "20260812100000_agent_v1_research_run_kinds.sql"),
      "utf8",
    );
    expect(source).toContain("drop constraint if exists agent_runs_run_kind_check");
    expect(source).toContain("add constraint agent_runs_run_kind_check");
    for (const runKind of [
      "wide_research",
      "company_research_en",
      "earnings_deep_dive",
      "guru_buffett",
    ]) {
      expect(source).toContain(`'${runKind}'`);
    }
  });

  it("keeps Rust daemon readiness separate from the retired plugin-worker heartbeat", () => {
    const source = readFileSync(
      join(migrationRoot, "20260812110000_agent_v1_daemon_heartbeats.sql"),
      "utf8",
    );
    expect(source).toContain("public.agent_v1_daemon_heartbeats");
    expect(source).toContain("agent_v1.heartbeat_daemon");
    expect(source).toContain("descriptor_artifact_hash");
    expect(source).toContain("release_set_hash");
    expect(source).not.toContain("agent_worker_heartbeats");
  });
});
