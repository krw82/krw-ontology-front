import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ValuationRefreshConfig } from "./config";
import type { FundamentalInputs, PriceSnapshot } from "./types";

const mocks = vi.hoisted(() => ({
  ensureSecCompanyIdentifier: vi.fn(),
  fetchFmpFundamentals: vi.fn(),
  fetchFmpQuote: vi.fn(),
  isFmpEnabled: vi.fn(),
  insertValuationSnapshot: vi.fn(),
  upsertFundamentalSnapshot: vi.fn(),
  upsertMarketInstrument: vi.fn(),
  upsertPriceSnapshot: vi.fn(),
}));

vi.mock("@/lib/filing-notifications/company-identifiers", () => ({
  ensureSecCompanyIdentifier: mocks.ensureSecCompanyIdentifier,
}));

vi.mock("./fmp-client", () => ({
  fetchFmpFundamentals: mocks.fetchFmpFundamentals,
  fetchFmpQuote: mocks.fetchFmpQuote,
  isFmpEnabled: mocks.isFmpEnabled,
}));

vi.mock("./repository", () => ({
  insertValuationSnapshot: mocks.insertValuationSnapshot,
  upsertFundamentalSnapshot: mocks.upsertFundamentalSnapshot,
  upsertMarketInstrument: mocks.upsertMarketInstrument,
  upsertPriceSnapshot: mocks.upsertPriceSnapshot,
}));

import { runValuationRefreshCycle } from "./refresh";

const enabledConfig: ValuationRefreshConfig = {
  enabled: true,
  workerId: "test-worker",
  intervalMs: 60_000,
  batchSize: 20,
};

const fundamentals: FundamentalInputs = {
  ticker: "TEST",
  cik: null,
  availableAt: "2026-08-01T00:00:00.000Z",
  periodEnd: "2026-06-30",
  filingDate: "2026-08-01",
  formType: "Q2",
  accessionNumbers: [],
  currency: "USD",
  dilutedEpsTtm: 5,
  netIncomeCommonTtm: 1_000,
  revenueTtm: 10_000,
  costOfRevenueTtm: 4_000,
  operatingIncomeTtm: 1_500,
  incomeBeforeTaxTtm: 1_300,
  incomeTaxExpenseTtm: 260,
  operatingCashFlowTtm: 2_000,
  capitalExpendituresTtm: -500,
  freeCashFlowTtm: 1_500,
  commonEquity: 5_000,
  totalAssets: 12_000,
  totalCurrentAssets: 3_000,
  totalCurrentLiabilities: 1_500,
  accountsReceivable: 800,
  inventory: 600,
  accountsPayable: 500,
  sharesOutstanding: 200,
  cashAndEquivalents: 1_000,
  totalDebt: 2_000,
  previousPeriodEnd: "2026-03-31",
  previousCommonEquity: 4_800,
  previousTotalAssets: 11_500,
  previousCashAndEquivalents: 900,
  previousTotalDebt: 2_100,
  previousAccountsReceivable: 700,
  previousInventory: 550,
  previousAccountsPayable: 450,
  inputLineage: {},
  qualityFlags: [],
  normalizationVersion: "test",
  provider: "fmp",
};

const price: PriceSnapshot = {
  ticker: "TEST",
  sessionDate: "2026-08-08",
  priceType: "quote",
  price: 100,
  currency: "USD",
  provider: "fmp",
  observedAt: "2026-08-08T22:00:00.000Z",
  providerReference: null,
  qualityFlags: [],
};

describe("runValuationRefreshCycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.isFmpEnabled.mockReturnValue(true);
    mocks.ensureSecCompanyIdentifier.mockResolvedValue(null);
    mocks.fetchFmpFundamentals.mockResolvedValue(null);
  });

  it("preserves the last snapshot when the quote provider fails", async () => {
    mocks.fetchFmpQuote.mockRejectedValue(new Error("quote provider unavailable"));

    const result = await runValuationRefreshCycle(["TEST"], enabledConfig);

    expect(result).toMatchObject({ processed: 1, succeeded: 0, failed: 1, skipped: 0 });
    expect(result.errors).toEqual([{ ticker: "TEST", error: "quote provider unavailable" }]);
    expect(mocks.upsertMarketInstrument).not.toHaveBeenCalled();
    expect(mocks.upsertFundamentalSnapshot).not.toHaveBeenCalled();
    expect(mocks.upsertPriceSnapshot).not.toHaveBeenCalled();
    expect(mocks.insertValuationSnapshot).not.toHaveBeenCalled();
  });

  it("persists a v1.1 snapshot after both providers succeed", async () => {
    mocks.fetchFmpFundamentals.mockResolvedValue({ ...fundamentals });
    mocks.fetchFmpQuote.mockResolvedValue({ price, supplement: { marketCap: 20_000 } });
    mocks.upsertFundamentalSnapshot.mockResolvedValue("fundamental-1");
    mocks.upsertPriceSnapshot.mockResolvedValue("price-1");
    mocks.insertValuationSnapshot.mockResolvedValue("valuation-1");

    const result = await runValuationRefreshCycle(["TEST"], enabledConfig);

    expect(result).toMatchObject({ processed: 1, succeeded: 1, failed: 0, skipped: 0 });
    expect(mocks.upsertMarketInstrument).toHaveBeenCalledWith("TEST", {
      cik: null,
      company_name: null,
      currency: "USD",
    });
    expect(mocks.upsertFundamentalSnapshot).toHaveBeenCalledWith(fundamentals);
    expect(mocks.upsertPriceSnapshot).toHaveBeenCalledWith(price);
    expect(mocks.insertValuationSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        ticker: "TEST",
        fundamentalSnapshotId: "fundamental-1",
        priceSnapshotId: "price-1",
        calculationVersion: "v1.1.0",
        roeTtm: expect.any(Number),
        roicTtm: expect.any(Number),
        cashConversionCycleDays: expect.any(Number),
      }),
    );
  });
});
