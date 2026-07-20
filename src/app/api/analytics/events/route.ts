import type { NextRequest } from "next/server";
import { isClientAnalyticsEventName } from "@/lib/analytics/events";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import {
  checkDurableRateLimits,
  readPositiveIntEnv,
} from "@/lib/api/rate-limit";
import { getClientIp } from "@/lib/http/client-ip";
import { getAuthUser } from "@/lib/auth";
import {
  E2E_AUTH_HEADER,
  isDevAuthBypassEnabledForHost,
} from "@/lib/dev-auth-runtime";

export const runtime = "nodejs";

const DEFAULT_ANALYTICS_EVENTS_PER_IP_PER_MINUTE = 60;
const DEFAULT_ANALYTICS_EVENTS_PER_ANON_PER_MINUTE = 120;
const MAX_ANONYMOUS_ID_LENGTH = 128;

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

  if (!body || !isClientAnalyticsEventName(body.event_name)) {
    return errorResponse(400, "validation_error", "이벤트 이름이 올바르지 않습니다.");
  }

  // The loopback-only dev/E2E auth identity is intentionally synthetic and
  // does not exist in auth.users. Treat analytics as a validated local sink so
  // release tests never write fake users or anonymous noise to the shared DB.
  if (
    isDevAuthBypassEnabledForHost(
      request.nextUrl.hostname,
      request.headers.get(E2E_AUTH_HEADER),
    )
  ) {
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  const properties = isRecord(body.properties) ? body.properties : {};
  const anonymousId = normalizeAnonymousId(body.anonymous_id);
  const rateLimit = await checkDurableRateLimits([
    {
      key: `ip:${getClientIp(request.headers)}`,
      bucket: "analytics_event:ip:minute",
      limit: readPositiveIntEnv(
        "ANALYTICS_EVENTS_PER_IP_PER_MINUTE",
        DEFAULT_ANALYTICS_EVENTS_PER_IP_PER_MINUTE,
      ),
    },
    ...(anonymousId
      ? [
          {
            key: `anon:${anonymousId}`,
            bucket: "analytics_event:anon:minute",
            limit: readPositiveIntEnv(
              "ANALYTICS_EVENTS_PER_ANONYMOUS_ID_PER_MINUTE",
              DEFAULT_ANALYTICS_EVENTS_PER_ANON_PER_MINUTE,
            ),
          },
        ]
      : []),
  ]);
  if (!rateLimit.ok) return rateLimitResponse(rateLimit);

  // Browser analytics never supplies a user id. Resolve it from the protected
  // session so authenticated retention cohorts remain trustworthy while
  // anonymous events continue to work.
  const user = await getAuthUser().catch(() => null);
  const result = await recordAnalyticsEventFromRequest(request, {
    eventName: body.event_name,
    userId: user?.id ?? null,
    anonymousId,
    properties,
    path: typeof body.path === "string" ? body.path : null,
    referrer: typeof body.referrer === "string" ? body.referrer : null,
    utm: isRecord(body.utm) ? normalizeUtmBody(body.utm) : null,
    sessionId: null,
    messageId: null,
    runId: null,
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

function rateLimitResponse(result: Exclude<Awaited<ReturnType<typeof checkDurableRateLimits>>, { ok: true }>) {
  const headers =
    result.retryAfterSeconds === undefined
      ? undefined
      : { "Retry-After": String(result.retryAfterSeconds) };
  return Response.json(
    {
      error: {
        code: result.code,
        message:
          result.status === 429
            ? "요청이 너무 많습니다. 잠시 후 다시 시도해주세요."
            : "요청 제한 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.",
      },
    },
    { status: result.status, headers },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeAnonymousId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, MAX_ANONYMOUS_ID_LENGTH) : null;
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
