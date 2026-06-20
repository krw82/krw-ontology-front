import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/api/rate-limit", () => ({
  checkDurableRateLimits: vi.fn(),
  readPositiveIntEnv: vi.fn((_name: string, fallback: number) => fallback),
}));
vi.mock("@/lib/desktop/device-auth", () => ({
  startDesktopDeviceLogin: vi.fn(),
}));

import { checkDurableRateLimits } from "@/lib/api/rate-limit";
import { startDesktopDeviceLogin } from "@/lib/desktop/device-auth";
import { POST } from "./route";

describe("POST /api/desktop/auth/device/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkDurableRateLimits).mockResolvedValue({ ok: true });
    vi.mocked(startDesktopDeviceLogin).mockResolvedValue({
      ok: true,
      device_code: "device-code",
      user_code: "ABCD-1234",
      login_url: "https://krwontology.com/login?desktop_code=ABCD-1234",
      verification_uri: "https://krwontology.com/login?desktop_code=ABCD-1234",
      expires_at: "2026-06-10T12:10:00.000Z",
      poll_interval_ms: 2000,
    });
  });

  it("starts device login with app and protocol metadata", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/desktop/auth/device/start", {
        method: "POST",
        body: JSON.stringify({
          device_name: "MacBook",
          installation_id: "installation-1",
          platform: "darwin",
          arch: "arm64",
          app_version: "0.1.0",
          protocol_version: "desktop/v1",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      device_code: "device-code",
      user_code: "ABCD-1234",
      poll_interval_ms: 2000,
    });
    expect(startDesktopDeviceLogin).toHaveBeenCalledWith({
      deviceName: "MacBook",
      installationId: "installation-1",
      platform: "darwin",
      arch: "arm64",
      appVersion: "0.1.0",
      protocolVersion: "desktop/v1",
    });
  });

  it("rate limits unauthenticated device login starts before creating a code", async () => {
    vi.mocked(checkDurableRateLimits).mockResolvedValue({
      ok: false,
      status: 429,
      code: "rate_limited",
      retryAfterSeconds: 42,
    });

    const response = await POST(
      new NextRequest("http://localhost/api/desktop/auth/device/start", {
        method: "POST",
        body: JSON.stringify({ device_name: "MacBook" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(body.error.code).toBe("rate_limited");
    expect(startDesktopDeviceLogin).not.toHaveBeenCalled();
  });
});
