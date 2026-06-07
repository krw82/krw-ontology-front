import type { NextRequest } from "next/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import type { McpHealthResult } from "@/lib/agent/mcp-client";
import { getReadyAgentWorker } from "@/lib/agent/worker-heartbeat";
import { enqueueAgentRun, findRunByRequestId } from "@/lib/agent/job-queue";
import { getClaudeAgentModel } from "@/lib/agent/model";
import { streamAgentRunEventsResponse } from "@/lib/agent/run-events";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { fetchHistory, reserveBudgetStep, resolveSession } from "@/lib/api/chat";
import {
  checkChatRunRateLimit,
  getClientIp,
} from "@/lib/api/chat/rate-limit";
import { releaseExecutionBudget } from "@/lib/concurrency/execution-budget";
import { getActiveOntologyCatalogRelease } from "@/lib/ontology/catalog";
import { normalizeResearchMode } from "@/lib/research-mode";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isPlainObject, isUuid } from "@/lib/api/validation";
import { buildNewsEventSelectionUserMessage } from "@/lib/chat-artifacts/news-event-selection";
import type {
  ChatMessageArtifactRow,
  ChatMessageArtifactSelectionRow,
} from "@/types/database";
import type {
  AtomicNewsEventCard,
  ErrorCode,
  NewsEventSelectionArtifactPayload,
} from "@/types/api-contracts";

let workerReadinessCache: {
  releaseId: string;
  result: McpHealthResult;
  timestamp: number;
} | null = null;
const WORKER_READINESS_TTL = 5_000;

function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  requestId?: string,
) {
  return Response.json(
    { error: { code, message }, request_id: requestId },
    { status },
  );
}

function getRequestResponseLocale(request: NextRequest): Locale {
  const locale = request.headers.get("x-krw-locale");
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

export async function POST(request: NextRequest) {
  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return errorResponse(400, "validation_error", "Invalid JSON body");
  }

  if (!isPlainObject(parsedBody)) {
    return errorResponse(400, "validation_error", "Request body must be an object");
  }

  const sessionId = stringValue(parsedBody.session_id);
  const artifactId = stringValue(parsedBody.artifact_id);
  const eventId = stringValue(parsedBody.event_id);
  const requestId = stringValue(parsedBody.request_id);
  const researchMode = normalizeResearchMode(parsedBody.research_mode);
  const responseLocale = getRequestResponseLocale(request);

  if (!requestId || !isUuid(requestId)) {
    return errorResponse(
      400,
      "validation_error",
      "request_id must be a valid UUID",
      requestId ?? undefined,
    );
  }

  if (!sessionId || !artifactId || !eventId) {
    return errorResponse(
      400,
      "validation_error",
      "session_id, artifact_id, and event_id are required",
      requestId,
    );
  }

  if (!isUuid(sessionId) || !isUuid(artifactId)) {
    return errorResponse(
      400,
      "validation_error",
      "session_id and artifact_id must be valid UUIDs",
      requestId,
    );
  }

  let user;
  try {
    user = await getAuthUser();
  } catch (err) {
    return handleAuthError(err, requestId);
  }
  if (!user) return handleAuthError(new Error("No user"), requestId);

  const existingRun = await findRunByRequestId(requestId, sessionId);
  if (existingRun) {
    return streamAgentRunEventsResponse({
      userId: user.id,
      sessionId,
      runId: existingRun.id,
      requestId,
    });
  }

  const clientIp = getClientIp(request.headers);
  const rateLimitResult = await checkChatRunRateLimit({
    userId: user.id,
    requestId,
    ip: clientIp,
    scope: "user_ip",
  });
  if (!rateLimitResult.ok) return rateLimitResult.response;

  let mcpHealth: McpHealthResult;
  try {
    const activeCatalog = await getActiveOntologyCatalogRelease();
    if (!activeCatalog?.release_id) {
      throw new Error("No active ontology web catalog release found");
    }
    mcpHealth = await getCachedReadyWorkerHealth(activeCatalog.release_id);
  } catch {
    return errorResponse(
      503,
      "worker_unavailable",
      "분석 워커가 준비되지 않았습니다. 잠시 후 다시 시도해주세요.",
      requestId,
    );
  }

  const sessionResult = await resolveSession(sessionId, user.id, requestId);
  if (!sessionResult.ok) return sessionResult.response;
  const session = sessionResult.session;

  const sessionRateLimitResult = await checkChatRunRateLimit({
    userId: user.id,
    requestId,
    ip: clientIp,
    sessionId: session.id,
    scope: "session",
  });
  if (!sessionRateLimitResult.ok) return sessionRateLimitResult.response;

  const artifactResult = await loadSelectableEvent({
    sessionId: session.id,
    artifactId,
    eventId,
  });
  if (!artifactResult.ok) {
    return errorResponse(
      artifactResult.status,
      artifactResult.code,
      artifactResult.message,
      requestId,
    );
  }

  const budgetResult = await reserveBudgetStep(
    user.id,
    requestId,
    user.email ?? null,
    researchMode,
  );
  if (!budgetResult.ok) return budgetResult.response;

  const selectedEvent = artifactResult.event;
  const visibleUserMessage = selectedEventUserMessage(selectedEvent);
  const historyResult = await fetchHistory(
    session.id,
    visibleUserMessage,
    requestId,
  );
  if (!historyResult.ok) {
    await releaseExecutionBudget(user.id, requestId, null, "history_fetch_failed");
    return historyResult.response;
  }

  const model = getClaudeAgentModel();
  const enqueueResult = await enqueueAgentRun({
    session,
    requestId,
    history: historyResult.result,
    model,
    mcpHealth,
    researchMode,
    analysisMode: "news",
    runKind: "news_research",
    responseLocale,
    selectedNewsEventContext: selectedEvent,
    sourceArtifactId: artifactResult.artifact.id,
    sourceEventId: selectedEvent.id,
  });

  if (!enqueueResult.ok) {
    await releaseExecutionBudget(
      user.id,
      requestId,
      enqueueResult.runId ?? null,
      enqueueResult.reason,
    );
    await getSupabaseAdmin()
      .from("messages")
      .delete()
      .eq("id", historyResult.result.userMessageId);

    return errorResponse(
      enqueueResult.reason === "active_run_exists" ? 409 : 500,
      enqueueResult.reason === "active_run_exists"
        ? "active_run_exists"
        : "internal_error",
      enqueueResult.reason === "active_run_exists"
        ? "이미 응답을 생성 중입니다."
        : "분석 작업을 대기열에 넣지 못했습니다.",
      requestId,
    );
  }

  await upsertSelection({
    artifactId: artifactResult.artifact.id,
    sessionId: session.id,
    event: selectedEvent,
    userId: user.id,
    userMessageId: historyResult.result.userMessageId,
    researchRunId: enqueueResult.runId,
  });

  const response = streamAgentRunEventsResponse({
    userId: user.id,
    sessionId: session.id,
    runId: enqueueResult.runId,
    requestId,
  });
  response.headers.set("X-Chat-Session-Id", session.id);
  return response;
}

async function getCachedReadyWorkerHealth(
  expectedReleaseId: string,
): Promise<McpHealthResult> {
  if (
    workerReadinessCache &&
    workerReadinessCache.releaseId === expectedReleaseId &&
    Date.now() - workerReadinessCache.timestamp < WORKER_READINESS_TTL
  ) {
    return workerReadinessCache.result;
  }

  const result = await getReadyAgentWorker(new Date(), expectedReleaseId);
  if (!result.ok) throw new Error(result.message);
  workerReadinessCache = {
    releaseId: expectedReleaseId,
    result: result.mcpHealth,
    timestamp: Date.now(),
  };
  return result.mcpHealth;
}

async function loadSelectableEvent(params: {
  sessionId: string;
  artifactId: string;
  eventId: string;
}): Promise<
  | {
      ok: true;
      artifact: ChatMessageArtifactRow;
      event: AtomicNewsEventCard;
    }
  | {
      ok: false;
      status: number;
      code: ErrorCode;
      message: string;
    }
> {
  const admin = getSupabaseAdmin();
  const { data: artifact } = await admin
    .from("chat_message_artifacts")
    .select("id, session_id, message_id, run_id, type, payload_json, created_at")
    .eq("id", params.artifactId)
    .eq("session_id", params.sessionId)
    .eq("type", "news_event_selection")
    .maybeSingle<ChatMessageArtifactRow>();

  if (!artifact) {
    return {
      ok: false,
      status: 404,
      code: "not_found",
      message: "선택할 뉴스 이벤트를 찾지 못했습니다.",
    };
  }

  const payload =
    artifact.payload_json as unknown as NewsEventSelectionArtifactPayload;
  const event = Array.isArray(payload.events)
    ? payload.events.find((candidate) => candidate.id === params.eventId)
    : undefined;

  if (!event) {
    return {
      ok: false,
      status: 404,
      code: "not_found",
      message: "선택한 뉴스 이벤트를 찾지 못했습니다.",
    };
  }

  return { ok: true, artifact, event };
}

async function upsertSelection(params: {
  artifactId: string;
  sessionId: string;
  event: AtomicNewsEventCard;
  userId: string;
  userMessageId: string;
  researchRunId: string;
}) {
  const payload = {
    artifact_id: params.artifactId,
    session_id: params.sessionId,
    event_id: params.event.id,
    user_id: params.userId,
    selected_payload_json: params.event,
    user_message_id: params.userMessageId,
    research_run_id: params.researchRunId,
    status: "queued",
    updated_at: new Date().toISOString(),
  };

  await getSupabaseAdmin()
    .from("chat_message_artifact_selections")
    .upsert(payload, { onConflict: "artifact_id,event_id" })
    .select("id")
    .maybeSingle<Pick<ChatMessageArtifactSelectionRow, "id">>();
}

function selectedEventUserMessage(event: AtomicNewsEventCard): string {
  return buildNewsEventSelectionUserMessage(event);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
