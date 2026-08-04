import type { NextRequest } from "next/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
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
import { getClaudeAgentModel } from "@/lib/agent/model";
import { streamAgentRunEventsResponse } from "@/lib/agent/run-events";
import { releaseExecutionBudget } from "@/lib/concurrency/execution-budget";
import {
  attachAnalysisCreditRunShadow,
  releaseAnalysisCreditsShadow,
  reserveAnalysisCreditsShadow,
} from "@/lib/concurrency/analysis-credits";
import { normalizeAnalysisMode } from "@/lib/analysis-mode";
import {
  defaultRunKindForAnalysisMode,
  normalizeRunKind,
} from "@/lib/run-kind";
import { normalizeGuruLensKey } from "@/lib/guru-lenses";
import { shouldBlockAnalysisCreditReservation } from "@/lib/billing/credit-policy";
import { getEntitlementStatus } from "@/lib/billing/entitlement";
import {
  getFeatureSplitMode,
  getMenuFeatureDefinition,
  isEntitlementFeatureEnabled,
  type MenuFeatureKey,
} from "@/lib/billing/feature-access";
import { parseChatAttachmentContent } from "@/lib/chat/attachments";
import { createImmediateAssistantResponse } from "@/lib/api/chat/immediate-response";
import {
  buildIdeaGenerationUserUrlContext,
  buildUserUrlNewsEventContext,
  buildUserUrlsNewsEventContext,
  UserUrlContextError,
} from "@/lib/news-discovery/user-url-context";
import {
  buildMarketIssueAgentContext,
  MarketIssueAgentContextError,
} from "@/lib/market-issues/agent-context";
import { attachCompletedDocumentsToMessage } from "@/lib/document-ingestion/prompt-context";
import {
  assessChatPromptSafety,
  blockedChatSafetyMessage,
} from "@/lib/security/chat-safety";
import type { ChatRunRequest, ErrorCode, RunKind } from "@/types/api-contracts";

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

function getRequestResponseLocale(request: NextRequest): Locale {
  const locale = request.headers.get("x-krw-locale");
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

function menuFeatureForChatRun(params: {
  runKind: RunKind;
  scopeType: "global" | "company";
  defaultTickers: string[];
}): MenuFeatureKey {
  if (params.runKind === "guru_advisor") return "guru_advisor";
  if (params.runKind === "idea_generation") return "stock_discovery";
  if (params.scopeType === "company" || params.defaultTickers.length > 0) {
    return "company_search";
  }
  return "wide_research";
}

async function enforceChatFeatureAccess(params: {
  userId: string;
  userEmail: string | null;
  featureKey: MenuFeatureKey;
  requestId: string;
}): Promise<Response | null> {
  if (getFeatureSplitMode() === "off") return null;

  const entitlement = await getEntitlementStatus(
    params.userId,
    params.userEmail,
  );
  if (isEntitlementFeatureEnabled(entitlement, params.featureKey)) return null;

  const feature = getMenuFeatureDefinition(params.featureKey);
  const requiredPlan =
    feature.required_plan.charAt(0).toUpperCase() +
    feature.required_plan.slice(1);
  return errorResponse(
    403,
    "forbidden",
    `${feature.label}은 ${requiredPlan} 플랜부터 사용할 수 있습니다.`,
    params.requestId,
  );
}

// --- POST handler ---

export async function POST(request: NextRequest) {
  // 1. Validate request & authenticate
  const validation = await validateRequest(request);
  if (!validation.ok) return validation.response;
  const { body, userId, userEmail } = validation.data;

  const { content, request_id } = body;
  const responseLocale = getRequestResponseLocale(request);

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

  const preliminaryRunKind = normalizeRunKind(
    body.run_kind ?? defaultRunKindForAnalysisMode(normalizeAnalysisMode(body.analysis_mode)),
  );
  let featureChecked = false;
  if (!body.session_id) {
    const preliminaryScopeType =
      body.scope_type ?? (body.default_tickers?.length ? "company" : "global");
    const featureResponse = await enforceChatFeatureAccess({
      userId,
      userEmail,
      featureKey: menuFeatureForChatRun({
        runKind: preliminaryRunKind,
        scopeType: preliminaryScopeType,
        defaultTickers: body.default_tickers ?? [],
      }),
      requestId: request_id,
    });
    if (featureResponse) return featureResponse;
    featureChecked = true;
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

  // 4. Resolve session (lookup + ownership check) before touching the
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

  let effectiveAnalysisMode = normalizeAnalysisMode(body.analysis_mode);
  let effectiveRunKind = normalizeRunKind(
    body.run_kind ?? defaultRunKindForAnalysisMode(effectiveAnalysisMode),
  );
  const guruLensKey =
    effectiveRunKind === "guru_advisor"
      ? normalizeGuruLensKey(body.guru_lens)
      : null;
  let routingMode: "auto" | "preserve" =
    effectiveRunKind === "company_research" ? "auto" : "preserve";

  if (!featureChecked) {
    const featureResponse = await enforceChatFeatureAccess({
      userId,
      userEmail,
      featureKey: menuFeatureForChatRun({
        runKind: effectiveRunKind,
        scopeType: session.scopeType,
        defaultTickers: session.defaultTickers,
      }),
      requestId: request_id,
    });
    if (featureResponse) return featureResponse;
  }

  let selectedNewsEventContext: Record<string, unknown> | null = null;
  const marketIssueId = body.market_issue_id ?? null;
  const userUrls = body.user_urls?.length
    ? body.user_urls
    : body.user_url
      ? [body.user_url]
      : [];
  const userMessageMetadata = {
    ...(userUrls.length > 0 ? { user_urls: userUrls } : {}),
    ...(marketIssueId ? { market_issue_id: marketIssueId } : {}),
  };

  const safetyAssessment = assessChatPromptSafety(content);
  if (safetyAssessment.blocked) {
    const historyResult = await fetchHistory(
      session.id,
      content,
      request_id,
      userMessageMetadata,
    );
    if (!historyResult.ok) return historyResult.response;

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
        document_attachment_count: 0,
        research_mode: body.research_mode,
        analysis_mode: effectiveAnalysisMode,
        run_kind: effectiveRunKind,
        guru_lens: guruLensKey,
        routing_mode: routingMode,
        has_user_url: userUrls.length > 0,
        user_url_count: userUrls.length,
        response_locale: responseLocale,
        question_source: session.scopeType === "company" ? "company_context" : "custom",
        source_surface: session.scopeType === "company" ? "ticker_chat" : "chat",
        blocked_by: "chat_safety",
        block_reason: safetyAssessment.reason,
      },
    });

    return withSessionHeader(
      await createImmediateAssistantResponse({
        sessionId: session.id,
        requestId: request_id,
        content: blockedChatSafetyMessage(responseLocale),
      }),
      session.id,
    );
  }

  // 5. Check catalog/worker readiness before reserving execution budget. The
  // web route only queues durable work; MCP calls run inside the Mac worker.
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

  if (marketIssueId && userUrls.length > 0) {
    return errorResponse(
      400,
      "validation_error",
      "뉴스 기반 분석과 URL 첨부는 동시에 사용할 수 없습니다.",
      request_id,
    );
  }

  if (marketIssueId) {
    try {
      selectedNewsEventContext = await buildMarketIssueAgentContext({
        db: getSupabaseAdmin(),
        issueId: marketIssueId,
      });
      // Macro/policy issues without a ticker resolve to wide research
      // (idea_generation); ticker-bearing issues stay on company_research.
      const contextTickers = (selectedNewsEventContext?.primary_tickers as string[]) ?? [];
      if (contextTickers.length > 0) {
        effectiveAnalysisMode = "company";
        effectiveRunKind = "company_research";
      } else {
        effectiveAnalysisMode = "news";
        effectiveRunKind = "idea_generation";
      }
      routingMode = "preserve";
    } catch (error) {
      if (error instanceof MarketIssueAgentContextError) {
        return errorResponse(400, "validation_error", "선택한 뉴스 분석을 준비하지 못했습니다.", request_id);
      }
      return errorResponse(500, "internal_error", "선택한 뉴스 분석을 준비하지 못했습니다.", request_id);
    }
  } else if (userUrls.length > 0 && effectiveRunKind === "idea_generation") {
    try {
      selectedNewsEventContext = await buildIdeaGenerationUserUrlContext({
        urls: userUrls,
        userQuestion: content,
      });
      routingMode = "preserve";
    } catch (error) {
      const message =
        error instanceof UserUrlContextError
          ? error.message
          : "URL을 읽지 못했습니다.";
      return errorResponse(400, "validation_error", message, request_id);
    }
  } else if (userUrls.length > 0) {
    const ticker = session.defaultTickers[0];
    if (!ticker) {
      return errorResponse(
        400,
        "validation_error",
        "URL 첨부는 종목 기준 채팅에서만 사용할 수 있습니다.",
        request_id,
      );
    }

    try {
      selectedNewsEventContext =
        userUrls.length === 1
          ? await buildUserUrlNewsEventContext({
              url: userUrls[0],
              ticker,
              userQuestion: content,
            })
          : await buildUserUrlsNewsEventContext({
              urls: userUrls,
              ticker,
              userQuestion: content,
            });
      effectiveAnalysisMode = "company";
      effectiveRunKind = "company_research";
      routingMode = "preserve";
    } catch (error) {
      const message =
        error instanceof UserUrlContextError
          ? error.message
          : "URL을 읽지 못했습니다.";
      return errorResponse(400, "validation_error", message, request_id);
    }
  }

  // 6. Open an execution-budget record before creating durable chat work.
  const budgetResult = await reserveBudgetStep(
    userId,
    request_id,
    userEmail,
    body.research_mode,
  );
  if (!budgetResult.ok) return budgetResult.response;
  const creditReservation = await reserveAnalysisCreditsShadow(userId, request_id, {
    runKind: effectiveRunKind,
    researchMode: body.research_mode,
  });
  if (
    !budgetResult.budget.entitlement?.usage.unlimited &&
    shouldBlockAnalysisCreditReservation(creditReservation)
  ) {
    await releaseExecutionBudget(
      userId,
      request_id,
      null,
      "analysis_credit_reserve_blocked",
    );
    await releaseAnalysisCreditsShadow(
      userId,
      request_id,
      null,
      "analysis_credit_reserve_blocked",
    );
    return errorResponse(
      creditReservation.ok ? 429 : 500,
      creditReservation.ok ? "cost_cap_exceeded" : "internal_error",
      creditReservation.ok
        ? "이번 주 분석 한도에 도달해 새 분석을 시작할 수 없습니다."
        : "사용량 정보를 확인하지 못했습니다.",
      request_id,
    );
  }

  // 7. Save user message idempotently & fetch history
  const historyResult = await fetchHistory(
    session.id,
    content,
    request_id,
    userMessageMetadata,
  );
  if (!historyResult.ok) {
    await releaseExecutionBudget(userId, request_id, null, "history_fetch_failed");
    await releaseAnalysisCreditsShadow(
      userId,
      request_id,
      null,
      "history_fetch_failed",
    );
    return historyResult.response;
  }

  const documentAttachmentIds = body.attachment_ids ?? [];
  if (documentAttachmentIds.length > 0) {
    const attachmentResult = await attachCompletedDocumentsToMessage(
      getSupabaseAdmin(),
      {
        userId,
        sessionId: session.id,
        messageId: historyResult.result.userMessageId,
        attachmentIds: documentAttachmentIds,
      },
    );
    if (!attachmentResult.ok) {
      await releaseExecutionBudget(
        userId,
        request_id,
        null,
        "document_attachment_validation_failed",
      );
      await releaseAnalysisCreditsShadow(
        userId,
        request_id,
        null,
        "document_attachment_validation_failed",
      );
      if (historyResult.result.userMessageCreated) {
        await getSupabaseAdmin()
          .from("messages")
          .delete()
          .eq("id", historyResult.result.userMessageId);
      }
      return errorResponse(
        400,
        "validation_error",
        attachmentResult.message,
        request_id,
      );
    }
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

  const effectiveGuruLensKey =
    effectiveRunKind === "guru_advisor" ? guruLensKey : null;

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
      document_attachment_count: documentAttachmentIds.length,
      research_mode: body.research_mode,
      analysis_mode: effectiveAnalysisMode,
      run_kind: effectiveRunKind,
      guru_lens: effectiveGuruLensKey,
      routing_mode: routingMode,
      has_user_url: userUrls.length > 0,
      user_url_count: userUrls.length,
      response_locale: responseLocale,
      question_source: session.scopeType === "company" ? "company_context" : "custom",
      source_surface: session.scopeType === "company" ? "ticker_chat" : "chat",
    },
  });

  // 9. Queue durable agent work. The HTTP response only streams persisted
  // run events; Claude Agent SDK execution is owned by agent-worker.
  const model = getClaudeAgentModel();
  const enqueueResult = await enqueueAgentRun({
    session,
    requestId: request_id,
    history: historyResult.result,
    model,
    mcpHealth,
    researchMode: body.research_mode,
    analysisMode: effectiveAnalysisMode,
    runKind: effectiveRunKind,
    guruLensKey: effectiveGuruLensKey,
    responseLocale,
    executorType: "claude_agent",
    selectedNewsEventContext,
    routingMode,
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
    await releaseAnalysisCreditsShadow(
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

  await attachAnalysisCreditRunShadow(userId, request_id, enqueueResult.runId);

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
