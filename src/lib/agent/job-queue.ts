import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AgentRunRow } from "@/types/database";
import type { RunStatus } from "@/types/api-contracts";

export async function requestAgentRunCancel(
  runId: string,
): Promise<{
  status: RunStatus | null;
  assistantMessageId: string | null;
  requestId: string | null;
}> {
  const admin = getSupabaseAdmin();
  const now = new Date().toISOString();
  const { data } = await admin
    .from("agent_runs")
    .update({ cancel_requested_at: now })
    .eq("id", runId)
    .in("status", ["queued", "running", "pending"])
    .select("status, assistant_message_id, request_id")
    .maybeSingle<{
      status: RunStatus;
      assistant_message_id: string | null;
      request_id: string | null;
    }>();

  return {
    status: data?.status ?? null,
    assistantMessageId: data?.assistant_message_id ?? null,
    requestId: data?.request_id ?? null,
  };
}

export async function findRunByRequestId(
  requestId: string,
  sessionId?: string,
): Promise<Pick<AgentRunRow, "id" | "session_id"> | null> {
  let query = getSupabaseAdmin()
    .from("agent_runs")
    .select("id, session_id")
    .eq("request_id", requestId)
    .limit(1);

  if (sessionId) {
    query = query.eq("session_id", sessionId);
  }

  const { data } = await query.maybeSingle<Pick<AgentRunRow, "id" | "session_id">>();

  return data ?? null;
}
