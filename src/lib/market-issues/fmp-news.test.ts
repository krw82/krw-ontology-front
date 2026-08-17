import { describe, expect, it } from "vitest";

import { filterFmpArticlesForIngest, parseFmpNewsArticles } from "@/lib/market-issues/web-ingestion";

const NOW = new Date("2026-08-17T12:00:00.000Z");

function article(overrides: Partial<ReturnType<typeof parseFmpNewsArticles>[number]> = {}) {
  return {
    ticker: "AAPL",
    title: "Apple announces new chip",
    body: "Apple announced a new chip today. The company expects volume production next quarter.",
    url: "https://www.example.com/news/apple-chip",
    site: "Reuters",
    image: "https://www.example.com/img.jpg",
    publishedAt: "2026-08-17T10:00:00.000Z",
    ...overrides,
  };
}

describe("parseFmpNewsArticles", () => {
  it("parses the documented /stable/news/stock-news payload", () => {
    const parsed = parseFmpNewsArticles([
      {
        symbol: "aapl",
        publishedDate: "2026-08-17 10:00:00",
        title: " Apple announces new chip ",
        text: "Apple announced a new chip today.",
        url: "https://www.example.com/news/apple-chip",
        site: "Reuters",
        image: "https://www.example.com/img.jpg",
      },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].ticker).toBe("AAPL");
    expect(parsed[0].title).toBe("Apple announces new chip");
    expect(parsed[0].publishedAt).toBe("2026-08-17T10:00:00.000Z");
  });

  it("accepts snake_case field variants", () => {
    const parsed = parseFmpNewsArticles([
      {
        ticker: "MSFT",
        published_date: "2026-08-17T09:00:00Z",
        headline: "Microsoft cloud growth",
        content: "Azure revenue grew 30% year over year.",
        link: "https://www.example.com/msft",
      },
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].ticker).toBe("MSFT");
    expect(parsed[0].site).toBeNull();
  });

  it("drops entries missing url, body, ticker, or a parseable date", () => {
    const parsed = parseFmpNewsArticles([
      { symbol: "AAPL", publishedDate: "not-a-date", title: "t", text: "b", url: "https://a.example/1" },
      { symbol: "", publishedDate: "2026-08-17T09:00:00Z", title: "t", text: "b", url: "https://a.example/2" },
      { symbol: "AAPL", publishedDate: "2026-08-17T09:00:00Z", title: "t", text: "", url: "https://a.example/3" },
      { symbol: "AAPL", publishedDate: "2026-08-17T09:00:00Z", title: "t", text: "b", url: "" },
    ]);
    expect(parsed).toHaveLength(0);
  });

  it("returns empty for non-array payloads", () => {
    expect(parseFmpNewsArticles({ Error: "rate limited" })).toEqual([]);
    expect(parseFmpNewsArticles(null)).toEqual([]);
  });
});

describe("filterFmpArticlesForIngest", () => {
  it("keeps fresh known-ticker articles and caps volume", () => {
    const articles = [
      article(),
      article({ ticker: "MSFT", url: "https://www.example.com/news/msft" }),
      article({ url: "https://www.example.com/news/apple-2" }),
    ];
    const filtered = filterFmpArticlesForIngest(articles, {
      now: NOW,
      maxAgeHours: 72,
      maxItems: 2,
      knownTickers: new Set(["AAPL", "MSFT"]),
    });
    expect(filtered.accepted).toHaveLength(2);
    expect(filtered.skippedStale).toBe(0);
    expect(filtered.skippedUnknownTicker).toBe(0);
  });

  it("skips stale and unknown-ticker articles", () => {
    const articles = [
      article({ url: "https://www.example.com/old", publishedAt: "2026-08-01T10:00:00.000Z" }),
      article({ ticker: "ROIV", url: "https://www.example.com/unknown" }),
    ];
    const filtered = filterFmpArticlesForIngest(articles, {
      now: NOW,
      maxAgeHours: 72,
      maxItems: 10,
      knownTickers: new Set(["AAPL"]),
    });
    expect(filtered.accepted).toHaveLength(0);
    expect(filtered.skippedStale).toBe(1);
    expect(filtered.skippedUnknownTicker).toBe(1);
  });

  it("rejects non-http(s) urls and dedupes within a cycle", () => {
    const articles = [
      article({ url: "javascript:alert(1)" }),
      article(),
      article({ url: "https://www.example.com/news/apple-chip#" }),
    ];
    const filtered = filterFmpArticlesForIngest(articles, {
      now: NOW,
      maxAgeHours: 72,
      maxItems: 10,
      knownTickers: new Set(["AAPL"]),
    });
    expect(filtered.skippedInvalidUrl).toBe(1);
    expect(filtered.accepted).toHaveLength(1);
  });
});
