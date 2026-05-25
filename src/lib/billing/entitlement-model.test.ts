import { describe, expect, it } from "vitest";
import { buildEntitlementStatus } from "./entitlement-model";
import { getCurrentMonthlyBillingPeriod } from "./period";

describe("buildEntitlementStatus", () => {
  it("calculates Beta execution budget usage and reset time", () => {
    const period = getCurrentMonthlyBillingPeriod(
      new Date("2026-05-23T12:30:00.000Z"),
    );
    const entitlement = buildEntitlementStatus({
      planKey: "beta",
      budgetUsedUsd: 2,
      budgetReservedUsd: 0.25,
      dailyBudgetUsedUsd: 0.25,
      dailyBudgetReservedUsd: 0,
      runCount: 6,
      period,
    });

    expect(entitlement.status).toBe("beta");
    expect(entitlement.plan.key).toBe("beta");
    expect(entitlement.usage.period).toBe("monthly");
    expect(entitlement.usage.budget_used_usd).toBe(2);
    expect(entitlement.usage.budget_reserved_usd).toBe(0.25);
    expect(entitlement.usage.budget_limit_usd).toBe(50);
    expect(entitlement.usage.remaining_budget_usd).toBe(47.75);
    expect(entitlement.usage.analysis_credits_used).toBe(2000);
    expect(entitlement.usage.analysis_credits_reserved).toBe(250);
    expect(entitlement.usage.analysis_credits_limit).toBe(50000);
    expect(entitlement.usage.remaining_analysis_credits).toBe(47750);
    expect(entitlement.usage.run_count).toBe(6);
    expect(entitlement.usage.percent_used).toBe(5);
    expect(entitlement.usage.alert_level).toBe("ok");
    expect(entitlement.usage.resets_at).toBe("2026-06-01T00:00:00.000Z");
  });

  it("marks 80 percent execution budget usage as warning", () => {
    const entitlement = buildEntitlementStatus({
      planKey: "pro",
      budgetUsedUsd: 160,
      budgetReservedUsd: 0,
      dailyBudgetUsedUsd: 1,
      dailyBudgetReservedUsd: 0,
      runCount: 80,
      period: getCurrentMonthlyBillingPeriod(),
    });

    expect(entitlement.usage.budget_limit_usd).toBe(200);
    expect(entitlement.usage.analysis_credits_used).toBe(160000);
    expect(entitlement.usage.analysis_credits_limit).toBe(200000);
    expect(entitlement.usage.alert_level).toBe("warning");
    expect(entitlement.upgrade.enabled).toBe(true);
  });

  it("allows the final run while any execution budget remains", () => {
    const entitlement = buildEntitlementStatus({
      planKey: "power",
      budgetUsedUsd: 599.25,
      budgetReservedUsd: 0,
      dailyBudgetUsedUsd: 2,
      dailyBudgetReservedUsd: 0,
      runCount: 301,
      period: getCurrentMonthlyBillingPeriod(),
    });

    expect(entitlement.usage.remaining_budget_usd).toBe(0.75);
    expect(entitlement.usage.remaining_analysis_credits).toBe(750);
    expect(entitlement.usage.percent_used).toBe(100);
    expect(entitlement.usage.alert_level).toBe("warning");
    expect(entitlement.usage.can_run).toBe(true);
    expect(entitlement.upgrade.enabled).toBe(true);
  });

  it("blocks usage once no execution budget remains", () => {
    const entitlement = buildEntitlementStatus({
      planKey: "free",
      budgetUsedUsd: 20,
      budgetReservedUsd: 0,
      dailyBudgetUsedUsd: 20,
      dailyBudgetReservedUsd: 0,
      runCount: 8,
      period: getCurrentMonthlyBillingPeriod(),
    });

    expect(entitlement.usage.remaining_budget_usd).toBe(0);
    expect(entitlement.usage.remaining_analysis_credits).toBe(0);
    expect(entitlement.usage.percent_used).toBe(100);
    expect(entitlement.usage.alert_level).toBe("blocked");
    expect(entitlement.usage.can_run).toBe(false);
    expect(entitlement.upgrade.enabled).toBe(true);
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
