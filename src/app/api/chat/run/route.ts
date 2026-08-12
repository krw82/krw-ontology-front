import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import {
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
import { streamAgentRunEventsResponse } from "@/lib/agent/run-events";
import {
  getRustAgentRuntime,
  RustAgentRuntimeError,
  type RustAgentEnqueueResult,
} from "@/lib/agent-v1/runtime";
import { getReadyRustAgentDaemon } from "@/lib/agent/daemon-heartbeat";
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
  assessChatPromptSafety,
  blockedChatSafetyMessage,
} from "@/lib/security/chat-safety";
import { getResearchAdmissionMode } from "@/lib/agent-v1/readiness";
import type { ChatRunRequest, ErrorCode, RunKind } from "@/types/api-contracts";

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

  const effectiveAnalysisMode = normalizeAnalysisMode(body.analysis_mode);
  const requestedRunKind = normalizeRunKind(
    body.run_kind ?? defaultRunKindForAnalysisMode(effectiveAnalysisMode),
  );
  // A global chat with no ticker is a research question over the covered
  // universe. Keep idea_generation as the explicit candidate-screening lane,
  // while ordinary tickerless questions use the wide-research workflow.
  const effectiveRunKind: RunKind =
    requestedRunKind === "company_research" &&
    session.scopeType === "global" &&
    session.defaultTickers.length === 0
      ? "wide_research"
      : requestedRunKind;
  const guruLensKey =
    effectiveRunKind === "guru_advisor"
      ? normalizeGuruLensKey(body.guru_lens)
      : null;
  const routingMode: "auto" | "preserve" =
    effectiveRunKind === "company_research" || effectiveRunKind === "wide_research"
      ? "auto"
      : "preserve";

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

  if (marketIssueId || userUrls.length > 0 || (body.attachment_ids?.length ?? 0) > 0) {
    return errorResponse(
      400,
      "validation_error",
      "현재 전환된 리서치 엔진은 회사·와이드 기본 질문만 지원합니다. 새 채팅방에서 첨부·URL·뉴스를 제외하고 다시 요청해주세요.",
      request_id,
    );
  }

  if (
    !["company_research", "wide_research", "scenario_sensitivity", "guru_advisor", "idea_generation"].includes(
      effectiveRunKind,
    )
  ) {
    return errorResponse(
      400,
      "validation_error",
      "현재 전환된 리서치 엔진에서 지원하지 않는 리서치 유형입니다.",
      request_id,
    );
  }

  if (!['idea_generation', 'wide_research'].includes(effectiveRunKind) && session.defaultTickers.length === 0) {
    return errorResponse(
      400,
      "validation_error",
      "회사 티커가 있는 새 채팅방에서 질문해주세요.",
      request_id,
    );
  }

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

  // Provider cutovers use a bounded drain/closed window. Save the question
  // and a terminal assistant message without reserving credits or creating a
  // Rust run, so the browser never remains pending while the daemon restarts.
  if (getResearchAdmissionMode() !== "open") {
    const historyResult = await fetchHistory(
      session.id,
      content,
      request_id,
      userMessageMetadata,
      { loadHistory: false },
    );
    if (!historyResult.ok) return historyResult.response;
    return withSessionHeader(
      await createImmediateAssistantResponse({
        sessionId: session.id,
        requestId: request_id,
        content: "리서치 엔진을 안전하게 전환 중입니다. 질문은 저장했으며 잠시 후 다시 시도해 주세요.",
      }),
      session.id,
    );
  }

  // The Rust process lives on the Mac, not on the GCP web host. Before
  // reserving a credit or enqueueing durable work, require its own fresh,
  // release-bound database heartbeat. This prevents a sleeping/offline Mac
  // from leaving a customer with a run that can never start. The retired
  // Claude/plugin worker is not consulted; in development the guard is a
  // deliberate no-op unless explicitly enabled.
  let rustDaemonReady = false;
  try {
    rustDaemonReady = (await getReadyRustAgentDaemon()).ok;
  } catch {
    // The readiness lookup is intentionally fail-closed. A transient shared
    // DB failure must not create a durable run that no local daemon can claim.
    rustDaemonReady = false;
  }
  if (!rustDaemonReady) {
    const historyResult = await fetchHistory(
      session.id,
      content,
      request_id,
      userMessageMetadata,
      { loadHistory: false },
    );
    if (!historyResult.ok) return historyResult.response;
    return withSessionHeader(
      await createImmediateAssistantResponse({
        sessionId: session.id,
        requestId: request_id,
        content: "리서치 엔진을 안전하게 준비 중입니다. 질문은 저장했으며 잠시 후 같은 채팅방에서 다시 시도해 주세요.",
      }),
      session.id,
    );
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
    { loadHistory: false },
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
      document_attachment_count: 0,
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

  // 9. Queue the Rust run through the pinned host contract. The HTTP response
  // only streams persisted run events; the Rust daemon owns research work.
  const runId = randomUUID();
  const rustRunKind = toRustRunKind(effectiveRunKind, effectiveGuruLensKey);
  const rustContext = effectiveRunKind === "idea_generation" || effectiveRunKind === "wide_research"
    ? { kind: "covered_universe" as const, universe: "covered" as const }
    : { kind: "company_ticker_set" as const, tickers: session.defaultTickers };
  let enqueueResult: RustAgentEnqueueResult;
  try {
    const runtime = await getRustAgentRuntime();
    enqueueResult = await runtime.enqueue({
      runId,
      requestId: request_id,
      userId,
      sessionId: session.id,
      userMessageId: historyResult.result.userMessageId,
      runKind: rustRunKind,
      // The web app intentionally uses compact UI locales (`ko` / `en`),
      // while the immutable Rust release manifest routes by BCP-47 locales.
      // Keep the UI contract untouched and adapt only at this boundary.
      locale: toRustResponseLocale(responseLocale),
      question: content,
      context: rustContext,
    });
  } catch (error) {
    const existingAfterFailure = await findExistingRunForRequest(request_id, userId);
    if (existingAfterFailure) {
      return withSessionHeader(streamAgentRunEventsResponse({
        userId,
        sessionId: existingAfterFailure.session_id,
        runId: existingAfterFailure.id,
        requestId: request_id,
      }), session.id);
    }
    const reason = error instanceof RustAgentRuntimeError ? error.code : "agent_v1_enqueue_failed";
    // Keep a bounded, non-sensitive diagnostic visible in the dev server log.
    // Some Next log serializers drop object fields, which otherwise hides the
    // actual failure class while keeping request/session/question data out.
    const errorName = error instanceof Error ? error.name : typeof error;
    const errorCode = readAgentRuntimeErrorCode(error);
    console.warn(
      `[chat/run] agent_v1 enqueue failed: ${reason}; class=${errorName}; cause_code=${errorCode ?? "none"}`,
    );
    await releaseExecutionBudget(userId, request_id, null, reason);
    await releaseAnalysisCreditsShadow(userId, request_id, null, reason);
    return withSessionHeader(
      await createImmediateAssistantResponse({
        sessionId: session.id,
        requestId: request_id,
        content: "리서치 엔진이 잠시 준비되지 않았습니다. 질문은 저장했으며, 잠시 후 같은 채팅방에서 다시 시도해 주세요.",
      }),
      session.id,
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

function readAgentRuntimeErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const direct = Reflect.get(error, "code");
  if (typeof direct === "string" && /^[A-Za-z0-9_:-]{1,128}$/.test(direct)) {
    return direct;
  }
  const cause = Reflect.get(error, "cause");
  if (!cause || typeof cause !== "object") return null;
  const nested = Reflect.get(cause, "code");
  return typeof nested === "string" && /^[A-Za-z0-9_:-]{1,128}$/.test(nested)
    ? nested
    : null;
}

function toRustRunKind(runKind: RunKind, guruLens: string | null): string {
  if (runKind !== "guru_advisor") return runKind;
  const lens = guruLens && guruLens !== "auto" ? guruLens : "buffett";
  return `guru_${lens}`;
}

function toRustResponseLocale(locale: Locale): "ko-KR" | "en-US" {
  return locale === "en" ? "en-US" : "ko-KR";
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
    .is("closed_at", null)
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
    agent_backend: "rust_agent" as const,
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
