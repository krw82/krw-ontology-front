import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type SecRequestLimiterOptions = {
  scope?: string;
  minIntervalMs: number;
};

/**
 * Atomically reserves the next SEC request slot shared by every deployment.
 * Callers sleep until the returned timestamp; the table retains scheduling
 * state only and never contains SEC response data.
 */
export async function reserveSecRequestSlot({
  scope = "global",
  minIntervalMs,
}: SecRequestLimiterOptions): Promise<void> {
  const { data, error } = await getSupabaseAdmin().rpc("reserve_sec_request_slot", {
    p_scope: scope,
    p_min_interval_ms: minIntervalMs,
  });
  if (error) {
    throw new Error(`Failed to reserve shared SEC request slot: ${error.message}`);
  }

  const allowedAt = typeof data === "string" ? Date.parse(data) : NaN;
  if (!Number.isFinite(allowedAt)) {
    throw new Error("Shared SEC request limiter returned an invalid slot timestamp");
  }

  const waitMs = Math.max(0, allowedAt - Date.now());
  if (waitMs > 0) await sleep(waitMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
