import "server-only";

import { positionKey } from "@/lib/sec-13f/parser";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  Institutional13FFilingRow,
  Institutional13FHoldingRow,
  InstitutionalManagerRow,
  Sec13FPositionChangeRow,
} from "@/types/database";
import type { Parsed13FHolding, Sec13FFilingPackage } from "./types";
import { KNOWN_13F_MANAGERS } from "./types";

const MANAGER_SELECT =
  "cik, name, display_name, country_code, notes, latest_refresh_at, created_at, updated_at";
const FILING_SELECT =
  "id, cik, accession_number, form, report_period, filing_date, accepted_at, filing_detail_url, primary_document_url, information_table_url, entry_count, total_value_usd, source, created_at, updated_at";
const HOLDING_SELECT =
  "id, filing_id, cik, report_period, position_key, issuer_name, title_of_class, cusip, ticker, value_usd, shares, share_type, put_call, investment_discretion, other_manager, voting_authority_sole, voting_authority_shared, voting_authority_none, created_at";
const POSITION_CHANGE_SELECT =
  "id, filing_id, previous_filing_id, cik, report_period, previous_report_period, position_key, issuer_name, title_of_class, cusip, ticker, change_type, current_value_usd, previous_value_usd, value_change_usd, value_change_pct, current_weight, previous_weight, weight_change, current_shares, previous_shares, shares_change, shares_change_pct, created_at, updated_at";

export function totalValueUsd(holdings: Parsed13FHolding[]): number {
  return holdings.reduce((sum, holding) => sum + holding.valueUsd, 0);
}

export async function upsert13FFilingPackage(
  filingPackage: Sec13FFilingPackage,
): Promise<{
  manager: InstitutionalManagerRow;
  filing: Institutional13FFilingRow;
  holdings: Institutional13FHoldingRow[];
}> {
  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();
  const knownManager = KNOWN_13F_MANAGERS.find(
    (manager) => manager.cik === filingPackage.cik,
  );

  const { data: manager, error: managerError } = await admin
    .from("institutional_managers")
    .upsert(
      {
        cik: filingPackage.cik,
        name: filingPackage.managerName,
        display_name: knownManager?.displayName ?? filingPackage.managerName,
        country_code: knownManager?.countryCode ?? null,
        notes: knownManager?.notes ?? null,
        latest_refresh_at: now,
        updated_at: now,
      },
      { onConflict: "cik" },
    )
    .select(MANAGER_SELECT)
    .single<InstitutionalManagerRow>();

  if (managerError || !manager) {
    throw new Error(
      `Failed to upsert institutional manager: ${managerError?.message ?? "empty result"}`,
    );
  }

  const { data: filing, error: filingError } = await admin
    .from("sec_13f_filings")
    .upsert(
      {
        cik: filingPackage.cik,
        accession_number: filingPackage.accessionNumber,
        form: filingPackage.form,
        report_period: filingPackage.reportPeriod,
        filing_date: filingPackage.filingDate,
        accepted_at: filingPackage.acceptedAt,
        filing_detail_url: filingPackage.filingDetailUrl,
        primary_document_url: filingPackage.primaryDocumentUrl,
        information_table_url: filingPackage.informationTableUrl,
        entry_count: filingPackage.holdings.length,
        total_value_usd: totalValueUsd(filingPackage.holdings),
        source: "sec_edgar",
        updated_at: now,
      },
      { onConflict: "accession_number" },
    )
    .select(FILING_SELECT)
    .single<Institutional13FFilingRow>();

  if (filingError || !filing) {
    throw new Error(
      `Failed to upsert 13F filing: ${filingError?.message ?? "empty result"}`,
    );
  }

  const { error: deleteError } = await admin
    .from("sec_13f_holdings")
    .delete()
    .eq("filing_id", filing.id);

  if (deleteError) {
    throw new Error(`Failed to replace 13F holdings: ${deleteError.message}`);
  }

  const rows = filingPackage.holdings.map((holding) => ({
    filing_id: filing.id,
    cik: filingPackage.cik,
    report_period: filingPackage.reportPeriod,
    position_key: positionKey({
      cusip: holding.cusip,
      titleOfClass: holding.titleOfClass,
      putCall: holding.putCall,
    }),
    issuer_name: holding.issuerName,
    title_of_class: holding.titleOfClass,
    cusip: holding.cusip,
    ticker: null,
    value_usd: holding.valueUsd,
    shares: holding.shares,
    share_type: holding.shareType,
    put_call: holding.putCall,
    investment_discretion: holding.investmentDiscretion,
    other_manager: holding.otherManager,
    voting_authority_sole: holding.votingAuthoritySole,
    voting_authority_shared: holding.votingAuthorityShared,
    voting_authority_none: holding.votingAuthorityNone,
  }));

  const insertedHoldings: Institutional13FHoldingRow[] = [];
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500);
    const { data, error } = await admin
      .from("sec_13f_holdings")
      .insert(chunk)
      .select(HOLDING_SELECT)
      .returns<Institutional13FHoldingRow[]>();

    if (error) {
      throw new Error(`Failed to insert 13F holdings: ${error.message}`);
    }

    insertedHoldings.push(...(data ?? []));
  }

  return { manager, filing, holdings: insertedHoldings };
}

export async function listInstitutionalManagers(): Promise<
  InstitutionalManagerRow[]
> {
  const { data, error } = await getSupabaseAdmin()
    .from("institutional_managers")
    .select(MANAGER_SELECT)
    .order("name", { ascending: true })
    .returns<InstitutionalManagerRow[]>();

  if (error) {
    throw new Error(`Failed to list institutional managers: ${error.message}`);
  }

  return data ?? [];
}

export async function getInstitutionalManager(
  cik: string,
): Promise<InstitutionalManagerRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("institutional_managers")
    .select(MANAGER_SELECT)
    .eq("cik", cik)
    .maybeSingle<InstitutionalManagerRow>();

  if (error) {
    throw new Error(`Failed to load institutional manager: ${error.message}`);
  }

  return data ?? null;
}

export async function listFilingsForManager(
  cik: string,
  limit = 2,
): Promise<Institutional13FFilingRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("sec_13f_filings")
    .select(FILING_SELECT)
    .eq("cik", cik)
    .order("report_period", { ascending: false })
    .order("filing_date", { ascending: false })
    .limit(limit)
    .returns<Institutional13FFilingRow[]>();

  if (error) {
    throw new Error(`Failed to list 13F filings: ${error.message}`);
  }

  return data ?? [];
}

export async function listHoldingsForFiling(
  filingId: string,
  limit?: number,
): Promise<Institutional13FHoldingRow[]> {
  let query = getSupabaseAdmin()
    .from("sec_13f_holdings")
    .select(HOLDING_SELECT)
    .eq("filing_id", filingId)
    .order("value_usd", { ascending: false });

  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query.returns<Institutional13FHoldingRow[]>();

  if (error) {
    throw new Error(`Failed to list 13F holdings: ${error.message}`);
  }

  return data ?? [];
}

export async function listPositionChangesForFiling(
  filingId: string,
  options: { includeSold?: boolean; limit?: number } = {},
): Promise<Sec13FPositionChangeRow[]> {
  let query = getSupabaseAdmin()
    .from("sec_13f_position_changes")
    .select(POSITION_CHANGE_SELECT)
    .eq("filing_id", filingId)
    .order("current_value_usd", { ascending: false });

  if (!options.includeSold) {
    query = query.neq("change_type", "sold");
  }

  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query.returns<Sec13FPositionChangeRow[]>();

  if (error) {
    throw new Error(`Failed to list 13F position changes: ${error.message}`);
  }

  return data ?? [];
}

export async function listPositionChangesForTicker(
  ticker: string,
  limit = 50,
): Promise<Sec13FPositionChangeRow[]> {
  const normalizedTicker = ticker.trim().toUpperCase();
  if (!normalizedTicker) return [];

  const { data, error } = await getSupabaseAdmin()
    .from("sec_13f_position_changes")
    .select(POSITION_CHANGE_SELECT)
    .eq("ticker", normalizedTicker)
    .neq("change_type", "unchanged")
    .order("report_period", { ascending: false })
    .order("current_value_usd", { ascending: false })
    .limit(limit)
    .returns<Sec13FPositionChangeRow[]>();

  if (error) {
    throw new Error(`Failed to list 13F ticker changes: ${error.message}`);
  }

  return data ?? [];
}

export async function listPositionChangesForCusips(
  cusips: string[],
  limit = 50,
): Promise<Sec13FPositionChangeRow[]> {
  const normalizedCusips = Array.from(
    new Set(cusips.map((cusip) => cusip.trim().toUpperCase()).filter(Boolean)),
  );
  if (normalizedCusips.length === 0) return [];

  const { data, error } = await getSupabaseAdmin()
    .from("sec_13f_position_changes")
    .select(POSITION_CHANGE_SELECT)
    .in("cusip", normalizedCusips)
    .neq("change_type", "unchanged")
    .order("report_period", { ascending: false })
    .order("current_value_usd", { ascending: false })
    .limit(limit)
    .returns<Sec13FPositionChangeRow[]>();

  if (error) {
    throw new Error(`Failed to list 13F CUSIP changes: ${error.message}`);
  }

  return data ?? [];
}
