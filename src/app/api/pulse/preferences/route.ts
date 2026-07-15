import type { NextRequest } from "next/server";
import { z } from "zod";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import { PULSE_ITEM_KINDS } from "@/lib/pulse/contract";
import {
  getPulsePreferences,
  isValidTimeZone,
  updatePulsePreferences,
} from "@/lib/pulse/preferences";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  timezone: z.string().min(1).max(80).refine(isValidTimeZone, "Invalid timezone").optional(),
  enabled_kinds: z.array(z.enum(PULSE_ITEM_KINDS)).max(PULSE_ITEM_KINDS.length).optional(),
  muted_tickers: z.array(z.string().trim().min(1).max(16)).max(200).optional(),
  daily_checkup_enabled: z.boolean().optional(),
  daily_checkup_at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/).optional(),
  question_cadence: z.enum(["daily", "three_weekly", "off"]).optional(),
  resurface_cadence: z.enum(["weekly", "biweekly", "off"]).optional(),
  learning_cadence: z.enum(["weekly", "off"]).optional(),
  learning_enabled: z.boolean().optional(),
  resurfacing_enabled: z.boolean().optional(),
}).strict();

async function authenticatedUser() {
  try {
    return { user: await getAuthUser(), response: null };
  } catch (error) {
    return { user: null, response: handleAuthError(error) };
  }
}

export async function GET() {
  const { user, response } = await authenticatedUser();
  if (response) return response;
  if (!user) return handleAuthError(new Error("No user"));
  try {
    return Response.json({ preferences: await getPulsePreferences(getSupabaseAdmin(), user.id) });
  } catch {
    return Response.json({ error: { code: "internal_error", message: "설정을 불러오지 못했습니다." } }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  const { user, response } = await authenticatedUser();
  if (response) return response;
  if (!user) return handleAuthError(new Error("No user"));
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    return Response.json({ error: { code: "validation_error", message: "변경할 설정이 올바르지 않습니다." } }, { status: 400 });
  }
  try {
    const preferences = await updatePulsePreferences(getSupabaseAdmin(), user.id, parsed.data);
    void recordAnalyticsEventFromRequest(request, {
      eventName: "pulse_preferences_updated",
      userId: user.id,
      properties: { changed_fields: Object.keys(parsed.data) },
    });
    return Response.json({ preferences });
  } catch {
    return Response.json({ error: { code: "internal_error", message: "설정을 저장하지 못했습니다." } }, { status: 500 });
  }
}
