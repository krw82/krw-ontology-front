import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/desktop/device-auth", () => ({
  startDesktopDeviceLogin: vi.fn(),
}));

import { startDesktopDeviceLogin } from "@/lib/desktop/device-auth";
import { POST } from "./route";

describe("POST /api/desktop/auth/device/start", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
      platform: "darwin",
      arch: "arm64",
      appVersion: "0.1.0",
      protocolVersion: "desktop/v1",
    });
  });
});
