import type { NextRequest } from "next/server";
import { forbiddenError, getAuthUser, handleAuthError } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { streamAgentRunEventsResponse } from "@/lib/agent/run-events";
import { isUuid, parseNonNegativeIntParam } from "@/lib/api/validation";
import type { ChatSessionRow } from "@/types/database";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const url = new URL(request.url);
  const sessionId = url.searchParams.get("session_id");
  const runId = url.searchParams.get("run_id");
  const lastEventId = parseNonNegativeIntParam(
    url.searchParams.get("last_event_id"),
    0,
    { max: Number.MAX_SAFE_INTEGER },
  );

  if (!sessionId) {
    return Response.json(
      {
        error: {
          code: "validation_error" as const,
          message: "채팅 ID가 필요합니다.",
        },
      },
      { status: 400 },
    );
  }

  if (!isUuid(sessionId) || (runId && !isUuid(runId))) {
    return Response.json(
      {
        error: {
          code: "validation_error" as const,
          message: "채팅 ID 또는 실행 ID 형식이 올바르지 않습니다.",
        },
      },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data: session, error: sessionError } = await supabase
    .from("chat_sessions")
    .select("id, user_id")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .single<ChatSessionRow>();

  if (sessionError || !session) {
    return Response.json(
      { error: { code: "not_found" as const, message: "채팅을 찾지 못했습니다." } },
      { status: 404 },
    );
  }

  if (session.user_id !== user.id) {
    return forbiddenError("이 채팅에 접근할 권한이 없습니다.");
  }

  return streamAgentRunEventsResponse({
    userId: user.id,
    sessionId,
    runId,
    lastEventId,
  });
}
