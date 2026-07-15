import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/rate-limit", () => ({
  checkDurableRateLimits: vi.fn(),
  readPositiveIntEnv: vi.fn((_name: string, fallback: number) => fallback),
}));
vi.mock("@/lib/analytics/server", () => ({
  recordAnalyticsEventFromRequest: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ getAuthUser: vi.fn() }));

import { checkDurableRateLimits } from "@/lib/api/rate-limit";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { getAuthUser } from "@/lib/auth";
import { POST } from "./route";

describe("POST /api/analytics/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkDurableRateLimits).mockResolvedValue({ ok: true });
    vi.mocked(recordAnalyticsEventFromRequest).mockResolvedValue({ ok: true });
    vi.mocked(getAuthUser).mockResolvedValue(null);
  });

  it("derives an authenticated analytics identity from the session", async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ id: "user-1" } as Awaited<ReturnType<typeof getAuthUser>>);
    const request = new NextRequest("https://app.example.com/api/analytics/events", {
      method: "POST",
      body: JSON.stringify({ event_name: "pulse_viewed", anonymous_id: "anon-1" }),
    });

    expect((await POST(request)).status).toBe(200);
    expect(recordAnalyticsEventFromRequest).toHaveBeenCalledWith(request, expect.objectContaining({ userId: "user-1" }));
  });

  it("records public analytics without trusting object reference ids", async () => {
    const request = new NextRequest("https://app.example.com/api/analytics/events", {
      method: "POST",
      body: JSON.stringify({
        event_name: "cta_clicked",
        anonymous_id: "anon-1",
        session_id: "session-1",
        message_id: "message-1",
        run_id: "run-1",
        properties: { location: "pricing" },
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(recordAnalyticsEventFromRequest).toHaveBeenCalledWith(request, {
      eventName: "cta_clicked",
      userId: null,
      anonymousId: "anon-1",
      properties: { location: "pricing" },
      path: null,
      referrer: null,
      utm: null,
      sessionId: null,
      messageId: null,
      runId: null,
    });
  });

  it("rate limits public analytics writes", async () => {
    vi.mocked(checkDurableRateLimits).mockResolvedValue({
      ok: false,
      status: 429,
      code: "rate_limited",
      retryAfterSeconds: 30,
    });

    const response = await POST(
      new NextRequest("https://app.example.com/api/analytics/events", {
        method: "POST",
        body: JSON.stringify({
          event_name: "cta_clicked",
          anonymous_id: "anon-1",
        }),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(recordAnalyticsEventFromRequest).not.toHaveBeenCalled();
  });
});
