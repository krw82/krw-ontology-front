import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError, forbiddenError } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/api/validation";
import type {
  AgentRunRow,
  ChatSessionRow,
  MessageRow,
} from "@/types/database";

function notFoundError(message: string) {
  return Response.json(
    { error: { code: "not_found" as const, message } },
    { status: 404 }
  );
}

function internalError(message: string) {
  return Response.json(
    { error: { code: "internal_error" as const, message } },
    { status: 500 },
  );
}

export async function GET(
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

  const { data: session, error: sessionError } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle<ChatSessionRow>();

  if (sessionError) {
    return internalError("채팅을 불러오지 못했습니다.");
  }

  if (!session) {
    return notFoundError("채팅을 찾지 못했습니다.");
  }

  if (session.user_id !== user.id) {
    return forbiddenError("이 채팅에 접근할 권한이 없습니다.");
  }

  const { data: messages, error: messagesError } = await supabase
    .from("messages")
    .select("id, session_id, role, content, status, created_at, updated_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .returns<MessageRow[]>();

  if (messagesError) {
    return internalError("채팅 메시지를 불러오지 못했습니다.");
  }

  const { data: runs, error: runsError } = await supabase
    .from("agent_runs")
    .select(
      "id, status, model, assistant_message_id, queued_at, started_at, finished_at, latency_ms, input_tokens, output_tokens, estimated_cost_usd, ontology_env, worker_env, ontology_release_id, index_generated_at, company_count, document_count, object_count, ontology_root, index_path, manifest_path, manifest_valid, agent_index_schema_version, error_code, error_message"
    )
    .eq("session_id", sessionId)
    .order("queued_at", { ascending: true, nullsFirst: true })
    .returns<Partial<AgentRunRow>[]>();

  if (runsError) {
    return internalError("채팅 실행 기록을 불러오지 못했습니다.");
  }

  return Response.json({
    session,
    messages: messages ?? [],
    runs: (runs ?? []).map((run) => ({
      ...run,
      started_at: run.started_at ?? run.queued_at ?? null,
    })),
    rich_answers: [],
    research_artifacts: [],
  });
}
