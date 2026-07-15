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
const shareAnalyticsMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260603002000_add_share_analytics_events.sql",
);
const filingNotificationAnalyticsMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260714002000_add_filing_notification_analytics.sql",
);
const filingRetentionAnalyticsMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260715002000_add_filing_retention_analytics.sql",
);
const filingRetentionLoopAnalyticsMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260715005000_add_filing_retention_loop_analytics.sql",
);
const pulseAnalyticsMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260715007000_research_pulse_analytics.sql",
);
const FILING_NOTIFICATION_EVENT_NAMES = [
  "company_followed",
  "push_permission_requested",
  "push_permission_granted",
  "push_permission_denied",
  "push_subscribed",
  "push_unsubscribed",
  "filing_notification_clicked",
  "filing_subscription_created",
  "filing_subscription_removed",
  "filing_history_loaded",
  "filing_detail_viewed",
  "push_notification_clicked",
  "key_exhibit_opened",
  "sec_source_opened",
  "filing_analysis_started",
] as const;
const filingNotificationEventNameSet = new Set<string>(
  [...FILING_NOTIFICATION_EVENT_NAMES,
    "filing_history_backfilled", "historical_filing_opened", "pwa_install_prompt_seen", "pwa_installed",
    "test_push_requested", "test_push_received", "filing_detected", "filing_notification_created",
    "push_provider_accepted", "sw_push_received", "notification_show_called", "notification_clicked",
    "filings_inbox_viewed", "filing_marked_read", "filing_snoozed", "filing_pinned", "filing_archived",
    "digest_opened", "alert_rule_created", "alert_rule_removed", "filing_delivery_mode_changed",
    "amendment_comparison_opened", "company_filing_timeline_viewed", "push_permission_prompted",
  ],
);
const pulseEventNames = [
  "pulse_viewed", "pulse_item_impression", "pulse_item_opened",
  "pulse_item_actioned", "pulse_filter_changed", "pulse_preferences_updated",
  "pulse_new_items_seen", "pulse_end_reached", "pulse_feedback_submitted",
  "pulse_source_degraded", "pulse_answer_prefilled",
] as const;
const postInitialAnalyticsEventNameSet = new Set<string>([
  ...filingNotificationEventNameSet,
  ...pulseEventNames,
]);

describe("analytics events migration", () => {
  const migration = readFileSync(migrationPath, "utf8");

  it("creates the analytics_events table with the requested events", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS analytics_events");
    for (const eventName of ANALYTICS_EVENT_NAMES.filter(
      (eventName) => !postInitialAnalyticsEventNameSet.has(eventName),
    )) {
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

  it("adds share-page analytics events to already-created databases", () => {
    const shareAnalyticsMigration = readFileSync(
      shareAnalyticsMigrationPath,
      "utf8",
    );

    expect(shareAnalyticsMigration).toContain(
      "DROP CONSTRAINT IF EXISTS analytics_events_event_name_check",
    );
    expect(shareAnalyticsMigration).toContain(
      "ADD CONSTRAINT analytics_events_event_name_check",
    );
    expect(shareAnalyticsMigration).toContain("'share_viewed'");
    expect(shareAnalyticsMigration).toContain("'share_answer_read'");
    expect(shareAnalyticsMigration).toContain("'share_cta_clicked'");
    expect(shareAnalyticsMigration).toContain("'share_starter_loaded'");
  });

  it("adds filing-notification analytics events to already-created databases", () => {
    const filingNotificationMigration = readFileSync(
      filingNotificationAnalyticsMigrationPath,
      "utf8",
    );

    expect(filingNotificationMigration).toContain(
      "drop constraint if exists analytics_events_event_name_check",
    );
    expect(filingNotificationMigration).toContain(
      "add constraint analytics_events_event_name_check",
    );
    const filingRetentionMigration = readFileSync(
      filingRetentionAnalyticsMigrationPath,
      "utf8",
    );
    for (const eventName of FILING_NOTIFICATION_EVENT_NAMES.slice(0, 7)) {
      expect(filingNotificationMigration).toContain(`'${eventName}'`);
    }
    for (const eventName of FILING_NOTIFICATION_EVENT_NAMES.slice(7)) {
      expect(filingRetentionMigration).toContain(`'${eventName}'`);
    }
    const filingRetentionLoopMigration = readFileSync(filingRetentionLoopAnalyticsMigrationPath, "utf8");
    for (const eventName of ["amendment_comparison_opened", "company_filing_timeline_viewed", "push_permission_prompted"]) {
      expect(filingRetentionLoopMigration).toContain(`'${eventName}'`);
    }
  });

  it("adds Pulse analytics events to already-created databases", () => {
    const pulseMigration = readFileSync(pulseAnalyticsMigrationPath, "utf8");
    for (const eventName of pulseEventNames) {
      expect(pulseMigration).toContain(`'${eventName}'`);
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
