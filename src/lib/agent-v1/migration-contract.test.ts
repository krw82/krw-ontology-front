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

  it("admits tickerless news runs in the product procedure and row constraint", () => {
    const source = readFileSync(
      join(migrationRoot, "20260814100000_news_discovery_wide.sql"),
      "utf8",
    );
    expect(source).toContain("'news_discovery_wide'");
    expect(source).toContain("'news_research'");
    expect(source).toContain("enqueue_agent_v1_product_run_v7");
  });

  it("projects terminal research failures without marking them as answers", () => {
    const source = readFileSync(
      join(migrationRoot, "20260814130000_agent_v1_failure_projection.sql"),
      "utf8",
    );
    expect(source).toContain("trg_project_agent_v1_failure_notice");
    expect(source).toContain("'research_failure'");
    expect(source).toContain("'research_completed', false");
    expect(source).toContain("status = 'failed'::public.message_status");
    expect(source).toContain("when others then");
    expect(source).not.toContain("provider_message");
  });

  it("admits durable lifecycle events without changing terminal projection", () => {
    const source = readFileSync(
      join(migrationRoot, "20260814145432_agent_v1_lifecycle_projection.sql"),
      "utf8",
    );
    expect(source).toContain("apply_agent_v1_product_outbox_v2");
    expect(source).toContain("'run.started'");
    expect(source).toContain("'run.progress'");
    expect(source).toContain("'researching'");
    expect(source).toContain("'composing'");
    expect(source).toContain("lifecycle_run_version");
    expect(source).toContain("lifecycle_stage");
    expect(source).toContain("status = case");
    expect(source).toContain("status not in ('completed', 'failed', 'cancelled', 'expired')");
    expect(source).toContain("return public.apply_agent_v1_product_outbox(p_request)");
  });

  it("keeps refined failure classification bounded and non-blocking", () => {
    const source = readFileSync(
      join(migrationRoot, "20260814145704_agent_v1_failure_classification.sql"),
      "utf8",
    );
    expect(source).toContain("reclassify_agent_v1_failure_notice");
    expect(source).toContain("engine_output_thinking_budget_exhausted");
    expect(source).toContain("engine_input_session_memory_delta_invalid");
    expect(source).toContain("failure_class");
    expect(source).toContain("when others then");
    expect(source).not.toContain("provider_message");
  });
});
