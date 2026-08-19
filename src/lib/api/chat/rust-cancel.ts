import { getRustAgentRuntime } from "@/lib/agent-v1/runtime";
import { appendAgentRunEvent } from "@/lib/agent/run-events";
import { markAgentRunTerminal } from "@/lib/agent/run-lifecycle";
import { releaseExecutionBudget } from "@/lib/concurrency/execution-budget";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";
import { CANCELLED_ASSISTANT_MESSAGE } from "@/lib/chat/message-status";

export interface RustAgentCancelTarget {
  readonly id: string;
  readonly session_id: string;
  readonly assistant_message_id: string | null;
  readonly request_id: string | null;
}

export type RustAgentCancelOutcome =
  | { kind: "cancelled" }
  | { kind: "already_terminal" }
  | { kind: "kernel_unavailable" };

/**
 * Cancel a rust_agent run through the kernel queue — the only cancel channel
 * the Rust daemon honors — and finalize the product rows. Returns
 * `{ kind: "kernel_unavailable" }` when the Rust runtime cannot be reached;
 * callers must surface that as a cancel-channel failure (503) instead of
 * falling back to the legacy cancel stamp, which the daemon never reads.
 */
export async function cancelRustAgentRun(params: {
  admin: ReturnType<typeof getSupabaseAdmin>;
  run: RustAgentCancelTarget;
  userId: string;
  sessionId: string;
}): Promise<RustAgentCancelOutcome> {
  const { admin, run } = params;
  try {
    const runtime = await getRustAgentRuntime();
    const result = await runtime.cancel({
      runId: run.id,
      userId: params.userId,
      sessionId: params.sessionId,
      reasonCode: "user_cancelled",
    });
    if (result.outcome !== "cancelled") {
      return { kind: "already_terminal" };
    }
  } catch (error) {
    console.warn("[chat-cancel] rust kernel cancel unavailable; cancel channel failed", {
      runId: run.id,
      code: error instanceof Error ? error.message : "unknown",
    });
    return { kind: "kernel_unavailable" };
  }

  await markAgentRunTerminal(admin, run.id, {
    status: "cancelled",
    finishedAt: new Date().toISOString(),
    assistantMessageId: run.assistant_message_id ?? undefined,
    errorCode: "cancelled",
    openToolErrorMessage: "Run was cancelled before tool result was received",
  });
  if (run.assistant_message_id) {
    await admin
      .from("messages")
      .update({
        status: "cancelled",
        content: CANCELLED_ASSISTANT_MESSAGE,
      })
      .eq("id", run.assistant_message_id);
  }
  if (run.request_id) {
    await releaseExecutionBudget(params.userId, run.request_id, run.id, "cancelled");
  }
  await appendAgentRunEvent(admin, run.id, "cancelled", {
    run_id: run.id,
    message_id: run.assistant_message_id,
  });
  return { kind: "cancelled" };
}
