import { NextRequest } from "next/server";
import { checkMcpHealth } from "@/lib/agent/mcp-client";
import type { McpHealthResult } from "@/lib/agent/mcp-client";
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

  const { session_id, content, request_id } = body;

  // 2. Resolve session (lookup + ownership check)
  const sessionResult = await resolveSession(session_id, userId, request_id);
  if (!sessionResult.ok) return sessionResult.response;
  const session = sessionResult.session;

  // 3. Check daily quota
  const quotaResult = await checkQuotaStep(userId, request_id);
  if (!quotaResult.ok) return quotaResult.response;
  const quota = quotaResult.quota;

  // 4. Check MCP health (cached for 30s)
  const mcpHealth = await getCachedMcpHealth();
  if (!mcpHealth.connected) {
    return errorResponse(503, "mcp_unavailable", "MCP service unavailable", request_id);
  }

  // 5. Save user message & fetch history
  const historyResult = await fetchHistory(session_id, content, request_id);
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
