import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MarketIssueAgentContextError,
  buildMarketIssueAgentContext,
} from "@/lib/market-issues/agent-context";

/**
 * Lightweight chainable Supabase mock.
 *
 * buildMarketIssueAgentContext runs two query chains:
 *   1. db.from("market_issues").select(...).eq(...).eq(...).eq(...).maybeSingle()
 *   2. db.from("market_issue_research_packets").select("payload").eq(...).eq(...).maybeSingle()
 *
 * This mock records the terminal `.maybeSingle()` call per table and returns the
 * { data, error } tuple configured for that table.
 */
type MaybeSingleResult = { data: unknown; error: unknown };

function makeClient(tables: Record<string, MaybeSingleResult>) {
  const create = (table: string) => {
    const chain: Record<string, unknown> = {};
    // select + eq are chainable and ignored — we pre-configure the terminal result.
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.maybeSingle = () => tables[table] ?? { data: null, error: null };
    return chain;
  };
  return { from: (table: string) => create(table) } as unknown as SupabaseClient<any>;
}

const ENV_BAK = { ...process.env };

beforeEach(() => {
  // Force a deterministic env so the `.eq("env", environment)` filter is predictable.
  process.env.MARKET_ISSUE_ENV = "dev";
});

afterEach(() => {
  process.env = { ...ENV_BAK };
});

describe("buildMarketIssueAgentContext", () => {
  describe("company event (ticker present)", () => {
    it("returns primary_tickers and routes to company_research", async () => {
      const client = makeClient({
        market_issues: {
          data: {
            id: "issue-1",
            title_ko: "AAPL 4분기 실적 발표",
            summary_ko: "매출 성장.",
            confirmed_facts: ["매출 $124B"],
            active_research_packet_id: "packet-1",
          },
          error: null,
        },
        market_issue_research_packets: {
          data: {
            payload: {
              research_context: {
                primaryTickers: ["AAPL"],
                sources: [
                  {
                    publisher: "Apple",
                    canonicalUrl: "https://x.com/Apple/status/1",
                    publishedAt: "2026-07-31T00:00:00Z",
                  },
                ],
              },
              claims: [
                { id: "rev", claim_ko: "매출 $124B", source_quote: "Revenue $124B", raw_value: "$124B" },
              ],
            },
          },
          error: null,
        },
      });

      const ctx = (await buildMarketIssueAgentContext({
        db: client,
        issueId: "issue-1",
      })) as Record<string, unknown>;

      expect(ctx.primary_tickers).toEqual(["AAPL"]);
      expect(ctx.is_macro_event).toBe(false);
      // Company brief mentions the ticker and filing baseline framing.
      const brief = ((ctx.source_pack as Record<string, unknown>).ontology_search_brief_en) as string;
      expect(brief).toContain("Official company event for AAPL");
      expect(brief).toContain("filing baseline");
    });

    it("filters out invalid tickers and uppercases the rest", async () => {
      const client = makeClient({
        market_issues: {
          data: { id: "i", title_ko: "t", summary_ko: "", confirmed_facts: [], active_research_packet_id: "p" },
          error: null,
        },
        market_issue_research_packets: {
          data: {
            payload: {
              research_context: {
                // mix of valid, lowercase, too-long, and numeric junk
                primaryTickers: ["msft", "NVDA", "TOOLONGTICKER", "123", "BRK.B"],
                sources: [],
              },
              claims: [],
            },
          },
          error: null,
        },
      });

      const ctx = (await buildMarketIssueAgentContext({ db: client, issueId: "i" })) as Record<string, unknown>;
      expect(ctx.primary_tickers).toEqual(["MSFT", "NVDA", "BRK.B"]);
      expect(ctx.is_macro_event).toBe(false);
    });
  });

  describe("macro event (no ticker)", () => {
    it("returns empty primary_tickers, is_macro_event true, and macro brief", async () => {
      const client = makeClient({
        market_issues: {
          data: {
            id: "issue-macro",
            title_ko: "연준 금리 인상 발표",
            summary_ko: "매크로 이벤트.",
            confirmed_facts: ["+25bp"],
            active_research_packet_id: "packet-macro",
          },
          error: null,
        },
        market_issue_research_packets: {
          data: {
            payload: {
              research_context: {
                primaryTickers: [],
                sources: [],
              },
              claims: [
                { id: "c1", claim_ko: "기준금리 +25bp", source_quote: "Rate +25bp", raw_value: "+25bp" },
              ],
            },
          },
          error: null,
        },
      });

      const ctx = (await buildMarketIssueAgentContext({
        db: client,
        issueId: "issue-macro",
      })) as Record<string, unknown>;

      // The key fix: no throw — flows through as a wide-research context.
      expect(ctx.primary_tickers).toEqual([]);
      expect(ctx.is_macro_event).toBe(true);
      const brief = ((ctx.source_pack as Record<string, unknown>).ontology_search_brief_en) as string;
      expect(brief).toContain("Macro market event");
      expect(brief).toContain("sector impact");
      expect(brief).not.toContain("filing baseline");
    });

    it("falls back to confirmed facts when claims/source_quote are empty", async () => {
      const client = makeClient({
        market_issues: {
          data: {
            id: "im",
            title_ko: "관세 발표",
            summary_ko: "",
            confirmed_facts: ["관세 10%", "예외 품목 있음"],
            active_research_packet_id: "pm",
          },
          error: null,
        },
        market_issue_research_packets: {
          data: {
            payload: {
              research_context: { primaryTickers: [], sources: [] },
              claims: [],
            },
          },
          error: null,
        },
      });

      const ctx = (await buildMarketIssueAgentContext({ db: client, issueId: "im" })) as Record<string, unknown>;
      const brief = ((ctx.source_pack as Record<string, unknown>).ontology_search_brief_en) as string;
      expect(brief).toContain("Confirmed facts");
      expect(brief).toContain("관세 10%");
    });
  });

  describe("error cases", () => {
    it("throws market_issue_not_available when issue row is missing", async () => {
      const client = makeClient({
        market_issues: { data: null, error: null },
        market_issue_research_packets: { data: null, error: null },
      });

      await expect(
        buildMarketIssueAgentContext({ db: client, issueId: "missing" }),
      ).rejects.toThrow(MarketIssueAgentContextError);
    });

    it("throws market_issue_packet_not_ready when packet id is absent", async () => {
      const client = makeClient({
        market_issues: {
          data: { id: "i", title_ko: "t", summary_ko: "", confirmed_facts: [], active_research_packet_id: null },
          error: null,
        },
        market_issue_research_packets: { data: null, error: null },
      });

      await expect(
        buildMarketIssueAgentContext({ db: client, issueId: "i" }),
      ).rejects.toThrow(MarketIssueAgentContextError);
    });

    it("propagates a supabase error from market_issues (not wrapped)", async () => {
      const client = makeClient({
        market_issues: { data: null, error: new Error("rpc down") },
        market_issue_research_packets: { data: null, error: null },
      });

      await expect(
        buildMarketIssueAgentContext({ db: client, issueId: "i" }),
      ).rejects.toThrow("rpc down");
    });
  });
});
