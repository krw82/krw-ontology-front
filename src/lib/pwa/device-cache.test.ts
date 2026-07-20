import { describe, expect, it } from "vitest";
import { buildDevicePulseSnapshot } from "@/lib/pwa/device-cache";
import type { PulseFeedResponse, PulseItem } from "@/types/api-contracts";

function pulseItem(kind: PulseItem["kind"], title: string): PulseItem {
  return {
    id: `${kind}:${title}`,
    kind,
    trigger: "event",
    source_type: kind,
    source_id: title,
    ticker: "AAPL",
    coverage_status: null,
    coverage_level: null,
    judgment: null,
    linked_thesis: null,
    eyebrow: `${kind} event`,
    title,
    body: "Cached read model item",
    reason_code: "new_event",
    reason_label: "New event",
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
  } as PulseItem;
}

function feed(items: PulseItem[]): PulseFeedResponse {
  return {
    generated_at: "2026-07-20T01:00:00.000Z",
    snapshot_at: "2026-07-20T01:00:00.000Z",
    ranking_version: "rule_v3",
    timezone: "Asia/Seoul",
    date_label: "2026년 7월 20일",
    filter: "all",
    summary: {
      actionable_count: items.length,
      active_analysis_count: items.filter((item) => item.kind === "analysis")
        .length,
      counts: {
        filing: items.filter((item) => item.kind === "filing").length,
        analysis: items.filter((item) => item.kind === "analysis").length,
        question: items.filter((item) => item.kind === "question").length,
        resurface: items.filter((item) => item.kind === "resurface").length,
      },
      primary_action: null,
    },
    active_analysis_items: items.filter((item) => item.kind === "analysis"),
    items,
    new_item_count: items.length,
    source_statuses: [],
  };
}

describe("device-scoped Pulse cache", () => {
  it("never stores analysis cards or active analysis metadata", () => {
    const snapshot = buildDevicePulseSnapshot(
      feed([
        pulseItem("analysis", "Private research run"),
        pulseItem("filing", "10-Q filed"),
        pulseItem("question", "Review margin"),
      ]),
    );

    expect(snapshot?.feed.items.map((item) => item.title)).toEqual([
      "10-Q filed",
      "Review margin",
    ]);
    expect(snapshot?.feed.active_analysis_items).toEqual([]);
    expect(snapshot?.feed.summary.active_analysis_count).toBe(0);
    expect(snapshot?.feed.summary.counts.analysis).toBe(0);
    expect(snapshot?.feed.new_item_count).toBe(0);
  });

  it("does not write an empty snapshot after excluding analysis-only data", () => {
    expect(
      buildDevicePulseSnapshot(feed([pulseItem("analysis", "Private run")])),
    ).toBeNull();
  });
});
