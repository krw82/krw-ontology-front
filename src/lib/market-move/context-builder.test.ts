import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildMarketMoveContext } from "./context-builder";

describe("market move context builder", () => {
  it("builds a compact ontology bridge from Yahoo Finance snapshot data", async () => {
    const context = await buildMarketMoveContext({
      ticker: "GOOGL",
      companyName: "Alphabet Inc.",
      userQuestion: "GOOGL 주가가 왜 6% 빠졌어?",
      now: new Date("2026-06-24T00:00:00.000Z"),
      fetchSnapshot: vi.fn().mockResolvedValue({
        stockInfo: {
          longName: "Alphabet Inc.",
          currentPrice: 94,
          regularMarketPreviousClose: 100,
          regularMarketChange: -6,
          regularMarketChangePercent: -6,
          regularMarketVolume: 1200,
          averageVolume: 1000,
          marketState: "REGULAR",
          currency: "USD",
        },
        historicalPrices: [],
        news: [
          {
            title: "Alphabet shares fall on AI spending concerns",
            summary: "Investors focused on capex pressure.",
            description: null,
            url: "https://finance.yahoo.com/news/alphabet-ai-spending",
            source_domain: "finance.yahoo.com",
            published_at: null,
            relevance_note: "Recent ticker news candidate.",
          },
        ],
      }),
    });

    expect(context).toMatchObject({
      version: "market-move-context/v1",
      ticker: "GOOGL",
      company_name: "Alphabet Inc.",
      status: "ok",
      market_observation: {
        direction: "down",
        requested_percent_move: 6,
        percent_change: -6,
        volume_signal: "above_average",
      },
    });
    expect(context.source_pack.ontology_search_brief_en).toContain(
      "Recent market/news candidates",
    );
    expect(context.source_pack.source_urls).toEqual([
      "https://finance.yahoo.com/news/alphabet-ai-spending",
    ]);
  });

  it("returns a partial context when the provider is unavailable", async () => {
    const context = await buildMarketMoveContext({
      ticker: "AAPL",
      userQuestion: "AAPL 주가 왜 빠졌어?",
      now: new Date("2026-06-24T00:00:00.000Z"),
      fetchSnapshot: vi.fn().mockRejectedValue(new Error("uvx not found")),
    });

    expect(context.status).toBe("partial");
    expect(context.provider).toMatchObject({
      name: "yahoo-finance-mcp",
      status: "unavailable",
      error: "uvx not found",
    });
    expect(context.source_pack.ontology_search_brief_en).toContain(
      "Provider data was partial/unavailable",
    );
  });
});
