import type { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { recordAnalyticsEvent } from "@/lib/analytics/server";
import { checkDurableRateLimits, readPositiveIntEnv } from "@/lib/api/rate-limit";
import { getClientIp } from "@/lib/http/client-ip";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { PushSubscriptionRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keep a small number of active browser endpoints. A user commonly enables
// both a phone PWA and a desktop browser; silently revoking either one harms
// the notification promise.
const MAX_ACTIVE_SUBSCRIPTIONS_PER_USER = 8;
const TRUSTED_PUSH_ENDPOINT_HOSTS = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "push.services.mozilla.com",
  "web.push.apple.com",
  "notify.windows.com",
  "wns2-notify.wns.windows.com",
]);
const subscriptionSchema = z.object({
  endpoint: z.string().url().max(4096),
  expirationTime: z.number().finite().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1).max(1024),
    auth: z.string().min(1).max(1024),
  }),
});

function errorResponse(status: number, message: string) {
  return Response.json({ error: { code: "validation_error", message } }, { status });
}

function isTrustedPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "https:" &&
      (TRUSTED_PUSH_ENDPOINT_HOSTS.has(url.hostname) ||
        url.hostname.endsWith(".push.apple.com"))
    );
  } catch {
    return false;
  }
}

function endpointHash(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex");
}

async function requireUser() {
  try {
    const user = await getAuthUser();
    if (!user) throw new Error("No user");
    return { user } as const;
  } catch (error) {
    return { response: handleAuthError(error) } as const;
  }
}

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const { data, error } = await getSupabaseAdmin()
    .from("push_subscriptions")
    .select("id")
    .eq("user_id", auth.user.id)
    .eq("status", "active")
    .limit(1);
  if (error) {
    return Response.json({ error: { code: "service_unavailable", message: "알림 상태를 불러오지 못했습니다." } }, { status: 503 });
  }
  return Response.json({ subscribed: Boolean(data?.length) });
}

export async function POST(request: NextRequest) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();

  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const parsed = subscriptionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, "브라우저 알림 구독 정보가 올바르지 않습니다.");
  if (!isTrustedPushEndpoint(parsed.data.endpoint)) {
    return errorResponse(400, "지원되지 않는 브라우저 알림 구독 정보입니다.");
  }

  const rateLimit = await checkDurableRateLimits([
    {
      key: `user:${auth.user.id}`,
      bucket: "push_subscription:user:minute",
      limit: readPositiveIntEnv("PUSH_SUBSCRIPTIONS_PER_USER_PER_MINUTE", 12),
    },
    {
      key: `ip:${getClientIp(request.headers)}`,
      bucket: "push_subscription:ip:minute",
      limit: readPositiveIntEnv("PUSH_SUBSCRIPTIONS_PER_IP_PER_MINUTE", 30),
    },
  ]);
  if (!rateLimit.ok) {
    return Response.json(
      { error: { code: rateLimit.code, message: "잠시 후 다시 시도해주세요." } },
      {
        status: rateLimit.status,
        headers: rateLimit.retryAfterSeconds ? { "Retry-After": String(rateLimit.retryAfterSeconds) } : undefined,
      },
    );
  }

  const now = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("push_subscriptions")
    .upsert(
      {
        user_id: auth.user.id,
        endpoint: parsed.data.endpoint,
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        endpoint_hash: endpointHash(parsed.data.endpoint),
        expiration_time:
          parsed.data.expirationTime == null
            ? null
            : new Date(parsed.data.expirationTime).toISOString(),
        status: "active",
        revoked_at: null,
        last_seen_at: now,
      },
      { onConflict: "endpoint" },
    )
    .select("id, endpoint, status, last_seen_at")
    .single<Pick<PushSubscriptionRow, "id" | "endpoint" | "status" | "last_seen_at">>();
  if (error || !data) {
    return Response.json({ error: { code: "service_unavailable", message: "알림 구독을 저장하지 못했습니다." } }, { status: 503 });
  }

  await Promise.all([
    getSupabaseAdmin()
      .from("filing_notification_preferences")
      .upsert({ user_id: auth.user.id }, { onConflict: "user_id", ignoreDuplicates: true }),
    trimOldSubscriptions(auth.user.id),
  ]);

  return Response.json({ subscribed: true });
}

export async function DELETE(request: NextRequest) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();

  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const parsed = subscriptionSchema.pick({ endpoint: true }).safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return errorResponse(400, "해제할 알림 구독 정보가 올바르지 않습니다.");

  const { data: revoked, error } = await getSupabaseAdmin()
    .from("push_subscriptions")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("user_id", auth.user.id)
    .eq("endpoint", parsed.data.endpoint)
    .eq("status", "active")
    .select("id");
  if (error) {
    return Response.json({ error: { code: "service_unavailable", message: "알림 구독을 해제하지 못했습니다." } }, { status: 503 });
  }
  if (revoked?.length) {
    await recordAnalyticsEvent({ eventName: "push_unsubscribed", userId: auth.user.id, properties: { source: "settings" } });
  }
  return Response.json({ subscribed: false });
}

async function trimOldSubscriptions(userId: string) {
  const { data } = await getSupabaseAdmin()
    .from("push_subscriptions")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("last_seen_at", { ascending: false })
    .range(MAX_ACTIVE_SUBSCRIPTIONS_PER_USER, 49);
  const ids = (data ?? []).map((row) => row.id);
  if (!ids.length) return;
  await getSupabaseAdmin()
    .from("push_subscriptions")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .in("id", ids);
}
