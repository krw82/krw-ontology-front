import webpush from "web-push";
import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { recordAnalyticsEvent } from "@/lib/analytics/server";
import { checkDurableRateLimits, readPositiveIntEnv } from "@/lib/api/rate-limit";
import { safeInternalDestinationPath } from "@/lib/filing-notifications/contract";
import { invalidOriginResponse, isExpectedMutationOrigin } from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { PushSubscriptionRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));
  const rateLimit = await checkDurableRateLimits([{ key: `user:${user.id}`, bucket: "push_test:user:hour", limit: readPositiveIntEnv("PUSH_TESTS_PER_USER_PER_HOUR", 5), windowSeconds: 60 * 60 }]);
  if (!rateLimit.ok) return Response.json({ error: { code: rateLimit.code, message: "테스트 알림은 잠시 후 다시 시도해주세요." } }, { status: rateLimit.status });

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) {
    return Response.json({ error: { code: "not_configured", message: "알림 서버 설정이 아직 완료되지 않았습니다." } }, { status: 503 });
  }
  const { data: subscriptions, error } = await getSupabaseAdmin()
    .from("push_subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .eq("status", "active")
    .returns<PushSubscriptionRow[]>();
  if (error) return Response.json({ error: { code: "service_unavailable", message: "알림 구독을 확인하지 못했습니다." } }, { status: 503 });
  if (!subscriptions?.length) return Response.json({ error: { code: "not_subscribed", message: "먼저 이 기기에서 푸시 알림을 켜주세요." } }, { status: 409 });

  webpush.setVapidDetails(subject, publicKey, privateKey);
  const payload = JSON.stringify({
    schemaVersion: 1,
    notificationId: `test-${Date.now()}`,
    filingEventId: "test",
    kind: "filing_received",
    title: "KRW.O 공시 알림 테스트",
    body: "이 기기에서 새 SEC 공시 알림을 받을 준비가 됐습니다.",
    destinationPath: safeInternalDestinationPath("/settings/notifications"),
    tag: "filing-test",
  });
  const results = await Promise.allSettled(subscriptions.map((subscription) => webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload, { TTL: 60 * 5, urgency: "normal" })));
  const accepted = results.filter((result) => result.status === "fulfilled").length;
  await Promise.all(results.map(async (result, index) => {
    if (result.status !== "rejected") return;
    const statusCode = (result.reason as { statusCode?: unknown })?.statusCode;
    if (statusCode !== 404 && statusCode !== 410) return;
    const subscription = subscriptions[index];
    if (!subscription) return;
    await getSupabaseAdmin().from("push_subscriptions").update({ status: "revoked", revoked_at: new Date().toISOString() }).eq("id", subscription.id);
  }));
  if (!accepted) return Response.json({ error: { code: "delivery_failed", message: "테스트 알림을 푸시 서비스에 전달하지 못했습니다." } }, { status: 502 });
  await recordAnalyticsEvent({
    eventName: "push_provider_accepted",
    userId: user.id,
    properties: { source: "test_push", accepted_devices: accepted },
  });
  return Response.json({ ok: true, push_accepted: accepted });
}
