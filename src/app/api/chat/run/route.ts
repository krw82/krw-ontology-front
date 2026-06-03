import type { NextRequest } from "next/server";
import type { McpHealthResult } from "@/lib/agent/mcp-client";
import { getReadyAgentWorker } from "@/lib/agent/worker-heartbeat";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import {
  getActiveOntologyCatalogRelease,
  getIndexedCompanies,
} from "@/lib/ontology/catalog";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AgentRunRow, ChatSessionRow } from "@/types/database";
import {
  validateRequest,
  resolveSession,
  reserveBudgetStep,
  fetchHistory,
} from "@/lib/api/chat";
import {
  checkChatRunRateLimit,
  getClientIp,
} from "@/lib/api/chat/rate-limit";
import { enqueueAgentRun } from "@/lib/agent/job-queue";
import { streamAgentRunEventsResponse } from "@/lib/agent/run-events";
import { releaseExecutionBudget } from "@/lib/concurrency/execution-budget";
import { parseChatAttachmentContent } from "@/lib/chat/attachments";
import type { ChatRunRequest, ErrorCode } from "@/types/api-contracts";

// --- Agent worker readiness cache ---

let workerReadinessCache: {
  releaseId: string;
  result: McpHealthResult;
  timestamp: number;
} | null = null;
const WORKER_READINESS_TTL = 5_000;

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
  if (!result.ok) {
    throw new Error(result.message);
  }
  workerReadinessCache = {
    releaseId: expectedReleaseId,
    result: result.mcpHealth,
    timestamp: Date.now(),
  };
  return result.mcpHealth;
}

function errorResponse(
  status: number,
  code: ErrorCode,
  message: string,
  requestId?: string
) {
  return Response.json(
    { error: { code, message }, request_id: requestId },
    { status }
  );
}

// --- POST handler ---

export async function POST(request: NextRequest) {
  // 1. Validate request & authenticate
  const validation = await validateRequest(request);
  if (!validation.ok) return validation.response;
  const { body, userId, userEmail } = validation.data;

  const { content, request_id } = body;

  // 2. Idempotency: a browser retry with the same request_id must not create
  // another session/message/run. Reattach to the existing run instead.
  const existingRun = await findExistingRunForRequest(request_id, userId);
  if (existingRun) {
    return withSessionHeader(streamAgentRunEventsResponse({
      userId,
      sessionId: existingRun.session_id,
      runId: existingRun.id,
      requestId: request_id,
    }), existingRun.session_id);
  }

  const clientIp = getClientIp(request.headers);

  // 3. Check durable user/IP request rate limits before reserving budget or
  // starting work. The session bucket is checked only after ownership is known.
  const rateLimitResult = await checkChatRunRateLimit({
    userId,
    requestId: request_id,
    ip: clientIp,
    scope: "user_ip",
  });
  if (!rateLimitResult.ok) return rateLimitResult.response;

  // 4. Check worker readiness before reserving execution budget. The web/API
  // server should not need to run the heavy local MCP health path when agent
  // execution is delegated to a separate worker, such as the production Mac
  // worker. Require the ready worker to report the same release as the active
  // web catalog so prod answers cannot mix catalog and SQLite releases.
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
      request_id,
    );
  }
  if (!mcpHealth.connected) {
    return errorResponse(
      503,
      "worker_unavailable",
      "분석 워커가 준비되지 않았습니다. 잠시 후 다시 시도해주세요.",
      request_id,
    );
  }

  // 5. Resolve session (lookup + ownership check) before touching the
  // per-session rate-limit bucket.
  const sessionIdResult = await getOrCreateSessionId(body, userId, request_id);
  if (!sessionIdResult.ok) {
    return sessionIdResult.response;
  }

  const sessionResult = await resolveSession(
    sessionIdResult.sessionId,
    userId,
    request_id,
  );
  if (!sessionResult.ok) {
    return sessionResult.response;
  }
  const session = sessionResult.session;

  const sessionRateLimitResult = await checkChatRunRateLimit({
    userId,
    requestId: request_id,
    ip: clientIp,
    sessionId: session.id,
    scope: "session",
  });
  if (!sessionRateLimitResult.ok) return sessionRateLimitResult.response;

  // 6. Open an execution-budget record before creating durable chat work.
  const budgetResult = await reserveBudgetStep(
    userId,
    request_id,
    userEmail,
    body.research_mode,
  );
  if (!budgetResult.ok) return budgetResult.response;

  // 7. Save user message idempotently & fetch history
  const historyResult = await fetchHistory(session.id, content, request_id);
  if (!historyResult.ok) {
    await releaseExecutionBudget(userId, request_id, null, "history_fetch_failed");
    return historyResult.response;
  }

  // 8. A duplicate can arrive while the first request is between session/message
  // creation and run acquisition. Re-check before starting the agent.
  const existingRunAfterMessage = await findExistingRunForRequest(request_id, userId);
  if (existingRunAfterMessage) {
    return withSessionHeader(streamAgentRunEventsResponse({
      userId,
      sessionId: existingRunAfterMessage.session_id,
      runId: existingRunAfterMessage.id,
      requestId: request_id,
    }), existingRunAfterMessage.session_id);
  }

  await recordAnalyticsEventFromRequest(request, {
    eventName: "question_submitted",
    userId,
    sessionId: session.id,
    messageId: historyResult.result.userMessageId,
    properties: {
      scope_type: session.scopeType,
      ticker: session.defaultTickers[0] ?? null,
      tickers: session.defaultTickers,
      question_length: content.length,
      attachment_count: countAttachedFiles(content),
      research_mode: body.research_mode,
      analysis_mode: body.analysis_mode,
      question_source: session.scopeType === "company" ? "company_context" : "custom",
      source_surface: session.scopeType === "company" ? "ticker_chat" : "chat",
    },
  });

  // 9. Queue durable agent work. The HTTP response only streams persisted
  // run events; Claude Agent SDK execution is owned by agent-worker.
  const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
  const enqueueResult = await enqueueAgentRun({
    session,
    requestId: request_id,
    history: historyResult.result,
    model,
    mcpHealth,
    researchMode: body.research_mode,
    analysisMode: body.analysis_mode,
  });

  if (!enqueueResult.ok) {
    if (enqueueResult.reason === "duplicate_request" && enqueueResult.runId) {
      return withSessionHeader(streamAgentRunEventsResponse({
        userId,
        sessionId: session.id,
        runId: enqueueResult.runId,
        requestId: request_id,
      }), session.id);
    }

    await releaseExecutionBudget(
      userId,
      request_id,
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
      request_id,
    );
  }

  return withSessionHeader(streamAgentRunEventsResponse({
    userId,
    sessionId: session.id,
    runId: enqueueResult.runId,
    requestId: request_id,
  }), session.id);
}

function withSessionHeader(response: Response, sessionId: string): Response {
  response.headers.set("X-Chat-Session-Id", sessionId);
  return response;
}

async function findExistingRunForRequest(
  requestId: string,
  userId: string,
): Promise<Pick<AgentRunRow, "id" | "session_id"> | null> {
  const admin = getSupabaseAdmin();
  const { data: run } = await admin
    .from("agent_runs")
    .select("id, session_id")
    .eq("request_id", requestId)
    .maybeSingle<Pick<AgentRunRow, "id" | "session_id">>();

  if (!run) return null;

  const { data: session } = await admin
    .from("chat_sessions")
    .select("id, user_id")
    .eq("id", run.session_id)
    .is("deleted_at", null)
    .maybeSingle<Pick<ChatSessionRow, "id" | "user_id">>();

  return session?.user_id === userId ? run : null;
}

async function getOrCreateSessionId(
  body: ChatRunRequest,
  userId: string,
  requestId: string,
): Promise<{ ok: true; sessionId: string } | { ok: false; response: Response }> {
  if (body.session_id) {
    return { ok: true, sessionId: body.session_id };
  }

  const scopeType = body.scope_type ?? "global";
  let defaultTickers = body.default_tickers ?? [];

  if (scopeType === "company") {
    defaultTickers = defaultTickers.map((ticker) => ticker.trim().toUpperCase());
    const indexedCompanies = await getIndexedCompanies(defaultTickers);
    const indexedTickerSet = new Set(
      indexedCompanies.map((company) => company.ticker),
    );
    const missingTicker = defaultTickers.find(
      (ticker) => !indexedTickerSet.has(ticker),
    );

    if (missingTicker) {
      return {
        ok: false,
        response: errorResponse(
          400,
          "validation_error",
          `현재 온톨로지 인덱스에 없는 회사입니다: ${missingTicker}`,
          requestId,
        ),
      };
    }
  }

  const title =
    scopeType === "company" && defaultTickers.length > 0
      ? `리서치: ${defaultTickers.join(", ")}`
      : "새 채팅";

  const admin = getSupabaseAdmin();
  const insertPayload = {
    user_id: userId,
    title,
    scope_type: scopeType,
    default_tickers: defaultTickers,
    default_document_types: body.default_document_types ?? [],
    client_request_id: requestId,
  };

  const { data: session, error } = await admin
    .from("chat_sessions")
    .insert(insertPayload)
    .select("id")
    .single<Pick<ChatSessionRow, "id">>();

  if (error?.code === "23505") {
    const { data: existingSession } = await admin
      .from("chat_sessions")
      .select("id")
      .eq("user_id", userId)
      .eq("client_request_id", requestId)
      .is("deleted_at", null)
      .maybeSingle<Pick<ChatSessionRow, "id">>();

    if (existingSession?.id) {
      return { ok: true, sessionId: existingSession.id };
    }
  }

  if (error || !session) {
    return {
      ok: false,
      response: errorResponse(
        500,
        "internal_error",
        "새 채팅을 만들지 못했습니다.",
        requestId,
      ),
    };
  }

  return { ok: true, sessionId: session.id };
}

function countAttachedFiles(content: string): number {
  return parseChatAttachmentContent(content).attachments.length;
}
