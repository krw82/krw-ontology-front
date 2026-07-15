import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { recordAnalyticsEvent } from "@/lib/analytics/server";
import { invalidOriginResponse, isExpectedMutationOrigin } from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  read: z.boolean().optional(),
  clicked: z.boolean().optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  snoozed_until: z.string().datetime().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ notificationId: string }> },
) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return Response.json({ error: { code: "validation_error", message: "알림 상태가 올바르지 않습니다." } }, { status: 400 });
  }
  const { notificationId } = await params;
  if (!z.string().uuid().safeParse(notificationId).success) {
    return Response.json({ error: { code: "validation_error", message: "알림 식별자가 올바르지 않습니다." } }, { status: 400 });
  }
  const now = new Date().toISOString();
  const update = {
    ...(parsed.data.read ? { read_at: now } : {}),
    ...(parsed.data.clicked ? { clicked_at: now, read_at: now } : {}),
    ...(parsed.data.pinned === undefined ? {} : { pinned_at: parsed.data.pinned ? now : null }),
    ...(parsed.data.archived === undefined ? {} : {
      archived_at: parsed.data.archived ? now : null,
      ...(parsed.data.archived ? { read_at: now, snoozed_until: null } : {}),
    }),
    ...(parsed.data.snoozed_until === undefined ? {} : { snoozed_until: parsed.data.snoozed_until }),
  };
  const { data, error } = await getSupabaseAdmin()
    .from("user_filing_notifications")
    .update(update)
    .eq("id", notificationId)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();
  if (error) {
    return Response.json({ error: { code: "service_unavailable", message: "알림 상태를 저장하지 못했습니다." } }, { status: 503 });
  }
  if (!data) return Response.json({ error: { code: "not_found", message: "알림을 찾지 못했습니다." } }, { status: 404 });
  const eventName = parsed.data.archived
    ? "filing_archived"
    : parsed.data.snoozed_until
      ? "filing_snoozed"
      : parsed.data.pinned !== undefined
        ? "filing_pinned"
        : parsed.data.read || parsed.data.clicked
          ? "filing_marked_read"
          : null;
  if (eventName) {
    await recordAnalyticsEvent({
      eventName,
      userId: user.id,
      properties: { notification_id: notificationId, ...(parsed.data.pinned !== undefined ? { pinned: parsed.data.pinned } : {}) },
    });
  }
  return Response.json({ ok: true });
}
