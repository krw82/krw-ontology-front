import { beforeEach, describe, expect, it, vi } from "vitest";
import { reserveExecutionBudget } from "@/lib/concurrency/execution-budget";
import { reserveBudgetStep } from "./check-budget";

vi.mock("@/lib/concurrency/execution-budget", () => ({
  reserveExecutionBudget: vi.fn(),
}));

async function json(response: Response) {
  return response.json() as Promise<{
    error?: { code: string; message: string };
    request_id?: string;
  }>;
}

describe("reserveBudgetStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns reserved execution budget when allowed", async () => {
    vi.mocked(reserveExecutionBudget).mockResolvedValue({
      allowed: true,
      reservationId: "reservation-1",
      budgetUsedUsd: 0.5,
      budgetReservedUsd: 0.25,
      budgetLimitUsd: 2,
      dailyBudgetUsedUsd: 0.1,
      dailyBudgetReservedUsd: 0.25,
      dailyBudgetLimitUsd: 0.5,
      reserveCostUsd: 0.25,
      runCount: 2,
    });

    const result = await reserveBudgetStep("user-1", "req-1");

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.budget.reservationId).toBe("reservation-1");
  });

  it("maps internal budget failures to a 500 response", async () => {
    vi.mocked(reserveExecutionBudget).mockResolvedValue({
      allowed: false,
      reason: "internal_error",
      budgetUsedUsd: 0,
      budgetReservedUsd: 0,
      budgetLimitUsd: 0,
      dailyBudgetUsedUsd: 0,
      dailyBudgetReservedUsd: 0,
      dailyBudgetLimitUsd: 0,
      reserveCostUsd: 0,
      runCount: 0,
    });

    const result = await reserveBudgetStep("user-1", "req-1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(500);
    expect(await json(result.response)).toEqual({
      error: {
        code: "internal_error",
        message: "분석 크레딧 정보를 확인하지 못했습니다.",
      },
      request_id: "req-1",
    });
  });

  it("maps exhausted execution budget to a 429 response", async () => {
    vi.mocked(reserveExecutionBudget).mockResolvedValue({
      allowed: false,
      reason: "cost_cap_exceeded",
      budgetUsedUsd: 2,
      budgetReservedUsd: 0,
      budgetLimitUsd: 2,
      dailyBudgetUsedUsd: 0.5,
      dailyBudgetReservedUsd: 0,
      dailyBudgetLimitUsd: 0.5,
      reserveCostUsd: 0.25,
      runCount: 8,
    });

    const result = await reserveBudgetStep("user-1", "req-1");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(await json(result.response)).toMatchObject({
      error: {
        code: "cost_cap_exceeded",
        message: "사용할 수 있는 분석 크레딧을 모두 사용했습니다.",
      },
    });
  });
});
