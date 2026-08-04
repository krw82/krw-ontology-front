import { describe, expect, it } from "vitest";
import { buildPulseFeedDelta } from "@/lib/pulse/delta";
import type { PulseFeedResponse, PulseItem } from "@/types/api-contracts";

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
