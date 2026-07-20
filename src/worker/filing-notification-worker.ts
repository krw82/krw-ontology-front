import { randomUUID } from "node:crypto";
import webpush from "web-push";
import { recordAnalyticsEvent } from "@/lib/analytics/server";
import type { FilingPushPayload } from "@/lib/filing-notifications/contract";
import { readIntEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { runGlobalFilingPipeline } from "@/worker/filings/global-filing-pipeline";
import type {
  FilingNotificationDeliveryRow,
  FilingNotificationPreferencesRow,
  PushSubscriptionRow,
  UserFilingNotificationRow,
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
let lastRetentionCleanupAt = 0;

type DeliveryJoin = {
  delivery: FilingNotificationDeliveryRow;
  notification: UserFilingNotificationRow;
  subscription: PushSubscriptionRow;
};

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
