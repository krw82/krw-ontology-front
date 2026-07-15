import type { NextRequest } from "next/server";
import { z } from "zod";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import { decodePulseItemId } from "@/lib/pulse/contract";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { PULSE_LEARNING_ENTRIES } from "@/content/pulse/learning";
import type { PulseItemMutationResponse, PulseStateMutationAction } from "@/types/api-contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  action: z.enum(["read", "unread", "save", "unsave", "snooze", "dismiss", "impression"]),
  snoozed_until: z.iso.datetime().optional(),
}).strict();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const { itemId } = await params;
  const itemKey = decodePulseItemId(itemId);
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!itemKey || !parsed.success) {
    return Response.json({ error: { code: "validation_error", message: "항목 요청이 올바르지 않습니다." } }, { status: 400 });
  }
  const separator = itemKey.indexOf(":");
  const sourceType = itemKey.slice(0, separator) as "filing" | "checkup" | "question" | "resurface" | "learning";
  const sourceId = itemKey.slice(separator + 1);
  const now = new Date();
  const snoozedUntil = parsed.data.action === "snooze"
    ? parsed.data.snoozed_until ?? new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString()
    : null;

  try {
    const exists = await mutateSourceIfRequired({
      userId: user.id,
      itemKey,
      sourceType,
      sourceId,
      action: parsed.data.action,
      now: now.toISOString(),
      snoozedUntil,
    });
    if (!exists) {
      return Response.json({ error: { code: "not_found", message: "항목을 찾지 못했습니다." } }, { status: 404 });
    }
    const state = await upsertState({
      userId: user.id,
      itemKey,
      sourceType,
      sourceId,
      action: parsed.data.action,
      now: now.toISOString(),
      snoozedUntil,
    });
    if (parsed.data.action !== "impression") {
      void recordAnalyticsEventFromRequest(request, {
        eventName: "pulse_item_actioned",
        userId: user.id,
        properties: { item_kind: sourceType, action: parsed.data.action },
      });
    }
    const response: PulseItemMutationResponse = {
      item_id: itemId,
      action: parsed.data.action,
      read_at: state.read_at,
      saved_at: state.saved_at,
      snoozed_until: state.snoozed_until,
      dismissed_at: state.dismissed_at,
    };
    return Response.json(response);
  } catch {
    return Response.json({ error: { code: "internal_error", message: "항목 상태를 저장하지 못했습니다." } }, { status: 500 });
  }
}

interface MutationContext {
  userId: string;
  itemKey: string;
  sourceType: "filing" | "checkup" | "question" | "resurface" | "learning";
  sourceId: string;
  action: PulseStateMutationAction;
  now: string;
  snoozedUntil: string | null;
}

async function mutateSourceIfRequired(context: MutationContext): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  if (context.sourceType === "filing") {
    const ids = context.sourceId.split(",").filter(Boolean);
    const { data, error } = await supabase
      .from("user_filing_notifications")
      .select("id")
      .eq("user_id", context.userId)
      .in("id", ids);
    if (error) throw error;
    if (data.length !== ids.length) return false;
    if (context.action === "read" || context.action === "unread") {
      const { error: updateError } = await supabase
        .from("user_filing_notifications")
        .update({ read_at: context.action === "read" ? context.now : null })
        .eq("user_id", context.userId)
        .in("id", ids);
      if (updateError) throw updateError;
    }
    if (context.action === "snooze") {
      const { error: updateError } = await supabase
        .from("user_filing_notifications")
        .update({ snoozed_until: context.snoozedUntil })
        .eq("user_id", context.userId)
        .in("id", ids);
      if (updateError) throw updateError;
    }
    return true;
  }
  if (context.sourceType === "question") {
    const { data, error } = await supabase
      .from("user_company_questions")
      .select("id")
      .eq("id", context.sourceId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return false;
    if (context.action === "dismiss") {
      const { error: updateError } = await supabase
        .from("user_company_questions")
        .update({ status: "dismissed" })
        .eq("id", context.sourceId)
        .eq("user_id", context.userId);
      if (updateError) throw updateError;
    }
    return true;
  }
  if (context.sourceType === "resurface") {
    const separator = context.sourceId.indexOf(":");
    const resourceType = context.sourceId.slice(0, separator);
    const resourceId = context.sourceId.slice(separator + 1);
    const table = resourceType === "note"
      ? "user_research_notes"
      : resourceType === "notebook" ? "user_company_notebooks" : null;
    if (!table || !resourceId) return false;
    const { data, error } = await supabase
      .from(table)
      .select("id")
      .eq("id", resourceId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  }
  if (context.sourceType === "learning") {
    return PULSE_LEARNING_ENTRIES.some((entry) => entry.slug === context.sourceId);
  }
  if (context.sourceType === "checkup") {
    return /^\d{4}-\d{2}-\d{2}$/.test(context.sourceId);
  }
  return true;
}

async function upsertState(context: MutationContext) {
  const { data: existing, error: existingError } = await getSupabaseAdmin()
    .from("user_pulse_item_states")
    .select("first_seen_at,view_count")
    .eq("user_id", context.userId)
    .eq("item_key", context.itemKey)
    .maybeSingle();
  if (existingError && existingError.code !== "PGRST116") throw existingError;
  const fields: Record<string, string | null> = {};
  if (context.action === "read") fields.read_at = context.now;
  if (context.action === "unread") fields.read_at = null;
  if (context.action === "save") fields.saved_at = context.now;
  if (context.action === "unsave") fields.saved_at = null;
  if (context.action === "snooze") fields.snoozed_until = context.snoozedUntil;
  if (context.action === "dismiss") fields.dismissed_at = context.now;
  let impressionFields: Record<string, string | number | null> = {};
  if (context.action === "impression") {
    impressionFields = {
      last_seen_at: context.now,
      last_impression_at: context.now,
      view_count: (existing?.view_count ?? 0) + 1,
      impression_count: (existing?.view_count ?? 0) + 1,
    };
  }
  const { data, error } = await getSupabaseAdmin()
    .from("user_pulse_item_states")
    .upsert({
      user_id: context.userId,
      item_key: context.itemKey,
      source_type: context.sourceType,
      source_id: context.sourceId,
      kind: context.sourceType,
      first_seen_at: existing?.first_seen_at ?? context.now,
      ...fields,
      ...impressionFields,
    }, { onConflict: "user_id,item_key" })
    .select("read_at,saved_at,snoozed_until,dismissed_at")
    .single();
  if (error) throw error;
  return data;
}
