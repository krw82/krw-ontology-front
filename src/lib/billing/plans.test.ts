import { describe, expect, it } from "vitest";
import {
  getBillingPlanAnalysisCredits,
  getBillingPlanBaseRunCredits,
  getBillingPlanLimitLabel,
  getBillingPlan,
  listPublicBillingPlans,
  resolvePlanKey,
} from "./plans";

describe("billing plans", () => {
  it("defines public execution budgets", () => {
    expect(getBillingPlan("free")).toMatchObject({
      budgetPeriod: "monthly",
      monthlyBudgetUsd: 2,
      dailyBudgetUsd: null,
      perRunReserveUsd: 0.25,
    });
    expect(getBillingPlan("pro")).toMatchObject({
      budgetPeriod: "monthly",
      monthlyBudgetUsd: 20,
      dailyBudgetUsd: null,
      perRunReserveUsd: 0.5,
    });
    expect(getBillingPlan("power")).toMatchObject({
      budgetPeriod: "monthly",
      monthlyBudgetUsd: 60,
      dailyBudgetUsd: null,
      perRunReserveUsd: 1,
    });
  });

  it("exposes only public upgrade plans in display order", () => {
    expect(listPublicBillingPlans().map((plan) => plan.key)).toEqual([
      "free",
      "pro",
      "power",
    ]);
  });

  it("derives user-facing analysis credit labels", () => {
    const free = getBillingPlan("free");
    expect(getBillingPlanAnalysisCredits(free)).toBe(2000);
    expect(getBillingPlanBaseRunCredits(free)).toBe(250);
    expect(getBillingPlanLimitLabel(free)).toBe("분석 크레딧/월");
  });

  it("falls back to Beta for unknown plan keys", () => {
    expect(resolvePlanKey("unknown")).toBe("beta");
    expect(resolvePlanKey(null)).toBe("beta");
  });
});
