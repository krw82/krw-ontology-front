import { NextRequest } from "next/server";
import { isAnalyticsEventName } from "@/lib/analytics/events";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function errorResponse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as
    | {
        event_name?: unknown;
        anonymous_id?: unknown;
        properties?: unknown;
        path?: unknown;
        referrer?: unknown;
        utm?: unknown;
        session_id?: unknown;
        message_id?: unknown;
        run_id?: unknown;
      }
    | null;

  if (!body || !isAnalyticsEventName(body.event_name)) {
    return errorResponse(400, "validation_error", "이벤트 이름이 올바르지 않습니다.");
  }

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const properties = isRecord(body.properties) ? body.properties : {};

  const result = await recordAnalyticsEventFromRequest(request, {
    eventName: body.event_name,
    userId: userData.user?.id ?? null,
    anonymousId: typeof body.anonymous_id === "string" ? body.anonymous_id : null,
    properties: {
      auth_state: userData.user ? "authenticated" : "anonymous",
      ...properties,
    },
    path: typeof body.path === "string" ? body.path : null,
    referrer: typeof body.referrer === "string" ? body.referrer : null,
    utm: isRecord(body.utm) ? normalizeUtmBody(body.utm) : null,
    sessionId: typeof body.session_id === "string" ? body.session_id : null,
    messageId: typeof body.message_id === "string" ? body.message_id : null,
    runId: typeof body.run_id === "string" ? body.run_id : null,
  });

  if (!result.ok) {
    return Response.json(
      {
        ok: false,
        reason: "analytics_recording_unavailable",
      },
      { status: 202 },
    );
  }

  return Response.json({ ok: true });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeUtmBody(value: Record<string, unknown>) {
  return {
    utm_source: typeof value.utm_source === "string" ? value.utm_source : null,
    utm_medium: typeof value.utm_medium === "string" ? value.utm_medium : null,
    utm_campaign: typeof value.utm_campaign === "string" ? value.utm_campaign : null,
    utm_content: typeof value.utm_content === "string" ? value.utm_content : null,
    utm_term: typeof value.utm_term === "string" ? value.utm_term : null,
  };
}
