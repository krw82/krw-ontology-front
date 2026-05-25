import { NextRequest } from "next/server";
import { abortRun } from "@/lib/agent/abort-manager";
import { requestAgentRunCancel } from "@/lib/agent/job-queue";
import { appendAgentRunEvent } from "@/lib/agent/run-events";
import { releaseExecutionBudget } from "@/lib/concurrency/execution-budget";
import { getAuthUser, handleAuthError, forbiddenError } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isPlainObject, isUuid } from "@/lib/api/validation";
import type { AgentRunRow, ChatSessionRow } from "@/types/database";

type CancelRunRow = Pick<
  AgentRunRow,
  "id" | "session_id" | "status" | "request_id"
> &
  Record<string, unknown>;
type CancelSessionRow = Pick<ChatSessionRow, "id" | "user_id"> &
  Record<string, unknown>;
type CancelRequestBody = {
  run_id?: unknown;
  request_id?: unknown;
};

function notFoundError(message: string) {
  return Response.json(
    { error: { code: "not_found" as const, message } },
    { status: 404 },
  );
}

function validationError(message: string) {
  return Response.json(
    { error: { code: "validation_error" as const, message } },
    { status: 400 },
  );
}

async function findRun(
  admin: ReturnType<typeof getSupabaseAdmin>,
  runId: string,
  requestId: string,
): Promise<CancelRunRow | null> {
  if (runId) {
    const { data: run } = await admin
      .from("agent_runs")
      .select("id, session_id, status, request_id")
      .eq("id", runId)
      .single<CancelRunRow>();
    return run ?? null;
  }

  if (!requestId) return null;

  const { data: runs } = await admin
    .from("agent_runs")
    .select("id, session_id, status, request_id")
    .eq("request_id", requestId)
    .order("started_at", { ascending: false })
    .limit(1)
    .returns<CancelRunRow[]>();

  return runs?.[0] ?? null;
}

async function waitForRun(
  admin: ReturnType<typeof getSupabaseAdmin>,
  runId: string,
  requestId: string,
): Promise<CancelRunRow | null> {
  const attempts = requestId && !runId ? 6 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const run = await findRun(admin, runId, requestId);
    if (run) return run;
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  return null;
}

export async function POST(request: NextRequest) {
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const parsedBody = await request.json().catch(() => null);
  if (!isPlainObject(parsedBody)) {
    return validationError("요청 본문 형식이 올바르지 않습니다.");
  }

  const body = parsedBody as CancelRequestBody;
  const runId = typeof body?.run_id === "string" ? body.run_id.trim() : "";
  const requestId =
    typeof body?.request_id === "string" ? body.request_id.trim() : "";
  if (!runId && !requestId) {
    return validationError("run_id 또는 request_id가 필요합니다.");
  }
  if (runId && !isUuid(runId)) {
    return validationError("run_id 형식이 올바르지 않습니다.");
  }

  const admin = getSupabaseAdmin();
  const run = await waitForRun(admin, runId, requestId);

  if (!run) return notFoundError("실행 정보를 찾지 못했습니다.");

  const { data: session } = await admin
    .from("chat_sessions")
    .select("id, user_id")
    .eq("id", run.session_id)
    .is("deleted_at", null)
    .single<CancelSessionRow>();

  if (!session) return notFoundError("채팅을 찾지 못했습니다.");
  if (session.user_id !== user.id) {
    return forbiddenError("이 채팅에 접근할 권한이 없습니다.");
  }

  if (
    run.status !== "pending" &&
    run.status !== "queued" &&
    run.status !== "running"
  ) {
    return Response.json({
      success: true,
      run_id: run.id,
      status: run.status,
      aborted: false,
    });
  }

  const cancelResult = await requestAgentRunCancel(run.id);
  const aborted = abortRun(run.id);

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

  return Response.json({
    success: true,
    run_id: run.id,
    request_id: run.request_id,
    aborted,
  });
}
