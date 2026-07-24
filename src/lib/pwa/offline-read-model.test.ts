import { describe, expect, it } from "vitest";
import { buildOfflinePulseSnapshot } from "@/lib/pwa/offline-read-model";
import type { PulseItem } from "@/types/api-contracts";

function item(kind: PulseItem["kind"], id: string): PulseItem {
  return {
    id,
    kind,
    feed_slot: "signal",
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
    phase: null,
    group_key: null,
    primary_action: { type: "link", label: "Open", href: "/" },
    secondary_actions: [],
    metadata: {},
  } as unknown as PulseItem;
}

describe("offline public filing read model", () => {
  it("stores only bounded filing summaries from flat-feed candidates", () => {
    const snapshot = buildOfflinePulseSnapshot({
      generated_at: "2026-07-20T01:00:00.000Z",
      candidate_items: [item("question", "private"), ...Array.from({ length: 8 }, (_, index) => item("filing", `f-${index}`))],
    });
    expect(snapshot?.items).toHaveLength(6);
    expect(snapshot?.items.map((entry) => entry.title)).not.toContain("private");
  });
});
