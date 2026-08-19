export interface CompanyValuationMetrics {
  ticker: string;
  market_cap: number | null;
  pe_ttm: number | null;
  pb: number | null;
  roe_ttm: number | null;
  fundamental_period_end: string | null;
  computed_at: string | null;
}

export type ValuationSortKey =
  | "default"
  | "market_cap"
  | "pe_ttm"
  | "pb"
  | "roe_ttm";

export type ValuationSortDirection = "asc" | "desc";

export type MetricValuationSortKey = Exclude<ValuationSortKey, "default">;

/**
 * Finance-screening defaults: cheaper multiples first, bigger and more
 * profitable first. Header clicks can still flip the direction.
 */
export const DEFAULT_VALUATION_SORT_DIRECTION: Record<
  MetricValuationSortKey,
  ValuationSortDirection
> = {
  market_cap: "desc",
  pe_ttm: "asc",
  pb: "asc",
  roe_ttm: "desc",
};

/**
 * Nulls always sink to the bottom regardless of direction: a missing
 * PER/PBR is "해당 없음" (by design for deficit/capital-impairment cases),
 * not zero and not the cheapest value on the list.
 */
export function compareCompaniesByValuation<
  T extends { valuation?: CompanyValuationMetrics | null },
>(
  a: T,
  b: T,
  key: MetricValuationSortKey,
  direction: ValuationSortDirection,
): number {
  const aValue = a.valuation?.[key] ?? null;
  const bValue = b.valuation?.[key] ?? null;
  if (aValue === null && bValue === null) return 0;
  if (aValue === null) return 1;
  if (bValue === null) return -1;
  const comparison = aValue - bValue;
  return direction === "asc" ? comparison : -comparison;
}

export function sortCompaniesByValuation<
  T extends { valuation?: CompanyValuationMetrics | null },
>(
  companies: T[],
  key: MetricValuationSortKey,
  direction: ValuationSortDirection,
): T[] {
  return [...companies].sort((a, b) =>
    compareCompaniesByValuation(a, b, key, direction),
  );
}

export function formatValuationMarketCap(
  value: number | null,
  locale: "ko" | "en",
): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  const abs = Math.abs(value);
  if (locale === "en") {
    if (abs >= 1e12) return `$${(value / 1e12).toFixed(2)}T`;
    if (abs >= 1e9) return `$${(value / 1e9).toFixed(1)}B`;
    if (abs >= 1e6) return `$${Math.round(value / 1e6)}M`;
    return `$${Math.round(value).toLocaleString("en-US")}`;
  }
  if (abs >= 1e12) return `$${trimTrailingZero((value / 1e12).toFixed(2))}조`;
  if (abs >= 1e8) {
    const hundredMillionUnits = value / 1e8;
    return hundredMillionUnits >= 100
      ? `$${Math.round(hundredMillionUnits).toLocaleString("en-US")}억`
      : `$${trimTrailingZero(hundredMillionUnits.toFixed(1))}억`;
  }
  if (abs >= 1e4) return `$${Math.round(value / 1e4).toLocaleString("en-US")}만`;
  return `$${Math.round(value).toLocaleString("en-US")}`;
}

export function formatValuationRatio(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "N/A";
  return `${value.toFixed(1)}×`;
}

function trimTrailingZero(formatted: string): string {
  return formatted.replace(/\.0$/, "");
}

export function formatValuationPercent(fraction: number | null): string {
  if (fraction == null || !Number.isFinite(fraction)) return "N/A";
  return `${(fraction * 100).toFixed(1)}%`;
}
