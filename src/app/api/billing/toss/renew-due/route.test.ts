import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/billing/toss-subscriptions", () => ({
  renewDueTossSubscriptions: vi.fn(),
}));

import { renewDueTossSubscriptions } from "@/lib/billing/toss-subscriptions";
import { POST } from "./route";

describe("POST /api/billing/toss/renew-due", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("BILLING_CRON_SECRET", "cron-secret");
    vi.mocked(renewDueTossSubscriptions).mockResolvedValue({
      checked: 1,
      renewed: 1,
      failed: 0,
      expired: 0,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects requests without the cron secret", async () => {
    const response = await POST(
      new Request("https://krwontology.com/api/billing/toss/renew-due", {
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect(renewDueTossSubscriptions).not.toHaveBeenCalled();
  });

  it("runs due renewals when authorized with bearer auth", async () => {
    const response = await POST(
      new Request("https://krwontology.com/api/billing/toss/renew-due", {
        method: "POST",
        headers: { authorization: "Bearer cron-secret" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.renewed).toBe(1);
    expect(renewDueTossSubscriptions).toHaveBeenCalledTimes(1);
  });

  it("runs due renewals when authorized with the fallback header", async () => {
    const response = await POST(
      new Request("https://krwontology.com/api/billing/toss/renew-due", {
        method: "POST",
        headers: { "x-billing-cron-secret": "cron-secret" },
      }),
    );

    expect(response.status).toBe(200);
    expect(renewDueTossSubscriptions).toHaveBeenCalledTimes(1);
  });

  it("does not allow cron access when no secret is configured", async () => {
    vi.stubEnv("BILLING_CRON_SECRET", "");

    const response = await POST(
      new Request("https://krwontology.com/api/billing/toss/renew-due", {
        method: "POST",
        headers: { authorization: "Bearer cron-secret" },
      }),
    );

    expect(response.status).toBe(403);
    expect(renewDueTossSubscriptions).not.toHaveBeenCalled();
  });

  it("returns a stable 500 response when renewal processing fails", async () => {
    vi.mocked(renewDueTossSubscriptions).mockRejectedValue(
      new Error("database unavailable"),
    );

    const response = await POST(
      new Request("https://krwontology.com/api/billing/toss/renew-due", {
        method: "POST",
        headers: { authorization: "Bearer cron-secret" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error.code).toBe("billing_renewal_failed");
  });
});
