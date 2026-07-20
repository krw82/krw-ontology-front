import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const REVISION_PREFIX = "p3";
const TIME_BUCKET_MS = 5 * 60 * 1_000;

export interface PulseFeedRevision {
  value: string;
  globalRevision: number;
  userRevision: number;
  timeBucket: number;
}

/**
 * A private Pulse revision consists only of opaque counters. It deliberately
 * has no user id, entitlement, content, or other private data in the value.
 */
export function createPulseFeedRevision(input: {
  globalRevision: number;
  userRevision: number;
  timeBucket: number;
}): PulseFeedRevision {
  const globalRevision = toRevisionPart(input.globalRevision);
  const userRevision = toRevisionPart(input.userRevision);
  const timeBucket = toRevisionPart(input.timeBucket);
  return {
    globalRevision,
    userRevision,
    timeBucket,
    value: [REVISION_PREFIX, globalRevision, userRevision, timeBucket].join("."),
  };
}

export async function getPulseFeedRevision(
  supabase: SupabaseClient<Database>,
  userId: string,
  now = new Date(),
): Promise<PulseFeedRevision> {
  const { data, error } = await supabase.rpc("get_pulse_feed_revisions_v1", {
    p_env: filingCatalogEnv(),
    p_user_id: userId,
    p_now: now.toISOString(),
  });
  if (error) throw error;
  const row = data?.[0];
  if (!row) {
    throw new Error("Pulse feed revision was unavailable");
  }
  return createPulseFeedRevision({
    globalRevision: row.global_revision,
    userRevision: row.user_revision,
    // Keep the server and the SQL function in lockstep even if an older
    // development database returns a stale time bucket during local testing.
    timeBucket: Number.isFinite(row.time_bucket)
      ? Math.max(0, Math.trunc(row.time_bucket))
      : Math.floor(now.getTime() / TIME_BUCKET_MS),
  });
}

export function pulseFeedETag(revision: string): string {
  return `"${revision}"`;
}

export function matchesPulseFeedETag(
  ifNoneMatch: string | null,
  revision: string,
): boolean {
  if (!ifNoneMatch) return false;
  const expected = pulseFeedETag(revision);
  return ifNoneMatch
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === expected || value === `W/${expected}`);
}

export function filingCatalogEnv(): "dev" | "staging" | "prod" {
  const value = process.env.FILING_WORKER_ENV?.trim().toLowerCase() || "prod";
  return value === "dev" || value === "staging" || value === "prod" ? value : "prod";
}

function toRevisionPart(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}
