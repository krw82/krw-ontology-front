import "server-only";

import { normalizeTicker } from "@/lib/ontology/ticker";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  SecCompanyIdentifierRow,
  SecFilingEventRow,
  SecFilingFormType,
} from "@/types/database";

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 12;
const RECENT_LOOKBACK_DAYS = 90;
const CURRENT_REPORT_FORMS = ["8-K", "8-K/A", "6-K", "6-K/A"] as const;

type CompanyImportantFilingRow = Pick<
  SecFilingEventRow,
  | "id"
  | "form_type"
  | "is_amendment"
  | "filing_date"
  | "occurred_at"
  | "sec_items"
  | "primary_event_tag"
>;

export type CompanyImportantFiling = {
  filingEventId: string;
  formType: Extract<SecFilingFormType, (typeof CURRENT_REPORT_FORMS)[number]>;
  isAmendment: boolean;
  filingDate: string;
  occurredAt: string;
  secItems: string[];
  primaryEventTag: string | null;
};

/**
 * Reads the recent 8-K and 6-K filings for one indexed company. This is a
 * company-reference surface, so it does not depend on a user's alert
 * subscription or on short-lived Pulse eligibility.
 */
export async function getRecentCompanyImportantFilings(
  rawTicker: string,
  requestedLimit = DEFAULT_LIMIT,
): Promise<CompanyImportantFiling[]> {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) return [];

  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.floor(requestedLimit), MAX_LIMIT))
    : DEFAULT_LIMIT;
  const fromDate = new Date();
  fromDate.setUTCDate(fromDate.getUTCDate() - RECENT_LOOKBACK_DAYS);
  const admin = getSupabaseAdmin();
  const { data: identifier, error: identifierError } = await admin
    .from("sec_company_identifiers")
    .select("ticker,cik")
    .eq("ticker", ticker)
    .maybeSingle<Pick<SecCompanyIdentifierRow, "ticker" | "cik">>();

  if (identifierError) {
    throw new Error(
      `Failed to load the SEC identifier for ${ticker}: ${identifierError.message}`,
    );
  }

  const filingsQuery = admin
    .from("sec_filing_events")
    .select(
      "id,form_type,is_amendment,filing_date,occurred_at,sec_items,primary_event_tag",
    )
    .eq("env", filingWorkerEnv())
    .in("form_type", CURRENT_REPORT_FORMS)
    .eq("processing_status", "ready")
    .gte("filing_date", fromDate.toISOString().slice(0, 10))
    .order("occurred_at", { ascending: false })
    .limit(limit);
  const { data: filings, error: filingsError } = await (
    identifier?.cik
      ? filingsQuery.eq("cik", identifier.cik)
      : filingsQuery.eq("ticker", ticker)
  ).returns<CompanyImportantFilingRow[]>();

  if (filingsError) {
    throw new Error(
      `Failed to load recent current reports for ${ticker}: ${filingsError.message}`,
    );
  }

  return (filings ?? []).map((filing) => ({
    filingEventId: filing.id,
    formType: filing.form_type as CompanyImportantFiling["formType"],
    isAmendment: filing.is_amendment,
    filingDate: filing.filing_date,
    occurredAt: filing.occurred_at,
    secItems: filing.sec_items,
    primaryEventTag: filing.primary_event_tag,
  }));
}

function filingWorkerEnv(): "dev" | "staging" | "prod" {
  const value = process.env.FILING_WORKER_ENV?.trim().toLowerCase() || "prod";
  return value === "dev" || value === "staging" || value === "prod"
    ? value
    : "prod";
}
