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
      budgetPeriod: "weekly",
      monthlyPriceKrw: 0,
      weeklyAnalysisCreditsRaw: 250000,
      dailyBudgetUsd: null,
      perRunReserveUsd: 0,
      unlimited: false,
    });
    expect(getBillingPlan("lite")).toMatchObject({
      budgetPeriod: "weekly",
      monthlyPriceKrw: 2900,
      weeklyAnalysisCreditsRaw: 750000,
      dailyBudgetUsd: null,
      perRunReserveUsd: 0,
      unlimited: false,
    });
    expect(getBillingPlan("standard")).toMatchObject({
      budgetPeriod: "weekly",
      monthlyPriceKrw: 7900,
      weeklyAnalysisCreditsRaw: 2000000,
      dailyBudgetUsd: null,
      perRunReserveUsd: 0,
      unlimited: false,
    });
    expect(getBillingPlan("pro")).toMatchObject({
      budgetPeriod: "weekly",
      monthlyPriceKrw: 29000,
      weeklyAnalysisCreditsRaw: 10000000,
      dailyBudgetUsd: null,
      perRunReserveUsd: 0,
      unlimited: false,
    });
    expect(getBillingPlan("internal")).toMatchObject({
      budgetPeriod: "weekly",
      dailyBudgetUsd: null,
      perRunReserveUsd: 0,
      unlimited: true,
    });
  });

  it("exposes only public upgrade plans in display order", () => {
    expect(listPublicBillingPlans().map((plan) => plan.key)).toEqual([
      "free",
      "lite",
      "standard",
      "pro",
    ]);
  });

  it("derives user-facing usage labels", () => {
    const free = getBillingPlan("free");
    expect(getBillingPlanAnalysisCredits(free)).toBe(250);
    expect(getBillingPlanBaseRunCredits(free)).toBe(0);
    expect(getBillingPlanLimitLabel(free)).toBe("사용량/주");
  });

  it("marks internal as unlimited", () => {
    expect(getBillingPlan("internal").unlimited).toBe(true);
    expect(getBillingPlanAnalysisCredits(getBillingPlan("internal"))).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });

  it("falls back to Free for unknown plan keys and maps legacy Power to Pro", () => {
    expect(resolvePlanKey("power")).toBe("pro");
    expect(resolvePlanKey("unknown")).toBe("free");
    expect(resolvePlanKey(null)).toBe("free");
  });
});
