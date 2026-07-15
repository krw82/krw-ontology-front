import "server-only";

import { fetchSecJson } from "@/lib/filing-notifications/sec-client";
import { normalizeCik, type SecCompanyTickerRecord } from "@/lib/filing-notifications/sec-edgar";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SecCompanyIdentifierRow } from "@/types/database";

const SEC_TICKER_CATALOG_URL = "https://www.sec.gov/files/company_tickers.json";

export function normalizeFilingTicker(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(normalized) ? normalized : null;
}

export async function ensureSecCompanyIdentifier(tickerInput: string): Promise<SecCompanyIdentifierRow | null> {
  const ticker = normalizeFilingTicker(tickerInput);
  if (!ticker) return null;
  const admin = getSupabaseAdmin();
  const { data: existing, error: existingError } = await admin
    .from("sec_company_identifiers")
    .select("*")
    .eq("ticker", ticker)
    .maybeSingle<SecCompanyIdentifierRow>();
  if (existingError) throw new Error(`Failed to load SEC identifier: ${existingError.message}`);
  if (existing?.lookup_status === "resolved" && existing.cik) return existing;

  const catalog = await fetchSecJson<Record<string, SecCompanyTickerRecord>>(SEC_TICKER_CATALOG_URL);
  const aliases = [ticker, ticker.replace(/\./g, "-"), ticker.replace(/-/g, ".")];
  const match = Object.values(catalog).find((item) => {
    if (!item || typeof item.ticker !== "string") return false;
    const secTicker = item.ticker.trim().toUpperCase();
    return aliases.includes(secTicker);
  });
  const cik = match ? normalizeCik(match.cik_str) : null;
  const { data, error } = await admin
    .from("sec_company_identifiers")
    .upsert(
      {
        ticker,
        cik,
        company_name: match?.title?.trim() || null,
        lookup_status: cik ? "resolved" as const : "not_found" as const,
        last_checked_at: new Date().toISOString(),
      },
      { onConflict: "ticker" },
    )
    .select("*")
    .single<SecCompanyIdentifierRow>();
  if (error || !data) throw new Error(`Failed to save SEC identifier: ${error?.message ?? "unknown"}`);
  return data.lookup_status === "resolved" && data.cik ? data : null;
}
