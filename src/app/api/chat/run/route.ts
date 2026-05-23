import { NextRequest } from "next/server";
import { checkMcpHealth } from "@/lib/agent/mcp-client";
import type { McpHealthResult } from "@/lib/agent/mcp-client";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { getIndexedCompany } from "@/lib/ontology/catalog";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AgentRunRow, ChatSessionRow } from "@/types/database";
import {
  validateRequest,
  resolveSession,
  reserveBudgetStep,
  fetchHistory,
  executeRun,
} from "@/lib/api/chat";
import {
  checkChatRunRateLimit,
  getClientIp,
} from "@/lib/api/chat/rate-limit";
import { streamPersistedRunResponse } from "@/lib/api/chat/run-agent";
import { releaseExecutionBudget } from "@/lib/concurrency/execution-budget";

// --- MCP health cache ---

let mcpHealthCache: { result: McpHealthResult; timestamp: number } | null = null;
const MCP_HEALTH_TTL = 30_000;
const ATTACHED_FILE_TAG_PATTERN = /<attached_file\s+name="[^"]*">/g;

async function getCachedMcpHealth(): Promise<McpHealthResult> {
  if (mcpHealthCache && Date.now() - mcpHealthCache.timestamp < MCP_HEALTH_TTL) {
    return mcpHealthCache.result;
  }
  const result = await checkMcpHealth();
  mcpHealthCache = { result, timestamp: Date.now() };
  return result;
}

function errorResponse(
  status: number,
  code: import("@/types/api-contracts").ErrorCode,
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
    return withSessionHeader(streamPersistedRunResponse({
      userId,
      sessionId: existingRun.session_id,
      runId: existingRun.id,
      requestId: request_id,
    }), existingRun.session_id);
  }

  // 3. Check durable request rate limits before reserving budget or starting work.
  const rateLimitResult = await checkChatRunRateLimit({
    userId,
    requestId: request_id,
    ip: getClientIp(request.headers),
    sessionId: body.session_id ?? null,
  });
  if (!rateLimitResult.ok) return rateLimitResult.response;

  // 4. Check MCP health (cached for 30s) before reserving execution budget.
  let mcpHealth: McpHealthResult;
  try {
    mcpHealth = await getCachedMcpHealth();
  } catch {
    return errorResponse(
      503,
      "mcp_unavailable",
      "온톨로지 도구에 연결할 수 없습니다.",
      request_id,
    );
  }
  if (!mcpHealth.connected) {
    return errorResponse(503, "mcp_unavailable", "온톨로지 도구에 연결할 수 없습니다.", request_id);
  }

  // 5. Reserve execution budget before creating durable chat work.
  const budgetResult = await reserveBudgetStep(userId, request_id, userEmail);
  if (!budgetResult.ok) return budgetResult.response;
  const budget = budgetResult.budget;

  // 6. Resolve session (lookup + ownership check)
  const sessionIdResult = await getOrCreateSessionId(body, userId, request_id);
  if (!sessionIdResult.ok) {
    await releaseExecutionBudget(userId, request_id, null, "session_resolve_failed");
    return sessionIdResult.response;
  }

  const sessionResult = await resolveSession(
    sessionIdResult.sessionId,
    userId,
    request_id,
  );
  if (!sessionResult.ok) {
    await releaseExecutionBudget(userId, request_id, null, "session_forbidden");
    return sessionResult.response;
  }
  const session = sessionResult.session;

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
    return withSessionHeader(streamPersistedRunResponse({
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
      source_surface: body.scope_type === "company" ? "ticker_chat" : "chat",
    },
  });

  // 9. Acquire lease, run agent, stream results
  return withSessionHeader(executeRun({
    request,
    session,
    content,
    requestId: request_id,
    history: historyResult.result,
    budget,
    mcpHealth,
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
  body: import("@/types/api-contracts").ChatRunRequest,
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
    const indexedCompanies = await Promise.all(
      defaultTickers.map((ticker) => getIndexedCompany(ticker)),
    );
    const missingTicker = defaultTickers.find(
      (_, index) => !indexedCompanies[index],
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
  return content.match(ATTACHED_FILE_TAG_PATTERN)?.length ?? 0;
}
