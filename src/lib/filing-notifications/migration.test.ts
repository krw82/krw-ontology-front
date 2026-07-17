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
const globalDiscoveryConflictFixMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260716034000_fix_sec_filing_discovery_output_column_ambiguity.sql",
  ),
  "utf8",
);
const form4PriorityMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260716051000_prioritize_form4_enrichment_jobs.sql",
  ),
  "utf8",
);
const form4AccessionConflictMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260716052000_ignore_cross_listed_form4_accession_conflicts.sql",
  ),
  "utf8",
);
const realtimeEnrichmentPriorityMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260716054000_prioritize_realtime_sec_enrichment.sql",
  ),
  "utf8",
);
const boundedCatalogBaselineMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260716055000_bound_catalog_sec_baseline_queue.sql",
  ),
  "utf8",
);
const baselinePruneIndexesMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260716056000_index_catalog_sec_baseline_prune.sql",
  ),
  "utf8",
);
const filingBriefMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260717020000_sec_filing_briefs.sql"),
  "utf8",
);
const filingBriefSourceUrlFixMigration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260717030000_fix_sec_filing_brief_source_url_check.sql"),
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

  it("keeps the global discovery RPC result name separate from its job conflict target", () => {
    expect(globalDiscoveryConflictFixMigration).toContain("#variable_conflict use_column");
    expect(globalDiscoveryConflictFixMigration).toContain(
      "on conflict on constraint sec_filing_processing_jobs_unique_stage do update",
    );
  });

  it("gives Form 4 enrichment equal claim-time priority during catalog backfill", () => {
    expect(form4PriorityMigration).toContain("event.form_type in ('4', '4/A') then 10 else 0");
    expect(form4PriorityMigration).toContain("event.occurred_at desc");
  });

  it("preserves the first issuer mapping for a cross-listed Form 4 accession", () => {
    expect(form4AccessionConflictMigration).toContain("v_event_form in (''4'', ''4/A'') and v_form in (''4'', ''4/A'')");
    expect(form4AccessionConflictMigration).toContain("return query select v_event_id, false;");
  });

  it("keeps newly discovered filings ahead of historical submissions backfill", () => {
    expect(realtimeEnrichmentPriorityMigration).toContain("event.source_metadata ->> 'discoveryBaseline'");
    expect(realtimeEnrichmentPriorityMigration).toContain("then 1 else 0 end asc");
    expect(realtimeEnrichmentPriorityMigration).not.toContain("now() - job.created_at");
  });

  it("uses an indexed queue order and provides bounded historical-baseline cleanup", () => {
    expect(boundedCatalogBaselineMigration).toContain("idx_sec_filing_processing_jobs_ready_priority");
    expect(boundedCatalogBaselineMigration).toContain("prune_catalog_sec_baseline_backfill");
    expect(boundedCatalogBaselineMigration).toContain("job.priority desc");
  });

  it("indexes baseline selection and every non-prefixed filing-event foreign key", () => {
    expect(baselinePruneIndexesMigration).toContain("idx_sec_filing_events_baseline_prune");
    expect(baselinePruneIndexesMigration).toContain("idx_sec_filing_processing_jobs_event");
    expect(baselinePruneIndexesMigration).toContain("idx_user_filing_notifications_event");
  });

  it("queues source-grounded briefs after enrichment without putting Form 4 through an LLM", () => {
    expect(filingBriefMigration).toContain("create table if not exists public.sec_filing_briefs");
    expect(filingBriefMigration).toContain("create table if not exists public.sec_filing_brief_runs");
    expect(filingBriefMigration).toContain("stage in ('enrich', 'notification_fanout', 'brief')");
    expect(filingBriefMigration).toContain("enqueue_sec_filing_brief_after_enrichment");
    expect(filingBriefMigration).toContain("event.form_type in ('8-K', '8-K/A', '6-K', '6-K/A')");
    expect(filingBriefMigration).toContain("v_event.form_type not in ('8-K', '8-K/A', '6-K', '6-K/A')");
    expect(filingBriefMigration).toContain("complete_sec_filing_brief");
    expect(filingBriefMigration).toContain("record_sec_filing_brief_failure");
  });

  it("accepts canonical SEC archive URLs in brief writes and run diagnostics", () => {
    expect(filingBriefSourceUrlFixMigration).toContain("sec_filing_briefs_source_url_check");
    expect(filingBriefSourceUrlFixMigration).toContain("sec_filing_brief_runs_source_url_check");
    expect(filingBriefSourceUrlFixMigration).toContain("'^https://www[.]sec[.]gov/Archives/'");
    expect(filingBriefSourceUrlFixMigration).toContain("create or replace function public.complete_sec_filing_brief");
  });
});
