import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  composePulseFeed: vi.fn(),
  composeLegacyPulseFeed: vi.fn(),
  canAccessMenuFeature: vi.fn(),
  p0V2Enabled: true,
}));

vi.mock("@/lib/auth", () => ({
  getAuthUser: mocks.getAuthUser,
  handleAuthError: () =>
    Response.json({ error: { code: "authentication_error" } }, { status: 401 }),
}));
vi.mock("@/lib/pulse/composer", () => ({
  composePulseFeed: mocks.composePulseFeed,
}));
vi.mock("@/lib/pulse/legacy-composer", () => ({
  composeLegacyPulseFeed: mocks.composeLegacyPulseFeed,
}));
vi.mock("@/lib/pulse/enabled", () => ({
  isPulseFeedEnabled: () => true,
  isPulseP0V2Enabled: () => mocks.p0V2Enabled,
}));
vi.mock("@/lib/billing/feature-access-server", () => ({
  canAccessMenuFeature: mocks.canAccessMenuFeature,
}));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => ({}) }));

import { GET } from "@/app/api/pulse/route";

const feed = {
  generated_at: "2026-07-15T00:00:00.000Z",
  snapshot_at: "2026-07-15T00:00:00.000Z",
  timezone: "Asia/Seoul",
  date_label: "7월 15일 수요일",
  filter: "all",
  summary: {
    actionable_count: 0,
    active_analysis_count: 0,
    counts: { filing: 0, analysis: 0, question: 0, resurface: 0 },
    primary_action: null,
  },
  items: [],
  next_cursor: null,
  has_more: false,
  new_item_count: 0,
  source_statuses: [],
};

describe("GET /api/pulse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUser.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
    });
    mocks.canAccessMenuFeature.mockResolvedValue(true);
    mocks.composePulseFeed.mockResolvedValue(feed);
    mocks.composeLegacyPulseFeed.mockResolvedValue(feed);
    mocks.p0V2Enabled = true;
  });

  it("requires authentication", async () => {
    mocks.getAuthUser.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/pulse"));
    expect(response.status).toBe(401);
    expect(mocks.composePulseFeed).not.toHaveBeenCalled();
  });

  it("rejects malformed cursors and limits over thirty", async () => {
    expect(
      (await GET(new NextRequest("http://localhost/api/pulse?cursor=broken")))
        .status,
    ).toBe(400);
    expect(
      (await GET(new NextRequest("http://localhost/api/pulse?limit=31")))
        .status,
    ).toBe(400);
    expect(mocks.composePulseFeed).not.toHaveBeenCalled();
  });

  it("asks a legacy offset cursor to refresh instead of translating it unsafely", async () => {
    const legacy = Buffer.from(
      JSON.stringify({
        version: 1,
        offset: 20,
        filter: "all",
        generated_at: "2026-07-15T00:00:00.000Z",
      }),
    ).toString("base64url");
    expect(
      (
        await GET(
          new NextRequest(`http://localhost/api/pulse?cursor=${legacy}`),
        )
      ).status,
    ).toBe(409);
  });

  it("returns a private no-store response without starting any research run", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/pulse?filter=all&limit=20"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.composePulseFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        includeNotebookSources: true,
        filter: "all",
        limit: 20,
      }),
    );
  });

  it("rejects a v2 filter request because the new feed is one ranked stream", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/pulse?filter=filing"),
    );
    expect(response.status).toBe(400);
    expect(mocks.composePulseFeed).not.toHaveBeenCalled();
  });

  it("keeps the legacy Pulse composer available when the v2 flag is off", async () => {
    mocks.p0V2Enabled = false;
    const legacy = Buffer.from(
      JSON.stringify({
        version: 1,
        offset: 20,
        filter: "all",
        generated_at: "2026-07-15T00:00:00.000Z",
      }),
    ).toString("base64url");

    const response = await GET(
      new NextRequest(`http://localhost/api/pulse?cursor=${legacy}`),
    );

    expect(response.status).toBe(200);
    expect(mocks.composeLegacyPulseFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        cursor: legacy,
      }),
    );
    expect(mocks.composePulseFeed).not.toHaveBeenCalled();
  });
});
