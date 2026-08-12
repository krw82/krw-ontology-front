import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchFmpFundamentals, sumQuarterly } from "./fmp-client";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("FMP normalization", () => {
  beforeEach(() => {
    vi.stubEnv("FMP_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("only sums exactly four complete quarters for TTM", () => {
    expect(sumQuarterly([{ value: 1 }, { value: 2 }, { value: 3 }], "value")).toBeNull();
    expect(
      sumQuarterly([{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }], "value"),
    ).toBe(10);
    expect(
      sumQuarterly([{ value: 1 }, { value: null }, { value: 3 }, { value: 4 }], "value"),
    ).toBeNull();
  });

  it("normalizes four quarters plus the latest and prior balance sheets", async () => {
    const income = [1, 2, 3, 4].map((quarter, index) => ({
      date: `2026-0${6 - index}-30`,
      period: `Q${4 - index}`,
      fiscalYear: "2026",
      reportedCurrency: "USD",
      cik: "0000320193",
      filingDate: "2026-08-01",
      revenue: quarter * 100,
      costOfRevenue: quarter * 40,
      operatingIncome: quarter * 20,
      incomeBeforeTax: quarter * 18,
      incomeTaxExpense: quarter * 3,
      netIncome: quarter * 15,
      epsDiluted: quarter,
      weightedAverageShsOutDil: 10_000,
    }));
    const balance = [
      {
        date: "2026-06-30",
        reportedCurrency: "USD",
        totalStockholdersEquity: 500,
        totalAssets: 1_200,
        totalCurrentAssets: 300,
        totalCurrentLiabilities: 150,
        cashAndCashEquivalents: 100,
        totalDebt: 200,
        accountsReceivables: 80,
        inventory: 60,
        accountPayables: 50,
      },
      {
        date: "2026-03-31",
        reportedCurrency: "USD",
        totalStockholdersEquity: 480,
        totalAssets: 1_150,
        cashAndCashEquivalents: 90,
        totalDebt: 210,
        accountsReceivables: 70,
        inventory: 55,
        accountPayables: 45,
      },
    ];
    const cashFlow = [1, 2, 3, 4].map((quarter) => ({
      date: "2026-06-30",
      reportedCurrency: "USD",
      netCashProvidedByOperatingActivities: quarter * 30,
      capitalExpenditure: quarter * -5,
      freeCashFlow: quarter * 25,
    }));

    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith("/income-statement")) return response(income);
      if (url.pathname.endsWith("/balance-sheet-statement")) return response(balance);
      if (url.pathname.endsWith("/cash-flow-statement")) return response(cashFlow);
      throw new Error(`unexpected path ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchFmpFundamentals("TEST");

    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      revenueTtm: 1000,
      costOfRevenueTtm: 400,
      operatingIncomeTtm: 200,
      incomeBeforeTaxTtm: 180,
      incomeTaxExpenseTtm: 30,
      netIncomeCommonTtm: 150,
      dilutedEpsTtm: 10,
      operatingCashFlowTtm: 300,
      capitalExpendituresTtm: -50,
      freeCashFlowTtm: 250,
      commonEquity: 500,
      totalAssets: 1200,
      totalCurrentAssets: 300,
      totalCurrentLiabilities: 150,
      accountsReceivable: 80,
      inventory: 60,
      accountsPayable: 50,
      previousPeriodEnd: "2026-03-31",
      previousCommonEquity: 480,
      previousTotalAssets: 1150,
      previousAccountsReceivable: 70,
      previousInventory: 55,
      previousAccountsPayable: 45,
    });
    expect(result?.qualityFlags).not.toContain("stale_fundamentals");

    const requestedUrls = fetchMock.mock.calls.map(([input]) => new URL(input.toString()));
    expect(requestedUrls.find((url) => url.pathname.endsWith("/balance-sheet-statement"))?.searchParams.get("limit")).toBe("2");
  });

  it("preserves a stale flag and null TTM when a provider returns only three quarters", async () => {
    const quarter = { date: "2026-06-30", reportedCurrency: "USD", revenue: 100 };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | RequestInfo) => {
        const url = new URL(input.toString());
        if (url.pathname.endsWith("/income-statement")) return response([quarter, quarter, quarter]);
        if (url.pathname.endsWith("/balance-sheet-statement")) {
          return response([{ date: "2026-06-30", reportedCurrency: "USD" }]);
        }
        return response([]);
      }),
    );

    const result = await fetchFmpFundamentals("TEST");

    expect(result?.revenueTtm).toBeNull();
    expect(result?.qualityFlags).toContain("stale_fundamentals");
  });
});
