import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Research Pulse state migration", () => {
  const migration = readFileSync(join(process.cwd(), "supabase/migrations/20260715006000_research_pulse_state.sql"), "utf8");
  const v2Migration = readFileSync(join(process.cwd(), "supabase/migrations/20260715009000_research_pulse_p0_v2.sql"), "utf8");
  const rankedCandidatesMigration = readFileSync(join(process.cwd(), "supabase/migrations/20260717010000_pulse_ranked_filing_candidates_v2.sql"), "utf8");
  const candidateRepairMigration = readFileSync(join(process.cwd(), "supabase/migrations/20260717011000_fix_pulse_candidate_ticker_ambiguity.sql"), "utf8");
  const filingBriefMigration = readFileSync(join(process.cwd(), "supabase/migrations/20260717020000_sec_filing_briefs.sql"), "utf8");
  const v3ReadModelMigration = readFileSync(join(process.cwd(), "supabase/migrations/20260720040000_pulse_feed_v3_read_model.sql"), "utf8");

  it("creates additive preference and item-state tables with ownership RLS", () => {
    expect(migration).toContain("create table if not exists public.user_pulse_preferences");
    expect(migration).toContain("create table if not exists public.user_pulse_item_states");
    expect(migration).toContain("primary key (user_id, item_key)");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("user_id = auth.uid()");
    expect(migration).toContain("idx_user_pulse_item_states_active");
  });

  it("constrains kinds, cadences, counters, and feedback", () => {
    for (const constraint of [
      "user_pulse_preferences_enabled_kinds",
      "user_pulse_preferences_question_cadence",
      "user_pulse_preferences_resurface_cadence",
      "user_pulse_preferences_learning_cadence",
      "user_pulse_item_states_kind",
      "user_pulse_item_states_view_count",
      "user_pulse_item_states_feedback",
    ]) expect(migration).toContain(constraint);
  });

  it("adds review semantics and an atomic, service-role-only impression path", () => {
    expect(v2Migration).toContain("add column if not exists reviewed_at");
    expect(v2Migration).toContain("last_impression_session_id");
    expect(v2Migration).toContain("set reviewed_at = read_at");
    expect(v2Migration).toContain("record_pulse_item_impression");
    expect(v2Migration).toContain("impression_count = public.user_pulse_item_states.impression_count + 1");
    expect(v2Migration).toContain("from public, anon, authenticated");
    expect(v2Migration).toContain("to service_role");
  });

  it("adds a bounded catalog candidate and lightweight status path without public RPC access", () => {
    expect(rankedCandidatesMigration).toContain("get_catalog_pulse_filing_candidates_v2");
    expect(rankedCandidatesMigration).toContain("p_preferred_tickers text[]");
    expect(rankedCandidatesMigration).toContain("idx_sec_filing_events_pulse_available");
    expect(rankedCandidatesMigration).toContain("#variable_conflict use_column");
    expect(rankedCandidatesMigration).toContain("limit v_urgent_limit + v_priority_limit + v_preferred_limit + v_discovery_limit");
    expect(rankedCandidatesMigration).toContain("get_catalog_pulse_feed_status_v1");
    expect(rankedCandidatesMigration).toContain("to service_role");
    expect(rankedCandidatesMigration).toContain("notify pgrst, 'reload schema'");
  });

  it("redefines the candidate RPC with column-precedence after the initial migration", () => {
    expect(candidateRepairMigration).toContain("create or replace function public.get_catalog_pulse_filing_candidates_v2");
    expect(candidateRepairMigration).toContain("#variable_conflict use_column");
    expect(candidateRepairMigration).toContain("eligible.ticker = any(v_preferred_tickers)");
    expect(candidateRepairMigration).toContain("notify pgrst, 'reload schema'");
  });

  it("adds a brief-aware candidate RPC as an additive, service-role-only read path", () => {
    expect(filingBriefMigration).toContain("get_catalog_pulse_filing_candidates_v3");
    expect(filingBriefMigration).toContain("left join public.sec_filing_briefs brief");
    expect(filingBriefMigration).toContain("filing_brief_headline_ko");
    expect(filingBriefMigration).toContain("from public, anon, authenticated");
    expect(filingBriefMigration).toContain("notify pgrst, 'reload schema'");
  });

  it("replaces request-time filing discovery with an event-maintained read model and revisions", () => {
    for (const table of [
      "pulse_global_filing_candidates",
      "pulse_global_candidate_tickers",
      "pulse_global_feed_revisions",
      "user_pulse_feed_revisions",
    ]) expect(v3ReadModelMigration).toContain(`create table if not exists public.${table}`);
    expect(v3ReadModelMigration).toContain("sync_pulse_global_filing_candidate");
    expect(v3ReadModelMigration).toContain("rebuild_pulse_global_filing_candidates");
    expect(v3ReadModelMigration).toContain("get_pulse_global_filing_candidates_v1");
    expect(v3ReadModelMigration).toContain("get_pulse_feed_revisions_v1");
    expect(v3ReadModelMigration).toContain("drop function if exists public.get_catalog_pulse_filing_candidates_v2");
    expect(v3ReadModelMigration).toContain("drop function if exists public.get_catalog_pulse_filing_candidates_v3");
    expect(v3ReadModelMigration).toContain("drop function if exists public.get_catalog_pulse_feed_status_v1");
    expect(v3ReadModelMigration).toContain("trg_pulse_global_filing_candidate_event");
    expect(v3ReadModelMigration).toContain("trg_pulse_global_filing_candidate_form4");
    expect(v3ReadModelMigration).toContain("trg_pulse_feed_revision_agent_runs");
    expect(v3ReadModelMigration).toContain("trg_pulse_feed_revision_chat_sessions");
    expect(v3ReadModelMigration).toContain("trg_pulse_feed_revision_entitlements");
    expect(v3ReadModelMigration).toContain("trg_pulse_global_feed_revision_editorial_entries");
    expect(v3ReadModelMigration).toContain("trg_pulse_global_feed_revision_editorial_assets");
    expect(v3ReadModelMigration).toContain("/ 300");
    expect(v3ReadModelMigration).toContain("from public, anon, authenticated");
    expect(v3ReadModelMigration).toContain("to service_role");
  });
});
