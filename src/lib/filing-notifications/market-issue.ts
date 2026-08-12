import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { safeInternalDestinationPath } from "@/lib/filing-notifications/contract";
import { queuePushDeliveries } from "@/lib/filing-notifications/push-queue";
import type {
  FilingNotificationPreferencesRow,
  UserFilingNotificationRow,
  UserFilingSubscriptionRow,
} from "@/types/database";

type Db = SupabaseClient;

type MarketIssueNotificationSource = {
  id: string;
  state: string;
  merged_into_issue_id: string | null;
  local_news_stage: string | null;
  title_ko: string;
  summary_ko: string;
  risk_level: "low" | "medium" | "high";
  published_at: string | null;
};

type MarketIssueEntity = {
  ticker: string;
  relationship: string;
};

/**
 * Fans out only a newly published, Z.ai-verified local-news issue to users
 * who explicitly subscribe to its exact direct ticker entity. The raw Finnhub
 * article is deliberately absent from this path.
 */
export async function fanoutVerifiedMarketIssueNotifications(input: {
  db: Db;
  environment: "dev" | "staging" | "prod";
  marketIssueId: string;
  now?: Date;
}): Promise<number> {
  const { data: issue, error: issueError } = await input.db
    .from("market_issues")
    .select("id,state,merged_into_issue_id,local_news_stage,title_ko,summary_ko,risk_level,published_at")
    .eq("id", input.marketIssueId)
    .maybeSingle<MarketIssueNotificationSource>();
  if (issueError) throw new Error(`Failed to load market issue notification source: ${issueError.message}`);
  if (!issue || issue.state !== "published" || issue.merged_into_issue_id || issue.local_news_stage !== "ai_verified") {
    return 0;
  }

  const { data: entities, error: entityError } = await input.db
    .from("market_issue_entities")
    .select("ticker,relationship")
    .eq("issue_id", issue.id)
    .eq("relationship", "direct")
    .returns<MarketIssueEntity[]>();
  if (entityError) throw new Error(`Failed to load market issue entities: ${entityError.message}`);

  const tickers = Array.from(new Set((entities ?? []).map((entity) => entity.ticker).filter(isTicker)));
  if (!tickers.length) return 0;

  const { data: subscriptions, error: subscriptionError } = await input.db
    .from("user_filing_subscriptions")
    .select("*")
    .eq("env", input.environment)
    .eq("enabled", true)
    .eq("catalog_collection_status", "active")
    .in("ticker", tickers)
    .returns<UserFilingSubscriptionRow[]>();
  if (subscriptionError) throw new Error(`Failed to load market issue notification subscriptions: ${subscriptionError.message}`);

  const issuePublishedAt = issue.published_at ? Date.parse(issue.published_at) : Number.NaN;
  const subscriptionsByUser = new Map<string, UserFilingSubscriptionRow>();
  for (const subscription of subscriptions ?? []) {
    if (Number.isFinite(issuePublishedAt) && issuePublishedAt < Date.parse(subscription.subscribed_at)) continue;
    const current = subscriptionsByUser.get(subscription.user_id);
    if (!current || subscription.ticker.localeCompare(current.ticker) < 0) {
      subscriptionsByUser.set(subscription.user_id, subscription);
    }
  }
  if (!subscriptionsByUser.size) return 0;

  const userIds = Array.from(subscriptionsByUser.keys());
  const { data: preferences, error: preferenceError } = await input.db
    .from("filing_notification_preferences")
    .select("*")
    .in("user_id", userIds)
    .returns<FilingNotificationPreferencesRow[]>();
  if (preferenceError) throw new Error(`Failed to load market issue notification preferences: ${preferenceError.message}`);
  const preferencesByUser = new Map((preferences ?? []).map((preference) => [preference.user_id, preference]));

  const notificationsToInsert = Array.from(subscriptionsByUser.values())
    .filter((subscription) => shouldCreateMarketIssueNotification(preferencesByUser.get(subscription.user_id)))
    .map((subscription) => ({
      user_id: subscription.user_id,
      filing_event_id: null,
      market_issue_id: issue.id,
      ticker: subscription.ticker,
      kind: "market_issue_received" as const,
      title: truncate(`${subscription.ticker} · ${issue.title_ko}`, 160),
      body: truncate(issue.summary_ko || "검증된 시장 이슈가 추가되었습니다. 요약과 검토할 영향 경로를 확인하세요.", 500),
      destination_path: safeInternalDestinationPath(`/news/${encodeURIComponent(issue.id)}`),
    }));
  if (!notificationsToInsert.length) return 0;

  const { data: notifications, error: notificationError } = await input.db
    .from("user_filing_notifications")
    .upsert(notificationsToInsert, {
      onConflict: "user_id,market_issue_id,kind,digest_bucket",
      ignoreDuplicates: true,
    })
    .select("*")
    .returns<UserFilingNotificationRow[]>();
  if (notificationError) throw new Error(`Failed to create market issue notifications: ${notificationError.message}`);

  const now = input.now ?? new Date();
  const recentPushKeys = await recentMarketPushKeys({ db: input.db, notifications: notifications ?? [], now });
  const immediate = (notifications ?? []).filter((notification) => {
    const preference = preferencesByUser.get(notification.user_id);
    return shouldQueueImmediateMarketIssuePush(issue.risk_level, preference)
      && !recentPushKeys.has(marketPushKey(notification.user_id, notification.ticker));
  });
  await queuePushDeliveries({ db: input.db, notifications: immediate });
  return notifications?.length ?? 0;
}

function shouldCreateMarketIssueNotification(preference: FilingNotificationPreferencesRow | undefined): boolean {
  return !preference || (preference.enabled && preference.notify_market_news);
}

function shouldQueueImmediateMarketIssuePush(
  riskLevel: MarketIssueNotificationSource["risk_level"],
  preference: FilingNotificationPreferencesRow | undefined,
): boolean {
  const deliveryMode = preference?.delivery_mode ?? "important_immediate";
  if (deliveryMode === "daily_digest") return false;
  if (deliveryMode === "all_immediate") return true;
  return riskLevel === "high";
}

async function recentMarketPushKeys(input: {
  db: Db;
  notifications: UserFilingNotificationRow[];
  now: Date;
}): Promise<Set<string>> {
  const userIds = Array.from(new Set(input.notifications.map((notification) => notification.user_id)));
  if (!userIds.length) return new Set();
  const since = new Date(input.now.getTime() - 12 * 60 * 60 * 1000).toISOString();
  // The cooldown is for a delivered/queued browser interruption, not for an
  // inbox row. Looking at inbox rows here would include the notification we
  // just inserted and suppress every immediate market push.
  const { data: deliveries, error: deliveryError } = await input.db
    .from("filing_notification_deliveries")
    .select("notification_id")
    .in("status", ["pending", "claimed", "retry", "sent"])
    .gte("created_at", since);
  if (deliveryError) throw new Error(`Failed to load recent market issue deliveries: ${deliveryError.message}`);

  const notificationIds = Array.from(new Set((deliveries ?? []).map((delivery) => delivery.notification_id)));
  if (!notificationIds.length) return new Set();

  const { data, error } = await input.db
    .from("user_filing_notifications")
    .select("user_id,ticker")
    .in("id", notificationIds)
    .in("user_id", userIds)
    .eq("kind", "market_issue_received")
    .returns<Array<Pick<UserFilingNotificationRow, "user_id" | "ticker">>>();
  if (error) throw new Error(`Failed to load recent market issue notifications: ${error.message}`);
  return new Set((data ?? []).filter((row) => row.ticker).map((row) => marketPushKey(row.user_id, row.ticker)));
}

function marketPushKey(userId: string, ticker: string | null): string {
  return `${userId}:${ticker ?? ""}`;
}

function truncate(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "검증된 시장 이슈";
  return normalized.length <= limit ? normalized : `${normalized.slice(0, Math.max(1, limit - 1)).trimEnd()}…`;
}

function isTicker(value: string): boolean {
  return /^[A-Z0-9][A-Z0-9.-]{0,11}$/.test(value);
}
