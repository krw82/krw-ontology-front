import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { FilingNotificationPreferencesRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/);
const updateSchema = z.object({
  enabled: z.boolean().optional(),
  notify_8k: z.boolean().optional(),
  notify_6k: z.boolean().optional(),
  notify_form4: z.boolean().optional(),
  notify_market_news: z.boolean().optional(),
  insider_notification_mode: z.enum(["none", "reported_p_s", "all"]).optional(),
  form4_immediate_min_value_usd: z.number().int().min(0).max(100_000_000).optional(),
  include_amendments: z.boolean().optional(),
  delivery_mode: z.enum(["important_immediate", "all_immediate", "daily_digest"]).optional(),
  daily_digest_at: timeSchema.optional(),
  timezone: z.string().trim().min(1).max(80).optional(),
  quiet_hours_start: timeSchema.nullable().optional(),
  quiet_hours_end: timeSchema.nullable().optional(),
});

async function requireUser() {
  try {
    const user = await getAuthUser();
    if (!user) throw new Error("No user");
    return { user } as const;
  } catch (error) {
    return { response: handleAuthError(error) } as const;
  }
}

async function getOrCreatePreferences(userId: string) {
  const admin = getSupabaseAdmin();
  await admin
    .from("filing_notification_preferences")
    .upsert({ user_id: userId }, { onConflict: "user_id", ignoreDuplicates: true });
  const { data, error } = await admin
    .from("filing_notification_preferences")
    .select("*")
    .eq("user_id", userId)
    .single<FilingNotificationPreferencesRow>();
  if (error || !data) throw new Error("preferences_unavailable");
  return data;
}

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  try {
    return Response.json({ preferences: await getOrCreatePreferences(auth.user.id) });
  } catch {
    return Response.json({ error: { code: "service_unavailable", message: "알림 설정을 불러오지 못했습니다." } }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return Response.json({ error: { code: "validation_error", message: "알림 설정이 올바르지 않습니다." } }, { status: 400 });
  }

  try {
    await getOrCreatePreferences(auth.user.id);
    const { data, error } = await getSupabaseAdmin()
      .from("filing_notification_preferences")
      .update(parsed.data)
      .eq("user_id", auth.user.id)
      .select("*")
      .single<FilingNotificationPreferencesRow>();
    if (error || !data) throw new Error("preferences_unavailable");
    return Response.json({ preferences: data });
  } catch {
    return Response.json({ error: { code: "service_unavailable", message: "알림 설정을 저장하지 못했습니다." } }, { status: 503 });
  }
}
