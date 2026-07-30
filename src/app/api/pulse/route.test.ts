import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  composePulseFeed: vi.fn(),
  canAccessMenuFeature: vi.fn(),
  getPulseFeedRevision: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuthUser: mocks.getAuthUser,
  handleAuthError: () =>
    Response.json({ error: { code: "authentication_error" } }, { status: 401 }),
}));
vi.mock("@/lib/pulse/composer", () => ({
  composePulseFeed: mocks.composePulseFeed,
}));
vi.mock("@/lib/billing/feature-access-server", () => ({
  canAccessMenuFeature: mocks.canAccessMenuFeature,
}));
vi.mock("@/lib/pulse/revision", () => ({
  getPulseFeedRevision: mocks.getPulseFeedRevision,
  matchesPulseFeedETag: (value: string | null, revision: string) => value === `\"${revision}\"`,
  pulseFeedETag: (revision: string) => `\"${revision}\"`,
}));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => ({}) }));

import { GET } from "@/app/api/pulse/route";

const feed = {
  revision: "p4.1.1.1",
  generated_at: "2026-07-15T00:00:00.000Z",
  snapshot_at: "2026-07-15T00:00:00.000Z",
  ranking_version: "rule_v5_flat",
  timezone: "Asia/Seoul",
  date_label: "7월 15일 수요일",
  filter: "all",
  active_analysis_items: [],
  candidate_items: [],
  visible_limit: 12,
  item_versions: {},
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
    mocks.getPulseFeedRevision.mockResolvedValue({
      value: "p3.1.1.1",
      globalRevision: 1,
      userRevision: 1,
      timeBucket: 1,
    });
    mocks.composePulseFeed.mockResolvedValue(feed);
  });

  it("requires authentication", async () => {
    mocks.getAuthUser.mockResolvedValue(null);
    const response = await GET(new NextRequest("http://localhost/api/pulse"));
    expect(response.status).toBe(401);
    expect(mocks.composePulseFeed).not.toHaveBeenCalled();
  });

  it("rejects pagination cursors and limits over the candidate reservoir", async () => {
    expect(
      (await GET(new NextRequest("http://localhost/api/pulse?cursor=broken")))
        .status,
    ).toBe(400);
    expect(
      (await GET(new NextRequest("http://localhost/api/pulse?limit=49")))
        .status,
    ).toBe(400);
    expect(mocks.composePulseFeed).not.toHaveBeenCalled();
  });

  it("rejects a removed offset cursor", async () => {
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
    ).toBe(400);
  });

  it("rejects a removed v2 cursor", async () => {
    const v2 = Buffer.from(
      JSON.stringify({
        version: 2,
        filter: "all",
        snapshot_at: "2026-07-15T00:00:00.000Z",
        boundary: {
          lane: 10,
          priority_rank: 1,
          coverage_rank: 0,
          saved_rank: 1,
          occurred_at: "2026-07-15T00:00:00.000Z",
          item_key: "filing:1",
        },
      }),
    ).toString("base64url");
    expect((await GET(new NextRequest(`http://localhost/api/pulse?cursor=${v2}`))).status).toBe(400);
  });

  it("returns a private no-store response without starting any research run", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/pulse?filter=all&limit=48"),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.composePulseFeed).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        includeNotebookSources: true,
        filter: "all",
        limit: 48,
      }),
    );
  });

  it("returns 304 before composition when the private revision matches", async () => {
    const response = await GET(new NextRequest("http://localhost/api/pulse", {
      headers: { "if-none-match": '"p3.1.1.1"' },
    }));

    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe('"p3.1.1.1"');
    expect(mocks.composePulseFeed).not.toHaveBeenCalled();
    expect(mocks.canAccessMenuFeature).not.toHaveBeenCalled();
  });

  it("rejects content-type filters because the feed is one ranked stream", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/pulse?filter=filing"),
    );
    expect(response.status).toBe(400);
    expect(mocks.composePulseFeed).not.toHaveBeenCalled();
  });

  it("fails closed when authoritative personal feed state is unavailable", async () => {
    mocks.composePulseFeed.mockRejectedValue(new Error("item state unavailable"));

    const response = await GET(new NextRequest("http://localhost/api/pulse"));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "service_unavailable" },
    });
  });

});
