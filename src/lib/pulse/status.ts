import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { PulseFeedStatusResponse } from "@/types/api-contracts";

const ACTIVE_RUN_STATUSES = ["pending", "queued", "running"] as const;
const TERMINAL_FEED_RUN_STATUSES = ["completed", "failed"] as const;

interface PulseStatusOptions {
  supabase: SupabaseClient<Database>;
  userId: string;
  since: Date;
  now?: Date;
}

type StatusSession = {
  id: string;
  updated_at: string;
};

export interface PulseStatusInputs {
  now: Date;
  newFilingCount: number;
  activeAnalysisCount: number;
  activeAnalysisUpdatedAt: string | null;
  activeAnalysisSessionIds: string[];
  completedAnalysisCount: number;
}

/**
 * Deliberately small polling read. This must stay independent from
 * composePulseFeed: it counts indexed filing changes and chat state only.
 */
export async function getPulseFeedStatus({
  supabase,
  userId,
  since,
  now = new Date(),
}: PulseStatusOptions): Promise<PulseFeedStatusResponse> {
  const snapshotAt = now.toISOString();
  const [filingResult, activeSessionsResult, completedSessionsResult] = await Promise.all([
    supabase.rpc("get_catalog_pulse_feed_status_v1", {
      p_env: filingCatalogEnv(),
      p_since: since.toISOString(),
      p_snapshot_at: snapshotAt,
    }),
    supabase
      .from("chat_sessions")
      .select("id,updated_at", { count: "exact" })
      .eq("user_id", userId)
      .eq("scope_type", "company")
      .is("deleted_at", null)
      .in("latest_run_status", ACTIVE_RUN_STATUSES)
      .order("updated_at", { ascending: false })
      .limit(50)
      .returns<StatusSession[]>(),
    supabase
      .from("chat_sessions")
      .select("id", { count: "exact" })
      .eq("user_id", userId)
      .eq("scope_type", "company")
      .is("deleted_at", null)
      .in("latest_run_status", [...TERMINAL_FEED_RUN_STATUSES])
      .gt("updated_at", since.toISOString())
      .limit(99),
  ]);
  if (activeSessionsResult.error) throw activeSessionsResult.error;
  if (completedSessionsResult.error) throw completedSessionsResult.error;

  const filingCount = filingResult.error
    ? 0
    : filingResult.data?.[0]?.new_filing_count ?? 0;
  const activeSessions = activeSessionsResult.data ?? [];
  return summarizePulseFeedStatus({
    now,
    newFilingCount: filingCount,
    activeAnalysisCount: activeSessionsResult.count ?? activeSessions.length,
    activeAnalysisUpdatedAt: activeSessions[0]?.updated_at ?? null,
    activeAnalysisSessionIds: activeSessions.map((session) => session.id),
    completedAnalysisCount: completedSessionsResult.count ?? completedSessionsResult.data?.length ?? 0,
  });
}

/**
 * Keeps status polling semantically stable: active work is a current-state
 * count, while the new-items pill represents only fresh filings or a terminal
 * analysis result. A long-running analysis must not repeatedly create a
 * misleading "new" item badge.
 */
export function summarizePulseFeedStatus({
  now,
  newFilingCount,
  activeAnalysisCount,
  activeAnalysisUpdatedAt,
  activeAnalysisSessionIds,
  completedAnalysisCount,
}: PulseStatusInputs): PulseFeedStatusResponse {
  return {
    generated_at: now.toISOString(),
    new_item_count: Math.min(99, Math.max(0, newFilingCount) + Math.max(0, completedAnalysisCount)),
    active_analysis_count: Math.max(0, activeAnalysisCount),
    active_analysis_updated_at: activeAnalysisUpdatedAt,
    active_analysis_session_ids: [...new Set(activeAnalysisSessionIds)].slice(0, 50),
  };
}

function filingCatalogEnv(): "dev" | "staging" | "prod" {
  const value = process.env.FILING_WORKER_ENV?.trim().toLowerCase() || "prod";
  return value === "dev" || value === "staging" || value === "prod" ? value : "prod";
}
