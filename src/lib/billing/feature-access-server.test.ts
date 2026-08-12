import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EntitlementStatus } from "@/types/entitlement";

vi.mock("server-only", () => ({}));
vi.mock("./entitlement", () => ({
  getEntitlementStatus: vi.fn(),
}));

import { getEntitlementStatus } from "./entitlement";
import { requireMenuFeatureAccess } from "./feature-access-server";

const originalFeatureSplitMode = process.env.PLAN_FEATURE_SPLIT_MODE;

function entitlement(researchNotebookEnabled: boolean): EntitlementStatus {
  return {
    features: [
      {
        key: "research_notebook",
        label: "리서치 노트북",
        description: "기업별 판단을 관리합니다.",
        enabled: researchNotebookEnabled,
        required_plan: "pro",
      },
    ],
  } as EntitlementStatus;
}

describe("server menu feature access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PLAN_FEATURE_SPLIT_MODE = "review";
  });

  afterEach(() => {
    if (originalFeatureSplitMode === undefined) {
      delete process.env.PLAN_FEATURE_SPLIT_MODE;
    } else {
      process.env.PLAN_FEATURE_SPLIT_MODE = originalFeatureSplitMode;
    }
  });

  it("returns a Pro upgrade response when a Free user calls a notebook API directly", async () => {
    vi.mocked(getEntitlementStatus).mockResolvedValue(entitlement(false));

    const response = await requireMenuFeatureAccess(
      "user-1",
      "free@example.com",
      "research_notebook",
    );

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toEqual({
      error: {
        code: "forbidden",
        message: "리서치 노트북은 Pro 플랜부터 사용할 수 있습니다.",
      },
    });
  });

  it("allows Pro users to use notebook APIs", async () => {
    vi.mocked(getEntitlementStatus).mockResolvedValue(entitlement(true));

    await expect(
      requireMenuFeatureAccess(
        "user-1",
        "pro@example.com",
        "research_notebook",
      ),
    ).resolves.toBeNull();
  });

  it("keeps feature enforcement disabled until review mode is enabled", async () => {
    process.env.PLAN_FEATURE_SPLIT_MODE = "off";

    await expect(
      requireMenuFeatureAccess(
        "user-1",
        "free@example.com",
        "research_notebook",
      ),
    ).resolves.toBeNull();
    expect(getEntitlementStatus).not.toHaveBeenCalled();
  });
});
