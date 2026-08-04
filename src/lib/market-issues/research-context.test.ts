import { describe, expect, it } from "vitest";

import { buildMarketIssueResearchContext } from "@/lib/market-issues/research-context";

describe("market issue research context", () => {
  it("uses curated source tags for an earnings research route", () => {
    const context = buildMarketIssueResearchContext({
      claims: [{ id: "revenue", claimKo: "FY26 매출은 $331B+입니다.", rawValue: "$331B+", evidenceIds: ["image:1"] }],
      sources: [{
        sourceItemId: "source-1",
        publisher: "Microsoft",
        authorHandle: "Microsoft",
        sourceTags: ["MSFT"],
        canonicalUrl: "https://x.com/Microsoft/status/1",
        publishedAt: "2026-07-31T00:00:00.000Z",
      }],
    });

    expect(context.primaryTickers).toEqual(["MSFT"]);
    expect(context.tickerResolution).toEqual([{ ticker: "MSFT", method: "source_tag" }]);
    expect(context.eventType).toBe("earnings");
    expect(context.route).toBe("company_event_impact");
  });

  it("uses an official handle fallback for a source without ticker tags", () => {
    const context = buildMarketIssueResearchContext({
      claims: [{ id: "contracts", claimKo: "Ether 선물 상품군은 80.8M 계약이 거래되었다.", rawValue: "80.8M", evidenceIds: ["image:2"] }],
      sources: [{
        sourceItemId: "source-2",
        publisher: "CME Group",
        authorHandle: "CMEGroup",
        sourceTags: [],
        canonicalUrl: "https://x.com/CMEGroup/status/2",
        publishedAt: "2026-07-31T00:00:00.000Z",
      }],
    });

    expect(context.primaryTickers).toEqual(["CME"]);
    expect(context.tickerResolution).toEqual([{ ticker: "CME", method: "official_handle" }]);
    expect(context.eventType).toBe("product_activity");
    expect(context.checkpointsKo).toContain("활동이 수수료·매출로 이어지는 경로");
  });
});
