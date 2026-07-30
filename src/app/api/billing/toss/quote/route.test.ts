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
  return { prepareTossBillingOperation: vi.fn(), TossBillingFlowError };
});

import { getAuthUser } from "@/lib/auth";
import { checkBillingMutationRateLimit } from "@/lib/billing/api-rate-limit";
import {
  prepareTossBillingOperation,
  TossBillingFlowError,
} from "@/lib/billing/toss-subscriptions";
import { POST } from "./route";

function request(body: unknown) {
  return new NextRequest("https://krwontology.com/api/billing/toss/quote", {
    method: "POST",
    headers: { origin: "https://krwontology.com" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/billing/toss/quote", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
    } as Awaited<ReturnType<typeof getAuthUser>>);
    vi.mocked(checkBillingMutationRateLimit).mockResolvedValue(null);
  });

  it("creates a server-owned quote for the authenticated buyer", async () => {
    vi.mocked(prepareTossBillingOperation).mockResolvedValue({
      operationId: "operation-1",
      kind: "upgrade",
      fromPlanKey: "standard",
      targetPlanKey: "pro",
      chargedTodayKrw: 10_550,
      nextChargeKrw: 29_000,
      effectiveAt: "2026-07-30T00:00:00.000Z",
      nextBillingAt: "2026-08-20T00:00:00.000Z",
      expiresAt: "2026-07-30T00:30:00.000Z",
    });

    const response = await POST(request({ kind: "upgrade", targetPlanKey: "pro" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      operationId: "operation-1",
      chargedTodayKrw: 10_550,
    });
    expect(prepareTossBillingOperation).toHaveBeenCalledWith({
      userId: "user-1",
      kind: "upgrade",
      targetPlanKey: "pro",
    });
  });

  it("does not create a quote after a rate-limit rejection", async () => {
    vi.mocked(checkBillingMutationRateLimit).mockResolvedValue(
      Response.json({ error: { code: "rate_limited" } }, { status: 429 }),
    );

    const response = await POST(request({ kind: "subscribe", targetPlanKey: "standard" }));

    expect(response.status).toBe(429);
    expect(prepareTossBillingOperation).not.toHaveBeenCalled();
  });

  it("returns the durable-operation error without starting a charge", async () => {
    vi.mocked(prepareTossBillingOperation).mockRejectedValue(
      new TossBillingFlowError(
        "billing_state_changed",
        "구독 상태가 바뀌어 금액을 다시 확인해야 합니다.",
        409,
      ),
    );

    const response = await POST(request({ kind: "upgrade", targetPlanKey: "pro" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "billing_state_changed" },
    });
  });
});
