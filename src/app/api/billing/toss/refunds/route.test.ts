import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  handleAuthError: vi.fn(() =>
    Response.json({ error: { code: "unauthorized" } }, { status: 401 }),
  ),
}));
vi.mock("@/lib/billing/api-rate-limit", () => ({
  checkBillingMutationRateLimit: vi.fn(),
}));
vi.mock("@/lib/billing/toss-refunds", () => ({
  requestTossAutoRefund: vi.fn(),
}));
vi.mock("@/lib/filing-notifications/request", () => ({
  invalidOriginResponse: vi.fn(() =>
    Response.json({ error: { code: "invalid_origin" } }, { status: 403 }),
  ),
  isExpectedMutationOrigin: vi.fn(() => true),
}));

import { getAuthUser } from "@/lib/auth";
import { checkBillingMutationRateLimit } from "@/lib/billing/api-rate-limit";
import { TossBillingFlowError } from "@/lib/billing/toss-billing-error";
import { requestTossAutoRefund } from "@/lib/billing/toss-refunds";
import { isExpectedMutationOrigin } from "@/lib/filing-notifications/request";
import { POST } from "./route";

const paymentId = "11111111-1111-4111-8111-111111111111";

function request(body: unknown) {
  return new NextRequest("https://krwontology.com/api/billing/toss/refunds", {
    method: "POST",
    headers: { origin: "https://krwontology.com" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/billing/toss/refunds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      email: "user@example.test",
    } as Awaited<ReturnType<typeof getAuthUser>>);
    vi.mocked(checkBillingMutationRateLimit).mockResolvedValue(null);
    vi.mocked(isExpectedMutationOrigin).mockReturnValue(true);
  });

  it("starts a refund only for the authenticated user and a valid payment id", async () => {
    vi.mocked(requestTossAutoRefund).mockResolvedValue({
      refundId: "33333333-3333-4333-8333-333333333333",
      status: "succeeded",
    });

    const response = await POST(request({ paymentId }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      refundId: "33333333-3333-4333-8333-333333333333",
      status: "succeeded",
    });
    expect(checkBillingMutationRateLimit).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      "refund",
    );
    expect(requestTossAutoRefund).toHaveBeenCalledWith({
      userId: "22222222-2222-4222-8222-222222222222",
      paymentId,
    });
  });

  it("rejects malformed payment identifiers before the refund flow", async () => {
    const response = await POST(request({ paymentId: "not-a-uuid" }));

    expect(response.status).toBe(400);
    expect(requestTossAutoRefund).not.toHaveBeenCalled();
  });

  it("returns the safe eligibility reason from the refund domain", async () => {
    vi.mocked(requestTossAutoRefund).mockRejectedValue(
      new TossBillingFlowError(
        "auto_refund_paid_usage_exists",
        "이 결제 후 유료 분석을 실행해 자동 환불 대상이 아닙니다.",
        409,
      ),
    );

    const response = await POST(request({ paymentId }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "auto_refund_paid_usage_exists" },
    });
  });

  it("rejects requests outside the expected origin", async () => {
    vi.mocked(isExpectedMutationOrigin).mockReturnValue(false);

    const response = await POST(request({ paymentId }));

    expect(response.status).toBe(403);
    expect(requestTossAutoRefund).not.toHaveBeenCalled();
  });
});
