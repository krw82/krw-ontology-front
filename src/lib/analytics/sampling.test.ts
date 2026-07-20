import { describe, expect, it } from "vitest";
import {
  normalizedAnalyticsHash,
  parseAnalyticsSampleRate,
  shouldSampleAnalyticsKey,
} from "@/lib/analytics/sampling";

describe("analytics sampling", () => {
  it("parses and bounds public sample rates", () => {
    expect(parseAnalyticsSampleRate(undefined, 0.1)).toBe(0.1);
    expect(parseAnalyticsSampleRate("0.25", 0.1)).toBe(0.25);
    expect(parseAnalyticsSampleRate("4", 0.1)).toBe(1);
    expect(parseAnalyticsSampleRate("-2", 0.1)).toBe(0);
    expect(parseAnalyticsSampleRate("invalid", 0.1)).toBe(0.1);
  });

  it("keeps deterministic cohorts for the same key", () => {
    expect(normalizedAnalyticsHash("anon-1")).toBe(
      normalizedAnalyticsHash("anon-1"),
    );
    expect(shouldSampleAnalyticsKey("anon-1", 1)).toBe(true);
    expect(shouldSampleAnalyticsKey("anon-1", 0)).toBe(false);
  });
});
