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
vi.mock("@/lib/filing-notifications/request", () => ({
  invalidOriginResponse: vi.fn(() =>
    Response.json({ error: { code: "invalid_origin" } }, { status: 403 }),
  ),
  isExpectedMutationOrigin: vi.fn(() => true),
}));
vi.mock("@/lib/billing/toss-subscriptions", () => {
  class TossBillingFlowError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(code: string, message: string, status = 400) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
  return { cancelTossBillingOperation: vi.fn(), TossBillingFlowError };
});

import { getAuthUser } from "@/lib/auth";
import { checkBillingMutationRateLimit } from "@/lib/billing/api-rate-limit";
import {
  cancelTossBillingOperation,
  TossBillingFlowError,
} from "@/lib/billing/toss-subscriptions";
import { POST } from "./route";

function request() {
  return new NextRequest(
    "https://krwontology.com/api/billing/toss/operations/operation-1/cancel",
    {
      method: "POST",
      headers: { origin: "https://krwontology.com" },
    },
  );
}

const context = { params: Promise.resolve({ operationId: "operation-1" }) };

describe("POST /api/billing/toss/operations/[operationId]/cancel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
    } as Awaited<ReturnType<typeof getAuthUser>>);
    vi.mocked(checkBillingMutationRateLimit).mockResolvedValue(null);
  });

  it("cancels only the authenticated buyer's unstarted operation", async () => {
    const response = await POST(request(), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      operationId: "operation-1",
      status: "cancelled",
    });
    expect(cancelTossBillingOperation).toHaveBeenCalledWith({
      userId: "user-1",
      operationId: "operation-1",
    });
  });

  it("does not mask a payment-in-progress conflict as a cancellation", async () => {
    vi.mocked(cancelTossBillingOperation).mockRejectedValue(
      new TossBillingFlowError(
        "billing_operation_not_cancellable",
        "이미 결제 결과를 확인하고 있어 취소할 수 없습니다.",
        409,
      ),
    );

    const response = await POST(request(), context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "billing_operation_not_cancellable" },
    });
  });
});
