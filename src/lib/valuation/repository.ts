import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { normalizeTicker } from "@/lib/ontology/ticker";
import type { FundamentalInputs, PriceSnapshot, ValuationSnapshot } from "./types";

// Re-export the Supabase Row types so consumers don't need to import from
// the generated database types directly.
export type {
  FundamentalSnapshotRow,
  MarketPriceSnapshotRow,
  ValuationSnapshotRow,
} from "@/types/database";
import type {
  FundamentalSnapshotRow,
  MarketPriceSnapshotRow,
  ValuationSnapshotRow,
} from "@/types/database";

// ---- Read helpers ----

export async function getLatestValuationSnapshot(
  rawTicker: string,
): Promise<ValuationSnapshotRow | null> {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) return null;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("valuation_snapshots")
    .select("*")
    .eq("ticker", ticker)
    .order("session_date", { ascending: false, nullsFirst: false })
    .order("computed_at", { ascending: false })
    .limit(1)
    .maybeSingle<ValuationSnapshotRow>();

  if (error) {
    throw new Error(`Failed to load valuation snapshot for ${ticker}: ${error.message}`);
  }
  return data;
}

export async function getLatestValuationSnapshots(
  rawTickers: readonly string[],
): Promise<Map<string, ValuationSnapshotRow>> {
  const tickers = normalizeTickerList(rawTickers);
  const result = new Map<string, ValuationSnapshotRow>();
  if (tickers.length === 0) return result;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("valuation_snapshots")
    .select("*")
    .in("ticker", tickers)
    .order("ticker", { ascending: true })
    .order("session_date", { ascending: false, nullsFirst: false })
    .order("computed_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load valuation snapshots: ${error.message}`);
  }

  for (const row of data ?? []) {
    const existing = result.get(row.ticker);
    if (!existing) {
      result.set(row.ticker, row as ValuationSnapshotRow);
    }
  }
  return result;
}

export async function getLatestFundamentalSnapshot(
  rawTicker: string,
): Promise<FundamentalSnapshotRow | null> {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) return null;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("fundamental_snapshots")
    .select("*")
    .eq("ticker", ticker)
    .order("available_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<FundamentalSnapshotRow>();

  if (error) {
    throw new Error(`Failed to load fundamental snapshot for ${ticker}: ${error.message}`);
  }
  return data;
}

export async function getLatestPriceSnapshot(
  rawTicker: string,
): Promise<MarketPriceSnapshotRow | null> {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) return null;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("market_price_snapshots")
    .select("*")
    .eq("ticker", ticker)
    .eq("price_type", "quote")
    .order("session_date", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<MarketPriceSnapshotRow>();

  if (error) {
    throw new Error(`Failed to load price snapshot for ${ticker}: ${error.message}`);
  }
  return data;
}

// ---- Write helpers (used by refresh cycle) ----

export async function upsertMarketInstrument(
  ticker: string,
  fields: { cik?: string | null; company_name?: string | null; exchange?: string | null; currency?: string | null },
): Promise<void> {
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("market_instruments").upsert(
    {
      ticker,
      ...fields,
    },
    { onConflict: "ticker" },
  );
  if (error) {
    throw new Error(`Failed to upsert market_instruments for ${ticker}: ${error.message}`);
  }
}

export async function upsertFundamentalSnapshot(
  inputs: FundamentalInputs,
): Promise<string> {
  const admin = getSupabaseAdmin();
  const payload = {
    ticker: inputs.ticker,
    cik: inputs.cik,
    available_at: inputs.availableAt,
    period_end: inputs.periodEnd,
    filing_date: inputs.filingDate,
    form_type: inputs.formType,
    accession_numbers: inputs.accessionNumbers,
    currency: inputs.currency,
    diluted_eps_ttm: inputs.dilutedEpsTtm,
    net_income_common_ttm: inputs.netIncomeCommonTtm,
    revenue_ttm: inputs.revenueTtm,
    cost_of_revenue_ttm: inputs.costOfRevenueTtm,
    operating_income_ttm: inputs.operatingIncomeTtm,
    income_before_tax_ttm: inputs.incomeBeforeTaxTtm,
    income_tax_expense_ttm: inputs.incomeTaxExpenseTtm,
    operating_cash_flow_ttm: inputs.operatingCashFlowTtm,
    capital_expenditures_ttm: inputs.capitalExpendituresTtm,
    free_cash_flow_ttm: inputs.freeCashFlowTtm,
    common_equity: inputs.commonEquity,
    total_assets: inputs.totalAssets,
    total_current_assets: inputs.totalCurrentAssets,
    total_current_liabilities: inputs.totalCurrentLiabilities,
    accounts_receivable: inputs.accountsReceivable,
    inventory: inputs.inventory,
    accounts_payable: inputs.accountsPayable,
    shares_outstanding: inputs.sharesOutstanding,
    cash_and_equivalents: inputs.cashAndEquivalents,
    total_debt: inputs.totalDebt,
    previous_period_end: inputs.previousPeriodEnd,
    previous_common_equity: inputs.previousCommonEquity,
    previous_total_assets: inputs.previousTotalAssets,
    previous_cash_and_equivalents: inputs.previousCashAndEquivalents,
    previous_total_debt: inputs.previousTotalDebt,
    previous_accounts_receivable: inputs.previousAccountsReceivable,
    previous_inventory: inputs.previousInventory,
    previous_accounts_payable: inputs.previousAccountsPayable,
    input_lineage: inputs.inputLineage,
    quality_flags: inputs.qualityFlags,
    normalization_version: inputs.normalizationVersion,
    provider: inputs.provider,
  };

  // Some legacy databases contain duplicate disclosure rows and therefore do
  // not have the composite unique constraint expected by the initial schema.
  // Resolve the latest row explicitly so refresh can repair those databases
  // without deleting historical snapshots or relying on a missing constraint.
  const existing = await admin
    .from("fundamental_snapshots")
    .select("id")
    .eq("ticker", inputs.ticker)
    .eq("available_at", inputs.availableAt)
    .eq("period_end", inputs.periodEnd)
    .eq("provider", inputs.provider)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existing.error) {
    throw new Error(`Failed to find fundamental snapshot for ${inputs.ticker}: ${existing.error.message}`);
  }

  if (existing.data?.id) {
    const { data, error } = await admin
      .from("fundamental_snapshots")
      .update(payload)
      .eq("id", existing.data.id)
      .select("id")
      .single<{ id: string }>();
    if (error) {
      throw new Error(`Failed to update fundamental snapshot for ${inputs.ticker}: ${error.message}`);
    }
    return data.id;
  }

  const { data, error } = await admin
    .from("fundamental_snapshots")
    .insert(payload)
    .select("id")
    .single<{ id: string }>();
  if (error) {
    throw new Error(`Failed to insert fundamental snapshot for ${inputs.ticker}: ${error.message}`);
  }
  return data.id;
}

export async function upsertPriceSnapshot(snapshot: PriceSnapshot): Promise<string> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("market_price_snapshots")
    .upsert(
      {
        ticker: snapshot.ticker,
        session_date: snapshot.sessionDate,
        price_type: snapshot.priceType,
        price: snapshot.price,
        currency: snapshot.currency,
        provider: snapshot.provider,
        observed_at: snapshot.observedAt,
        provider_reference: snapshot.providerReference,
        quality_flags: snapshot.qualityFlags,
      },
      { onConflict: "ticker,session_date,price_type,provider" },
    )
    .select("id")
    .single<{ id: string }>();

  if (error) {
    throw new Error(`Failed to upsert price snapshot for ${snapshot.ticker}: ${error.message}`);
  }
  return data.id;
}

export async function insertValuationSnapshot(snapshot: ValuationSnapshot): Promise<string> {
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("valuation_snapshots")
    .upsert(
      {
        ticker: snapshot.ticker,
        session_date: snapshot.sessionDate,
        reference_price: snapshot.referencePrice,
        currency: snapshot.currency,
        price_snapshot_id: snapshot.priceSnapshotId,
        fundamental_snapshot_id: snapshot.fundamentalSnapshotId,
        market_cap: snapshot.marketCap,
        enterprise_value: snapshot.enterpriseValue,
        eps_ttm_diluted: snapshot.epsTtmDiluted,
        book_value_per_share: snapshot.bookValuePerShare,
        free_cash_flow_per_share: snapshot.freeCashFlowPerShare,
        pe_ttm: snapshot.peTtm,
        pb: snapshot.pb,
        ps_ttm: snapshot.psTtm,
        price_to_fcf_ttm: snapshot.priceToFcfTtm,
        earnings_yield: snapshot.earningsYield,
        fcf_yield: snapshot.fcfYield,
        roe_ttm: snapshot.roeTtm,
        roa_ttm: snapshot.roaTtm,
        roic_ttm: snapshot.roicTtm,
        current_ratio: snapshot.currentRatio,
        cash_conversion_cycle_days: snapshot.cashConversionCycleDays,
        days_sales_outstanding: snapshot.daysSalesOutstanding,
        days_inventory_outstanding: snapshot.daysInventoryOutstanding,
        days_payables_outstanding: snapshot.daysPayablesOutstanding,
        metric_statuses: snapshot.metricStatuses,
        metric_inputs: snapshot.metricInputs,
        quality_flags: snapshot.qualityFlags,
        fundamental_available_at: snapshot.fundamentalAvailableAt,
        fundamental_period_end: snapshot.fundamentalPeriodEnd,
        calculation_version: snapshot.calculationVersion,
        computed_at: snapshot.computedAt,
      },
      { onConflict: "ticker,session_date,calculation_version" },
    )
    .select("id")
    .single<{ id: string }>();

  if (error) {
    throw new Error(`Failed to upsert valuation snapshot for ${snapshot.ticker}: ${error.message}`);
  }
  return data.id;
}

// ---- Helpers ----

function normalizeTickerList(rawTickers: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of rawTickers) {
    const t = normalizeTicker(raw);
    if (t && !seen.has(t)) {
      seen.add(t);
      result.push(t);
    }
  }
  return result;
}
