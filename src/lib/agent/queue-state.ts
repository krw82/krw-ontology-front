import { getOntologyEnv, readIntEnv } from "@/lib/env";
import type { QueueStatus, RunStatus } from "@/types/api-contracts";
import type { AgentRunRow } from "@/types/database";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

const GLOBAL_CONCURRENT_LIMIT = readIntEnv("GLOBAL_CONCURRENT_RUN_LIMIT", 5, {
  min: 1,
});

export interface AgentRunQueueState extends QueueStatus {
  status: RunStatus;
}

export function toQueueStatus(
  state: AgentRunQueueState | null,
): QueueStatus | null {
  if (!state) return null;
  return {
    queued_ahead: state.queued_ahead,
    running_count: state.running_count,
    concurrency_limit: state.concurrency_limit,
    queued_at: state.queued_at,
  };
}

export function fallbackQueueState(
  run: Pick<AgentRunRow, "status" | "queued_at">,
): AgentRunQueueState {
  return {
    status: run.status,
    queued_ahead: 0,
    running_count: run.status === "running" ? GLOBAL_CONCURRENT_LIMIT : 0,
    concurrency_limit: GLOBAL_CONCURRENT_LIMIT,
    queued_at: run.queued_at ?? null,
  };
}

export async function loadAgentRunQueueState(
  admin: SupabaseAdmin,
  runId: string,
): Promise<AgentRunQueueState | null> {
  const { data, error } = await admin.rpc("get_agent_run_queue_state", {
    p_run_id: runId,
    p_global_limit: GLOBAL_CONCURRENT_LIMIT,
  });

  if (error) {
    console.warn("[agent-queue] queue state lookup failed", {
      runId,
      ontologyEnv: getOntologyEnv(),
      code: error.code,
      message: error.message,
    });
    return null;
  }

  const row = Array.isArray(data) ? data[0] : null;
  if (!row || typeof row.status !== "string") return null;

  return {
    status: row.status as RunStatus,
    queued_ahead: numberOrZero(row.queued_ahead),
    running_count: numberOrZero(row.running_count),
    concurrency_limit: Math.max(1, numberOrZero(row.concurrency_limit)),
    queued_at: typeof row.queued_at === "string" ? row.queued_at : null,
  };
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}
