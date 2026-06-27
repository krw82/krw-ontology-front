import type { Locale } from "@/i18n/config";
import { resolveClaudeAgentCwd } from "@/lib/agent/claude-agent-cwd";
import { buildClaudeAgentEnv } from "@/lib/agent/env";
import { getClaudeAgentModel } from "@/lib/agent/model";
import type { AnalysisMode, RunKind } from "@/types/api-contracts";

type RouterSource =
  | "preserve"
  | "claude_router"
  | "fallback";

type RouterConfidence = "high" | "medium" | "low";
type RouterDiagnosticCode =
  | "router_disabled"
  | "sdk_exception"
  | "sdk_result_error"
  | "invalid_run_kind"
  | "no_result";

export interface ChatQuestionRouteDiagnostic {
  code: RouterDiagnosticCode;
  message: string;
}

export interface ChatQuestionRouteInput {
  content: string;
  currentAnalysisMode: AnalysisMode;
  currentRunKind: RunKind;
  defaultTickers: string[];
  scopeType: "global" | "company";
  hasUserUrls: boolean;
  responseLocale: Locale;
  sessionId?: string;
}

export interface ChatQuestionRouteDecision {
  analysisMode: AnalysisMode;
  runKind: RunKind;
  source: RouterSource;
  confidence: RouterConfidence;
  reason: string;
  diagnostic?: ChatQuestionRouteDiagnostic;
}

const ROUTER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    run_kind: {
      type: "string",
      enum: [
        "company_research",
        "news_discovery",
        "market_move_research",
        "idea_generation",
        "scenario_sensitivity",
      ],
    },
  },
  required: ["run_kind"],
} as const;

export async function resolveChatQuestionRoute(
  input: ChatQuestionRouteInput,
): Promise<ChatQuestionRouteDecision> {
  const preserved = preserveExplicitRoute(input);
  if (preserved) return preserved;

  if (shouldDisableClaudeRouter()) {
    return fallbackDecision(input, {
      code: "router_disabled",
      message: "KRW_CHAT_ROUTER_MODE disabled Claude router pre-pass.",
    });
  }

  try {
    const routed = await routeWithClaude(input);
    if (routed) return routed;
  } catch (error) {
    return fallbackDecision(input, diagnosticFromError(error));
  }

  return fallbackDecision(input, {
    code: "no_result",
    message: "Claude router stream ended without a result message.",
  });
}

function fallbackDecision(
  input: ChatQuestionRouteInput,
  diagnostic: ChatQuestionRouteDiagnostic,
): ChatQuestionRouteDecision {
  const obvious = obviousFallbackDecision(input, diagnostic);
  if (obvious) return obvious;

  return {
    analysisMode: "company",
    runKind: "company_research",
    source: "fallback",
    confidence: "low",
    reason: "Router was unavailable or did not return a valid run kind.",
    diagnostic,
  };
}

function obviousFallbackDecision(
  input: ChatQuestionRouteInput,
  diagnostic: ChatQuestionRouteDiagnostic,
): ChatQuestionRouteDecision | null {
  if (diagnostic.code === "router_disabled") return null;

  if (hasCompanyContext(input) && isObviousMarketMoveQuestion(input.content)) {
    return {
      analysisMode: "news",
      runKind: "market_move_research",
      source: "fallback",
      confidence: "low",
      reason:
        "Router failed, but the question clearly starts from a current stock-price move.",
      diagnostic,
    };
  }

  if (isObviousNewsQuestion(input.content)) {
    return {
      analysisMode: "news",
      runKind: "news_discovery",
      source: "fallback",
      confidence: "low",
      reason:
        "Router failed, but the question clearly asks for recent market-news context.",
      diagnostic,
    };
  }

  if (isObviousIdeaGenerationQuestion(input.content)) {
    return {
      analysisMode: "company",
      runKind: "idea_generation",
      source: "fallback",
      confidence: "low",
      reason:
        "Router failed, but the question clearly asks to discover candidate companies.",
      diagnostic,
    };
  }

  if (hasCompanyContext(input) && isObviousScenarioQuestion(input.content)) {
    return {
      analysisMode: "company",
      runKind: "scenario_sensitivity",
      source: "fallback",
      confidence: "low",
      reason:
        "Router failed, but the question clearly asks for scenarios or judgment-change conditions.",
      diagnostic,
    };
  }

  return null;
}

function hasCompanyContext(input: ChatQuestionRouteInput): boolean {
  return input.scopeType === "company" || input.defaultTickers.length > 0;
}

function normalizedQuestion(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function includesAny(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

function isObviousMarketMoveQuestion(content: string): boolean {
  const text = normalizedQuestion(content);
  const hasPriceSubject = includesAny(text, [
    "가격",
    "주가",
    "시세",
    "price",
    "stock",
    "share",
    "shares",
  ]);
  const hasMoveIntent = includesAny(text, [
    "오늘",
    "현재",
    "지금",
    "왜이",
    "왜 이",
    "왜",
    "변동",
    "움직",
    "빠졌",
    "빠진",
    "떨어",
    "하락",
    "급락",
    "올랐",
    "오른",
    "상승",
    "급등",
    "반등",
    "조정",
    "시간외",
    "장전",
    "장후",
    "프리마켓",
    "애프터",
    "today",
    "now",
    "current",
    "move",
    "moved",
    "down",
    "fall",
    "falling",
    "drop",
    "rally",
    "up",
    "jump",
    "gain",
    "after hours",
    "premarket",
  ]);

  if (hasPriceSubject && hasMoveIntent) return true;

  return includesAny(text, [
    "왜 빠졌",
    "왜 떨어",
    "왜 하락",
    "왜 급락",
    "왜 올랐",
    "왜 오른",
    "왜 상승",
    "왜 급등",
    "why down",
    "why falling",
    "why did",
    "why are shares",
  ]);
}

function isObviousNewsQuestion(content: string): boolean {
  const text = normalizedQuestion(content);
  const hasNewsIntent = includesAny(text, [
    "뉴스",
    "소식",
    "이슈",
    "보도",
    "기사",
    "최근",
    "오늘",
    "latest",
    "recent news",
    "news",
    "headline",
    "headlines",
  ]);
  const asksForDiscovery = includesAny(text, [
    "뭐",
    "무슨",
    "찾",
    "알려",
    "있었",
    "정리",
    "find",
    "what",
    "show",
  ]);

  return hasNewsIntent && asksForDiscovery;
}

function isObviousIdeaGenerationQuestion(content: string): boolean {
  const text = normalizedQuestion(content);
  return includesAny(text, [
    "종목 찾아",
    "종목 발굴",
    "후보",
    "수혜주",
    "기업 찾아",
    "회사 찾아",
    "스크리닝",
    "screen",
    "find stocks",
    "find companies",
    "candidate",
    "candidates",
  ]);
}

function isObviousScenarioQuestion(content: string): boolean {
  const text = normalizedQuestion(content);
  return includesAny(text, [
    "시나리오",
    "상승 하락",
    "상승·하락",
    "상승/하락",
    "향후전망",
    "향후 전망",
    "앞으로",
    "판단이 바뀌",
    "조건",
    "깨지는",
    "민감도",
    "upside",
    "downside",
    "scenario",
    "scenarios",
    "sensitivity",
    "what would break",
  ]);
}

function preserveExplicitRoute(
  input: ChatQuestionRouteInput,
): ChatQuestionRouteDecision | null {
  if (input.hasUserUrls) {
    return {
      analysisMode: input.currentAnalysisMode,
      runKind: input.currentRunKind,
      source: "preserve",
      confidence: "high",
      reason: "URL workflows are routed before question classification.",
    };
  }

  if (
    input.currentRunKind === "news_discovery" ||
    input.currentRunKind === "market_move_research" ||
    input.currentRunKind === "scenario_sensitivity"
  ) {
    return {
      analysisMode: input.currentAnalysisMode,
      runKind: input.currentRunKind,
      source: "preserve",
      confidence: "high",
      reason: "Run kind is already explicit.",
    };
  }

  return null;
}

function shouldDisableClaudeRouter(): boolean {
  const value = process.env.KRW_CHAT_ROUTER_MODE?.trim().toLowerCase();
  return value === "off" || value === "0" || value === "false";
}

async function routeWithClaude(
  input: ChatQuestionRouteInput,
): Promise<ChatQuestionRouteDecision | null> {
  const { getSessionInfo, query } = await import(
    "@anthropic-ai/claude-agent-sdk"
  );
  const cwd = await resolveClaudeAgentCwd();
  const resumableSession = input.sessionId
    ? await getSessionInfo(input.sessionId, { dir: cwd }).catch(() => undefined)
    : undefined;
  const sdkQuery = query({
    prompt: buildClaudeRouterPrompt(input),
    options: {
      cwd,
      model: getClaudeAgentModel(),
      pathToClaudeCodeExecutable:
        process.env.CLAUDE_CODE_EXECUTABLE || undefined,
      maxTurns: 3,
      permissionMode: "dontAsk",
      allowDangerouslySkipPermissions: false,
      allowedTools: [],
      settingSources: [],
      env: buildClaudeAgentEnv(),
      outputFormat: {
        type: "json_schema",
        schema: ROUTER_SCHEMA,
      },
      ...(resumableSession
        ? {
            resume: input.sessionId,
            forkSession: true,
          }
        : {}),
    },
  });

  for await (const message of sdkQuery) {
    if (message.type !== "result") continue;
    if (message.subtype !== "success") {
      throw new RouterDiagnosticError(
        "sdk_result_error",
        "Claude router returned a non-success result.",
        sdkResultErrorText(message),
      );
    }
    const structured = isRecord(message.structured_output)
      ? message.structured_output
      : parseJsonRecord(message.result);
    const runKind = readRunKind(structured?.run_kind);
    if (!runKind) {
      throw new RouterDiagnosticError(
        "invalid_run_kind",
        "Claude router did not return a valid run_kind.",
        typeof message.result === "string"
          ? message.result.slice(0, 500)
          : JSON.stringify(message.structured_output ?? null).slice(0, 500),
      );
    }
    return {
      analysisMode: analysisModeForRunKind(runKind),
      runKind,
      source: "claude_router",
      confidence: "medium",
      reason: "KRW Ontology router selected the owning workflow.",
    };
  }

  return null;
}

class RouterDiagnosticError extends Error {
  readonly code: RouterDiagnosticCode;
  readonly detail?: string;

  constructor(code: RouterDiagnosticCode, message: string, detail?: string) {
    super(message);
    this.name = "RouterDiagnosticError";
    this.code = code;
    this.detail = detail;
  }
}

function diagnosticFromError(error: unknown): ChatQuestionRouteDiagnostic {
  if (error instanceof RouterDiagnosticError) {
    return {
      code: error.code,
      message: error.detail ? `${error.message} ${error.detail}` : error.message,
    };
  }

  return {
    code: "sdk_exception",
    message: error instanceof Error ? error.message : String(error),
  };
}

function sdkResultErrorText(message: unknown): string | undefined {
  if (!isRecord(message)) return undefined;
  const errors = message.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return errors.map((error) => String(error)).join(" ");
  }
  const result = message.result;
  return typeof result === "string" && result.trim()
    ? result.slice(0, 500)
    : undefined;
}

function buildClaudeRouterPrompt(input: ChatQuestionRouteInput): string {
  return [
    "You are a lightweight KRW Ontology question classifier.",
    "Do not call skills, plugins, MCP tools, web search, files, or shell commands.",
    "Do not research, browse, analyze, resolve tickers, or answer the user.",
    "Classify the user question into exactly one run_kind and return JSON only.",
    "The only valid output shape is {\"run_kind\":\"...\"}.",
    "",
    "Priority rules. Apply the first matching rule:",
    "1. market_move_research: if the question starts from today's/current/recent stock price, price movement, fall/rally, after-hours/premarket move, or asks why the price is like this. This wins even when the same question also asks for 전망, 향후전망, or future view.",
    "2. news_discovery: if the question asks for latest/recent/current news, market-news context, issue/news topic, or what happened recently, and it is not primarily a price-move question.",
    "3. scenario_sensitivity: if the question asks only for forward scenarios, upside/base/downside, sensitivity, future paths, outlook conditions, or what would strengthen/weaken/break a judgment for an already selected company/context.",
    "4. idea_generation: if the question asks to find, screen, discover, or list candidate stocks/companies from conditions, themes, financial filters, or exclusions.",
    "5. company_research: default filing-grounded company research, buy/sell/hold questions without a current price/news move, business model, financials, risk, capital allocation, filings.",
    "",
    "Important KRW Ontology policy:",
    "- Simple share-price move questions should route to market_move_research, unlike generic public-equity routers that exclude share-price questions.",
    "- Mixed price-move + outlook questions still route to market_move_research first. The market-move workflow can offer scenario follow-ups.",
    "- Mixed latest-news + outlook questions route to news_discovery first unless the user explicitly asks for scenarios only.",
    "- Follow-up questions like '앞으로의 시나리오 알려줘', '상승/하락 시나리오를 나눠줘', or '판단이 바뀌는 조건을 알려줘' should route to scenario_sensitivity when the prior/company context is already selected.",
    "- If prior conversation is available through a resumed session, use it only to resolve omitted subjects, corrections, and follow-up intent. Do not answer the user.",
    "- Do not route ordinary company overview or filing questions to market_move_research just because a ticker is present.",
    "- If unsure, use company_research.",
    "",
    "Examples:",
    "- '오늘 가격이 왜이러고 향후전망' => {\"run_kind\":\"market_move_research\"}",
    "- '오늘 왜 빠졌고 앞으로는 어떨까?' => {\"run_kind\":\"market_move_research\"}",
    "- '오늘 왜 올랐어? 향후 전망도 같이' => {\"run_kind\":\"market_move_research\"}",
    "- '최근 뉴스랑 앞으로 전망 알려줘' => {\"run_kind\":\"news_discovery\"}",
    "- '향후 전망만 시나리오로 나눠줘' => {\"run_kind\":\"scenario_sensitivity\"}",
    "- '이 판단이 바뀌는 조건 알려줘' => {\"run_kind\":\"scenario_sensitivity\"}",
    "- '지금 사도 돼?' => {\"run_kind\":\"company_research\"}",
    "",
    "Context:",
    JSON.stringify(
      {
        question: input.content,
        current_analysis_mode: input.currentAnalysisMode,
        current_run_kind: input.currentRunKind,
        default_tickers: input.defaultTickers,
        scope_type: input.scopeType,
        response_locale: input.responseLocale,
      },
      null,
      2,
    ),
  ].join("\n");
}

function analysisModeForRunKind(runKind: RunKind): AnalysisMode {
  return runKind === "news_discovery" ||
    runKind === "market_move_research"
    ? "news"
    : "company";
}

function readRunKind(value: unknown): RunKind | null {
  return value === "company_research" ||
    value === "news_discovery" ||
    value === "market_move_research" ||
    value === "idea_generation" ||
    value === "scenario_sensitivity"
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonRecord(text: unknown): Record<string, unknown> | null {
  if (typeof text !== "string") return null;
  try {
    const parsed = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
