import type { NextRequest } from "next/server";
import { z } from "zod";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import {
  invalidOriginResponse,
  isExpectedMutationOrigin,
} from "@/lib/filing-notifications/request";
import { decodePulseItemId } from "@/lib/pulse/contract";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  item_ids: z.array(z.string().min(1).max(1_000)).min(1).max(20),
  feed_session_id: z.uuid(),
}).strict();

export async function PATCH(request: NextRequest) {
  if (!isExpectedMutationOrigin(request)) return invalidOriginResponse();
  let user;
  try {
    user = await getAuthUser();
  } catch (error) {
    return handleAuthError(error);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return validationError();
  const decoded = [...new Set(parsed.data.item_ids)].map((itemId) => ({
    itemId,
    itemKey: decodePulseItemId(itemId),
  }));
  if (decoded.some(({ itemKey }) => !itemKey?.startsWith("filing:"))) {
    return validationError();
  }
  const eventIds = decoded.map(({ itemKey }) => itemKey!.slice("filing:".length));
  const supabase = getSupabaseAdmin();
  const { data: events, error: eventError } = await supabase
    .from("sec_filing_events")
    .select("id")
    .in("id", eventIds)
    .eq("feed_eligible", true)
    .eq("processing_status", "ready");
  if (eventError) return internalError();
  if (new Set((events ?? []).map((event) => event.id)).size !== eventIds.length) {
    return Response.json(
      { error: { code: "not_found", message: "노출 항목을 찾지 못했습니다." } },
      { status: 404 },
    );
  }

  const seenAt = new Date().toISOString();
  const { data, error } = await supabase.rpc("record_pulse_item_impressions", {
    p_user_id: user.id,
    p_items: eventIds.map((eventId) => ({
      item_key: `filing:${eventId}`,
      source_type: "filing",
      source_id: eventId,
      kind: "filing",
    })),
    p_feed_session_id: parsed.data.feed_session_id,
    p_seen_at: seenAt,
  });
  if (error) return internalError();
  return Response.json({ recorded_count: Number(data) || eventIds.length });
}

function validationError() {
  return Response.json(
    { error: { code: "validation_error", message: "노출 요청이 올바르지 않습니다." } },
    { status: 400 },
  );
}

function internalError() {
  return Response.json(
    { error: { code: "internal_error", message: "노출 상태를 저장하지 못했습니다." } },
    { status: 500 },
  );
}
