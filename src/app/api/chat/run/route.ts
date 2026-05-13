import { NextRequest } from "next/server";
import { checkMcpHealth } from "@/lib/agent/mcp-client";
import type { McpHealthResult } from "@/lib/agent/mcp-client";
import { getIndexedCompany } from "@/lib/ontology/catalog";
import { createClient } from "@/lib/supabase/server";
import type { ChatSessionRow } from "@/types/database";
import {
  validateRequest,
  resolveSession,
  checkQuotaStep,
  fetchHistory,
  executeRun,
} from "@/lib/api/chat";

// --- MCP health cache ---

let mcpHealthCache: { result: McpHealthResult; timestamp: number } | null = null;
const MCP_HEALTH_TTL = 30_000;

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
  const { body, userId } = validation.data;

  const { content, request_id } = body;

  // 2. Resolve session (lookup + ownership check)
  const sessionIdResult = await getOrCreateSessionId(body, userId, request_id);
  if (!sessionIdResult.ok) return sessionIdResult.response;

  const sessionResult = await resolveSession(
    sessionIdResult.sessionId,
    userId,
    request_id,
  );
  if (!sessionResult.ok) return sessionResult.response;
  const session = sessionResult.session;

  // 3. Check daily quota
  const quotaResult = await checkQuotaStep(userId, request_id);
  if (!quotaResult.ok) return quotaResult.response;
  const quota = quotaResult.quota;

  // 4. Check MCP health (cached for 30s)
  const mcpHealth = await getCachedMcpHealth();
  if (!mcpHealth.connected) {
    return errorResponse(503, "mcp_unavailable", "온톨로지 도구에 연결할 수 없습니다.", request_id);
  }

  // 5. Save user message & fetch history
  const historyResult = await fetchHistory(session.id, content, request_id);
  if (!historyResult.ok) return historyResult.response;

  // 6. Acquire lease, run agent, stream results
  return executeRun({
    request,
    session,
    content,
    requestId: request_id,
    history: historyResult.result,
    quota,
    mcpHealth,
  });
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

  const supabase = await createClient();
  const { data: session, error } = await supabase
    .from("chat_sessions")
    .insert({
      user_id: userId,
      title,
      scope_type: scopeType,
      default_tickers: defaultTickers,
      default_document_types: body.default_document_types ?? [],
    })
    .select("id")
    .single<ChatSessionRow>();

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
