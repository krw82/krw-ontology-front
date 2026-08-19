import { getRustAgentRuntime } from "@/lib/agent-v1/runtime";
import { appendAgentRunEvent } from "@/lib/agent/run-events";
import { markAgentRunTerminal } from "@/lib/agent/run-lifecycle";
import { releaseExecutionBudget } from "@/lib/concurrency/execution-budget";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { CANCELLED_ASSISTANT_MESSAGE } from "@/lib/chat/message-status";

export interface RustAgentCancelTarget {
  readonly id: string;
  readonly session_id: string;
  readonly assistant_message_id: string | null;
  readonly request_id: string | null;
}

export type RustAgentCancelOutcome =
  | { kind: "cancelled" }
  | { kind: "already_terminal" };

/**
 * Cancel a rust_agent run through the kernel queue — the only cancel channel
 * the Rust daemon honors — and finalize the product rows. Returns null when
 * the Rust runtime is unavailable; callers fall back to the legacy cancel
 * stamp, which is the pre-cutover behavior (no regression).
 */
export async function cancelRustAgentRun(params: {
  admin: ReturnType<typeof getSupabaseAdmin>;
  run: RustAgentCancelTarget;
  userId: string;
  sessionId: string;
}): Promise<RustAgentCancelOutcome | null> {
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
    console.warn("[chat-cancel] rust kernel cancel unavailable; using legacy cancel stamp", {
      runId: run.id,
      code: error instanceof Error ? error.message : "unknown",
    });
    return null;
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
