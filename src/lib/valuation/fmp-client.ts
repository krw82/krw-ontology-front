import "server-only";

import type { FundamentalInputs, PriceSnapshot } from "./types";
import { VALUATION_QUALITY_FLAGS } from "./types";

const DEFAULT_TIMEOUT_MS = 15_000;
const TRANSIENT_REQUEST_ATTEMPTS = 3;
const TRANSIENT_RETRY_BASE_DELAY_MS = 500;

const FMP_BASE_URL = "https://financialmodelingprep.com/stable";

export class FmpRequestError extends Error {
  readonly status: number | null;
  readonly code: string | null;
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { status?: number | null; code?: string | null; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "FmpRequestError";
    this.status = options.status ?? null;
    this.code = options.code ?? null;
    this.retryable = options.retryable ?? false;
  }
}

export function fmpApiKey(): string {
  return process.env.FMP_API_KEY?.trim() || "";
}

export function isFmpEnabled(): boolean {
  return fmpApiKey().length > 0;
}

export async function fetchFmpJson<T>(path: string, params: Record<string, string>): Promise<T> {
  const apiKey = fmpApiKey();
  if (!apiKey) {
    throw new FmpRequestError("FMP_API_KEY is required for FMP requests", {
      code: "missing_api_key",
    });
  }

  // Build URL manually — new URL(path, base) drops the /stable path segment
  // when path starts with /, so we concatenate explicitly.
  const url = new URL(`${FMP_BASE_URL}${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("apikey", apiKey);

  if (!isAllowedFmpUrl(url)) {
    throw new FmpRequestError(`FMP request URL must use financialmodelingprep.com`, {
      code: "invalid_host",
    });
  }

  for (let attempt = 1; attempt <= TRANSIENT_REQUEST_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1_000, DEFAULT_TIMEOUT_MS));
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json", "Accept-Encoding": "gzip, deflate" },
        redirect: "error",
        signal: controller.signal,
      });
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new FmpRequestError(
          `FMP request failed (${response.status}) for ${url.pathname}`,
          { status: response.status, retryable },
        );
      }
      return (await response.json()) as T;
    } catch (error) {
      const requestError = toFmpRequestError(error, url.pathname);
      if (attempt >= TRANSIENT_REQUEST_ATTEMPTS || !requestError.retryable) {
        throw requestError;
      }
      await sleep(TRANSIENT_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    } finally {
      clearTimeout(timer);
    }
  }

  throw new FmpRequestError(`FMP request failed for ${path}`);
}

function toFmpRequestError(error: unknown, context: string): FmpRequestError {
  if (error instanceof FmpRequestError) return error;
  if (error instanceof DOMException && error.name === "AbortError") {
    return new FmpRequestError(`FMP request timed out for ${context}`, {
      code: "timeout",
      retryable: true,
    });
  }
  const message = error instanceof Error ? error.message : "FMP request failed";
  return new FmpRequestError(`${message} for ${context}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAllowedFmpUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    (url.hostname === "financialmodelingprep.com" || url.hostname === "site.financialmodelingprep.com")
  );
}

// ---- FMP /stable/ DTO types (only fields we read) ----

/**
 * FMP /stable/income-statement quarterly item.
 * Note: field names differ from the legacy /api/v3/ format.
 */
interface FmpIncomeQuarter extends Record<string, unknown> {
  date?: string;
  period?: string;
  fiscalYear?: string;
  reportedCurrency?: string;
  cik?: string | null;
  filingDate?: string | null;
}

interface FmpBalanceSheetQuarter extends Record<string, unknown> {
  date?: string;
  period?: string;
  fiscalYear?: string;
  reportedCurrency?: string;
}

interface FmpCashFlowQuarter extends Record<string, unknown> {
  date?: string;
  period?: string;
  fiscalYear?: string;
  reportedCurrency?: string;
}

interface FmpStableQuote {
  symbol: string;
  name: string | null;
  price: number | null;
  previousClose: number | null;
  marketCap: number | null;
  exchange: string | null;
  timestamp: number | null;
}

// ---- Normalization helpers ----

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(record: Record<string, unknown>, ...fields: string[]): number | null {
  for (const field of fields) {
    const value = numOrNull(record[field]);
    if (value !== null) return value;
  }
  return null;
}

function readText(record: Record<string, unknown>, ...fields: string[]): string | null {
  for (const field of fields) {
    const value = textOrNull(record[field]);
    if (value !== null) return value;
  }
  return null;
}

/**
 * Sum a field across up to 4 quarters (for TTM computation).
 * Returns null if any quarter is missing or null.
 */
export function sumQuarterly(quarters: unknown[], field: string): number | null {
  // A TTM value must cover four complete quarters. Never label a partial
  // response as TTM; the caller can still preserve the raw response in lineage.
  if (quarters.length !== 4) return null;
  let total = 0;
  for (const q of quarters) {
    const val = numOrNull((q as Record<string, unknown>)[field]);
    if (val === null) return null; // if any quarter missing, TTM is incomplete
    total += val;
  }
  return total;
}

function normalizeIncomeQuarter(row: FmpIncomeQuarter): FmpIncomeQuarter {
  return {
    ...row,
    revenue: readNumber(row, "revenue", "totalRevenue"),
    costOfRevenue: readNumber(row, "costOfRevenue", "costOfGoodsAndServicesSold"),
    operatingIncome: readNumber(row, "operatingIncome"),
    incomeBeforeTax: readNumber(row, "incomeBeforeTax", "preTaxIncome"),
    incomeTaxExpense: readNumber(row, "incomeTaxExpense", "incomeTax"),
    netIncome: readNumber(row, "netIncome", "bottomLineNetIncome"),
    epsDiluted: readNumber(row, "epsDiluted", "dilutedEPS"),
    weightedAverageShsOutDil: readNumber(
      row,
      "weightedAverageShsOutDil",
      "weightedAverageShsOutDiluted",
    ),
  };
}

function normalizeCashFlowQuarter(row: FmpCashFlowQuarter): FmpCashFlowQuarter {
  return {
    ...row,
    netCashProvidedByOperatingActivities: readNumber(
      row,
      "netCashProvidedByOperatingActivities",
      "operatingCashFlow",
    ),
    capitalExpenditure: readNumber(row, "capitalExpenditure", "capitalExpenditures"),
    freeCashFlow: readNumber(row, "freeCashFlow"),
  };
}

/**
 * Fetch quarterly income statements (4 most recent) and compute TTM.
 */
export async function fetchFmpFundamentals(
  ticker: string,
): Promise<FundamentalInputs | null> {
  // Fetch 4 quarters of income + cash flow, and 2 balance sheets (latest +
  // prior). Point-in-time averages are required for return ratios and CCC.
  const [income, balance, cashFlow] = await Promise.all([
    fetchFmpJson<FmpIncomeQuarter[]>("/income-statement", {
      symbol: ticker,
      period: "quarter",
      limit: "4",
    }),
    fetchFmpJson<FmpBalanceSheetQuarter[]>("/balance-sheet-statement", {
      symbol: ticker,
      period: "quarter",
      limit: "2",
    }),
    fetchFmpJson<FmpCashFlowQuarter[]>("/cash-flow-statement", {
      symbol: ticker,
      period: "quarter",
      limit: "4",
    }),
  ]);

  if (!income || income.length === 0) return null;
  if (!balance || balance.length === 0) return null;

  const incomeRows = income.map((row) => normalizeIncomeQuarter(row));
  const cashFlowRows = cashFlow.map((row) => normalizeCashFlowQuarter(row));
  const latestInc = incomeRows[0];
  const bal = balance[0];
  const priorBal = balance[1] ?? null;
  const currency = readText(latestInc, "reportedCurrency") || readText(bal, "reportedCurrency") || "USD";

  // TTM = sum of last 4 quarters
  const revenueTtm = sumQuarterly(incomeRows, "revenue");
  const netIncomeTtm = sumQuarterly(incomeRows, "netIncome");
  const costOfRevenueTtm = sumQuarterly(incomeRows, "costOfRevenue");
  const operatingIncomeTtm = sumQuarterly(incomeRows, "operatingIncome");
  const incomeBeforeTaxTtm = sumQuarterly(incomeRows, "incomeBeforeTax");
  const incomeTaxExpenseTtm = sumQuarterly(incomeRows, "incomeTaxExpense");
  const ocfTtm = sumQuarterly(cashFlowRows, "netCashProvidedByOperatingActivities");
  const capexTtm = sumQuarterly(cashFlowRows, "capitalExpenditure");
  const fcfTtm = sumQuarterly(cashFlowRows, "freeCashFlow");

  // EPS TTM: sum of diluted EPS across 4 quarters
  const dilutedEpsTtm = sumQuarterly(incomeRows, "epsDiluted");

  // Shares outstanding: use latest quarter's weighted average diluted shares
  const shares = readNumber(latestInc, "weightedAverageShsOutDil");

  // Balance sheet (point-in-time, latest)
  const commonEquity = readNumber(bal, "totalStockholdersEquity", "totalEquity");
  const totalAssets = readNumber(bal, "totalAssets");
  const totalCurrentAssets = readNumber(bal, "totalCurrentAssets");
  const totalCurrentLiabilities = readNumber(bal, "totalCurrentLiabilities");
  const cash = readNumber(bal, "cashAndCashEquivalents", "cashAndShortTermInvestments");
  const totalDebt = readNumber(bal, "totalDebt") ??
    ((readNumber(bal, "longTermDebt") ?? 0) + (readNumber(bal, "shortTermDebt") ?? 0) || null);
  const accountsReceivable = readNumber(bal, "accountsReceivables", "accountsReceivable", "netReceivables");
  const inventory = readNumber(bal, "inventory", "inventoryRawMaterials", "inventoryFinishedGoods");
  const accountsPayable = readNumber(bal, "accountPayables", "accountsPayable", "tradePayables");

  const previousCommonEquity = priorBal
    ? readNumber(priorBal, "totalStockholdersEquity", "totalEquity")
    : null;
  const previousTotalAssets = priorBal ? readNumber(priorBal, "totalAssets") : null;
  const previousCashAndEquivalents = priorBal
    ? readNumber(priorBal, "cashAndCashEquivalents", "cashAndShortTermInvestments")
    : null;
  const previousTotalDebt = priorBal
    ? readNumber(priorBal, "totalDebt") ??
      ((readNumber(priorBal, "longTermDebt") ?? 0) + (readNumber(priorBal, "shortTermDebt") ?? 0) || null)
    : null;
  const previousAccountsReceivable = priorBal
    ? readNumber(priorBal, "accountsReceivables", "accountsReceivable", "netReceivables")
    : null;
  const previousInventory = priorBal
    ? readNumber(priorBal, "inventory", "inventoryRawMaterials", "inventoryFinishedGoods")
    : null;
  const previousAccountsPayable = priorBal
    ? readNumber(priorBal, "accountPayables", "accountsPayable", "tradePayables")
    : null;

  // Period end = the end of the most recent quarter
  const periodEnd = latestInc.date || bal.date || "";
  if (!periodEnd) return null;

  const qualityFlags: string[] = [];
  if (currency !== "USD") qualityFlags.push(VALUATION_QUALITY_FLAGS.currencyMismatch);
  if (shares === null) qualityFlags.push(VALUATION_QUALITY_FLAGS.missingShares);
  if (netIncomeTtm === null) qualityFlags.push(VALUATION_QUALITY_FLAGS.missingNetIncome);
  if (commonEquity === null) qualityFlags.push(VALUATION_QUALITY_FLAGS.missingEquity);
  if (incomeRows.length !== 4 || cashFlowRows.length !== 4) qualityFlags.push(VALUATION_QUALITY_FLAGS.staleFundamentals);

  const cik = latestInc.cik ?? null;

  return {
    ticker,
    cik,
    availableAt: latestInc.filingDate
      ? new Date(latestInc.filingDate).toISOString()
      : new Date().toISOString(),
    periodEnd,
    filingDate: latestInc.filingDate ?? null,
    formType: latestInc.period ?? null,
    accessionNumbers: [],
    currency,
    dilutedEpsTtm: dilutedEpsTtm,
    netIncomeCommonTtm: netIncomeTtm,
    revenueTtm: revenueTtm,
    costOfRevenueTtm,
    operatingIncomeTtm,
    incomeBeforeTaxTtm,
    incomeTaxExpenseTtm,
    operatingCashFlowTtm: ocfTtm,
    capitalExpendituresTtm: capexTtm,
    freeCashFlowTtm: fcfTtm,
    commonEquity,
    totalAssets,
    totalCurrentAssets,
    totalCurrentLiabilities,
    accountsReceivable,
    inventory,
    accountsPayable,
    sharesOutstanding: shares,
    cashAndEquivalents: cash,
    totalDebt,
    previousPeriodEnd: priorBal?.date ?? null,
    previousCommonEquity,
    previousTotalAssets,
    previousCashAndEquivalents,
    previousTotalDebt,
    previousAccountsReceivable,
    previousInventory,
    previousAccountsPayable,
    inputLineage: {
      provider: "fmp",
      incomeQuarters: income.length,
      cashFlowQuarters: cashFlowRows.length,
      balanceSheetDate: bal.date,
      previousBalanceSheetDate: priorBal?.date ?? null,
    },
    qualityFlags,
    normalizationVersion: "fmp-quarterly-ttm-v2",
    provider: "fmp",
  };
}

/**
 * Quote supplementary data: market cap from quote endpoint.
 * Shares outstanding are taken from the income statement instead (more reliable
 * for TTM-weighted calculations).
 */
export interface FmpQuoteSupplement {
  marketCap: number | null;
}

/**
 * Fetch the latest regular close from FMP /stable/quote for a single ticker.
 */
export async function fetchFmpQuote(
  ticker: string,
): Promise<{ price: PriceSnapshot; supplement: FmpQuoteSupplement } | null> {
  const quotes = await fetchFmpJson<FmpStableQuote[]>("/quote", { symbol: ticker });
  const q = quotes?.[0];
  const quotePrice = numOrNull(q?.price);
  if (!q || quotePrice === null || quotePrice <= 0) return null;

  const observedAt = q.timestamp
    ? new Date(q.timestamp * 1000).toISOString()
    : new Date().toISOString();

  // The quote endpoint returns the latest price, not an end-of-day close. Keep
  // its observation date only as a stable partition key for quote snapshots.
  const sessionDate = observedAt.slice(0, 10);

  return {
    price: {
      ticker,
      sessionDate,
      priceType: "quote",
      price: quotePrice,
      currency: "USD", // /stable/quote doesn't return currency; US equities default
      provider: "fmp",
      observedAt,
      providerReference: null,
      qualityFlags: [],
    },
    supplement: {
      marketCap: numOrNull(q.marketCap),
    },
  };
}
