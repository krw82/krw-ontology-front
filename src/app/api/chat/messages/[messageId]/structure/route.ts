import { NextRequest } from "next/server";
import { getAuthUser, handleAuthError, forbiddenError } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildResearchArtifacts } from "@/lib/artifacts/build-research-artifact";
import { toResearchArtifact } from "@/lib/artifacts/db";
import { isUuid } from "@/lib/api/validation";
import type { AccumulatedRun } from "@/lib/agent/stream-handler";
import type {
  AgentRunRow,
  ChatSessionRow,
  CitationRow,
  Json,
  MessageRow,
  ResearchArtifactRow,
  ToolCallRow,
} from "@/types/database";
import type { MCPToolName, StreamingCitation } from "@/types/api-contracts";

function jsonForDb(value: unknown): Json | null {
  if (value === undefined || value === null) return null;
  return JSON.parse(JSON.stringify(value)) as Json;
}

function notFoundError(message: string) {
  return Response.json(
    { error: { code: "not_found" as const, message } },
    { status: 404 },
  );
}

function validationError(message: string) {
  return Response.json(
    { error: { code: "validation_error" as const, message } },
    { status: 422 },
  );
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ messageId: string }> },
) {
  const { messageId } = await params;

  if (!isUuid(messageId)) {
    return validationError("메시지 ID 형식이 올바르지 않습니다.");
  }

  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err);
  }
  if (!user) return handleAuthError(new Error("No user"));

  const supabase = await createClient();

  const { data: message, error: messageError } = await supabase
    .from("messages")
    .select("id, session_id, role, content, status, created_at, updated_at")
    .eq("id", messageId)
    .single<MessageRow>();

  if (messageError || !message) {
    return notFoundError("구조화할 답변을 찾지 못했습니다.");
  }

  if (message.role !== "assistant") {
    return validationError("어시스턴트 답변만 구조화할 수 있습니다.");
  }

  const { data: session, error: sessionError } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("id", message.session_id)
    .is("deleted_at", null)
    .single<ChatSessionRow>();

  if (sessionError || !session) {
    return notFoundError("채팅을 찾지 못했습니다.");
  }

  if (session.user_id !== user.id) {
    return forbiddenError("이 채팅에 접근할 권한이 없습니다.");
  }

  const { data: existingArtifacts } = await supabase
    .from("research_artifacts")
    .select(
      "id, session_id, run_id, message_id, artifact_version, artifact_type, title, summary, tickers, source_scope, answer_alignment, artifact_json, blocks_json, evidence_refs, quality_json, source_json, html_snapshot, created_at",
    )
    .eq("message_id", messageId)
    .order("created_at", { ascending: true })
    .returns<ResearchArtifactRow[]>();

  if (existingArtifacts && existingArtifacts.length > 0) {
    const artifacts = existingArtifacts.map(toResearchArtifact);
    return Response.json({ rich_answers: artifacts, artifacts });
  }

  const { data: run, error: runError } = await supabase
    .from("agent_runs")
    .select("*")
    .eq("assistant_message_id", messageId)
    .order("started_at", { ascending: false })
    .limit(1)
    .single<AgentRunRow>();

  if (runError || !run) {
    return notFoundError("구조화에 사용할 실행 기록을 찾지 못했습니다.");
  }

  const [{ data: toolCalls }, { data: citations }] = await Promise.all([
    supabase
      .from("tool_calls")
      .select(
        "id, run_id, tool_use_id, tool_name, arguments_json, result_summary, result_json, result_text, started_at, finished_at, error_message",
      )
      .eq("run_id", run.id)
      .order("started_at", { ascending: true })
      .returns<ToolCallRow[]>(),
    supabase
      .from("citations")
      .select(
        "id, message_id, run_id, object_id, ticker, document_type, period, section, quote_text, claim_text, evidence_grade, source_quality, trace_json",
      )
      .eq("run_id", run.id)
      .order("id", { ascending: true })
      .returns<CitationRow[]>(),
  ]);

  const accToolCalls = (toolCalls ?? []).map(toAccumulatedToolCall);
  const streamingCitations = (citations ?? []).map(toStreamingCitation);

  const drafts = buildResearchArtifacts({
    sessionId: session.id,
    runId: run.id,
    messageId,
    finalText: message.content,
    defaultTickers: session.default_tickers ?? [],
    toolCalls: accToolCalls,
    citations: streamingCitations,
    structuredAnswer: null,
    researchSynthesis: null,
    displayPlan: null,
    fallbackWhenMissing: true,
  });

  if (drafts.length === 0) {
    return validationError("구조화할 근거가 부족합니다. 기본 답변을 그대로 확인해주세요.");
  }

  const { data: insertedArtifacts, error: insertError } = await supabase
    .from("research_artifacts")
    .insert(
      drafts.map((artifact) => ({
        session_id: artifact.session_id,
        run_id: artifact.run_id,
        message_id: artifact.message_id,
        artifact_version: artifact.artifact_version,
        artifact_type: artifact.artifact_type,
        title: artifact.title,
        summary: artifact.summary,
        tickers: artifact.tickers,
        source_scope: jsonForDb(artifact.source_scope),
        answer_alignment: jsonForDb(artifact.answer_alignment),
        artifact_json: jsonForDb(artifact.artifact_json),
        blocks_json: jsonForDb(artifact.blocks_json) ?? [],
        evidence_refs: jsonForDb(artifact.evidence_refs),
        quality_json: jsonForDb(artifact.quality_json),
        source_json: jsonForDb(artifact.source_json),
        html_snapshot: artifact.html_snapshot,
      })),
    )
    .select("*")
    .returns<ResearchArtifactRow[]>();

  if (insertError || !insertedArtifacts) {
    return Response.json(
      {
        error: {
          code: "internal_error" as const,
          message: "구조화 결과를 저장하지 못했습니다.",
        },
      },
      { status: 500 },
    );
  }

  const artifacts = insertedArtifacts.map(toResearchArtifact);
  return Response.json({ rich_answers: artifacts, artifacts });
}

function toAccumulatedToolCall(row: ToolCallRow): AccumulatedRun["toolCalls"][number] {
  return {
    id: row.tool_use_id ?? row.id,
    toolName: row.tool_name as MCPToolName,
    argumentsJson:
      typeof row.arguments_json === "string"
        ? row.arguments_json
        : JSON.stringify(row.arguments_json ?? {}),
    resultSummary: row.result_summary,
    resultJson: row.result_json,
    resultText: row.result_text,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorMessage: row.error_message,
  };
}

function toStreamingCitation(row: CitationRow): StreamingCitation {
  return {
    object_id: row.object_id,
    ticker: row.ticker,
    document_type: row.document_type as StreamingCitation["document_type"],
    period: row.period,
    section: row.section,
    quote_text: row.quote_text,
    claim_text: row.claim_text,
    evidence_grade: row.evidence_grade as StreamingCitation["evidence_grade"],
    source_quality: row.source_quality as StreamingCitation["source_quality"],
    trace_json:
      row.trace_json && typeof row.trace_json === "object" && !Array.isArray(row.trace_json)
        ? (row.trace_json as Record<string, unknown>)
        : null,
  };
}
