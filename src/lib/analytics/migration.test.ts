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
const pulseV2MigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260715009000_research_pulse_p0_v2.sql",
);
const performanceAnalyticsMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260717040000_add_client_performance_analytics.sql",
);
const decisionLoopAnalyticsMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260718009000_add_decision_loop_analytics.sql",
);
const coverageLevelMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260720010000_simplify_company_coverage_levels.sql",
);
const productionSchemaRepairMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260720030000_repair_production_schema_drift.sql",
);
const startOnboardingMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260722000000_start_onboarding_v2.sql",
);
const pulseRefreshAnalyticsMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260722210000_add_pulse_refresh_analytics.sql",
);
const sessionShareAnalyticsMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260805010000_add_session_share_analytics_event.sql",
);
const sessionShareViewAnalyticsMigrationPath = join(
  process.cwd(),
  "supabase/migrations/20260805020000_add_session_share_view_analytics_events.sql",
);
const startOnboardingEventNameSet = new Set<string>([
  "onboarding_started",
  "onboarding_company_selected",
  "onboarding_question_started",
  "onboarding_evidence_opened",
  "onboarding_skipped",
]);
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
  "pulse_summary_actioned",
] as const;
const pulseRefreshEventNames = [
  "pulse_refresh_requested",
  "pulse_refresh_completed",
  "pulse_refresh_failed",
] as const;
const pulseRefreshEventNameSet = new Set<string>(pulseRefreshEventNames);
const postInitialAnalyticsEventNameSet = new Set<string>([
  ...filingNotificationEventNameSet,
  ...pulseEventNames,
  ...pulseRefreshEventNames,
  "performance_metric_reported",
  "coverage_level_changed",
  "coverage_cleared",
  "coverage_activated",
  "filing_judgment_started",
  "filing_judgment_completed",
  "filing_judgment_revised",
  "thesis_updated",
  "monitoring_rule_created",
  "decision_session_closed",
  "second_opportunity_resolved",
  "onboarding_started",
  "onboarding_company_selected",
  "onboarding_question_started",
  "onboarding_evidence_opened",
  "onboarding_skipped",
  "session_share_created",
  "session_share_viewed",
  "session_share_answer_read",
  "session_share_cta_clicked",
  "pulse_push_priming_viewed",
  "pulse_resume_viewed",
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
    const pulseV2Migration = readFileSync(pulseV2MigrationPath, "utf8");
    for (const eventName of pulseEventNames) {
      expect(`${pulseMigration}\n${pulseV2Migration}`).toContain(`'${eventName}'`);
    }
  });

  it("adds manual and pull refresh analytics events to already-created databases", () => {
    const pulseRefreshMigration = readFileSync(pulseRefreshAnalyticsMigrationPath, "utf8");
    expect(pulseRefreshMigration).toContain(
      "drop constraint if exists analytics_events_event_name_check",
    );
    for (const eventName of pulseRefreshEventNames) {
      expect(pulseRefreshMigration).toContain(`'${eventName}'`);
    }
  });

  it("keeps the latest analytics allow-list complete when adding refresh events", () => {
    const pulseRefreshMigration = readFileSync(pulseRefreshAnalyticsMigrationPath, "utf8");
    for (const eventName of ANALYTICS_EVENT_NAMES.filter(
      (eventName) =>
        eventName !== "session_share_created"
        && eventName !== "session_share_viewed"
        && eventName !== "session_share_answer_read"
        && eventName !== "session_share_cta_clicked"
        && eventName !== "pulse_push_priming_viewed"
        && eventName !== "pulse_resume_viewed",
    )) {
      expect(pulseRefreshMigration).toContain(`'${eventName}'`);
    }
  });

  it("adds the session-share creation analytics event to already-created databases", () => {
    const sessionShareMigration = readFileSync(
      sessionShareAnalyticsMigrationPath,
      "utf8",
    );

    expect(sessionShareMigration).toContain(
      "drop constraint if exists analytics_events_event_name_check",
    );
    expect(sessionShareMigration).toContain("'session_share_created'");
  });

  it("keeps the latest analytics allow-list complete after adding session share events", () => {
    const sessionShareMigration = readFileSync(
      sessionShareAnalyticsMigrationPath,
      "utf8",
    );
    for (const eventName of ANALYTICS_EVENT_NAMES.filter(
      (eventName) =>
        eventName !== "session_share_viewed"
        && eventName !== "session_share_answer_read"
        && eventName !== "session_share_cta_clicked"
        && eventName !== "pulse_push_priming_viewed"
        && eventName !== "pulse_resume_viewed",
    )) {
      expect(sessionShareMigration).toContain(`'${eventName}'`);
    }
  });

  it("adds the session-share view/read/cta analytics events to already-created databases", () => {
    const sessionShareViewMigration = readFileSync(
      sessionShareViewAnalyticsMigrationPath,
      "utf8",
    );

    expect(sessionShareViewMigration).toContain(
      "drop constraint if exists analytics_events_event_name_check",
    );
    expect(sessionShareViewMigration).toContain("'session_share_viewed'");
    expect(sessionShareViewMigration).toContain("'session_share_answer_read'");
    expect(sessionShareViewMigration).toContain("'session_share_cta_clicked'");
  });

  it("keeps the latest analytics allow-list complete after adding session share view events", () => {
    const sessionShareViewMigration = readFileSync(
      sessionShareViewAnalyticsMigrationPath,
      "utf8",
    );
    for (const eventName of ANALYTICS_EVENT_NAMES.filter(
      (eventName) =>
        eventName !== "pulse_push_priming_viewed"
        && eventName !== "pulse_resume_viewed",
    )) {
      expect(sessionShareViewMigration).toContain(`'${eventName}'`);
    }
  });

  it("adds the pulse priming/resume analytics events to already-created databases", () => {
    const pulseRetentionMigration = readFileSync(
      join(
        process.cwd(),
        "supabase/migrations/20260819091000_add_pulse_priming_resume_analytics.sql",
      ),
      "utf8",
    );

    expect(pulseRetentionMigration).toContain(
      "drop constraint if exists analytics_events_event_name_check",
    );
    expect(pulseRetentionMigration).toContain(
      "add constraint analytics_events_event_name_check",
    );
    for (const eventName of ANALYTICS_EVENT_NAMES) {
      expect(pulseRetentionMigration).toContain(`'${eventName}'`);
    }
  });

  it("adds sampled client performance metrics to already-created databases", () => {
    const performanceMigration = readFileSync(
      performanceAnalyticsMigrationPath,
      "utf8",
    );
    expect(performanceMigration).toContain(
      "drop constraint if exists analytics_events_event_name_check",
    );
    expect(performanceMigration).toContain("'performance_metric_reported'");
  });

  it("adds the decision-loop lifecycle events without storing source prose", () => {
    const decisionLoopMigration = readFileSync(
      decisionLoopAnalyticsMigrationPath,
      "utf8",
    );
    for (const eventName of [
      "coverage_added",
      "coverage_status_changed",
      "coverage_activated",
      "filing_judgment_started",
      "filing_judgment_completed",
      "filing_judgment_revised",
      "thesis_updated",
      "monitoring_rule_created",
      "decision_session_closed",
      "second_opportunity_resolved",
    ]) {
      expect(decisionLoopMigration).toContain(`'${eventName}'`);
    }
    expect(decisionLoopMigration).toContain(
      "never copied into analytics_events.properties",
    );
  });

  it("replaces legacy coverage analytics names with level changes and clears", () => {
    const coverageLevelMigration = readFileSync(coverageLevelMigrationPath, "utf8");
    expect(coverageLevelMigration).toContain("when 'coverage_added' then 'coverage_level_changed'");
    expect(coverageLevelMigration).toContain("when 'coverage_status_changed' then 'coverage_level_changed'");
    expect(coverageLevelMigration).toContain("'coverage_level_changed'");
    expect(coverageLevelMigration).toContain("'coverage_cleared'");
  });

  it("repairs production schema drift without dropping current analytics events", () => {
    const repairMigration = readFileSync(
      productionSchemaRepairMigrationPath,
      "utf8",
    );
    for (const eventName of ANALYTICS_EVENT_NAMES.filter(
      (eventName) => !startOnboardingEventNameSet.has(eventName)
        && !pulseRefreshEventNameSet.has(eventName)
        && eventName !== "session_share_created"
        && eventName !== "session_share_viewed"
        && eventName !== "session_share_answer_read"
        && eventName !== "session_share_cta_clicked"
        && eventName !== "pulse_push_priming_viewed"
        && eventName !== "pulse_resume_viewed",
    )) {
      expect(repairMigration).toContain(`'${eventName}'`);
    }
    expect(repairMigration).toContain("mark.coverage_level is not null");
    expect(repairMigration).toContain("browse_core_strength");
    expect(repairMigration).toContain("browse_critical_risk");
  });

  it("adds the server-owned v2 onboarding lifecycle without prompt text", () => {
    const onboardingMigration = readFileSync(startOnboardingMigrationPath, "utf8");
    for (const eventName of [
      "onboarding_started",
      "onboarding_company_selected",
      "onboarding_question_started",
      "onboarding_evidence_opened",
      "onboarding_skipped",
    ]) {
      expect(onboardingMigration).toContain(`'${eventName}'`);
    }
    expect(onboardingMigration).toContain("never written to analytics");
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
