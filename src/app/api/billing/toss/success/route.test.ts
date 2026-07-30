import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/billing/toss-subscriptions", () => ({
  completeTossBillingOperationCallback: vi.fn(),
  getTossBillingOperationIdForCallback: vi.fn(),
}));

import {
  completeTossBillingOperationCallback,
  getTossBillingOperationIdForCallback,
} from "@/lib/billing/toss-subscriptions";
import { GET } from "./route";

describe("GET /api/billing/toss/success", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("AUTH_REDIRECT_ORIGIN", "https://krwontology.com");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("completes by callback token without requiring a login cookie", async () => {
    vi.mocked(completeTossBillingOperationCallback).mockResolvedValue({
      operationId: "operation-1",
      status: "paid",
    });

    const response = await GET(
      new NextRequest(
        "https://0.0.0.0:3000/api/billing/toss/success?sessionId=session-1&callbackToken=callback-token&authKey=auth-key&customerKey=customer-1",
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://krwontology.com/settings/billing?operation=operation-1",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(completeTossBillingOperationCallback).toHaveBeenCalledWith({
      sessionId: "session-1",
      callbackToken: "callback-token",
      authKey: "auth-key",
      customerKey: "customer-1",
    });
  });

  it("redirects to the durable operation instead of a URL-only success banner", async () => {
    vi.mocked(completeTossBillingOperationCallback).mockRejectedValue(
      new Error("temporary callback failure"),
    );
    vi.mocked(getTossBillingOperationIdForCallback).mockResolvedValue(
      "operation-2",
    );

    const response = await GET(
      new NextRequest(
        "https://0.0.0.0:3000/api/billing/toss/success?sessionId=session-1&callbackToken=callback-token&authKey=auth-key&customerKey=customer-1",
      ),
    );

    expect(response.headers.get("location")).toBe(
      "https://krwontology.com/settings/billing?operation=operation-2",
    );
  });

  it("does not process a callback when production redirect origin is missing", async () => {
    vi.stubEnv("AUTH_REDIRECT_ORIGIN", "");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    vi.stubEnv("NODE_ENV", "production");

    const response = await GET(
      new NextRequest(
        "https://0.0.0.0:3000/api/billing/toss/success?sessionId=session-1&callbackToken=callback-token&authKey=auth-key&customerKey=customer-1",
      ),
    );

    expect(response.status).toBe(503);
    expect(completeTossBillingOperationCallback).not.toHaveBeenCalled();
  });
});
