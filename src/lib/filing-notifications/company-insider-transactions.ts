import "server-only";

import { normalizeTicker } from "@/lib/ontology/ticker";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  SecCompanyIdentifierRow,
  SecFilingEventRow,
  SecForm4EventSummaryRow,
  SecForm4ReportingOwnerRow,
  SecForm4TransactionRow,
} from "@/types/database";

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 12;
const CANDIDATE_SCAN_LIMIT = 12;
const RECENT_LOOKBACK_DAYS = 90;

type CompanyForm4EventRow = Pick<
  SecFilingEventRow,
  "id" | "form_type" | "is_amendment" | "filing_date" | "occurred_at"
>;

type CompanyForm4SummaryRow = Pick<
  SecForm4EventSummaryRow,
  | "filing_event_id"
  | "reported_purchase_value"
  | "reported_sale_value"
  | "tenb5_one_status"
  | "has_reported_open_market_trade"
>;

type CompanyForm4OwnerRow = Pick<
  SecForm4ReportingOwnerRow,
  | "filing_event_id"
  | "reporting_owner_index"
  | "owner_name"
  | "is_director"
  | "is_officer"
  | "is_ten_percent_owner"
  | "is_other"
  | "officer_title"
>;

type CompanyForm4TransactionRow = Pick<
  SecForm4TransactionRow,
  "filing_event_id" | "transaction_date"
>;

export type CompanyInsiderTransaction = {
  filingEventId: string;
  formType: "4" | "4/A";
  isAmendment: boolean;
  filingDate: string;
  occurredAt: string;
  transactionDate: string | null;
  reportedPurchaseValue: number | null;
  reportedSaleValue: number | null;
  hasReportedOpenMarketTrade: boolean;
  tenb5OneStatus: "yes" | "no" | "unknown";
  owners: Array<{
    name: string;
    isDirector: boolean;
    isOfficer: boolean;
    isTenPercentOwner: boolean;
    isOther: boolean;
    officerTitle: string | null;
  }>;
};

/**
 * Reads retained, structured Form 4 facts for one company. This intentionally
 * does not use Pulse eligibility or expiry: the company page is a historical
 * reference surface, not a personalized feed. The compact company surface is
 * limited to the last 90 days and intentionally contains only reported
 * open-market purchases and sales. Grants, options, tax withholding, and
 * other Form 4 events remain available in the original SEC filing instead.
 */
export async function getRecentCompanyInsiderTransactions(
  rawTicker: string,
  requestedLimit = DEFAULT_LIMIT,
): Promise<CompanyInsiderTransaction[]> {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) return [];

  const limit = Number.isFinite(requestedLimit)
    ? Math.max(1, Math.min(Math.floor(requestedLimit), MAX_LIMIT))
    : DEFAULT_LIMIT;
  const candidateLimit = Math.max(CANDIDATE_SCAN_LIMIT, limit * 4);
  const fromDate = new Date();
  fromDate.setUTCDate(fromDate.getUTCDate() - RECENT_LOOKBACK_DAYS);
  const fromFilingDate = fromDate.toISOString().slice(0, 10);
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

  const eventsQuery = admin
    .from("sec_filing_events")
    .select("id,form_type,is_amendment,filing_date,occurred_at")
    .eq("env", filingWorkerEnv())
    .in("form_type", ["4", "4/A"])
    .eq("processing_status", "ready")
    .gte("filing_date", fromFilingDate)
    .order("occurred_at", { ascending: false })
    .limit(candidateLimit);
  const { data: events, error: eventsError } = await (
    identifier?.cik
      ? eventsQuery.eq("cik", identifier.cik)
      : eventsQuery.eq("ticker", ticker)
  ).returns<CompanyForm4EventRow[]>();

  if (eventsError) {
    throw new Error(
      `Failed to load retained Form 4 filings for ${ticker}: ${eventsError.message}`,
    );
  }
  if (!events?.length) return [];

  const filingEventIds = events.map((event) => event.id);
  const [summaryResult, ownerResult, transactionResult] = await Promise.all([
    admin
      .from("sec_form4_event_summaries")
      .select(
        "filing_event_id,reported_purchase_value,reported_sale_value,tenb5_one_status,has_reported_open_market_trade",
      )
      .in("filing_event_id", filingEventIds)
      .returns<CompanyForm4SummaryRow[]>(),
    admin
      .from("sec_form4_reporting_owners")
      .select(
        "filing_event_id,reporting_owner_index,owner_name,is_director,is_officer,is_ten_percent_owner,is_other,officer_title",
      )
      .in("filing_event_id", filingEventIds)
      .order("reporting_owner_index", { ascending: true })
      .returns<CompanyForm4OwnerRow[]>(),
    admin
      .from("sec_form4_transactions")
      .select("filing_event_id,transaction_date")
      .in("filing_event_id", filingEventIds)
      .order("transaction_date", { ascending: false, nullsFirst: false })
      .returns<CompanyForm4TransactionRow[]>(),
  ]);

  if (summaryResult.error || ownerResult.error || transactionResult.error) {
    const error =
      summaryResult.error ?? ownerResult.error ?? transactionResult.error;
    throw new Error(
      `Failed to load retained Form 4 facts for ${ticker}: ${error?.message ?? "unknown error"}`,
    );
  }

  const summariesByEventId = new Map(
    (summaryResult.data ?? []).map((summary) => [
      summary.filing_event_id,
      summary,
    ]),
  );
  const ownersByEventId = new Map<
    string,
    CompanyInsiderTransaction["owners"]
  >();
  for (const owner of ownerResult.data ?? []) {
    const owners = ownersByEventId.get(owner.filing_event_id) ?? [];
    owners.push({
      name: owner.owner_name,
      isDirector: owner.is_director,
      isOfficer: owner.is_officer,
      isTenPercentOwner: owner.is_ten_percent_owner,
      isOther: owner.is_other,
      officerTitle: owner.officer_title,
    });
    ownersByEventId.set(owner.filing_event_id, owners);
  }

  const latestTransactionDateByEventId = new Map<string, string>();
  for (const transaction of transactionResult.data ?? []) {
    if (!transaction.transaction_date) continue;
    const existing = latestTransactionDateByEventId.get(
      transaction.filing_event_id,
    );
    if (!existing || transaction.transaction_date > existing) {
      latestTransactionDateByEventId.set(
        transaction.filing_event_id,
        transaction.transaction_date,
      );
    }
  }

  const transactions: CompanyInsiderTransaction[] = events.map((event) => {
    const summary = summariesByEventId.get(event.id);
    return {
      filingEventId: event.id,
      formType: event.form_type === "4/A" ? "4/A" : "4",
      isAmendment: event.is_amendment,
      filingDate: event.filing_date,
      occurredAt: event.occurred_at,
      transactionDate: latestTransactionDateByEventId.get(event.id) ?? null,
      reportedPurchaseValue: finiteNumber(summary?.reported_purchase_value),
      reportedSaleValue: finiteNumber(summary?.reported_sale_value),
      hasReportedOpenMarketTrade:
        summary?.has_reported_open_market_trade ?? false,
      tenb5OneStatus: summary?.tenb5_one_status ?? "unknown",
      owners: ownersByEventId.get(event.id) ?? [],
    };
  });

  return transactions
    .filter((transaction) => transaction.hasReportedOpenMarketTrade)
    .sort((left, right) => {
      const leftDate = left.transactionDate ?? left.filingDate;
      const rightDate = right.transactionDate ?? right.filingDate;
      return rightDate.localeCompare(leftDate);
    })
    .slice(0, limit);
}

function filingWorkerEnv(): "dev" | "staging" | "prod" {
  const value = process.env.FILING_WORKER_ENV?.trim().toLowerCase() || "prod";
  return value === "dev" || value === "staging" || value === "prod"
    ? value
    : "prod";
}

function finiteNumber(value: unknown): number | null {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(number) ? number : null;
}
