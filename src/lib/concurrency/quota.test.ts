import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEntitlementStatus } from "@/lib/billing/entitlement";
import { checkQuota, getQuotaStatus } from "./quota";
import type { EntitlementStatus } from "@/types/entitlement";

vi.mock("@/lib/billing/entitlement", () => ({
  getEntitlementStatus: vi.fn(),
}));

function entitlement(overrides: Partial<EntitlementStatus["usage"]>): EntitlementStatus {
  return {
    plan: {
      key: "free",
      label: "Free",
      status_label: "무료",
      description: "Free plan",
    },
    usage: {
      period: "monthly",
      period_label: "이번 달",
      period_start: "2026-05-01T00:00:00.000Z",
      period_end: "2026-06-01T00:00:00.000Z",
      questions_used: 2,
      questions_limit: 10,
      remaining_questions: 8,
      percent_used: 20,
      alert_level: "ok",
      can_run: true,
      resets_at: "2026-06-01T00:00:00.000Z",
      ...overrides,
    },
    features: [],
    upgrade: {
      label: "플랜 확인",
      href: "/settings/billing",
      enabled: false,
      title: "현재 플랜으로 사용할 수 있습니다.",
      message: "사용량이 안정 범위 안에 있습니다.",
    },
  };
}

describe("quota", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows runs while monthly entitlement has remaining questions", async () => {
    vi.mocked(getEntitlementStatus).mockResolvedValue(entitlement({}));

    const result = await checkQuota("user-1");

    expect(result.allowed).toBe(true);
    expect(result.questionsUsed).toBe(2);
    expect(result.questionsLimit).toBe(10);
  });

  it("blocks runs when monthly entitlement is exhausted", async () => {
    vi.mocked(getEntitlementStatus).mockResolvedValue(
      entitlement({
        questions_used: 10,
        remaining_questions: 0,
        percent_used: 100,
        alert_level: "blocked",
        can_run: false,
      }),
    );

    const result = await checkQuota("user-1");

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("quota_exceeded");
    expect(result.questionsUsed).toBe(10);
  });

  it("formats legacy quota payload with monthly plan limits", () => {
    expect(
      getQuotaStatus(9, 0, 0.1, {
        questionsLimit: 10,
        costLimit: 5,
      }),
    ).toMatchObject({
      questions_used_today: 10,
      questions_limit: 10,
      remaining_questions: 0,
    });
  });
});
