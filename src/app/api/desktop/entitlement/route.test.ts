import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/desktop/auth", () => ({
  authenticateDesktopRequest: vi.fn(),
  requireDesktopEntitlement: vi.fn(),
  DesktopAuthError: class DesktopAuthError extends Error {
    code = "authentication_error";
    publicMessage = "로그인이 필요합니다.";
    status = 401;
    retryable = false;
  },
}));

import {
  authenticateDesktopRequest,
  requireDesktopEntitlement,
} from "@/lib/desktop/auth";
import { GET } from "./route";

describe("GET /api/desktop/entitlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateDesktopRequest).mockResolvedValue({
      userId: "user-1",
      userEmail: "user@example.test",
      deviceId: "device-1",
      authMethod: "desktop_access_token",
    });
    vi.mocked(requireDesktopEntitlement).mockResolvedValue({
      usage: {
        can_run: true,
      },
      plan: {
        key: "free",
      },
    } as never);
  });

  it("returns the entitlement status used by Desktop doctor checks", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/desktop/entitlement", {
        headers: { authorization: "Bearer token" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      entitlement: {
        usage: {
          can_run: true,
        },
        plan: {
          key: "free",
        },
      },
    });
    expect(requireDesktopEntitlement).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
    );
  });
});
