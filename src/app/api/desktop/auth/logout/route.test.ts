import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/desktop/auth", () => ({
  authenticateDesktopRequest: vi.fn(),
  DesktopAuthError: class DesktopAuthError extends Error {
    code = "authentication_error";
    publicMessage = "로그인이 필요합니다.";
    status = 401;
    retryable = false;
  },
}));
vi.mock("@/lib/desktop/device-auth", () => ({
  revokeDesktopDevice: vi.fn(),
}));

import { authenticateDesktopRequest } from "@/lib/desktop/auth";
import { revokeDesktopDevice } from "@/lib/desktop/device-auth";
import { POST } from "./route";

describe("POST /api/desktop/auth/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateDesktopRequest).mockResolvedValue({
      userId: "user-1",
      userEmail: null,
      deviceId: "device-1",
      authMethod: "desktop_access_token",
    });
    vi.mocked(revokeDesktopDevice).mockResolvedValue({ ok: true });
  });

  it("revokes the authenticated desktop device", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/desktop/auth/logout", {
        method: "POST",
        headers: { authorization: "Bearer access-token" },
        body: JSON.stringify({ device_id: "device-1" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(revokeDesktopDevice).toHaveBeenCalledWith({
      auth: expect.objectContaining({ userId: "user-1" }),
      deviceId: "device-1",
    });
  });
});
