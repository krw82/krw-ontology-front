import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  handleAuthError: vi.fn(() =>
    Response.json({ error: { code: "unauthorized" } }, { status: 401 }),
  ),
}));
vi.mock("@/lib/billing/toss-subscriptions", async () => {
  class TossBillingFlowError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(code: string, message: string, status = 400) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return {
    cancelCurrentTossSubscription: vi.fn(),
    TossBillingFlowError,
  };
});
vi.mock("@/lib/billing/api-rate-limit", () => ({
  checkBillingMutationRateLimit: vi.fn(),
}));

import { getAuthUser } from "@/lib/auth";
import { checkBillingMutationRateLimit } from "@/lib/billing/api-rate-limit";
import {
  cancelCurrentTossSubscription,
  TossBillingFlowError,
} from "@/lib/billing/toss-subscriptions";
import { POST } from "./route";

describe("POST /api/billing/toss/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
    } as Awaited<ReturnType<typeof getAuthUser>>);
    vi.mocked(checkBillingMutationRateLimit).mockResolvedValue(null);
  });

  it("schedules cancellation for the authenticated user's subscription", async () => {
    vi.mocked(cancelCurrentTossSubscription).mockResolvedValue({
      status: "pending_cancel",
      subscriptionId: "subscription-1",
      currentPeriodEnd: "2026-07-20T00:00:00.000Z",
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.subscriptionId).toBe("subscription-1");
    expect(cancelCurrentTossSubscription).toHaveBeenCalledWith("user-1");
  });

  it("returns billing flow errors with their status", async () => {
    vi.mocked(cancelCurrentTossSubscription).mockRejectedValue(
      new TossBillingFlowError(
        "subscription_missing",
        "해지할 활성 구독을 찾을 수 없습니다.",
        404,
      ),
    );

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("subscription_missing");
  });

  it("stops before cancellation when rate limited", async () => {
    vi.mocked(checkBillingMutationRateLimit).mockResolvedValue(
      Response.json({ error: { code: "rate_limited" } }, { status: 429 }),
    );

    const response = await POST();

    expect(response.status).toBe(429);
    expect(cancelCurrentTossSubscription).not.toHaveBeenCalled();
  });
});
