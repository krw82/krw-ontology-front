import { writeLocalDebugLog } from "@/lib/observability/local-debug-log";
import { redactSensitiveOutput } from "@/lib/security/sensitive-output";
import type { AccumulatedRun } from "./stream-handler";

interface PersistAgentFailureDiagnosticsParams {
  runId: string;
  errorCode: string;
  publicMessage: string;
  internalErrorMessage: string;
  acc: AccumulatedRun;
  executor: "api" | "worker";
}

export function persistAgentFailureDiagnostics({
  runId,
  errorCode,
  publicMessage,
  internalErrorMessage,
  acc,
  executor,
}: PersistAgentFailureDiagnosticsParams): void {
  const redacted = redactSensitiveOutput(internalErrorMessage);
  const lastToolCall = acc.toolCalls.at(-1);
  const failure = {
    code: errorCode,
    public_error_message: publicMessage,
    raw_error_message: redacted.content.slice(0, 4000),
    raw_error_redacted: redacted.redacted,
    executor,
    tool_call_count: acc.toolCalls.length,
    output_length: acc.fullText.length,
    input_tokens: acc.inputTokens,
    output_tokens: acc.outputTokens,
    last_tool_call: lastToolCall
      ? {
          id: lastToolCall.id,
          name: lastToolCall.toolName,
          status: lastToolCall.errorMessage ? "failed" : "completed",
          started_at: lastToolCall.startedAt,
          finished_at: lastToolCall.finishedAt ?? null,
        }
      : null,
    recorded_at: new Date().toISOString(),
  };

  writeLocalDebugLog({
    namespace: "agent-failure",
    event: "failed",
    payload: {
      run_id: runId,
      failure,
    },
  });
}
