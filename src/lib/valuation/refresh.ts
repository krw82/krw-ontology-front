import "server-only";

import { ensureSecCompanyIdentifier } from "@/lib/filing-notifications/company-identifiers";
import { fetchFmpFundamentals, fetchFmpQuote, isFmpEnabled } from "./fmp-client";
import { computeValuation } from "./calculator";
import {
  insertValuationSnapshot,
  upsertFundamentalSnapshot,
  upsertMarketInstrument,
  upsertPriceSnapshot,
} from "./repository";
import type { ValuationRefreshConfig } from "./config";

export interface ValuationRefreshCycleResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: Array<{ ticker: string; error: string }>;
}

/**
 * Run a single valuation refresh cycle over the given tickers.
 *
 * For each ticker:
 *   1. Ensure market_instruments + SEC CIK identifier
 *   2. Fetch FMP fundamentals + quote
 *   3. Persist fundamental and price snapshots
 *   4. Compute valuation multiples
 *   5. Persist valuation snapshot
 *
 * On failure for a single ticker, the previous healthy snapshot is preserved
 * — we never overwrite with zeros or stale data.
 */
export async function runValuationRefreshCycle(
  tickers: readonly string[],
  config: ValuationRefreshConfig,
): Promise<ValuationRefreshCycleResult> {
  if (!config.enabled || !isFmpEnabled()) {
    return {
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: tickers.length,
      errors: [{ ticker: "*", error: "FMP_API_KEY not configured" }],
    };
  }

  let succeeded = 0;
  let failed = 0;
  const errors: Array<{ ticker: string; error: string }> = [];

  for (const ticker of tickers) {
    try {
      await refreshSingleTicker(ticker);
      succeeded += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : "unknown_error";
      errors.push({ ticker, error: message });
    }
  }

  return {
    processed: tickers.length,
    succeeded,
    failed,
    skipped: 0,
    errors,
  };
}

async function refreshSingleTicker(ticker: string): Promise<void> {
  // 1. Resolve CIK and ensure market_instruments row
  let cik: string | null = null;
  let companyName: string | null = null;
  try {
    const identifier = await ensureSecCompanyIdentifier(ticker);
    cik = identifier?.cik ?? null;
    companyName = identifier?.company_name ?? null;
  } catch {
    // CIK lookup is best-effort; valuation works without it.
  }

  // 2. Fetch FMP quote (market cap) + fundamentals (income/balance/cashflow)
  //    These run in parallel; shares outstanding now comes from the income
  //    statement (weightedAverageShsOutDil), not from the quote.
  const [quoteResult, fundamentals] = await Promise.all([
    fetchFmpQuote(ticker),
    fetchFmpFundamentals(ticker),
  ]);

  if (!quoteResult) {
    throw new Error(`No price quote returned from FMP for ${ticker}`);
  }
  if (!fundamentals) {
    throw new Error(`No fundamental data returned from FMP for ${ticker}`);
  }

  const { price, supplement } = quoteResult;

  // Attach CIK to fundamentals if resolved
  if (cik) fundamentals.cik = cik;

  // 3. Persist market_instruments + snapshots
  await upsertMarketInstrument(ticker, {
    cik,
    company_name: companyName,
    currency: fundamentals.currency,
  });
  const fundamentalSnapshotId = await upsertFundamentalSnapshot(fundamentals);
  const priceSnapshotId = await upsertPriceSnapshot(price);

  // 4. Compute and persist valuation
  const valuation = computeValuation({
    ticker,
    price,
    fundamentals,
    marketCap: supplement.marketCap,
    fundamentalSnapshotId,
    priceSnapshotId,
  });

  await insertValuationSnapshot(valuation);
}
