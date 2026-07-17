import "server-only";

import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import {
  getSessionInfo,
  query,
  type AgentDefinition,
  type CanUseTool,
  type McpHttpServerConfig,
  type McpServerStatus,
  type Options,
  type PermissionResult,
  type SDKControlGetContextUsageResponse,
  type SdkPluginConfig,
  type SDKMessage,
  type SDKSystemMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  GURU_ADVISOR_SDK_ALLOWED_TOOLS,
  GURU_MCP_TOOLS,
  KRW_ONTOLOGY_DIRECT_SDK_ALLOWED_TOOLS,
  KRW_ONTOLOGY_MCP_TOOLS,
  KRW_ONTOLOGY_SDK_ALLOWED_TOOLS,
  STOCK_NEWS_MCP_TOOLS,
  YAHOO_FINANCE_MCP_TOOLS,
  YAHOO_FINANCE_SDK_ALLOWED_TOOLS,
  CHART_MCP_TOOLS,
  CHART_SDK_ALLOWED_TOOLS,
  KRW_FILINGS_MCP_TOOLS,
  KRW_FILINGS_SDK_ALLOWED_TOOLS,
  getStockNewsSdkAllowedTools,
  getKrwOntologyPluginPath,
  isChartSdkTool,
  isGuruAdvisorSdkTool,
  isKrwFilingsMcpEnabled,
  isKrwFilingsSdkTool,
  filingsMcpToken,
  isKrwOntologySdkTool,
  isStockNewsEnabled,
  isStockNewsSdkTool,
  isYahooFinanceSdkTool,
  resolveGuruAdvisorPluginPath,
} from "./mcp-client";
import { buildClaudeAgentEnv } from "./env";
import { resolveClaudeAgentCwd } from "./claude-agent-cwd";
import {
  buildSystemPrompt,
  type FilingAnchorContext,
  type CompanyPromptContext,
} from "./system-prompt";
import {
  buildGuruLightCompanyContext,
  getIndexedCompanies,
  type IndexedCompanyDocument,
} from "@/lib/ontology/catalog";
import { normalizeKrwOntologyToolInput } from "./tool-input-policy";
import {
  KRW_GURU_ACKMAN_ADVISOR_SKILL,
  KRW_GURU_BUFFETT_ADVISOR_SKILL,
  KRW_GURU_FLATT_ADVISOR_SKILL,
  KRW_GURU_MARKS_ADVISOR_SKILL,
  KRW_GURU_TERRY_SMITH_ADVISOR_SKILL,
  buildResearchPassPrompt,
} from "./workflow";
import { getClaudeAgentModel } from "./model";
import { readIntEnv } from "@/lib/env";
import {
  buildResearchModePrompt,
  getAllowedMcpToolsForResearchMode,
  getResearchModeToolBudget,
  type ResearchMode,
  type ResearchModeToolBudget,
} from "@/lib/research-mode";
import { normalizeAnalysisMode, type AnalysisMode } from "@/lib/analysis-mode";
import { isPreferredMarketNewsUrl } from "@/lib/news-discovery/source-policy";
import {
  defaultRunKindForAnalysisMode,
  normalizeRunKind,
  type RunKind,
} from "@/lib/run-kind";
import type { GuruLensKey } from "@/lib/guru-lenses";
import {
  CHART_MCP_SERVER_NAME,
  createChartMcpServer,
} from "@/lib/charts/create-chart-tool";
import { isChartGenerationEnabled } from "@/lib/features/charts";
import { publicAgentErrorMessage } from "@/lib/api/chat/error-messages";
import { createYahooFinanceNewsMcpServer } from "@/lib/news-discovery/yahoo-finance-mcp-tool";
import { YAHOO_FINANCE_MCP_SERVER_NAME } from "@/lib/news-discovery/yahoo-finance-mcp-constants";
import {
  createAccumulator,
  createSSEWriter,
  addToken,
  startToolCall,
  endToolCall,
  addCitation,
  setUsage,
  type AccumulatedRun,
  type AccumulatedToolCall,
  type StreamWriter,
} from "./stream-handler";
import type {
  DocumentType,
  ChartMCPToolName,
  GuruMCPToolName,
  KrwFilingsMCPToolName,
  KRWOntologyMCPToolName,
  MCPToolName,
  StreamingCitation,
  StockNewsMCPToolName,
  YahooFinanceMCPToolName,
} from "@/types/api-contracts";

const KRW_ONTOLOGY_MCP_TOOL_SET = new Set<string>(KRW_ONTOLOGY_MCP_TOOLS);
const STOCK_NEWS_MCP_TOOL_SET = new Set<string>(STOCK_NEWS_MCP_TOOLS);
const GURU_MCP_TOOL_SET = new Set<string>(GURU_MCP_TOOLS);
const YAHOO_FINANCE_MCP_TOOL_SET = new Set<string>(YAHOO_FINANCE_MCP_TOOLS);
const CHART_MCP_TOOL_SET = new Set<string>(CHART_MCP_TOOLS);
const KRW_FILINGS_MCP_TOOL_SET = new Set<string>(KRW_FILINGS_MCP_TOOLS);
const DEFAULT_MAX_TURNS = 40;
const TOOL_BUDGET_EXCEEDED = "tool_budget_exceeded";
const TOOL_RESULT_MISSING = "tool_result_missing";
const DEFAULT_STOCK_NEWS_MAX_CALLS = 12;
const DEFAULT_YAHOO_FINANCE_MAX_CALLS = 4;
const AGENT_TOOL_NAME = "Agent";
const SUBAGENT_TOOL_NAMES = [AGENT_TOOL_NAME] as const;
const COMPANY_EVIDENCE_SUBAGENT_NAME = "company_evidence_researcher";
const GURU_COMPANY_BRIEF_TOOL_NAME = "krw_guru_company_brief";
const GURU_COMPANY_PACK_TOOL_NAME = "krw_guru_company_pack";
const GURU_REVIEW_COMPANY_EVIDENCE_TOOL_NAME =
  "krw_guru_review_company_evidence";
const RESEARCH_STATE_CONTRACT_VERSION = "research-state/v2";
const DEFAULT_SDK_DIAGNOSTIC_TIMEOUT_MS = 750;
const GURU_INVESTIGATION_BRIEF_FORMAT = "krw-guru-investigation-brief/v1";
const GURU_RESEARCH_PACK_FORMAT = "krw-guru-research-pack/v1";
const GURU_COMPANY_RESEARCH_CONTEXT_FORMAT =
  "krw-guru-company-research-context/v1";
const GURU_COMPANY_EVIDENCE_MCP_TOOLS = new Set<KRWOntologyMCPToolName>([
  "krw_ontology_query_context",
  "krw_ontology_query",
  "krw_ontology_trace",
]);
const GURU_COMPANY_EVIDENCE_SDK_TOOLS =
  KRW_ONTOLOGY_DIRECT_SDK_ALLOWED_TOOLS.filter((toolName) => {
    const normalized = normalizeKrwOntologyToolName(toolName);
    return Boolean(
      normalized && GURU_COMPANY_EVIDENCE_MCP_TOOLS.has(normalized),
    );
  });
const GURU_SOURCE_SUPPORT_TOOL_NAMES = new Set<GuruMCPToolName>([
  "krw_guru_trace",
  "krw_guru_chain",
  "krw_guru_evidence",
]);
const GURU_ADVISOR_DEFAULT_BLOCKED_TOOL_SUFFIXES = [
  GURU_COMPANY_PACK_TOOL_NAME,
  ...GURU_SOURCE_SUPPORT_TOOL_NAMES,
].map((toolName) => `__${toolName}`);
const GURU_ADVISOR_DEFAULT_DISALLOWED_TOOLS =
  GURU_ADVISOR_SDK_ALLOWED_TOOLS.filter((toolName) =>
    GURU_ADVISOR_DEFAULT_BLOCKED_TOOL_SUFFIXES.some((suffix) =>
      toolName.endsWith(suffix),
    ),
  );
const GURU_ADVISOR_DEFAULT_SDK_ALLOWED_TOOLS =
  GURU_ADVISOR_SDK_ALLOWED_TOOLS.filter(
    (toolName) =>
      !GURU_ADVISOR_DEFAULT_BLOCKED_TOOL_SUFFIXES.some((suffix) =>
        toolName.endsWith(suffix),
      ),
  );
const GURU_MAIN_SKILLS = [
  KRW_GURU_BUFFETT_ADVISOR_SKILL,
  KRW_GURU_MARKS_ADVISOR_SKILL,
  KRW_GURU_ACKMAN_ADVISOR_SKILL,
  KRW_GURU_FLATT_ADVISOR_SKILL,
  KRW_GURU_TERRY_SMITH_ADVISOR_SKILL,
] as const;
const DISALLOWED_SDK_TOOLS = [
  "Bash",
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "WebFetch",
  "WebSearch",
  "TodoWrite",
  "Task",
  "Glob",
  "Grep",
  "LS",
  "Skill",
];

export interface AgentRunOptions {
  sessionId: string;
  userMessage: string;
  scopeType: "global" | "company";
  defaultTickers: string[];
  defaultDocumentTypes: string[];
  researchMode?: ResearchMode;
  analysisMode?: AnalysisMode;
  runKind?: RunKind;
  guruLensKey?: GuruLensKey | null;
  responseLocale?: Locale;
  selectedNewsEventContext?: Record<string, unknown> | null;
  /** Source card that opened this chat; constrains on-demand SEC reads. */
  sourceFilingEventId?: string | null;
  history?: Array<{ role: string; content: string }>;
  abortSignal?: AbortSignal;
  onSdkDiagnostics?: (diagnostics: SdkDiagnostics) => Promise<void>;
  onToolCallStart?: (toolCall: AccumulatedToolCall) => Promise<void>;
  onToolCallEnd?: (toolCall: AccumulatedToolCall) => Promise<void>;
  onCitation?: (citation: StreamingCitation) => Promise<void>;
}

export interface AgentRunResult {
  acc: AccumulatedRun;
  status: "completed" | "cancelled" | "failed";
  errorCode?: string;
  errorMessage?: string;
  internalErrorMessage?: string;
}

type UnknownRecord = Record<string, unknown>;
type GuruInvestigationBriefRecord = UnknownRecord & {
  format: typeof GURU_INVESTIGATION_BRIEF_FORMAT;
  brief_hash: string;
  ticker: string;
  questions: readonly UnknownRecord[];
};
type GuruCompanyResearchContextRecord = UnknownRecord & {
  format: typeof GURU_COMPANY_RESEARCH_CONTEXT_FORMAT;
  ticker: string;
  brief_hash: string;
  question_ids: readonly string[];
  evidence_units: readonly UnknownRecord[];
  source_object_ids: readonly string[];
  research_status: "evidence_found" | "partial";
};

interface ToolResultRecord {
  toolUseId: string | null;
  text: string;
  json: unknown;
}

function buildSdkPlugins(params: {
  guruAdvisorPluginPath: string | null;
  guruAdvisorRun: boolean;
  ontologyPluginPath: string;
}): SdkPluginConfig[] {
  const { guruAdvisorPluginPath, guruAdvisorRun, ontologyPluginPath } = params;
  if (!guruAdvisorRun) {
    return [{ type: "local", path: ontologyPluginPath }];
  }
  if (!guruAdvisorPluginPath) {
    throw new Error("Guru Advisor plugin path is required for guru runs.");
  }
  return [{ type: "local", path: guruAdvisorPluginPath }];
}

export interface SdkDiagnostics {
  passName?: "research";
  requestedModel?: string;
  observedModels?: string[];
  cwd?: string;
  defaultTickers?: string[];
  pluginPath?: string;
  promptPreview?: string;
  permissionMode?: string;
  allowDangerouslySkipPermissions?: boolean;
  scopeType?: "global" | "company";
  settingSources?: string[];
  tools?: unknown;
  allowedTools?: string[];
  disallowedTools?: string[];
  researchMode?: ResearchMode;
  analysisMode?: AnalysisMode;
  runKind?: RunKind;
  responseLocale?: Locale;
  toolBudget?: ResearchModeToolBudget;
  plugins?: unknown;
  mcpServers?: unknown;
  slashCommands?: Array<{ name: string; description?: string }>;
  systemInit?: {
    sessionId: string;
    model: string;
    claudeCodeVersion: string;
    permissionMode: string;
    tools: string[];
    mcpServers: Array<{ name: string; status: string }>;
    skills: string[];
    plugins: string[];
  };
  mcpServerStatus?: Array<{
    name: string;
    status: string;
    serverInfo?: { name: string; version: string };
    scope?: string;
    tools?: string[];
    error?: string;
  }>;
  contextUsageSampled?: boolean;
  contextUsage?: ReturnType<typeof summarizeContextUsage>;
  contextUsageError?: string;
  mcpStatusError?: string;
  observedAt: string;
}

export async function runAgent(
  options: AgentRunOptions,
  streamWriter: StreamWriter,
): Promise<AgentRunResult> {
  const { sendEvent } = createSSEWriter(streamWriter);
  const acc = createAccumulator();
  const cwd = await resolveClaudeAgentCwd();
  const abortController = new AbortController();
  // Research requests always receive the deep research contract.  The UI's
  // generic selection must not weaken the evidence-gathering workflow.
  const researchMode: ResearchMode = "deep";
  const runKind = normalizeRunKind(
    options.runKind ??
      defaultRunKindForAnalysisMode(
        normalizeAnalysisMode(options.analysisMode),
      ),
  );
  const guruAdvisorRun = runKind === "guru_advisor";
  const guruAgentGeneratedBriefEnabled =
    guruAdvisorRun && isGuruAgentGeneratedBriefEnabled();
  const requiredGuruCompanyTicker = selectedGuruCompanyTicker(
    options,
    runKind,
  );
  const ontologyPluginPath = getKrwOntologyPluginPath();
  const guruAdvisorPluginPath = guruAdvisorRun
    ? await resolveGuruAdvisorPluginPath()
    : null;
  const pluginPath = guruAdvisorPluginPath ?? ontologyPluginPath;
  const plugins = buildSdkPlugins({
    guruAdvisorPluginPath,
    guruAdvisorRun,
    ontologyPluginPath,
  });
  const analysisMode = analysisModeForRunKind(
    runKind,
    normalizeAnalysisMode(options.analysisMode),
  );
  const responseLocale = options.responseLocale ?? DEFAULT_LOCALE;
  const stockNewsRun = isStockNewsRunKind(runKind);
  const stockNewsEnabledForRun = stockNewsRun && isStockNewsEnabled();
  const yahooFinanceRun = isYahooFinanceRunKind(runKind);
  const chartGenerationEnabled = !guruAdvisorRun && isChartGenerationEnabled();
  const hasSourceFilingContext = Boolean(options.sourceFilingEventId);
  const toolBudget = getResearchModeToolBudget(researchMode);
  const abortHandler = () => abortController.abort();
  options.abortSignal?.addEventListener("abort", abortHandler, { once: true });
  if (options.abortSignal?.aborted) {
    options.abortSignal.removeEventListener("abort", abortHandler);
    return { acc, status: "cancelled" };
  }
  if (hasSourceFilingContext && !isKrwFilingsMcpEnabled()) {
    return {
      acc,
      status: "failed",
      errorCode: "mcp_unavailable",
      errorMessage: "공시 원문 조회 서비스를 연결하지 못했습니다. 잠시 후 다시 시도해주세요.",
      internalErrorMessage: "Source filing context requires FILINGS_MCP_ENABLED=1 and a filings MCP auth token.",
    };
  }

  const promptContext = {
    scopeType: options.scopeType,
    defaultTickers: options.defaultTickers,
    defaultDocumentTypes: options.defaultDocumentTypes,
    sourceFilingEventId: options.sourceFilingEventId ?? null,
    companies: await getCompanyPromptContexts(options.defaultTickers),
  };
  const sdkSession = await getSessionInfo(options.sessionId, {
    dir: cwd,
  }).catch(() => undefined);
  const shouldResume = Boolean(sdkSession);
  const systemPrompt = buildSystemPrompt(
    promptContext,
    shouldResume ? [] : (options.history ?? []),
    {
      stockNewsEnabled: stockNewsEnabledForRun,
      stockNewsRequired: stockNewsRun && stockNewsEnabledForRun,
      stockNewsUnavailableForNews: stockNewsRun && !stockNewsEnabledForRun,
      yahooFinanceNewsEnabled: yahooFinanceRun,
      yahooFinanceNewsRequired: yahooFinanceRun,
      chartGenerationEnabled,
      guruAdvisorMode: guruAdvisorRun,
      guruAgentGeneratedBriefEnabled,
      filingSourceActive: hasSourceFilingContext,
      responseLocale,
    },
  );
  const researchPrompt = [
    buildResearchPassPrompt(
      options.userMessage,
      analysisMode,
      runKind,
      responseLocale,
      options.guruLensKey,
    ),
    buildResearchModePrompt(researchMode),
    buildSelectedNewsEventContextPrompt(
      runKind,
      options.selectedNewsEventContext,
    ),
  ].join("\n\n");
  const allowedTools = allowedSdkToolsForResearchMode(
    researchMode,
    analysisMode,
    runKind,
    chartGenerationEnabled,
    hasSourceFilingContext,
  );

  const requestedModel = getClaudeAgentModel();
  let strictHttpMcpServers: Record<string, McpHttpServerConfig> | undefined;
  try {
    strictHttpMcpServers = guruAdvisorRun
      ? undefined
      : readStrictHttpMcpServerConfigs(ontologyPluginPath, {
          requireFilingsMcp: hasSourceFilingContext,
        });
  } catch (error) {
    options.abortSignal?.removeEventListener("abort", abortHandler);
    const rawErrorMessage =
      error instanceof Error ? error.message : "Invalid MCP HTTP configuration";
    return {
      acc,
      status: "failed",
      errorCode: "mcp_unavailable",
      errorMessage:
        "온톨로지 검색 서비스 설정을 확인할 수 없습니다. 잠시 후 다시 시도해주세요.",
      internalErrorMessage: rawErrorMessage,
    };
  }
  const baseSdkOptions: Options = {
    cwd,
    model: requestedModel,
    pathToClaudeCodeExecutable: process.env.CLAUDE_CODE_EXECUTABLE || undefined,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: systemPrompt,
    },
    plugins,
    ...(strictHttpMcpServers
      ? {
          mcpServers: strictHttpMcpServers,
          strictMcpConfig: true,
        }
      : {}),
    allowedTools,
    ...(guruAdvisorRun
      ? {
          disallowedTools: GURU_ADVISOR_DEFAULT_DISALLOWED_TOOLS,
          tools: allowedTools,
        }
      : {
          tools: [],
          disallowedTools: DISALLOWED_SDK_TOOLS,
        }),
    permissionMode: "dontAsk",
    allowDangerouslySkipPermissions: false,
    canUseTool,
    settingSources: [],
    maxTurns: readIntEnv("CLAUDE_AGENT_MAX_TURNS", DEFAULT_MAX_TURNS, {
      min: 1,
    }),
    ...(guruAdvisorRun
      ? {
          agents: buildGuruAdvisorSubagents(
            ontologyPluginPath,
            guruAgentGeneratedBriefEnabled,
          ),
          agentProgressSummaries: false,
          forwardSubagentText: false,
          skills: GURU_MAIN_SKILLS.map((skill) => skill.replace(/^\//, "")),
        }
      : {}),
    includePartialMessages: false,
    abortController,
    env: buildClaudeAgentEnv(),
  };
  const observedModels = new Set<string>();

  try {
    await sendEvent("activity_update", {
      stage: "connecting",
      label: "자료 연결 확인 중",
    });
    const researchResult = await runSdkPass({
      passName: "research",
      prompt: researchPrompt,
      sdkOptions: {
        ...baseSdkOptions,
        ...(shouldResume
          ? { resume: options.sessionId }
          : { sessionId: options.sessionId }),
      },
      options,
      requestedModel,
      cwd,
      pluginPath,
      sendEvent,
      observedModels,
      researchMode,
      analysisMode,
      runKind,
      responseLocale,
      toolBudget,
      guruAgentGeneratedBriefEnabled,
      requiredGuruCompanyTicker,
    });

    if (researchResult.status !== "completed") {
      return researchResult;
    }

    if (!researchResult.acc.fullText.trim()) {
      return {
        acc: researchResult.acc,
        status: "failed",
        errorCode: "claude_api_error",
        errorMessage: "리서치 단계에서 화면에 표시할 답변을 받지 못했습니다.",
        internalErrorMessage:
          "Research pass completed without a displayable answer.",
      };
    }

    return researchResult;
  } catch (err) {
    if (options.abortSignal?.aborted || abortController.signal.aborted) {
      return { acc, status: "cancelled" };
    }

    const rawErrorMessage =
      err instanceof Error ? err.message : "Unknown KRW-AI Agent SDK error";
    const errorCode = errorCodeFromMessage(rawErrorMessage);
    return {
      acc,
      status: "failed",
      errorCode,
      errorMessage: userFacingErrorMessage(errorCode, rawErrorMessage),
      internalErrorMessage: rawErrorMessage,
    };
  } finally {
    options.abortSignal?.removeEventListener("abort", abortHandler);
  }
}

function isGuruAgentGeneratedBriefEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  // This is the standard Guru Advisor workflow, not a user-selectable mode.
  // Keep an explicit false value only as an operational rollback switch.
  return !["0", "false", "no", "off"].includes(
    env.GURU_AGENT_GENERATED_BRIEF_ENABLED?.trim().toLowerCase() ?? "",
  );
}

/**
 * A selected single-company web session is an explicit company request even
 * when a short follow-up question does not repeat the ticker.  This keeps the
 * route flexible for global and multi-company research while preventing a
 * company Guru session from silently falling back to market generalities.
 */
function selectedGuruCompanyTicker(
  options: AgentRunOptions,
  runKind: RunKind,
): string | null {
  if (runKind !== "guru_advisor" || options.scopeType !== "company") {
    return null;
  }

  const tickers = Array.from(
    new Set(
      options.defaultTickers
        .map((ticker) => ticker.trim().toUpperCase())
        .filter(Boolean),
    ),
  );

  return tickers.length === 1 ? tickers[0] ?? null : null;
}

async function runSdkPass(params: {
  passName: "research";
  prompt: string;
  sdkOptions: Options;
  options: AgentRunOptions;
  requestedModel: string;
  cwd: string;
  pluginPath: string;
  sendEvent: ReturnType<typeof createSSEWriter>["sendEvent"];
  observedModels: Set<string>;
  researchMode: ResearchMode;
  analysisMode: AnalysisMode;
  runKind: RunKind;
  responseLocale: Locale;
  toolBudget: ResearchModeToolBudget;
  guruAgentGeneratedBriefEnabled: boolean;
  requiredGuruCompanyTicker: string | null;
}): Promise<AgentRunResult> {
  const {
    passName,
    prompt,
    sdkOptions,
    options,
    requestedModel,
    cwd,
    pluginPath,
    sendEvent,
    observedModels,
    researchMode,
    analysisMode,
    runKind,
    responseLocale,
    toolBudget,
    guruAgentGeneratedBriefEnabled,
    requiredGuruCompanyTicker,
  } = params;
  const acc = createAccumulator();
  const openToolCalls = new Set<string>();
  let finalResult: AgentRunResult | null = null;
  let systemInit: SDKSystemMessage | null = null;
  let postResultDiagnosticsStarted = false;
  const maxToolCalls = Math.min(
    readIntEnv("AGENT_MAX_TOOL_CALLS", toolBudget.maxToolCalls, { min: 1 }),
    toolBudget.maxToolCalls,
  );
  const maxStockNewsCalls = readIntEnv(
    "STOCK_NEWS_MAX_CALLS",
    DEFAULT_STOCK_NEWS_MAX_CALLS,
    { min: 1 },
  );
  const maxYahooFinanceCalls = readIntEnv(
    "YAHOO_FINANCE_MAX_CALLS",
    DEFAULT_YAHOO_FINANCE_MAX_CALLS,
    { min: 1 },
  );
  const allowedStockNewsSourceUrls = extractAllowedStockNewsSourceUrls(
    options.selectedNewsEventContext,
  );
  const chartGenerationEnabled = isChartGenerationEnabled();

  try {
    const passCanUseTool = createToolPermissionGuard(
      acc,
      researchMode,
      analysisMode,
      runKind,
      maxToolCalls,
      maxStockNewsCalls,
      maxYahooFinanceCalls,
      allowedStockNewsSourceUrls,
      chartGenerationEnabled,
      guruAgentGeneratedBriefEnabled,
      requiredGuruCompanyTicker,
      options.sourceFilingEventId ?? null,
    );
    const mcpServers = {
      ...(sdkOptions.mcpServers ?? {}),
      ...(isYahooFinanceRunKind(runKind)
        ? {
            [YAHOO_FINANCE_MCP_SERVER_NAME]: createYahooFinanceNewsMcpServer(),
          }
        : {}),
      ...(chartGenerationEnabled
        ? {
            [CHART_MCP_SERVER_NAME]: createChartMcpServer(acc),
          }
        : {}),
    };
    const passSdkOptions: Options = {
      ...sdkOptions,
      hooks:
        runKind === "guru_advisor"
          ? buildGuruAdvisorToolBoundaryHooks(
              pluginPath,
              acc,
              guruAgentGeneratedBriefEnabled,
              requiredGuruCompanyTicker,
            )
          : buildResearchToolBoundaryHooks(passCanUseTool),
      canUseTool: passCanUseTool,
      ...(Object.keys(mcpServers).length > 0 ? { mcpServers } : {}),
    };
    const sdkQuery = query({
      prompt,
      options: passSdkOptions,
    });

    for await (const message of sdkQuery) {
      if (options.abortSignal?.aborted) {
        return { acc, status: "cancelled" };
      }

      if (message.type === "system" && message.subtype === "init") {
        systemInit = message;
        assertKrwOntologySystemInit(message, runKind);
      }

      const observedModel = modelFromSdkMessage(message);
      if (observedModel && !observedModels.has(observedModel)) {
        observedModels.add(observedModel);
      }

      await consumeSdkMessage({
        message,
        acc,
        openToolCalls,
        sendEvent,
        onToolCallStart: options.onToolCallStart,
        onToolCallEnd: options.onToolCallEnd,
        onCitation: options.onCitation,
        sourceFilingEventId: options.sourceFilingEventId ?? null,
        passName,
      });

      if (message.type === "result") {
        if (!postResultDiagnosticsStarted) {
          postResultDiagnosticsStarted = true;
          void reportSdkDiagnosticsAfterResult({
            passName,
            sdkQuery,
            options,
            requestedModel,
            cwd,
            pluginPath,
            prompt,
            sdkOptions: passSdkOptions,
            researchMode,
            analysisMode,
            runKind,
            responseLocale,
            toolBudget,
            observedModels,
            systemInit,
          }).catch((error) => {
            console.warn("[claude-agent-sdk:diagnostics-failed]", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
        }

        if (openToolCalls.size > 0) {
          finalResult = pendingToolResultsFailure(acc, openToolCalls);
          break;
        }

        if (message.subtype === "success") {
          const resultText =
            typeof message.result === "string" ? message.result : "";
          acc.structuredOutput = message.structured_output ?? null;
          if (!acc.fullText.trim() && resultText.trim()) {
            addToken(acc, resultText);
          }
          const usage = usageFromSdkMessage(message);
          setUsage(
            acc,
            usage.inputTokens,
            usage.outputTokens,
            usage.cacheHitInputTokens,
            usage.cacheMissInputTokens,
          );
          finalResult = guruAdvisorCompletionResult(
            acc,
            runKind,
            guruAgentGeneratedBriefEnabled,
            requiredGuruCompanyTicker,
            responseLocale,
          );
        } else {
          const rawErrorMessage =
            Array.isArray(message.errors) && message.errors.length > 0
              ? message.errors.join("\n")
              : "KRW-AI Agent SDK execution failed";
          const errorCode = errorCodeFromMessage(rawErrorMessage);
          if (errorCode === TOOL_BUDGET_EXCEEDED && acc.fullText.trim()) {
            const usage = usageFromSdkMessage(message);
            setUsage(
              acc,
              usage.inputTokens,
              usage.outputTokens,
              usage.cacheHitInputTokens,
              usage.cacheMissInputTokens,
            );
            finalResult = guruAdvisorCompletionResult(
              acc,
              runKind,
              guruAgentGeneratedBriefEnabled,
              requiredGuruCompanyTicker,
              responseLocale,
            );
          } else {
            finalResult = {
              acc,
              status: "failed",
              errorCode,
              errorMessage: userFacingErrorMessage(errorCode, rawErrorMessage),
              internalErrorMessage: rawErrorMessage,
            };
          }
        }
      }
    }

    if (!finalResult && openToolCalls.size > 0) {
      return pendingToolResultsFailure(acc, openToolCalls);
    }

    return finalResult ?? { acc, status: "completed" };
  } catch (err) {
    if (options.abortSignal?.aborted) {
      return { acc, status: "cancelled" };
    }

    const rawErrorMessage =
      err instanceof Error ? err.message : "Unknown KRW-AI Agent SDK error";
    const errorCode = errorCodeFromMessage(rawErrorMessage);
    return {
      acc,
      status: "failed",
      errorCode,
      errorMessage: userFacingErrorMessage(errorCode, rawErrorMessage),
      internalErrorMessage: rawErrorMessage,
    };
  }
}

async function reportSdkDiagnosticsAfterResult(params: {
  passName: "research";
  sdkQuery: ReturnType<typeof query>;
  options: AgentRunOptions;
  requestedModel: string;
  cwd: string;
  pluginPath: string;
  prompt: string;
  sdkOptions: Options;
  researchMode: ResearchMode;
  analysisMode: AnalysisMode;
  runKind: RunKind;
  responseLocale: Locale;
  toolBudget: ResearchModeToolBudget;
  observedModels: Set<string>;
  systemInit: SDKSystemMessage | null;
}) {
  const {
    passName,
    sdkQuery,
    options,
    requestedModel,
    cwd,
    pluginPath,
    prompt,
    sdkOptions,
    researchMode,
    analysisMode,
    runKind,
    responseLocale,
    toolBudget,
    observedModels,
    systemInit,
  } = params;

  if (!options.onSdkDiagnostics) return;

  const diagnostics: SdkDiagnostics = {
    passName,
    requestedModel,
    observedModels: Array.from(observedModels),
    cwd,
    defaultTickers: options.defaultTickers,
    pluginPath,
    promptPreview: prompt.slice(0, 500),
    permissionMode: sdkOptions.permissionMode,
    allowDangerouslySkipPermissions: sdkOptions.allowDangerouslySkipPermissions,
    scopeType: options.scopeType,
    settingSources: sdkOptions.settingSources,
    tools: sdkOptions.tools,
    allowedTools: sdkOptions.allowedTools,
    disallowedTools: sdkOptions.disallowedTools,
    researchMode,
    analysisMode,
    runKind,
    responseLocale,
    toolBudget,
    plugins: summarizeConfiguredPlugins(sdkOptions.plugins),
    mcpServers: summarizeConfiguredMcpServers(sdkOptions.mcpServers),
    ...(systemInit
      ? {
          slashCommands: systemInit.slash_commands.map((name) => ({ name })),
          systemInit: summarizeSystemInit(systemInit),
        }
      : {}),
    observedAt: new Date().toISOString(),
  };

  const sampleContextUsage = shouldSampleContextUsage(
    systemInit?.session_id ?? options.sessionId,
  );
  diagnostics.contextUsageSampled = sampleContextUsage;
  const diagnosticTimeoutMs = readIntEnv(
    "CLAUDE_SDK_DIAGNOSTIC_TIMEOUT_MS",
    DEFAULT_SDK_DIAGNOSTIC_TIMEOUT_MS,
    { min: 10, max: 5_000 },
  );
  const [mcpStatusResult, contextUsageResult] = await Promise.allSettled([
    withSdkDiagnosticTimeout(
      () => sdkQuery.mcpServerStatus(),
      "mcpServerStatus",
      diagnosticTimeoutMs,
    ),
    sampleContextUsage
      ? withSdkDiagnosticTimeout(
          () => sdkQuery.getContextUsage(),
          "getContextUsage",
          diagnosticTimeoutMs,
        )
      : Promise.resolve<SDKControlGetContextUsageResponse | null>(null),
  ]);

  if (mcpStatusResult.status === "fulfilled") {
    diagnostics.mcpServerStatus = summarizeMcpServerStatus(
      mcpStatusResult.value,
    );
  } else {
    diagnostics.mcpStatusError =
      mcpStatusResult.reason instanceof Error
        ? mcpStatusResult.reason.message
        : String(mcpStatusResult.reason);
  }

  if (contextUsageResult.status === "fulfilled" && contextUsageResult.value) {
    diagnostics.contextUsage = summarizeContextUsage(contextUsageResult.value);
  } else if (contextUsageResult.status === "rejected") {
    diagnostics.contextUsageError =
      contextUsageResult.reason instanceof Error
        ? contextUsageResult.reason.message
        : String(contextUsageResult.reason);
  }

  try {
    await withSdkDiagnosticTimeout(
      () => options.onSdkDiagnostics!(diagnostics),
      "onSdkDiagnostics",
      diagnosticTimeoutMs,
    );
  } catch (error) {
    console.warn("[claude-agent-sdk:diagnostics-write-failed]", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function withSdkDiagnosticTimeout<T>(
  operation: () => Promise<T>,
  label: string,
  timeoutMs: number,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    (timeout as { unref?: () => void }).unref?.();
  });

  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      timeoutPromise,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function summarizeSystemInit(message: SDKSystemMessage) {
  return {
    sessionId: message.session_id,
    model: message.model,
    claudeCodeVersion: message.claude_code_version,
    permissionMode: message.permissionMode,
    tools: [...message.tools],
    mcpServers: message.mcp_servers.map((server) => ({
      name: server.name,
      status: server.status,
    })),
    skills: [...message.skills],
    plugins: message.plugins.map((plugin) => plugin.name),
  };
}

function assertKrwOntologySystemInit(
  message: SDKSystemMessage,
  runKind: RunKind,
): void {
  if (runKind === "guru_advisor" || runKind === "news_discovery") return;
  const ontologyTools = message.tools
    .map(normalizeKrwOntologyToolName)
    .filter(
      (toolName): toolName is KRWOntologyMCPToolName => toolName !== null,
    );
  const ontologyToolSet = new Set(ontologyTools);
  const hasExactTools =
    ontologyToolSet.size === KRW_ONTOLOGY_MCP_TOOLS.length &&
    KRW_ONTOLOGY_MCP_TOOLS.every((toolName) => ontologyToolSet.has(toolName));
  const ontologyServer = message.mcp_servers.find(
    (server) => server.name === "krw-ontology",
  );
  if (!hasExactTools || ontologyServer?.status !== "connected") {
    throw new Error(
      `MCP tool parity mismatch in system/init: expected ${KRW_ONTOLOGY_MCP_TOOLS.length} exact ontology tools from a connected krw-ontology server`,
    );
  }
}

function summarizeConfiguredPlugins(plugins: Options["plugins"]) {
  return plugins?.map((plugin) => ({
    type: plugin.type,
    name: path.basename(plugin.path),
  }));
}

function summarizeConfiguredMcpServers(mcpServers: Options["mcpServers"]) {
  if (!mcpServers) return undefined;
  return Object.fromEntries(
    Object.entries(mcpServers).map(([name, config]) => [
      name,
      {
        type: "type" in config ? config.type : "stdio",
      },
    ]),
  );
}

function summarizeMcpServerStatus(statuses: McpServerStatus[]) {
  return statuses.map((status) => ({
    name: status.name,
    status: status.status,
    ...(status.serverInfo ? { serverInfo: status.serverInfo } : {}),
    ...(status.scope ? { scope: status.scope } : {}),
    ...(status.tools ? { tools: status.tools.map((tool) => tool.name) } : {}),
    ...(status.error ? { error: status.error.slice(0, 500) } : {}),
  }));
}

function summarizeContextUsage(usage: SDKControlGetContextUsageResponse) {
  return {
    totalTokens: usage.totalTokens,
    maxTokens: usage.maxTokens,
    percentage: usage.percentage,
    model: usage.model,
    categories: usage.categories.map((category) => ({
      name: category.name,
      tokens: category.tokens,
      ...(category.isDeferred !== undefined
        ? { isDeferred: category.isDeferred }
        : {}),
    })),
    mcpTools: usage.mcpTools.map((tool) => ({
      name: tool.name,
      serverName: tool.serverName,
      tokens: tool.tokens,
      ...(tool.isLoaded !== undefined ? { isLoaded: tool.isLoaded } : {}),
    })),
    systemPromptSections: usage.systemPromptSections?.map((section) => ({
      name: section.name,
      tokens: section.tokens,
    })),
    skills: usage.skills
      ? {
          totalSkills: usage.skills.totalSkills,
          includedSkills: usage.skills.includedSkills,
          tokens: usage.skills.tokens,
        }
      : undefined,
    messageBreakdown: usage.messageBreakdown,
    apiUsage: usage.apiUsage,
  };
}

function shouldSampleContextUsage(seed: string): boolean {
  const configured = Number(
    process.env.CLAUDE_SDK_CONTEXT_USAGE_SAMPLE_RATE ?? "0.1",
  );
  const sampleRate = Number.isFinite(configured)
    ? Math.min(1, Math.max(0, configured))
    : 0.1;
  if (sampleRate <= 0) return false;
  if (sampleRate >= 1) return true;

  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x1_0000_0000 < sampleRate;
}

function validateHttpMcpServerConfig(
  serverName: string,
  value: unknown,
): McpHttpServerConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`MCP server ${serverName} must be an HTTP object config`);
  }
  const config = value as Record<string, unknown>;
  if (config.type !== "http" || typeof config.url !== "string") {
    throw new Error(
      `MCP server ${serverName} must use an explicit type=http URL config`,
    );
  }
  const url = new URL(config.url);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`MCP server ${serverName} URL must use http or https`);
  }
  if (url.username || url.password) {
    throw new Error(
      `MCP server ${serverName} URL must not contain credentials`,
    );
  }
  if (url.pathname.replace(/\/+$/, "") !== "/mcp") {
    throw new Error(`MCP server ${serverName} URL must end at /mcp`);
  }
  return value as McpHttpServerConfig;
}

function readStrictHttpMcpServerConfigs(
  pluginPath: string,
  options: { requireFilingsMcp?: boolean } = {},
): Record<string, McpHttpServerConfig> {
  const mcpConfigPath = path.join(pluginPath, ".mcp.json");
  const parsed = JSON.parse(readFileSync(mcpConfigPath, "utf8")) as {
    mcpServers?: Record<string, unknown>;
  };
  const rawServers = parsed.mcpServers;
  if (!rawServers || !rawServers["krw-ontology"]) {
    throw new Error("KRW Ontology plugin is missing mcpServers.krw-ontology");
  }
  if (options.requireFilingsMcp && !isKrwFilingsMcpEnabled()) {
    throw new Error("On-demand filings MCP requires FILINGS_MCP_ENABLED=1 and a filings MCP auth token");
  }
  if (options.requireFilingsMcp && !rawServers["krw-filings"]) {
    throw new Error("KRW Ontology plugin is missing mcpServers.krw-filings");
  }

  const serverConfigs = Object.fromEntries(
    Object.entries(rawServers)
      .filter(([serverName]) => serverName !== "krw-filings" || options.requireFilingsMcp)
      .map(([serverName, rawConfig]) => {
      const config = validateHttpMcpServerConfig(serverName, rawConfig);
      const overriddenUrl =
        serverName === "krw-ontology"
          ? process.env.KRW_ONTOLOGY_MCP_URL
          : serverName === "stock-news"
            ? process.env.STOCK_NEWS_MCP_URL
            : serverName === "krw-filings"
              ? process.env.KRW_FILINGS_MCP_URL
            : undefined;
      const runtimeHeaders = serverName === "krw-filings"
        ? {
            ...((config as { headers?: Record<string, string> }).headers ?? {}),
            Authorization: `Bearer ${filingsMcpToken() ?? ""}`,
          }
        : undefined;
      return [
        serverName,
        overriddenUrl || runtimeHeaders
          ? validateHttpMcpServerConfig(serverName, {
              ...config,
              ...(overriddenUrl ? { url: overriddenUrl } : {}),
              ...(runtimeHeaders ? { headers: runtimeHeaders } : {}),
            })
          : config,
      ];
      }),
  );

  return serverConfigs;
}

function readKrwOntologyMcpServerConfig(
  ontologyPluginPath: string,
): McpHttpServerConfig {
  return readStrictHttpMcpServerConfigs(ontologyPluginPath)["krw-ontology"];
}

function buildCompanyEvidenceMcpServers(
  ontologyPluginPath: string,
): AgentDefinition["mcpServers"] {
  const serverConfig = readKrwOntologyMcpServerConfig(ontologyPluginPath);
  return [{ "krw-ontology": serverConfig }];
}

function buildGuruAdvisorSubagents(
  ontologyPluginPath: string,
  agentGeneratedBriefEnabled: boolean,
): Record<string, AgentDefinition> {
  return {
    [COMPANY_EVIDENCE_SUBAGENT_NAME]: {
      description:
        "Use for company-specific filing evidence needed by the KRW Guru Advisor before the final guru-style answer.",
      prompt: [
        "You are the KRW Ontology company evidence researcher for a Guru Advisor parent run.",
        "Your only job is to answer the parent Guru run's company-specific evidence questions from filings. Do not write the final user answer and do not imitate any guru voice.",
        "Use only the read-only KRW Ontology MCP tools attached to this subagent. Do not use Guru Advisor tools, current-news tools, chart tools, WebSearch, WebFetch, or filesystem tools.",
        "Work English-first internally when forming retrieval queries. Final payload may be compact English unless the parent explicitly asks for Korean labels.",
        agentGeneratedBriefEnabled
          ? "The parent provides an exact sealed krw-guru-investigation-brief/v1 with one philosophy-shaped key question. Treat it as the highest-priority evidence contract. Answer only its question_id; do not replace it with a general company report, new thesis, or Guru interpretation."
          : "The parent may provide dynamic_question_plan from krw_guru_company_brief. Treat that plan as the highest-priority evidence contract. Answer the listed questions first; do not replace them with a general company research summary.",
        agentGeneratedBriefEnabled
          ? "Do not return a retrieval plan as the answer. Before the first filing call, compile a complete SearchPlan v2 from the requested ticker and the one sealed key question, then call krw_ontology_query_context with only {search_plan}. Never send legacy question, ticker, tickers, limit, or response-detail arguments directly to query_context."
          : "Do not return a retrieval plan as the answer. Before the first filing call, author a complete SearchPlan v2 from the requested ticker and every dynamic question, then call krw_ontology_query_context with only {search_plan}. Never send legacy question, ticker, tickers, limit, or response-detail arguments directly to query_context.",
        agentGeneratedBriefEnabled
          ? "Expand the one sealed key question into one to three complementary atomic filing tests, not extra investigation questions or a generic checklist. Each test must be independently verifiable and collectively answer the same central tension. A metric clause uses the exact plural field metrics, for example {retrieval_query:'revenue iPhone', required_concepts:[], required_predicates:[], metrics:['revenue'], metric_dimensions:['iPhone'], metric_scope:'dimensioned', object_types:['MetricObservation']}; never use metric, and never mix a metric clause with qualitative concepts or predicates. A qualitative clause uses metrics:[] and metric_dimensions:[], with at most two exact required_concepts plus one required_predicate. Omit calculation_window unless the clause declares metrics."
          : "Use one independently verifiable clause per qualitative proposition or exact metric need. Write concise English filing-language retrieval_query values; use required_concepts plus required_predicates for multi-concept relations; split metric and qualitative propositions; set metric scope, dimensions, comparison axes, and calculation_window when the question requires exact arithmetic.",
        "In SearchPlan metrics, use canonical metric names such as revenue, gross_margin, operating_margin, or operating_cash_flow in the metrics array. Put Services, iPhone, Products, or other business labels in metric_dimensions, not in metric names. Every required concept, predicate, and metric dimension must appear literally in retrieval_query.",
        "If krw_ontology_query_context returns JSON with status=input_correction_required, read code, invalid_fields, and required_change. Correct only those fields and make the next allowed filing call in this same subagent run. Do not retry unchanged input, switch to a legacy envelope, or invent a semantic repair from the error message.",
        "Read ResearchState v2 answerability, clause_coverage, evidence_units, calculation_coverage, missing_parts, and recommended_actions. Use targeted query or trace only when that state identifies a material unresolved part; do not mistake related evidence or incomplete calculation coverage for direct proof.",
        agentGeneratedBriefEnabled
          ? "Keep the sealed key question's exact question_id and select only exact ontology object ids returned by the filing tools. The key question may remain unresolved when filings do not support it. Use at most eight unique object ids across the whole run."
          : "For each dynamic question, keep its exact question_id and select only exact ontology object ids returned by the filing tools. Use one to three narrow atomic SearchPlan clauses per question and no more than twelve clauses overall. Use no more than eight unique object ids across the whole run.",
        "The only allowed filing tools are krw_ontology_query_context, krw_ontology_query, and krw_ontology_trace. Never call verify_evidence, company_context, catalog, topic_map, retrieve, chain, compare, quality, or index_context. After one valid query_context result, use at most two targeted compact query calls and one trace call only for material gaps, then return. If a call-limit denial occurs, do not retry that tool. A broad company report is a workflow failure.",
        "Prefer ResearchClaim, EvidenceQuote, SourceSpan, or MetricObservation object ids when a direct company fact or exact figure matters. Use semantic objects such as BusinessFactor only for qualitative interpretation, not as support for an exact number.",
        "Do not create, verify, or return an evidence pack. The runtime derives the immutable company research context only from actual ResearchState v2 filing-tool results. Your final return may be a compact factual summary of what those results establish, what they leave open, and the exact object ids you used; it is not the final investor opinion.",
        "Start company judgments from the latest available 10-Q/current driver returned by the company filing anchor. Use the latest 10-K as annual business mix, historical trend, and risk baseline. Do not invent future periods.",
        "If an older 10-K risk appears resolved or changed in a later 10-Q, make that delta explicit.",
        "This pack is for a Guru consultation, not a normal analyst report. Do not dump tables, period-by-period numeric series, or every metric you find.",
        "Return exact figures, dates, and periods only when they materially change the investor judgment and are supported by the selected filing evidence. Do not invent or infer missing numbers.",
        "Prefer concise business facts over raw numbers: what strengthened the parent question, what weakened it, what remains mixed, and what condition would change the judgment.",
        "Do not upgrade directness or evidence grade in your return. Keep a distinction between filing facts, interpretation, and unresolved questions.",
        agentGeneratedBriefEnabled
          ? "Do not add a new thesis outside the sealed investigation brief. A filing result that weakens or leaves a question unresolved is still a valid result."
          : "Do not add a new thesis outside the dynamic_question_plan unless the filing evidence directly contradicts the plan or reveals a material current-driver change.",
        "Never mention tool budgets, failed retrieval attempts, MCP access, session limitations, or process limitations in the returned research summary. Return investor-usable filing facts only.",
        "If the filing tools return no useful evidence, return a short unresolved note to the parent. Do not substitute a process note, access-control request, or next-step plan.",
        agentGeneratedBriefEnabled
          ? "If no sealed investigation brief is present, do not invent one. Return a short unresolved status to the parent so it can request a valid sealed brief."
          : "If no dynamic_question_plan is present, do not invent one. Return a short unresolved status to the parent so it can request a proper Guru company brief.",
        "Do not expose tool names, MCP names, raw ids, internal file paths, or provider/debug labels.",
      ].join("\n"),
      tools: [...GURU_COMPANY_EVIDENCE_SDK_TOOLS],
      mcpServers: buildCompanyEvidenceMcpServers(ontologyPluginPath),
      model: "inherit",
      maxTurns: 18,
      permissionMode: "dontAsk",
    },
  };
}

function buildGuruAdvisorToolBoundaryHooks(
  guruAdvisorPluginPath: string | null,
  acc: AccumulatedRun,
  agentGeneratedBriefEnabled: boolean,
  requiredGuruCompanyTicker: string | null,
): Options["hooks"] {
  const pluginRoot = guruAdvisorPluginPath
    ? path.resolve(guruAdvisorPluginPath)
    : null;
  let sawCompanyBrief = false;
  let sawCompanyEvidenceAgent = false;
  let sawCompanyEvidenceReview = false;
  let guruEvidenceReviewAttempts = 0;
  const companyEvidenceCallCounts = new Map<string, number>();
  const companyEvidenceCallLimits: Partial<
    Record<KRWOntologyMCPToolName, number>
  > = {
    krw_ontology_query_context: 2,
    krw_ontology_query: 2,
    krw_ontology_trace: 1,
  };

  return {
    PreToolUse: [
      {
        hooks: [
          async (input) => {
            const record = input as UnknownRecord;
            const toolName =
              typeof record.tool_name === "string" ? record.tool_name : "";
            const toolInput = isRecord(record.tool_input)
              ? record.tool_input
              : {};
            const agentID =
              typeof record.agent_id === "string" ? record.agent_id : "";
            const agentType =
              typeof record.agent_type === "string" ? record.agent_type : "";

            if (agentID || agentType) {
              const isCompanyEvidenceAgent = isCompanyEvidenceSubagent(
                agentType || agentID,
              );
              const ontologyToolName = normalizeKrwOntologyToolName(toolName);
              // Guru uses its own PreToolUse boundary because allowedTools can
              // shadow canUseTool. Keep this path on the same mechanical
              // input-normalization contract as ordinary research calls.
              const preparedInput = isCompanyEvidenceAgent
                ? prepareToolInputForRun(ontologyToolName, toolInput, acc)
                : { input: toolInput, changed: false };
              const callLimit = ontologyToolName
                ? companyEvidenceCallLimits[ontologyToolName]
                : undefined;
              const callCount = ontologyToolName
                ? (companyEvidenceCallCounts.get(ontologyToolName) ?? 0)
                : 0;
              const callLimitExceeded =
                typeof callLimit === "number" && callCount >= callLimit;
              if (
                isCompanyEvidenceAgent &&
                ontologyToolName &&
                !callLimitExceeded
              ) {
                companyEvidenceCallCounts.set(ontologyToolName, callCount + 1);
              }
              return guruAdvisorHookDecision(
                isCompanyEvidenceAgent &&
                  isGuruCompanyEvidenceSdkTool(toolName) &&
                  !callLimitExceeded
                  ? "allow"
                  : "deny",
                (callLimitExceeded
                  ? `Company evidence call limit reached for ${ontologyToolName}. Use the filing evidence already collected and return a compact evidence summary.`
                  : null) ??
                  (isCompanyEvidenceAgent
                    ? "Company evidence subagents may use only query_context, query, and trace filing MCP tools."
                    : "Unknown Guru Advisor subagent is not allowed to use tools."),
                preparedInput.changed ? preparedInput.input : undefined,
              );
            }

            if (toolName === AGENT_TOOL_NAME) {
              if (toolInput.subagent_type !== COMPANY_EVIDENCE_SUBAGENT_NAME) {
                return guruAdvisorHookDecision(
                  "deny",
                  "Guru Advisor can delegate only to the configured company evidence researcher subagent.",
                );
              }
              if (!sawCompanyBrief) {
                return guruAdvisorHookDecision(
                  "deny",
                  agentGeneratedBriefEnabled
                    ? "Call krw_guru_company_brief first, then pass its sealed investigation brief to the company_evidence_researcher Agent."
                    : "Call krw_guru_company_brief first, then pass its dynamic_question_plan to the company_evidence_researcher Agent.",
                );
              }
              const agentPrompt =
                typeof toolInput.prompt === "string" ? toolInput.prompt : "";
              if (
                agentGeneratedBriefEnabled
                  ? !hasSealedInvestigationBriefPrompt(agentPrompt, acc)
                  : !agentPrompt.includes("dynamic_question_plan") ||
                    !agentPrompt.includes("evidence_by_question")
              ) {
                return guruAdvisorHookDecision(
                  "deny",
                  agentGeneratedBriefEnabled
                    ? "The company_evidence_researcher Agent prompt must include the exact sealed krw-guru-investigation-brief/v1 JSON, its brief_hash, and every question_id."
                    : "The company_evidence_researcher Agent prompt must include the exact dynamic_question_plan JSON and request evidence_by_question answers.",
                );
              }

              sawCompanyEvidenceAgent = true;
              return guruAdvisorHookDecision(
                "allow",
                "Company evidence research must run inline so the Guru Advisor can use the runtime-built filing research context.",
                {
                  ...toolInput,
                  run_in_background: false,
                },
              );
            }

            if (isGuruAdvisorSdkTool(toolName)) {
              const guruToolName = normalizeGuruAdvisorToolName(toolName);
              let briefInputDecision: PermissionResult | null = null;
              if (guruToolName === GURU_COMPANY_BRIEF_TOOL_NAME) {
                briefInputDecision = guruCompanyBriefInputPermission(
                  toolInput,
                  acc,
                  agentGeneratedBriefEnabled,
                  requiredGuruCompanyTicker,
                );
                if (briefInputDecision?.behavior === "deny") {
                  return guruAdvisorHookDecision(
                    "deny",
                    briefInputDecision.message,
                  );
                }
                sawCompanyBrief = true;
              }
              if (
                sawCompanyBrief &&
                !sawCompanyEvidenceReview &&
                guruToolName &&
                GURU_SOURCE_SUPPORT_TOOL_NAMES.has(guruToolName)
              ) {
                return guruAdvisorHookDecision(
                  "deny",
                  "After a Guru company brief, source-support Guru tools cannot replace company filing evidence. Use the company_evidence_researcher Agent and krw_guru_review_company_evidence first.",
                );
              }
              if (
                guruToolName === GURU_REVIEW_COMPANY_EVIDENCE_TOOL_NAME &&
                sawCompanyBrief &&
                !sawCompanyEvidenceAgent
              ) {
                return guruAdvisorHookDecision(
                  "deny",
                  "Review company evidence only after the company_evidence_researcher Agent has returned company filing evidence.",
                );
              }
              if (guruToolName === GURU_REVIEW_COMPANY_EVIDENCE_TOOL_NAME) {
                if (guruEvidenceReviewAttempts >= 2) {
                  return guruAdvisorHookDecision(
                    "deny",
                    "The sealed evidence review allows one initial call and one correction only. Write the final answer only from a validated review result.",
                  );
                }
                const preparedReviewInput =
                  prepareGuruReviewCompanyEvidenceInput(
                    toolInput,
                    acc,
                    agentGeneratedBriefEnabled,
                  );
                const evidenceDecision =
                  guruReviewCompanyEvidencePayloadPermission(
                    preparedReviewInput.input,
                    {
                      requireQuestionEvidence: sawCompanyBrief,
                      researchContext: latestGuruCompanyResearchContext(acc),
                      investigationBrief: latestGuruInvestigationBrief(acc),
                      requireInvestigationBrief: agentGeneratedBriefEnabled,
                    },
                  );
                if (evidenceDecision?.behavior === "deny") {
                  return guruAdvisorHookDecision(
                    "deny",
                    evidenceDecision.message ??
                      "Review requires question-driven company filing evidence.",
                  );
                }
                guruEvidenceReviewAttempts += 1;
                sawCompanyEvidenceReview = true;
                return guruAdvisorHookDecision(
                  "allow",
                  "The runtime attached the immutable company research context and sealed investigation brief for validation.",
                  preparedReviewInput.input,
                );
              }
              if (briefInputDecision?.behavior === "allow") {
                return guruAdvisorHookDecision(
                  "allow",
                  "The runtime attached the immutable Guru research pack for company-brief sealing.",
                  briefInputDecision.updatedInput,
                );
              }
              return guruAdvisorMainMcpToolHookDecision(guruToolName);
            }

            if (toolName === "Read") {
              return guruAdvisorHookDecision(
                pluginRoot && isAllowedGuruAdvisorRead(pluginRoot, toolInput)
                  ? "allow"
                  : "deny",
                "Guru Advisor may read only its bundled skill and reference documents.",
              );
            }

            return guruAdvisorHookDecision(
              "deny",
              "Guru Advisor main runs may use only Guru Advisor MCP tools, bundled Guru reference reads, and the configured company evidence Agent.",
            );
          },
        ],
      },
    ],
  };
}

/**
 * allowedTools makes MCP tools discoverable and may auto-approve them before
 * canUseTool. PreToolUse remains the execution boundary for every normal
 * research call, so contract validation cannot be skipped by that shortcut.
 */
function buildResearchToolBoundaryHooks(
  passCanUseTool: CanUseTool,
): Options["hooks"] {
  return {
    PreToolUse: [
      {
        hooks: [
          async (input, toolUseID, hookOptions) => {
            const record = input as UnknownRecord;
            const toolName =
              typeof record.tool_name === "string" ? record.tool_name : "";
            const toolInput = isRecord(record.tool_input)
              ? record.tool_input
              : {};
            const decision = await passCanUseTool(toolName, toolInput, {
              signal: hookOptions.signal,
              toolUseID:
                toolUseID ??
                (typeof record.tool_use_id === "string"
                  ? record.tool_use_id
                  : crypto.randomUUID()),
              requestId: crypto.randomUUID(),
            });
            if (!decision) {
              return {
                continue: true,
                hookSpecificOutput: {
                  hookEventName: "PreToolUse" as const,
                  permissionDecision: "deny" as const,
                  permissionDecisionReason:
                    "Tool boundary could not determine whether this call is permitted.",
                },
              };
            }
            if (decision.behavior === "allow") {
              return {
                continue: true,
                hookSpecificOutput: {
                  hookEventName: "PreToolUse" as const,
                  permissionDecision: "allow" as const,
                  ...(decision.updatedInput
                    ? { updatedInput: decision.updatedInput }
                    : {}),
                },
              };
            }
            return {
              continue: true,
              hookSpecificOutput: {
                hookEventName: "PreToolUse" as const,
                permissionDecision: "deny" as const,
                permissionDecisionReason: decision.message,
              },
            };
          },
        ],
      },
    ],
  };
}

function guruAdvisorHookDecision(
  permissionDecision: "allow" | "deny",
  reason: string,
  updatedInput?: Record<string, unknown>,
) {
  if (permissionDecision === "allow") {
    return {
      continue: true,
      hookSpecificOutput: {
        hookEventName: "PreToolUse" as const,
        permissionDecision,
        permissionDecisionReason: reason,
        ...(updatedInput ? { updatedInput } : {}),
      },
    };
  }

  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "PreToolUse" as const,
      permissionDecision,
      permissionDecisionReason: reason,
      ...(updatedInput ? { updatedInput } : {}),
    },
  };
}

function guruAdvisorMainMcpToolHookDecision(
  guruToolName: GuruMCPToolName | null,
) {
  if (!guruToolName) {
    return guruAdvisorHookDecision("deny", "Unknown Guru Advisor MCP tool.");
  }

  if (guruToolName === GURU_COMPANY_PACK_TOOL_NAME) {
    return guruAdvisorHookDecision(
      "deny",
      "The default Guru Advisor workflow uses krw_guru_review_company_evidence after the runtime builds company research context; krw_guru_company_pack is legacy/debug only.",
    );
  }

  return guruAdvisorHookDecision(
    "allow",
    "Guru Advisor MCP tools are allowed in the main Guru run; product quality is controlled by prompt and logs rather than hard call-count limits.",
  );
}

function isGuruCompanyEvidenceSdkTool(toolName: string): boolean {
  return GURU_COMPANY_EVIDENCE_SDK_TOOLS.includes(toolName);
}

function isAllowedGuruAdvisorRead(
  pluginRoot: string,
  input: Record<string, unknown>,
): boolean {
  const rawPath =
    typeof input.file_path === "string"
      ? input.file_path
      : typeof input.path === "string"
        ? input.path
        : "";
  if (!rawPath) return false;

  const resolvedPath = path.resolve(rawPath);
  return (
    isPathInside(resolvedPath, path.join(pluginRoot, "skills")) ||
    isPathInside(resolvedPath, path.join(pluginRoot, "references"))
  );
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return (
    Boolean(relative) &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative)
  );
}

export async function canUseTool(
  toolName: string,
  input: Record<string, unknown> = {},
): Promise<PermissionResult> {
  if (isChartSdkTool(toolName)) {
    return isChartGenerationEnabled()
      ? { behavior: "allow" }
      : {
          behavior: "deny",
          message: "Inline chart generation is disabled for this runtime.",
        };
  }

  if (isKrwOntologySdkTool(toolName)) {
    const mcpToolName = normalizeKrwOntologyToolName(toolName);
    return allowWithInputPolicy(mcpToolName, input);
  }

  if (isStockNewsSdkTool(toolName)) {
    if (!isStockNewsEnabled()) {
      return {
        behavior: "deny",
        message: "Stock News MCP is disabled for this runtime.",
      };
    }

    return { behavior: "allow" };
  }

  if (isGuruAdvisorSdkTool(toolName)) {
    return { behavior: "allow" };
  }

  if (isYahooFinanceSdkTool(toolName)) {
    return { behavior: "allow" };
  }

  return {
    behavior: "deny",
    message:
      "Only configured ontology, current market-news, stock-news, and presentation tools are allowed in web chat.",
  };
}

function isSubagentInvocationTool(toolName: string): boolean {
  return (SUBAGENT_TOOL_NAMES as readonly string[]).includes(toolName);
}

function allowedSdkToolsForResearchMode(
  mode: ResearchMode,
  analysisMode: AnalysisMode,
  runKind: RunKind,
  chartGenerationEnabled = isChartGenerationEnabled(),
  hasSourceFilingContext = false,
): string[] {
  if (runKind === "guru_advisor") {
    return [
      ...GURU_ADVISOR_DEFAULT_SDK_ALLOWED_TOOLS,
      ...SUBAGENT_TOOL_NAMES,
      "Read",
    ];
  }

  const allowedMcpTools = new Set(getAllowedMcpToolsForResearchMode(mode));
  const allowedOntologyTools = KRW_ONTOLOGY_SDK_ALLOWED_TOOLS.filter(
    (toolName) => {
      const mcpToolName = normalizeKrwOntologyToolName(toolName);
      return Boolean(mcpToolName && allowedMcpTools.has(mcpToolName));
    },
  );
  const allowedStockNewsTools = getStockNewsSdkAllowedTools().filter(
    (toolName) => {
      const stockNewsToolName = normalizeStockNewsToolName(toolName);
      return Boolean(
        stockNewsToolName &&
        isStockNewsToolAllowedForRunKind(stockNewsToolName, runKind),
      );
    },
  );
  const allowedYahooFinanceTools = YAHOO_FINANCE_SDK_ALLOWED_TOOLS.filter(
    (toolName) => {
      const yahooFinanceToolName = normalizeYahooFinanceToolName(toolName);
      return Boolean(
        yahooFinanceToolName &&
        isYahooFinanceToolAllowedForRunKind(yahooFinanceToolName, runKind),
      );
    },
  );

  return [
    ...(runKind === "news_discovery" ? [] : allowedOntologyTools),
    ...(isStockNewsRunKind(runKind) ? allowedStockNewsTools : []),
    ...(isYahooFinanceRunKind(runKind) ? allowedYahooFinanceTools : []),
    ...(chartGenerationEnabled && runKind !== "news_discovery"
      ? CHART_SDK_ALLOWED_TOOLS
      : []),
    ...(hasSourceFilingContext
      ? KRW_FILINGS_SDK_ALLOWED_TOOLS
      : []),
  ];
}

function createToolPermissionGuard(
  acc: AccumulatedRun,
  mode: ResearchMode,
  analysisMode: AnalysisMode,
  runKind: RunKind,
  maxToolCalls: number,
  maxStockNewsCalls: number,
  maxYahooFinanceCalls: number,
  allowedStockNewsSourceUrls: string[] = [],
  chartGenerationEnabled = isChartGenerationEnabled(),
  guruAgentGeneratedBriefEnabled = false,
  requiredGuruCompanyTicker: string | null = null,
  sourceFilingEventId: string | null = null,
): CanUseTool {
  let guruSawCompanyBrief = false;
  let guruSawCompanyEvidenceAgent = false;
  let guruSawCompanyEvidenceReview = false;
  let guruEvidenceReviewAttempts = 0;

  return async (
    toolName: string,
    input: Record<string, unknown> = {},
    permissionContext,
  ): Promise<PermissionResult> => {
    if (isChartSdkTool(toolName)) {
      return chartGenerationEnabled
        ? { behavior: "allow" }
        : {
            behavior: "deny",
            message: "Inline chart generation is disabled for this runtime.",
          };
    }

    if (isKrwFilingsSdkTool(toolName)) {
      if (!sourceFilingEventId) {
        return {
          behavior: "deny",
          message: "On-demand SEC filing tools are available only for the filing card that opened this chat.",
        };
      }
      const filingToolName = normalizeKrwFilingsToolName(toolName);
      if (!filingToolName) {
        return { behavior: "deny", message: "Unknown on-demand SEC filing tool." };
      }
      if (filingToolName === "search_catalog_filings") {
        return {
          behavior: "deny",
          message: "This filing-scoped chat may read only its source filing, not search other filings.",
        };
      }
      if (acc.toolCalls.length + 1 > maxToolCalls) {
        return { behavior: "deny", message: buildToolBudgetDenyMessage() };
      }
      const preparedInput = constrainFilingToolInput(
        filingToolName,
        input,
        sourceFilingEventId,
      );
      return preparedInput.changed
        ? { behavior: "allow", updatedInput: preparedInput.input }
        : { behavior: "allow" };
    }

    if (runKind === "guru_advisor") {
      let updatedGuruReviewInput: Record<string, unknown> | undefined;
      if (permissionContext?.agentID) {
        return guruSubagentToolPermission({
          acc,
          agentID: permissionContext.agentID,
          input,
          maxToolCalls,
          mode,
          toolName,
        });
      }

      if (isSubagentInvocationTool(toolName)) {
        const decision = guruMainAgentToolPermission(
          input,
          acc,
          guruAgentGeneratedBriefEnabled,
        );
        if (decision.behavior === "allow") {
          guruSawCompanyEvidenceAgent = true;
        }
        return decision;
      }

      if (!isGuruAdvisorSdkTool(toolName)) {
        return {
          behavior: "deny",
          message:
            "This Guru Advisor main run can use only Guru Advisor MCP tools and the configured company evidence subagent.",
        };
      }

      const guruToolName = normalizeGuruAdvisorToolName(toolName);
      if (!guruToolName) {
        return {
          behavior: "deny",
          message: "Unknown Guru Advisor MCP tool.",
        };
      }
      if (guruToolName === GURU_COMPANY_PACK_TOOL_NAME) {
        return {
          behavior: "deny",
          message:
            "The default Guru Advisor workflow reviews the runtime-built company research context after filing retrieval; krw_guru_company_pack is legacy/debug only.",
        };
      }
      if (guruToolName === GURU_COMPANY_BRIEF_TOOL_NAME) {
        const briefInputDecision = guruCompanyBriefInputPermission(
          input,
          acc,
          guruAgentGeneratedBriefEnabled,
          requiredGuruCompanyTicker,
        );
        if (briefInputDecision) {
          if (briefInputDecision.behavior === "allow") {
            guruSawCompanyBrief = true;
          }
          return briefInputDecision;
        }
        guruSawCompanyBrief = true;
      }
      if (
        guruSawCompanyBrief &&
        !guruSawCompanyEvidenceReview &&
        GURU_SOURCE_SUPPORT_TOOL_NAMES.has(guruToolName)
      ) {
        return {
          behavior: "deny",
          message:
            "After a Guru company brief, source-support Guru tools cannot replace company filing evidence. Call the company_evidence_researcher Agent and then review the returned evidence first.",
        };
      }
      if (
        guruToolName === GURU_REVIEW_COMPANY_EVIDENCE_TOOL_NAME &&
        guruSawCompanyBrief &&
        !guruSawCompanyEvidenceAgent
      ) {
        return {
          behavior: "deny",
          message:
            "Review company evidence only after calling the company_evidence_researcher Agent. Pass the Agent's question-driven company evidence, not a self-authored coverage/status payload.",
        };
      }
      if (guruToolName === GURU_REVIEW_COMPANY_EVIDENCE_TOOL_NAME) {
        if (guruEvidenceReviewAttempts >= 2) {
          return {
            behavior: "deny",
            message:
              "The sealed evidence review allows one initial call and one correction only. Write the final answer only from a validated review result.",
          };
        }
        const preparedReviewInput = prepareGuruReviewCompanyEvidenceInput(
          input,
          acc,
          guruAgentGeneratedBriefEnabled,
        );
        const evidenceDecision = guruReviewCompanyEvidencePayloadPermission(
          preparedReviewInput.input,
          {
            requireQuestionEvidence: guruSawCompanyBrief,
            researchContext: latestGuruCompanyResearchContext(acc),
            investigationBrief: latestGuruInvestigationBrief(acc),
            requireInvestigationBrief: guruAgentGeneratedBriefEnabled,
          },
        );
        if (evidenceDecision) return evidenceDecision;
        guruEvidenceReviewAttempts += 1;
        guruSawCompanyEvidenceReview = true;
        if (preparedReviewInput.changed) {
          updatedGuruReviewInput = preparedReviewInput.input;
        }
      }

      if (acc.toolCalls.length + 1 > maxToolCalls) {
        return {
          behavior: "deny",
          message: buildGuruBudgetDenyMessage(),
        };
      }

      return updatedGuruReviewInput
        ? { behavior: "allow", updatedInput: updatedGuruReviewInput }
        : { behavior: "allow" };
    }

    if (
      !isKrwOntologySdkTool(toolName) &&
      !isStockNewsSdkTool(toolName) &&
      !isYahooFinanceSdkTool(toolName)
    ) {
      return {
        behavior: "deny",
        message:
          "Only configured ontology, current market-news, stock-news, and presentation tools are allowed in web chat.",
      };
    }

    if (isYahooFinanceSdkTool(toolName)) {
      const yahooFinanceToolName = normalizeYahooFinanceToolName(toolName);
      if (analysisMode !== "news" || !isYahooFinanceRunKind(runKind)) {
        return {
          behavior: "deny",
          message:
            "The current market-news tool is only available for first-pass news and market-move research.",
        };
      }

      if (
        !yahooFinanceToolName ||
        !isYahooFinanceToolAllowedForRunKind(yahooFinanceToolName, runKind)
      ) {
        return {
          behavior: "deny",
          message:
            "This current market-news tool is not available for this news workflow.",
        };
      }

      const nextYahooFinanceCalls =
        countYahooFinanceToolCalls(acc.toolCalls) + 1;
      if (nextYahooFinanceCalls > maxYahooFinanceCalls) {
        return {
          behavior: "deny",
          message: buildYahooFinanceBudgetDenyMessage(),
        };
      }

      return { behavior: "allow" };
    }

    if (isStockNewsSdkTool(toolName)) {
      const stockNewsToolName = normalizeStockNewsToolName(toolName);
      if (analysisMode !== "news") {
        return {
          behavior: "deny",
          message: "News mode is required to use Stock News MCP.",
        };
      }

      if (!isStockNewsEnabled() || !stockNewsToolName) {
        return {
          behavior: "deny",
          message: "Stock News MCP is disabled for this runtime.",
        };
      }

      if (!isStockNewsToolAllowedForRunKind(stockNewsToolName, runKind)) {
        return {
          behavior: "deny",
          message: stockNewsDenyMessageForRunKind(runKind),
        };
      }

      const nextStockNewsCalls = countStockNewsToolCalls(acc.toolCalls) + 1;
      if (nextStockNewsCalls > maxStockNewsCalls) {
        return {
          behavior: "deny",
          message: buildStockNewsBudgetDenyMessage(),
        };
      }

      if (stockNewsToolName === "read_news_sources") {
        const constrainedInput = constrainReadNewsSourcesInput(
          input,
          allowedStockNewsSourceUrls,
        );
        if (!constrainedInput.ok) {
          return {
            behavior: "deny",
            message: constrainedInput.message,
          };
        }
        if (constrainedInput.changed) {
          return {
            behavior: "allow",
            updatedInput: constrainedInput.input,
          };
        }
      }

      const preparedInput = prepareStockNewsToolInputForRun(
        stockNewsToolName,
        input,
        runKind,
      );
      if (preparedInput.changed) {
        return {
          behavior: "allow",
          updatedInput: preparedInput.input,
        };
      }

      return { behavior: "allow" };
    }

    const mcpToolName = normalizeKrwOntologyToolName(toolName);
    if (!mcpToolName) {
      return {
        behavior: "deny",
        message: "Unknown KRW Ontology MCP tool.",
      };
    }

    if (runKind === "news_discovery") {
      return {
        behavior: "deny",
        message:
          "News discovery answers from current market news only. Do not call KRW Ontology tools in this run.",
      };
    }

    const allowedMcpTools = new Set(getAllowedMcpToolsForResearchMode(mode));
    if (!allowedMcpTools.has(mcpToolName)) {
      return {
        behavior: "deny",
        message: `Research mode ${mode} does not allow ${mcpToolName}.`,
      };
    }

    if (acc.toolCalls.length + 1 > maxToolCalls) {
      return {
        behavior: "deny",
        message: buildToolBudgetDenyMessage(),
      };
    }

    const preparedInput = prepareToolInputForRun(mcpToolName, input, acc);
    if (preparedInput.changed) {
      return {
        behavior: "allow",
        updatedInput: preparedInput.input,
      };
    }

    return { behavior: "allow" };
  };
}

function guruMainAgentToolPermission(
  input: Record<string, unknown>,
  acc: AccumulatedRun,
  agentGeneratedBriefEnabled: boolean,
): PermissionResult {
  if (input.subagent_type !== COMPANY_EVIDENCE_SUBAGENT_NAME) {
    return {
      behavior: "deny",
      message:
        "Guru Advisor can delegate only to the configured company evidence researcher subagent.",
    };
  }
  if (input.run_in_background === true) {
    return {
      behavior: "deny",
      message:
        "Company evidence research must run inline so the Guru Advisor can use its result in the final answer.",
    };
  }

  if (
    agentGeneratedBriefEnabled &&
    !hasSealedInvestigationBriefPrompt(
      typeof input.prompt === "string" ? input.prompt : "",
      acc,
    )
  ) {
    return {
      behavior: "deny",
      message:
        "The company evidence Agent prompt must include the exact sealed investigation brief, brief_hash, and every question_id.",
    };
  }

  return { behavior: "allow" };
}

function guruCompanyBriefInputPermission(
  input: Record<string, unknown>,
  acc: AccumulatedRun,
  agentGeneratedBriefEnabled: boolean,
  requiredGuruCompanyTicker: string | null,
): PermissionResult | null {
  const inputTicker =
    typeof input.ticker === "string" ? input.ticker.trim().toUpperCase() : "";
  if (
    requiredGuruCompanyTicker &&
    inputTicker &&
    inputTicker !== requiredGuruCompanyTicker
  ) {
    return {
      behavior: "deny",
      message: `This company-scoped Guru run is locked to ${requiredGuruCompanyTicker}. Use ticker ${requiredGuruCompanyTicker} for krw_guru_company_brief.`,
    };
  }
  const normalizedInput =
    requiredGuruCompanyTicker && !inputTicker
      ? { ...input, ticker: requiredGuruCompanyTicker }
      : input;

  if (!agentGeneratedBriefEnabled) {
    return normalizedInput === input
      ? null
      : { behavior: "allow", updatedInput: normalizedInput };
  }

  const researchPack = latestGuruResearchPack(acc);
  if (!researchPack || researchPack.format !== GURU_RESEARCH_PACK_FORMAT) {
    return {
      behavior: "deny",
      message:
        "Call krw_guru_query_context first. The runtime will attach its immutable selected research pack when krw_guru_company_brief seals the investigation questions.",
    };
  }

  return {
    behavior: "allow",
    updatedInput: {
      ...normalizedInput,
      guru_query_context: { research_pack: researchPack },
    },
  };
}

function guruReviewCompanyEvidencePayloadPermission(
  input: Record<string, unknown>,
  options: {
    requireQuestionEvidence: boolean;
    researchContext: GuruCompanyResearchContextRecord | null;
    investigationBrief: GuruInvestigationBriefRecord | null;
    requireInvestigationBrief: boolean;
  },
): PermissionResult | null {
  const researchContext = isGuruCompanyResearchContext(
    input.company_research_context,
  )
    ? input.company_research_context
    : null;
  if (!researchContext) {
    return {
      behavior: "deny",
      message:
        "Company review requires the runtime-built krw-guru-company-research-context/v1 from the company_evidence_researcher Agent's filing results.",
    };
  }
  if (!options.researchContext) {
    return {
      behavior: "deny",
      message:
        "No usable company filing research context was observed in this run. Do not construct one in the model; retrieve filing evidence first.",
    };
  }
  if (canonicalJson(researchContext) !== canonicalJson(options.researchContext)) {
    return {
      behavior: "deny",
      message:
        "The company research context was changed after retrieval. Pass the exact runtime-built context without rewriting or adding facts.",
    };
  }
  if (options.requireInvestigationBrief) {
    const brief = isGuruInvestigationBrief(input.investigation_brief)
      ? input.investigation_brief
      : null;
    if (!brief || !options.investigationBrief) {
      return {
        behavior: "deny",
        message:
          "No sealed investigation brief was observed in this run. Call krw_guru_company_brief before review.",
      };
    }
    if (canonicalJson(brief) !== canonicalJson(options.investigationBrief)) {
      return {
        behavior: "deny",
        message:
          "The investigation brief was changed after the server sealed it. Pass the exact brief unchanged.",
      };
    }
    if (researchContext.brief_hash !== brief.brief_hash) {
      return {
        behavior: "deny",
        message:
          "The company research context brief_hash does not match the sealed investigation brief.",
      };
    }
  }
  const requestedTicker =
    typeof input.ticker === "string" ? input.ticker.trim().toUpperCase() : "";
  const contextTicker = researchContext.ticker.trim().toUpperCase();
  if (requestedTicker && requestedTicker !== contextTicker) {
    return {
      behavior: "deny",
      message:
        "The company research context ticker does not match the review ticker.",
    };
  }
  if (
    options.requireQuestionEvidence &&
    researchContext.source_object_ids.length === 0
  ) {
    return {
      behavior: "deny",
      message:
        "The company research context contains no filing object ids for the sealed question. Retrieve evidence before review.",
    };
  }

  return null;
}

function latestGuruCompanyResearchContext(
  acc: AccumulatedRun,
): GuruCompanyResearchContextRecord | null {
  const brief = latestGuruInvestigationBrief(acc);
  if (!brief) return null;

  const ticker = brief.ticker.trim().toUpperCase();
  const questionIds = brief.questions
    .map((question) => question.question_id)
    .filter((questionId): questionId is string => typeof questionId === "string");
  if (!ticker || questionIds.length === 0) return null;

  const evidenceUnits: UnknownRecord[] = [];
  const sourceObjectIds = new Set<string>();
  const seenEvidence = new Set<string>();
  for (let index = acc.toolCalls.length - 1; index >= 0; index -= 1) {
    const toolCall = acc.toolCalls[index];
    const toolName = normalizeKrwOntologyToolName(toolCall.toolName);
    if (!toolName || !GURU_COMPANY_EVIDENCE_MCP_TOOLS.has(toolName)) {
      continue;
    }
    const result =
      unwrapMcpJsonResult(toolCall.resultJson) ??
      (isRecord(toolCall.resultJson) ? toolCall.resultJson : null);
    const researchState =
      result?.contract_version === RESEARCH_STATE_CONTRACT_VERSION
        ? result
        : isRecord(result?.research_state)
          ? result.research_state
          : null;
    if (!Array.isArray(researchState?.evidence_units)) continue;
    for (const evidenceUnit of researchState.evidence_units) {
      if (!isRecord(evidenceUnit)) continue;
      const evidenceTicker =
        typeof evidenceUnit.ticker === "string"
          ? evidenceUnit.ticker.trim().toUpperCase()
          : "";
      if (evidenceTicker !== ticker) continue;
      const source = isRecord(evidenceUnit.source) ? evidenceUnit.source : {};
      const objectIds = [
        ...(typeof evidenceUnit.object_id === "string"
          ? [evidenceUnit.object_id]
          : []),
        ...readStringArray(source.object_ids),
      ].filter((objectId, position, values) => values.indexOf(objectId) === position);
      if (objectIds.length === 0) continue;
      const evidenceKey =
        typeof evidenceUnit.evidence_id === "string"
          ? evidenceUnit.evidence_id
          : objectIds.join("|");
      if (seenEvidence.has(evidenceKey)) continue;
      seenEvidence.add(evidenceKey);
      for (const objectId of objectIds) {
        if (sourceObjectIds.size < 24) sourceObjectIds.add(objectId);
      }
      if (evidenceUnits.length < 12) {
        evidenceUnits.push({
          evidence_id: evidenceUnit.evidence_id,
          object_id: evidenceUnit.object_id,
          object_type: evidenceUnit.object_type,
          ticker: evidenceTicker,
          period: evidenceUnit.period,
          document_type: evidenceUnit.document_type,
          title: evidenceUnit.title,
          summary: evidenceUnit.summary,
          directness: evidenceUnit.directness,
          evidence_grade: evidenceUnit.evidence_grade,
          source: { object_ids: objectIds },
        });
      }
    }
  }
  if (evidenceUnits.length === 0 || sourceObjectIds.size === 0) return null;
  return {
    format: GURU_COMPANY_RESEARCH_CONTEXT_FORMAT,
    ticker,
    brief_hash: brief.brief_hash,
    question_ids: questionIds,
    evidence_units: evidenceUnits,
    source_object_ids: [...sourceObjectIds],
    research_status: evidenceUnits.length >= 3 ? "evidence_found" : "partial",
  };
}

function latestGuruResearchPack(acc: AccumulatedRun): UnknownRecord | null {
  for (let index = acc.toolCalls.length - 1; index >= 0; index -= 1) {
    const toolCall = acc.toolCalls[index];
    if (
      normalizeGuruAdvisorToolName(toolCall.toolName) !==
      "krw_guru_query_context"
    ) {
      continue;
    }
    const result =
      unwrapMcpJsonResult(toolCall.resultJson) ??
      (isRecord(toolCall.resultJson) ? toolCall.resultJson : null);
    const researchPack = isRecord(result?.research_pack)
      ? result.research_pack
      : null;
    if (researchPack?.format === GURU_RESEARCH_PACK_FORMAT) {
      return researchPack;
    }
  }
  return null;
}

function latestGuruInvestigationBrief(
  acc: AccumulatedRun,
): GuruInvestigationBriefRecord | null {
  for (let index = acc.toolCalls.length - 1; index >= 0; index -= 1) {
    const toolCall = acc.toolCalls[index];
    if (
      normalizeGuruAdvisorToolName(toolCall.toolName) !==
      GURU_COMPANY_BRIEF_TOOL_NAME
    ) {
      continue;
    }
    const result =
      unwrapMcpJsonResult(toolCall.resultJson) ??
      (isRecord(toolCall.resultJson) ? toolCall.resultJson : null);
    if (isGuruInvestigationBrief(result?.investigation_brief)) {
      return result.investigation_brief;
    }
    const filingBrief = isRecord(result?.company_filing_brief)
      ? result.company_filing_brief
      : null;
    const nestedBrief = filingBrief?.investigation_brief;
    if (isGuruInvestigationBrief(nestedBrief)) {
      return nestedBrief;
    }
  }
  return null;
}

function hasSuccessfulGuruEvidenceReview(
  acc: AccumulatedRun,
  expected?: { ticker?: string; briefHash?: string },
): boolean {
  return acc.toolCalls.some((toolCall) => {
    if (
      normalizeGuruAdvisorToolName(toolCall.toolName) !==
      GURU_REVIEW_COMPANY_EVIDENCE_TOOL_NAME
    ) {
      return false;
    }
    const result =
      unwrapMcpJsonResult(toolCall.resultJson) ??
      (isRecord(toolCall.resultJson) ? toolCall.resultJson : null);
    const validated = isRecord(result?.validated_evidence_analysis)
      ? result.validated_evidence_analysis
      : null;
    if (
      isRecord(validated) &&
      validated.format === "krw-guru-validated-evidence-analysis/v1"
    ) {
      const expectedTicker = expected?.ticker?.trim().toUpperCase();
      if (
        expectedTicker &&
        (typeof validated.ticker !== "string" ||
          validated.ticker.trim().toUpperCase() !== expectedTicker)
      ) {
        return false;
      }
      if (
        expected?.briefHash &&
        validated.brief_hash !== expected.briefHash
      ) {
        return false;
      }
      return true;
    }
    return false;
  });
}

function guruAdvisorCompletionResult(
  acc: AccumulatedRun,
  runKind: RunKind,
  agentGeneratedBriefEnabled: boolean,
  requiredGuruCompanyTicker: string | null,
  responseLocale: Locale,
): AgentRunResult {
  if (runKind === "guru_advisor" && requiredGuruCompanyTicker) {
    if (
      hasCompletedGuruCompanyContract(
        acc,
        requiredGuruCompanyTicker,
        agentGeneratedBriefEnabled,
      )
    ) {
      return { acc, status: "completed" };
    }

    // This is a render boundary, not a second model pass or a rewritten model
    // answer. A short question in a selected-company session must not surface
    // an otherwise fluent market-general answer as a conclusion about that
    // company when the company evidence contract was not completed.
    acc.fullText = boundedGuruCompanyAnswer(
      acc,
      requiredGuruCompanyTicker,
      responseLocale,
    );
    return { acc, status: "completed" };
  }

  return guruEvidenceReviewCompletionResult(
    acc,
    runKind,
    agentGeneratedBriefEnabled,
  );
}

function hasCompletedGuruCompanyContract(
  acc: AccumulatedRun,
  ticker: string,
  agentGeneratedBriefEnabled: boolean,
): boolean {
  const brief = latestGuruInvestigationBrief(acc);
  if (!brief || brief.ticker.trim().toUpperCase() !== ticker) return false;

  const researchContext = latestGuruCompanyResearchContext(acc);
  if (
    !researchContext ||
    researchContext.ticker.trim().toUpperCase() !== ticker
  ) {
    return false;
  }
  if (
    agentGeneratedBriefEnabled &&
    researchContext.brief_hash !== brief.brief_hash
  ) {
    return false;
  }

  return hasSuccessfulGuruEvidenceReview(acc, {
    ticker,
    briefHash: brief.brief_hash,
  });
}

function boundedGuruCompanyAnswer(
  acc: AccumulatedRun,
  ticker: string,
  responseLocale: Locale,
): string {
  const brief = latestGuruInvestigationBrief(acc);
  const hasBrief = brief?.ticker.trim().toUpperCase() === ticker;
  const researchContext = hasBrief ? latestGuruCompanyResearchContext(acc) : null;
  const hasEvidence = researchContext?.ticker.trim().toUpperCase() === ticker;
  const hasReview = hasBrief
    ? hasSuccessfulGuruEvidenceReview(acc, {
        ticker,
        briefHash: brief.brief_hash,
      })
    : false;

  if (responseLocale === "en") {
    if (!hasBrief) {
      return `${ticker} should not inherit an attack-or-defend conclusion from general market mood alone. The decision has to rest on how its current business driver, capital allocation, and financial risk connect in company filings. Until that connection is established, turning a general observation into a ${ticker} judgment would be the larger mistake.`;
    }
    if (!hasEvidence) {
      return `The central question for ${ticker} is clear, but company evidence that could support or weaken it is not yet connected. That makes a confident conclusion premature: the next useful judgment comes from the specific filing facts that would change the underlying business case, not from a more forceful market narrative.`;
    }
    if (!hasReview) {
      return `The relevant ${ticker} company material is available, but it has not yet been brought together into a single conclusion through the selected investment lens. The disciplined stance is to keep the key tension open until the evidence can show what truly strengthens the case and what would break it.`;
    }
  }

  if (!hasBrief) {
    return `${ticker}에 대해서는 일반 시장 분위기만으로 공격·방어 결론을 내리지 않겠습니다. 이 회사의 판단은 현재 사업 동력, 자본배치, 재무 위험이 실제 공시에서 어떻게 연결되는지를 봐야 합니다. 그 연결이 확인되기 전에는 일반론을 ${ticker}의 투자 판단으로 바꾸는 쪽이 더 큰 실수입니다.`;
  }
  if (!hasEvidence) {
    return `${ticker}의 핵심 쟁점은 분명하지만, 이를 지지하거나 꺾을 회사 공시 근거가 아직 연결되지 않았습니다. 이 단계에서 확신을 키우기보다, 어떤 사업 사실이 판단을 바꿀지를 확인하는 것이 더 중요합니다. 일반 시장 서사를 ${ticker}의 결론으로 바꾸지는 않겠습니다.`;
  }
  return `${ticker}의 관련 회사 자료는 확인됐지만, 그것을 선택된 투자 원칙의 하나의 결론으로 묶을 만큼 해석이 아직 완성되지는 않았습니다. 따라서 지금은 결론을 서두르기보다, 무엇이 사례를 강화하고 무엇이 무너뜨리는지를 가르는 핵심 긴장을 열어두는 편이 더 신중합니다.`;
}

function guruEvidenceReviewCompletionResult(
  acc: AccumulatedRun,
  runKind: RunKind,
  agentGeneratedBriefEnabled: boolean,
): AgentRunResult {
  const requiresValidatedReview =
    runKind === "guru_advisor" &&
    agentGeneratedBriefEnabled &&
    latestGuruInvestigationBrief(acc) !== null;
  if (!requiresValidatedReview || hasSuccessfulGuruEvidenceReview(acc)) {
    return { acc, status: "completed" };
  }
  return {
    acc,
    status: "failed",
    errorCode: "GURU_EVIDENCE_REVIEW_REQUIRED",
    errorMessage:
      "근거 검토가 완료되지 않아 답변을 표시하지 않았습니다. 같은 요청을 다시 실행해 주세요.",
    internalErrorMessage:
      "A sealed Guru investigation brief was returned, but krw_guru_review_company_evidence did not return krw-guru-validated-evidence-analysis/v1 in this SDK run.",
  };
}

function hasSealedInvestigationBriefPrompt(
  prompt: string,
  acc: AccumulatedRun,
): boolean {
  const brief = latestGuruInvestigationBrief(acc);
  if (!brief || !prompt.includes(GURU_INVESTIGATION_BRIEF_FORMAT)) {
    return false;
  }
  if (!prompt.includes(brief.brief_hash)) return false;
  return brief.questions.every(
    (question) =>
      typeof question.question_id === "string" &&
      prompt.includes(question.question_id),
  );
}

function isGuruInvestigationBrief(
  value: unknown,
): value is GuruInvestigationBriefRecord {
  if (!isRecord(value)) return false;
  return (
    value.format === GURU_INVESTIGATION_BRIEF_FORMAT &&
    typeof value.brief_hash === "string" &&
    /^[a-f0-9]{64}$/.test(value.brief_hash) &&
    typeof value.ticker === "string" &&
    Array.isArray(value.questions) &&
    value.questions.length > 0 &&
    value.questions.every(
      (question) =>
        isRecord(question) &&
        typeof question.question_id === "string" &&
        typeof question.question === "string",
    )
  );
}

function isGuruCompanyResearchContext(
  value: unknown,
): value is GuruCompanyResearchContextRecord {
  if (!isRecord(value)) return false;
  return (
    value.format === GURU_COMPANY_RESEARCH_CONTEXT_FORMAT &&
    typeof value.ticker === "string" &&
    typeof value.brief_hash === "string" &&
    Array.isArray(value.question_ids) &&
    value.question_ids.length > 0 &&
    value.question_ids.every((questionId) => typeof questionId === "string") &&
    Array.isArray(value.evidence_units) &&
    value.evidence_units.length > 0 &&
    value.evidence_units.every(isRecord) &&
    Array.isArray(value.source_object_ids) &&
    value.source_object_ids.length > 0 &&
    value.source_object_ids.every((objectId) => typeof objectId === "string") &&
    (value.research_status === "evidence_found" ||
      value.research_status === "partial")
  );
}

function unwrapMcpJsonResult(value: unknown): UnknownRecord | null {
  if (!isRecord(value)) return null;
  if (typeof value.result === "string") {
    try {
      const parsed: unknown = JSON.parse(value.result);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(value.result) ? value.result : null;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortJsonValue(value[key])]),
  );
}


function guruSubagentToolPermission(params: {
  acc: AccumulatedRun;
  agentID: string;
  input: Record<string, unknown>;
  maxToolCalls: number;
  mode: ResearchMode;
  toolName: string;
}): PermissionResult {
  const {
    acc,
    agentID,
    input,
    maxToolCalls,
    mode,
    toolName,
  } = params;
  if (!isCompanyEvidenceSubagent(agentID)) {
    return {
      behavior: "deny",
      message: "Unknown Guru Advisor subagent is not allowed to use tools.",
    };
  }

  if (isSubagentInvocationTool(toolName)) {
    return {
      behavior: "deny",
      message: "Company evidence subagents may not spawn recursive subagents.",
    };
  }

  if (!isKrwOntologySdkTool(toolName)) {
    return {
      behavior: "deny",
      message:
        "The company evidence subagent can use only KRW Ontology company filing tools.",
    };
  }

  const mcpToolName = normalizeKrwOntologyToolName(toolName);
  if (!mcpToolName) {
    return {
      behavior: "deny",
      message: "Unknown KRW Ontology MCP tool.",
    };
  }

  if (!GURU_COMPANY_EVIDENCE_MCP_TOOLS.has(mcpToolName)) {
    return {
      behavior: "deny",
      message:
        "Company evidence research is limited to query_context, query, and trace so it can return compact filing evidence promptly.",
    };
  }

  const preparedInput = prepareToolInputForRun(mcpToolName, input, acc);

  const allowedMcpTools = new Set(getAllowedMcpToolsForResearchMode(mode));
  if (!allowedMcpTools.has(mcpToolName)) {
    return {
      behavior: "deny",
      message: `Research mode ${mode} does not allow ${mcpToolName}.`,
    };
  }

  if (acc.toolCalls.length + 1 > maxToolCalls) {
    return {
      behavior: "deny",
      message: buildToolBudgetDenyMessage(),
    };
  }

  if (preparedInput.changed) {
    return {
      behavior: "allow",
      updatedInput: preparedInput.input,
    };
  }

  return { behavior: "allow" };
}

function isCompanyEvidenceSubagent(agentID: string): boolean {
  return (
    agentID === COMPANY_EVIDENCE_SUBAGENT_NAME ||
    agentID.startsWith(`${COMPANY_EVIDENCE_SUBAGENT_NAME}:`) ||
    agentID.includes(COMPANY_EVIDENCE_SUBAGENT_NAME)
  );
}

function allowWithInputPolicy(
  mcpToolName: KRWOntologyMCPToolName | null,
  input: Record<string, unknown>,
): PermissionResult {
  const policy = normalizeKrwOntologyToolInput(mcpToolName, input);
  if (policy.changed) {
    return {
      behavior: "allow",
      updatedInput: policy.input,
    };
  }
  return { behavior: "allow" };
}

const NEWS_DISCOVERY_YAHOO_FINANCE_TOOLS = new Set<YahooFinanceMCPToolName>(
  YAHOO_FINANCE_MCP_TOOLS,
);

function isStockNewsToolAllowedForRunKind(
  toolName: StockNewsMCPToolName,
  runKind: RunKind,
): boolean {
  void toolName;
  void runKind;
  return false;
}

function isStockNewsRunKind(runKind: RunKind): boolean {
  void runKind;
  return false;
}

function isYahooFinanceRunKind(runKind: RunKind): boolean {
  return runKind === "news_discovery" || runKind === "market_move_research";
}

function analysisModeForRunKind(
  runKind: RunKind,
  fallback: AnalysisMode,
): AnalysisMode {
  if (runKind === "news_discovery" || runKind === "market_move_research") {
    return "news";
  }
  if (
    runKind === "company_research" ||
    runKind === "idea_generation" ||
    runKind === "scenario_sensitivity" ||
    runKind === "guru_advisor"
  ) {
    return "company";
  }
  return fallback;
}

function isYahooFinanceToolAllowedForRunKind(
  toolName: YahooFinanceMCPToolName,
  runKind: RunKind,
): boolean {
  if (isYahooFinanceRunKind(runKind)) {
    return NEWS_DISCOVERY_YAHOO_FINANCE_TOOLS.has(toolName);
  }
  return false;
}

function stockNewsDenyMessageForRunKind(runKind: RunKind): string {
  if (runKind === "news_discovery") {
    return "News discovery uses the current market-news tool for first-pass ticker news. Do not call Stock News MCP in this run.";
  }
  return "News tools are only available in news mode.";
}

function buildSelectedNewsEventContextPrompt(
  runKind: RunKind,
  selectedNewsEventContext: Record<string, unknown> | null | undefined,
): string {
  if (runKind === "idea_generation" && selectedNewsEventContext) {
    return `Use this user-provided URL context as additional input for KRW Ontology idea generation. Treat extracted page text as an external market/business hypothesis, not confirmed company fact. Follow the idea-generation skill's URL workflow for covered-company discovery. Start from source_pack.ontology_search_brief_en and source_pack.original_text_for_ontology when present. Do not switch to news mode or write an article summary.

<idea_generation_url_context>
${JSON.stringify(selectedNewsEventContext)}
</idea_generation_url_context>`;
  }
  if (runKind === "market_move_research" && selectedNewsEventContext) {
    return `Use this app-provided market move context only as supplemental bounded context for stock-move interpretation. Runtime current market-news lookup remains the primary current price/news read. Treat current market data and recent news candidates as market observations, not confirmed company disclosure. Default to a compact market/news explanation of the observed move. Use KRW Ontology retrieval from source_pack.ontology_search_brief_en and source_pack.original_text_for_ontology only when filing-grounded depth is required by the user's question or by a durable investment-view claim. Follow-up prompts should bridge the observed move/news into filing-grounded KRW Ontology research. Provider/tool names are internal and must not appear in the final answer unless the user explicitly asks about data/debug provenance.

<selected_news_event_context>
${JSON.stringify(selectedNewsEventContext)}
</selected_news_event_context>`;
  }
  if (runKind !== "company_research" || !selectedNewsEventContext) return "";
  return `Use this selected market narrative as the input brief for KRW Ontology filing research. Treat it as an investment hypothesis, not confirmed company fact. If it came from a user-provided URL, first ask what would matter if the narrative is directionally true, then anchor the interpretation against filing evidence. Start KRW ontology retrieval from source_pack.ontology_search_brief_en and source_pack.original_text_for_ontology when present; otherwise use ontology_bridge_brief_en.

<selected_news_event_context>
${JSON.stringify(selectedNewsEventContext)}
</selected_news_event_context>`;
}

interface PreparedToolInput {
  input: Record<string, unknown>;
  changed: boolean;
}

/**
 * The model writes only its evidence analysis. The sealed brief and the
 * research context derived from actual filing-tool results are run-local
 * state, so copying or reconstructing them through model tokens is fragile.
 */
function prepareGuruReviewCompanyEvidenceInput(
  input: Record<string, unknown>,
  acc: AccumulatedRun,
  requireInvestigationBrief: boolean,
): PreparedToolInput {
  const researchContext = latestGuruCompanyResearchContext(acc);
  if (!researchContext) return { input, changed: false };

  const {
    company_payload: _companyPayload,
    company_payload_json: _companyPayloadJson,
    company_research_context: _companyResearchContext,
    company_research_context_json: _companyResearchContextJson,
    investigation_brief: _investigationBrief,
    investigation_brief_json: _investigationBriefJson,
    agent_analysis: suppliedAnalysis,
    agent_analysis_json: _agentAnalysisJson,
    ...publicInput
  } = input;
  const next: Record<string, unknown> = {
    ...publicInput,
    company_research_context: researchContext,
  };

  const brief = latestGuruInvestigationBrief(acc);
  if (requireInvestigationBrief && brief) {
    next.investigation_brief = brief;
    next.ticker = brief.ticker.toUpperCase();
    if (typeof brief.author_key === "string") {
      next.author_keys = [brief.author_key];
    }
    if (suppliedAnalysis !== undefined) next.agent_analysis = suppliedAnalysis;
  } else if (suppliedAnalysis !== undefined) {
    next.agent_analysis = suppliedAnalysis;
  }

  return {
    input: next,
    changed: canonicalJson(next) !== canonicalJson(input),
  };
}

function prepareToolInputForRun(
  mcpToolName: MCPToolName | null,
  input: Record<string, unknown>,
  acc: AccumulatedRun,
  sourceFilingEventId: string | null = null,
): PreparedToolInput {
  if (isStockNewsMcpToolName(mcpToolName)) {
    return { input, changed: false };
  }
  if (isYahooFinanceMcpToolName(mcpToolName)) {
    return { input, changed: false };
  }
  if (isGuruMcpToolName(mcpToolName)) {
    return { input, changed: false };
  }
  if (isKrwFilingsMcpToolName(mcpToolName)) {
    return sourceFilingEventId
      ? constrainFilingToolInput(mcpToolName, input, sourceFilingEventId)
      : { input, changed: false };
  }
  if (isChartMcpToolName(mcpToolName) || !mcpToolName) {
    return { input, changed: false };
  }

  const inputWithContext = attachAgentContextInput(mcpToolName, input, acc);
  const policy = normalizeKrwOntologyToolInput(
    mcpToolName,
    inputWithContext.input,
  );
  return {
    input: policy.input,
    changed: inputWithContext.changed || policy.changed,
  };
}

function constrainFilingToolInput(
  toolName: KrwFilingsMCPToolName,
  input: Record<string, unknown>,
  sourceFilingEventId: string,
): PreparedToolInput {
  if (toolName === "search_catalog_filings") return { input, changed: false };
  const next = { ...input, filing_event_id: sourceFilingEventId };
  return {
    input: next,
    changed: canonicalJson(next) !== canonicalJson(input),
  };
}

function prepareStockNewsToolInputForRun(
  toolName: StockNewsMCPToolName,
  input: Record<string, unknown>,
  runKind: RunKind,
): PreparedToolInput {
  if (
    runKind !== "news_discovery" ||
    (toolName !== "search_company_news_events" &&
      toolName !== "search_market_news_events")
  ) {
    return { input, changed: false };
  }

  const next = { ...input };
  let changed = false;
  if (next.mode !== "market_narrative_discovery") {
    next.mode = "market_narrative_discovery";
    changed = true;
  }
  if (next.exclude_official_sources !== true) {
    next.exclude_official_sources = true;
    changed = true;
  }
  if (
    next.price_move_direction !== "down" &&
    next.price_move_direction !== "up" &&
    next.price_move_direction !== "unknown"
  ) {
    next.price_move_direction = inferPriceMoveDirectionFromQuestion(
      typeof next.question === "string" ? next.question : "",
    );
    changed = true;
  }

  return { input: next, changed };
}

function constrainReadNewsSourcesInput(
  input: Record<string, unknown>,
  allowedSourceUrls: string[],
):
  | { ok: true; input: Record<string, unknown>; changed: boolean }
  | { ok: false; message: string } {
  const allowedUrls = uniqueUrls(allowedSourceUrls).slice(0, 3);
  if (allowedUrls.length === 0) {
    return {
      ok: false,
      message:
        "read_news_sources is limited to selected preferred market-news URLs. No eligible selected URL is available.",
    };
  }

  const allowedByKey = new Map(
    allowedUrls.map((url) => [normalizeComparableUrl(url), url] as const),
  );
  const requestedUrls = Array.isArray(input.urls)
    ? input.urls.filter((value): value is string => typeof value === "string")
    : [];
  const constrainedUrls = uniqueUrls(
    requestedUrls
      .map((url) => allowedByKey.get(normalizeComparableUrl(url)))
      .filter((url): url is string => Boolean(url)),
  );
  const nextUrls = constrainedUrls.length > 0 ? constrainedUrls : allowedUrls;
  const changed =
    !Array.isArray(input.urls) ||
    requestedUrls.length !== nextUrls.length ||
    requestedUrls.some(
      (url, index) =>
        normalizeComparableUrl(url) !== normalizeComparableUrl(nextUrls[index]),
    );

  return {
    ok: true,
    input: changed ? { ...input, urls: nextUrls } : input,
    changed,
  };
}

function extractAllowedStockNewsSourceUrls(
  selectedNewsEventContext: Record<string, unknown> | null | undefined,
): string[] {
  if (!selectedNewsEventContext) return [];
  const urls: string[] = [];
  const add = (value: unknown) => {
    if (typeof value !== "string" || !value.trim()) return;
    if (!isPreferredMarketNewsUrl(value)) return;
    urls.push(normalizeDisplayUrl(value));
  };
  const addRecord = (record: Record<string, unknown>) => {
    add(record.url);
    add(record.link);
    add(record.source_url);
    add(record.canonical_url);
    for (const key of ["source_urls", "reader_urls", "major_news_urls"]) {
      for (const value of readStringArray(record[key])) add(value);
    }
    for (const key of [
      "source_previews",
      "primary_sources",
      "secondary_sources",
    ]) {
      for (const source of readRecordArray(record[key])) addRecord(source);
    }
    if (isRecord(record.primary_source)) addRecord(record.primary_source);
    if (isRecord(record.source_pack)) addRecord(record.source_pack);
    if (isRecord(record.selected_event)) addRecord(record.selected_event);
  };

  addRecord(selectedNewsEventContext);
  return uniqueUrls(urls);
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    const key = normalizeComparableUrl(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(url);
  }
  return result;
}

function normalizeDisplayUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return value.trim();
  }
}

function normalizeComparableUrl(value: string | undefined): string {
  if (!value) return "";
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return value.trim();
  }
}

function inferPriceMoveDirectionFromQuestion(
  question: string,
): "down" | "up" | "unknown" {
  if (
    /왜\s*(떨어|빠|내려)|하락|급락|약세|조정|빠졌|떨어졌|why\s+(?:is\s+)?(?:.*\s)?(?:down|falling|dropping)|stock\s+(?:drops?|falls?|slips?|sinks?)/i.test(
      question,
    )
  ) {
    return "down";
  }
  if (
    /왜\s*(올라|상승)|급등|강세|반등|올랐|why\s+(?:is\s+)?(?:.*\s)?(?:up|rising|rallying)|stock\s+(?:jumps?|gains?|rallies|rises?)/i.test(
      question,
    )
  ) {
    return "up";
  }
  return "unknown";
}

function attachAgentContextInput(
  mcpToolName: MCPToolName | null,
  input: Record<string, unknown>,
  acc: AccumulatedRun,
): PreparedToolInput {
  if (mcpToolName !== "krw_ontology_retrieve") {
    return { input, changed: false };
  }

  const existingAgentContext = isRecord(input.agent_context)
    ? input.agent_context
    : {};
  const existingToolUsage = isRecord(existingAgentContext.tool_usage)
    ? existingAgentContext.tool_usage
    : {};

  return {
    input: {
      ...input,
      agent_context: {
        ...existingAgentContext,
        tool_usage: {
          ...existingToolUsage,
          total: acc.toolCalls.length,
          krw_ontology_retrieve: countToolCalls(
            acc.toolCalls,
            "krw_ontology_retrieve",
          ),
        },
      },
    },
    changed: true,
  };
}

function buildToolBudgetDenyMessage(): string {
  return [
    "No more KRW Ontology MCP tools can be called in this run.",
    "Do not call another tool.",
    "Write the final Korean Markdown answer from the evidence already collected.",
  ].join(" ");
}

function buildStockNewsBudgetDenyMessage(): string {
  return [
    "No more Stock News MCP tools can be called in this run.",
    "Do not call another current-news tool.",
    "Continue with filing evidence and news results already collected.",
  ].join(" ");
}

function buildYahooFinanceBudgetDenyMessage(): string {
  return [
    "No more current market-news tools can be called in this run.",
    "Do not call another current-news tool.",
    "Write the final answer from the market-news results already collected.",
  ].join(" ");
}

function buildGuruBudgetDenyMessage(): string {
  return [
    "No more Guru Advisor MCP tools can be called in this run.",
    "Do not call another tool.",
    "Write the final Markdown answer from the guru ontology evidence already collected.",
  ].join(" ");
}

async function getCompanyPromptContexts(
  tickers: string[],
): Promise<CompanyPromptContext[]> {
  const uniqueTickers = Array.from(
    new Set(
      tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean),
    ),
  );

  let companies: Awaited<ReturnType<typeof getIndexedCompanies>>;
  try {
    companies = await getIndexedCompanies(uniqueTickers);
  } catch (error) {
    console.warn("[krw-ontology:company-prompt-context-fallback]", {
      tickerCount: uniqueTickers.length,
      error:
        error instanceof Error
          ? error.message.slice(0, 300)
          : "unknown catalog read error",
    });
    return [];
  }

  return companies.map((company) => ({
    ticker: company.ticker,
    companyName: company.name,
    documentTypes: company.document_types,
    latestPeriod: company.latest_period,
    latestPeriods: company.periods.slice(0, 6),
    indexedFilingCount: company.document_count,
    filingAnchor: buildFilingAnchor(company.documents),
    guruLightCompanyContext: buildGuruLightCompanyContext(company),
  }));
}

function buildFilingAnchor(
  documents: IndexedCompanyDocument[],
): FilingAnchorContext | undefined {
  if (documents.length === 0) return undefined;

  const latestAvailable = documents[0];
  const latestAnnual = documents.find(isAnnualFiling) ?? null;
  const excluded = new Set(
    [latestAvailable, latestAnnual].filter(
      (document): document is IndexedCompanyDocument => Boolean(document),
    ),
  );
  const historicalContext = documents
    .filter((document) => !excluded.has(document))
    .slice(0, 4)
    .map(formatFilingLabel);

  return {
    latestAvailable: formatFilingLabel(latestAvailable),
    currentDriver: formatFilingLabel(latestAvailable),
    annualBaseline: latestAnnual ? formatFilingLabel(latestAnnual) : null,
    historicalContext,
  };
}

function isAnnualFiling(document: IndexedCompanyDocument): boolean {
  return (
    document.document_type.toUpperCase() === "10-K" ||
    document.doc_type_key?.toUpperCase() === "10K"
  );
}

function formatFilingLabel(document: IndexedCompanyDocument): string {
  return `${document.period} ${document.document_type}`;
}

async function consumeSdkMessage(params: {
  message: SDKMessage;
  acc: AccumulatedRun;
  openToolCalls: Set<string>;
  sendEvent: (
    event: Parameters<ReturnType<typeof createSSEWriter>["sendEvent"]>[0],
    data: unknown,
  ) => Promise<void>;
  onToolCallStart?: (toolCall: AccumulatedToolCall) => Promise<void>;
  onToolCallEnd?: (toolCall: AccumulatedToolCall) => Promise<void>;
  onCitation?: (citation: StreamingCitation) => Promise<void>;
  sourceFilingEventId?: string | null;
  passName: "research";
}) {
  const {
    message,
    acc,
    openToolCalls,
    sendEvent,
    onToolCallStart,
    onToolCallEnd,
    onCitation,
    sourceFilingEventId,
    passName,
  } = params;

  if (message.type === "assistant") {
    const blocks = getContentBlocks(message.message);

    for (const block of blocks) {
      // Assistant events can contain the model's transient tool-planning text.
      // They are execution state, never user-visible content. The terminal SDK
      // result below is the sole source of the persisted/rendered answer.
      if (block.type === "tool_use") {
        const toolName = normalizeMcpToolName(block.name);
        if (!toolName) continue;

        const toolCallId =
          typeof block.id === "string" ? block.id : crypto.randomUUID();
        const rawInput = isRecord(block.input) ? block.input : {};
        const input = prepareToolInputForRun(
          toolName,
          rawInput,
          acc,
          sourceFilingEventId,
        ).input;

        if (!openToolCalls.has(toolCallId)) {
          openToolCalls.add(toolCallId);
          const toolCall = startToolCall(acc, toolCallId, toolName, input);
          await onToolCallStart?.(toolCall);
          await sendEvent("tool_call_start", {
            tool_call_id: toolCallId,
            tool_name: toolName,
            arguments: input,
            started_at: toolCall.startedAt,
          });
        }
      }
    }
  }

  if (message.type === "user") {
    for (const toolResult of extractToolResults(message)) {
      const wasOpen =
        toolResult.toolUseId !== null &&
        openToolCalls.has(toolResult.toolUseId);

      if (toolResult.toolUseId) {
        const toolCall = endToolCall(
          acc,
          toolResult.toolUseId,
          summarizeToolResult(toolResult.text),
          null,
          toolResult.json,
          toolResult.text,
        );
        if (toolCall) {
          await onToolCallEnd?.(toolCall);
        }

        if (wasOpen) {
          openToolCalls.delete(toolResult.toolUseId);
          await sendEvent("tool_call_end", {
            tool_call_id: toolResult.toolUseId,
            result_summary: summarizeToolResult(toolResult.text),
            error_message: null,
            duration_ms: toolCallDurationMs(acc, toolResult.toolUseId),
          });
          logToolDuration(acc, toolResult.toolUseId, passName, "completed");
        }
      }

      const prevCitationCount = acc.citations.length;
      extractCitations(acc, toolResult.text, toolResult.json);
      for (let i = prevCitationCount; i < acc.citations.length; i++) {
        const citation = acc.citations[i];
        await onCitation?.(citation);
        await sendEvent("citation", citation);
      }
    }
  }

  if (message.type === "tool_progress") {
    const toolName = normalizeMcpToolName(message.tool_name);
    if (!toolName) return;

    if (!openToolCalls.has(message.tool_use_id)) {
      openToolCalls.add(message.tool_use_id);
      const toolCall = startToolCall(acc, message.tool_use_id, toolName, {});
      await onToolCallStart?.(toolCall);
      await sendEvent("tool_call_start", {
        tool_call_id: message.tool_use_id,
        tool_name: toolName,
        arguments: {},
        started_at: toolCall.startedAt,
      });
    }
  }

  if (message.type === "tool_use_summary") {
    for (const toolUseId of message.preceding_tool_use_ids) {
      if (!openToolCalls.has(toolUseId)) continue;
      openToolCalls.delete(toolUseId);
      const toolCall = endToolCall(acc, toolUseId, message.summary, null);
      if (toolCall) {
        await onToolCallEnd?.(toolCall);
      }
      await sendEvent("tool_call_end", {
        tool_call_id: toolUseId,
        result_summary: message.summary.slice(0, 2000),
        error_message: null,
        duration_ms: toolCallDurationMs(acc, toolUseId),
      });
      logToolDuration(acc, toolUseId, passName, "completed");
    }
  }
}

function getContentBlocks(message: unknown): UnknownRecord[] {
  if (!isRecord(message)) return [];
  const content = message.content;

  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }

  return Array.isArray(content) ? content.filter(isRecord) : [];
}

function extractToolResults(message: SDKMessage): ToolResultRecord[] {
  if (message.type !== "user") return [];

  const results: ToolResultRecord[] = [];
  const toolUseResult = message.tool_use_result;
  const toolResultBlocks = getContentBlocks(message.message).filter(
    (block) => block.type === "tool_result",
  );
  const topLevelResearchState = extractResearchStateV2(toolUseResult);

  for (const block of toolResultBlocks) {
    const researchState =
      extractResearchStateV2(block) ??
      (toolResultBlocks.length === 1 ? topLevelResearchState : null);
    const text = researchState
      ? JSON.stringify(researchState)
      : stringifyToolResult(block.content);
    results.push({
      toolUseId:
        typeof block.tool_use_id === "string" ? block.tool_use_id : null,
      text,
      json: researchState ?? parseToolJson(text),
    });
  }

  if (toolResultBlocks.length === 0 && toolUseResult) {
    const text = topLevelResearchState
      ? JSON.stringify(topLevelResearchState)
      : stringifyToolResult(toolUseResult);
    results.push({
      toolUseId: null,
      text,
      json: topLevelResearchState ?? parseToolJson(text),
    });
  }

  return results.filter((result) => result.text.trim().length > 0);
}

function extractResearchStateV2(value: unknown): UnknownRecord | null {
  if (!isRecord(value)) return null;
  const structuredContent = isRecord(value.structuredContent)
    ? value.structuredContent
    : null;
  if (
    !structuredContent ||
    structuredContent.contract_version !== RESEARCH_STATE_CONTRACT_VERSION
  ) {
    return null;
  }
  return structuredContent;
}

function stringifyToolResult(value: unknown): string {
  if (typeof value === "string") return value;

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (isRecord(item) && typeof item.text === "string") return item.text;
        return JSON.stringify(item);
      })
      .join("\n");
  }

  return JSON.stringify(value);
}

function parseToolJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function summarizeToolResult(text: string): string | null {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return null;
  return compact.slice(0, 2000);
}

function normalizeMcpToolName(name: unknown): MCPToolName | null {
  return (
    normalizeKrwOntologyToolName(name) ??
    normalizeKrwFilingsToolName(name) ??
    normalizeStockNewsToolName(name) ??
    normalizeGuruAdvisorToolName(name) ??
    normalizeYahooFinanceToolName(name) ??
    normalizeChartToolName(name)
  );
}

function normalizeKrwFilingsToolName(
  name: unknown,
): KrwFilingsMCPToolName | null {
  if (typeof name !== "string") return null;
  const bareName = name.includes("__") ? name.split("__").at(-1) : name;
  if (!bareName || !KRW_FILINGS_MCP_TOOL_SET.has(bareName)) return null;
  return bareName as KrwFilingsMCPToolName;
}

function normalizeKrwOntologyToolName(
  name: unknown,
): KRWOntologyMCPToolName | null {
  if (typeof name !== "string") return null;
  const bareName = name.includes("__") ? name.split("__").at(-1) : name;
  if (!bareName || !KRW_ONTOLOGY_MCP_TOOL_SET.has(bareName)) return null;
  return bareName as KRWOntologyMCPToolName;
}

function normalizeStockNewsToolName(
  name: unknown,
): StockNewsMCPToolName | null {
  if (typeof name !== "string") return null;
  const bareName = name.includes("__") ? name.split("__").at(-1) : name;
  if (!bareName || !STOCK_NEWS_MCP_TOOL_SET.has(bareName)) return null;
  return bareName as StockNewsMCPToolName;
}

function normalizeGuruAdvisorToolName(name: unknown): GuruMCPToolName | null {
  if (typeof name !== "string") return null;
  const bareName = name.includes("__") ? name.split("__").at(-1) : name;
  if (!bareName || !GURU_MCP_TOOL_SET.has(bareName)) return null;
  return bareName as GuruMCPToolName;
}

function normalizeYahooFinanceToolName(
  name: unknown,
): YahooFinanceMCPToolName | null {
  if (typeof name !== "string") return null;
  const bareName = name.includes("__") ? name.split("__").at(-1) : name;
  if (!bareName || !YAHOO_FINANCE_MCP_TOOL_SET.has(bareName)) return null;
  return bareName as YahooFinanceMCPToolName;
}

function normalizeChartToolName(name: unknown): ChartMCPToolName | null {
  if (typeof name !== "string") return null;
  const bareName = name.includes("__") ? name.split("__").at(-1) : name;
  if (!bareName || !CHART_MCP_TOOL_SET.has(bareName)) return null;
  return bareName as ChartMCPToolName;
}

function pendingToolResultsFailure(
  acc: AccumulatedRun,
  openToolCalls: Set<string>,
): AgentRunResult {
  const pendingToolIds = Array.from(openToolCalls);
  return {
    acc,
    status: "failed",
    errorCode: TOOL_RESULT_MISSING,
    errorMessage: `Agent run ended before ${pendingToolIds.length} tool result(s) were received.`,
    internalErrorMessage: `Agent run ended before ${pendingToolIds.length} tool result(s) were received.`,
  };
}

function toolCallDurationMs(acc: AccumulatedRun, toolCallId: string): number {
  const toolCall = acc.toolCalls.find((tc) => tc.id === toolCallId);
  if (!toolCall) return 0;
  return Date.now() - new Date(toolCall.startedAt).getTime();
}

function logToolDuration(
  acc: AccumulatedRun,
  toolCallId: string,
  passName: "research",
  status: "completed" | "closed",
) {
  const toolCall = acc.toolCalls.find((tc) => tc.id === toolCallId);
  if (!toolCall) return;

  const durationMs = toolCallDurationMs(acc, toolCallId);
  console.info("[krw-ontology:mcp-tool-duration]", {
    args: summarizeToolArguments(toolCall.argumentsJson),
    duration_ms: durationMs,
    duration_s: Number((durationMs / 1000).toFixed(3)),
    pass: passName,
    status,
    tool_call_id: toolCallId,
    tool_name: toolCall.toolName,
  });
}

function countToolCalls(
  toolCalls: Array<Pick<AccumulatedToolCall, "toolName">>,
  toolName: MCPToolName,
): number {
  return toolCalls.filter((toolCall) => toolCall.toolName === toolName).length;
}

function countStockNewsToolCalls(
  toolCalls: Array<Pick<AccumulatedToolCall, "toolName">>,
): number {
  return toolCalls.filter((toolCall) =>
    isStockNewsMcpToolName(toolCall.toolName),
  ).length;
}

function countYahooFinanceToolCalls(
  toolCalls: Array<Pick<AccumulatedToolCall, "toolName">>,
): number {
  return toolCalls.filter((toolCall) =>
    isYahooFinanceMcpToolName(toolCall.toolName),
  ).length;
}

function isChartMcpToolName(
  toolName: MCPToolName | null,
): toolName is ChartMCPToolName {
  return Boolean(toolName && CHART_MCP_TOOL_SET.has(toolName));
}

function isKrwFilingsMcpToolName(
  toolName: MCPToolName | null,
): toolName is KrwFilingsMCPToolName {
  return Boolean(toolName && KRW_FILINGS_MCP_TOOL_SET.has(toolName));
}

function isGuruMcpToolName(
  toolName: MCPToolName | null,
): toolName is GuruMCPToolName {
  return Boolean(toolName && GURU_MCP_TOOL_SET.has(toolName));
}

function isStockNewsMcpToolName(
  toolName: MCPToolName | null,
): toolName is StockNewsMCPToolName {
  return Boolean(toolName && STOCK_NEWS_MCP_TOOL_SET.has(toolName));
}

function isYahooFinanceMcpToolName(
  toolName: MCPToolName | null,
): toolName is YahooFinanceMCPToolName {
  return Boolean(toolName && YAHOO_FINANCE_MCP_TOOL_SET.has(toolName));
}

const SAFE_TOOL_ARGUMENT_KEYS = [
  "ticker",
  "tickers",
  "topic",
  "topics",
  "object_type",
  "object_types",
  "period_policy",
  "period",
  "periods",
  "document_type",
  "document_types",
  "question",
  "query",
  "company",
  "companies",
  "domain",
  "domains",
  "lookback_hours",
  "max_events",
  "urls",
  "event_id",
] as const;

function summarizeToolArguments(
  argumentsJson: string,
): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson);
  } catch {
    return undefined;
  }

  if (!isRecord(parsed)) return undefined;

  const summary: Record<string, unknown> = {};
  for (const key of SAFE_TOOL_ARGUMENT_KEYS) {
    if (!(key in parsed)) continue;
    const value = summarizeToolArgumentValue(parsed[key]);
    if (value !== undefined) summary[key] = value;
  }

  return Object.keys(summary).length > 0 ? summary : undefined;
}

function summarizeToolArgumentValue(value: unknown): unknown {
  if (typeof value === "string") return truncateLogValue(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value
      .map(summarizeToolArgumentValue)
      .filter((item) => item !== undefined)
      .slice(0, 8);
  }
  return undefined;
}

function truncateLogValue(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 120
    ? `${normalized.slice(0, 117).trimEnd()}...`
    : normalized;
}

function usageFromSdkMessage(message: SDKMessage): {
  inputTokens: number;
  outputTokens: number;
  cacheHitInputTokens: number;
  cacheMissInputTokens: number;
} {
  if (message.type !== "result") {
    return {
      inputTokens: 0,
      outputTokens: 0,
      cacheHitInputTokens: 0,
      cacheMissInputTokens: 0,
    };
  }

  const usage = message.usage as UnknownRecord;
  const modelUsage = isRecord(message.modelUsage) ? message.modelUsage : {};

  const usageInput =
    numberValue(usage.input_tokens) ??
    numberValue(usage.inputTokens) ??
    sumModelUsage(modelUsage, "inputTokens");
  const usageOutput =
    numberValue(usage.output_tokens) ??
    numberValue(usage.outputTokens) ??
    sumModelUsage(modelUsage, "outputTokens");
  const cacheHitInputTokens =
    numberValue(usage.prompt_cache_hit_tokens) ??
    numberValue(usage.promptCacheHitTokens) ??
    sumModelUsage(modelUsage, "cacheHitInputTokens");
  const cacheMissInputTokens =
    numberValue(usage.prompt_cache_miss_tokens) ??
    numberValue(usage.promptCacheMissTokens) ??
    sumModelUsage(modelUsage, "cacheMissInputTokens");

  return {
    inputTokens: usageInput ?? 0,
    outputTokens: usageOutput ?? 0,
    cacheHitInputTokens: cacheHitInputTokens ?? 0,
    cacheMissInputTokens: cacheMissInputTokens ?? 0,
  };
}

function modelFromSdkMessage(message: SDKMessage): string | null {
  if (message.type === "system" && message.subtype === "init") {
    return message.model;
  }

  if (message.type === "assistant" && isRecord(message.message)) {
    return typeof message.message.model === "string"
      ? message.message.model
      : null;
  }

  if (message.type === "result") {
    const record = message as UnknownRecord;
    return typeof record.model === "string" ? record.model : null;
  }

  return null;
}

function sumModelUsage(
  modelUsage: UnknownRecord,
  field:
    | "inputTokens"
    | "outputTokens"
    | "cacheHitInputTokens"
    | "cacheMissInputTokens",
): number {
  return Object.values(modelUsage).reduce<number>((sum, value) => {
    if (!isRecord(value)) return sum;
    return sum + (numberValue(value[field]) ?? 0);
  }, 0);
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function errorCodeFromMessage(message: string): AgentRunResult["errorCode"] {
  const lower = message.toLowerCase();
  if (
    lower.includes(TOOL_BUDGET_EXCEEDED) ||
    lower.includes("tool budget") ||
    lower.includes("budget exceeded") ||
    lower.includes("limit for this run has been reached") ||
    lower.includes("no more krw ontology mcp tools") ||
    lower.includes("max tool calls") ||
    lower.includes("query calls") ||
    lower.includes("trace/chain calls")
  ) {
    return TOOL_BUDGET_EXCEEDED;
  }
  if (lower.includes("before tool result was received")) {
    return TOOL_RESULT_MISSING;
  }
  if (
    lower.includes("not logged in") ||
    lower.includes("please run /login") ||
    lower.includes("invalid api key") ||
    lower.includes("authentication_failed")
  ) {
    return "auth_required";
  }
  if (lower.includes("rate limit") || lower.includes("429")) {
    return "claude_rate_limited";
  }
  if (lower.includes("mcp")) return "mcp_unavailable";
  return "claude_api_error";
}

function userFacingErrorMessage(
  code: AgentRunResult["errorCode"],
  rawMessage: string,
): string {
  if (code === "auth_required") {
    return "분석 서비스를 준비하지 못했습니다. 잠시 후 다시 시도해주세요.";
  }
  if (code === "mcp_unavailable") {
    return "온톨로지 도구 연결을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.";
  }
  if (code === TOOL_RESULT_MISSING) {
    return "온톨로지 도구 결과를 받기 전에 실행이 종료되었습니다. 잠시 후 다시 시도해주세요.";
  }

  if (process.env.NODE_ENV !== "production") {
    console.warn("[krw-ai-agent-sdk] execution failed", rawMessage);
  }
  return publicAgentErrorMessage({ code });
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function asRecordArray(data: unknown): UnknownRecord[] {
  return Array.isArray(data) ? data.filter(isRecord) : [];
}

function firstText(values: unknown[], maxLength: number): string | null {
  for (const value of values) {
    if (!isRecord(value)) continue;
    const text =
      value.text ??
      value.quote_text ??
      value.claim_text ??
      value.content ??
      value.snippet;
    if (typeof text === "string" && text.trim()) {
      return text.slice(0, maxLength);
    }
  }
  return null;
}

function addCitationFromBundle(acc: AccumulatedRun, bundle: UnknownRecord) {
  const evidence = isRecord(bundle.evidence) ? bundle.evidence : {};
  const quotes = asRecordArray(evidence.quotes);
  const claims = asRecordArray(evidence.claims);

  const objectId =
    typeof bundle.object_id === "string"
      ? bundle.object_id
      : typeof bundle.id === "string"
        ? bundle.id
        : typeof bundle.trace_id === "string"
          ? bundle.trace_id
          : null;

  if (!objectId && typeof bundle.ticker !== "string") {
    return;
  }

  addCitation(acc, {
    object_id: objectId,
    ticker: typeof bundle.ticker === "string" ? bundle.ticker : null,
    document_type:
      typeof bundle.document_type === "string"
        ? (bundle.document_type as DocumentType)
        : null,
    period: typeof bundle.period === "string" ? bundle.period : null,
    section: typeof bundle.section === "string" ? bundle.section : null,
    quote_text:
      firstText(quotes, 500) ??
      (typeof bundle.snippet === "string"
        ? bundle.snippet.slice(0, 500)
        : typeof bundle.text === "string"
          ? bundle.text.slice(0, 500)
          : null),
    claim_text: firstText(claims, 500),
    evidence_grade: null,
    source_quality: null,
    trace_json: bundle,
  });
}

function addCitationFromFilingMcpResult(acc: AccumulatedRun, data: UnknownRecord) {
  const citation = isRecord(data.citation) ? data.citation : null;
  const filing = isRecord(data.filing) ? data.filing : null;
  if (!citation || typeof citation.filing_event_id !== "string") return;

  const formType = typeof filing?.form_type === "string" ? filing.form_type : null;
  addCitation(acc, {
    object_id: `sec-filing:${citation.filing_event_id}`,
    ticker: typeof filing?.ticker === "string" ? filing.ticker : null,
    document_type: formType === "8-K" || formType === "8-K/A" || formType === "6-K" || formType === "6-K/A"
      ? "current_report"
      : "other",
    period: typeof filing?.filing_date === "string" ? filing.filing_date : null,
    section: typeof citation.section_heading === "string" ? citation.section_heading : null,
    quote_text: typeof data.text === "string" ? data.text.slice(0, 500) : null,
    claim_text: typeof citation.document_url === "string" ? citation.document_url : null,
    evidence_grade: "high",
    source_quality: "filing_direct",
    trace_json: citation,
  });
}

function addCitationFromResearchStateEvidenceUnit(
  acc: AccumulatedRun,
  unit: UnknownRecord,
) {
  const source = isRecord(unit.source) ? unit.source : {};
  const sourceObjectIds = Array.isArray(source.object_ids)
    ? source.object_ids.filter(
        (value): value is string => typeof value === "string" && Boolean(value),
      )
    : [];
  const objectId =
    typeof unit.object_id === "string" && unit.object_id
      ? unit.object_id
      : (sourceObjectIds[0] ?? null);
  const ticker = typeof unit.ticker === "string" ? unit.ticker : null;

  if (!objectId && !ticker) return;

  const summary =
    typeof unit.summary === "string" && unit.summary.trim()
      ? unit.summary.slice(0, 500)
      : typeof unit.title === "string" && unit.title.trim()
        ? unit.title.slice(0, 500)
        : null;

  addCitation(acc, {
    object_id: objectId,
    ticker,
    document_type:
      typeof unit.document_type === "string"
        ? (unit.document_type as DocumentType)
        : null,
    period: typeof unit.period === "string" ? unit.period : null,
    section: null,
    quote_text: null,
    claim_text: summary,
    evidence_grade: researchStateCitationGrade(unit.evidence_grade),
    source_quality: researchStateSourceQuality(unit.directness),
    trace_json: unit,
  });
}

function researchStateCitationGrade(
  value: unknown,
): StreamingCitation["evidence_grade"] {
  if (value === "strong") return "high";
  if (value === "medium") return "medium";
  if (value === "weak") return "low";
  return null;
}

function researchStateSourceQuality(
  value: unknown,
): StreamingCitation["source_quality"] {
  if (value === "direct") return "filing_direct";
  if (value === "metric_lineage" || value === "related") return "derived";
  return null;
}

function extractCitations(
  acc: AccumulatedRun,
  resultContent: string,
  parsedResult: unknown = null,
) {
  try {
    const data = normalizeCitationPayload(parsedResult ?? resultContent);
    if (!isRecord(data)) return;

    if (
      data.contract_version === RESEARCH_STATE_CONTRACT_VERSION &&
      Array.isArray(data.evidence_units)
    ) {
      for (const unit of asRecordArray(data.evidence_units)) {
        addCitationFromResearchStateEvidenceUnit(acc, unit);
      }
    }

    if (Array.isArray(data.results)) {
      for (const result of asRecordArray(data.results)) {
        addCitationFromBundle(acc, result);
      }
    }

    if (isRecord(data.results)) {
      for (const resultGroup of Object.values(data.results)) {
        for (const result of asRecordArray(resultGroup)) {
          addCitationFromBundle(acc, result);
        }
      }
    }

    addCitationFromFilingMcpResult(acc, data);

    if (Array.isArray(data.objects)) {
      for (const obj of asRecordArray(data.objects)) {
        addCitationFromBundle(acc, obj);
      }
    }

    if (
      typeof data.id === "string" ||
      typeof data.object_id === "string" ||
      typeof data.trace_id === "string"
    ) {
      addCitationFromBundle(acc, data);
    }
  } catch {
    // Tool result was not JSON or did not contain compact evidence bundles.
  }
}

function normalizeCitationPayload(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return normalizeCitationPayload(JSON.parse(value));
    } catch {
      return null;
    }
  }

  if (!isRecord(value)) return value;

  if (typeof value.result === "string") {
    try {
      return normalizeCitationPayload(JSON.parse(value.result));
    } catch {
      return value;
    }
  }

  return value;
}
