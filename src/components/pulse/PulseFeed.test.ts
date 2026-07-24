import { describe, expect, it } from "vitest";
import {
  applyPulseFeedDelta,
  applyPulseItemMutation,
  buildFullPulseRefreshSummary,
  capturePulseItemSnapshot,
  rollbackPulseItemMutation,
} from "@/components/pulse/PulseFeed";
import type { PulseFeedResponse, PulseItem } from "@/types/api-contracts";

function item(id: string, serverRank = 0): PulseItem {
  return {
    id, kind: "filing", feed_slot: "signal", server_rank: serverRank, trigger: "event", source_type: "filing", source_id: id,
    ticker: "AAPL", coverage_level: "interest", judgment: null, linked_thesis: null, eyebrow: "공시", title: id, body: "body",
    reason_code: "test", reason_label: "test", priority: "normal", occurred_at: "2026-07-20T00:00:00.000Z", available_at: "2026-07-20T00:00:00.000Z",
    expires_at: null, reviewed_at: null, saved_at: null, snoozed_until: null, state: "new", actionable: true, phase: null, group_key: null,
    primary_action: { type: "link", label: "열기", href: "/" }, secondary_actions: [], metadata: {},
  };
}

function feed(candidateItems: PulseItem[]): PulseFeedResponse {
  return {
    revision: "old", generated_at: "2026-07-20T00:00:00.000Z", snapshot_at: "2026-07-20T00:00:00.000Z", ranking_version: "rule_v5_flat",
    timezone: "Asia/Seoul", date_label: "7월 20일", filter: "all", candidate_items: candidateItems, active_analysis_items: [], visible_limit: 12,
    item_versions: Object.fromEntries(candidateItems.map((candidate) => [candidate.id, candidate.id])), new_item_count: 0, source_statuses: [],
  };
}

describe("Pulse V5 feed reconciliation", () => {
  it("merges sparse candidate deltas without losing an unchanged card", () => {
    const first = item("first", 1);
    const second = item("second", 0);
    const current = feed([first, second]);
    const next = applyPulseFeedDelta(current, {
      generated_at: "2026-07-20T01:00:00.000Z", revision: "new", changed: true,
      snapshot: { ranking_version: "rule_v5_flat", timezone: "Asia/Seoul", date_label: "7월 20일", filter: "all", visible_limit: 12, new_item_count: 1, source_statuses: [] },
      ordered_candidate_ids: ["second", "first"], active_analysis_item_ids: [],
      upserts: [{ ...second, title: "updated" }], removed_item_ids: [], item_versions: { first: "first", second: "changed" },
      refresh_summary: { added_candidate_count: 0, updated_item_count: 1, removed_item_count: 0 },
    });
    expect(next.candidate_items.map((candidate) => candidate.id)).toEqual(["second", "first"]);
    expect(next.candidate_items[0]?.title).toBe("updated");
    expect(next.candidate_items[1]?.title).toBe("first");
  });

  it("rolls back only the failed optimistic card", () => {
    const first = item("first");
    const second = item("second", 1);
    const initial = feed([first, second]);
    const firstSnapshot = capturePulseItemSnapshot(initial, first.id);
    const firstPending = applyPulseItemMutation(initial, first, "review", "2026-07-20T01:00:00.000Z");
    const secondSaved = applyPulseItemMutation(firstPending, second, "review", "2026-07-20T01:00:01.000Z");
    const rolledBack = rollbackPulseItemMutation(secondSaved, firstSnapshot!, "review", "2026-07-20T01:00:00.000Z");

    expect(rolledBack.candidate_items[0]).toMatchObject({ id: "first", state: "new", reviewed_at: null });
    expect(rolledBack.candidate_items[1]).toMatchObject({ id: "second", state: "reviewed", reviewed_at: "2026-07-20T01:00:01.000Z" });
  });

  it("counts full recovery additions separately from changed cached cards", () => {
    const previous = {
      ...feed([item("existing")]),
      item_versions: { existing: "v1-old" },
    };
    const next = {
      ...feed([item("existing"), item("new")]),
      item_versions: { existing: "v1-new", new: "v1-new" },
    };

    expect(buildFullPulseRefreshSummary(previous, next)).toEqual({
      added_candidate_count: 1,
      updated_item_count: 1,
      removed_item_count: 0,
    });
  });
});
