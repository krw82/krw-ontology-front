import { describe, expect, it } from "vitest";
import {
  displayableMarketNewsUrl,
  extractPreferredSourceUrls,
  filterPreferredMarketSources,
  isPreferredMarketNewsSource,
  isPreferredMarketNewsUrl,
} from "./source-policy";

describe("news discovery source policy", () => {
  it("allows preferred market-news domains and rejects filings or weak portals", () => {
    expect(isPreferredMarketNewsUrl("https://www.reuters.com/markets/aapl")).toBe(true);
    expect(isPreferredMarketNewsUrl("https://finance.yahoo.com/news/mu")).toBe(true);
    expect(isPreferredMarketNewsUrl("https://www.sec.gov/ixviewer/doc")).toBe(false);
    expect(isPreferredMarketNewsUrl("https://www.tradingview.com/news/aapl")).toBe(false);
    expect(isPreferredMarketNewsUrl("https://www.barchart.com/stocks/quotes/MU")).toBe(false);
  });

  it("filters nested raw search results to preferred source articles only", () => {
    const filtered = filterPreferredMarketSources({
      articles: [
        { title: "Reuters headline", url: "https://www.reuters.com/a" },
        { title: "SEC filing", url: "https://www.sec.gov/a" },
      ],
      cards: [
        {
          id: "good",
          source_previews: [
            { title_original: "CNBC title", url: "https://www.cnbc.com/a" },
          ],
        },
        {
          id: "bad",
          source_previews: [
            { title_original: "Barchart title", url: "https://www.barchart.com/a" },
          ],
        },
      ],
    });

    expect(filtered.articles).toEqual([
      { title: "Reuters headline", url: "https://www.reuters.com/a" },
    ]);
    expect(filtered.cards).toEqual([
      {
        id: "good",
        source_previews: [
          { title_original: "CNBC title", url: "https://www.cnbc.com/a" },
        ],
      },
    ]);
  });

  it("extracts reader URLs only from preferred market-news sources", () => {
    expect(
      extractPreferredSourceUrls({
        id: "event-1",
        primary_source: { url: "https://www.marketwatch.com/story/a" },
        source_previews: [
          { url: "https://www.sec.gov/doc" },
          { url: "https://apnews.com/article/a" },
        ],
      }),
    ).toEqual([
      "https://www.marketwatch.com/story/a",
      "https://apnews.com/article/a",
    ]);
  });

  it("keeps Finnhub proxy sources only as source metadata, not reader links", () => {
    const source = {
      publisher: "Yahoo",
      url: "https://finnhub.io/api/news?id=abc",
    };

    expect(isPreferredMarketNewsSource(source)).toBe(true);
    expect(isPreferredMarketNewsUrl(source.url)).toBe(false);
    expect(displayableMarketNewsUrl(source.url)).toBeUndefined();
    expect(
      extractPreferredSourceUrls({
        primary_source: source,
        source_previews: [source],
      }),
    ).toEqual([]);
  });
});
