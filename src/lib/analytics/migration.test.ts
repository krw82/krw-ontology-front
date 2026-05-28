import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYTICS_EVENT_NAMES } from "@/lib/analytics/events";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260523001000_analytics_events.sql",
);
const suggestedQuestionMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260528000000_add_suggested_question_analytics_event.sql",
);

describe("analytics events migration", () => {
  const migration = readFileSync(migrationPath, "utf8");

  it("creates the analytics_events table with the requested events", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS analytics_events");
    for (const eventName of ANALYTICS_EVENT_NAMES) {
      expect(migration).toContain(`'${eventName}'`);
    }
  });

  it("adds suggested question tracking to already-created databases", () => {
    const suggestedQuestionMigration = readFileSync(
      suggestedQuestionMigrationPath,
      "utf8",
    );

    expect(suggestedQuestionMigration).toContain(
      "DROP CONSTRAINT IF EXISTS analytics_events_event_name_check",
    );
    expect(suggestedQuestionMigration).toContain(
      "ADD CONSTRAINT analytics_events_event_name_check",
    );
    expect(suggestedQuestionMigration).toContain(
      "'suggested_question_clicked'",
    );
  });

  it("keeps analytics server-owned and indexed for dashboard queries", () => {
    expect(migration).toContain("ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL ON TABLE analytics_events");
    expect(migration).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE analytics_events TO service_role");
    expect(migration).toContain("idx_analytics_events_name_created_at");
    expect(migration).toContain("idx_analytics_events_user_created_at");
    expect(migration).toContain("idx_analytics_events_ticker_created_at");
  });
});
