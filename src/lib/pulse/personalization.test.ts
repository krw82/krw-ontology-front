import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PulseCandidate } from "@/lib/pulse/contract";
import {
  applyPulseUserTickerSignals,
  buildPulseResearchAffinities,
  emptyPulseUserTickerSignals,
  getPulseUserTickerSignals,
} from "@/lib/pulse/personalization";
import type { Database } from "@/types/database";

function filing(ticker: string): PulseCandidate {
  return {
    item_key: `filing:${ticker}`,
    kind: "filing",
    trigger: "event",
    source_type: "filing",
    source_id: ticker,
    ticker,
    eyebrow: "새 공시",
    title: ticker,
    body: "body",
    reason_code: "catalog_sec_filing",
    reason_label: "카탈로그 공시",
    priority: "normal",
    occurred_at: "2026-07-15T00:00:00.000Z",
    available_at: "2026-07-15T00:00:00.000Z",
    expires_at: null,
    coverage_level: null,
    judgment: null,
    linked_thesis: null,
    saved_at: null,
    snoozed_until: null,
    group_key: null,
    primary_action: { type: "link", label: "공시 보기", href: "/filings" },
    secondary_actions: [],
    metadata: {},
  };
}

describe("Pulse user ticker signals", () => {
  it("adds a compact inline reason without changing the source item", () => {
    const signals = emptyPulseUserTickerSignals();
    signals.coverageByTicker.set("AAPL", "interest");
    signals.recentResearchTickers.add("AAPL");

    const [item] = applyPulseUserTickerSignals([filing("aapl")], signals);

    expect(item).toMatchObject({
      coverage_level: "interest",
      has_recent_research: true,
      reason_code: "covered_research_followup",
      reason_label: "최근 AAPL 리서치와 관련",
    });
    expect(item.source_id).toBe("aapl");
  });

  it("uses a covered share-class mark as the filing context and rewrites its actions", () => {
    const signals = emptyPulseUserTickerSignals();
    signals.coverageByTicker.set("GOOGL", "interest");
    signals.recentResearchTickers.add("GOOGL");
    const candidate = {
      ...filing("GOOG"),
      primary_action: {
        type: "link" as const,
        label: "공시 보기",
        href: "/filings/11111111-1111-4111-8111-111111111111?source=pulse",
      },
      secondary_actions: [{
        type: "link" as const,
        label: "이 공시로 질문",
        href: "/chat/new?ticker=GOOG&filing_event_id=11111111-1111-4111-8111-111111111111",
      }],
      metadata: { covered_tickers_csv: "GOOG,GOOGL" },
    };

    const [item] = applyPulseUserTickerSignals([candidate], signals);

    expect(item).toMatchObject({
      ticker: "GOOGL",
      coverage_level: "interest",
      has_recent_research: true,
      reason_code: "covered_research_followup",
      reason_label: "최근 GOOGL 리서치와 관련",
      metadata: { canonical_ticker: "GOOG", covered_tickers_csv: "GOOG,GOOGL" },
    });
    expect(item.primary_action).toMatchObject({
      href: "/filings/11111111-1111-4111-8111-111111111111?source=pulse&ticker=GOOGL",
    });
    expect(item.secondary_actions[0]).toMatchObject({
      href: "/chat/new?ticker=GOOGL&filing_event_id=11111111-1111-4111-8111-111111111111",
    });
  });

  it("deduplicates completed work into company research sessions", () => {
    const affinities = buildPulseResearchAffinities(
      [
        { id: "aapl-session", default_tickers: ["aapl"], updated_at: "2026-07-19T00:00:00.000Z" },
        { id: "msft-session", default_tickers: ["MSFT"], updated_at: "2026-07-19T00:00:00.000Z" },
      ],
      [
        { session_id: "aapl-session", finished_at: "2026-07-19T09:00:00.000Z" },
        { session_id: "aapl-session", finished_at: "2026-07-20T09:00:00.000Z" },
      ],
      new Date("2026-07-20T12:00:00.000Z"),
    );

    expect(affinities.get("AAPL")).toMatchObject({
      completed_run_count: 2,
      research_session_count: 1,
      distinct_research_days: 2,
      latest_completed_at: "2026-07-20T09:00:00.000Z",
      tier: "active",
    });
    expect(affinities.has("MSFT")).toBe(false);
  });

  it("puts repeated company conversations above one long conversation and lets an old one-off fade", () => {
    const sessions = [
      ...Array.from({ length: 4 }, (_, index) => ({
        id: `aapl-${index}`,
        default_tickers: ["AAPL"],
        updated_at: `2026-07-${String(16 + index).padStart(2, "0")}T09:00:00.000Z`,
      })),
      { id: "long-single", default_tickers: ["LONG"], updated_at: "2026-07-20T09:00:00.000Z" },
      { id: "old-single", default_tickers: ["OLD"], updated_at: "2026-06-20T09:00:00.000Z" },
    ];
    const runs = [
      ...Array.from({ length: 4 }, (_, index) => ({
        session_id: `aapl-${index}`,
        finished_at: `2026-07-${String(16 + index).padStart(2, "0")}T10:00:00.000Z`,
      })),
      ...Array.from({ length: 20 }, () => ({ session_id: "long-single", finished_at: "2026-07-20T10:00:00.000Z" })),
      { session_id: "old-single", finished_at: "2026-06-20T10:00:00.000Z" },
    ];

    const affinities = buildPulseResearchAffinities(
      sessions,
      runs,
      new Date("2026-07-20T12:00:00.000Z"),
    );

    expect(affinities.get("AAPL")).toMatchObject({ research_session_count: 4, tier: "strong" });
    expect(affinities.get("AAPL")!.score).toBeGreaterThan(affinities.get("LONG")!.score);
    expect(affinities.get("OLD")).toMatchObject({ research_session_count: 1, tier: "history" });
  });

  it("reads only completed agent runs when loading a user's research affinity", async () => {
    const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
    const chainFor = (table: string, result: { data: unknown[]; error: null }) => {
      const chain = {
        select: (...args: unknown[]) => {
          calls.push({ table, method: "select", args });
          return chain;
        },
        eq: (...args: unknown[]) => {
          calls.push({ table, method: "eq", args });
          return chain;
        },
        is: (...args: unknown[]) => {
          calls.push({ table, method: "is", args });
          return chain;
        },
        gte: (...args: unknown[]) => {
          calls.push({ table, method: "gte", args });
          return chain;
        },
        in: (...args: unknown[]) => {
          calls.push({ table, method: "in", args });
          return chain;
        },
        order: (...args: unknown[]) => {
          calls.push({ table, method: "order", args });
          return chain;
        },
        limit: (...args: unknown[]) => {
          calls.push({ table, method: "limit", args });
          return chain;
        },
        returns: () => Promise.resolve(result),
      };
      return chain;
    };
    const marks = chainFor("user_company_marks", {
      data: [{ ticker: "AAPL", coverage_level: "interest" }],
      error: null,
    });
    const sessions = chainFor("chat_sessions", {
      data: [{ id: "session-1", default_tickers: ["AAPL"], updated_at: "2026-07-20T10:00:00.000Z" }],
      error: null,
    });
    const runs = chainFor("agent_runs", {
      data: [{ session_id: "session-1", finished_at: "2026-07-20T11:00:00.000Z" }],
      error: null,
    });
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === "user_company_marks") return marks;
        if (table === "chat_sessions") return sessions;
        if (table === "agent_runs") return runs;
        throw new Error(`unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient<Database>;

    const signals = await getPulseUserTickerSignals(
      supabase,
      "user-1",
      new Date("2026-07-20T12:00:00.000Z"),
    );

    expect(calls).toContainEqual({
      table: "agent_runs",
      method: "eq",
      args: ["status", "completed"],
    });
    expect(calls).toContainEqual({
      table: "agent_runs",
      method: "in",
      args: ["session_id", ["session-1"]],
    });
    expect(signals.researchAffinityByTicker.get("AAPL")?.completed_run_count).toBe(1);
  });
});
