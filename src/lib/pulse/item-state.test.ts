import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyPulseItemStates,
  getPulseItemStates,
  hasRecentKindImpression,
} from "@/lib/pulse/item-state";
import type { PulseCandidate } from "@/lib/pulse/contract";
import type { Database, UserPulseItemStateRow } from "@/types/database";

const now = new Date("2026-07-15T12:00:00.000Z");

function candidate(kind: PulseCandidate["kind"], key: string): PulseCandidate {
  return {
    item_key: `${kind}:${key}`,
    kind,
    trigger: "state",
    source_type: kind,
    source_id: key,
    ticker: kind === "learning" ? null : "AAPL",
    coverage_status: kind === "learning" ? null : "watching",
    judgment: null,
    linked_thesis: null,
    eyebrow: "항목",
    title: key,
    body: "body",
    reason_code: "test",
    reason_label: "test",
    priority: "normal",
    occurred_at: "2026-07-14T00:00:00.000Z",
    available_at: "2026-07-14T00:00:00.000Z",
    expires_at: null,
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
  it("bounds PostgREST state lookups to one hundred deduplicated item keys", async () => {
    const queriedChunks: string[][] = [];
    const supabase = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            in: vi.fn(async (_column: string, itemKeys: string[]) => {
              queriedChunks.push(itemKeys);
              return {
                data: itemKeys.map((itemKey) => ({ item_key: itemKey })),
                error: null,
              };
            }),
          })),
        })),
      })),
    } as unknown as SupabaseClient<Database>;

    const keys = Array.from({ length: 205 }, (_, index) => `filing:${index}`);
    keys.push("filing:0");
    const states = await getPulseItemStates(supabase, "user-1", keys);

    expect(queriedChunks).toHaveLength(3);
    expect(queriedChunks.map((chunk) => chunk.length)).toEqual([100, 100, 5]);
    expect(new Set(queriedChunks.flat())).toHaveLength(205);
    expect(states).toHaveLength(205);
  });

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

  it("keeps a due scheduled review visible after an impression until the user resolves it", () => {
    const review = candidate("resurface", "monitoring:11111111-1111-4111-8111-111111111111");
    review.source_id = "monitoring:11111111-1111-4111-8111-111111111111";
    const states = new Map([[review.item_key, state({
      item_key: review.item_key,
      source_id: review.source_id,
      last_seen_at: "2026-07-15T11:00:00.000Z",
    })]]);
    expect(applyPulseItemStates([review], states, now, "Asia/Seoul")).toHaveLength(1);
    expect(hasRecentKindImpression(states, "resurface", now, "Asia/Seoul", 28 * 24 * 60 * 60 * 1_000)).toBe(false);
  });
});
