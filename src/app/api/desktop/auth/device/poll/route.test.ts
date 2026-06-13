import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/desktop/device-auth", () => ({
  pollDesktopDeviceLogin: vi.fn(),
}));

import { pollDesktopDeviceLogin } from "@/lib/desktop/device-auth";
import { POST } from "./route";

describe("POST /api/desktop/auth/device/poll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pollDesktopDeviceLogin).mockResolvedValue({
      ok: true,
      status: "complete",
      account: { user_id: "user-1", email: null },
      device: { id: "device-1", name: "MacBook", status: "active" },
      tokens: {
        desktop_access_token: "access-token",
        desktop_refresh_token: "refresh-token",
        expires_at: "2026-06-10T12:15:00.000Z",
        refresh_expires_at: "2026-09-08T12:00:00.000Z",
      },
    });
  });

  it("polls a desktop device code and returns tokens when complete", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/desktop/auth/device/poll", {
        method: "POST",
        body: JSON.stringify({ device_code: "device-code" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      status: "complete",
      tokens: {
        desktop_access_token: "access-token",
        desktop_refresh_token: "refresh-token",
      },
    });
    expect(pollDesktopDeviceLogin).toHaveBeenCalledWith("device-code");
  });

  it("rejects missing device_code", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/desktop/auth/device/poll", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      error: { code: "authentication_error" },
    });
    expect(pollDesktopDeviceLogin).not.toHaveBeenCalled();
  });
});
