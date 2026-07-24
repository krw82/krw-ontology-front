import { describe, expect, it } from "vitest";
import { buildDevicePulseSnapshot } from "@/lib/pwa/device-cache";
import type { PulseFeedResponse, PulseItem } from "@/types/api-contracts";

function item(kind: PulseItem["kind"], id: string): PulseItem {
  return {
    id,
    kind,
    feed_slot: kind === "analysis" ? "continue" : "signal",
    server_rank: 0,
    trigger: "event",
    source_type: kind,
    source_id: id,
    ticker: "AAPL",
    coverage_level: null,
    judgment: null,
    linked_thesis: null,
    eyebrow: "event",
    title: id,
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
    phase: kind === "analysis" ? "active" : null,
    group_key: null,
    primary_action: { type: "link", label: "Open", href: "/pulse" },
    secondary_actions: [],
    metadata: {},
  } as unknown as PulseItem;
}

function feed(candidateItems: PulseItem[], activeAnalysisItems: PulseItem[] = []): PulseFeedResponse {
  return {
    revision: "revision",
    generated_at: "2026-07-20T01:00:00.000Z",
    snapshot_at: "2026-07-20T01:00:00.000Z",
    ranking_version: "rule_v5_flat",
    timezone: "Asia/Seoul",
    date_label: "7월 20일",
    filter: "all",
    candidate_items: candidateItems,
    active_analysis_items: activeAnalysisItems,
    visible_limit: 12,
    item_versions: {},
    new_item_count: 0,
    source_statuses: [],
  };
}

describe("device-scoped Pulse cache", () => {
  it("keeps candidate cards but excludes research and active-run metadata", () => {
    const snapshot = buildDevicePulseSnapshot(feed([
      item("analysis", "completed-analysis"),
      item("filing", "10-q"),
    ], [item("analysis", "active-analysis")]));

    expect(snapshot?.feed.candidate_items.map((candidate) => candidate.id)).toEqual(["10-q"]);
    expect(snapshot?.feed.active_analysis_items).toEqual([]);
    expect(snapshot?.feed.revision).toBe("device-partial");
  });
});
