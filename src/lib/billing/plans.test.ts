import { describe, expect, it } from "vitest";
import {
  getBillingPlan,
  listPublicBillingPlans,
  resolvePlanKey,
} from "./plans";

describe("billing plans", () => {
  it("defines public monthly question quotas", () => {
    expect(getBillingPlan("free").monthlyQuestionLimit).toBe(10);
    expect(getBillingPlan("pro").monthlyQuestionLimit).toBe(100);
    expect(getBillingPlan("power").monthlyQuestionLimit).toBe(300);
  });

  it("exposes only public upgrade plans in display order", () => {
    expect(listPublicBillingPlans().map((plan) => plan.key)).toEqual([
      "free",
      "pro",
      "power",
    ]);
  });

  it("falls back to Free for unknown plan keys", () => {
    expect(resolvePlanKey("unknown")).toBe("free");
    expect(resolvePlanKey(null)).toBe("free");
  });
});
