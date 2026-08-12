// Valuation domain types. These describe the fundamental inputs + market price
// snapshots that feed the deterministic calculator, plus the computed multiples
// the calculator emits. Provider-specific DTOs live in the client modules.

/** Trailing twelve months fundamental inputs as disclosed at available_at. */
export interface FundamentalInputs {
  ticker: string;
  cik: string | null;
  availableAt: string; // ISO timestamp — when the market could first see these numbers
  periodEnd: string; // ISO date — fiscal period end (e.g. "2026-06-30")
  filingDate: string | null;
  formType: string | null;
  accessionNumbers: string[];
  currency: string;
  dilutedEpsTtm: number | null;
  netIncomeCommonTtm: number | null;
  revenueTtm: number | null;
  costOfRevenueTtm: number | null;
  operatingIncomeTtm: number | null;
  incomeBeforeTaxTtm: number | null;
  incomeTaxExpenseTtm: number | null;
  operatingCashFlowTtm: number | null;
  capitalExpendituresTtm: number | null;
  freeCashFlowTtm: number | null;
  commonEquity: number | null;
  totalAssets: number | null;
  totalCurrentAssets: number | null;
  totalCurrentLiabilities: number | null;
  accountsReceivable: number | null;
  inventory: number | null;
  accountsPayable: number | null;
  sharesOutstanding: number | null;
  cashAndEquivalents: number | null;
  totalDebt: number | null;
  previousPeriodEnd: string | null;
  previousCommonEquity: number | null;
  previousTotalAssets: number | null;
  previousCashAndEquivalents: number | null;
  previousTotalDebt: number | null;
  previousAccountsReceivable: number | null;
  previousInventory: number | null;
  previousAccountsPayable: number | null;
  inputLineage: Record<string, unknown>;
  qualityFlags: string[];
  normalizationVersion: string | null;
  provider: "fmp" | "sec_companyfacts";
}

/** A single market price observation (regular close by default). */
export interface PriceSnapshot {
  ticker: string;
  sessionDate: string; // ISO date — the trading session
  priceType: "quote" | "regular_close" | "previous_close" | "adjusted_close";
  price: number;
  currency: string;
  provider: string;
  observedAt: string; // ISO timestamp
  providerReference: string | null;
  qualityFlags: string[];
}

/** Status of a single computed metric when it cannot be shown. */
export interface MetricStatus {
  status: "ok" | "not_meaningful" | "insufficient_data";
  reason?: string;
}

/**
 * Result of the deterministic valuation calculator.
 * Multiples are null when not meaningful (negative earnings, negative equity, etc.)
 * — we never display negative PER/PBR.
 */
export interface ValuationSnapshot {
  ticker: string;
  sessionDate: string;
  priceSnapshotId: string | null;
  fundamentalSnapshotId: string | null;
  referencePrice: number;
  currency: string;
  marketCap: number | null;
  enterpriseValue: number | null;
  epsTtmDiluted: number | null;
  bookValuePerShare: number | null;
  freeCashFlowPerShare: number | null;
  peTtm: number | null;
  pb: number | null;
  psTtm: number | null;
  priceToFcfTtm: number | null;
  earningsYield: number | null;
  fcfYield: number | null;
  roeTtm: number | null;
  roaTtm: number | null;
  roicTtm: number | null;
  currentRatio: number | null;
  cashConversionCycleDays: number | null;
  daysSalesOutstanding: number | null;
  daysInventoryOutstanding: number | null;
  daysPayablesOutstanding: number | null;
  metricStatuses: Record<string, MetricStatus>;
  metricInputs: Record<string, unknown>;
  qualityFlags: string[];
  fundamentalAvailableAt: string | null;
  fundamentalPeriodEnd: string | null;
  calculationVersion: string;
  computedAt: string;
}

/** Quality flags the calculator can emit. */
export const VALUATION_QUALITY_FLAGS = {
  currencyMismatch: "currency_mismatch",
  perCrossCheckDivergence: "per_cross_check_divergence",
  pbrCrossCheckDivergence: "pbr_cross_check_divergence",
  missingShares: "missing_shares_outstanding",
  missingNetIncome: "missing_net_income",
  missingEquity: "missing_common_equity",
  missingTotalAssets: "missing_total_assets",
  missingWorkingCapital: "missing_working_capital",
  missingPriorBalance: "missing_prior_balance",
  nonComparableBalancePeriods: "non_comparable_balance_periods",
  invalidTaxRate: "invalid_tax_rate",
  invalidCurrentLiabilities: "invalid_current_liabilities",
  nonPositiveRevenue: "non_positive_revenue",
  nonPositiveCostOfRevenue: "non_positive_cost_of_revenue",
  staleFundamentals: "stale_fundamentals",
} as const;

export const VALUATION_CALCULATION_VERSION = "v1.1.0";
