import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Research Pulse state migration", () => {
  const migration = readFileSync(join(process.cwd(), "supabase/migrations/20260715006000_research_pulse_state.sql"), "utf8");
  const v2Migration = readFileSync(join(process.cwd(), "supabase/migrations/20260715009000_research_pulse_p0_v2.sql"), "utf8");

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
});
