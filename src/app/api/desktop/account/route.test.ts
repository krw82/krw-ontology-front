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

import { authenticateDesktopRequest } from "@/lib/desktop/auth";
import { GET } from "./route";

describe("GET /api/desktop/account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateDesktopRequest).mockResolvedValue({
      userId: "user-1",
      userEmail: "user@example.test",
      deviceId: "device-1",
      authMethod: "supabase_bearer",
    });
  });

  it("returns the authenticated desktop account and device context", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/desktop/account", {
        headers: { authorization: "Bearer token" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      account: {
        user_id: "user-1",
        email: "user@example.test",
      },
      device: {
        id: "device-1",
        auth_method: "supabase_bearer",
      },
    });
  });
});
