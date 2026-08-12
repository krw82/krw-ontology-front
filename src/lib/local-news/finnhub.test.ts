import { describe, expect, it, vi } from "vitest";

import { FinnhubNewsProvider, toLocalNewsArticle } from "@/lib/local-news/finnhub";

describe("FinnhubNewsProvider", () => {
  it("normalizes valid provider articles and removes duplicate payloads", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify([
      {
        id: 1,
        headline: "Company reports results",
        summary: "Revenue was $100 million.",
        url: "https://example.com/article",
        datetime: 1_704_067_200,
      },
      {
        id: 1,
        headline: "Company reports results",
        summary: "Revenue was $100 million.",
        url: "https://example.com/article",
        datetime: 1_704_067_200,
      },
      { id: 2, headline: "missing required fields" },
    ]), { status: 200 }));
    const provider = new FinnhubNewsProvider({ apiKey: "test-key", fetchImpl });

    const articles = await provider.fetchCompanyNews({
      ticker: "aapl",
      from: new Date("2024-01-01T00:00:00Z"),
      to: new Date("2024-01-02T00:00:00Z"),
      timeoutMs: 1_000,
      maxItems: 8,
    });

    expect(articles).toHaveLength(1);
    expect(articles[0]).toMatchObject({ ticker: "AAPL", articleId: "1" });
    expect(fetchImpl.mock.calls[0][0].toString()).toContain("symbol=AAPL");
  });

  it("keeps only articles inside the exact requested time range", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify([
      { id: 1, headline: "Old", summary: "Old summary", url: "https://example.com/old", datetime: 1_704_067_199 },
      { id: 2, headline: "Current", summary: "Current summary", url: "https://example.com/current", datetime: 1_704_067_200 },
    ]), { status: 200 }));
    const provider = new FinnhubNewsProvider({ apiKey: "test-key", fetchImpl });

    const articles = await provider.fetchCompanyNews({
      ticker: "AAPL",
      from: new Date("2024-01-01T00:00:00Z"),
      to: new Date("2024-01-02T00:00:00Z"),
      timeoutMs: 1_000,
      maxItems: 4,
    });

    expect(articles.map((article) => article.articleId)).toEqual(["2"]);
  });

  it("classifies 429 responses and reads the provider reset time", async () => {
    const resetEpochSeconds = Math.floor(Date.now() / 1_000) + 2;
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("rate limited", {
      status: 429,
      headers: { "x-ratelimit-reset": String(resetEpochSeconds) },
    }));
    const provider = new FinnhubNewsProvider({ apiKey: "test-key", fetchImpl });

    await expect(provider.fetchCompanyNews({
      ticker: "AAPL",
      from: new Date("2024-01-01T00:00:00Z"),
      to: new Date("2024-01-02T00:00:00Z"),
      timeoutMs: 1_000,
      maxItems: 4,
    })).rejects.toMatchObject({
      kind: "rate_limited",
      status: 429,
    });
  });

  it("does not accept provider rows without a secure URL and source text", () => {
    expect(toLocalNewsArticle("AAPL", {
      id: 1,
      headline: "Headline",
      summary: "Summary",
      url: "http://example.com/article",
      datetime: 1_700_000_000,
    })).toBeNull();
  });
});
