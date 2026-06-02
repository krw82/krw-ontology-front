import type { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AgentRunRow } from "@/types/database";

export type TerminalAgentRunStatus =
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export interface TerminalAgentRunUpdate {
  status: TerminalAgentRunStatus;
  finishedAt: string;
  assistantMessageId?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCostUsd?: number;
  latencyMs?: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  openToolErrorMessage?: string | null;
}

type TerminalAgentRunPayload = Partial<
  Pick<
    AgentRunRow,
    | "status"
    | "assistant_message_id"
    | "finished_at"
    | "input_tokens"
    | "output_tokens"
    | "estimated_cost_usd"
    | "latency_ms"
    | "error_code"
    | "error_message"
    | "lease_expires_at"
  >
>;

export function buildTerminalAgentRunUpdate(
  update: TerminalAgentRunUpdate,
): TerminalAgentRunPayload {
  const payload: TerminalAgentRunPayload = {
    status: update.status,
    finished_at: update.finishedAt,
    lease_expires_at: null,
  };

  if (update.assistantMessageId !== undefined) {
    payload.assistant_message_id = update.assistantMessageId;
  }
  if (update.inputTokens !== undefined) {
    payload.input_tokens = update.inputTokens;
  }
  if (update.outputTokens !== undefined) {
    payload.output_tokens = update.outputTokens;
  }
  if (update.estimatedCostUsd !== undefined) {
    payload.estimated_cost_usd = update.estimatedCostUsd;
  }
  if (update.latencyMs !== undefined) {
    payload.latency_ms = update.latencyMs;
  }
  if (update.errorCode !== undefined) {
    payload.error_code = update.errorCode;
  }
  if (update.errorMessage !== undefined) {
    payload.error_message = update.errorMessage;
  }

  return payload;
}

export async function markAgentRunTerminal(
  admin: ReturnType<typeof getSupabaseAdmin>,
  runId: string,
  update: TerminalAgentRunUpdate,
) {
  if (typeof admin.rpc === "function") {
    const { error } = await admin.rpc("mark_agent_run_terminal", {
      p_run_id: runId,
      p_status: update.status,
      p_finished_at: update.finishedAt,
      p_error_code: update.errorCode ?? null,
      p_error_message: update.errorMessage ?? null,
      p_input_tokens: update.inputTokens ?? null,
      p_output_tokens: update.outputTokens ?? null,
      p_estimated_cost_usd: update.estimatedCostUsd ?? null,
      p_latency_ms: update.latencyMs ?? null,
      p_assistant_message_id: update.assistantMessageId ?? null,
      p_open_tool_error_message: update.openToolErrorMessage ?? null,
    });

    if (!error) {
      return { data: null, error: null };
    }

    console.warn("[agent-run-lifecycle] terminal RPC failed; falling back", {
      runId,
      status: update.status,
      code: error.code,
      message: error.message,
    });
  }

  return admin
    .from("agent_runs")
    .update(buildTerminalAgentRunUpdate(update))
    .eq("id", runId);
}
