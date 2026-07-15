import { describe, expect, it } from "vitest";
import type { EntitlementPlanKey } from "@/types/entitlement";
import {
  getFeatureSplitMode,
  isPlanFeatureEnabled,
  type MenuFeatureKey,
} from "./feature-access";

const menuFeatures: MenuFeatureKey[] = [
  "company_search",
  "guru_advisor",
  "recent_chats",
  "institutional_holdings",
  "stock_discovery",
  "wide_research",
  "research_notebook",
];

describe("temporary plan feature split", () => {
  it("uses review mode only when explicitly enabled", () => {
    expect(getFeatureSplitMode({ PLAN_FEATURE_SPLIT_MODE: "review" })).toBe(
      "review",
    );
    expect(getFeatureSplitMode({ PLAN_FEATURE_SPLIT_MODE: "off" })).toBe(
      "off",
    );
    expect(getFeatureSplitMode({ PLAN_FEATURE_SPLIT_MODE: "unexpected" })).toBe(
      "off",
    );
  });

  it("keeps the requested cumulative access in review mode", () => {
    const enabledByPlan: Record<EntitlementPlanKey, MenuFeatureKey[]> = {
      free: [
        "company_search",
        "guru_advisor",
        "recent_chats",
        "institutional_holdings",
        "stock_discovery",
      ],
      standard: [
        "company_search",
        "guru_advisor",
        "recent_chats",
        "institutional_holdings",
        "stock_discovery",
        "wide_research",
      ],
      pro: menuFeatures,
      beta: menuFeatures,
      internal: menuFeatures,
    };

    for (const planKey of Object.keys(enabledByPlan) as EntitlementPlanKey[]) {
      for (const featureKey of menuFeatures) {
        expect(
          isPlanFeatureEnabled(planKey, featureKey, "review"),
        ).toBe(enabledByPlan[planKey].includes(featureKey));
      }
    }
  });

  it("reopens all menu features when the temporary mode is off", () => {
    for (const planKey of ["free", "standard", "pro"] as EntitlementPlanKey[]) {
      for (const featureKey of menuFeatures) {
        expect(isPlanFeatureEnabled(planKey, featureKey, "off")).toBe(true);
      }
    }
  });
});
