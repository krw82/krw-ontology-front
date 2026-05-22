import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ANALYTICS_EVENT_NAMES } from "@/lib/analytics/events";

const migrationPath = join(
  process.cwd(),
  "supabase/migrations/20260523001000_analytics_events.sql",
);

describe("analytics events migration", () => {
  const migration = readFileSync(migrationPath, "utf8");

  it("creates the analytics_events table with the requested events", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS analytics_events");
    for (const eventName of ANALYTICS_EVENT_NAMES) {
      expect(migration).toContain(`'${eventName}'`);
    }
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
