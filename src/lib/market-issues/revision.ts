import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { marketIssueEnvironment } from "@/lib/market-issues/config";

export interface MarketIssueRevision {
  value: string;
  globalRevision: number;
  timeBucket: number;
}

const TIME_BUCKET_MS = 5 * 60 * 1000;

export async function getMarketIssueRevision(
  supabase: SupabaseClient<any>,
  now = new Date(),
): Promise<MarketIssueRevision> {
  const env = marketIssueEnvironment();
  const { data, error } = await supabase
    .from("market_issue_feed_revisions")
    .select("revision")
    .eq("env", env)
    .maybeSingle();
  if (error) throw error;

  const globalRevision = Number(data?.revision || 0);
  const timeBucket = Math.floor(now.getTime() / TIME_BUCKET_MS);
  return {
    globalRevision: Number.isFinite(globalRevision) ? Math.max(0, Math.trunc(globalRevision)) : 0,
    timeBucket,
    value: ["mi1", globalRevision, timeBucket].join("."),
  };
}
