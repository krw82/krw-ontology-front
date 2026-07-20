import "server-only";

import { filingEventTagLabel } from "@/lib/filing-notifications/classification";
import { resolveFilingAccess } from "@/lib/filing-notifications/filing-access";
import { normalizeTicker } from "@/lib/ontology/ticker";
import type { CoverageOnboardingFiling } from "@/lib/onboarding/coverage-flow";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SecCompanyIdentifierRow, SecFilingEventRow } from "@/types/database";

export async function getLatestAccessibleImportantFiling(
  userId: string,
  rawTicker: string,
): Promise<CoverageOnboardingFiling | null> {
  const ticker = normalizeTicker(rawTicker);
  if (!ticker) return null;

  const admin = getSupabaseAdmin();
  const { data: identifier } = await admin
    .from("sec_company_identifiers")
    .select("ticker,cik")
    .eq("ticker", ticker)
    .maybeSingle<Pick<SecCompanyIdentifierRow, "ticker" | "cik">>();

  let eventQuery = admin
    .from("sec_filing_events")
    .select("*")
    .in("alert_priority", ["urgent", "normal"])
    .eq("processing_status", "ready")
    .order("accepted_at", { ascending: false, nullsFirst: false })
    .order("filing_date", { ascending: false })
    .limit(12);
  eventQuery = identifier?.cik
    ? eventQuery.eq("cik", identifier.cik)
    : eventQuery.eq("ticker", ticker);

  const { data: events, error } = await eventQuery.returns<SecFilingEventRow[]>();
  if (error) return null;

  for (const event of events ?? []) {
    const access = await resolveFilingAccess({ userId, filing: event }).catch(
      () => null,
    );
    if (!access) continue;
    return {
      id: event.id,
      ticker,
      form_type: event.form_type,
      filing_date: event.filing_date,
      label: filingEventTagLabel(event.primary_event_tag) ?? "중요 SEC 공시",
    };
  }
  return null;
}
