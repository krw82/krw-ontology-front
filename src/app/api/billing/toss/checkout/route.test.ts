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
    startTossBillingCheckout: vi.fn(),
    TossBillingFlowError,
  };
});
vi.mock("@/lib/billing/api-rate-limit", () => ({
  checkBillingMutationRateLimit: vi.fn(),
}));

import { getAuthUser } from "@/lib/auth";
import { checkBillingMutationRateLimit } from "@/lib/billing/api-rate-limit";
import {
  startTossBillingCheckout,
  TossBillingFlowError,
} from "@/lib/billing/toss-subscriptions";
import { POST } from "./route";

describe("POST /api/billing/toss/checkout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
    } as Awaited<ReturnType<typeof getAuthUser>>);
    vi.mocked(checkBillingMutationRateLimit).mockResolvedValue(null);
  });

  it("starts a Toss checkout for the authenticated user", async () => {
    vi.mocked(startTossBillingCheckout).mockResolvedValue({
      clientKey: "test_ck_123",
      customerKey: "customer-1",
      method: "CARD",
      successUrl: "https://krwontology.com/api/billing/toss/success",
      failUrl: "https://krwontology.com/api/billing/toss/fail",
      sessionId: "session-1",
      plan: {
        key: "standard",
        label: "Standard",
        amountKrw: 7_900,
        orderName: "KRW Ontology Standard 월 구독",
      },
    });

    const response = await POST(
      new Request("https://krwontology.com/api/billing/toss/checkout", {
        method: "POST",
        body: JSON.stringify({ planKey: "standard" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sessionId).toBe("session-1");
    expect(startTossBillingCheckout).toHaveBeenCalledWith({
      userId: "user-1",
      planKey: "standard",
      requestOrigin: "https://krwontology.com",
    });
  });

  it("returns billing flow errors with their status", async () => {
    vi.mocked(startTossBillingCheckout).mockRejectedValue(
      new TossBillingFlowError(
        "billing_provider_not_configured",
        "결제 준비 중입니다.",
        503,
      ),
    );

    const response = await POST(
      new Request("https://krwontology.com/api/billing/toss/checkout", {
        method: "POST",
        body: JSON.stringify({ planKey: "pro" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.error.code).toBe("billing_provider_not_configured");
  });

  it("rejects invalid JSON before starting checkout", async () => {
    const response = await POST(
      new Request("https://krwontology.com/api/billing/toss/checkout", {
        method: "POST",
        body: "{",
      }),
    );

    expect(response.status).toBe(400);
    expect(startTossBillingCheckout).not.toHaveBeenCalled();
  });

  it("stops before starting checkout when rate limited", async () => {
    vi.mocked(checkBillingMutationRateLimit).mockResolvedValue(
      Response.json({ error: { code: "rate_limited" } }, { status: 429 }),
    );

    const response = await POST(
      new Request("https://krwontology.com/api/billing/toss/checkout", {
        method: "POST",
        body: JSON.stringify({ planKey: "standard" }),
      }),
    );

    expect(response.status).toBe(429);
    expect(startTossBillingCheckout).not.toHaveBeenCalled();
  });
});
