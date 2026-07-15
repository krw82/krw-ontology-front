import { describe, expect, it } from "vitest";
import {
  applyPulseItemStates,
  hasRecentKindImpression,
} from "@/lib/pulse/item-state";
import type { PulseCandidate } from "@/lib/pulse/contract";
import type { UserPulseItemStateRow } from "@/types/database";

const now = new Date("2026-07-15T12:00:00.000Z");

function candidate(kind: PulseCandidate["kind"], key: string): PulseCandidate {
  return {
    item_key: `${kind}:${key}`,
    kind,
    trigger: "state",
    source_type: kind,
    source_id: key,
    ticker: kind === "learning" ? null : "AAPL",
    eyebrow: "항목",
    title: key,
    body: "body",
    reason_code: "test",
    reason_label: "test",
    priority: "normal",
    occurred_at: "2026-07-14T00:00:00.000Z",
    available_at: "2026-07-14T00:00:00.000Z",
    expires_at: null,
    read_at: null,
    saved_at: null,
    snoozed_until: null,
    group_key: null,
    primary_action: { type: "link", label: "열기", href: "/" },
    secondary_actions: [],
    metadata: {},
  };
}

function state(overrides: Partial<UserPulseItemStateRow> = {}): UserPulseItemStateRow {
  return {
    user_id: "user-1",
    item_key: "resurface:old",
    source_type: "resurface",
    source_id: "old",
    kind: "resurface",
    first_seen_at: null,
    last_seen_at: null,
    view_count: 0,
    read_at: null,
    reviewed_at: null,
    saved_at: null,
    snoozed_until: null,
    dismissed_at: null,
    last_impression_at: null,
    last_impression_session_id: null,
    impression_count: 0,
    feedback: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Pulse item state", () => {
  it("filters hidden candidates before rotation while retaining a fallback candidate", () => {
    const first = candidate("resurface", "first");
    const second = candidate("resurface", "second");
    const states = new Map([[first.item_key, state({ item_key: first.item_key, dismissed_at: now.toISOString() })]]);
    expect(applyPulseItemStates([first, second], states, now, "Asia/Seoul").map((item) => item.item_key)).toEqual([second.item_key]);
  });

  it("suppresses another learning card in the same local ISO week", () => {
    const learning = candidate("learning", "weekly");
    const states = new Map([[learning.item_key, state({
      item_key: learning.item_key,
      kind: "learning",
      source_type: "learning",
      last_seen_at: "2026-07-14T01:00:00.000Z",
    })]]);
    expect(hasRecentKindImpression(states, "learning", now, "Asia/Seoul", 7 * 24 * 60 * 60 * 1_000)).toBe(true);
  });
});
