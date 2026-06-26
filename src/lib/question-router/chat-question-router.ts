import type { Locale } from "@/i18n/config";
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
        "news_research",
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
    return fallbackDecision({
      code: "router_disabled",
      message: "KRW_CHAT_ROUTER_MODE disabled Claude router pre-pass.",
    });
  }

  try {
    const routed = await routeWithClaude(input);
    if (routed) return routed;
  } catch (error) {
    return fallbackDecision(diagnosticFromError(error));
  }

  return fallbackDecision({
    code: "no_result",
    message: "Claude router stream ended without a result message.",
  });
}

function fallbackDecision(
  diagnostic: ChatQuestionRouteDiagnostic,
): ChatQuestionRouteDecision {
  return {
    analysisMode: "company",
    runKind: "company_research",
    source: "fallback",
    confidence: "low",
    reason: "Router was unavailable or did not return a valid run kind.",
    diagnostic,
  };
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
    input.currentRunKind === "idea_generation" ||
    input.currentRunKind === "news_discovery" ||
    input.currentRunKind === "news_research" ||
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
  const { query } = await import("@anthropic-ai/claude-agent-sdk");
  const sdkQuery = query({
    prompt: buildClaudeRouterPrompt(input),
    options: {
      cwd: process.cwd(),
      model: getClaudeAgentModel(),
      pathToClaudeCodeExecutable:
        process.env.CLAUDE_CODE_EXECUTABLE || undefined,
      maxTurns: 1,
      permissionMode: "dontAsk",
      allowDangerouslySkipPermissions: false,
      allowedTools: [],
      settingSources: [],
      env: buildClaudeAgentEnv(),
      outputFormat: {
        type: "json_schema",
        schema: ROUTER_SCHEMA,
      },
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
    "Routing policy:",
    "- company_research: default filing-grounded company research, buy/sell/hold questions without a current price/news move, business model, financials, risk, capital allocation, filings.",
    "- market_move_research: asks why a covered stock moved today/recently, why price changed, why it fell/rallied, after-hours/premarket move, whether a current move/news explains the stock reaction.",
    "- news_discovery: user asks to find/select latest market-news events broadly, not analyze a specific selected event.",
    "- news_research: user already selected/provided a specific market narrative or URL event. Do not choose this unless context says the event is already selected.",
    "- idea_generation: user asks to find/screen/discover candidate stocks or companies from conditions, themes, financial filters, or exclusions.",
    "- scenario_sensitivity: user asks for forward scenarios, sensitivity, upside/base/downside cases, what conditions would strengthen/weaken/break the thesis, or future paths for an already selected company/research context.",
    "",
    "Important KRW Ontology policy:",
    "- Simple share-price move questions should route to market_move_research, unlike generic public-equity routers that exclude share-price questions.",
    "- Follow-up questions like '앞으로의 시나리오 알려줘', '상승/하락 시나리오를 나눠줘', or '판단이 바뀌는 조건을 알려줘' should route to scenario_sensitivity when the prior/company context is already selected.",
    "- Do not route ordinary company overview or filing questions to market_move_research just because a ticker is present.",
    "- If unsure, use company_research.",
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
    runKind === "news_research" ||
    runKind === "market_move_research"
    ? "news"
    : "company";
}

function readRunKind(value: unknown): RunKind | null {
  return value === "company_research" ||
    value === "news_discovery" ||
    value === "news_research" ||
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
