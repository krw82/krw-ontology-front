import { describe, expect, it } from "vitest";
import { buildOfflinePulseSnapshot } from "@/lib/pwa/offline-read-model";
import type { PulseFeedResponse, PulseItem } from "@/types/api-contracts";

function item(
  kind: PulseItem["kind"],
  title: string,
): PulseItem {
  return {
    id: `${kind}:${title}`,
    kind,
    trigger: "event",
    source_type: kind,
    source_id: title,
    ticker: "AAPL",
    coverage_level: null,
    judgment: null,
    linked_thesis: null,
    eyebrow: `${kind} event`,
    title,
    body: "Public filing summary",
    reason_code: "new_event",
    reason_label: "New event",
    priority: "normal",
    occurred_at: "2026-07-17T00:00:00.000Z",
    available_at: "2026-07-17T00:00:00.000Z",
    expires_at: null,
    reviewed_at: null,
    saved_at: null,
    snoozed_until: null,
    state: "new",
    actionable: true,
    phase: null,
    group_key: null,
    primary_action: { type: "link", label: "Open", href: "/filings/1" },
    secondary_actions: [],
    metadata: {},
  } as PulseItem;
}

describe("offline public filing read model", () => {
  it("stores only bounded public filing summaries", () => {
    const snapshot = buildOfflinePulseSnapshot({
      generated_at: "2026-07-17T01:00:00.000Z",
      items: [
        item("question", "Private research question"),
        ...Array.from({ length: 8 }, (_, index) =>
          item("filing", `Filing ${index + 1}`),
        ),
      ],
    } as Pick<PulseFeedResponse, "generated_at" | "items">);

    expect(snapshot?.items).toHaveLength(6);
    expect(snapshot?.items.map((entry) => entry.title)).not.toContain(
      "Private research question",
    );
    expect(snapshot?.synchronized_at).toBe("2026-07-17T01:00:00.000Z");
  });
});
