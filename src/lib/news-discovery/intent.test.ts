import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/news-discovery/stock-news-client", () => ({
  resolveNewsEntities: vi.fn(),
}));

import { resolveNewsEntities } from "@/lib/news-discovery/stock-news-client";
import {
  buildEnglishSearchQuestion,
  buildNewsDiscoveryIntent,
  inferPriceMoveDirection,
} from "./intent";

describe("news discovery intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("detects Korean price move direction", () => {
    expect(inferPriceMoveDirection("오늘 왜 떨어져?")).toBe("down");
    expect(inferPriceMoveDirection("왜 이렇게 올랐어?")).toBe("up");
    expect(inferPriceMoveDirection("최근 이슈 뭐야?")).toBe("unknown");
  });

  it("uses session ticker and resolved company to build an English market-news query", async () => {
    vi.mocked(resolveNewsEntities).mockResolvedValue({
      entities: [
        {
          ticker: "MU",
          company_name: "Micron Technology",
          ontology_ticker: "MU",
        },
      ],
      period: { lookback_hours: 72 },
    });

    const intent = await buildNewsDiscoveryIntent({
      question: "오늘 왜 떨어져?",
      session: {
        id: "session-1",
        userId: "user-1",
        scopeType: "company",
        defaultTickers: ["MU"],
        defaultDocumentTypes: [],
      },
    });

    expect(resolveNewsEntities).toHaveBeenCalledWith({
      question: "오늘 왜 떨어져?",
      tickers: ["MU"],
    });
    expect(intent).toMatchObject({
      ticker: "MU",
      companyName: "Micron Technology",
      direction: "down",
      lookbackHours: 72,
    });
    expect(intent.englishQuestion).toContain("MU Micron Technology");
    expect(intent.englishQuestion).toContain("why shares are falling");
    expect(intent.englishQuestion).toContain("Reuters Bloomberg CNBC");
  });

  it("keeps English search source hints even when no ticker is resolved", () => {
    const query = buildEnglishSearchQuestion({
      originalQuestion: "반도체 왜 약세야?",
      direction: "down",
    });

    expect(query).toContain("why shares are falling");
    expect(query).toContain("Yahoo Finance Google News");
  });
});
