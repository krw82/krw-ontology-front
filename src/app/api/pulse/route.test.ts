import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  composePulseFeed: vi.fn(),
  canAccessMenuFeature: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuthUser: mocks.getAuthUser,
  handleAuthError: () => Response.json({ error: { code: "authentication_error" } }, { status: 401 }),
}));
vi.mock("@/lib/pulse/composer", () => ({ composePulseFeed: mocks.composePulseFeed }));
vi.mock("@/lib/pulse/enabled", () => ({ isPulseFeedEnabled: () => true }));
vi.mock("@/lib/billing/feature-access-server", () => ({ canAccessMenuFeature: mocks.canAccessMenuFeature }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => ({}) }));

import { GET } from "@/app/api/pulse/route";

const feed = {
  generated_at: "2026-07-15T00:00:00.000Z",
  timezone: "Asia/Seoul",
  date_label: "7월 15일 수요일",
  filter: "all",
  items: [],
  next_cursor: null,
  has_more: false,
  new_item_count: 0,
  source_statuses: [],
};

describe("GET /api/pulse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUser.mockResolvedValue({ id: "user-1", email: "user@example.com" });
    mocks.canAccessMenuFeature.mockResolvedValue(true);
    mocks.composePulseFeed.mockResolvedValue(feed);
  });

  it("requires authentication", async () => {
    mocks.getAuthUser.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/pulse"));
    expect(response.status).toBe(401);
    expect(mocks.composePulseFeed).not.toHaveBeenCalled();
  });

  it("rejects malformed cursors and limits over thirty", async () => {
    expect((await GET(new NextRequest("http://localhost/api/pulse?cursor=broken"))).status).toBe(400);
    expect((await GET(new NextRequest("http://localhost/api/pulse?limit=31"))).status).toBe(400);
    expect(mocks.composePulseFeed).not.toHaveBeenCalled();
  });

  it("returns a private no-store response without starting any research run", async () => {
    const response = await GET(new NextRequest("http://localhost/api/pulse?filter=filing&limit=20"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.composePulseFeed).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      includeNotebookSources: true,
      filter: "filing",
      limit: 20,
    }));
  });
});
