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
  return { confirmTossBillingOperation: vi.fn(), TossBillingFlowError };
});

import { getAuthUser } from "@/lib/auth";
import { checkBillingMutationRateLimit } from "@/lib/billing/api-rate-limit";
import {
  confirmTossBillingOperation,
  TossBillingFlowError,
} from "@/lib/billing/toss-subscriptions";
import { POST } from "./route";

function request(body: unknown) {
  return new NextRequest("https://krwontology.com/api/billing/toss/confirm", {
    method: "POST",
    headers: { origin: "https://krwontology.com" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/billing/toss/confirm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
    } as Awaited<ReturnType<typeof getAuthUser>>);
    vi.mocked(checkBillingMutationRateLimit).mockResolvedValue(null);
  });

  it("confirms only the quoted operation and supplies the canonical origin", async () => {
    vi.mocked(confirmTossBillingOperation).mockResolvedValue({
      operationId: "operation-1",
      status: "awaiting_auth",
      checkout: {
        clientKey: "test_ck_123",
        customerKey: "customer-1",
        method: "CARD",
        successUrl: "https://krwontology.com/api/billing/toss/success",
        failUrl: "https://krwontology.com/api/billing/toss/fail",
      },
    });

    const response = await POST(request({ operationId: "operation-1" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      operationId: "operation-1",
      status: "awaiting_auth",
    });
    expect(confirmTossBillingOperation).toHaveBeenCalledWith({
      userId: "user-1",
      operationId: "operation-1",
      requestOrigin: "https://krwontology.com",
    });
  });

  it("rejects an empty operation ID before any provider action", async () => {
    const response = await POST(request({ operationId: "" }));

    expect(response.status).toBe(400);
    expect(confirmTossBillingOperation).not.toHaveBeenCalled();
  });

  it("returns a state-change conflict instead of confirming a stale quote", async () => {
    vi.mocked(confirmTossBillingOperation).mockRejectedValue(
      new TossBillingFlowError(
        "billing_state_changed",
        "구독 상태가 바뀌어 금액을 다시 확인해야 합니다.",
        409,
      ),
    );

    const response = await POST(request({ operationId: "operation-1" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "billing_state_changed" },
    });
  });
});
