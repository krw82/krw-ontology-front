import type { NextRequest } from "next/server";
import { z } from "zod";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import { decodePulseItemId, PULSE_ITEM_KINDS } from "@/lib/pulse/contract";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { PULSE_LEARNING_ENTRIES } from "@/content/pulse/learning";
import type {
  PulseItemKind,
  PulseItemMutationResponse,
  PulseStateMutationAction,
} from "@/types/api-contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  action: z.enum(["review", "unreview", "read", "unread", "save", "unsave", "snooze", "dismiss", "impression"]),
  snoozed_until: z.iso.datetime().optional(),
  feed_session_id: z.string().uuid().optional(),
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
  const sourceType = itemKey.slice(0, separator) as PulseItemKind;
  const sourceId = itemKey.slice(separator + 1);
  if (!PULSE_ITEM_KINDS.includes(sourceType) || !sourceId) {
    return Response.json({ error: { code: "validation_error", message: "항목 출처가 올바르지 않습니다." } }, { status: 400 });
  }

  const action = canonicalAction(parsed.data.action);
  if (action === "impression" && !parsed.data.feed_session_id) {
    return Response.json({ error: { code: "validation_error", message: "노출 세션 정보가 필요합니다." } }, { status: 400 });
  }
  const now = new Date();
  const snoozedUntil = action === "snooze"
    ? parsed.data.snoozed_until ?? new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString()
    : null;

  try {
    const exists = await mutateSourceIfRequired({
      userId: user.id,
      itemKey,
      sourceType,
      sourceId,
      action,
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
      action,
      now: now.toISOString(),
      snoozedUntil,
      feedSessionId: parsed.data.feed_session_id ?? null,
    });
    if (action !== "impression") {
      void recordAnalyticsEventFromRequest(request, {
        eventName: "pulse_item_actioned",
        userId: user.id,
        properties: { item_kind: sourceType, action },
      });
    }
    const response: PulseItemMutationResponse = {
      item_id: itemId,
      action,
      reviewed_at: state.reviewed_at,
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
  sourceType: PulseItemKind;
  sourceId: string;
  action: PulseStateMutationAction;
  now: string;
  snoozedUntil: string | null;
  feedSessionId?: string | null;
}

function canonicalAction(action: PulseStateMutationAction): PulseStateMutationAction {
  if (action === "read") return "review";
  if (action === "unread") return "unreview";
  return action;
}

async function mutateSourceIfRequired(context: MutationContext): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  if (context.sourceType === "filing") {
    const { data: event, error: eventError } = await supabase
      .from("sec_filing_events")
      .select("id")
      .eq("id", context.sourceId)
      .eq("feed_eligible", true)
      .eq("processing_status", "ready")
      .maybeSingle();
    if (eventError) throw eventError;
    if (event) {
      await syncLegacyFilingNotificationState(context);
      return true;
    }

    // One release of compatibility for item ids emitted by the notification
    // based feed. New catalog-wide filing cards use the durable event UUID
    // above and never require a user-owned notification row to exist.
    const notificationIds = context.sourceId.split(",").filter(Boolean);
    const { data: notifications, error: notificationError } = await supabase
      .from("user_filing_notifications")
      .select("id")
      .eq("user_id", context.userId)
      .in("id", notificationIds);
    if (notificationError) throw notificationError;
    if (notifications.length !== notificationIds.length) return false;
    if (context.action === "review" || context.action === "unreview") {
      const { error: updateError } = await supabase
        .from("user_filing_notifications")
        .update({ read_at: context.action === "review" ? context.now : null })
        .eq("user_id", context.userId)
        .in("id", notificationIds);
      if (updateError) throw updateError;
    }
    if (context.action === "snooze") {
      const { error: updateError } = await supabase
        .from("user_filing_notifications")
        .update({ snoozed_until: context.snoozedUntil })
        .eq("user_id", context.userId)
        .in("id", notificationIds);
      if (updateError) throw updateError;
    }
    return true;
  }
  if (context.sourceType === "analysis") return analysisBelongsToUser(context.sourceId, context.userId);
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
  if (context.sourceType === "learning") return PULSE_LEARNING_ENTRIES.some((entry) => entry.slug === context.sourceId);
  if (context.sourceType === "checkup") return /^\d{4}-\d{2}-\d{2}$/.test(context.sourceId);
  return false;
}

async function syncLegacyFilingNotificationState(context: MutationContext): Promise<void> {
  if (context.action !== "review" && context.action !== "unreview" && context.action !== "snooze") return;
  const fields = context.action === "snooze"
    ? { snoozed_until: context.snoozedUntil }
    : { read_at: context.action === "review" ? context.now : null };
  const { error } = await getSupabaseAdmin()
    .from("user_filing_notifications")
    .update(fields)
    .eq("user_id", context.userId)
    .eq("filing_event_id", context.sourceId);
  if (error) throw error;
}

async function analysisBelongsToUser(sourceId: string, userId: string): Promise<boolean> {
  const runId = sourceId.split(":", 1)[0];
  if (!runId) return false;
  const supabase = getSupabaseAdmin();
  const { data: run, error: runError } = await supabase
    .from("agent_runs")
    .select("session_id")
    .eq("id", runId)
    .maybeSingle();
  if (runError) throw runError;
  if (!run) return false;
  const { data: session, error: sessionError } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("id", run.session_id)
    .eq("user_id", userId)
    .maybeSingle();
  if (sessionError) throw sessionError;
  return Boolean(session);
}

async function upsertState(context: MutationContext) {
  const supabase = getSupabaseAdmin();
  if (context.action === "impression") {
    const { error } = await supabase.rpc("record_pulse_item_impression", {
      p_user_id: context.userId,
      p_item_key: context.itemKey,
      p_source_type: context.sourceType,
      p_source_id: context.sourceId,
      p_kind: context.sourceType,
      p_feed_session_id: context.feedSessionId!,
      p_seen_at: context.now,
    });
    if (error) throw error;
    const { data, error: stateError } = await supabase
      .from("user_pulse_item_states")
      .select("reviewed_at,read_at,saved_at,snoozed_until,dismissed_at")
      .eq("user_id", context.userId)
      .eq("item_key", context.itemKey)
      .single();
    if (stateError) throw stateError;
    return data;
  }

  const { data: existing, error: existingError } = await supabase
    .from("user_pulse_item_states")
    .select("first_seen_at")
    .eq("user_id", context.userId)
    .eq("item_key", context.itemKey)
    .maybeSingle();
  if (existingError && existingError.code !== "PGRST116") throw existingError;

  const fields: Record<string, string | null> = {};
  if (context.action === "review") {
    fields.reviewed_at = context.now;
    fields.read_at = context.now;
  }
  if (context.action === "unreview") {
    fields.reviewed_at = null;
    fields.read_at = null;
  }
  if (context.action === "save") fields.saved_at = context.now;
  if (context.action === "unsave") fields.saved_at = null;
  if (context.action === "snooze") fields.snoozed_until = context.snoozedUntil;
  if (context.action === "dismiss") fields.dismissed_at = context.now;

  const { data, error } = await supabase
    .from("user_pulse_item_states")
    .upsert({
      user_id: context.userId,
      item_key: context.itemKey,
      source_type: context.sourceType,
      source_id: context.sourceId,
      kind: context.sourceType,
      first_seen_at: existing?.first_seen_at ?? context.now,
      ...fields,
    }, { onConflict: "user_id,item_key" })
    .select("reviewed_at,read_at,saved_at,snoozed_until,dismissed_at")
    .single();
  if (error) throw error;
  return data;
}
