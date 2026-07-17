import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  getPulseFeedStatus: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuthUser: mocks.getAuthUser,
  handleAuthError: () => Response.json({ error: { code: "authentication_error" } }, { status: 401 }),
}));
vi.mock("@/lib/pulse/status", () => ({ getPulseFeedStatus: mocks.getPulseFeedStatus }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => ({}) }));

import { GET } from "@/app/api/pulse/status/route";

describe("GET /api/pulse/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUser.mockResolvedValue({ id: "user-1" });
    mocks.getPulseFeedStatus.mockResolvedValue({
      generated_at: "2026-07-17T00:00:00.000Z",
      new_item_count: 2,
      active_analysis_count: 1,
      active_analysis_updated_at: "2026-07-17T00:00:00.000Z",
      active_analysis_session_ids: ["session-1"],
    });
  });

  it("requires authentication and a valid since timestamp", async () => {
    mocks.getAuthUser.mockResolvedValue(null);
    expect((await GET(new NextRequest("http://localhost/api/pulse/status?since=2026-07-17T00:00:00.000Z"))).status).toBe(401);

    mocks.getAuthUser.mockResolvedValue({ id: "user-1" });
    expect((await GET(new NextRequest("http://localhost/api/pulse/status?since=bad"))).status).toBe(400);
    expect(mocks.getPulseFeedStatus).not.toHaveBeenCalled();
  });

  it("uses the lightweight status reader with a private no-store response", async () => {
    const response = await GET(new NextRequest("http://localhost/api/pulse/status?since=2026-07-17T00:00:00.000Z"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.getPulseFeedStatus).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      since: expect.any(Date),
    }));
  });
});
