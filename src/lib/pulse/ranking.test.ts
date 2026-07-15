import { describe, expect, it } from "vitest";
import type { PulseCandidate } from "@/lib/pulse/contract";
import {
  enforceFirstPageDiversity,
  rankPulseCandidates,
  scorePulseCandidate,
} from "@/lib/pulse/ranking";

function candidate(
  itemKey: string,
  overrides: Partial<PulseCandidate> = {},
): PulseCandidate {
  const kind = overrides.kind ?? "filing";
  return {
    item_key: itemKey,
    kind,
    trigger: kind === "filing" ? "event" : "state",
    source_type: kind,
    source_id: itemKey,
    ticker: "AAPL",
    eyebrow: "공시",
    title: itemKey,
    body: "body",
    reason_code: "followed_company",
    reason_label: "관심 기업",
    priority: "normal",
    occurred_at: "2026-07-15T00:00:00.000Z",
    available_at: "2026-07-15T00:00:00.000Z",
    expires_at: null,
    read_at: null,
    saved_at: null,
    snoozed_until: null,
    group_key: null,
    primary_action: { type: "link", label: "열기", href: "/" },
    secondary_actions: [],
    metadata: {},
    ...overrides,
  };
}

describe("pulse ranking", () => {
  it("uses deterministic source, priority, unread, pin, and holding weights", () => {
    const base = candidate("filing:1");
    expect(scorePulseCandidate(base)).toBe(940);
    expect(
      scorePulseCandidate(candidate("filing:2", { priority: "urgent", is_pinned: true, is_holding: true })),
    ).toBe(1220);
    expect(scorePulseCandidate(candidate("learning:1", { kind: "learning", source_type: "learning" }))).toBe(340);
  });

  it("sorts by score, occurrence time, then stable key", () => {
    const ranked = rankPulseCandidates([
      candidate("filing:b"),
      candidate("filing:a"),
      candidate("question:1", { kind: "question", source_type: "question", priority: "urgent" }),
    ], new Date("2026-07-15T12:00:00.000Z"));
    expect(ranked.map((item) => item.item_key)).toEqual([
      "filing:a",
      "filing:b",
      "question:1",
    ]);
  });

  it("limits a ticker to two slots in the first eight but exempts urgent items", () => {
    const ranked = Array.from({ length: 14 }, (_, index) => ({
      ...candidate(`filing:${index}`, {
        ticker: index < 6 ? "AAPL" : `T${index}`,
        priority: index === 5 ? "urgent" : "normal",
      }),
      score: 1000 - index,
    }));
    const diversified = enforceFirstPageDiversity(ranked);
    const firstEightAapl = diversified.slice(0, 8).filter((item) => item.ticker === "AAPL");
    expect(firstEightAapl).toHaveLength(3);
    expect(firstEightAapl.some((item) => item.priority === "urgent")).toBe(true);
  });

  it("shows at most one learning item in the first ten", () => {
    const ranked = Array.from({ length: 14 }, (_, index) => ({
      ...candidate(`${index < 4 ? "learning" : "filing"}:${index}`, index < 4 ? {
        kind: "learning",
        source_type: "learning",
        ticker: null,
      } : { ticker: `T${index}` }),
      score: 1000 - index,
    }));
    expect(
      enforceFirstPageDiversity(ranked).slice(0, 10).filter((item) => item.kind === "learning"),
    ).toHaveLength(1);
  });

  it("ranks one thousand deterministic fixtures within a small local budget", () => {
    const fixtures = Array.from({ length: 1_000 }, (_, index) => candidate(`filing:${index}`, {
      ticker: `T${index % 100}`,
      occurred_at: new Date(Date.UTC(2026, 6, 15, 0, 0, 0) - index * 1_000).toISOString(),
    }));
    const startedAt = performance.now();
    const result = rankPulseCandidates(fixtures, new Date("2026-07-15T12:00:00.000Z"));
    expect(result).toHaveLength(1_000);
    expect(performance.now() - startedAt).toBeLessThan(250);
  });
});
