import { describe, expect, it } from "vitest";
import { computeValuation } from "./calculator";
import type { FundamentalInputs, PriceSnapshot } from "./types";

function makePrice(overrides: Partial<PriceSnapshot> = {}): PriceSnapshot {
  return {
    ticker: "TEST",
    sessionDate: "2026-08-08",
    priceType: "regular_close",
    price: 100,
    currency: "USD",
    provider: "fmp",
    observedAt: "2026-08-08T22:00:00.000Z",
    providerReference: null,
    qualityFlags: [],
    ...overrides,
  };
}

function makeFundamentals(overrides: Partial<FundamentalInputs> = {}): FundamentalInputs {
  return {
    ticker: "TEST",
    cik: null,
    availableAt: "2026-08-01T00:00:00.000Z",
    periodEnd: "2026-06-30",
    filingDate: null,
    formType: null,
    accessionNumbers: [],
    currency: "USD",
    dilutedEpsTtm: 5,
    netIncomeCommonTtm: 1_000_000_000,
    revenueTtm: 10_000_000_000,
    costOfRevenueTtm: 4_000_000_000,
    operatingIncomeTtm: 1_500_000_000,
    incomeBeforeTaxTtm: 1_300_000_000,
    incomeTaxExpenseTtm: 260_000_000,
    operatingCashFlowTtm: 2_000_000_000,
    capitalExpendituresTtm: 500_000_000,
    freeCashFlowTtm: 1_500_000_000,
    commonEquity: 5_000_000_000,
    totalAssets: 12_000_000_000,
    totalCurrentAssets: 3_000_000_000,
    totalCurrentLiabilities: 1_500_000_000,
    accountsReceivable: 800_000_000,
    inventory: 600_000_000,
    accountsPayable: 500_000_000,
    sharesOutstanding: 200_000_000,
    cashAndEquivalents: 1_000_000_000,
    totalDebt: 2_000_000_000,
    previousPeriodEnd: "2026-03-31",
    previousCommonEquity: 4_800_000_000,
    previousTotalAssets: 11_500_000_000,
    previousCashAndEquivalents: 900_000_000,
    previousTotalDebt: 2_100_000_000,
    previousAccountsReceivable: 700_000_000,
    previousInventory: 550_000_000,
    previousAccountsPayable: 450_000_000,
    inputLineage: {},
    qualityFlags: [],
    normalizationVersion: "test",
    provider: "fmp",
    ...overrides,
  };
}

describe("computeValuation", () => {
  it("computes PER, PBR, FCF yield for a healthy company", () => {
    const result = computeValuation({
      ticker: "TEST",
      price: makePrice({ price: 100 }),
      fundamentals: makeFundamentals(),
      marketCap: 20_000_000_000,
      fundamentalSnapshotId: "fs-1",
      priceSnapshotId: "ps-1",
    });

    // PER = market_cap / net_income = 20B / 1B = 20
    expect(result.peTtm).toBe(20);
    // PBR = market_cap / equity = 20B / 5B = 4
    expect(result.pb).toBe(4);
    // FCF yield = fcf / market_cap = 1.5B / 20B = 0.075
    expect(result.fcfYield).toBeCloseTo(0.075, 4);
    expect(result.referencePrice).toBe(100);
    expect(result.currency).toBe("USD");
    expect(result.epsTtmDiluted).toBe(5);
    expect(result.metricStatuses.pe_ttm?.status).toBe("ok");
    expect(result.metricStatuses.pb?.status).toBe("ok");
  });

  it("computes ROE, ROA, ROIC, current ratio, and CCC from TTM plus two balances", () => {
    const result = computeValuation({
      ticker: "TEST",
      price: makePrice(),
      fundamentals: makeFundamentals(),
      marketCap: 20_000_000_000,
      fundamentalSnapshotId: null,
      priceSnapshotId: null,
    });

    // ROE = 1B / average(5B, 4.8B), ROA = 1B / average(12B, 11.5B)
    expect(result.roeTtm).toBeCloseTo(1 / 4.9, 5);
    expect(result.roaTtm).toBeCloseTo(1 / 11.75, 5);
    // NOPAT = 1.5B * (1 - 260M / 1.3B) = 1.2B;
    // invested capital = equity + debt - cash = 6B at both dates.
    expect(result.roicTtm).toBeCloseTo(0.2, 5);
    expect(result.currentRatio).toBe(2);
    expect(result.cashConversionCycleDays).toBeCloseTo(36.5, 1);
    expect(result.daysSalesOutstanding).toBeCloseTo(27.375, 2);
    expect(result.daysInventoryOutstanding).toBeCloseTo(52.46875, 2);
    expect(result.daysPayablesOutstanding).toBeCloseTo(43.34375, 2);
    expect(result.metricStatuses.roe_ttm?.status).toBe("ok");
    expect(result.metricStatuses.roa_ttm?.status).toBe("ok");
    expect(result.metricStatuses.roic_ttm?.status).toBe("ok");
    expect(result.metricStatuses.current_ratio?.status).toBe("ok");
    expect(result.metricStatuses.cash_conversion_cycle_days?.status).toBe("ok");
    expect(result.metricInputs.return_ratios).toMatchObject({
      effective_tax_rate: 0.2,
      invested_capital_current: 6_000_000_000,
    });
  });

  // Test case: 최근 12개월 적자 → PER null + negative_earnings
  it("marks PER as not_meaningful with negative_earnings when net income <= 0", () => {
    const result = computeValuation({
      ticker: "TEST",
      price: makePrice({ price: 50 }),
      fundamentals: makeFundamentals({
        netIncomeCommonTtm: -500_000_000,
        dilutedEpsTtm: -2.5,
      }),
      marketCap: 10_000_000_000,
      fundamentalSnapshotId: null,
      priceSnapshotId: null,
    });

    expect(result.peTtm).toBeNull();
    expect(result.metricStatuses.pe_ttm?.status).toBe("not_meaningful");
    expect(result.metricStatuses.pe_ttm?.reason).toBe("negative_earnings");
  });

  // Test case: 자본잠식 → PBR null + negative_equity
  it("marks PBR as not_meaningful with negative_equity when equity <= 0", () => {
    const result = computeValuation({
      ticker: "TEST",
      price: makePrice({ price: 30 }),
      fundamentals: makeFundamentals({
        commonEquity: -1_000_000_000,
      }),
      marketCap: 6_000_000_000,
      fundamentalSnapshotId: null,
      priceSnapshotId: null,
    });

    expect(result.pb).toBeNull();
    expect(result.metricStatuses.pb?.status).toBe("not_meaningful");
    expect(result.metricStatuses.pb?.reason).toBe("negative_equity");
  });

  // Test case: 통화 불일치 → 계산 중단
  it("marks all multiples as insufficient_data on currency mismatch", () => {
    const result = computeValuation({
      ticker: "TEST",
      price: makePrice({ price: 100, currency: "KRW" }),
      fundamentals: makeFundamentals({ currency: "USD" }),
      marketCap: 20_000_000_000,
      fundamentalSnapshotId: null,
      priceSnapshotId: null,
    });

    expect(result.metricStatuses.pe_ttm?.status).toBe("insufficient_data");
    expect(result.metricStatuses.pe_ttm?.reason).toBe("currency_mismatch");
    expect(result.metricStatuses.pb?.status).toBe("insufficient_data");
    expect(result.pb).toBeNull();
    expect(result.peTtm).toBeNull();
  });

  it("computes enterprise value as market_cap + debt - cash", () => {
    const result = computeValuation({
      ticker: "TEST",
      price: makePrice(),
      fundamentals: makeFundamentals({
        cashAndEquivalents: 1_000_000_000,
        totalDebt: 3_000_000_000,
      }),
      marketCap: 20_000_000_000,
      fundamentalSnapshotId: null,
      priceSnapshotId: null,
    });

    // EV = 20B + 3B - 1B = 22B
    expect(result.enterpriseValue).toBe(22_000_000_000);
  });

  it("computes PSR TTM when market cap and revenue are positive", () => {
    const result = computeValuation({
      ticker: "TEST",
      price: makePrice(),
      fundamentals: makeFundamentals({ revenueTtm: 5_000_000_000 }),
      marketCap: 20_000_000_000,
      fundamentalSnapshotId: null,
      priceSnapshotId: null,
    });

    // PSR = 20B / 5B = 4
    expect(result.psTtm).toBe(4);
  });

  it("emits cross-check divergence flag when PER A and PER B diverge significantly", () => {
    // PER A = price / eps = 100 / 5 = 20
    // PER B = market_cap / net_income = 10B / 1B = 10
    // divergence = |20 - 10| / 10 = 1.0 > 0.15
    const result = computeValuation({
      ticker: "TEST",
      price: makePrice({ price: 100 }),
      fundamentals: makeFundamentals({
        dilutedEpsTtm: 5,
        netIncomeCommonTtm: 1_000_000_000,
        sharesOutstanding: 200_000_000,
      }),
      marketCap: 10_000_000_000,
      fundamentalSnapshotId: null,
      priceSnapshotId: null,
    });

    // PER B = 10 is authoritative
    expect(result.peTtm).toBe(10);
    expect(result.metricStatuses.pe_ttm?.status).toBe("ok");
    // Divergence > 0.15 should trigger the quality flag
    expect(result.qualityFlags).toContain("per_cross_check_divergence");
  });

  it("does not emit divergence flag when PER A and PER B are close", () => {
    // PER A = price / eps = 100 / 5 = 20
    // PER B = market_cap / net_income = 20B / 1B = 20
    // divergence = 0
    const result = computeValuation({
      ticker: "TEST",
      price: makePrice({ price: 100 }),
      fundamentals: makeFundamentals({
        dilutedEpsTtm: 5,
        netIncomeCommonTtm: 1_000_000_000,
        sharesOutstanding: 200_000_000,
      }),
      marketCap: 20_000_000_000,
      fundamentalSnapshotId: null,
      priceSnapshotId: null,
    });

    expect(result.peTtm).toBe(20);
    expect(result.qualityFlags).not.toContain("per_cross_check_divergence");
  });

  it("falls back to PER A (price/eps) when market cap is missing", () => {
    const result = computeValuation({
      ticker: "TEST",
      price: makePrice({ price: 100 }),
      fundamentals: makeFundamentals({
        dilutedEpsTtm: 5,
        netIncomeCommonTtm: 1_000_000_000,
      }),
      marketCap: null,
      fundamentalSnapshotId: null,
      priceSnapshotId: null,
    });

    // PER A = 100 / 5 = 20
    expect(result.peTtm).toBe(20);
    expect(result.metricStatuses.pe_ttm?.status).toBe("ok");
  });

  it("returns insufficient_data when both market cap and EPS are missing", () => {
    const result = computeValuation({
      ticker: "TEST",
      price: makePrice({ price: 100 }),
      fundamentals: makeFundamentals({
        dilutedEpsTtm: null,
        netIncomeCommonTtm: null,
      }),
      marketCap: null,
      fundamentalSnapshotId: null,
      priceSnapshotId: null,
    });

    expect(result.peTtm).toBeNull();
    expect(result.metricStatuses.pe_ttm?.status).toBe("insufficient_data");
  });

  it("keeps signed negative returns meaningful instead of converting them to N.M.", () => {
    const result = computeValuation({
      ticker: "TEST",
      price: makePrice(),
      fundamentals: makeFundamentals({
        netIncomeCommonTtm: -1_000_000_000,
        operatingIncomeTtm: -1_500_000_000,
      }),
      marketCap: 20_000_000_000,
      fundamentalSnapshotId: null,
      priceSnapshotId: null,
    });

    expect(result.roeTtm).toBeLessThan(0);
    expect(result.roaTtm).toBeLessThan(0);
    expect(result.roicTtm).toBeLessThan(0);
    expect(result.metricStatuses.roe_ttm?.status).toBe("ok");
    expect(result.metricStatuses.roa_ttm?.status).toBe("ok");
    expect(result.metricStatuses.roic_ttm?.status).toBe("ok");
  });

  it("requires a comparable prior balance for average-based metrics", () => {
    const result = computeValuation({
      ticker: "TEST",
      price: makePrice(),
      fundamentals: makeFundamentals({
        previousPeriodEnd: null,
        previousCommonEquity: null,
        previousTotalAssets: null,
        previousTotalDebt: null,
        previousCashAndEquivalents: null,
        previousAccountsReceivable: null,
        previousInventory: null,
        previousAccountsPayable: null,
      }),
      marketCap: 20_000_000_000,
      fundamentalSnapshotId: null,
      priceSnapshotId: null,
    });

    for (const [key, field] of [
      ["roe_ttm", "roeTtm"],
      ["roa_ttm", "roaTtm"],
      ["roic_ttm", "roicTtm"],
      ["cash_conversion_cycle_days", "cashConversionCycleDays"],
    ] as const) {
      expect(result[field]).toBeNull();
      expect(result.metricStatuses[key]?.reason).toBe("missing_prior_balance");
    }
  });

  it("marks invalid tax inputs unavailable for ROIC", () => {
    const result = computeValuation({
      ticker: "TEST",
      price: makePrice(),
      fundamentals: makeFundamentals({
        incomeBeforeTaxTtm: 100,
        incomeTaxExpenseTtm: 150,
      }),
      marketCap: 20_000_000_000,
      fundamentalSnapshotId: null,
      priceSnapshotId: null,
    });

    expect(result.roicTtm).toBeNull();
    expect(result.metricStatuses.roic_ttm).toEqual({
      status: "insufficient_data",
      reason: "invalid_tax_rate",
    });
  });

  it("does not divide by zero current liabilities and permits zero inventory in CCC", () => {
    const result = computeValuation({
      ticker: "TEST",
      price: makePrice(),
      fundamentals: makeFundamentals({
        totalCurrentLiabilities: 0,
        inventory: 0,
        previousInventory: 0,
      }),
      marketCap: 20_000_000_000,
      fundamentalSnapshotId: null,
      priceSnapshotId: null,
    });

    expect(result.currentRatio).toBeNull();
    expect(result.metricStatuses.current_ratio?.reason).toBe("invalid_current_liabilities");
    expect(result.cashConversionCycleDays).toBeCloseTo(-16, 0);
    expect(result.daysInventoryOutstanding).toBe(0);
  });

  it("reports missing cost of revenue instead of manufacturing a CCC", () => {
    const result = computeValuation({
      ticker: "TEST",
      price: makePrice(),
      fundamentals: makeFundamentals({ costOfRevenueTtm: null }),
      marketCap: 20_000_000_000,
      fundamentalSnapshotId: null,
      priceSnapshotId: null,
    });

    expect(result.cashConversionCycleDays).toBeNull();
    expect(result.metricStatuses.cash_conversion_cycle_days?.reason).toBe("non_positive_cost_of_revenue");
  });

  it("still computes currency-independent returns when price currency mismatches", () => {
    const result = computeValuation({
      ticker: "TEST",
      price: makePrice({ currency: "KRW" }),
      fundamentals: makeFundamentals(),
      marketCap: 20_000_000_000,
      fundamentalSnapshotId: null,
      priceSnapshotId: null,
    });

    expect(result.peTtm).toBeNull();
    expect(result.metricStatuses.pe_ttm?.reason).toBe("currency_mismatch");
    expect(result.roeTtm).not.toBeNull();
    expect(result.roicTtm).not.toBeNull();
  });
});
