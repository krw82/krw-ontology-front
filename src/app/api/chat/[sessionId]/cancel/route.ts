import { NextRequest } from "next/server";
import { getAuthUser, handleAuthError, forbiddenError } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { abortRun } from "@/lib/agent/abort-manager";
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
    .in("status", ["pending", "running"])
    .returns<AgentRunRow[]>();

  if (!activeRuns || activeRuns.length === 0) {
    return Response.json(
      { error: { code: "no_active_run", message: "중지할 실행 중 응답이 없습니다." } },
      { status: 404 }
    );
  }

  const run = activeRuns[0];

  // F-HI-01: Only abort the run. Stream handler owns all cleanup
  // (DB status update, lease release, unregisterRun).
  abortRun(run.id);

  // Give the stream handler a brief window to react to the abort signal
  // before responding. This prevents a new run from starting before the
  // old stream has begun its cleanup sequence.
  await new Promise((resolve) => setTimeout(resolve, 100));

  return Response.json({ success: true, run_id: run.id });
}
