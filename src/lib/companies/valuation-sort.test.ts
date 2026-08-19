import { describe, expect, it } from "vitest";
import {
  compareCompaniesByValuation,
  DEFAULT_VALUATION_SORT_DIRECTION,
  formatValuationMarketCap,
  formatValuationPercent,
  formatValuationRatio,
  sortCompaniesByValuation,
  type CompanyValuationMetrics,
} from "@/lib/companies/valuation-sort";

function metrics(
  ticker: string,
  values: Partial<CompanyValuationMetrics>,
): { ticker: string; valuation: CompanyValuationMetrics } {
  return {
    ticker,
    valuation: {
      ticker,
      market_cap: null,
      pe_ttm: null,
      pb: null,
      roe_ttm: null,
      fundamental_period_end: null,
      computed_at: null,
      ...values,
    },
  };
}

describe("compareCompaniesByValuation", () => {
  it("sorts by the requested metric in ascending order", () => {
    const cheap = metrics("CHEAP", { pe_ttm: 8.2 });
    const rich = metrics("RICH", { pe_ttm: 72.45 });
    expect(
      compareCompaniesByValuation(cheap, rich, "pe_ttm", "asc"),
    ).toBeLessThan(0);
  });

  it("reverses for descending order", () => {
    const small = metrics("SMALL", { market_cap: 1e9 });
    const huge = metrics("HUGE", { market_cap: 4.5e12 });
    expect(
      compareCompaniesByValuation(huge, small, "market_cap", "desc"),
    ).toBeLessThan(0);
  });

  it("always sinks null metrics to the bottom regardless of direction", () => {
    const abbv = metrics("ABBV", { pe_ttm: 72.45 }); // PBR 없음(자본잡식)
    const valued = metrics("AAPL", { pb: 42.35 });
    expect(compareCompaniesByValuation(abbv, valued, "pb", "asc")).toBe(1);
    expect(compareCompaniesByValuation(abbv, valued, "pb", "desc")).toBe(1);
    expect(compareCompaniesByValuation(valued, abbv, "pb", "asc")).toBe(-1);
  });

  it("treats companies without any valuation row as null", () => {
    const uncovered = { ticker:"UNCOVERED" } as { ticker: string; valuation?: CompanyValuationMetrics | null };
    const covered = metrics("COVERED", { roe_ttm: 0.12 });
    expect(compareCompaniesByValuation(uncovered, covered, "roe_ttm", "desc")).toBe(1);
  });

  it("keeps null-vs-null equal", () => {
    const a = metrics("A", {});
    const b = metrics("B", {});
    expect(compareCompaniesByValuation(a, b, "pe_ttm", "asc")).toBe(0);
  });
});

describe("sortCompaniesByValuation", () => {
  it("returns a reordered copy without mutating the input", () => {
    const input = [
      metrics("MID", { pe_ttm: 20 }),
      metrics("HIGH", { pe_ttm: 50 }),
      metrics("NONE", {}),
      metrics("LOW", { pe_ttm: 5 }),
    ];
    const sorted = sortCompaniesByValuation(input, "pe_ttm", "asc");
    expect(sorted.map((item) => item.ticker)).toEqual([
      "LOW",
      "MID",
      "HIGH",
      "NONE",
    ]);
    expect(input[0].ticker).toBe("MID");
  });

  it("places nulls last even when sorting descending", () => {
    const sorted = sortCompaniesByValuation(
      [
        metrics("NULL1", {}),
        metrics("ROE90", { roe_ttm: 0.9 }),
        metrics("ROE10", { roe_ttm: 0.1 }),
      ],
      "roe_ttm",
      "desc",
    );
    expect(sorted.map((item) => item.ticker)).toEqual([
      "ROE90",
      "ROE10",
      "NULL1",
    ]);
  });
});

describe("formatters", () => {
  it("formats USD market cap in Korean units", () => {
    expect(formatValuationMarketCap(4_553_520_980_680, "ko")).toBe("$4.55조");
    expect(formatValuationMarketCap(457_457_997_213, "ko")).toBe("$4,575억");
    expect(formatValuationMarketCap(2_300_000_000, "ko")).toBe("$23억");
    expect(formatValuationMarketCap(null, "ko")).toBe("N/A");
  });

  it("formats USD market cap in English units", () => {
    expect(formatValuationMarketCap(4_553_520_980_680, "en")).toBe("$4.55T");
    expect(formatValuationMarketCap(457_457_997_213, "en")).toBe("$457.5B");
    expect(formatValuationMarketCap(null, "en")).toBe("N/A");
  });

  it("formats multiples and percents, mapping null to N/A", () => {
    expect(formatValuationRatio(35.32)).toBe("35.3×");
    expect(formatValuationRatio(null)).toBe("N/A");
    expect(formatValuationPercent(1.204891)).toBe("120.5%");
    expect(formatValuationPercent(null)).toBe("N/A");
  });
});

describe("DEFAULT_VALUATION_SORT_DIRECTION", () => {
  it("prefers cheap multiples, big caps, and high ROE", () => {
    expect(DEFAULT_VALUATION_SORT_DIRECTION).toEqual({
      market_cap: "desc",
      pe_ttm: "asc",
      pb: "asc",
      roe_ttm: "desc",
    });
  });
});
