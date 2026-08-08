import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getOptionalAuthUser: vi.fn(),
  getPulseFeedStatus: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getOptionalAuthUser: mocks.getOptionalAuthUser,
  ANONYMOUS_PULSE_USER_ID: "00000000-0000-0000-0000-000000000000",
  handleAuthError: () => Response.json({ error: { code: "authentication_error" } }, { status: 401 }),
}));
vi.mock("@/lib/pulse/status", () => ({ getPulseFeedStatus: mocks.getPulseFeedStatus }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => ({}) }));

import { GET } from "@/app/api/pulse/status/route";

describe("GET /api/pulse/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOptionalAuthUser.mockResolvedValue({ id: "user-1" });
    mocks.getPulseFeedStatus.mockResolvedValue({
      generated_at: "2026-07-17T00:00:00.000Z",
      revision: "p3.1.1.1",
      changed: false,
    });
  });

  it("degrades to an anonymous revision when no session is present", async () => {
    mocks.getOptionalAuthUser.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/pulse/status?revision=p3.1.1.1"));
    expect(response.status).toBe(200);
    expect(mocks.getPulseFeedStatus).toHaveBeenCalledWith(expect.objectContaining({
      userId: "00000000-0000-0000-0000-000000000000",
    }));
  });

  it("rejects an invalid revision", async () => {
    expect((await GET(new NextRequest(`http://localhost/api/pulse/status?revision=${"x".repeat(129)}`))).status).toBe(400);
    expect(mocks.getPulseFeedStatus).not.toHaveBeenCalled();
  });

  it("uses the lightweight status reader with a private no-store response", async () => {
    const response = await GET(new NextRequest("http://localhost/api/pulse/status?revision=p3.1.1.1"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getPulseFeedStatus).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      revision: "p3.1.1.1",
    }));
  });
});
