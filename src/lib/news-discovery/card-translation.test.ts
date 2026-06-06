import { describe, expect, it, vi } from "vitest";
import type { AtomicNewsEventCard } from "@/types/api-contracts";
import { translateFallbackNewsCards } from "./card-translation";

vi.mock("server-only", () => ({}));

const card = {
  id: "aapl-intel-foxconn",
  ticker: "AAPL",
  event_title:
    "Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
  original_headline:
    "Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
  short_summary:
    "Intel is teaming up with Apple supplier Foxconn to develop artificial-intelligence infrastructure, but the stock still fell.",
  price_impact_direction: "negative",
  source_previews: [
    {
      title_original:
        "Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
      title:
        "Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
      publisher: "Yahoo",
      domain: "finance.yahoo.com",
      snippet_summary:
        "Intel is teaming up with Apple supplier Foxconn to develop artificial-intelligence infrastructure, but the stock still fell.",
    },
  ],
  primary_source: {
    title_original:
      "Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
    title:
      "Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
    publisher: "Yahoo",
    domain: "finance.yahoo.com",
    snippet_summary:
      "Intel is teaming up with Apple supplier Foxconn to develop artificial-intelligence infrastructure, but the stock still fell.",
  },
  ui: {
    badge_ko: "원문 뉴스",
    confidence_label_ko: "원문 후보",
  },
} satisfies AtomicNewsEventCard;

describe("translateFallbackNewsCards", () => {
  it("adds Korean display fields while preserving original source text", async () => {
    const result = await translateFallbackNewsCards([card], {
      translateTexts: async (texts) => {
        expect(texts).toEqual([
          "Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
          "Intel is teaming up with Apple supplier Foxconn to develop artificial-intelligence infrastructure, but the stock still fell.",
        ]);
        return [
          "인텔 주가, 애플 공급업체 폭스콘과 AI 파트너십에도 하락",
          "인텔은 애플 공급업체 폭스콘과 AI 인프라 개발 협력을 발표했지만 주가는 하락했습니다.",
        ];
      },
    });

    expect(result.translation).toMatchObject({
      attempted: true,
      translated: true,
      provider: "py-googletrans",
      text_count: 2,
    });
    expect(result.cards[0]).toMatchObject({
      event_title:
        "Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
      event_title_ko:
        "인텔 주가, 애플 공급업체 폭스콘과 AI 파트너십에도 하락",
      original_headline:
        "Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
      short_summary:
        "Intel is teaming up with Apple supplier Foxconn to develop artificial-intelligence infrastructure, but the stock still fell.",
      summary_ko:
        "인텔은 애플 공급업체 폭스콘과 AI 인프라 개발 협력을 발표했지만 주가는 하락했습니다.",
      primary_source: {
        title_original:
          "Intel Stock Drops After It Scores AI Partnership With Apple Supplier Foxconn",
        title_ko:
          "인텔 주가, 애플 공급업체 폭스콘과 AI 파트너십에도 하락",
        summary_ko:
          "인텔은 애플 공급업체 폭스콘과 AI 인프라 개발 협력을 발표했지만 주가는 하락했습니다.",
      },
      ui: {
        badge_ko: "약세 요인",
        confidence_label_ko: "번역 후보",
      },
    });
  });

  it("falls back to source-language cards when translation fails", async () => {
    const result = await translateFallbackNewsCards([card], {
      translateTexts: async () => {
        throw new Error("translate failed");
      },
    });

    expect(result.translation).toMatchObject({
      attempted: true,
      translated: false,
      error: "translate failed",
    });
    expect(result.cards[0]).toBe(card);
  });
});
