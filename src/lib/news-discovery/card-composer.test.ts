import { describe, expect, it, vi } from "vitest";
import { composeNewsDiscoveryCards } from "./card-composer";
import type { NewsDiscoverySearchResult } from "./types";

vi.mock("server-only", () => ({}));

const discovery = {
  intent: {
    originalQuestion: "AAPL 오늘 왜 떨어져?",
    englishQuestion: "AAPL why is the stock down today?",
    direction: "down",
    ticker: "AAPL",
    companyName: "Apple",
    resolvedEntities: [{ ticker: "AAPL" }],
    lookbackHours: 168,
  },
  selectedSourcePolicy: {
    allowed_domains: ["finance.yahoo.com"],
    excluded_domains: ["sec.gov"],
    market_news_only: true,
  },
  rawSearchResult: {
    articles: [
      {
        title:
          "Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
        snippet:
          "Intel is teaming up with Apple supplier Foxconn to develop artificial-intelligence infrastructure, but the stock still fell.",
        url: "https://finance.yahoo.com/news/intel-apple-foxconn-ai",
        source_name: "Yahoo",
        source_domain: "finance.yahoo.com",
        published_at: "2026-06-04T12:00:00.000Z",
      },
    ],
  },
} satisfies NewsDiscoverySearchResult;

describe("composeNewsDiscoveryCards", () => {
  it("uses translated fallback cards by default instead of the slow structured composer", async () => {
    const composition = await composeNewsDiscoveryCards(discovery, {
      translateTexts: async () => [
        "인텔 주가, 애플 공급업체 폭스콘과 AI 협력에도 하락",
        "인텔은 폭스콘과 AI 인프라 협력을 발표했지만 주가는 하락했습니다.",
      ],
    });

    expect(composition.cards).toHaveLength(1);
    expect(composition.cards[0]).toMatchObject({
      ticker: "AAPL",
      event_title:
        "Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
      event_title_ko:
        "인텔 주가, 애플 공급업체 폭스콘과 AI 협력에도 하락",
      original_headline:
        "Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
      summary_ko:
        "인텔은 폭스콘과 AI 인프라 협력을 발표했지만 주가는 하락했습니다.",
      ontology_bridge_brief_en: {
        event: expect.stringContaining("negative share-price reaction"),
      },
    });
    expect(composition.raw_model_output).toMatchObject({
      fallback: true,
      translation: {
        translated: true,
      },
    });
  });
});
