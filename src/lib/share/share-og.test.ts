import { describe, expect, it, vi } from "vitest";
import type { PublicMessageShare } from "@/lib/share/message-share";
import {
  buildShareCanonicalUrl,
  buildShareOgCopy,
  buildShareOgImagePath,
  buildShareOgImageUrl,
} from "@/lib/share/share-og";

vi.mock("@/lib/marketing/site", () => ({
  SITE_NAME: "KRW Ontology",
  absoluteUrl: (pathname = "/") => `https://krwontology.test${pathname}`,
}));

function shareFixture(overrides: Partial<PublicMessageShare> = {}): PublicMessageShare {
  return {
    token: "share-token",
    title: "AI 모멘텀만 따지면 마이크론이 최고지",
    question_content: "AI 데이터센터 투자에서 MU가 가장 수혜를 받는지 분석해줘.",
    question_created_at: "2026-06-21T00:00:00.000Z",
    question_attachments: { urls: [], files: [] },
    answer_content: "공유된 답변입니다.",
    answer_created_at: "2026-06-21T00:01:00.000Z",
    tickers: ["MU"],
    created_at: "2026-06-21T00:02:00.000Z",
    locale: "ko",
    ...overrides,
  };
}

describe("share OG helpers", () => {
  it("builds deterministic OG image paths and URLs", () => {
    expect(buildShareOgImagePath("abc/def")).toBe("/api/share/abc%2Fdef/og");
    expect(buildShareOgImageUrl("abc")).toBe("https://krwontology.test/api/share/abc/og");
    expect(buildShareCanonicalUrl("abc", "ko")).toBe("https://krwontology.test/share/abc");
    expect(buildShareCanonicalUrl("abc", "en")).toBe("https://krwontology.test/en/share/abc");
  });

  it("maps title, ticker, company name, brand, and question into image copy", () => {
    const copy = buildShareOgCopy(shareFixture(), "Micron Technology, Inc.");

    expect(copy.title).toBe("AI 모멘텀만 따지면 마이크론이 최고지");
    expect(copy.primaryTicker).toBe("MU");
    expect(copy.companyName).toBe("Micron Technology, Inc.");
    expect(copy.tickerLine).toBe("MU · Micron Technology, Inc.");
    expect(copy.brandName).toBe("KRW Ontology");
    expect(copy.description).toBe("AI 데이터센터 투자에서 MU가 가장 수혜를 받는지 분석해줘.");
  });

  it("removes trailing filing-basis text from preview titles", () => {
    const copy = buildShareOgCopy(
      shareFixture({
        title: "인텔(CY2026Q1 10-Q, CY2025 10-K 기준)",
        tickers: ["INTC"],
      }),
      "Intel Corporation",
    );

    expect(copy.title).toBe("인텔 리서치 답변");
    expect(copy.alt).toBe("인텔 리서치 답변 | KRW Ontology");
  });

  it("removes non-parenthesized document-basis text from preview titles", () => {
    const copy = buildShareOgCopy(
      shareFixture({
        title: "인텔 - 문서 10-Q 기준",
        tickers: ["INTC"],
      }),
      "Intel Corporation",
    );

    expect(copy.title).toBe("인텔 리서치 답변");
  });

  it("removes English filing-basis text from preview titles", () => {
    const copy = buildShareOgCopy(
      shareFixture({
        title: "Intel (CY2026Q1 10-Q, CY2025 10-K basis)",
        locale: "en",
        tickers: ["INTC"],
      }),
      "Intel Corporation",
    );

    expect(copy.title).toBe("Intel research answer");
  });

  it("falls back without company or question content", () => {
    const copy = buildShareOgCopy(
      shareFixture({
        question_content: null,
        tickers: null,
      }),
    );

    expect(copy.tickerLine).toBe("공시 기반 리서치");
    expect(copy.description).toBe("KRW Ontology에서 공유된 공시 기반 리서치 답변입니다.");
  });

  it("does not duplicate ticker-like company names", () => {
    const copy = buildShareOgCopy(shareFixture({ tickers: ["AAPL"] }), "AAPL");

    expect(copy.primaryTicker).toBe("AAPL");
    expect(copy.companyName).toBeNull();
    expect(copy.tickerLine).toBe("AAPL");
  });
});
