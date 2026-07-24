import { describe, expect, it } from "vitest";
import type { PulseCandidate } from "@/lib/pulse/contract";
import {
  buildPulseCandidatePool,
  PULSE_CANDIDATE_POOL_MAX,
  rankPulseCandidates,
  toRankedCandidate,
} from "@/lib/pulse/ranking";

const now = new Date("2026-07-20T12:00:00.000Z");

function candidate(itemKey: string, overrides: Partial<PulseCandidate> = {}): PulseCandidate {
  const kind = overrides.kind ?? "filing";
  return {
    item_key: itemKey,
    kind,
    trigger: kind === "filing" ? "event" : "state",
    source_type: kind,
    source_id: itemKey,
    ticker: "AAPL",
    coverage_level: null,
    judgment: null,
    linked_thesis: null,
    eyebrow: "새 신호",
    title: itemKey,
    body: "body",
    reason_code: "test",
    reason_label: "test",
    priority: "normal",
    occurred_at: "2026-07-20T00:00:00.000Z",
    available_at: "2026-07-20T00:00:00.000Z",
    expires_at: null,
    saved_at: null,
    snoozed_until: null,
    group_key: null,
    primary_action: { type: "link", label: "열기", href: "/" },
    secondary_actions: [],
    metadata: {},
    ...overrides,
  };
}

describe("Pulse V5 flat server candidate pool", () => {
  it("keeps a single utility order while diversifying the first six cards", () => {
    const ranked = rankPulseCandidates([
      ...Array.from({ length: 3 }, (_, index) => candidate(`filing:aapl:${index}`, {
        coverage_level: "interest",
        research_affinity: 12,
        ticker: "AAPL",
      })),
      ...Array.from({ length: 3 }, (_, index) => candidate(`analysis:${index}`, {
        kind: "analysis",
        source_type: "analysis",
        phase: "completed",
        ticker: `A${index}`,
      })),
      ...Array.from({ length: 2 }, (_, index) => candidate(`filing:discovery:${index}`, {
        ticker: `D${index}`,
      })),
      candidate("question:one", { kind: "question", source_type: "question", ticker: "QQQ" }),
      candidate("resurface:one", { kind: "resurface", source_type: "resurface", ticker: "RRR" }),
      candidate("learning:one", { kind: "learning", source_type: "learning", ticker: null }),
    ], now);
    const pool = buildPulseCandidatePool(ranked, now);
    const topSix = pool.slice(0, 6);

    expect(pool.length).toBeLessThanOrEqual(PULSE_CANDIDATE_POOL_MAX);
    expect(topSix.filter((item) => item.ticker === "AAPL")).toHaveLength(2);
    expect(topSix.filter((item) => item.feed_slot === "discovery")).toHaveLength(1);
    expect(topSix.some((item) => item.feed_slot === "learning")).toBe(false);
    expect(pool.filter((item) => item.kind === "analysis" && item.phase === "completed")).toHaveLength(2);
    expect(pool.map((item) => item.server_rank)).toEqual(pool.map((_, index) => index));
  });

  it("uses completed research affinity before a generic high-priority filing", () => {
    const ranked = rankPulseCandidates([
      candidate("filing:generic", { ticker: "GEN", priority: "high" }),
      candidate("filing:researched", {
        ticker: "RSCH",
        priority: "normal",
        research_affinity: 12,
      }),
    ], now);

    expect(ranked[0]?.item_key).toBe("filing:researched");
  });

  it("keeps session-based affinity differentiated without outranking explicit interest", () => {
    const strong = toRankedCandidate(candidate("filing:strong", { research_affinity: 20 }), now);
    const active = toRankedCandidate(candidate("filing:active", { research_affinity: 14 }), now);
    const explicitInterest = toRankedCandidate(candidate("filing:interest", {
      research_affinity: 0,
      coverage_level: "interest",
    }), now);

    expect(strong.rank_score).toBeGreaterThan(active.rank_score);
    expect(explicitInterest.rank_score).toBeGreaterThan(strong.rank_score);
  });

  it("removes reviewed and stale terminal research from candidates", () => {
    const ranked = rankPulseCandidates([
      candidate("filing:reviewed", { reviewed_at: "2026-07-20T01:00:00.000Z" }),
      candidate("analysis:old", {
        kind: "analysis",
        source_type: "analysis",
        phase: "completed",
        occurred_at: "2026-07-01T00:00:00.000Z",
      }),
      candidate("filing:fresh", { coverage_level: "interest" }),
    ], now);

    expect(buildPulseCandidatePool(ranked, now).map((item) => item.item_key)).toEqual(["filing:fresh"]);
  });
});
