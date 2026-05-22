import { describe, expect, it } from "vitest";
import {
  buildAnalyticsEventInsert,
  isAnalyticsEventName,
  sanitizeAnalyticsProperties,
} from "@/lib/analytics/events";

describe("analytics event schema helpers", () => {
  it("accepts only canonical event names", () => {
    expect(isAnalyticsEventName("page_viewed")).toBe(true);
    expect(isAnalyticsEventName("cta_clicked")).toBe(true);
    expect(isAnalyticsEventName("question_prefilled")).toBe(true);
    expect(isAnalyticsEventName("question_submitted")).toBe(true);
    expect(isAnalyticsEventName("Question Submitted")).toBe(false);
    expect(isAnalyticsEventName("raw_question_saved")).toBe(false);
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
        raw_question: undefined,
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
      referrer: "https://example.com/path",
      utm_source: "naver",
      utm_medium: "search",
      properties: {
        ticker: "AAPL",
        question_length: 84,
      },
    });
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
      nested: {
        arr: Array.from({ length: 40 }, (_, index) => index),
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
  });
});
