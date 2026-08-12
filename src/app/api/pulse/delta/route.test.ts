import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { buildPulseFeedDelta } from "@/lib/pulse/delta";
import { PULSE_DELTA_ITEM_VERSION_LIMIT } from "@/lib/pulse/contract";
import type { PulseFeedResponse, PulseItem } from "@/types/api-contracts";

const mocks = vi.hoisted(() => ({
  getOptionalAuthUser: vi.fn(),
  getPulseFeedRevision: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getOptionalAuthUser: mocks.getOptionalAuthUser,
  ANONYMOUS_PULSE_USER_ID: "00000000-0000-0000-0000-000000000000",
  handleAuthError: () => Response.json({ error: { code: "authentication_error" } }, { status: 401 }),
}));
vi.mock("@/lib/pulse/revision", () => ({
  getPulseFeedRevision: mocks.getPulseFeedRevision,
}));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => ({}) }));

import { POST } from "@/app/api/pulse/delta/route";

function item(id: string): PulseItem {
  return {
    id, kind: "filing", feed_slot: "signal", server_rank: 0, trigger: "event", source_type: "filing", source_id: id,
    ticker: "AAPL", coverage_level: null, judgment: null, linked_thesis: null, eyebrow: "공시", title: id, body: "body",
    reason_code: "test", reason_label: "test", priority: "normal", occurred_at: "2026-07-20T00:00:00.000Z", available_at: "2026-07-20T00:00:00.000Z",
    expires_at: null, reviewed_at: null, saved_at: null, snoozed_until: null, state: "new", actionable: true, phase: null, group_key: null,
    primary_action: { type: "link", label: "열기", href: "/" }, secondary_actions: [], metadata: {},
  };
}

describe("Pulse V5 delta", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOptionalAuthUser.mockResolvedValue({ id: "user-1", email: "user@example.com" });
    mocks.getPulseFeedRevision.mockResolvedValue({
      value: "current-revision",
      globalRevision: 1,
      userRevision: 1,
      timeBucket: 1,
    });
  });

  it("accepts a full candidate reservoir plus every completed-analysis card", async () => {
    const itemVersions = Object.fromEntries(
      Array.from({ length: PULSE_DELTA_ITEM_VERSION_LIMIT }, (_, index) => [`item-${index}`, "v1-a"]),
    );
    const response = await POST(new NextRequest("http://localhost/api/pulse/delta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: "current-revision", item_versions: itemVersions }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ changed: false });
  });

  it("continues to bound oversized cached-version payloads", async () => {
    const itemVersions = Object.fromEntries(
      Array.from({ length: PULSE_DELTA_ITEM_VERSION_LIMIT + 1 }, (_, index) => [`item-${index}`, "v1-a"]),
    );
    const response = await POST(new NextRequest("http://localhost/api/pulse/delta", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item_versions: itemVersions }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.getOptionalAuthUser).not.toHaveBeenCalled();
  });

  it("returns only changed cards and candidate order", () => {
    const first = item("first");
    const second = { ...item("second"), server_rank: 1, title: "new" };
    const feed: PulseFeedResponse = {
      revision: "revision", generated_at: "2026-07-20T00:00:00.000Z", snapshot_at: "2026-07-20T00:00:00.000Z", ranking_version: "rule_v5_flat",
      timezone: "Asia/Seoul", date_label: "7월 20일", filter: "all", candidate_items: [first, second], active_analysis_items: [], completed_analysis_items: [], visible_limit: 12,
      item_versions: { first: "same", second: "new" }, new_item_count: 0, source_statuses: [],
    };
    const delta = buildPulseFeedDelta(feed, { first: "same", removed: "old" });
    expect(delta.upserts.map((candidate) => candidate.id)).toEqual(["second"]);
    expect(delta.ordered_candidate_ids).toEqual(["first", "second"]);
    expect(delta.removed_item_ids).toEqual(["removed"]);
    expect(delta.refresh_summary).toEqual({
      added_candidate_count: 1,
      updated_item_count: 0,
      removed_item_count: 1,
    });
  });

  it("does not call a changed cached card new", () => {
    const first = item("first");
    const feed: PulseFeedResponse = {
      revision: "revision", generated_at: "2026-07-20T00:00:00.000Z", snapshot_at: "2026-07-20T00:00:00.000Z", ranking_version: "rule_v5_flat",
      timezone: "Asia/Seoul", date_label: "7월 20일", filter: "all", candidate_items: [first], active_analysis_items: [], completed_analysis_items: [], visible_limit: 12,
      item_versions: { first: "new-version" }, new_item_count: 0, source_statuses: [],
    };

    expect(buildPulseFeedDelta(feed, { first: "old-version" }).refresh_summary).toEqual({
      added_candidate_count: 0,
      updated_item_count: 1,
      removed_item_count: 0,
    });
  });
});
