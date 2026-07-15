import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { recordAnalyticsEvent } from "@/lib/analytics/server";
import { invalidOriginResponse, isExpectedMutationOrigin } from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const receiptSchema = z.object({
  notification_id: z.string().trim().min(1).max(160),
  receipt_type: z.enum(["sw_push_received", "notification_show_called", "notification_clicked", "test_push_received"]),
});

export async function POST(request: NextRequest) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));
  const parsed = receiptSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: { code: "validation_error", message: "알림 수신 정보가 올바르지 않습니다." } }, { status: 400 });

  const notificationId = parsed.data.notification_id;
  const isTest = notificationId.startsWith("test-");
  let storedNotificationId: string | null = null;
  if (!isTest) {
    if (!z.string().uuid().safeParse(notificationId).success) {
      return Response.json({ error: { code: "validation_error", message: "알림 식별자가 올바르지 않습니다." } }, { status: 400 });
    }
    const { data, error } = await getSupabaseAdmin()
      .from("user_filing_notifications")
      .select("id")
      .eq("id", notificationId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return Response.json({ error: { code: "service_unavailable", message: "알림을 확인하지 못했습니다." } }, { status: 503 });
    if (!data) return Response.json({ error: { code: "not_found", message: "알림을 찾지 못했습니다." } }, { status: 404 });
    storedNotificationId = data.id;
  }

  const { data: receipt, error: receiptError } = await getSupabaseAdmin()
    .from("filing_push_receipts")
    .upsert({
      user_id: user.id,
      notification_id: storedNotificationId,
      receipt_key: notificationId,
      receipt_type: parsed.data.receipt_type,
    }, { onConflict: "user_id,receipt_key,receipt_type", ignoreDuplicates: true })
    .select("id")
    .maybeSingle();
  if (receiptError) return Response.json({ error: { code: "service_unavailable", message: "알림 수신 정보를 저장하지 못했습니다." } }, { status: 503 });
  if (receipt) {
    await recordAnalyticsEvent({
      eventName: analyticsEventForReceipt(parsed.data.receipt_type),
      userId: user.id,
      properties: { notification_id: notificationId },
    });
  }
  return Response.json({ ok: true });
}

function analyticsEventForReceipt(type: z.infer<typeof receiptSchema>["receipt_type"]) {
  if (type === "test_push_received") return "test_push_received" as const;
  if (type === "notification_clicked") return "notification_clicked" as const;
  return type;
}
