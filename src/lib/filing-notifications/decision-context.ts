import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SecFilingEventRow } from "@/types/database";
import type { FilingDecisionNotificationContext } from "./contract";

export const EMPTY_FILING_DECISION_NOTIFICATION_CONTEXT:
  Readonly<FilingDecisionNotificationContext> = Object.freeze({
    hasPreviousJudgment: false,
    activeMonitoringRuleCount: 0,
  });

/**
 * Loads only booleans and counts needed for deterministic notification copy.
 * Judgment summaries, rationale, rule values, and generated filing briefs are
 * intentionally not selected.
 */
export async function loadFilingDecisionNotificationContexts<
  TSubscription extends { user_id: string; ticker: string },
>(
  event: Pick<SecFilingEventRow, "id" | "ticker">,
  subscriptionsByUser: ReadonlyMap<string, TSubscription>,
): Promise<Map<string, FilingDecisionNotificationContext>> {
  const contexts = new Map<string, FilingDecisionNotificationContext>();
  for (const userId of subscriptionsByUser.keys()) {
    contexts.set(userId, { ...EMPTY_FILING_DECISION_NOTIFICATION_CONTEXT });
  }
  const userIds = [...subscriptionsByUser.keys()];
  if (!userIds.length) return contexts;

  const targetTickers = Array.from(new Set([
    event.ticker,
    ...[...subscriptionsByUser.values()].map((subscription) => subscription.ticker),
  ]));
  const admin = getSupabaseAdmin();
  const [judgmentsResult, rulesResult] = await Promise.all([
    admin
      .from("user_filing_judgments")
      .select("id, user_id, filing_event_id, ticker")
      .in("user_id", userIds)
      .in("ticker", targetTickers)
      .neq("filing_event_id", event.id)
      .order("updated_at", { ascending: false })
      .limit(Math.min(5_000, Math.max(100, userIds.length * 20))),
    admin
      .from("user_company_monitoring_rules")
      .select("id, user_id, ticker")
      .in("user_id", userIds)
      .in("ticker", targetTickers)
      .eq("enabled", true)
      .limit(Math.min(5_000, Math.max(100, userIds.length * 20))),
  ]);

  // Context is an enhancement only. A migration/cache mismatch must never
  // suppress the deterministic filing alert itself.
  if (!judgmentsResult.error) {
    for (const judgment of judgmentsResult.data ?? []) {
      if (!matchesSubscriptionTicker(
        judgment.user_id,
        judgment.ticker,
        event.ticker,
        subscriptionsByUser,
      )) continue;
      const context = contexts.get(judgment.user_id);
      if (context) context.hasPreviousJudgment = true;
    }
  }
  if (!rulesResult.error) {
    const countedRuleIds = new Set<string>();
    for (const rule of rulesResult.data ?? []) {
      if (countedRuleIds.has(rule.id)) continue;
      if (!matchesSubscriptionTicker(
        rule.user_id,
        rule.ticker,
        event.ticker,
        subscriptionsByUser,
      )) continue;
      countedRuleIds.add(rule.id);
      const context = contexts.get(rule.user_id);
      if (context) context.activeMonitoringRuleCount += 1;
    }
  }

  return contexts;
}

function matchesSubscriptionTicker<
  TSubscription extends { user_id: string; ticker: string },
>(
  userId: string,
  candidateTicker: string,
  eventTicker: string,
  subscriptionsByUser: ReadonlyMap<string, TSubscription>,
): boolean {
  const subscriptionTicker = subscriptionsByUser.get(userId)?.ticker;
  return candidateTicker === eventTicker || candidateTicker === subscriptionTicker;
}
