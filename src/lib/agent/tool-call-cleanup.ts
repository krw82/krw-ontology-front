import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ToolCallRow } from "@/types/database";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

interface CloseOpenToolCallsParams {
  admin: SupabaseAdmin;
  runId: string;
  finishedAt?: string;
  errorMessage: string;
}

interface CloseOpenToolCallsForRunsParams {
  admin: SupabaseAdmin;
  runIds: string[];
  finishedAt?: string;
  errorMessage: string;
}

export async function closeOpenToolCallsForRun({
  admin,
  runId,
  finishedAt,
  errorMessage,
}: CloseOpenToolCallsParams): Promise<number> {
  return closeOpenToolCallsForRuns({
    admin,
    runIds: [runId],
    finishedAt,
    errorMessage,
  });
}

export async function closeOpenToolCallsForRuns({
  admin,
  runIds,
  finishedAt = new Date().toISOString(),
  errorMessage,
}: CloseOpenToolCallsForRunsParams): Promise<number> {
  const uniqueRunIds = Array.from(new Set(runIds.filter(Boolean)));
  if (uniqueRunIds.length === 0) return 0;

  const { data, error } = await admin
    .from("tool_calls")
    .select("id, error_message")
    .in("run_id", uniqueRunIds)
    .is("finished_at", null)
    .returns<Array<Pick<ToolCallRow, "id" | "error_message">>>();

  if (error) {
    console.warn("[tool-call-cleanup] failed to load open tool calls", {
      runIds: uniqueRunIds,
      error: error.message,
    });
    return 0;
  }

  const openToolCalls = data ?? [];
  let closedCount = 0;

  for (const toolCall of openToolCalls) {
    const terminalMessage =
      typeof toolCall.error_message === "string" &&
      toolCall.error_message.trim().length > 0
        ? toolCall.error_message
        : errorMessage;

    const { error: updateError } = await admin
      .from("tool_calls")
      .update({
        finished_at: finishedAt,
        error_message: terminalMessage,
      })
      .eq("id", toolCall.id);

    if (updateError) {
      console.warn("[tool-call-cleanup] failed to close open tool call", {
        toolCallId: toolCall.id,
        error: updateError.message,
      });
      continue;
    }

    closedCount += 1;
  }

  return closedCount;
}
