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
vi.mock("@/lib/dev-auth-runtime", () => ({
  E2E_AUTH_HEADER: "x-krw-e2e-auth",
  isDevAuthBypassEnabledForHost: vi.fn(),
}));

import { checkDurableRateLimits } from "@/lib/api/rate-limit";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { getAuthUser } from "@/lib/auth";
import { isDevAuthBypassEnabledForHost } from "@/lib/dev-auth-runtime";
import { POST } from "./route";

describe("POST /api/analytics/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkDurableRateLimits).mockResolvedValue({ ok: true });
    vi.mocked(recordAnalyticsEventFromRequest).mockResolvedValue({ ok: true });
    vi.mocked(getAuthUser).mockResolvedValue(null);
    vi.mocked(isDevAuthBypassEnabledForHost).mockReturnValue(false);
  });

  it("uses a no-op sink for an approved local dev/E2E auth request", async () => {
    vi.mocked(isDevAuthBypassEnabledForHost).mockReturnValue(true);
    const request = new NextRequest("http://127.0.0.1/api/analytics/events", {
      method: "POST",
      headers: { "x-krw-e2e-auth": "test-token" },
      body: JSON.stringify({ event_name: "pulse_viewed", anonymous_id: "anon-1" }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(checkDurableRateLimits).not.toHaveBeenCalled();
    expect(getAuthUser).not.toHaveBeenCalled();
    expect(recordAnalyticsEventFromRequest).not.toHaveBeenCalled();
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

  it("rejects browser-forged authoritative decision outcomes", async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ id: "user-1" } as Awaited<ReturnType<typeof getAuthUser>>);
    const response = await POST(
      new NextRequest("https://app.example.com/api/analytics/events", {
        method: "POST",
        body: JSON.stringify({
          event_name: "coverage_activated",
          properties: { coverage_count: 99 },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(recordAnalyticsEventFromRequest).not.toHaveBeenCalled();
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
