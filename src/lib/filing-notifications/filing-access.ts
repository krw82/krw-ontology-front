import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  SecFilingEventRow,
  UserFilingSubscriptionRow,
} from "@/types/database";

type FilingNotificationAccessRow = {
  id: string;
  read_at: string | null;
};

export type FilingAccess = {
  source: "subscription" | "notification" | "catalog";
  subscription: UserFilingSubscriptionRow | null;
  notification: FilingNotificationAccessRow | null;
};

const ACTIVE_COVERAGE_STATUSES = ["exploring", "watching", "holding"] as const;

/**
 * A filing can be opened either because the user explicitly follows its
 * company, or because it is still an eligible event in the active ontology
 * catalog. The latter makes Pulse's catalog-wide cards usable without turning
 * every catalog company into a personal notification subscription.
 */
export async function resolveFilingAccess(params: {
  userId: string;
  filing: SecFilingEventRow;
}): Promise<FilingAccess | null> {
  const admin = getSupabaseAdmin();
  const [subscriptionResult, notificationResult] = await Promise.all([
    admin
      .from("user_filing_subscriptions")
      .select("*")
      .eq("user_id", params.userId)
      .eq("cik", params.filing.cik)
      .order("enabled", { ascending: false })
      .limit(1)
      .maybeSingle<UserFilingSubscriptionRow>(),
    admin
      .from("user_filing_notifications")
      .select("id, read_at")
      .eq("user_id", params.userId)
      .eq("filing_event_id", params.filing.id)
      .maybeSingle<FilingNotificationAccessRow>(),
  ]);
  if (subscriptionResult.error || notificationResult.error) {
    throw new Error("personal_filing_access_unavailable");
  }

  if (subscriptionResult.data || notificationResult.data) {
    return {
      source: subscriptionResult.data ? "subscription" : "notification",
      subscription: subscriptionResult.data,
      notification: notificationResult.data,
    };
  }

  if (!params.filing.feed_eligible) return null;
  if (
    params.filing.feed_expires_at &&
    Date.parse(params.filing.feed_expires_at) <= Date.now()
  ) {
    return null;
  }

  const { data: activeRelease, error: releaseError } = await admin
    .from("ontology_catalog_releases")
    .select("release_id")
    .eq("env", params.filing.env)
    .eq("active", true)
    .maybeSingle<{ release_id: string }>();
  if (releaseError) throw new Error("active_catalog_release_unavailable");
  if (!activeRelease) return null;

  const { data: coverage, error: coverageError } = await admin
    .from("sec_filing_event_catalog_coverage")
    .select("filing_event_id")
    .eq("filing_event_id", params.filing.id)
    .eq("env", params.filing.env)
    .eq("release_id", activeRelease.release_id)
    .maybeSingle<{ filing_event_id: string }>();
  if (coverageError) throw new Error("catalog_filing_coverage_unavailable");
  if (!coverage) return null;

  return { source: "catalog", subscription: null, notification: null };
}

/**
 * Resolve the user's ticker identity for a filing whose issuer can have more
 * than one listed share class (for example GOOG/GOOGL). The stored judgment,
 * SEC-source confirmation, monitoring rule, and coverage mark must all use the
 * same ticker even though the SEC event itself has one canonical ticker.
 */
export async function resolveFilingContextTicker(params: {
  userId: string;
  filing: Pick<SecFilingEventRow, "id" | "env" | "ticker" | "cik">;
  access?: FilingAccess | null;
  requestedTicker?: string | null;
}): Promise<string> {
  const admin = getSupabaseAdmin();
  const [judgmentResult, sourceOpenResult] = await Promise.all([
    admin
      .from("user_filing_judgments")
      .select("ticker")
      .eq("user_id", params.userId)
      .eq("filing_event_id", params.filing.id)
      .maybeSingle<{ ticker: string }>(),
    admin
      .from("user_filing_source_opens")
      .select("ticker")
      .eq("user_id", params.userId)
      .eq("filing_event_id", params.filing.id)
      .maybeSingle<{ ticker: string }>(),
  ]);
  if (judgmentResult.error || sourceOpenResult.error) {
    throw new Error("personal_filing_context_unavailable");
  }

  const judgmentTicker = normalizeTicker(judgmentResult.data?.ticker);
  const sourceOpenTicker = normalizeTicker(sourceOpenResult.data?.ticker);
  const subscriptionTicker = normalizeTicker(
    params.access?.subscription?.ticker,
  );
  const requestedTicker = normalizeTicker(params.requestedTicker);
  const canonicalTicker = normalizeTicker(params.filing.ticker);

  // Once a judgment exists its ticker is immutable context for that event's
  // revision history. A later share-class subscription must not silently move
  // the parent judgment while older revisions keep another ticker.
  if (judgmentTicker) return judgmentTicker;

  const { data: activeRelease, error: releaseError } = await admin
    .from("ontology_catalog_releases")
    .select("release_id")
    .eq("env", params.filing.env)
    .eq("active", true)
    .maybeSingle<{ release_id: string }>();
  if (releaseError) throw new Error("active_catalog_release_unavailable");
  if (activeRelease) {
    const { data: coveredCompanies, error: companiesError } = await admin
      .from("ontology_companies")
      .select("ticker")
      .eq("env", params.filing.env)
      .eq("release_id", activeRelease.release_id)
      .eq("sec_cik", params.filing.cik)
      .returns<Array<{ ticker: string }>>();
    if (companiesError) throw new Error("catalog_filing_coverage_unavailable");
    const coveredTickers = Array.from(
      new Set(
        (coveredCompanies ?? [])
          .map((row) => normalizeTicker(row.ticker))
          .filter(Boolean),
      ),
    ) as string[];
    if (requestedTicker && !coveredTickers.includes(requestedTicker)) {
      throw new Error("invalid_filing_context_ticker");
    }
    if (coveredTickers.length > 0) {
      const { data: marks, error: marksError } = await admin
        .from("user_company_marks")
        .select("ticker,coverage_status")
        .eq("user_id", params.userId)
        .in("ticker", coveredTickers)
        .in("coverage_status", [...ACTIVE_COVERAGE_STATUSES])
        .order("updated_at", { ascending: false })
        .returns<Array<{ ticker: string; coverage_status: string }>>();
      if (marksError) throw new Error("personal_filing_context_unavailable");
      const activeTickers = (marks ?? [])
        .map((row) => normalizeTicker(row.ticker))
        .filter((ticker): ticker is string => Boolean(ticker));
      if (activeTickers.length > 0) {
        // The user's current coverage choice is authoritative. Prefer a
        // matching explicit subscription/judgment/source context, then the
        // canonical share class, and finally the most recently updated mark.
        return (
          [
            requestedTicker && coveredTickers.includes(requestedTicker)
              ? requestedTicker
              : null,
            subscriptionTicker,
            sourceOpenTicker,
            canonicalTicker,
          ].find((ticker): ticker is string =>
            Boolean(ticker && activeTickers.includes(ticker)),
          ) ?? activeTickers[0]
        );
      }
      if (requestedTicker) return requestedTicker;
    }
  }

  if (
    requestedTicker &&
    requestedTicker !== canonicalTicker &&
    requestedTicker !== subscriptionTicker &&
    requestedTicker !== sourceOpenTicker
  ) {
    throw new Error("invalid_filing_context_ticker");
  }

  return (
    requestedTicker ??
    subscriptionTicker ??
    sourceOpenTicker ??
    canonicalTicker ??
    params.filing.ticker
  );
}

function normalizeTicker(value: string | null | undefined): string | null {
  const normalized = value?.trim().toUpperCase();
  return normalized || null;
}
