import type { SupabaseClient } from "@supabase/supabase-js";
import type { MarketIssueEnvironment } from "@/lib/market-issues/config";

type Db = SupabaseClient;

export type LocalNewsCoverageTicker = {
  ticker: string;
  coverageCount: number;
  maxPriority: number;
};

/**
 * Reads every company in the active ontology catalog for one environment.
 * The product-wide Finnhub collector never depends on a user's watchlist.
 */
export async function listLocalNewsCoverageTickers(
  db: Db,
  environment: MarketIssueEnvironment,
): Promise<LocalNewsCoverageTicker[]> {
  const { data, error } = await db.rpc("list_market_news_coverage_tickers", {
    p_environment: environment,
  });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("local_news_coverage_response_invalid");

  const tickers = new Map<string, LocalNewsCoverageTicker>();
  for (const row of data) {
    const coverage = parseCoverageTicker(row);
    if (!coverage) continue;
    const existing = tickers.get(coverage.ticker);
    if (!existing || coverage.coverageCount > existing.coverageCount) {
      tickers.set(coverage.ticker, coverage);
    }
  }
  return [...tickers.values()].sort((left, right) =>
    right.coverageCount - left.coverageCount
    || right.maxPriority - left.maxPriority
    || left.ticker.localeCompare(right.ticker),
  );
}

function parseCoverageTicker(value: unknown): LocalNewsCoverageTicker | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const ticker = typeof row.ticker === "string" ? row.ticker.trim().toUpperCase() : "";
  if (!/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(ticker)) return null;

  const coverageCount = nonNegativeInteger(row.coverage_count);
  const maxPriority = nonNegativeInteger(row.max_priority);
  if (coverageCount === null || maxPriority === null) return null;
  return { ticker, coverageCount, maxPriority };
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1_000_000) return null;
  return parsed;
}
