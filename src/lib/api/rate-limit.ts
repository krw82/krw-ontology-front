import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

export interface DurableRateLimitCheck {
  key: string;
  bucket: string;
  limit: number;
  windowSeconds?: number;
}

export type DurableRateLimitResult =
  | { ok: true }
  | {
      ok: false;
      status: 429 | 503;
      code: "rate_limited" | "service_unavailable";
      retryAfterSeconds?: number;
    };

const DEFAULT_WINDOW_SECONDS = 60;

export function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

export async function checkDurableRateLimits(
  checks: DurableRateLimitCheck[],
  now = new Date(),
): Promise<DurableRateLimitResult> {
  const admin = getSupabaseAdmin();

  try {
    for (const check of checks) {
      const windowSeconds = check.windowSeconds ?? DEFAULT_WINDOW_SECONDS;
      const { data, error } = await admin.rpc("increment_rate_limit", {
        p_key: check.key,
        p_bucket: check.bucket,
        p_window_start: getWindowStart(now, windowSeconds),
        p_window_seconds: windowSeconds,
        p_limit: check.limit,
      });

      if (error) {
        return {
          ok: false,
          status: 503,
          code: "service_unavailable",
        };
      }

      const result = data?.[0];
      if (!result?.allowed) {
        return {
          ok: false,
          status: 429,
          code: "rate_limited",
          retryAfterSeconds: Math.max(
            1,
            Number(result?.retry_after_seconds ?? windowSeconds),
          ),
        };
      }
    }
  } catch {
    return {
      ok: false,
      status: 503,
      code: "service_unavailable",
    };
  }

  return { ok: true };
}

function getWindowStart(now: Date, windowSeconds: number): string {
  const epochSeconds = Math.floor(now.getTime() / 1000);
  const windowStartSeconds =
    Math.floor(epochSeconds / windowSeconds) * windowSeconds;
  return new Date(windowStartSeconds * 1000).toISOString();
}
