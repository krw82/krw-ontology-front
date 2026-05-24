import { beforeEach, describe, expect, it, vi } from "vitest";
import { getEntitlementStatus } from "@/lib/billing/entitlement";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { EntitlementStatus } from "@/types/entitlement";
import {
  checkExecutionBudget,
  getExecutionBudgetStatus,
  reserveExecutionBudget,
} from "./execution-budget";

vi.mock("@/lib/billing/entitlement", () => ({
  getEntitlementStatus: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

function entitlement(
  overrides: Partial<EntitlementStatus["usage"]> = {},
): EntitlementStatus {
  return {
    status: "standard",
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
      budget_used_usd: 0.5,
      budget_reserved_usd: 0,
      budget_limit_usd: 2,
      remaining_budget_usd: 1.5,
      daily_budget_used_usd: 0.1,
      daily_budget_reserved_usd: 0,
      daily_budget_limit_usd: 0.5,
      per_run_reserve_usd: 0.25,
      analysis_credits_used: 500,
      analysis_credits_reserved: 0,
      analysis_credits_limit: 2000,
      remaining_analysis_credits: 1500,
      daily_analysis_credits_used: 100,
      daily_analysis_credits_reserved: 0,
      daily_analysis_credits_limit: 500,
      per_run_analysis_credits: 250,
      run_count: 2,
      percent_used: 25,
      alert_level: "ok",
      can_run: true,
      unlimited: false,
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

describe("execution budget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows runs while execution budget can reserve another run", async () => {
    vi.mocked(getEntitlementStatus).mockResolvedValue(entitlement());

    const result = await checkExecutionBudget("user-1");

    expect(result.allowed).toBe(true);
    expect(result.budgetUsedUsd).toBe(0.5);
    expect(result.reserveCostUsd).toBe(0.25);
  });

  it("blocks runs when remaining execution budget is below reserve", async () => {
    vi.mocked(getEntitlementStatus).mockResolvedValue(
      entitlement({
        budget_used_usd: 1.9,
        remaining_budget_usd: 0.1,
        alert_level: "blocked",
        can_run: false,
      }),
    );

    const result = await checkExecutionBudget("user-1");

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("cost_cap_exceeded");
  });

  it("reserves execution budget through the durable RPC", async () => {
    vi.mocked(getEntitlementStatus).mockResolvedValue(entitlement());
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          allowed: true,
          reason: null,
          reservation_id: "reservation-1",
          monthly_used_usd: 0.5,
          monthly_reserved_usd: 0.25,
          monthly_limit_usd: 2,
          daily_used_usd: 0.1,
          daily_reserved_usd: 0.25,
          daily_limit_usd: 0.5,
        },
      ],
      error: null,
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue({ rpc } as never);

    const result = await reserveExecutionBudget("user-1", "req-1");

    expect(result.allowed).toBe(true);
    expect(result.reservationId).toBe("reservation-1");
    expect(result.budgetReservedUsd).toBe(0.25);
    expect(rpc).toHaveBeenCalledWith(
      "reserve_execution_budget",
      expect.objectContaining({
        p_user_id: "user-1",
        p_request_id: "req-1",
        p_monthly_budget_usd: 2,
        p_daily_budget_usd: 2,
        p_reserve_cost_usd: 0.25,
      }),
    );
  });

  it("formats settled execution budget after a run completes", () => {
    expect(
      getExecutionBudgetStatus(
        {
          budgetUsedUsd: 0.5,
          budgetReservedUsd: 0.25,
          budgetLimitUsd: 2,
          dailyBudgetUsedUsd: 0.1,
          dailyBudgetReservedUsd: 0.25,
          dailyBudgetLimitUsd: 0.5,
          reserveCostUsd: 0.25,
          runCount: 2,
        },
        0.12,
      ),
    ).toMatchObject({
      budget_used_usd: 0.62,
      budget_reserved_usd: 0,
      remaining_budget_usd: 1.38,
      daily_budget_used_usd: 0.22,
      daily_budget_reserved_usd: 0,
      analysis_credits_used: 620,
      analysis_credits_reserved: 0,
      analysis_credits_limit: 2000,
      remaining_analysis_credits: 1380,
      daily_analysis_credits_used: 220,
      daily_analysis_credits_reserved: 0,
      daily_analysis_credits_limit: 500,
      run_count: 3,
      can_run: true,
    });
  });
});
