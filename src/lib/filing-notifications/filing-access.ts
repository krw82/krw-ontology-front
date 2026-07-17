import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SecFilingEventRow, UserFilingSubscriptionRow } from "@/types/database";

type FilingNotificationAccessRow = {
  id: string;
  read_at: string | null;
};

export type FilingAccess = {
  source: "subscription" | "notification" | "catalog";
  subscription: UserFilingSubscriptionRow | null;
  notification: FilingNotificationAccessRow | null;
};

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
