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

const DEFAULT_CHAT_DETAIL_MESSAGE_LIMIT = 200;
const MAX_CHAT_DETAIL_MESSAGE_LIMIT = 500;

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

function parsePositiveIntParam(
  value: string | null,
  defaultValue: number,
  maxValue: number,
) {
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return defaultValue;
  return Math.min(parsed, maxValue);
}

function parseBeforeParam(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const { sessionId } = await params;
  const messageLimit = parsePositiveIntParam(
    request.nextUrl.searchParams.get("limit"),
    DEFAULT_CHAT_DETAIL_MESSAGE_LIMIT,
    MAX_CHAT_DETAIL_MESSAGE_LIMIT,
  );
  const beforeCreatedAt = parseBeforeParam(
    request.nextUrl.searchParams.get("before"),
  );

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
    .select(
      "id, user_id, title, scope_type, default_tickers, default_document_types, last_message_preview, last_message_at, latest_run_status, created_at, updated_at, deleted_at",
    )
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

  const messagesBaseQuery = supabase
    .from("messages")
    .select("id, session_id, role, content, status, metadata, created_at, updated_at")
    .eq("session_id", sessionId);
  const messagesQuery = beforeCreatedAt
    ? messagesBaseQuery.lt("created_at", beforeCreatedAt)
    : messagesBaseQuery;
  const { data: messagesPage, error: messagesError } = await messagesQuery
    .order("created_at", { ascending: false })
    .limit(messageLimit + 1)
    .returns<MessageRow[]>();

  if (messagesError) {
    return internalError("채팅 메시지를 불러오지 못했습니다.");
  }

  const hasMoreMessages = (messagesPage?.length ?? 0) > messageLimit;
  const messages = (messagesPage ?? []).slice(0, messageLimit).reverse();
  const messageIds = messages.map((message) => message.id);

  const { data: runsPage, error: runsError } = await supabase
    .from("agent_runs")
    .select(
      "id, status, model, assistant_message_id, queued_at, started_at, finished_at, latency_ms, input_tokens, output_tokens, estimated_cost_usd, ontology_env, worker_env, ontology_release_id, index_generated_at, company_count, document_count, object_count, manifest_valid, agent_index_schema_version, error_code, run_kind, source_artifact_id, source_event_id"
    )
    .eq("session_id", sessionId)
    .order("queued_at", { ascending: false, nullsFirst: false })
    .limit(messageLimit + 1)
    .returns<Partial<AgentRunRow>[]>();

  if (runsError) {
    return internalError("채팅 실행 기록을 불러오지 못했습니다.");
  }

  const runs = (runsPage ?? []).slice(0, messageLimit).reverse();
  const { data: chatArtifacts, error: chatArtifactsError } =
    messageIds.length > 0
      ? await supabase
          .from("chat_message_artifacts")
          .select("id, session_id, message_id, run_id, type, payload_json, created_at")
          .eq("session_id", sessionId)
          .in("message_id", messageIds)
          .order("created_at", { ascending: true })
          .returns<ChatMessageArtifactRow[]>()
      : { data: [], error: null };

  if (chatArtifactsError) {
    return internalError("채팅 artifact를 불러오지 못했습니다.");
  }

  const artifactIds = (chatArtifacts ?? []).map((artifact) => artifact.id);
  const { data: artifactSelections, error: artifactSelectionsError } =
    artifactIds.length > 0
      ? await supabase
          .from("chat_message_artifact_selections")
          .select(
            "id, artifact_id, session_id, event_id, user_id, selected_payload_json, user_message_id, research_run_id, status, created_at, updated_at",
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
    message_pagination: {
      limit: messageLimit,
      has_more: hasMoreMessages,
      before: beforeCreatedAt,
      next_before: hasMoreMessages ? messages[0]?.created_at ?? null : null,
    },
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
