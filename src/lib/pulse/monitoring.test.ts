import { describe, expect, it } from "vitest";
import type { PulseCandidate } from "@/lib/pulse/contract";
import {
  applyPulseMonitoringRules,
  buildDueMonitoringCandidates,
  monitoringRuleMatches,
} from "@/lib/pulse/monitoring";
import type { UserCompanyMonitoringRuleRow } from "@/types/database";

function filing(overrides: Partial<PulseCandidate> = {}): PulseCandidate {
  return {
    item_key: "filing:event-1",
    kind: "filing",
    trigger: "event",
    source_type: "filing",
    source_id: "event-1",
    ticker: "AAPL",
    coverage_status: "holding",
    judgment: null,
    linked_thesis: null,
    eyebrow: "8-K",
    title: "Chief Financial Officer transition",
    body: "The company appointed an interim CFO.",
    reason_code: "catalog_sec_filing",
    reason_label: "catalog",
    priority: "urgent",
    occurred_at: "2026-07-18T00:00:00.000Z",
    available_at: "2026-07-18T00:00:00.000Z",
    expires_at: null,
    reviewed_at: null,
    saved_at: null,
    snoozed_until: null,
    group_key: null,
    primary_action: { type: "link", label: "보기", href: "/" },
    secondary_actions: [],
    metadata: { form_type: "8-K", primary_event_tag: "executive_change" },
    ...overrides,
  };
}

function rule(overrides: Partial<UserCompanyMonitoringRuleRow> = {}): UserCompanyMonitoringRuleRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    user_id: "user-1",
    ticker: "AAPL",
    rule_type: "filing_form",
    operator: "matches",
    value: "8-K",
    next_review_at: null,
    dedupe_key: "filing_form:8-k",
    enabled: true,
    created_by_judgment_revision_id: null,
    created_at: "2026-07-17T00:00:00.000Z",
    updated_at: "2026-07-17T00:00:00.000Z",
    ...overrides,
  };
}

describe("Pulse monitoring rules", () => {
  it("matches deterministic filing form, item, and keyword rules", () => {
    expect(monitoringRuleMatches(rule(), filing())).toBe(true);
    expect(monitoringRuleMatches(rule({ rule_type: "filing_item", value: "executive_change" }), filing())).toBe(true);
    expect(monitoringRuleMatches(rule({ rule_type: "keyword", operator: "contains", value: "interim cfo" }), filing())).toBe(true);
    expect(monitoringRuleMatches(rule({ ticker: "MSFT" }), filing())).toBe(false);
  });

  it("annotates a filing without exposing a user's free-text rule value", () => {
    const [item] = applyPulseMonitoringRules([filing()], [rule({ rule_type: "keyword", operator: "contains", value: "interim cfo" })]);
    expect(item).toMatchObject({
      reason_code: "monitoring_rule_matched",
      metadata: { monitoring_rule_match_count: 1, monitoring_rule_type: "keyword" },
    });
    expect(JSON.stringify(item)).not.toContain("interim cfo");
  });

  it("matches a monitoring rule for another covered share-class ticker", () => {
    const candidate = filing({
      ticker: "GOOG",
      metadata: {
        form_type: "8-K",
        primary_event_tag: "executive_change",
        covered_tickers_csv: "GOOG,GOOGL",
      },
    });
    const aliasRule = rule({ ticker: "GOOGL" });

    expect(monitoringRuleMatches(aliasRule, candidate)).toBe(true);
    expect(applyPulseMonitoringRules([candidate], [aliasRule])[0]).toMatchObject({
      reason_code: "monitoring_rule_matched",
      reason_label: expect.stringContaining("GOOGL"),
    });
  });

  it("creates only due scheduled reviews", () => {
    const due = buildDueMonitoringCandidates([
      rule({ rule_type: "scheduled_review", operator: "on_or_after", value: null, next_review_at: "2026-07-17T00:00:00.000Z" }),
      rule({ id: "22222222-2222-4222-8222-222222222222", rule_type: "scheduled_review", operator: "on_or_after", value: null, next_review_at: "2026-07-19T00:00:00.000Z" }),
    ], new Date("2026-07-18T00:00:00.000Z"));
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ kind: "resurface", trigger: "schedule", ticker: "AAPL" });
  });
});
