import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/billing/toss-subscriptions", () => ({
  markTossBillingOperationCallbackFailed: vi.fn(),
}));

import { markTossBillingOperationCallbackFailed } from "@/lib/billing/toss-subscriptions";
import { GET } from "./route";

describe("GET /api/billing/toss/fail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_REDIRECT_ORIGIN", "https://krwontology.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("records a token-verified failure and keeps provider text out of the redirect URL", async () => {
    vi.mocked(markTossBillingOperationCallbackFailed).mockResolvedValue(
      "operation-1",
    );
    const response = await GET(
      new NextRequest(
        "https://0.0.0.0:3000/api/billing/toss/fail?sessionId=session-1&callbackToken=callback-token&code=PAY_PROCESS_CANCELED&message=%EA%B2%B0%EC%A0%9C%EB%A5%BC%20%EC%B7%A8%EC%86%8C%ED%96%88%EC%8A%B5%EB%8B%88%EB%8B%A4.",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://krwontology.com/settings/billing?operation=operation-1",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(markTossBillingOperationCallbackFailed).toHaveBeenCalledWith({
      sessionId: "session-1",
      callbackToken: "callback-token",
      code: "PAY_PROCESS_CANCELED",
    });
  });
});
