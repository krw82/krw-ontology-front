import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/desktop/device-auth", () => ({
  refreshDesktopTokens: vi.fn(),
}));

import { refreshDesktopTokens } from "@/lib/desktop/device-auth";
import { POST } from "./route";

describe("POST /api/desktop/auth/refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(refreshDesktopTokens).mockResolvedValue({
      desktop_access_token: "fresh-access",
      desktop_refresh_token: "fresh-refresh",
      expires_at: "2026-06-10T12:15:00.000Z",
      refresh_expires_at: "2026-09-08T12:00:00.000Z",
    });
  });

  it("rotates desktop access and refresh tokens", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/desktop/auth/refresh", {
        method: "POST",
        body: JSON.stringify({
          device_id: "device-1",
          desktop_refresh_token: "refresh-token",
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      desktop_access_token: "fresh-access",
      desktop_refresh_token: "fresh-refresh",
    });
    expect(refreshDesktopTokens).toHaveBeenCalledWith({
      deviceId: "device-1",
      refreshToken: "refresh-token",
    });
  });
});
