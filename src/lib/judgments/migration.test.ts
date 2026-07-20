import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260718010000_company_coverage_and_filing_judgments.sql",
  ),
  "utf8",
);

describe("company coverage and filing judgment migration", () => {
  it("backfills one authoritative coverage state before dropping legacy booleans", () => {
    expect(migration).toContain("when is_holding then 'holding'");
    expect(migration).toContain("when is_watchlisted then 'watching'");
    expect(migration).toContain("else 'exploring'");
    expect(migration).toContain("drop column if exists is_watchlisted");
    expect(migration).toContain("drop column if exists is_holding");
    expect(migration).toContain("'exploring', 'watching', 'holding', 'closed'");
  });

  it("serializes active coverage limits and records idempotent timeline events", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("coverage_limit_reached");
    expect(migration).toContain("unique (user_id, idempotency_key)");
    expect(migration).toContain("user_company_coverage_events_timeline");
    expect(migration).toContain("'idempotent_replay', true");
    expect(migration).toContain("idempotency_key_conflict");
    expect(migration).toContain("v_event.request_payload <> v_request_payload");
    expect(migration).toContain("user_company_coverage_events_request_object_check");
    expect(migration).toContain("if v_status = 'closed' then");
    expect(migration).toContain("coverage_reactivation_required");
    expect(migration).toContain("create or replace function public.reconcile_user_company_coverage_limit");
    expect(migration).toContain("trg_reconcile_coverage_on_entitlement_change");
    expect(migration).toContain("trg_reconcile_coverage_on_entitlement_delete");
    expect(migration).toContain("new.current_period_end <= now()");
    expect(migration).toContain("new.grace_until is null or new.grace_until <= now()");
    expect(migration).toContain("create or replace function public.sweep_expired_company_coverage_limits");
    expect(migration).toContain("entitlement.current_period_end <= p_now");
    expect(migration).toContain("entitlement.grace_until <= p_now");
    expect(migration).toContain("from public.billing_toss_subscriptions subscription");
    expect(migration).toContain("'active', 'past_due', 'grace', 'pending_cancel'");
    expect(migration).toContain("and v_status in ('exploring', 'watching', 'holding') then");
    expect(migration).toContain("p_active_limit is not null and v_status = 'closed'");
    expect(migration).toContain("'plan_reconciliation'");
  });

  it("keeps immutable judgment revisions with current pointers and provenance", () => {
    expect(migration).toContain("create table if not exists public.user_filing_judgments");
    expect(migration).toContain("create table if not exists public.user_filing_judgment_revisions");
    expect(migration).toContain("idx_user_filing_judgment_revisions_one_current");
    expect(migration).toContain("user_filing_judgment_thesis_links");
    expect(migration).toContain("user_filing_judgment_monitoring_rules");
    expect(migration).toContain("created_by_judgment_revision_id");
    expect(migration).toContain("p_ticker text");
    expect(migration).toContain("invalid_filing_context_ticker");
    expect(migration).toContain("company.sec_cik = v_event_cik");
    expect(migration).toContain("filing_context_ticker_conflict");
    expect(migration).toContain("set ticker = judgment.ticker");
    expect(migration).toContain("v_existing.request_payload <> v_request_payload");
    expect(migration).toContain("user_filing_judgment_revisions_request_object_check");
  });

  it("uses optimistic concurrency and reviews the Pulse item atomically", () => {
    expect(migration).toContain("p_expected_revision_number integer default null");
    expect(migration).toContain("judgment_revision_conflict");
    expect(migration).toContain("'filing:' || p_filing_event_id::text");
    expect(migration).toContain("reviewed_at = coalesce(state.reviewed_at, excluded.reviewed_at)");
    expect(migration).toContain("created_rule_ids");
    expect(migration).toContain("A full-replacement revision must not leave superseded rules active");
  });

  it("records activation once only after coverage, evidence, judgment, and a next trigger exist", () => {
    expect(migration).toContain("create table if not exists public.user_retention_milestones");
    expect(migration).toContain("create table if not exists public.user_filing_source_opens");
    expect(migration).toContain("create or replace function public.try_record_coverage_activation");
    expect(migration).toContain("v_coverage_count < 3");
    expect(migration).toContain("source_open.filing_event_id = judgment.filing_event_id");
    expect(migration).toContain("judgment_rule.revision_id = judgment.current_revision_id");
    expect(migration).toContain("mark.coverage_status in ('exploring', 'watching', 'holding')");
    expect(migration).toContain("v_completed_loop_count < 1");
    expect(migration).toContain("v_monitoring_rule_count < 1");
    expect(migration).toContain("on conflict (user_id, milestone) do nothing");
  });

  it("persists one server-authoritative decision-session close per local day", () => {
    expect(migration).toContain("create table if not exists public.user_decision_sessions");
    expect(migration).toContain("unique (user_id, local_date)");
    expect(migration).toContain("create or replace function public.close_user_decision_session");
    expect(migration).toContain("pg_catalog.pg_timezone_names");
    expect(migration).toContain("'decision_session_closed'");
    expect(migration).toContain("'idempotent_replay', true");
    expect(migration).toContain("count(distinct revision.judgment_id)");
    expect(migration).toContain("judgment.current_revision_id = revision.id");
    expect(migration).toContain("observation_count");
    expect(migration).toContain("thesis_update_count");
    expect(migration).toContain("create or replace function public.record_pulse_item_impressions");
    expect(migration).toContain("jsonb_array_length(p_items) not between 1 and 20");
    expect(migration).toContain("create or replace function public.resolve_scheduled_monitoring_pulse_item");
    expect(migration).toContain("set enabled = false, updated_at = coalesce(p_resolved_at, now())");
  });

  it("enforces user-only reads and RPC-only mutations", () => {
    expect(migration).toContain("drop policy if exists \"user_company_marks_insert_own\"");
    expect(migration).toContain("revoke insert, update, delete on table public.user_company_marks from authenticated");
    expect(migration).toContain("user_filing_judgments_select_own");
    expect(migration).toContain("using (user_id = auth.uid())");
  });

  it("retires legacy Pulse state and candidate RPCs after making v3 self-contained", () => {
    expect(migration).toContain("drop column if exists read_at");
    expect(migration).toContain("create or replace function public.get_catalog_pulse_filing_candidates_v3");
    expect(migration).not.toContain("from public.get_catalog_pulse_filing_candidates_v2(");
    expect(migration).toContain("'get_catalog_global_filing_feed'");
    expect(migration).toContain("'get_catalog_pulse_filing_candidates_v2'");
    expect(migration).toContain("eligible.covered_tickers && v_preferred_tickers");
  });
});
