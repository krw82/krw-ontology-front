import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Pulse analysis activity migration", () => {
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260715008000_add_pulse_analysis_activity.sql"),
    "utf8",
  );

  it("adds analysis to preferences and item state constraints", () => {
    expect(migration).toContain("array_append(enabled_kinds, 'analysis')");
    expect(migration).toContain("user_pulse_preferences_enabled_kinds");
    expect(migration).toContain("user_pulse_item_states_source_type");
    expect(migration).toContain("user_pulse_item_states_kind");
    expect(migration.match(/'analysis'/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
