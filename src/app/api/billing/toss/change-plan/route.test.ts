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
    changeCurrentTossPlan: vi.fn(),
    TossBillingFlowError,
  };
});
vi.mock("@/lib/billing/api-rate-limit", () => ({
  checkBillingMutationRateLimit: vi.fn(),
}));

import { getAuthUser } from "@/lib/auth";
import { checkBillingMutationRateLimit } from "@/lib/billing/api-rate-limit";
import {
  changeCurrentTossPlan,
  TossBillingFlowError,
} from "@/lib/billing/toss-subscriptions";
import { POST } from "./route";

describe("POST /api/billing/toss/change-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
    } as Awaited<ReturnType<typeof getAuthUser>>);
    vi.mocked(checkBillingMutationRateLimit).mockResolvedValue(null);
  });

  it("changes the authenticated user's paid plan", async () => {
    vi.mocked(changeCurrentTossPlan).mockResolvedValue({
      status: "upgraded",
      planKey: "pro",
      effectiveAt: "2026-06-20T00:00:00.000Z",
      chargedAmountKrw: 10_550,
    });

    const response = await POST(
      new Request("https://krwontology.com/api/billing/toss/change-plan", {
        method: "POST",
        body: JSON.stringify({ planKey: "pro" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(changeCurrentTossPlan).toHaveBeenCalledWith({
      userId: "user-1",
      targetPlanKey: "pro",
    });
  });

  it("returns the billing flow error status", async () => {
    vi.mocked(changeCurrentTossPlan).mockRejectedValue(
      new TossBillingFlowError(
        "subscription_not_changeable",
        "현재 상태에서는 플랜을 변경할 수 없습니다.",
        409,
      ),
    );

    const response = await POST(
      new Request("https://krwontology.com/api/billing/toss/change-plan", {
        method: "POST",
        body: JSON.stringify({ planKey: "standard" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("subscription_not_changeable");
  });

  it("stops before changing the plan when rate limited", async () => {
    vi.mocked(checkBillingMutationRateLimit).mockResolvedValue(
      Response.json(
        { error: { code: "rate_limited" } },
        { status: 429 },
      ),
    );

    const response = await POST(
      new Request("https://krwontology.com/api/billing/toss/change-plan", {
        method: "POST",
        body: JSON.stringify({ planKey: "pro" }),
      }),
    );

    expect(response.status).toBe(429);
    expect(changeCurrentTossPlan).not.toHaveBeenCalled();
  });
});
