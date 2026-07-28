import { describe, expect, it } from "vitest";
import type { InstitutionalHoldingView } from "@/lib/sec-13f/types";
import { quarterlyStoryCopy } from "./story-copy";

function holding(
  ticker: string | null,
  displayName: string,
): InstitutionalHoldingView {
  return {
    id: (ticker ?? displayName) + "-id",
    issuerName: displayName,
    displayName,
    titleOfClass: "COM",
    cusip: "000000000",
    ticker,
    valueUsd: 0,
    shares: null,
    sharesChange: null,
    sharesChangePct: null,
    portfolioWeight: 0,
    previousPortfolioWeight: null,
    portfolioWeightChange: null,
    previousValueUsd: null,
    valueChangeUsd: null,
    valueChangePct: null,
    changeType: "unchanged",
    chatHref: null,
  };
}

describe("quarterlyStoryCopy", () => {
  it("summarizes the leading increase and decrease without adding an investment interpretation", () => {
    expect(
      quarterlyStoryCopy({
        hasPreviousFiling: true,
        buys: [holding("XOM", "Exxon Mobil")],
        sells: [holding("MSFT", "Microsoft")],
      }),
    ).toBe("XOM의 보유 비중은 늘고, MSFT의 보유 비중은 줄었습니다.");
  });

  it("uses a clear fallback when comparison data is not available", () => {
    expect(
      quarterlyStoryCopy({
        hasPreviousFiling: false,
        buys: [holding("XOM", "Exxon Mobil")],
        sells: [holding("MSFT", "Microsoft")],
      }),
    ).toContain("비교할 데이터가 아직 없습니다");
  });

  it("falls back to a company name when a ticker is unavailable", () => {
    expect(
      quarterlyStoryCopy({
        hasPreviousFiling: true,
        buys: [holding(null, "예시 회사")],
        sells: [],
      }),
    ).toBe("예시 회사의 보유 비중이 가장 크게 늘었습니다.");
  });
});
