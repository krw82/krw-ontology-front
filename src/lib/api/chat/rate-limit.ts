import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ErrorCode } from "@/types/api-contracts";

const WINDOW_SECONDS = 60;
const DEFAULT_USER_LIMIT = 5;
const DEFAULT_IP_LIMIT = 20;
const DEFAULT_SESSION_LIMIT = 8;

type LimitCheck = {
  key: string;
  bucket: string;
  limit: number;
};

type RateLimitArgs = {
  userId: string;
  requestId: string;
  ip: string;
  sessionId?: string | null;
};

type RateLimitAllowed = {
  ok: true;
};

type RateLimitDenied = {
  ok: false;
  response: Response;
};

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  requestId: string,
  headers?: HeadersInit,
): Response {
  return Response.json(
    { error: { code, message }, request_id: requestId },
    { status, headers },
  );
}

function getWindowStart(now: Date): string {
  const epochSeconds = Math.floor(now.getTime() / 1000);
  const windowStartSeconds =
    Math.floor(epochSeconds / WINDOW_SECONDS) * WINDOW_SECONDS;
  return new Date(windowStartSeconds * 1000).toISOString();
}

export function getClientIp(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  const firstForwardedIp = forwardedFor?.split(",")[0]?.trim();
  return (
    firstForwardedIp ||
    headers.get("x-real-ip")?.trim() ||
    headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
}

function buildLimitChecks(args: RateLimitArgs): LimitCheck[] {
  const checks: LimitCheck[] = [
    {
      key: `user:${args.userId}`,
      bucket: "chat_run:user:minute",
      limit: readPositiveIntEnv(
        "CHAT_RUNS_PER_USER_PER_MINUTE",
        DEFAULT_USER_LIMIT,
      ),
    },
    {
      key: `ip:${args.ip}`,
      bucket: "chat_run:ip:minute",
      limit: readPositiveIntEnv("CHAT_RUNS_PER_IP_PER_MINUTE", DEFAULT_IP_LIMIT),
    },
  ];

  if (args.sessionId) {
    checks.push({
      key: `session:${args.sessionId}`,
      bucket: "chat_run:session:minute",
      limit: readPositiveIntEnv(
        "CHAT_RUNS_PER_SESSION_PER_MINUTE",
        DEFAULT_SESSION_LIMIT,
      ),
    });
  }

  return checks;
}

export async function checkChatRunRateLimit(
  args: RateLimitArgs,
  now = new Date(),
): Promise<RateLimitAllowed | RateLimitDenied> {
  const admin = getSupabaseAdmin();
  const windowStart = getWindowStart(now);

  try {
    for (const check of buildLimitChecks(args)) {
      const { data, error } = await admin.rpc("increment_rate_limit", {
        p_key: check.key,
        p_bucket: check.bucket,
        p_window_start: windowStart,
        p_window_seconds: WINDOW_SECONDS,
        p_limit: check.limit,
      });

      if (error) {
        return {
          ok: false,
          response: errorResponse(
            503,
            "service_unavailable",
            "요청 제한 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.",
            args.requestId,
          ),
        };
      }

      const result = data?.[0];
      if (!result?.allowed) {
        const retryAfter = Math.max(1, result?.retry_after_seconds ?? WINDOW_SECONDS);
        return {
          ok: false,
          response: errorResponse(
            429,
            "rate_limited",
            "요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
            args.requestId,
            { "Retry-After": String(retryAfter) },
          ),
        };
      }
    }
  } catch {
    return {
      ok: false,
      response: errorResponse(
        503,
        "service_unavailable",
        "요청 제한 상태를 확인하지 못했습니다. 잠시 후 다시 시도해주세요.",
        args.requestId,
      ),
    };
  }

  return { ok: true };
}
