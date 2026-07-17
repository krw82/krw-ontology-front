import { randomUUID } from "node:crypto";
import webpush from "web-push";
import { classifyFiling, filingAlertPriority } from "@/lib/filing-notifications/classification";
import { recordAnalyticsEvent } from "@/lib/analytics/server";
import { findFilingKeywordMatches } from "@/lib/filing-notifications/keyword-matching";
import {
  filingNotificationCopy,
  type FilingPushPayload,
} from "@/lib/filing-notifications/contract";
import { fetchSecJson, fetchSecText, SecRequestError } from "@/lib/filing-notifications/sec-client";
import { isFilingInboxEligible, shouldBatchFilingPush, shouldQueueImmediateFilingPush } from "@/lib/filing-notifications/notification-policy";
import {
  parseRecentFilingCandidates,
  type SecSubmissionsRecent,
} from "@/lib/filing-notifications/sec-edgar";
import { readIntEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { runGlobalFilingPipeline } from "@/worker/filings/global-filing-pipeline";
import type {
  FilingNotificationDeliveryRow,
  FilingNotificationPreferencesRow,
  PushSubscriptionRow,
  SecFilingEventRow,
  SecFilingPollStateRow,
  UserFilingKeywordRuleRow,
  UserFilingNotificationRow,
  UserFilingSubscriptionRow,
} from "@/types/database";

const WORKER_ID =
  process.env.FILING_NOTIFICATION_WORKER_ID ||
  `filing-notification-worker-${randomUUID()}`;
const WORKER_TICK_MS = readIntEnv("FILING_WORKER_TICK_MS", 15_000, { min: 5_000 });
const CIK_POLL_INTERVAL_MS = readIntEnv(
  "SEC_CIK_POLL_INTERVAL_MS",
  readIntEnv("FILING_NOTIFICATION_POLL_INTERVAL_MS", 300_000, { min: 30_000 }),
  { min: 30_000 },
);
const POLL_BATCH_SIZE = readIntEnv("SEC_FILING_POLL_BATCH_SIZE", 10, { min: 1, max: 50 });
const DELIVERY_BATCH_SIZE = readIntEnv("FILING_NOTIFICATION_DELIVERY_BATCH_SIZE", 25, {
  min: 1,
  max: 100,
});
const MAX_PUSH_ATTEMPTS = readIntEnv("FILING_NOTIFICATION_MAX_PUSH_ATTEMPTS", 8, {
  min: 1,
  max: 20,
});
const SEC_REQUEST_DELAY_MS = readIntEnv("SEC_FILING_REQUEST_DELAY_MS", 650, {
  min: 100,
});
const FILING_WORKER_ENV = (() => {
  const value = process.env.FILING_WORKER_ENV?.trim().toLowerCase() || "prod";
  if (value !== "dev" && value !== "staging" && value !== "prod") {
    throw new Error("FILING_WORKER_ENV must be dev, staging, or prod");
  }
  return value;
})();
const FILING_WORKER_DEPLOYMENT_ID = process.env.FILING_WORKER_DEPLOYMENT_ID?.trim()
  || "gcp-compose-prod";
const SEC_GLOBAL_MIN_REQUEST_INTERVAL_MS = readIntEnv(
  "SEC_GLOBAL_MIN_REQUEST_INTERVAL_MS",
  Math.max(125, Math.min(SEC_REQUEST_DELAY_MS, 1_000)),
  { min: 100, max: 10_000 },
);
const SEC_GLOBAL_DISCOVERY_SOURCES_PER_CYCLE = readIntEnv(
  "SEC_GLOBAL_DISCOVERY_SOURCES_PER_CYCLE",
  2,
  { min: 1, max: 6 },
);
const SEC_GLOBAL_SCHEDULER_LEASE_SECONDS = readIntEnv(
  "SEC_GLOBAL_SCHEDULER_LEASE_SECONDS",
  300,
  { min: 90, max: 900 },
);
const SEC_GLOBAL_RECONCILIATION_BATCH_SIZE = readIntEnv("SEC_GLOBAL_RECONCILIATION_BATCH_SIZE", 10, {
  min: 1,
  max: 50,
});
const SEC_GLOBAL_ENRICHMENT_BATCH_SIZE = readIntEnv("SEC_GLOBAL_ENRICHMENT_BATCH_SIZE", 10, {
  min: 1,
  max: 50,
});
const SEC_GLOBAL_NOTIFICATION_BATCH_SIZE = readIntEnv("SEC_GLOBAL_NOTIFICATION_BATCH_SIZE", 25, {
  min: 1,
  max: 100,
});
const SEC_GLOBAL_CATALOG_LOOKBACK_DAYS = readIntEnv("SEC_GLOBAL_CATALOG_LOOKBACK_DAYS", 90, {
  min: 7,
  max: 365,
});
const SEC_GLOBAL_BASELINE_CLEANUP_BATCH_SIZE = readIntEnv("SEC_GLOBAL_BASELINE_CLEANUP_BATCH_SIZE", 500, {
  min: 1,
  max: 5_000,
});
const RETENTION_CLEANUP_INTERVAL_MS = readIntEnv("FILING_RETENTION_CLEANUP_INTERVAL_MS", 24 * 60 * 60 * 1000, {
  min: 60 * 60 * 1000,
});
const TICKER_PUSH_BATCH_WINDOW_MS = readIntEnv("FILING_TICKER_PUSH_BATCH_WINDOW_MS", 10 * 60 * 1000, {
  min: 60_000,
  max: 30 * 60 * 1000,
});

let lastRetentionCleanupAt = 0;

type DeliveryJoin = {
  delivery: FilingNotificationDeliveryRow;
  notification: UserFilingNotificationRow;
  subscription: PushSubscriptionRow;
};

type PollClaim = { cik: string; claim_token: string };
type UserKeywordMatch = { phrase: string; matchedContext: string };

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = () => finish();
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function detectionEnabled() {
  // Discovery defaults to on. Set this explicit kill switch to 0 to pause SEC
  // traffic; it does not stop enrichment of already discovered events.
  return process.env.FILING_DETECTION_ENABLED !== "0";
}

function notificationCreationEnabled() {
  return process.env.FILING_NOTIFICATION_CREATION_ENABLED === "1";
}

function pushEnabled() {
  return process.env.FILING_PUSH_ENABLED === "1";
}

function configureWebPush(): boolean {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

async function claimDueCiks(): Promise<PollClaim[]> {
  const { data, error } = await getSupabaseAdmin().rpc("claim_sec_filing_poll_targets", {
    p_worker_id: WORKER_ID,
    p_limit: POLL_BATCH_SIZE,
    p_lease_seconds: 120,
  });
  if (error) throw new Error(`Failed to claim SEC filing poll targets: ${error.message}`);
  return (data ?? []) as PollClaim[];
}

async function getPollState(cik: string): Promise<SecFilingPollStateRow> {
  const { data, error } = await getSupabaseAdmin()
    .from("sec_filing_poll_state")
    .select("*")
    .eq("cik", cik)
    .single<SecFilingPollStateRow>();
  if (error || !data) throw new Error(`Failed to load SEC filing poll state: ${error?.message ?? "missing"}`);
  return data;
}

async function getActiveSubscriptions(cik: string): Promise<UserFilingSubscriptionRow[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("user_filing_subscriptions")
    .select("*")
    .eq("cik", cik)
    .eq("enabled", true)
    .returns<UserFilingSubscriptionRow[]>();
  if (error) throw new Error(`Failed to load filing subscriptions: ${error.message}`);
  return data ?? [];
}

async function monitorCik(claim: PollClaim): Promise<{ created: number; filings: number }> {
  const admin = getSupabaseAdmin();
  const [state, subscriptions] = await Promise.all([
    getPollState(claim.cik),
    getActiveSubscriptions(claim.cik),
  ]);
  if (!subscriptions.length) {
    await completePoll(claim, {
      enabled: false,
      next_poll_at: new Date(Date.now() + CIK_POLL_INTERVAL_MS).toISOString(),
      consecutive_errors: 0,
      last_error: null,
    });
    return { created: 0, filings: 0 };
  }

  try {
    const payload = await fetchSecJson<{ filings?: { recent?: unknown } }>(
      `https://data.sec.gov/submissions/CIK${claim.cik}.json`,
    );
    const candidates = parseRecentFilingCandidates(
      claim.cik,
      payload.filings?.recent as SecSubmissionsRecent | undefined,
    );
    let notificationsCreated = 0;
    let filingsCreated = 0;
    const canonicalTicker = subscriptions.map((subscription) => subscription.ticker).sort()[0];

    for (const candidate of candidates) {
      const classification = classifyFiling({
        formType: candidate.formType,
        secItems: candidate.sourceMetadata.secItems,
        primaryDocDescription: candidate.sourceMetadata.primaryDocDescription,
      });
      const { data: event, error } = await admin
        .from("sec_filing_events")
        .upsert(
          {
            ticker: canonicalTicker,
            cik: candidate.cik,
            accession_number: candidate.accessionNumber,
            form_type: candidate.formType,
            is_amendment: candidate.isAmendment,
            filing_date: candidate.filingDate,
            report_date: candidate.reportDate,
            accepted_at: candidate.acceptedAt,
            primary_document_name: candidate.primaryDocumentName,
            filing_detail_url: candidate.filingDetailUrl,
            primary_document_url: candidate.primaryDocumentUrl,
            source_metadata: {
              ...candidate.sourceMetadata,
              classificationRulePhrases: classification.metadataRulePhrases,
            },
            first_seen_at: new Date().toISOString(),
            sec_items: candidate.sourceMetadata.secItems,
            event_tags: classification.eventTags,
            primary_event_tag: classification.primaryEventTag,
            classification_source: classification.source,
            classification_version: 1,
            alert_priority: filingAlertPriority(classification.primaryEventTag, candidate.sourceMetadata.secItems),
            // Filing-index metadata is fetched on the user's detail-page visit;
            // polling stays limited to per-CIK submissions JSON.
            enrichment_status: "not_requested",
          },
          { onConflict: "accession_number", ignoreDuplicates: true },
        )
        .select("*")
        .maybeSingle<SecFilingEventRow>();
      if (error) throw new Error(`Failed to save SEC filing event: ${error.message}`);
      if (!event) continue;

      filingsCreated += 1;
      if (notificationCreationEnabled()) {
        let keywordMatches = new Map<string, UserKeywordMatch[]>();
        if (state.baseline_completed_at) {
          try {
            keywordMatches = await matchKeywordRulesForFiling(event, subscriptions);
          } catch (error) {
            // Keyword enrichment is deliberately best-effort. A transient SEC
            // document failure must never suppress a reliable filing alert.
            console.warn("[filing-notification-worker] keyword matching failed", {
              accessionNumber: event.accession_number,
              error: errorMessage(error),
            });
          }
        }
        notificationsCreated += await createNotificationsForFiling(event, subscriptions, state, keywordMatches);
      }
    }

    await completePoll(claim, {
      enabled: true,
      baseline_completed_at: state.baseline_completed_at ?? new Date().toISOString(),
      next_poll_at: new Date(Date.now() + CIK_POLL_INTERVAL_MS).toISOString(),
      consecutive_errors: 0,
      last_error: null,
      last_success_at: new Date().toISOString(),
    });
    return { created: notificationsCreated, filings: filingsCreated };
  } catch (error) {
    await failPoll(claim, state, error);
    throw error;
  }
}

async function createNotificationsForFiling(
  event: SecFilingEventRow,
  subscriptions: UserFilingSubscriptionRow[],
  state: SecFilingPollStateRow,
  keywordMatchesByUser: Map<string, UserKeywordMatch[]>,
): Promise<number> {
  const admin = getSupabaseAdmin();
  const byUser = new Map<string, UserFilingSubscriptionRow>();
  for (const subscription of subscriptions) {
    const existing = byUser.get(subscription.user_id);
    if (!existing || subscription.ticker < existing.ticker) byUser.set(subscription.user_id, subscription);
  }
  const userIds = [...byUser.keys()];
  if (!userIds.length) return 0;

  const { data: preferences, error: preferencesError } = await admin
    .from("filing_notification_preferences")
    .select("*")
    .in("user_id", userIds)
    .returns<FilingNotificationPreferencesRow[]>();
  if (preferencesError) throw new Error(`Failed to load filing preferences: ${preferencesError.message}`);
  const preferencesByUser = new Map((preferences ?? []).map((row) => [row.user_id, row]));

  const subscriptionsByUser = new Map([...byUser.values()].map((subscription) => [subscription.user_id, subscription]));
  const notificationsToInsert = [...subscriptionsByUser.values()]
    .filter((subscription) => isFilingInboxEligible({
      formType: event.form_type,
      isAmendment: event.is_amendment,
      acceptedAt: event.accepted_at,
      firstSeenAt: event.first_seen_at,
      subscribedAt: subscription.subscribed_at,
      baselineCompletedAt: state.baseline_completed_at,
      preference: preferencesByUser.get(subscription.user_id),
    }))
    .map((subscription) => {
      const copy = filingNotificationCopy({
        ticker: subscription.ticker,
        formType: event.form_type,
        isAmendment: event.is_amendment,
        primaryEventTag: event.primary_event_tag,
        keywordPhrases: keywordMatchesByUser.get(subscription.user_id)?.map((match) => match.phrase),
      });
      return {
        user_id: subscription.user_id,
        filing_event_id: event.id,
        kind: "filing_received" as const,
        title: copy.title,
        body: copy.body,
        destination_path: `/filings/${encodeURIComponent(event.id)}`,
      };
    });
  if (!notificationsToInsert.length) return 0;

  const { data: notifications, error: notificationError } = await admin
    .from("user_filing_notifications")
    .upsert(notificationsToInsert, { onConflict: "user_id,filing_event_id,kind,digest_bucket", ignoreDuplicates: true })
    .select("*")
    .returns<UserFilingNotificationRow[]>();
  if (notificationError) throw new Error(`Failed to create filing notifications: ${notificationError.message}`);
  if (!notifications?.length) return 0;

  const detectedDelaySeconds = event.accepted_at
    ? Math.max(0, Math.round((Date.now() - Date.parse(event.accepted_at)) / 1_000))
    : null;
  await Promise.all(notifications.flatMap((notification) => {
    const properties = {
      filing_event_id: event.id,
      ticker: subscriptionsByUser.get(notification.user_id)?.ticker ?? event.ticker,
      form_type: event.form_type,
      priority: event.alert_priority,
      ...(detectedDelaySeconds === null ? {} : { detected_delay_seconds: detectedDelaySeconds }),
    };
    return [
      recordAnalyticsEvent({ eventName: "filing_detected", userId: notification.user_id, properties }),
      recordAnalyticsEvent({ eventName: "filing_notification_created", userId: notification.user_id, properties }),
    ];
  }));

  const notificationUserIds = Array.from(new Set(notifications.map((notification) => notification.user_id)));
  const { data: subscriptionsForPush, error: subscriptionError } = await admin
    .from("push_subscriptions")
    .select("id, user_id")
    .in("user_id", notificationUserIds)
    .eq("status", "active");
  if (subscriptionError) throw new Error(`Failed to load push subscriptions: ${subscriptionError.message}`);
  const pushIdsByUser = new Map<string, string[]>();
  for (const subscription of subscriptionsForPush ?? []) {
    const ids = pushIdsByUser.get(subscription.user_id) ?? [];
    ids.push(subscription.id);
    pushIdsByUser.set(subscription.user_id, ids);
  }
  const immediateNotifications = notifications.filter((notification) => {
    const filingSubscription = subscriptionsByUser.get(notification.user_id);
    const preference = preferencesByUser.get(notification.user_id);
    const deliveryMode = resolveDeliveryMode(filingSubscription, preference);
    return shouldQueueImmediateFilingPush({
      isAmendment: event.is_amendment,
      priority: event.alert_priority,
      preference,
      deliveryMode,
    });
  });
  await queueFilingPushDeliveries({
    event,
    notifications: immediateNotifications,
    pushIdsByUser,
  });
  return notifications.length;
}

async function queueFilingPushDeliveries(params: {
  event: SecFilingEventRow;
  notifications: UserFilingNotificationRow[];
  pushIdsByUser: Map<string, string[]>;
}): Promise<void> {
  if (!params.notifications.length) return;
  const admin = getSupabaseAdmin();
  const now = new Date();
  const batchUntil = new Date(now.getTime() + TICKER_PUSH_BATCH_WINDOW_MS).toISOString();
  const shouldBatch = shouldBatchFilingPush(params.event.alert_priority);
  for (const notification of params.notifications) {
    const existing = shouldBatch ? await pendingTickerBatch(notification.user_id, params.event.cik, now.toISOString()) : null;
    if (existing) {
      await admin.from("user_filing_notifications").update({
        title: `${params.event.ticker} · 같은 종목의 새 SEC 공시`,
        body: "같은 종목에서 10분 안에 새 공시가 연속 제출됐습니다. 공시함에서 확인하세요.",
        destination_path: "/filings",
      }).eq("id", existing.notificationId).eq("user_id", notification.user_id);
      const { error: extendError } = await admin.from("filing_notification_deliveries")
        .update({ next_attempt_at: batchUntil })
        .eq("notification_id", existing.notificationId)
        .in("status", ["pending", "retry"])
        .gt("next_attempt_at", now.toISOString());
      if (extendError) throw new Error(`Failed to extend filing ticker batch: ${extendError.message}`);
      continue;
    }
    const deliveries = (params.pushIdsByUser.get(notification.user_id) ?? []).map((subscriptionId) => ({
      notification_id: notification.id,
      subscription_id: subscriptionId,
      ...(shouldBatch ? { next_attempt_at: batchUntil } : {}),
    }));
    if (!deliveries.length) continue;
    const { error } = await admin.from("filing_notification_deliveries")
      .upsert(deliveries, { onConflict: "notification_id,subscription_id", ignoreDuplicates: true });
    if (error) throw new Error(`Failed to queue filing push deliveries: ${error.message}`);
  }
}

async function pendingTickerBatch(userId: string, cik: string, now: string): Promise<{ notificationId: string } | null> {
  const admin = getSupabaseAdmin();
  const since = new Date(Date.parse(now) - TICKER_PUSH_BATCH_WINDOW_MS).toISOString();
  const { data: notifications, error: notificationError } = await admin
    .from("user_filing_notifications").select("id, filing_event_id, created_at")
    .eq("user_id", userId).eq("kind", "filing_received").gte("created_at", since).order("created_at", { ascending: true }).limit(20);
  if (notificationError || !notifications?.length) return null;
  const eventIds = notifications.map((notification) => notification.filing_event_id);
  const [{ data: events }, { data: deliveries }] = await Promise.all([
    admin.from("sec_filing_events").select("id, cik").in("id", eventIds),
    admin.from("filing_notification_deliveries").select("notification_id, next_attempt_at, status")
      .in("notification_id", notifications.map((notification) => notification.id)).in("status", ["pending", "retry"]).gt("next_attempt_at", now),
  ]);
  const eventIdsForCik = new Set((events ?? []).filter((event) => event.cik === cik).map((event) => event.id));
  const deliveryNotificationIds = new Set((deliveries ?? []).map((delivery) => delivery.notification_id));
  const target = notifications.find((notification) => eventIdsForCik.has(notification.filing_event_id) && deliveryNotificationIds.has(notification.id));
  return target ? { notificationId: target.id } : null;
}

async function matchKeywordRulesForFiling(
  event: SecFilingEventRow,
  subscriptions: UserFilingSubscriptionRow[],
): Promise<Map<string, UserKeywordMatch[]>> {
  if (!event.primary_document_url || !isSearchableSecDocument(event.primary_document_url)) return new Map();
  const subscriptionsByUser = new Map<string, UserFilingSubscriptionRow[]>();
  for (const subscription of subscriptions) {
    const list = subscriptionsByUser.get(subscription.user_id) ?? [];
    list.push(subscription);
    subscriptionsByUser.set(subscription.user_id, list);
  }
  const userIds = [...subscriptionsByUser.keys()];
  if (!userIds.length) return new Map();
  const admin = getSupabaseAdmin();
  const { data: rules, error } = await admin
    .from("user_filing_keyword_rules")
    .select("*")
    .in("user_id", userIds)
    .eq("enabled", true)
    .returns<UserFilingKeywordRuleRow[]>();
  if (error) throw new Error(`Failed to load filing keyword rules: ${error.message}`);
  const eventTime = Date.parse(event.accepted_at ?? event.first_seen_at);
  const applicable = (rules ?? []).filter((rule) => (subscriptionsByUser.get(rule.user_id) ?? []).some((subscription) => {
    const subscribedAt = Date.parse(subscription.subscribed_at);
    return eventTime >= subscribedAt && (!rule.ticker || rule.ticker === subscription.ticker);
  }));
  if (!applicable.length) return new Map();

  const html = await fetchSecText(event.primary_document_url);
  const matches = findFilingKeywordMatches(html, applicable.map((rule) => ({ id: rule.id, userId: rule.user_id, phrase: rule.phrase })));
  if (!matches.length) return new Map();
  const { error: saveError } = await admin
    .from("filing_keyword_matches")
    .upsert(matches.map((match) => ({
      user_id: match.userId,
      filing_event_id: event.id,
      rule_id: match.id,
      document_name: event.primary_document_name,
      matched_context: match.matchedContext,
    })), { onConflict: "rule_id,filing_event_id", ignoreDuplicates: true });
  if (saveError) throw new Error(`Failed to save filing keyword matches: ${saveError.message}`);
  const byUser = new Map<string, UserKeywordMatch[]>();
  for (const match of matches) {
    const list = byUser.get(match.userId) ?? [];
    list.push({ phrase: match.phrase, matchedContext: match.matchedContext });
    byUser.set(match.userId, list);
  }
  return byUser;
}

function isSearchableSecDocument(value: string): boolean {
  try {
    const url = new URL(value);
    return url.hostname === "www.sec.gov" && /\.(?:htm|html|txt|xml)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function resolveDeliveryMode(
  subscription: UserFilingSubscriptionRow | undefined,
  preference: FilingNotificationPreferencesRow | undefined,
): FilingNotificationPreferencesRow["delivery_mode"] | undefined {
  if (subscription && subscription.delivery_mode !== "inherit") return subscription.delivery_mode;
  return preference?.delivery_mode;
}

async function queueDailyDigests(): Promise<number> {
  if (!notificationCreationEnabled()) return 0;
  const admin = getSupabaseAdmin();
  const now = new Date();
  const { data: preferences, error } = await admin
    .from("filing_notification_preferences")
    .select("*")
    .eq("enabled", true)
    .eq("delivery_mode", "daily_digest")
    .returns<FilingNotificationPreferencesRow[]>();
  if (error) throw new Error(`Failed to load daily digest preferences: ${error.message}`);

  let created = 0;
  for (const preference of preferences ?? []) {
    if (!isDailyDigestDue(preference, now)) continue;
    const since = preference.last_digest_at ?? new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const { data: sourceNotifications, error: sourceError } = await admin
      .from("user_filing_notifications")
      .select("*")
      .eq("user_id", preference.user_id)
      .eq("kind", "filing_received")
      .or(`created_at.gt.${since},read_at.is.null`)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(50)
      .returns<UserFilingNotificationRow[]>();
    if (sourceError) throw new Error(`Failed to load daily digest source notifications: ${sourceError.message}`);

    if (!sourceNotifications?.length) {
      await admin.from("filing_notification_preferences").update({ last_digest_at: now.toISOString() }).eq("user_id", preference.user_id);
      continue;
    }
    const latest = sourceNotifications[0];
    if (!latest) continue;
    const unreadCount = sourceNotifications.filter((notification) => !notification.read_at).length;
    const { data: digest, error: digestError } = await admin
      .from("user_filing_notifications")
      .upsert({
        user_id: preference.user_id,
        filing_event_id: latest.filing_event_id,
        kind: "filing_digest" as const,
        digest_bucket: zonedDateParts(now, preference.timezone).dateKey,
        title: `밤사이 관심기업 공시 ${sourceNotifications.length}건`,
        body: `읽지 않음 ${unreadCount}건을 포함해 새 공시를 공시함에 모았습니다.`,
        destination_path: "/filings",
      }, { onConflict: "user_id,filing_event_id,kind,digest_bucket", ignoreDuplicates: true })
      .select("*")
      .maybeSingle<UserFilingNotificationRow>();
    if (digestError) throw new Error(`Failed to create daily filing digest: ${digestError.message}`);

    if (digest) {
      const { data: pushSubscriptions, error: pushError } = await admin
        .from("push_subscriptions")
        .select("id")
        .eq("user_id", preference.user_id)
        .eq("status", "active");
      if (pushError) throw new Error(`Failed to load daily digest push subscriptions: ${pushError.message}`);
      if (pushSubscriptions?.length) {
        const { error: deliveryError } = await admin
          .from("filing_notification_deliveries")
          .upsert(pushSubscriptions.map((subscription) => ({
            notification_id: digest.id,
            subscription_id: subscription.id,
          })), { onConflict: "notification_id,subscription_id", ignoreDuplicates: true });
        if (deliveryError) throw new Error(`Failed to queue daily digest push deliveries: ${deliveryError.message}`);
      }
      created += 1;
    }
    await admin.from("filing_notification_preferences").update({ last_digest_at: now.toISOString() }).eq("user_id", preference.user_id);
  }
  return created;
}

function isDailyDigestDue(preference: FilingNotificationPreferencesRow, now: Date): boolean {
  try {
    const current = zonedDateParts(now, preference.timezone);
    const [hour, minute] = preference.daily_digest_at.slice(0, 5).split(":").map(Number);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return false;
    if (current.hour * 60 + current.minute < hour * 60 + minute) return false;
    if (!preference.last_digest_at) return true;
    const previous = zonedDateParts(new Date(preference.last_digest_at), preference.timezone);
    return current.dateKey !== previous.dateKey;
  } catch {
    return false;
  }
}

function zonedDateParts(date: Date, timeZone: string): { dateKey: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    dateKey: `${values.year}-${values.month}-${values.day}`,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

async function cleanupExpiredFilingData(): Promise<void> {
  if (Date.now() - lastRetentionCleanupAt < RETENTION_CLEANUP_INTERVAL_MS) return;
  lastRetentionCleanupAt = Date.now();
  const { error } = await getSupabaseAdmin().rpc("cleanup_filing_notification_retention");
  if (error) console.warn("[filing-notification-worker] filing retention cleanup failed", { error: error.message });
}

async function completePoll(
  claim: PollClaim,
  values: Partial<Pick<SecFilingPollStateRow, "enabled" | "baseline_completed_at" | "next_poll_at" | "consecutive_errors" | "last_error" | "last_success_at">>,
) {
  const { error } = await getSupabaseAdmin()
    .from("sec_filing_poll_state")
    .update({
      ...values,
      worker_id: null,
      claim_token: null,
      lease_expires_at: null,
    })
    .eq("cik", claim.cik)
    .eq("claim_token", claim.claim_token);
  if (error) throw new Error(`Failed to complete SEC filing poll: ${error.message}`);
}

async function failPoll(claim: PollClaim, state: SecFilingPollStateRow, error: unknown) {
  const attempts = state.consecutive_errors + 1;
  const retryAfter = error instanceof SecRequestError ? error.retryAfterSeconds : null;
  const retrySeconds = retryAfter ?? Math.min(60 * 60, 30 * 2 ** Math.min(attempts - 1, 7)) + Math.floor(Math.random() * 20);
  await completePoll(claim, {
    enabled: true,
    next_poll_at: new Date(Date.now() + retrySeconds * 1000).toISOString(),
    consecutive_errors: attempts,
    last_error: errorMessage(error),
  });
}

async function dispatchPushes(): Promise<number> {
  if (!pushEnabled()) return 0;
  if (!configureWebPush()) {
    console.warn("[filing-notification-worker] push delivery paused: missing VAPID configuration");
    return 0;
  }
  const admin = getSupabaseAdmin();
  const { data: claims, error: claimError } = await admin.rpc("claim_filing_notification_deliveries", {
    p_worker_id: WORKER_ID,
    p_limit: DELIVERY_BATCH_SIZE,
    p_lease_seconds: 120,
  });
  if (claimError) throw new Error(`Failed to claim push deliveries: ${claimError.message}`);
  if (!claims?.length) return 0;

  const claimTokenById = new Map(claims.map((claim) => [claim.id, claim.claim_token]));
  const { data: deliveries, error: deliveryError } = await admin
    .from("filing_notification_deliveries")
    .select("*")
    .in("id", claims.map((claim) => claim.id))
    .returns<FilingNotificationDeliveryRow[]>();
  if (deliveryError) throw new Error(`Failed to load claimed push deliveries: ${deliveryError.message}`);

  const notificationIds = Array.from(new Set((deliveries ?? []).map((delivery) => delivery.notification_id)));
  const subscriptionIds = Array.from(new Set((deliveries ?? []).map((delivery) => delivery.subscription_id)));
  const [{ data: notifications }, { data: subscriptions }] = await Promise.all([
    admin.from("user_filing_notifications").select("*").in("id", notificationIds).returns<UserFilingNotificationRow[]>(),
    admin.from("push_subscriptions").select("*").in("id", subscriptionIds).returns<PushSubscriptionRow[]>(),
  ]);
  const notificationsById = new Map((notifications ?? []).map((row) => [row.id, row]));
  const subscriptionsById = new Map((subscriptions ?? []).map((row) => [row.id, row]));

  let processed = 0;
  for (const delivery of deliveries ?? []) {
    const notification = notificationsById.get(delivery.notification_id);
    const subscription = subscriptionsById.get(delivery.subscription_id);
    const claimToken = claimTokenById.get(delivery.id);
    if (!notification || !subscription || !claimToken || subscription.status !== "active") {
      await markDeliveryFailed(delivery, claimToken ?? null, "notification_or_subscription_missing", null);
      continue;
    }
    await deliverPush({ delivery, notification, subscription });
    processed += 1;
  }
  return processed;
}

async function deliverPush(join: DeliveryJoin) {
  const { count: unreadCount } = await getSupabaseAdmin()
    .from("user_filing_notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", join.notification.user_id)
    .is("read_at", null);
  const payload: FilingPushPayload = {
    schemaVersion: 1,
    notificationId: join.notification.id,
    filingEventId: join.notification.filing_event_id,
    kind: join.notification.kind,
    title: join.notification.title,
    body: join.notification.body,
    destinationPath: join.notification.destination_path,
    tag: `filing:${join.notification.filing_event_id}:${join.notification.kind}`,
    unreadCount: unreadCount ?? undefined,
  };
  try {
    const result = await webpush.sendNotification(
      {
        endpoint: join.subscription.endpoint,
        keys: { p256dh: join.subscription.p256dh, auth: join.subscription.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 6, urgency: "normal" },
    );
    await getSupabaseAdmin()
      .from("filing_notification_deliveries")
      .update({
        status: "sent",
        attempts: join.delivery.attempts + 1,
        provider_status: result.statusCode,
        sent_at: new Date().toISOString(),
        claim_token: null,
        lease_expires_at: null,
        last_error: null,
      })
      .eq("id", join.delivery.id)
      .eq("claim_token", join.delivery.claim_token ?? "");
    await recordAnalyticsEvent({
      eventName: "push_provider_accepted",
      userId: join.notification.user_id,
      properties: { notification_id: join.notification.id, delivery_id: join.delivery.id, provider_status: result.statusCode },
    });
  } catch (error) {
    const statusCode = errorStatusCode(error);
    if (statusCode === 404 || statusCode === 410) {
      await getSupabaseAdmin()
        .from("push_subscriptions")
        .update({ status: "revoked", revoked_at: new Date().toISOString() })
        .eq("id", join.subscription.id);
      await markDeliveryFailed(join.delivery, join.delivery.claim_token, "push_subscription_gone", statusCode);
      return;
    }
    const nextAttempts = join.delivery.attempts + 1;
    if (nextAttempts >= MAX_PUSH_ATTEMPTS || (statusCode !== null && statusCode >= 400 && statusCode < 500 && statusCode !== 429)) {
      await markDeliveryFailed(join.delivery, join.delivery.claim_token, errorMessage(error), statusCode, nextAttempts);
      return;
    }
    await getSupabaseAdmin()
      .from("filing_notification_deliveries")
      .update({
        status: "retry",
        attempts: nextAttempts,
        next_attempt_at: retryAt(nextAttempts, retryAfterSeconds(error)).toISOString(),
        provider_status: statusCode,
        last_error: errorMessage(error),
        claim_token: null,
        lease_expires_at: null,
      })
      .eq("id", join.delivery.id)
      .eq("claim_token", join.delivery.claim_token ?? "");
  }
}

async function markDeliveryFailed(
  delivery: FilingNotificationDeliveryRow,
  claimToken: string | null,
  reason: string,
  providerStatus: number | null,
  attempts = delivery.attempts + 1,
) {
  const query = getSupabaseAdmin()
    .from("filing_notification_deliveries")
    .update({
      status: "failed",
      attempts,
      provider_status: providerStatus,
      last_error: reason.slice(0, 2000),
      claim_token: null,
      lease_expires_at: null,
    })
    .eq("id", delivery.id);
  if (claimToken) await query.eq("claim_token", claimToken);
  else await query;
}

function errorStatusCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function retryAfterSeconds(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const headers = (error as { headers?: unknown }).headers;
  if (!headers || typeof headers !== "object") return null;
  const raw = (headers as Record<string, unknown>)["retry-after"];
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 24 * 60 * 60) : null;
}

function retryAt(attempts: number, retryAfter: number | null): Date {
  const exponential = Math.min(60 * 60, 30 * 2 ** Math.min(attempts - 1, 7));
  const delaySeconds = retryAfter ?? exponential + Math.floor(Math.random() * 20);
  return new Date(Date.now() + delaySeconds * 1000);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 2000);
  return String(error).slice(0, 2000);
}

async function runCycle() {
  const global = await runGlobalFilingPipeline({
    env: FILING_WORKER_ENV,
    deploymentId: FILING_WORKER_DEPLOYMENT_ID,
    workerId: WORKER_ID,
    detectionEnabled: detectionEnabled(),
    notificationCreationEnabled: notificationCreationEnabled(),
    secMinRequestIntervalMs: SEC_GLOBAL_MIN_REQUEST_INTERVAL_MS,
    discoverySourcesPerCycle: SEC_GLOBAL_DISCOVERY_SOURCES_PER_CYCLE,
    schedulerLeaseSeconds: SEC_GLOBAL_SCHEDULER_LEASE_SECONDS,
    reconciliationBatchSize: SEC_GLOBAL_RECONCILIATION_BATCH_SIZE,
    enrichmentBatchSize: SEC_GLOBAL_ENRICHMENT_BATCH_SIZE,
    notificationBatchSize: SEC_GLOBAL_NOTIFICATION_BATCH_SIZE,
    catalogLookbackDays: SEC_GLOBAL_CATALOG_LOOKBACK_DAYS,
    baselineCleanupBatchSize: SEC_GLOBAL_BASELINE_CLEANUP_BATCH_SIZE,
  });
  const digestsCreated = await queueDailyDigests();
  const delivered = await dispatchPushes();
  await cleanupExpiredFilingData();
  await recordHeartbeat({ lastSuccessAt: new Date().toISOString() });
  if (global.discovered || global.enriched || global.notificationsCreated || digestsCreated || delivered) {
    console.info("[filing-notification-worker] cycle completed", {
      workerId: WORKER_ID,
      filingEnv: FILING_WORKER_ENV,
      schedulerLeader: global.schedulerLeader,
      filingsDiscovered: global.discovered,
      filingsEnriched: global.enriched,
      notificationsCreated: global.notificationsCreated,
      digestsCreated,
      pushDeliveriesProcessed: delivered,
    });
  }
}

async function recordHeartbeat(params: { lastSuccessAt?: string | null; lastError?: string | null }) {
  const now = new Date().toISOString();
  const { error } = await getSupabaseAdmin()
    .from("filing_notification_worker_heartbeats")
    .upsert({
      worker_id: WORKER_ID,
      detection_enabled: detectionEnabled(),
      push_enabled: pushEnabled(),
      last_seen_at: now,
      last_success_at: params.lastSuccessAt ?? null,
      last_error: params.lastError ?? null,
    }, { onConflict: "worker_id" });
  if (error) console.warn("[filing-notification-worker] heartbeat write failed", { error: error.message });
}

async function waitForStopSignal(controller: AbortController) {
  await new Promise<void>((resolve) => {
    const stop = () => {
      controller.abort();
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function main() {
  const controller = new AbortController();
  void waitForStopSignal(controller);
  console.info("[filing-notification-worker] started", {
    workerId: WORKER_ID,
    filingEnv: FILING_WORKER_ENV,
    deploymentId: FILING_WORKER_DEPLOYMENT_ID,
    workerTickMs: WORKER_TICK_MS,
    cikPollIntervalMs: CIK_POLL_INTERVAL_MS,
  });
  while (!controller.signal.aborted) {
    try {
      await runCycle();
    } catch (error) {
      console.error("[filing-notification-worker] cycle failed", { error: errorMessage(error) });
      await recordHeartbeat({ lastError: errorMessage(error) });
    }
    await sleep(WORKER_TICK_MS, controller.signal);
  }
  console.info("[filing-notification-worker] stopped", { workerId: WORKER_ID });
}

main().catch((error) => {
  console.error("[filing-notification-worker] fatal", { error: errorMessage(error) });
  process.exit(1);
});
