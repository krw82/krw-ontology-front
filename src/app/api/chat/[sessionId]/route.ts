import { NextRequest } from "next/server";
import { getAuthUser, handleAuthError, forbiddenError } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/api/validation";
import type {
  AgentRunRow,
  ChatSessionRow,
  CitationRow,
  MessageRow,
  ToolCallRow,
} from "@/types/database";

function notFoundError(message: string) {
  return Response.json(
    { error: { code: "not_found" as const, message } },
    { status: 404 }
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

  const { data: session, error } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("id", sessionId)
    .is("deleted_at", null)
    .single<ChatSessionRow>();

  if (error || !session) {
    return notFoundError("채팅을 찾지 못했습니다.");
  }

  if (session.user_id !== user.id) {
    return forbiddenError("이 채팅에 접근할 권한이 없습니다.");
  }

  const { data: messages } = await supabase
    .from("messages")
    .select("id, session_id, role, content, status, created_at, updated_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .returns<MessageRow[]>();

  const { data: runs } = await supabase
    .from("agent_runs")
    .select(
      "id, status, model, assistant_message_id, started_at, finished_at, latency_ms, input_tokens, output_tokens, estimated_cost_usd, ontology_release_id, index_generated_at, error_code, error_message"
    )
    .eq("session_id", sessionId)
    .order("started_at", { ascending: true })
    .returns<Partial<AgentRunRow>[]>();

  const runIds = (runs ?? [])
    .map((run) => run.id)
    .filter((id): id is string => Boolean(id));
  const [{ data: toolCalls }, { data: citations }] =
    await Promise.all([
      runIds.length > 0
        ? supabase
            .from("tool_calls")
            .select(
              "id, run_id, tool_use_id, tool_name, arguments_json, result_summary, result_json, result_text, started_at, finished_at, error_message",
            )
            .in("run_id", runIds)
            .order("started_at", { ascending: true })
            .returns<ToolCallRow[]>()
        : Promise.resolve({ data: [] as ToolCallRow[] }),
      runIds.length > 0
        ? supabase
            .from("citations")
            .select(
              "id, message_id, run_id, object_id, ticker, document_type, period, section, quote_text, claim_text, evidence_grade, source_quality, trace_json",
            )
            .in("run_id", runIds)
            .order("id", { ascending: true })
            .returns<CitationRow[]>()
        : Promise.resolve({ data: [] as CitationRow[] }),
    ]);

  return Response.json({
    session,
    messages: messages ?? [],
    runs: runs ?? [],
    tool_calls: toolCalls ?? [],
    citations: citations ?? [],
    rich_answers: [],
    research_artifacts: [],
  });
}
