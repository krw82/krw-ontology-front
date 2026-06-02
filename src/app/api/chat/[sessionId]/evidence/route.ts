import type { NextRequest } from "next/server";
import { forbiddenError, getAuthUser, handleAuthError } from "@/lib/auth";
import { isUuid } from "@/lib/api/validation";
import { createClient } from "@/lib/supabase/server";
import type {
  AgentRunRow,
  ChatSessionRow,
  CitationRow,
  MessageRow,
  ToolCallRow,
} from "@/types/database";

type ToolCallSummaryRow = Pick<
  ToolCallRow,
  | "id"
  | "run_id"
  | "tool_use_id"
  | "tool_name"
  | "arguments_json"
  | "result_summary"
  | "started_at"
  | "finished_at"
  | "error_message"
>;

type CitationSummaryRow = Pick<
  CitationRow,
  | "id"
  | "message_id"
  | "run_id"
  | "object_id"
  | "ticker"
  | "document_type"
  | "period"
  | "section"
  | "quote_text"
  | "claim_text"
  | "evidence_grade"
  | "source_quality"
>;

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

function internalError(message: string) {
  return Response.json(
    { error: { code: "internal_error" as const, message } },
    { status: 500 },
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;

  if (!isUuid(sessionId)) {
    return notFoundError("채팅을 찾지 못했습니다.");
  }

  const messageId = request.nextUrl.searchParams.get("message_id");
  if (!messageId || !isUuid(messageId)) {
    return validationError("message_id가 올바르지 않습니다.");
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
    .select("id, user_id")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .maybeSingle<Pick<ChatSessionRow, "id" | "user_id">>();

  if (sessionError) {
    return internalError("채팅을 불러오지 못했습니다.");
  }

  if (!session) {
    return notFoundError("채팅을 찾지 못했습니다.");
  }

  if (session.user_id !== user.id) {
    return forbiddenError("이 채팅에 접근할 권한이 없습니다.");
  }

  const { data: message, error: messageError } = await supabase
    .from("messages")
    .select("id, session_id, role")
    .eq("id", messageId)
    .eq("session_id", sessionId)
    .maybeSingle<Pick<MessageRow, "id" | "session_id" | "role">>();

  if (messageError) {
    return internalError("채팅 메시지를 불러오지 못했습니다.");
  }

  if (!message || message.role !== "assistant") {
    return notFoundError("근거를 찾지 못했습니다.");
  }

  const { data: runs, error: runsError } = await supabase
    .from("agent_runs")
    .select("id, assistant_message_id, queued_at")
    .eq("session_id", sessionId)
    .eq("assistant_message_id", messageId)
    .order("queued_at", { ascending: true, nullsFirst: true })
    .returns<Pick<AgentRunRow, "id" | "assistant_message_id" | "queued_at">[]>();

  if (runsError) {
    return internalError("채팅 실행 기록을 불러오지 못했습니다.");
  }

  const runIds = (runs ?? []).map((run) => run.id);

  const [
    { data: toolCalls, error: toolCallsError },
    { data: citations, error: citationsError },
  ] = await Promise.all([
    runIds.length > 0
      ? supabase
          .from("tool_calls")
          .select(
            "id, run_id, tool_use_id, tool_name, arguments_json, result_summary, started_at, finished_at, error_message",
          )
          .in("run_id", runIds)
          .order("started_at", { ascending: true })
          .returns<ToolCallSummaryRow[]>()
      : Promise.resolve({ data: [] as ToolCallSummaryRow[], error: null }),
    runIds.length > 0
      ? supabase
          .from("citations")
          .select(
            "id, message_id, run_id, object_id, ticker, document_type, period, section, quote_text, claim_text, evidence_grade, source_quality",
          )
          .in("run_id", runIds)
          .order("id", { ascending: true })
          .returns<CitationSummaryRow[]>()
      : Promise.resolve({ data: [] as CitationSummaryRow[], error: null }),
  ]);

  if (toolCallsError) {
    return internalError("도구 실행 기록을 불러오지 못했습니다.");
  }

  if (citationsError) {
    return internalError("인용 기록을 불러오지 못했습니다.");
  }

  return Response.json({
    message_id: messageId,
    run_ids: runIds,
    tool_calls: (toolCalls ?? []).map((toolCall) => ({
      ...toolCall,
      result_json: null,
      result_text: null,
    })),
    citations: (citations ?? []).map((citation) => ({
      ...citation,
      trace_json: null,
    })),
  });
}
