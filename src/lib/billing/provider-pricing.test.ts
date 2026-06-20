import { describe, expect, it } from "vitest";
import {
  calculateRawAnalysisCredits,
  formatDisplayCredits,
  rawCreditsToDisplayCredits,
} from "./credit-policy";
import { calculateProviderUsageCost, estimateCost } from "./provider-pricing";

describe("credit policy", () => {
  it("uses input plus double-weighted output tokens for raw credits", () => {
    expect(
      calculateRawAnalysisCredits({
        inputTokens: 54_482,
        outputTokens: 4_178,
      }),
    ).toBe(62_838);
  });

  it("derives display credits from raw credits without storing them", () => {
    expect(rawCreditsToDisplayCredits(2_000_000)).toBe(2_000);
    expect(formatDisplayCredits(1_240_532)).toBe("1,240");
    expect(formatDisplayCredits(12_345)).toBe("12.3");
  });
});

describe("provider pricing", () => {
  it("estimates DeepSeek V4 Flash cost conservatively when cache data is unavailable", () => {
    expect(estimateCost(54_482, 4_178)).toBe(0.008797);
  });

  it("records cache-aware provider cost separately from user credits", () => {
    const cost = calculateProviderUsageCost({
      inputTokens: 100_000,
      outputTokens: 10_000,
      cacheHitInputTokens: 60_000,
      cacheMissInputTokens: 40_000,
    });

    expect(cost.userCreditsRaw).toBe(120_000);
    expect(cost.actualProviderCostUsd).toBe(0.008568);
    expect(cost.pricingVersion).toBe("deepseek-v4-flash-2026-06");
  });

  it("treats missing or zero cache breakdown as cache miss", () => {
    const cost = calculateProviderUsageCost({
      inputTokens: 100_000,
      outputTokens: 0,
      cacheHitInputTokens: 0,
      cacheMissInputTokens: 0,
    });

    expect(cost.cacheHitInputTokens).toBe(0);
    expect(cost.cacheMissInputTokens).toBe(100_000);
    expect(cost.actualProviderCostUsd).toBe(0.014);
  });

  it("treats an unclassified cache remainder as cache miss", () => {
    const cost = calculateProviderUsageCost({
      inputTokens: 100_000,
      outputTokens: 0,
      cacheHitInputTokens: 20_000,
      cacheMissInputTokens: 30_000,
    });

    expect(cost.cacheHitInputTokens).toBe(20_000);
    expect(cost.cacheMissInputTokens).toBe(80_000);
    expect(cost.actualProviderCostUsd).toBe(0.011256);
  });
});
