import type { FundamentalInputs, MetricStatus, PriceSnapshot, ValuationSnapshot } from "./types";
import { VALUATION_CALCULATION_VERSION, VALUATION_QUALITY_FLAGS } from "./types";

/** Maximum relative divergence between the two PER/PBR cross-check methods. */
const CROSS_CHECK_MAX_DIVERGENCE = 0.15;

export interface CalculatorInputs {
  ticker: string;
  price: PriceSnapshot;
  fundamentals: FundamentalInputs;
  marketCap: number | null;
  fundamentalSnapshotId: string | null;
  priceSnapshotId: string | null;
}

function isPositive(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

function isFiniteNumber(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function averagePair(current: number | null, previous: number | null): number | null {
  return isFiniteNumber(current) && isFiniteNumber(previous) ? (current + previous) / 2 : null;
}

function setStatus(
  statuses: Record<string, MetricStatus>,
  key: string,
  status: MetricStatus["status"],
  reason?: string,
): void {
  statuses[key] = reason ? { status, reason } : { status };
}

function roundTo(value: number | null, decimals = 4): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Deterministic valuation calculator.
 *
 * PER and PBR are each computed two ways and cross-checked:
 *   PER A = price / diluted EPS TTM
 *   PER B = market_cap / net income common TTM
 *   PBR A = price / book value per share
 *   PBR B = market_cap / common equity
 *
 * Multiples are null (not meaningful) when the denominator is <= 0.
 * We never emit negative PER/PBR.
 */
export function computeValuation(inputs: CalculatorInputs): ValuationSnapshot {
  const { ticker, price, fundamentals, marketCap, fundamentalSnapshotId, priceSnapshotId } = inputs;

  const metricStatuses: Record<string, MetricStatus> = {};
  const qualityFlags: string[] = [...fundamentals.qualityFlags];

  // Currency guard: if price and fundamentals are in different currencies,
  // the computed multiples are invalid. We still emit the snapshot but mark
  // every multiple as insufficient_data.
  const currencyMismatch =
    price.currency.toUpperCase() !== fundamentals.currency.toUpperCase();
  if (currencyMismatch) {
    qualityFlags.push(VALUATION_QUALITY_FLAGS.currencyMismatch);
  }

  const sessionDate = price.sessionDate;

  // ---- EPS / market cap inputs ----
  const eps = fundamentals.dilutedEpsTtm;
  const netIncome = fundamentals.netIncomeCommonTtm;
  const equity = fundamentals.commonEquity;
  const shares = fundamentals.sharesOutstanding;
  const fcf = fundamentals.freeCashFlowTtm;
  const revenue = fundamentals.revenueTtm;
  const stockPrice = price.price;
  const cap = marketCap;

  // ---- Book value per share ----
  const bvps = isPositive(equity) && isPositive(shares) ? equity / shares : null;

  // ---- FCF per share ----
  const fcfPerShare = isPositive(fcf) && isPositive(shares) ? fcf / shares : null;

  // ---- PER ----
  let peTtm: number | null = null;
  if (currencyMismatch) {
    metricStatuses.pe_ttm = { status: "insufficient_data", reason: "currency_mismatch" };
  } else if (netIncome !== null && netIncome <= 0) {
    metricStatuses.pe_ttm = { status: "not_meaningful", reason: "negative_earnings" };
  } else if (netIncome === null) {
    metricStatuses.pe_ttm = { status: "insufficient_data", reason: "missing_net_income" };
  } else {
    // PER B (authoritative): market cap / net income
    const perB = isPositive(cap) && isPositive(netIncome) ? cap / netIncome : null;

    // PER A (cross-check): price / EPS
    const perA = eps !== null && eps > 0 && stockPrice > 0 ? stockPrice / eps : null;

    if (perB !== null) {
      peTtm = perB;
      if (perA !== null && perB > 0) {
        const divergence = Math.abs(perA - perB) / perB;
        if (divergence > CROSS_CHECK_MAX_DIVERGENCE) {
          qualityFlags.push(VALUATION_QUALITY_FLAGS.perCrossCheckDivergence);
        }
      }
      metricStatuses.pe_ttm = { status: "ok" };
    } else if (perA !== null) {
      peTtm = perA;
      metricStatuses.pe_ttm = { status: "ok" };
    } else {
      metricStatuses.pe_ttm = { status: "insufficient_data", reason: "missing_market_cap_or_eps" };
    }
  }

  // ---- PBR ----
  let pb: number | null = null;
  if (currencyMismatch) {
    metricStatuses.pb = { status: "insufficient_data", reason: "currency_mismatch" };
  } else if (equity !== null && equity <= 0) {
    metricStatuses.pb = { status: "not_meaningful", reason: "negative_equity" };
  } else if (equity === null) {
    metricStatuses.pb = { status: "insufficient_data", reason: "missing_common_equity" };
  } else {
    // PBR B (authoritative): market cap / common equity
    const pbrB = isPositive(cap) && isPositive(equity) ? cap / equity : null;

    // PBR A (cross-check): price / BVPS
    const pbrA = bvps !== null && bvps > 0 && stockPrice > 0 ? stockPrice / bvps : null;

    if (pbrB !== null) {
      pb = pbrB;
      if (pbrA !== null && pbrB > 0) {
        const divergence = Math.abs(pbrA - pbrB) / pbrB;
        if (divergence > CROSS_CHECK_MAX_DIVERGENCE) {
          qualityFlags.push(VALUATION_QUALITY_FLAGS.pbrCrossCheckDivergence);
        }
      }
      metricStatuses.pb = { status: "ok" };
    } else if (pbrA !== null) {
      pb = pbrA;
      metricStatuses.pb = { status: "ok" };
    } else {
      metricStatuses.pb = { status: "insufficient_data", reason: "missing_market_cap_or_equity" };
    }
  }

  // ---- PSR TTM ----
  let psTtm: number | null = null;
  if (!currencyMismatch && isPositive(cap) && isPositive(revenue)) {
    psTtm = cap / revenue;
    metricStatuses.ps_ttm = { status: "ok" };
  } else if (!currencyMismatch && revenue !== null && revenue <= 0) {
    metricStatuses.ps_ttm = { status: "not_meaningful", reason: "negative_revenue" };
  } else if (currencyMismatch) {
    metricStatuses.ps_ttm = { status: "insufficient_data", reason: "currency_mismatch" };
  } else {
    metricStatuses.ps_ttm = { status: "insufficient_data" };
  }

  // ---- Price / FCF TTM ----
  let priceToFcfTtm: number | null = null;
  if (!currencyMismatch && isPositive(cap) && isPositive(fcf)) {
    priceToFcfTtm = cap / fcf;
    metricStatuses.price_to_fcf_ttm = { status: "ok" };
  } else if (!currencyMismatch && fcf !== null && fcf <= 0) {
    metricStatuses.price_to_fcf_ttm = { status: "not_meaningful", reason: "non_positive_fcf" };
  } else if (currencyMismatch) {
    metricStatuses.price_to_fcf_ttm = { status: "insufficient_data", reason: "currency_mismatch" };
  } else {
    metricStatuses.price_to_fcf_ttm = { status: "insufficient_data" };
  }

  // ---- Earnings yield = net income / market cap ----
  let earningsYield: number | null = null;
  if (!currencyMismatch && isPositive(cap) && isPositive(netIncome)) {
    earningsYield = netIncome / cap;
    metricStatuses.earnings_yield = { status: "ok" };
  } else {
    metricStatuses.earnings_yield = metricStatuses.pe_ttm;
  }

  // ---- FCF yield = FCF / market cap ----
  let fcfYield: number | null = null;
  if (!currencyMismatch && isPositive(cap) && isPositive(fcf)) {
    fcfYield = fcf / cap;
    metricStatuses.fcf_yield = { status: "ok" };
  } else {
    metricStatuses.fcf_yield = metricStatuses.price_to_fcf_ttm;
  }

  // ---- Enterprise value (approximate) ----
  const enterpriseValue = computeEnterpriseValue(cap, fundamentals);

  // ---- Return ratios ----
  const averageEquity = averagePair(fundamentals.commonEquity, fundamentals.previousCommonEquity);
  const averageAssets = averagePair(fundamentals.totalAssets, fundamentals.previousTotalAssets);
  const comparableBalances = hasComparablePriorBalance(fundamentals);

  let roeTtm: number | null = null;
  if (!comparableBalances) {
    setStatus(metricStatuses, "roe_ttm", "insufficient_data", balancePeriodReason(fundamentals));
  } else if (averageEquity === null) {
    setStatus(metricStatuses, "roe_ttm", "insufficient_data", "missing_common_equity");
  } else if (averageEquity <= 0) {
    setStatus(metricStatuses, "roe_ttm", "not_meaningful", "negative_equity");
  } else if (!isFiniteNumber(netIncome)) {
    setStatus(metricStatuses, "roe_ttm", "insufficient_data", "missing_net_income");
  } else {
    roeTtm = netIncome / averageEquity;
    setStatus(metricStatuses, "roe_ttm", "ok");
  }

  let roaTtm: number | null = null;
  if (!comparableBalances) {
    setStatus(metricStatuses, "roa_ttm", "insufficient_data", balancePeriodReason(fundamentals));
  } else if (averageAssets === null) {
    setStatus(metricStatuses, "roa_ttm", "insufficient_data", "missing_total_assets");
  } else if (averageAssets <= 0) {
    setStatus(metricStatuses, "roa_ttm", "not_meaningful", "non_positive_total_assets");
  } else if (!isFiniteNumber(netIncome)) {
    setStatus(metricStatuses, "roa_ttm", "insufficient_data", "missing_net_income");
  } else {
    roaTtm = netIncome / averageAssets;
    setStatus(metricStatuses, "roa_ttm", "ok");
  }

  const effectiveTaxRate = computeEffectiveTaxRate(
    fundamentals.incomeTaxExpenseTtm,
    fundamentals.incomeBeforeTaxTtm,
  );
  const currentInvestedCapital = computeInvestedCapital(
    fundamentals.commonEquity,
    fundamentals.totalDebt,
    fundamentals.cashAndEquivalents,
  );
  const previousInvestedCapital = computeInvestedCapital(
    fundamentals.previousCommonEquity,
    fundamentals.previousTotalDebt,
    fundamentals.previousCashAndEquivalents,
  );
  const averageInvestedCapital = averagePair(currentInvestedCapital, previousInvestedCapital);
  let roicTtm: number | null = null;
  if (!comparableBalances) {
    setStatus(metricStatuses, "roic_ttm", "insufficient_data", balancePeriodReason(fundamentals));
  } else if (effectiveTaxRate === null) {
    const taxReason = fundamentals.incomeBeforeTaxTtm === null || fundamentals.incomeTaxExpenseTtm === null
      ? "missing_tax_inputs"
      : "invalid_tax_rate";
    setStatus(metricStatuses, "roic_ttm", "insufficient_data", taxReason);
  } else if (fundamentals.operatingIncomeTtm === null) {
    setStatus(metricStatuses, "roic_ttm", "insufficient_data", "missing_operating_income");
  } else if (averageInvestedCapital === null) {
    setStatus(metricStatuses, "roic_ttm", "insufficient_data", "missing_invested_capital");
  } else if (averageInvestedCapital <= 0) {
    setStatus(metricStatuses, "roic_ttm", "not_meaningful", "non_positive_invested_capital");
  } else {
    roicTtm = fundamentals.operatingIncomeTtm * (1 - effectiveTaxRate) / averageInvestedCapital;
    setStatus(metricStatuses, "roic_ttm", "ok");
  }

  // ---- Latest-quarter liquidity ----
  let currentRatio: number | null = null;
  if (fundamentals.totalCurrentAssets === null || fundamentals.totalCurrentLiabilities === null) {
    setStatus(metricStatuses, "current_ratio", "insufficient_data", "missing_current_assets_or_liabilities");
  } else if (fundamentals.totalCurrentLiabilities <= 0) {
    setStatus(metricStatuses, "current_ratio", "not_meaningful", "invalid_current_liabilities");
  } else if (fundamentals.totalCurrentAssets < 0) {
    setStatus(metricStatuses, "current_ratio", "not_meaningful", "negative_current_assets");
  } else {
    currentRatio = fundamentals.totalCurrentAssets / fundamentals.totalCurrentLiabilities;
    setStatus(metricStatuses, "current_ratio", "ok");
  }

  // ---- Cash conversion cycle ----
  let daysSalesOutstanding: number | null = null;
  let daysInventoryOutstanding: number | null = null;
  let daysPayablesOutstanding: number | null = null;
  let cashConversionCycleDays: number | null = null;
  const averageReceivables = averagePair(
    fundamentals.accountsReceivable,
    fundamentals.previousAccountsReceivable,
  );
  const averageInventory = averagePair(fundamentals.inventory, fundamentals.previousInventory);
  const averagePayables = averagePair(fundamentals.accountsPayable, fundamentals.previousAccountsPayable);
  if (!comparableBalances) {
    setStatus(metricStatuses, "cash_conversion_cycle_days", "insufficient_data", balancePeriodReason(fundamentals));
  } else if (
    averageReceivables === null ||
    averageInventory === null ||
    averagePayables === null
  ) {
    setStatus(metricStatuses, "cash_conversion_cycle_days", "insufficient_data", "missing_working_capital");
  } else if (!isPositive(revenue)) {
    setStatus(metricStatuses, "cash_conversion_cycle_days", "insufficient_data", "non_positive_revenue");
  } else if (!isPositive(fundamentals.costOfRevenueTtm)) {
    setStatus(metricStatuses, "cash_conversion_cycle_days", "insufficient_data", "non_positive_cost_of_revenue");
  } else {
    const days = 365;
    daysSalesOutstanding = averageReceivables / revenue * days;
    daysInventoryOutstanding = averageInventory / fundamentals.costOfRevenueTtm * days;
    daysPayablesOutstanding = averagePayables / fundamentals.costOfRevenueTtm * days;
    cashConversionCycleDays = daysSalesOutstanding + daysInventoryOutstanding - daysPayablesOutstanding;
    setStatus(metricStatuses, "cash_conversion_cycle_days", "ok");
    setStatus(metricStatuses, "days_sales_outstanding", "ok");
    setStatus(metricStatuses, "days_inventory_outstanding", "ok");
    setStatus(metricStatuses, "days_payables_outstanding", "ok");
  }

  const metricInputs = {
    return_ratios: {
      net_income_ttm: netIncome,
      common_equity_current: fundamentals.commonEquity,
      common_equity_previous: fundamentals.previousCommonEquity,
      total_assets_current: fundamentals.totalAssets,
      total_assets_previous: fundamentals.previousTotalAssets,
      operating_income_ttm: fundamentals.operatingIncomeTtm,
      income_before_tax_ttm: fundamentals.incomeBeforeTaxTtm,
      income_tax_expense_ttm: fundamentals.incomeTaxExpenseTtm,
      effective_tax_rate: effectiveTaxRate,
      invested_capital_current: currentInvestedCapital,
      invested_capital_previous: previousInvestedCapital,
    },
    liquidity: {
      total_current_assets: fundamentals.totalCurrentAssets,
      total_current_liabilities: fundamentals.totalCurrentLiabilities,
    },
    working_capital: {
      revenue_ttm: revenue,
      cost_of_revenue_ttm: fundamentals.costOfRevenueTtm,
      accounts_receivable_current: fundamentals.accountsReceivable,
      accounts_receivable_previous: fundamentals.previousAccountsReceivable,
      inventory_current: fundamentals.inventory,
      inventory_previous: fundamentals.previousInventory,
      accounts_payable_current: fundamentals.accountsPayable,
      accounts_payable_previous: fundamentals.previousAccountsPayable,
      days_basis: 365,
    },
  };

  return {
    ticker,
    sessionDate,
    priceSnapshotId,
    fundamentalSnapshotId,
    referencePrice: roundTo(stockPrice, 4) ?? stockPrice,
    currency: price.currency,
    marketCap: roundTo(cap, 2),
    enterpriseValue: roundTo(enterpriseValue, 2),
    epsTtmDiluted: roundTo(eps, 4),
    bookValuePerShare: roundTo(bvps, 4),
    freeCashFlowPerShare: roundTo(fcfPerShare, 4),
    peTtm: roundTo(peTtm, 2),
    pb: roundTo(pb, 2),
    psTtm: roundTo(psTtm, 2),
    priceToFcfTtm: roundTo(priceToFcfTtm, 2),
    earningsYield: roundTo(earningsYield, 4),
    fcfYield: roundTo(fcfYield, 4),
    roeTtm: roundTo(roeTtm, 6),
    roaTtm: roundTo(roaTtm, 6),
    roicTtm: roundTo(roicTtm, 6),
    currentRatio: roundTo(currentRatio, 4),
    cashConversionCycleDays: roundTo(cashConversionCycleDays, 2),
    daysSalesOutstanding: roundTo(daysSalesOutstanding, 2),
    daysInventoryOutstanding: roundTo(daysInventoryOutstanding, 2),
    daysPayablesOutstanding: roundTo(daysPayablesOutstanding, 2),
    metricStatuses,
    metricInputs,
    qualityFlags,
    fundamentalAvailableAt: fundamentals.availableAt,
    fundamentalPeriodEnd: fundamentals.periodEnd,
    calculationVersion: VALUATION_CALCULATION_VERSION,
    computedAt: new Date().toISOString(),
  };
}

function hasComparablePriorBalance(fundamentals: FundamentalInputs): boolean {
  if (!fundamentals.previousPeriodEnd) return false;
  const current = Date.parse(fundamentals.periodEnd);
  const previous = Date.parse(fundamentals.previousPeriodEnd);
  return Number.isFinite(current) && Number.isFinite(previous) && previous < current;
}

function balancePeriodReason(fundamentals: FundamentalInputs): string {
  return fundamentals.previousPeriodEnd ? "non_comparable_balance_periods" : "missing_prior_balance";
}

function computeEffectiveTaxRate(
  taxExpense: number | null,
  incomeBeforeTax: number | null,
): number | null {
  if (taxExpense === null || incomeBeforeTax === null || incomeBeforeTax <= 0) return null;
  const rate = taxExpense / incomeBeforeTax;
  return Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : null;
}

function computeInvestedCapital(
  equity: number | null,
  debt: number | null,
  cash: number | null,
): number | null {
  if (equity === null || debt === null || cash === null) return null;
  return equity + debt - cash;
}

function computeEnterpriseValue(
  marketCap: number | null,
  fundamentals: FundamentalInputs,
): number | null {
  if (!isPositive(marketCap)) return null;
  const cash = fundamentals.cashAndEquivalents ?? 0;
  const debt = fundamentals.totalDebt ?? 0;
  return marketCap + debt - cash;
}
