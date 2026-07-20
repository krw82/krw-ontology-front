import { describe, expect, it } from "vitest";
import {
  buildAnalyticsEventInsert,
  isClientAnalyticsEventName,
  isAnalyticsEventName,
  sanitizeAnalyticsProperties,
} from "@/lib/analytics/events";

describe("analytics event schema helpers", () => {
  it("accepts only canonical event names", () => {
    expect(isAnalyticsEventName("page_viewed")).toBe(true);
    expect(isAnalyticsEventName("cta_clicked")).toBe(true);
    expect(isAnalyticsEventName("question_prefilled")).toBe(true);
    expect(isAnalyticsEventName("suggested_question_clicked")).toBe(true);
    expect(isAnalyticsEventName("question_submitted")).toBe(true);
    expect(isAnalyticsEventName("performance_metric_reported")).toBe(true);
    expect(isAnalyticsEventName("coverage_level_changed")).toBe(true);
    expect(isAnalyticsEventName("filing_judgment_completed")).toBe(true);
    expect(isAnalyticsEventName("second_opportunity_resolved")).toBe(true);
    expect(isAnalyticsEventName("Question Submitted")).toBe(false);
    expect(isAnalyticsEventName("raw_question_saved")).toBe(false);
  });

  it("keeps authoritative decision outcomes off the browser endpoint", () => {
    expect(isClientAnalyticsEventName("filing_judgment_started")).toBe(true);
    expect(isClientAnalyticsEventName("pulse_viewed")).toBe(true);
    for (const eventName of [
      "coverage_level_changed",
      "coverage_activated",
      "filing_judgment_completed",
      "filing_judgment_revised",
      "monitoring_rule_created",
      "decision_session_closed",
      "second_opportunity_resolved",
      "sec_source_opened",
    ]) {
      expect(isClientAnalyticsEventName(eventName)).toBe(false);
    }
  });

  it("stores only bounded categorical facts for decision-loop events", () => {
    const insert = buildAnalyticsEventInsert({
      eventName: "filing_judgment_completed",
      userId: "user-1",
      properties: {
        ticker: " aapl ",
        filing_event_id: "11111111-1111-4111-8111-111111111111",
        judgment_id: "22222222-2222-4222-8222-222222222222",
        impact: "Positive",
        next_action: "update_thesis",
        evidence_count: 3,
        has_monitoring_rule: true,
        summary: "실적 공시를 보고 사용자가 작성한 자유문 판단",
        reason: "이 문장은 분석 속성에 절대 남으면 안 됩니다",
        thesis: "사용자의 비공개 thesis",
        rule_text: "매출이 특정 값 아래로 내려가면 알림",
        source: "filing detail",
        status: "confidential",
        revision_id: "this-is-not-a-database-id",
      },
    });

    expect(insert?.properties).toEqual({
      ticker: "AAPL",
      filing_event_id: "11111111-1111-4111-8111-111111111111",
      judgment_id: "22222222-2222-4222-8222-222222222222",
      impact: "positive",
      next_action: "update_thesis",
      evidence_count: 3,
      has_monitoring_rule: true,
    });
    expect(JSON.stringify(insert?.properties)).not.toContain("사용자");
    expect(JSON.stringify(insert?.properties)).not.toContain("특정 값");
  });

  it("applies the no-free-text contract to every decision-loop event", () => {
    for (const eventName of [
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
    ] as const) {
      const insert = buildAnalyticsEventInsert({
        eventName,
        userId: "user-1",
        properties: {
          ticker: "AAPL",
          status: "completed",
          question: "자유문 질문",
          judgment: "자유문 판단",
          note: "자유문 메모",
          monitoring_rule: "자유문 규칙",
        },
      });

      expect(insert?.properties).toEqual({
        ticker: "AAPL",
        status: "completed",
      });
    }
  });

  it("keeps only milestone identifiers and bounded counts for activation", () => {
    const insert = buildAnalyticsEventInsert({
      eventName: "coverage_activated",
      userId: "user-1",
      properties: {
        coverage_event_id: "33333333-3333-4333-8333-333333333333",
        coverage_count: 3,
        judgment_count: 1,
        monitoring_rule_count: 1,
        source: "system",
        private_thesis: "기록하면 안 되는 가설",
      },
    });

    expect(insert?.properties).toEqual({
      coverage_event_id: "33333333-3333-4333-8333-333333333333",
      source: "system",
      coverage_count: 3,
      judgment_count: 1,
      monitoring_rule_count: 1,
    });
  });

  it("builds a normalized insert payload without requiring raw content", () => {
    const insert = buildAnalyticsEventInsert({
      eventName: "question_submitted",
      userId: " user-1 ",
      anonymousId: " anon-1 ",
      sessionId: "session-1",
      messageId: "message-1",
      properties: {
        ticker: "AAPL",
        question_length: 84,
        raw_question: "애플의 리스크를 원문으로 길게 알려줘",
      },
      path: "/chat?ticker=AAPL",
      referrer: " https://example.com/path ",
      utm: {
        utm_source: "naver",
        utm_medium: "search",
      },
    });

    expect(insert).toMatchObject({
      user_id: "user-1",
      anonymous_id: "anon-1",
      event_name: "question_submitted",
      session_id: "session-1",
      message_id: "message-1",
      path: "/chat?ticker=AAPL",
      referrer: "https://example.com",
      utm_source: "naver",
      utm_medium: "search",
      properties: {
        ticker: "AAPL",
        question_length: 84,
      },
    });
    expect(JSON.stringify(insert?.properties)).not.toContain("애플의 리스크");
  });

  it("refuses anonymous events without any identity", () => {
    expect(
      buildAnalyticsEventInsert({
        eventName: "citation_opened",
      }),
    ).toBeNull();
  });

  it("sanitizes properties to JSON-safe bounded values", () => {
    const sanitized = sanitizeAnalyticsProperties({
      ok: true,
      missing: undefined,
      badNumber: Number.NaN,
      date: new Date("2026-05-23T00:00:00.000Z"),
      long: "x".repeat(700),
      fn: () => "skip",
      raw_question: "민감한 질문 원문",
      rawQuestion: "카멜케이스 질문 원문",
      full_answer: "긴 답변 전문",
      nested: {
        arr: Array.from({ length: 40 }, (_, index) => index),
        prompt: "추천 질문 원문",
      },
    });

    expect(sanitized).toMatchObject({
      ok: true,
      date: "2026-05-23T00:00:00.000Z",
      long: "x".repeat(500),
      nested: {
        arr: Array.from({ length: 25 }, (_, index) => index),
      },
    });
    expect(JSON.stringify(sanitized)).not.toContain("badNumber");
    expect(JSON.stringify(sanitized)).not.toContain("fn");
    expect(JSON.stringify(sanitized)).not.toContain("missing");
    expect(JSON.stringify(sanitized)).not.toContain("민감한 질문 원문");
    expect(JSON.stringify(sanitized)).not.toContain("카멜케이스 질문 원문");
    expect(JSON.stringify(sanitized)).not.toContain("긴 답변 전문");
    expect(JSON.stringify(sanitized)).not.toContain("추천 질문 원문");
  });
});
