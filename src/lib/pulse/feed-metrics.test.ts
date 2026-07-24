import { describe, expect, it } from "vitest";
import { buildPulseFeedViewMetrics, pulseViewProperties } from "@/lib/pulse/feed-metrics";
import type { PulseFeedDisplayEntry } from "@/lib/pulse/insider-trade-stack";
import type { PulseItem } from "@/types/api-contracts";

function item(id: string, feedSlot: PulseItem["feed_slot"]): PulseItem {
  return {
    id,
    kind: "filing",
    feed_slot: feedSlot,
    server_rank: 0,
    trigger: "event",
    source_type: "filing",
    source_id: id,
    ticker: id.toUpperCase(),
    coverage_level: feedSlot === "signal" ? "interest" : null,
    judgment: null,
    linked_thesis: null,
    eyebrow: "공시",
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
    phase: null,
    group_key: null,
    primary_action: { type: "link", label: "열기", href: "/" },
    secondary_actions: [],
    metadata: { form_type: "4", form4_has_reported_open_market_trade: true },
  };
}

describe("Pulse visible-feed analytics", () => {
  it("counts what was rendered, not every raw Form 4 row", () => {
    const personal = item("personal", "signal");
    const discoveryA = item("discovery-a", "discovery");
    const discoveryB = item("discovery-b", "discovery");
    const entries: PulseFeedDisplayEntry[] = [
      { type: "item", id: personal.id, item: personal, position: 1, state: "new" },
      {
        type: "insider_trade_stack",
        id: "stack",
        group_key: "2026-07-20:discovery",
        feed_slot: "discovery",
        items: [{ item: discoveryA, position: 2 }, { item: discoveryB, position: 3 }],
        position: 2,
        state: "new",
      },
    ];

    const metrics = buildPulseFeedViewMetrics(entries, [personal, discoveryA, discoveryB]);

    expect(metrics).toEqual({
      item_count: 2,
      raw_item_count: 3,
      display_entry_count: 2,
      actionable_count: 2,
      insider_stack_count: 1,
      personal_signal_entry_count: 1,
      discovery_entry_count: 1,
    });
    expect(pulseViewProperties(
      { ranking_version: "rule_v5_flat", active_analysis_items: [] },
      metrics,
      { feedSessionId: "feed-1", entry: null, onboardingIntent: null, degradedSources: [] },
    )).toMatchObject({ item_count: 2, raw_item_count: 3, feed_session_id: "feed-1" });
  });
});
