import { describe, expect, it } from "vitest";
import { buildBetaEntitlementStatus } from "./entitlement-model";

describe("buildBetaEntitlementStatus", () => {
  it("calculates daily usage, remaining questions, and reset time", () => {
    const entitlement = buildBetaEntitlementStatus({
      questionsUsed: 6,
      costUsedUsd: 1.25,
      dailyQuestionLimit: 20,
      dailyCostCapUsd: 5,
      now: new Date("2026-05-23T12:30:00.000Z"),
    });

    expect(entitlement.plan.key).toBe("beta");
    expect(entitlement.usage.questions_used).toBe(6);
    expect(entitlement.usage.remaining_questions).toBe(14);
    expect(entitlement.usage.percent_used).toBe(30);
    expect(entitlement.usage.resets_at).toBe("2026-05-24T00:00:00.000Z");
  });

  it("caps percent and never returns negative remaining usage", () => {
    const entitlement = buildBetaEntitlementStatus({
      questionsUsed: 24,
      costUsedUsd: Number.NaN,
      dailyQuestionLimit: 20,
      dailyCostCapUsd: 5,
    });

    expect(entitlement.usage.remaining_questions).toBe(0);
    expect(entitlement.usage.percent_used).toBe(100);
    expect(entitlement.usage.cost_used_usd).toBe(0);
  });
});
