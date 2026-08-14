import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { findRunByRequestId } from "@/lib/agent/job-queue";
import { streamAgentRunEventsResponse } from "@/lib/agent/run-events";
import {
  getRustAgentRuntime,
  RustAgentRuntimeError,
  type RustAgentEnqueueResult,
} from "@/lib/agent-v1/runtime";
import { getReadyRustAgentDaemon } from "@/lib/agent/daemon-heartbeat";
import { getAuthUser, handleAuthError } from "@/lib/auth";
import { fetchHistory, reserveBudgetStep, resolveSession } from "@/lib/api/chat";
import {
  checkChatRunRateLimit,
  getClientIp,
} from "@/lib/api/chat/rate-limit";
import { releaseExecutionBudget } from "@/lib/concurrency/execution-budget";
import {
  attachAnalysisCreditRunShadow,
  releaseAnalysisCreditsShadow,
  reserveAnalysisCreditsShadow,
} from "@/lib/concurrency/analysis-credits";
import { shouldBlockAnalysisCreditReservation } from "@/lib/billing/credit-policy";
import { normalizeResearchMode } from "@/lib/research-mode";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isPlainObject, isUuid } from "@/lib/api/validation";
import {
  buildEventPremisePack,
  buildNewsEventSelectionUserMessage,
} from "@/lib/chat-artifacts/news-event-selection";
import type {
  ChatMessageArtifactRow,
  ChatMessageArtifactSelectionRow,
} from "@/types/database";
import type {
  AtomicNewsEventCard,
  ErrorCode,
  NewsEventSelectionArtifactPayload,
} from "@/types/api-contracts";

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

  let rustDaemonReady = false;
  try {
    rustDaemonReady = (await getReadyRustAgentDaemon()).ok;
  } catch {
    rustDaemonReady = false;
  }
  if (!rustDaemonReady) {
    return errorResponse(
      503,
      "worker_unavailable",
      "리서치 엔진이 준비되지 않았습니다. 잠시 후 다시 시도해주세요.",
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

  const selectedEvent = artifactResult.event;
  const selectedFeedId = isUuid(selectedEvent.id) ? selectedEvent.id : null;

  const budgetResult = await reserveBudgetStep(
    user.id,
    requestId,
    user.email ?? null,
    researchMode,
  );
  if (!budgetResult.ok) return budgetResult.response;
  const creditReservation = await reserveAnalysisCreditsShadow(user.id, requestId, {
    runKind: selectedFeedId ? "news_discovery" : "company_research",
    researchMode,
  });
  if (
    !budgetResult.budget.entitlement?.usage.unlimited &&
    shouldBlockAnalysisCreditReservation(creditReservation)
  ) {
    await releaseExecutionBudget(
      user.id,
      requestId,
      null,
      "analysis_credit_reserve_blocked",
    );
    await releaseAnalysisCreditsShadow(
      user.id,
      requestId,
      null,
      "analysis_credit_reserve_blocked",
    );
    return errorResponse(
      creditReservation.ok ? 429 : 500,
      creditReservation.ok ? "cost_cap_exceeded" : "internal_error",
      creditReservation.ok
        ? "이번 주 분석 한도에 도달해 새 분석을 시작할 수 없습니다."
        : "사용량 정보를 확인하지 못했습니다.",
      requestId,
    );
  }

  const visibleUserMessage = selectedEventUserMessage(selectedEvent);
  const historyResult = await fetchHistory(
    session.id,
    visibleUserMessage,
    requestId,
  );
  if (!historyResult.ok) {
    await releaseExecutionBudget(user.id, requestId, null, "history_fetch_failed");
    await releaseAnalysisCreditsShadow(
      user.id,
      requestId,
      null,
      "history_fetch_failed",
    );
    return historyResult.response;
  }

  // The Rust feed image owns the selected-event boundary. A published feed
  // issue ID is the only browser value forwarded to the worker; article text
  // remains a Supabase-backed feed capability result, not a client command.
  const runId = randomUUID();
  let enqueueResult: RustAgentEnqueueResult;
  try {
    const runtime = await getRustAgentRuntime();
    enqueueResult = await runtime.enqueue({
      runId,
      requestId,
      userId: user.id,
      sessionId: session.id,
      userMessageId: historyResult.result.userMessageId,
      runKind: selectedFeedId
        ? "news_research"
        : session.defaultTickers.length > 0
          ? "company_research"
          : "news_discovery_wide",
      locale: responseLocale === "en" ? "en-US" : "ko-KR",
      question: selectedEventUserMessage(selectedEvent),
      context: selectedFeedId
        ? { kind: "selected_feed_items", feed_item_ids: [selectedFeedId] }
        : session.defaultTickers.length > 0
          ? { kind: "company_ticker_set", tickers: session.defaultTickers }
          : { kind: "covered_universe", universe: "covered" },
    });
  } catch (error) {
    const reason = error instanceof RustAgentRuntimeError
      ? error.code
      : "agent_v1_enqueue_failed";
    await releaseExecutionBudget(user.id, requestId, null, reason);
    await releaseAnalysisCreditsShadow(user.id, requestId, null, reason);
    await getSupabaseAdmin()
      .from("messages")
      .delete()
      .eq("id", historyResult.result.userMessageId);
    return errorResponse(
      503,
      "worker_unavailable",
      "리서치 엔진이 잠시 준비되지 않았습니다. 잠시 후 다시 시도해주세요.",
      requestId,
    );
  }

  await attachAnalysisCreditRunShadow(user.id, requestId, enqueueResult.runId);

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
    selected_payload_json: {
      ...params.event,
      premise: buildEventPremisePack(params.event),
    },
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
