import { describe, expect, it } from "vitest";
import {
  compareCompaniesByValuation,
  DEFAULT_VALUATION_SORT_DIRECTION,
  formatValuationMarketCap,
  formatValuationPercent,
  formatValuationRatio,
  sortCompaniesByValuation,
  valuationSortChipLabel,
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
      roic_ttm: null,
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

describe("valuationSortChipLabel", () => {
  it("labels the default sort without a direction", () => {
    expect(valuationSortChipLabel("default", "desc", "ko")).toBe("기본순");
    expect(valuationSortChipLabel("default", "desc", "en")).toBe("Default");
  });

  it("states the low direction for the default ascending metrics", () => {
    expect(valuationSortChipLabel("pe_ttm", "asc", "ko")).toBe("PER 낮은순");
    expect(valuationSortChipLabel("pb", "asc", "ko")).toBe("PBR 낮은순");
    expect(valuationSortChipLabel("pe_ttm", "asc", "en")).toBe("Low P/E");
    expect(valuationSortChipLabel("pb", "asc", "en")).toBe("Low P/B");
  });

  it("states the high direction when a chip is toggled to descending", () => {
    expect(valuationSortChipLabel("pe_ttm", "desc", "ko")).toBe("PER 높은순");
    expect(valuationSortChipLabel("pb", "desc", "ko")).toBe("PBR 높은순");
    expect(valuationSortChipLabel("pe_ttm", "desc", "en")).toBe("High P/E");
    expect(valuationSortChipLabel("pb", "desc", "en")).toBe("High P/B");
  });

  it("states the high direction for the default descending metrics", () => {
    expect(valuationSortChipLabel("market_cap", "desc", "ko")).toBe("시총 높은순");
    expect(valuationSortChipLabel("roe_ttm", "desc", "ko")).toBe("ROE 높은순");
    expect(valuationSortChipLabel("roic_ttm", "desc", "ko")).toBe("ROIC 높은순");
    expect(valuationSortChipLabel("market_cap", "desc", "en")).toBe("High market cap");
    expect(valuationSortChipLabel("roe_ttm", "desc", "en")).toBe("High ROE");
    expect(valuationSortChipLabel("roic_ttm", "desc", "en")).toBe("High ROIC");
  });

  it("states the low direction when a descending metric is toggled to ascending", () => {
    expect(valuationSortChipLabel("market_cap", "asc", "ko")).toBe("시총 낮은순");
    expect(valuationSortChipLabel("roe_ttm", "asc", "ko")).toBe("ROE 낮은순");
    expect(valuationSortChipLabel("roic_ttm", "asc", "ko")).toBe("ROIC 낮은순");
    expect(valuationSortChipLabel("market_cap", "asc", "en")).toBe("Low market cap");
    expect(valuationSortChipLabel("roe_ttm", "asc", "en")).toBe("Low ROE");
    expect(valuationSortChipLabel("roic_ttm", "asc", "en")).toBe("Low ROIC");
  });

  it("names a direction for every metric chip in both locales", () => {
    const metricKeys = Object.keys(
      DEFAULT_VALUATION_SORT_DIRECTION,
    ) as Array<keyof typeof DEFAULT_VALUATION_SORT_DIRECTION>;
    for (const key of metricKeys) {
      for (const direction of ["asc", "desc"] as const) {
        const ko = valuationSortChipLabel(key, direction, "ko");
        const en = valuationSortChipLabel(key, direction, "en");
        expect(ko, `${key}/${direction}/ko`).toMatch(/낮은순$|높은순$/);
        expect(en, `${key}/${direction}/en`).toMatch(/^Low |^High /);
      }
    }
  });
});

describe("DEFAULT_VALUATION_SORT_DIRECTION", () => {
  it("prefers cheap multiples, big caps, and high returns", () => {
    expect(DEFAULT_VALUATION_SORT_DIRECTION).toEqual({
      market_cap: "desc",
      pe_ttm: "asc",
      pb: "asc",
      roe_ttm: "desc",
      roic_ttm: "desc",
    });
  });

  it("sorts ROIC descending with nulls last", () => {
    const sorted = sortCompaniesByValuation(
      [
        metrics("NOISY", { roic_ttm: null }),
        metrics("ALPHA", { roic_ttm: 0.83 }),
        metrics("BETA", { roic_ttm: 0.16 }),
      ],
      "roic_ttm",
      "desc",
    );
    expect(sorted.map((item) => item.ticker)).toEqual([
      "ALPHA",
      "BETA",
      "NOISY",
    ]);
  });
});
