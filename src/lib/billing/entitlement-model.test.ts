import { describe, expect, it } from "vitest";
import { buildEntitlementStatus } from "./entitlement-model";
import {
  getCurrentMonthlyBillingPeriod,
  getCurrentWeeklyBillingPeriod,
} from "./period";

describe("buildEntitlementStatus", () => {
  it("calculates weekly Beta credit usage and reset time", () => {
    const period = getCurrentWeeklyBillingPeriod(
      new Date("2026-05-20T12:30:00.000Z"),
      new Date("2026-05-23T12:30:00.000Z"),
    );
    const entitlement = buildEntitlementStatus({
      planKey: "beta",
      budgetUsedUsd: 0.2,
      budgetReservedUsd: 0.05,
      dailyBudgetUsedUsd: 0.05,
      dailyBudgetReservedUsd: 0,
      runCount: 6,
      period,
      creditsUsedRaw: 500_000,
      creditsReservedRaw: 50_000,
      creditsLimitRaw: 2_000_000,
    });

    expect(entitlement.status).toBe("beta");
    expect(entitlement.plan.key).toBe("beta");
    expect(entitlement.usage.period).toBe("weekly");
    expect(entitlement.usage.budget_used_usd).toBe(0.2);
    expect(entitlement.usage.budget_reserved_usd).toBe(0.05);
    expect(entitlement.usage.budget_limit_usd).toBeCloseTo(1.213333, 5);
    expect(entitlement.usage.remaining_budget_usd).toBe(0.96);
    expect(entitlement.usage.credits_used_raw).toBe(500_000);
    expect(entitlement.usage.credits_reserved_raw).toBe(50_000);
    expect(entitlement.usage.credits_limit_raw).toBe(2_000_000);
    expect(entitlement.usage.credits_remaining_raw).toBe(1_450_000);
    expect(entitlement.usage.credits_used_display).toBe(500);
    expect(entitlement.usage.credits_limit_display).toBe(2_000);
    expect(entitlement.usage.run_count).toBe(6);
    expect(entitlement.usage.percent_used).toBe(28);
    expect(entitlement.usage.alert_level).toBe("ok");
    expect(entitlement.usage.resets_at).toBe("2026-05-27T12:30:00.000Z");
  });

  it("uses raw weekly credits for warnings instead of execution budget usage", () => {
    const entitlement = buildEntitlementStatus({
      planKey: "free",
      budgetUsedUsd: 1,
      budgetReservedUsd: 0,
      dailyBudgetUsedUsd: 1,
      dailyBudgetReservedUsd: 0,
      runCount: 80,
      period: getCurrentMonthlyBillingPeriod(),
      creditsUsedRaw: 270_000,
      creditsReservedRaw: 0,
      creditsLimitRaw: 300_000,
    });

    expect(entitlement.usage.percent_used).toBe(90);
    expect(entitlement.usage.alert_level).toBe("warning");
    expect(entitlement.upgrade.enabled).toBe(true);
  });

  it("does not upsell paid users while credits remain", () => {
    const entitlement = buildEntitlementStatus({
      planKey: "standard",
      budgetUsedUsd: 1,
      budgetReservedUsd: 0,
      dailyBudgetUsedUsd: 1,
      dailyBudgetReservedUsd: 0,
      runCount: 80,
      period: getCurrentMonthlyBillingPeriod(),
      creditsUsedRaw: 1_800_000,
      creditsReservedRaw: 0,
      creditsLimitRaw: 2_000_000,
    });

    expect(entitlement.usage.percent_used).toBe(90);
    expect(entitlement.usage.alert_level).toBe("warning");
    expect(entitlement.usage.can_run).toBe(true);
    expect(entitlement.upgrade.enabled).toBe(false);
  });

  it("blocks usage once no raw weekly credits remain", () => {
    const entitlement = buildEntitlementStatus({
      planKey: "free",
      budgetUsedUsd: 0,
      budgetReservedUsd: 0,
      dailyBudgetUsedUsd: 0,
      dailyBudgetReservedUsd: 0,
      runCount: 8,
      period: getCurrentMonthlyBillingPeriod(),
      creditsUsedRaw: 300_000,
      creditsReservedRaw: 0,
      creditsLimitRaw: 300_000,
    });

    expect(entitlement.usage.credits_remaining_raw).toBe(0);
    expect(entitlement.usage.percent_used).toBe(100);
    expect(entitlement.usage.alert_level).toBe("blocked");
    expect(entitlement.usage.can_run).toBe(false);
    expect(entitlement.upgrade.enabled).toBe(true);
  });

  it("keeps all features open on the free plan", () => {
    const entitlement = buildEntitlementStatus({
      planKey: "free",
      budgetUsedUsd: 0,
      budgetReservedUsd: 0,
      dailyBudgetUsedUsd: 0,
      dailyBudgetReservedUsd: 0,
      runCount: 0,
      period: getCurrentMonthlyBillingPeriod(),
    });

    expect(entitlement.features.every((feature) => feature.enabled)).toBe(true);
  });

  it("does not upsell standard users after all credits are used", () => {
    const entitlement = buildEntitlementStatus({
      planKey: "standard",
      budgetUsedUsd: 0,
      budgetReservedUsd: 0,
      dailyBudgetUsedUsd: 0,
      dailyBudgetReservedUsd: 0,
      runCount: 20,
      period: getCurrentMonthlyBillingPeriod(),
      creditsUsedRaw: 2_000_000,
      creditsReservedRaw: 0,
      creditsLimitRaw: 2_000_000,
    });

    expect(entitlement.usage.can_run).toBe(false);
    expect(entitlement.usage.alert_level).toBe("blocked");
    expect(entitlement.upgrade.enabled).toBe(false);
    expect(entitlement.upgrade.message).toContain("다음 충전 후");
  });

  it("marks admin status as unlimited", () => {
    const entitlement = buildEntitlementStatus({
      planKey: "internal",
      budgetUsedUsd: 42,
      budgetReservedUsd: 100,
      dailyBudgetUsedUsd: 10,
      dailyBudgetReservedUsd: 1,
      runCount: 42,
      period: getCurrentMonthlyBillingPeriod(),
      status: "admin",
    });

    expect(entitlement.status).toBe("admin");
    expect(entitlement.usage.unlimited).toBe(true);
    expect(entitlement.usage.can_run).toBe(true);
    expect(entitlement.usage.percent_used).toBe(0);
    expect(entitlement.upgrade.enabled).toBe(false);
  });

  it("treats the internal plan itself as unlimited", () => {
    const entitlement = buildEntitlementStatus({
      planKey: "internal",
      budgetUsedUsd: 420,
      budgetReservedUsd: 1000,
      dailyBudgetUsedUsd: 10,
      dailyBudgetReservedUsd: 1,
      runCount: 42,
      period: getCurrentMonthlyBillingPeriod(),
    });

    expect(entitlement.plan.key).toBe("internal");
    expect(entitlement.usage.unlimited).toBe(true);
    expect(entitlement.usage.can_run).toBe(true);
    expect(entitlement.usage.remaining_analysis_credits).toBe(
      Number.MAX_SAFE_INTEGER,
    );
  });
});
