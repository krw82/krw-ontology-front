import { describe, expect, it } from "vitest";
import { buildEntitlementStatus } from "./entitlement-model";
import { getCurrentMonthlyBillingPeriod } from "./period";

describe("buildEntitlementStatus", () => {
  it("calculates monthly Free usage and reset time", () => {
    const period = getCurrentMonthlyBillingPeriod(
      new Date("2026-05-23T12:30:00.000Z"),
    );
    const entitlement = buildEntitlementStatus({
      planKey: "free",
      questionsUsed: 6,
      period,
    });

    expect(entitlement.plan.key).toBe("free");
    expect(entitlement.usage.questions_used).toBe(6);
    expect(entitlement.usage.questions_limit).toBe(10);
    expect(entitlement.usage.remaining_questions).toBe(4);
    expect(entitlement.usage.percent_used).toBe(60);
    expect(entitlement.usage.alert_level).toBe("ok");
    expect(entitlement.usage.resets_at).toBe("2026-06-01T00:00:00.000Z");
  });

  it("marks 80 percent usage as warning", () => {
    const entitlement = buildEntitlementStatus({
      planKey: "pro",
      questionsUsed: 80,
      period: getCurrentMonthlyBillingPeriod(),
    });

    expect(entitlement.usage.questions_limit).toBe(100);
    expect(entitlement.usage.alert_level).toBe("warning");
    expect(entitlement.upgrade.enabled).toBe(true);
  });

  it("blocks usage once the monthly plan limit is reached", () => {
    const entitlement = buildEntitlementStatus({
      planKey: "power",
      questionsUsed: 301,
      period: getCurrentMonthlyBillingPeriod(),
    });

    expect(entitlement.usage.remaining_questions).toBe(0);
    expect(entitlement.usage.percent_used).toBe(100);
    expect(entitlement.usage.alert_level).toBe("blocked");
    expect(entitlement.usage.can_run).toBe(false);
    expect(entitlement.upgrade.enabled).toBe(true);
  });
});
