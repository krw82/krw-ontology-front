import "server-only";

import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { DesktopOntologyToolCallRow, Json } from "@/types/database";
import type { DesktopAuthContext } from "./auth";
import { desktopJsonError } from "./api-responses";
import {
  DesktopContractError,
  type DesktopOntologyToolCallRequest,
  type DesktopOntologyToolCallSuccess,
} from "./ontology-contracts";

const WINDOW_SECONDS = 60;
const DAY_SECONDS = 24 * 60 * 60;
const DEFAULT_USER_MINUTE_LIMIT = 30;
const DEFAULT_DEVICE_MINUTE_LIMIT = 30;
const DEFAULT_USER_DAY_LIMIT = 500;

type RateLimitAllowed = {
  ok: true;
  remainingToday: number | null;
};

type RateLimitDenied = {
  ok: false;
  response: Response;
};

export interface DesktopOntologyAuditStart {
  id: string;
  startedAt: number;
}

type LimitCheck = {
  key: string;
  bucket: string;
  windowStart: string;
  windowSeconds: number;
  limit: number;
  tracksDailyRemaining?: boolean;
};

export async function checkDesktopOntologyRateLimit(
  auth: DesktopAuthContext,
  now = new Date(),
): Promise<RateLimitAllowed | RateLimitDenied> {
  const admin = getSupabaseAdmin();
  let remainingToday: number | null = null;

  try {
    for (const check of buildLimitChecks(auth, now)) {
      const { data, error } = await admin.rpc("increment_rate_limit", {
        p_key: check.key,
        p_bucket: check.bucket,
        p_window_start: check.windowStart,
        p_window_seconds: check.windowSeconds,
        p_limit: check.limit,
      });

      if (error) {
        return {
          ok: false,
          response: desktopJsonError(
            "ontology_unavailable",
            "Desktop 온톨로지 사용량 제한 상태를 확인하지 못했습니다.",
            503,
            {
              message: "Desktop ontology rate-limit RPC failed",
              retryable: true,
            },
          ),
        };
      }

      const result = data?.[0];
      if (!result?.allowed) {
        const retryAfter = Math.max(
          1,
          result?.retry_after_seconds ?? check.windowSeconds,
        );
        return {
          ok: false,
          response: desktopJsonError(
            "rate_limited",
            "Desktop 온톨로지 요청이 너무 많습니다. 잠시 후 다시 시도해주세요.",
            429,
            {
              message: "Desktop ontology rate limit exceeded",
              retryable: true,
              headers: { "Retry-After": String(retryAfter) },
            },
          ),
        };
      }

      if (check.tracksDailyRemaining) {
        remainingToday = Math.max(0, check.limit - result.current_count);
      }
    }
  } catch {
    return {
      ok: false,
      response: desktopJsonError(
        "ontology_unavailable",
        "Desktop 온톨로지 사용량 제한 상태를 확인하지 못했습니다.",
        503,
        {
          message: "Desktop ontology rate-limit check failed",
          retryable: true,
        },
      ),
    };
  }

  return { ok: true, remainingToday };
}

export async function createDesktopOntologyToolAuditStart(
  request: DesktopOntologyToolCallRequest,
  auth: DesktopAuthContext,
): Promise<DesktopOntologyAuditStart> {
  const { data, error } = await getSupabaseAdmin()
    .from("desktop_ontology_tool_calls")
    .insert({
      user_id: auth.userId,
      device_id: auth.deviceId,
      local_session_id: request.local_session_id,
      local_run_id: request.local_run_id,
      tool_call_id: request.tool_call_id,
      tool_name: request.tool_name,
      arguments_hash: hashJson(request.arguments),
      arguments_summary: summarizeArguments(request) as Json,
      desktop_context: request.desktop_context as Json,
      status: "running",
    })
    .select("id, created_at")
    .single<Pick<DesktopOntologyToolCallRow, "id" | "created_at">>();

  if (error || !data) {
    throw new DesktopContractError("Failed to create Desktop ontology audit row", {
      code: "ontology_unavailable",
      publicMessage: "Desktop 온톨로지 감사 기록을 만들지 못했습니다.",
      status: 503,
      retryable: true,
    });
  }

  return {
    id: data.id,
    startedAt: Date.parse(data.created_at) || Date.now(),
  };
}

export async function finishDesktopOntologyToolAuditSuccess(
  audit: DesktopOntologyAuditStart,
  response: DesktopOntologyToolCallSuccess,
  now = new Date(),
) {
  const latencyMs = Math.max(0, now.getTime() - audit.startedAt);
  const { error } = await getSupabaseAdmin()
    .from("desktop_ontology_tool_calls")
    .update({
      status: "succeeded",
      ontology_release_id: response.ontology_release.release_id,
      latency_ms: latencyMs,
      result_count: countResultItems(response),
      result_size_bytes: resultSizeBytes(response),
      completed_at: now.toISOString(),
    })
    .eq("id", audit.id);

  if (error) {
    throw new DesktopContractError("Failed to finish Desktop ontology audit row", {
      code: "ontology_unavailable",
      publicMessage: "Desktop 온톨로지 감사 기록을 저장하지 못했습니다.",
      status: 503,
      retryable: true,
    });
  }

  return latencyMs;
}

export async function finishDesktopOntologyToolAuditFailure(
  audit: DesktopOntologyAuditStart,
  error: unknown,
  now = new Date(),
) {
  const { error: updateError } = await getSupabaseAdmin()
    .from("desktop_ontology_tool_calls")
    .update({
      status: "failed",
      latency_ms: Math.max(0, now.getTime() - audit.startedAt),
      error_code: errorCode(error),
      completed_at: now.toISOString(),
    })
    .eq("id", audit.id);

  if (updateError) {
    throw new DesktopContractError(
      "Failed to finish failed Desktop ontology audit row",
      {
        code: "ontology_unavailable",
        publicMessage: "Desktop 온톨로지 감사 기록을 저장하지 못했습니다.",
        status: 503,
        retryable: true,
      },
    );
  }
}

export function withDesktopOntologyUsage(
  response: DesktopOntologyToolCallSuccess,
  audit: DesktopOntologyAuditStart,
  usage: RateLimitAllowed,
  latencyMs: number,
): DesktopOntologyToolCallSuccess {
  return {
    ...response,
    usage: {
      ...response.usage,
      remaining_today: usage.remainingToday ?? response.usage?.remaining_today,
    },
    audit: {
      ...response.audit,
      server_tool_call_id: audit.id,
      latency_ms: latencyMs,
    },
  };
}

function buildLimitChecks(
  auth: DesktopAuthContext,
  now: Date,
): LimitCheck[] {
  const minuteWindowStart = windowStart(now, WINDOW_SECONDS);
  const dayWindowStart = dayStart(now);
  const checks: LimitCheck[] = [
    {
      key: `user:${auth.userId}`,
      bucket: "desktop_ontology:user:minute",
      windowStart: minuteWindowStart,
      windowSeconds: WINDOW_SECONDS,
      limit: readPositiveIntEnv(
        "DESKTOP_ONTOLOGY_TOOL_CALLS_PER_USER_PER_MINUTE",
        DEFAULT_USER_MINUTE_LIMIT,
      ),
    },
    {
      key: `user:${auth.userId}`,
      bucket: "desktop_ontology:user:day",
      windowStart: dayWindowStart,
      windowSeconds: DAY_SECONDS,
      limit: readPositiveIntEnv(
        "DESKTOP_ONTOLOGY_TOOL_CALLS_PER_USER_PER_DAY",
        DEFAULT_USER_DAY_LIMIT,
      ),
      tracksDailyRemaining: true,
    },
  ];

  if (auth.deviceId) {
    checks.splice(1, 0, {
      key: `device:${auth.deviceId}`,
      bucket: "desktop_ontology:device:minute",
      windowStart: minuteWindowStart,
      windowSeconds: WINDOW_SECONDS,
      limit: readPositiveIntEnv(
        "DESKTOP_ONTOLOGY_TOOL_CALLS_PER_DEVICE_PER_MINUTE",
        DEFAULT_DEVICE_MINUTE_LIMIT,
      ),
    });
  }

  return checks;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

function windowStart(now: Date, windowSeconds: number): string {
  const epochSeconds = Math.floor(now.getTime() / 1000);
  const windowStartSeconds =
    Math.floor(epochSeconds / windowSeconds) * windowSeconds;
  return new Date(windowStartSeconds * 1000).toISOString();
}

function dayStart(now: Date): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

function hashJson(value: unknown) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function summarizeArguments(request: DesktopOntologyToolCallRequest): Json {
  const args = request.arguments;
  return {
    tool_name: request.tool_name,
    tickers: Array.isArray(args.tickers)
      ? args.tickers.filter((ticker): ticker is string => typeof ticker === "string")
      : typeof args.ticker === "string"
        ? [args.ticker]
        : [],
    has_question: typeof args.question === "string" && Boolean(args.question.trim()),
    question_chars: typeof args.question === "string" ? args.question.length : 0,
    has_topic: typeof args.topic === "string" && Boolean(args.topic.trim()),
    topic_chars: typeof args.topic === "string" ? args.topic.length : 0,
    response_detail:
      typeof args.response_detail === "string" ? args.response_detail : null,
    limit:
      typeof args.limit === "number"
        ? args.limit
        : typeof args.limit_results === "number"
          ? args.limit_results
          : null,
  };
}

function countResultItems(response: DesktopOntologyToolCallSuccess): number {
  const candidates = [
    response.result_json.evidence,
    response.result_json.companies,
    response.result_json.comparisons,
    response.result_json.results,
    response.result_json.ticker_candidates,
    response.result_json.comparison_rows,
    response.result_json.citations,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length > 0) return candidate.length;
  }

  const resultsByTicker = resultMapCount(response.result_json.results_by_ticker);
  if (resultsByTicker > 0) return resultsByTicker;

  return maxNestedArrayLength(response.result_json.research_pack);
}

function resultMapCount(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  return Object.values(value as Record<string, unknown>).reduce<number>(
    (total, entry) => total + (Array.isArray(entry) ? entry.length : 0),
    0,
  );
}

function maxNestedArrayLength(value: unknown, depth = 0): number {
  if (depth > 8) return 0;
  if (Array.isArray(value)) {
    return Math.max(
      value.length,
      ...value.map((entry) => maxNestedArrayLength(entry, depth + 1)),
    );
  }
  if (!value || typeof value !== "object") return 0;
  return Math.max(
    0,
    ...Object.values(value as Record<string, unknown>).map((entry) =>
      maxNestedArrayLength(entry, depth + 1),
    ),
  );
}

function resultSizeBytes(response: DesktopOntologyToolCallSuccess): number {
  return Buffer.byteLength(JSON.stringify(response.result_json), "utf8");
}

function errorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && code) return code.slice(0, 120);
  }
  if (error instanceof Error && error.name) return error.name.slice(0, 120);
  return "unknown_error";
}
