import type { NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  buildAnalyticsEventInsert,
  type AnalyticsEventName,
  type AnalyticsEventPayload,
  type AnalyticsUtmContext,
} from "@/lib/analytics/events";
import {
  getAnonymousIdFromCookieHeader,
  getUtmContextFromCookieHeader,
} from "@/lib/analytics/utm";

export async function recordAnalyticsEvent(
  payload: AnalyticsEventPayload,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const insert = buildAnalyticsEventInsert(payload);
  if (!insert) return { ok: false, reason: "missing_identity" };

  const { error } = await getSupabaseAdmin()
    .from("analytics_events")
    .insert(insert);

  if (error) {
    console.warn("[analytics] failed to record event", {
      eventName: payload.eventName,
      reason: error.message,
    });
    return { ok: false, reason: error.message };
  }

  return { ok: true };
}

export async function recordAnalyticsEventFromRequest(
  request: Request | NextRequest,
  payload: Omit<AnalyticsEventPayload, "path" | "referrer" | "utm"> & {
    eventName: AnalyticsEventName;
    path?: string | null;
    referrer?: string | null;
    utm?: AnalyticsUtmContext | null;
  },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const context = getAnalyticsRequestContext(request);
  return recordAnalyticsEvent({
    ...payload,
    anonymousId: payload.anonymousId ?? context.anonymousId,
    path: payload.path ?? context.path,
    referrer: payload.referrer ?? context.referrer,
    utm: payload.utm ?? context.utm,
  });
}

export function getAnalyticsRequestContext(request: Request | NextRequest): {
  anonymousId: string | null;
  path: string | null;
  referrer: string | null;
  utm: AnalyticsUtmContext | null;
} {
  const cookieHeader = request.headers.get("cookie");
  const url = new URL(request.url);

  return {
    anonymousId: getAnonymousIdFromCookieHeader(cookieHeader),
    path: `${url.pathname}${url.search}`,
    referrer: request.headers.get("referer"),
    utm: getUtmContextFromCookieHeader(cookieHeader),
  };
}
