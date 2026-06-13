import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  handleAuthError: vi.fn((error: unknown) =>
    Response.json(
      {
        error: {
          code: "authentication_error",
          message: error instanceof Error ? error.message : "Auth failed",
        },
      },
      { status: 401 },
    ),
  ),
}));
vi.mock("@/lib/desktop/device-auth", () => ({
  approveDesktopDeviceLoginCode: vi.fn(),
}));

import { getAuthUser } from "@/lib/auth";
import { approveDesktopDeviceLoginCode } from "@/lib/desktop/device-auth";
import { POST } from "./route";

function request(body: unknown) {
  return new NextRequest("http://localhost/api/desktop/auth/device/approve", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/desktop/auth/device/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
    } as Awaited<ReturnType<typeof getAuthUser>>);
    vi.mocked(approveDesktopDeviceLoginCode).mockResolvedValue({ ok: true });
  });

  it("approves a desktop user code for the authenticated web user", async () => {
    const response = await POST(request({ user_code: "ABCD-1234" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(approveDesktopDeviceLoginCode).toHaveBeenCalledWith({
      userCode: "ABCD-1234",
      userId: "user-1",
    });
  });

  it("requires a logged-in web session", async () => {
    vi.mocked(getAuthUser).mockResolvedValue(null);

    const response = await POST(request({ user_code: "ABCD-1234" }));
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toMatchObject({
      error: {
        code: "authentication_error",
      },
    });
    expect(approveDesktopDeviceLoginCode).not.toHaveBeenCalled();
  });

  it("rejects missing user codes before service approval", async () => {
    const response = await POST(request({}));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      error: {
        code: "authentication_error",
      },
    });
    expect(approveDesktopDeviceLoginCode).not.toHaveBeenCalled();
  });
});
