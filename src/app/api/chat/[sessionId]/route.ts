import type { NextRequest } from "next/server";
import { getAuthUser, handleAuthError, forbiddenError } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/api/validation";
import { publicAgentErrorMessage } from "@/lib/api/chat/error-messages";
import { sanitizeAssistantContent } from "@/lib/chat/assistant-content";
import type {
  AgentRunRow,
  ChatMessageArtifactRow,
  ChatMessageArtifactSelectionRow,
  ChatSessionRow,
  MessageRow,
} from "@/types/database";
import { toPublicChatArtifact } from "@/lib/chat-artifacts/news-event-selection";

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
      "id, status, model, assistant_message_id, queued_at, started_at, finished_at, latency_ms, input_tokens, output_tokens, estimated_cost_usd, ontology_env, worker_env, ontology_release_id, index_generated_at, company_count, document_count, object_count, manifest_valid, agent_index_schema_version, error_code, run_kind, source_artifact_id, source_event_id"
    )
    .eq("session_id", sessionId)
    .order("queued_at", { ascending: true, nullsFirst: true })
    .returns<Partial<AgentRunRow>[]>();

  if (runsError) {
    return internalError("채팅 실행 기록을 불러오지 못했습니다.");
  }

  const { data: chatArtifacts, error: chatArtifactsError } = await supabase
    .from("chat_message_artifacts")
    .select("id, session_id, message_id, run_id, type, payload_json, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .returns<ChatMessageArtifactRow[]>();

  if (chatArtifactsError) {
    return internalError("채팅 artifact를 불러오지 못했습니다.");
  }

  const artifactIds = (chatArtifacts ?? []).map((artifact) => artifact.id);
  const { data: artifactSelections, error: artifactSelectionsError } =
    artifactIds.length > 0
      ? await supabase
          .from("chat_message_artifact_selections")
          .select(
            "id, artifact_id, event_id, selected_payload_json, user_message_id, research_run_id, created_at",
          )
          .in("artifact_id", artifactIds)
          .order("created_at", { ascending: true })
          .returns<ChatMessageArtifactSelectionRow[]>()
      : { data: [], error: null };

  if (artifactSelectionsError) {
    return internalError("채팅 artifact 선택 기록을 불러오지 못했습니다.");
  }

  return Response.json({
    session,
    messages: (messages ?? []).map(toPublicMessage),
    runs: (runs ?? []).map(toPublicRunSummary),
    chat_artifacts: (chatArtifacts ?? []).map(toPublicChatArtifact),
    artifact_selections: artifactSelections ?? [],
    rich_answers: [],
    research_artifacts: [],
  });
}

function toPublicMessage(message: MessageRow): MessageRow {
  if (message.role !== "assistant") return message;
  return {
    ...message,
    content: sanitizeAssistantContent(message.content),
  };
}

function toPublicRunSummary(run: Partial<AgentRunRow>) {
  const errorCode = run.error_code ?? null;

  return {
    id: run.id,
    status: run.status,
    model: run.model,
    assistant_message_id: run.assistant_message_id ?? null,
    queued_at: run.queued_at ?? null,
    started_at: run.started_at ?? run.queued_at ?? "",
    finished_at: run.finished_at ?? null,
    latency_ms: run.latency_ms ?? null,
    input_tokens: run.input_tokens ?? null,
    output_tokens: run.output_tokens ?? null,
    estimated_cost_usd: run.estimated_cost_usd ?? null,
    ontology_env: run.ontology_env ?? null,
    worker_env: run.worker_env ?? null,
    ontology_release_id: run.ontology_release_id ?? null,
    index_generated_at: run.index_generated_at ?? null,
    company_count: run.company_count ?? null,
    document_count: run.document_count ?? null,
    object_count: run.object_count ?? null,
    manifest_valid: run.manifest_valid ?? null,
    agent_index_schema_version: run.agent_index_schema_version ?? null,
    error_code: errorCode,
    error_message: errorCode
      ? publicAgentErrorMessage({ code: errorCode })
      : null,
    run_kind: run.run_kind ?? undefined,
    source_artifact_id: run.source_artifact_id ?? null,
    source_event_id: run.source_event_id ?? null,
  };
}
