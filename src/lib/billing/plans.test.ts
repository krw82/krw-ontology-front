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
      monthlyBudgetUsd: 20,
      dailyBudgetUsd: null,
      perRunReserveUsd: 0,
      unlimited: false,
    });
    expect(getBillingPlan("pro")).toMatchObject({
      budgetPeriod: "monthly",
      monthlyBudgetUsd: 200,
      dailyBudgetUsd: null,
      perRunReserveUsd: 0,
      unlimited: false,
    });
    expect(getBillingPlan("power")).toMatchObject({
      budgetPeriod: "monthly",
      monthlyBudgetUsd: 600,
      dailyBudgetUsd: null,
      perRunReserveUsd: 0,
      unlimited: false,
    });
    expect(getBillingPlan("internal")).toMatchObject({
      budgetPeriod: "monthly",
      dailyBudgetUsd: null,
      perRunReserveUsd: 0,
      unlimited: true,
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
    expect(getBillingPlanAnalysisCredits(free)).toBe(20000);
    expect(getBillingPlanBaseRunCredits(free)).toBe(0);
    expect(getBillingPlanLimitLabel(free)).toBe("분석 크레딧/월");
  });

  it("marks internal as unlimited", () => {
    expect(getBillingPlan("internal").unlimited).toBe(true);
    expect(getBillingPlanAnalysisCredits(getBillingPlan("internal"))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("falls back to Beta for unknown plan keys", () => {
    expect(resolvePlanKey("unknown")).toBe("beta");
    expect(resolvePlanKey(null)).toBe("beta");
  });
});
