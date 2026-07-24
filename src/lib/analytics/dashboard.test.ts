import { describe, expect, it } from "vitest";
import {
  buildAnalyticsDailyRows,
  buildAnalyticsFunnelSummary,
  type AnalyticsDashboardEvent,
} from "@/lib/analytics/dashboard";

const range = {
  since: "2026-05-01T00:00:00.000Z",
  until: "2026-05-31T23:59:59.999Z",
};

function event(
  eventName: AnalyticsDashboardEvent["event_name"],
  actor: string,
  createdAt: string,
): AnalyticsDashboardEvent {
  return {
    event_name: eventName,
    user_id: actor.startsWith("user:") ? actor.slice("user:".length) : null,
    anonymous_id: actor.startsWith("anon:") ? actor.slice("anon:".length) : null,
    created_at: createdAt,
    properties: {},
  };
}

describe("analytics dashboard aggregation", () => {
  it("builds funnel counts and decision rates", () => {
    const events = [
      event("signup_started", "anon:a", "2026-05-23T01:00:00.000Z"),
      event("signup_started", "anon:b", "2026-05-23T01:00:30.000Z"),
      event("login_completed", "user:1", "2026-05-23T01:01:00.000Z"),
      event("question_submitted", "user:1", "2026-05-23T01:02:00.000Z"),
      event("answer_completed", "user:1", "2026-05-23T01:03:00.000Z"),
      event("citation_opened", "user:1", "2026-05-23T01:04:00.000Z"),
      event("question_submitted", "user:2", "2026-05-23T01:05:00.000Z"),
      event("answer_failed", "user:2", "2026-05-23T01:06:00.000Z"),
    ];

    const summary = buildAnalyticsFunnelSummary(events, range);

    expect(summary.counts).toMatchObject({
      signup_started: 2,
      login_completed: 1,
      question_submitted: 2,
      answer_completed: 1,
      answer_failed: 1,
      citation_opened: 1,
    });
    expect(summary.uniqueActors).toBe(4);
    expect(summary.rates).toEqual({
      pageToCta: null,
      ctaToSignup: null,
      loginToCompanySelection: 0,
      companySelectionToFiling: null,
      filingToSource: null,
      sourceToFollow: null,
      signupToQuestion: 100,
      prefillToQuestion: null,
      questionToAnswer: 50,
      answerToCitation: 100,
      answerFailureRate: 50,
      limitToUpgrade: null,
      onboardingStartToCompanySelection: null,
      onboardingStartToQuestion: null,
      onboardingStartToEvidence: null,
    });
  });

  it("groups events by day with per-day actor counts", () => {
    const rows = buildAnalyticsDailyRows([
      event("question_submitted", "user:1", "2026-05-22T23:59:00.000Z"),
      event("answer_completed", "user:1", "2026-05-22T23:59:30.000Z"),
      event("question_submitted", "user:2", "2026-05-23T00:00:00.000Z"),
    ]);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      date: "2026-05-22",
      uniqueActors: 1,
      counts: {
        question_submitted: 1,
        answer_completed: 1,
      },
    });
    expect(rows[1]).toMatchObject({
      date: "2026-05-23",
      uniqueActors: 1,
      counts: {
        question_submitted: 1,
      },
    });
  });

  it("measures the first-value evidence path", () => {
    const summary = buildAnalyticsFunnelSummary([
      event("login_completed", "user:1", "2026-05-23T01:00:00.000Z"),
      event("company_selected", "user:1", "2026-05-23T01:01:00.000Z"),
      event("filing_detail_viewed", "user:1", "2026-05-23T01:02:00.000Z"),
      event("sec_source_opened", "user:1", "2026-05-23T01:03:00.000Z"),
      event("company_followed", "user:1", "2026-05-23T01:04:00.000Z"),
    ], range);

    expect(summary.rates).toMatchObject({
      loginToCompanySelection: 100,
      companySelectionToFiling: 100,
      filingToSource: 100,
      sourceToFollow: 100,
    });
  });

  it("measures the new-user path through an evidence confirmation", () => {
    const summary = buildAnalyticsFunnelSummary([
      event("onboarding_started", "user:1", "2026-05-23T01:00:00.000Z"),
      event("onboarding_company_selected", "user:1", "2026-05-23T01:01:00.000Z"),
      event("onboarding_question_started", "user:2", "2026-05-23T01:02:00.000Z"),
      event("onboarding_evidence_opened", "user:1", "2026-05-23T01:03:00.000Z"),
    ], range);

    expect(summary.rates).toMatchObject({
      onboardingStartToCompanySelection: 100,
      onboardingStartToQuestion: 100,
      onboardingStartToEvidence: 100,
    });
  });
});
