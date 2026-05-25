import { NextRequest } from "next/server";
import { getAuthUser, handleAuthError, forbiddenError } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { abortRun } from "@/lib/agent/abort-manager";
import { requestAgentRunCancel } from "@/lib/agent/job-queue";
import { appendAgentRunEvent } from "@/lib/agent/run-events";
import { releaseExecutionBudget } from "@/lib/concurrency/execution-budget";
import { isUuid } from "@/lib/api/validation";
import type { ChatSessionRow, AgentRunRow } from "@/types/database";

function notFoundError(message: string) {
  return Response.json(
    { error: { code: "not_found" as const, message } },
    { status: 404 }
  );
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;

  if (!isUuid(sessionId)) {
    return notFoundError("채팅을 찾지 못했습니다.");
  }

  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const supabase = await createClient();

  const { data: session } = await supabase
    .from("chat_sessions")
    .select("user_id")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .single<ChatSessionRow>();

  if (!session) {
    return notFoundError("채팅을 찾지 못했습니다.");
  }

  if (session.user_id !== user.id) {
    return forbiddenError("이 채팅에 접근할 권한이 없습니다.");
  }

  // Find active run
  const { data: activeRuns } = await getSupabaseAdmin()
    .from("agent_runs")
    .select("id, status")
    .eq("session_id", sessionId)
    .in("status", ["pending", "queued", "running"])
    .returns<AgentRunRow[]>();

  if (!activeRuns || activeRuns.length === 0) {
    return Response.json(
      { error: { code: "no_active_run", message: "중지할 실행 중 응답이 없습니다." } },
      { status: 404 }
    );
  }

  const run = activeRuns[0];

  const admin = getSupabaseAdmin();
  const cancelResult = await requestAgentRunCancel(run.id);
  abortRun(run.id);

  if (cancelResult.status === "queued" || cancelResult.status === "pending") {
    await admin
      .from("agent_runs")
      .update({
        status: "cancelled",
        finished_at: new Date().toISOString(),
        error_code: "cancelled",
      })
      .eq("id", run.id)
      .in("status", ["pending", "queued"]);

    if (cancelResult.assistantMessageId) {
      await admin
        .from("messages")
        .update({ status: "failed", content: "" })
        .eq("id", cancelResult.assistantMessageId);
    }

    if (cancelResult.requestId) {
      await releaseExecutionBudget(
        user.id,
        cancelResult.requestId,
        run.id,
        "cancelled",
      );
    }

    await appendAgentRunEvent(admin, run.id, "cancelled", {
      run_id: run.id,
      message_id: cancelResult.assistantMessageId,
    });
  }

  await new Promise((resolve) => setTimeout(resolve, 100));

  return Response.json({ success: true, run_id: run.id });
}
