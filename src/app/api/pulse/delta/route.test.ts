import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getAuthUser: vi.fn(),
  getPulseFeedRevision: vi.fn(),
  canAccessMenuFeature: vi.fn(),
  composePulseFeed: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getAuthUser: mocks.getAuthUser,
  handleAuthError: () => Response.json({ error: { code: "authentication_error" } }, { status: 401 }),
}));
vi.mock("@/lib/pulse/revision", () => ({ getPulseFeedRevision: mocks.getPulseFeedRevision }));
vi.mock("@/lib/billing/feature-access-server", () => ({
  canAccessMenuFeature: mocks.canAccessMenuFeature,
}));
vi.mock("@/lib/pulse/composer", () => ({ composePulseFeed: mocks.composePulseFeed }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => ({}) }));

import { POST, buildDelta } from "@/app/api/pulse/delta/route";
import type { PulseFeedResponse, PulseItem } from "@/types/api-contracts";

function item(id: string, title = id): PulseItem {
  return {
    id,
    kind: "filing",
    trigger: "event",
    source_type: "filing",
    source_id: id,
    ticker: "AAPL",
    coverage_level: null,
    judgment: null,
    linked_thesis: null,
    eyebrow: "공시",
    title,
    body: "body",
    reason_code: "test",
    reason_label: "test",
    priority: "normal",
    occurred_at: "2026-07-20T00:00:00.000Z",
    available_at: "2026-07-20T00:00:00.000Z",
    expires_at: null,
    reviewed_at: null,
    saved_at: null,
    snoozed_until: null,
    state: "new",
    actionable: true,
    phase: null,
    group_key: null,
    primary_action: { type: "link", label: "열기", href: "/" },
    secondary_actions: [],
    metadata: {},
  };
}

const first = item("first");
const second = item("second");
const feed: PulseFeedResponse = {
  revision: "p3.2.5.100",
  generated_at: "2026-07-20T00:00:00.000Z",
  snapshot_at: "2026-07-20T00:00:00.000Z",
  ranking_version: "rule_v3",
  timezone: "Asia/Seoul",
  date_label: "7월 20일",
  filter: "all",
  summary: {
    actionable_count: 2,
    active_analysis_count: 0,
    counts: { filing: 2, analysis: 0, question: 0, resurface: 0 },
    primary_action: null,
  },
  active_analysis_items: [],
  items: [first, second],
  item_versions: { first: "v1-same", second: "v1-new" },
  new_item_count: 0,
  source_statuses: [],
};

describe("POST /api/pulse/delta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthUser.mockResolvedValue({ id: "user-1", email: "user@example.com" });
    mocks.getPulseFeedRevision.mockResolvedValue({ value: "p3.2.5.100" });
    mocks.canAccessMenuFeature.mockResolvedValue(true);
    mocks.composePulseFeed.mockResolvedValue(feed);
  });

  it("short-circuits without composing when the device already has this revision", async () => {
    const response = await POST(new NextRequest("http://localhost/api/pulse/delta", {
      method: "POST",
      body: JSON.stringify({ revision: "p3.2.5.100", item_versions: {} }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ changed: false, revision: "p3.2.5.100" });
    expect(mocks.composePulseFeed).not.toHaveBeenCalled();
  });

  it("returns only unknown or changed cards and the canonical order", () => {
    const delta = buildDelta(feed, { first: "v1-same", removed: "v1-old" });

    expect(delta.upserts.map((value) => value.id)).toEqual(["second"]);
    expect(delta.removed_item_ids).toEqual(["removed"]);
    expect(delta.ordered_item_ids).toEqual(["first", "second"]);
  });
});
