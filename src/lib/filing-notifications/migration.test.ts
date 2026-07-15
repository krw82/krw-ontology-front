import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260714001000_filing_notifications.sql"),
  "utf8",
);
const hardeningMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260715001000_harden_filing_subscriptions_and_polling.sql"),
  "utf8",
);
const retentionLoopsMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260715004000_complete_filing_retention_loops.sql"),
  "utf8",
);
const retentionAnalyticsMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260715005000_add_filing_retention_loop_analytics.sql"),
  "utf8",
);

describe("filing notification migration", () => {
  it("creates an extensible filing event and durable push outbox", () => {
    expect(migration).toContain("create table if not exists public.sec_filing_events");
    expect(migration).toContain("analysis_status text not null default 'not_requested'");
    expect(migration).toContain("kind in ('filing_received', 'analysis_ready')");
    expect(migration).toContain("create table if not exists public.push_subscriptions");
    expect(migration).toContain("create table if not exists public.filing_notification_deliveries");
    expect(migration).toContain("for update skip locked");
    expect(migration).toContain("claim_filing_notification_deliveries");
  });

  it("limits this release to 8-K and 6-K variants", () => {
    expect(migration).toContain("form_type in ('8-K', '8-K/A', '6-K', '6-K/A')");
    expect(migration).not.toContain("'10-Q'");
    expect(migration).not.toContain("'20-F'");
  });

  it("adds explicit company subscriptions and CIK due-poll state", () => {
    expect(hardeningMigration).toContain("drop constraint if exists sec_company_identifiers_cik_key");
    expect(hardeningMigration).toContain("create table if not exists public.user_filing_subscriptions");
    expect(hardeningMigration).toContain("create table if not exists public.sec_filing_poll_state");
    expect(hardeningMigration).toContain("claim_sec_filing_poll_targets");
    expect(hardeningMigration).toContain("create table if not exists public.sec_filing_documents");
  });

  it("keeps retention state and private feed capability scoped to filing alerts", () => {
    expect(retentionLoopsMigration).toContain("add column if not exists pinned_at");
    expect(retentionLoopsMigration).toContain("add column if not exists snoozed_until");
    expect(retentionLoopsMigration).toContain("add column if not exists archived_at");
    expect(retentionLoopsMigration).toContain("add column if not exists digest_bucket");
    expect(retentionLoopsMigration).toContain("unique (user_id, filing_event_id, kind, digest_bucket)");
    expect(retentionLoopsMigration).toContain("create table if not exists public.user_filing_keyword_rules");
    expect(retentionLoopsMigration).toContain("create table if not exists public.filing_push_receipts");
    expect(retentionLoopsMigration).toContain("create table if not exists public.user_filing_feed_tokens");
    expect(retentionLoopsMigration).toContain("cleanup_filing_notification_retention");
  });

  it("includes the end-to-end filing reliability events", () => {
    for (const eventName of ["push_permission_prompted", "filing_detected", "push_provider_accepted", "sw_push_received", "notification_show_called", "notification_clicked"]) {
      expect(retentionAnalyticsMigration).toContain(`'${eventName}'`);
    }
  });
});
