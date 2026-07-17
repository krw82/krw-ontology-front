import { describe, expect, it } from "vitest";
import type { PulseCandidate } from "@/lib/pulse/contract";
import {
  comparePulseSortKeys,
  rankPulseCandidates,
  reorderFirstPageWindow,
} from "@/lib/pulse/ranking";

const now = new Date("2026-07-15T12:00:00.000Z");

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

describe("pulse lane ranking", () => {
  it("keeps fresh filings ahead of terminal analysis and questions", () => {
    const ranked = rankPulseCandidates([
      candidate("question:1", { kind: "question", source_type: "question" }),
      candidate("analysis:1:completed", {
        kind: "analysis",
        source_type: "analysis",
        phase: "completed",
      }),
      candidate("filing:1", { priority: "normal" }),
      candidate("filing:urgent", { priority: "urgent" }),
    ], now);
    expect(ranked.map((item) => item.item_key)).toEqual([
      "filing:urgent",
      "filing:1",
      "analysis:1:completed",
      "question:1",
    ]);
  });

  it("places active analysis after action items and reviewed cards last", () => {
    const ranked = rankPulseCandidates([
      candidate("analysis:active", { kind: "analysis", source_type: "analysis", phase: "active" }),
      candidate("question:1", { kind: "question", source_type: "question" }),
      candidate("filing:reviewed", { reviewed_at: "2026-07-15T01:00:00.000Z", read_at: "2026-07-15T01:00:00.000Z" }),
    ], now);
    expect(ranked.map((item) => item.item_key)).toEqual([
      "question:1",
      "analysis:active",
      "filing:reviewed",
    ]);
    expect(ranked[0].actionable).toBe(true);
    expect(ranked[1].actionable).toBe(false);
    expect(ranked[2].state).toBe("reviewed");
  });

  it("uses a deterministic tuple when a lane ties", () => {
    const ranked = rankPulseCandidates([
      candidate("filing:b", { occurred_at: "2026-07-15T00:00:00.000Z" }),
      candidate("filing:a", { occurred_at: "2026-07-15T00:00:00.000Z" }),
    ], now);
    expect(ranked.map((item) => item.item_key)).toEqual(["filing:a", "filing:b"]);
    expect(comparePulseSortKeys(ranked[0], ranked[1])).toBeLessThan(0);
  });

  it("uses personal relevance only within the same hard lane", () => {
    const ranked = rankPulseCandidates([
      candidate("filing:ordinary", { ticker: "MSFT", priority: "high" }),
      candidate("filing:holding", {
        ticker: "AAPL",
        priority: "normal",
        is_holding: true,
        is_watchlisted: true,
        has_recent_research: true,
      }),
      candidate("filing:watchlisted", {
        ticker: "NVDA",
        is_watchlisted: true,
        has_recent_research: true,
      }),
      candidate("filing:plain", { ticker: "GOOG" }),
    ], now);

    expect(ranked.map((item) => item.item_key)).toEqual([
      "filing:holding",
      "filing:watchlisted",
      "filing:ordinary",
      "filing:plain",
    ]);
    expect(ranked[0].rank_score).toBeGreaterThan(ranked[1].rank_score);
  });

  it("keeps ticker and learning diversity inside the supplied first-page window", () => {
    const rawWindow = rankPulseCandidates(Array.from({ length: 14 }, (_, index) => candidate(
      `${index < 4 ? "learning" : "filing"}:${index}`,
      index < 4
        ? { kind: "learning", source_type: "learning", ticker: null }
        : { ticker: index < 9 ? "AAPL" : `T${index}` },
    )), now);
    const displayed = reorderFirstPageWindow(rawWindow);
    expect(displayed).toHaveLength(rawWindow.length);
    expect(displayed.slice(0, 8).filter((item) => item.ticker === "AAPL")).toHaveLength(2);
    expect(displayed.slice(0, 10).filter((item) => item.kind === "learning")).toHaveLength(1);
  });

  it("reserves a late first-screen discovery slot without jumping an urgent filing", () => {
    const rawWindow = rankPulseCandidates(Array.from({ length: 12 }, (_, index) => candidate(`filing:${index}`, {
      ticker: `T${index}`,
      occurred_at: new Date(now.getTime() - index * 60 * 60 * 1_000).toISOString(),
      metadata: index === 11 ? { candidate_bucket: "discovery" } : {},
    })), now);

    const displayed = reorderFirstPageWindow(rawWindow);
    expect(displayed.slice(0, 10).some((item) => item.metadata.candidate_bucket === "discovery")).toBe(true);
    expect(displayed).toHaveLength(rawWindow.length);

    const urgentWindow = rankPulseCandidates([
      ...Array.from({ length: 10 }, (_, index) => candidate(`filing:urgent:${index}`, {
        ticker: `U${index}`,
        priority: "urgent",
        occurred_at: new Date(now.getTime() - index * 60 * 60 * 1_000).toISOString(),
      })),
      candidate("filing:discovery", {
        ticker: "DISC",
        metadata: { candidate_bucket: "discovery" },
      }),
    ], now);
    expect(reorderFirstPageWindow(urgentWindow).slice(0, 10).every((item) => item.priority === "urgent")).toBe(true);
  });

  it("ranks one thousand deterministic fixtures within a small local budget", () => {
    const fixtures = Array.from({ length: 1_000 }, (_, index) => candidate(`filing:${index}`, {
      ticker: `T${index % 100}`,
      occurred_at: new Date(Date.UTC(2026, 6, 15, 0, 0, 0) - index * 1_000).toISOString(),
    }));
    const startedAt = performance.now();
    const result = rankPulseCandidates(fixtures, now);
    expect(result).toHaveLength(1_000);
    expect(performance.now() - startedAt).toBeLessThan(250);
  });
});
