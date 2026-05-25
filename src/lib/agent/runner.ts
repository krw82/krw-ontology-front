import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  getSessionInfo,
  query,
  type Options,
  type PermissionResult,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
  KRW_ONTOLOGY_MCP_TOOLS,
  KRW_ONTOLOGY_SDK_ALLOWED_TOOLS,
  getKrwOntologyPluginPath,
  isKrwOntologySdkTool,
} from "./mcp-client";
import { buildClaudeAgentEnv } from "./env";
import {
  buildSystemPrompt,
  type CompanyPromptContext,
} from "./system-prompt";
import { buildResearchPassPrompt } from "./workflow";
import { getIndexedCompany } from "@/lib/ontology/catalog";
import { readIntEnv } from "@/lib/env";
import {
  buildResearchModePrompt,
  getAllowedMcpToolsForResearchMode,
  getResearchModeToolBudget,
  normalizeResearchMode,
  type ResearchMode,
  type ResearchModeToolBudget,
} from "@/lib/research-mode";
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
import type { MCPToolName, DocumentType, StreamingCitation } from "@/types/api-contracts";

const MCP_TOOL_SET = new Set<string>(KRW_ONTOLOGY_MCP_TOOLS);
const DEFAULT_MAX_TURNS = 20;
const DEFAULT_AGENT_WORKSPACE_DIR = ".agent-workspace";
const TOOL_BUDGET_EXCEEDED = "tool_budget_exceeded";
const COMPOSE_EVIDENCE_CHAR_LIMIT = 18_000;

export interface AgentRunOptions {
  sessionId: string;
  userMessage: string;
  scopeType: "global" | "company";
  defaultTickers: string[];
  defaultDocumentTypes: string[];
  researchMode?: ResearchMode;
  history?: Array<{ role: string; content: string }>;
  abortSignal?: AbortSignal;
  onSdkDiagnostics?: (diagnostics: SdkDiagnostics) => Promise<void>;
  onTextDelta?: (delta: string, fullText: string) => Promise<void>;
  onToolCallStart?: (toolCall: AccumulatedToolCall) => Promise<void>;
  onToolCallEnd?: (toolCall: AccumulatedToolCall) => Promise<void>;
  onCitation?: (citation: StreamingCitation) => Promise<void>;
}

export interface AgentRunResult {
  acc: AccumulatedRun;
  status: "completed" | "cancelled" | "failed";
  errorCode?: string;
  errorMessage?: string;
}

type UnknownRecord = Record<string, unknown>;

interface ToolResultRecord {
  toolUseId: string | null;
  text: string;
  json: unknown;
}

type ToolBudgetViolationKind =
  | "max_tool_calls"
  | "query_context"
  | "query"
  | "retrieve"
  | "trace_chain"
  | "compare";

interface ToolBudgetUsage {
  total: number;
  queryContext: number;
  query: number;
  retrieve: number;
  traceChain: number;
  compare: number;
}

interface ToolBudgetViolation {
  kind: ToolBudgetViolationKind;
  attemptedTool: MCPToolName;
  usage: ToolBudgetUsage;
  remaining: ToolBudgetUsage;
}

async function resolveClaudeAgentCwd(): Promise<string> {
  const configured = process.env.CLAUDE_AGENT_CWD?.trim();
  const cwd = configured || path.join(process.cwd(), DEFAULT_AGENT_WORKSPACE_DIR);

  if (!path.isAbsolute(cwd)) {
    throw new Error(
      `CLAUDE_AGENT_CWD must be an absolute path when set: ${cwd}`,
    );
  }

  await mkdir(cwd, { recursive: true });
  return cwd;
}

export interface SdkDiagnostics {
  passName?: "research" | "composer";
  requestedModel?: string;
  observedModels?: string[];
  cwd?: string;
  defaultTickers?: string[];
  pluginPath?: string;
  promptPreview?: string;
  permissionMode?: string;
  scopeType?: "global" | "company";
  settingSources?: string[];
  tools?: unknown;
  allowedTools?: string[];
  researchMode?: ResearchMode;
  toolBudget?: ResearchModeToolBudget;
  plugins?: unknown;
  mcpServers?: unknown;
  slashCommands?: Array<{ name: string; description?: string }>;
  mcpServerStatus?: unknown;
  initError?: string;
  mcpStatusError?: string;
  observedAt: string;
}

export async function runAgent(
  options: AgentRunOptions,
  streamWriter: StreamWriter,
): Promise<AgentRunResult> {
  const { sendEvent } = createSSEWriter(streamWriter);
  const acc = createAccumulator();
  const pluginPath = getKrwOntologyPluginPath();
  const cwd = await resolveClaudeAgentCwd();
  const abortController = new AbortController();
  const researchMode = normalizeResearchMode(options.researchMode);
  const toolBudget = getResearchModeToolBudget(researchMode);

  const abortHandler = () => abortController.abort();
  options.abortSignal?.addEventListener("abort", abortHandler, { once: true });
  if (options.abortSignal?.aborted) {
    options.abortSignal.removeEventListener("abort", abortHandler);
    return { acc, status: "cancelled" };
  }

  const promptContext = {
    scopeType: options.scopeType,
    defaultTickers: options.defaultTickers,
    defaultDocumentTypes: options.defaultDocumentTypes,
    companies: await getCompanyPromptContexts(options.defaultTickers),
  };
  const sdkSession = await getSessionInfo(options.sessionId, { dir: cwd }).catch(
    () => undefined,
  );
  const shouldResume = Boolean(sdkSession);
  const systemPrompt = buildSystemPrompt(
    promptContext,
    shouldResume ? [] : (options.history ?? []),
  );
  const researchPrompt = [
    buildResearchPassPrompt(options.userMessage),
    buildResearchModePrompt(researchMode),
  ].join("\n\n");
  const allowedTools = allowedSdkToolsForResearchMode(researchMode);

  const requestedModel = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
  const baseSdkOptions: Options = {
    cwd,
    model: requestedModel,
    pathToClaudeCodeExecutable:
      process.env.CLAUDE_CODE_EXECUTABLE || undefined,
    systemPrompt: {
      type: "preset",
      preset: "claude_code",
      append: systemPrompt,
    },
    plugins: [{ type: "local", path: pluginPath }],
    tools: [],
    allowedTools,
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    canUseTool,
    settingSources: ["project"],
    maxTurns: readIntEnv("CLAUDE_AGENT_MAX_TURNS", DEFAULT_MAX_TURNS, {
      min: 1,
    }),
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
      suppressTextDeltas: false,
      researchMode,
      toolBudget,
    });

    if (isRecoverableResearchStop(researchResult)) {
      await sendEvent("activity_update", {
        stage: "composing",
        label: "답변 작성 중",
      });

      const composeResult = await runSdkPass({
        passName: "composer",
        prompt: buildComposeOnlyPrompt({
          userQuestion: options.userMessage,
          researchMode,
          researchAcc: researchResult.acc,
          stopReason: researchResult.errorMessage ?? researchResult.errorCode ?? null,
        }),
        sdkOptions: {
          ...baseSdkOptions,
          allowedTools: [],
          sessionId: randomUUID(),
        },
        options,
        requestedModel,
        cwd,
        pluginPath,
        sendEvent,
        observedModels,
        suppressTextDeltas: false,
        researchMode,
        toolBudget,
        disableTools: true,
      });

      const mergedAcc = mergeAccumulatedRuns(researchResult.acc, composeResult.acc);
      if (composeResult.status === "completed" && mergedAcc.fullText.trim()) {
        return { ...composeResult, acc: mergedAcc };
      }
      if (isRecoverableResearchStop(composeResult)) {
        return {
          acc: ensureFallbackAnswer(mergedAcc, options.userMessage),
          status: "completed",
        };
      }
      return { ...composeResult, acc: mergedAcc };
    }

    if (researchResult.status !== "completed") {
      return researchResult;
    }

    if (!researchResult.acc.fullText.trim()) {
      return {
        acc: researchResult.acc,
        status: "failed",
        errorCode: "claude_api_error",
        errorMessage:
          "리서치 단계에서 화면에 표시할 답변을 받지 못했습니다.",
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
    };
  } finally {
    options.abortSignal?.removeEventListener("abort", abortHandler);
  }
}

async function runSdkPass(params: {
  passName: "research" | "composer";
  prompt: string;
  sdkOptions: Options;
  options: AgentRunOptions;
  requestedModel: string;
  cwd: string;
  pluginPath: string;
  sendEvent: ReturnType<typeof createSSEWriter>["sendEvent"];
  observedModels: Set<string>;
  suppressTextDeltas: boolean;
  researchMode: ResearchMode;
  toolBudget: ResearchModeToolBudget;
  disableTools?: boolean;
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
    suppressTextDeltas,
    researchMode,
    toolBudget,
    disableTools = false,
  } = params;
  const acc = createAccumulator();
  const openToolCalls = new Set<string>();
  let finalResult: AgentRunResult | null = null;
  const maxToolCalls = Math.min(
    readIntEnv("AGENT_MAX_TOOL_CALLS", toolBudget.maxToolCalls, { min: 1 }),
    toolBudget.maxToolCalls,
  );

  try {
    const passCanUseTool = disableTools
      ? denyMcpToolsDuringCompose
      : createToolPermissionGuard(acc, researchMode, toolBudget);
    const sdkQuery = query({
      prompt,
      options: {
        ...sdkOptions,
        canUseTool: passCanUseTool,
      },
    });
    await reportSdkInitialization({
      passName,
      sdkQuery,
      options,
      requestedModel,
      cwd,
      pluginPath,
      prompt,
      sdkOptions: {
        ...sdkOptions,
        canUseTool: passCanUseTool,
      },
      researchMode,
      toolBudget,
    });

    for await (const message of sdkQuery) {
      if (options.abortSignal?.aborted) {
        return { acc, status: "cancelled" };
      }

      const observedModel = modelFromSdkMessage(message);
      if (observedModel && !observedModels.has(observedModel)) {
        observedModels.add(observedModel);
        await options.onSdkDiagnostics?.({
          passName,
          observedModels: Array.from(observedModels),
          observedAt: new Date().toISOString(),
        });
      }

      await consumeSdkMessage({
        message,
        acc,
        openToolCalls,
        sendEvent,
        onTextDelta: options.onTextDelta,
        onToolCallStart: options.onToolCallStart,
        onToolCallEnd: options.onToolCallEnd,
        onCitation: options.onCitation,
        passName,
        suppressTextDeltas,
      });

      if (acc.toolCalls.length > maxToolCalls) {
        finalResult = {
          acc,
          status: "failed",
          errorCode: TOOL_BUDGET_EXCEEDED,
          errorMessage: "분석 도구 호출 한도에 도달했습니다.",
        };
        break;
      }

      const budgetViolation = toolBudgetViolation(acc.toolCalls, toolBudget);
      if (budgetViolation) {
        finalResult = {
          acc,
          status: "failed",
          errorCode: TOOL_BUDGET_EXCEEDED,
          errorMessage: `분석 도구 호출 한도에 도달했습니다. (${describeToolBudgetViolation(budgetViolation)})`,
        };
        break;
      }

      if (message.type === "result") {
        const closedToolCalls = closeOpenToolCalls(acc, openToolCalls, passName);
        for (const toolCall of closedToolCalls) {
          await options.onToolCallEnd?.(toolCall);
        }

        if (message.subtype === "success") {
          acc.structuredOutput = message.structured_output ?? null;
          const resultText = typeof message.result === "string" ? message.result : "";
          if (!acc.fullText.trim() && resultText.trim()) {
            addToken(acc, resultText);
          }
          const usage = usageFromSdkMessage(message);
          setUsage(acc, usage.inputTokens, usage.outputTokens);
          finalResult = { acc, status: "completed" };
        } else {
          const rawErrorMessage =
            Array.isArray(message.errors) && message.errors.length > 0
              ? message.errors.join("\n")
              : "KRW-AI Agent SDK execution failed";
          const errorCode = errorCodeFromMessage(rawErrorMessage);
          finalResult = {
            acc,
            status: "failed",
            errorCode,
            errorMessage: userFacingErrorMessage(errorCode, rawErrorMessage),
          };
        }
      }
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
    };
  }
}

function isRecoverableResearchStop(result: AgentRunResult): boolean {
  return result.status === "failed" && result.errorCode === TOOL_BUDGET_EXCEEDED;
}

async function denyMcpToolsDuringCompose(): Promise<PermissionResult> {
  return {
    behavior: "deny",
    message: "Research is complete; compose the final answer without more tools.",
  };
}

function mergeAccumulatedRuns(
  researchAcc: AccumulatedRun,
  composeAcc: AccumulatedRun,
): AccumulatedRun {
  return {
    ...composeAcc,
    fullText: composeAcc.fullText || researchAcc.fullText,
    toolCalls: [...researchAcc.toolCalls, ...composeAcc.toolCalls],
    citations: [...researchAcc.citations, ...composeAcc.citations],
    inputTokens: researchAcc.inputTokens + composeAcc.inputTokens,
    outputTokens: researchAcc.outputTokens + composeAcc.outputTokens,
  };
}

function ensureFallbackAnswer(
  acc: AccumulatedRun,
  userQuestion: string,
): AccumulatedRun {
  if (acc.fullText.trim()) return acc;
  const question = userQuestion.trim() || "요청하신 질문";
  addToken(
    acc,
    [
      `${question}에 대해 현재 확인된 근거를 기준으로 정리합니다.`,
      "",
      "확인된 자료 범위 안에서는 핵심 사업 항목과 관련 매출 동인을 중심으로 답변할 수 있습니다. 더 세부적인 원문 근거 추적이 필요하면 깊은 리서치로 확장할 수 있습니다.",
    ].join("\n"),
  );
  return acc;
}

function buildComposeOnlyPrompt(params: {
  userQuestion: string;
  researchMode: ResearchMode;
  researchAcc: AccumulatedRun;
  stopReason: string | null;
}): string {
  const evidence = summarizeToolEvidence(params.researchAcc);
  return [
    "Compose-only final answer pass.",
    "Write the final user-facing answer in Korean Markdown.",
    "Do not call any tools.",
    "Do not mention internal tool budgets, tool limits, errors, retries, research modes, or failed searches.",
    "Do not use the phrase '공시자료 기반 한계'.",
    "Use CY labels for user-facing periods; do not write FY labels unless fiscal wording is essential as a short parenthetical note.",
    "If exact numeric values are not present in the collected evidence, do not invent numbers and do not use placeholders. Answer qualitatively from supported evidence.",
    "Use the collected evidence below as the only factual basis.",
    "",
    `User question: ${params.userQuestion}`,
    `Internal stop reason, not user-facing: ${params.stopReason ?? "research budget stop"}`,
    `Research mode, not user-facing: ${params.researchMode}`,
    "",
    "Collected evidence:",
    evidence || "No structured tool evidence was captured. Provide the safest concise answer from the conversation context.",
  ].join("\n");
}

function summarizeToolEvidence(acc: AccumulatedRun): string {
  const chunks: string[] = [];
  for (const [index, toolCall] of acc.toolCalls.entries()) {
    if (toolCall.errorMessage) continue;
    const args = toolCall.argumentsJson || "{}";
    const result =
      toolCall.resultText ||
      (typeof toolCall.resultSummary === "string" ? toolCall.resultSummary : "");
    if (!result.trim()) continue;
    chunks.push(
      [
        `Tool ${index + 1}: ${toolCall.toolName}`,
        `Arguments: ${args}`,
        "Result:",
        result,
      ].join("\n"),
    );
  }

  const joined = chunks.join("\n\n---\n\n");
  return joined.length > COMPOSE_EVIDENCE_CHAR_LIMIT
    ? `${joined.slice(0, COMPOSE_EVIDENCE_CHAR_LIMIT)}\n\n[Evidence truncated for compose pass.]`
    : joined;
}

async function reportSdkInitialization(params: {
  passName: "research" | "composer";
  sdkQuery: ReturnType<typeof query>;
  options: AgentRunOptions;
  requestedModel: string;
  cwd: string;
  pluginPath: string;
  prompt: string;
  sdkOptions: Options;
  researchMode: ResearchMode;
  toolBudget: ResearchModeToolBudget;
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
    toolBudget,
  } = params;

  if (!options.onSdkDiagnostics) return;

  const diagnostics: SdkDiagnostics = {
    passName,
    requestedModel,
    cwd,
    defaultTickers: options.defaultTickers,
    pluginPath,
    promptPreview: prompt.slice(0, 500),
    permissionMode: sdkOptions.permissionMode,
    scopeType: options.scopeType,
    settingSources: sdkOptions.settingSources,
    tools: sdkOptions.tools,
    allowedTools: sdkOptions.allowedTools,
    researchMode,
    toolBudget,
    plugins: sdkOptions.plugins,
    mcpServers: sdkOptions.mcpServers,
    observedAt: new Date().toISOString(),
  };

  const [initResult, mcpStatusResult] = await Promise.allSettled([
    sdkQuery.initializationResult(),
    sdkQuery.mcpServerStatus(),
  ]);

  if (initResult.status === "fulfilled") {
    diagnostics.slashCommands = initResult.value.commands.map((command) => ({
      name: command.name,
      description: command.description,
    }));
  } else {
    diagnostics.initError = initResult.reason instanceof Error
      ? initResult.reason.message
      : String(initResult.reason);
  }

  if (mcpStatusResult.status === "fulfilled") {
    diagnostics.mcpServerStatus = mcpStatusResult.value;
  } else {
    diagnostics.mcpStatusError = mcpStatusResult.reason instanceof Error
      ? mcpStatusResult.reason.message
      : String(mcpStatusResult.reason);
  }

  await options.onSdkDiagnostics(diagnostics);
}

export async function canUseTool(
  toolName: string,
  input: Record<string, unknown> = {},
): Promise<PermissionResult> {
  if (isKrwOntologySdkTool(toolName)) {
    const mcpToolName = normalizeMcpToolName(toolName);
    return allowWithFullResponseDetailDowngrade(mcpToolName, input);
  }

  return {
    behavior: "deny",
    message: "Only read-only KRW Ontology MCP tools are allowed in web chat.",
  };
}

function allowedSdkToolsForResearchMode(mode: ResearchMode): string[] {
  const allowedMcpTools = new Set(getAllowedMcpToolsForResearchMode(mode));
  return KRW_ONTOLOGY_SDK_ALLOWED_TOOLS.filter((toolName) => {
    const mcpToolName = normalizeMcpToolName(toolName);
    return Boolean(mcpToolName && allowedMcpTools.has(mcpToolName));
  });
}

function createToolPermissionGuard(
  acc: AccumulatedRun,
  mode: ResearchMode,
  budget: ResearchModeToolBudget,
) {
  return async (
    toolName: string,
    input: Record<string, unknown> = {},
  ): Promise<PermissionResult> => {
    if (!isKrwOntologySdkTool(toolName)) {
      return {
        behavior: "deny",
        message: "Only read-only KRW Ontology MCP tools are allowed in web chat.",
      };
    }

    const mcpToolName = normalizeMcpToolName(toolName);
    if (!mcpToolName) {
      return {
        behavior: "deny",
        message: "Unknown KRW Ontology MCP tool.",
      };
    }

    const allowedMcpTools = new Set(getAllowedMcpToolsForResearchMode(mode));
    if (!allowedMcpTools.has(mcpToolName)) {
      return {
        behavior: "deny",
        message: `Research mode ${mode} does not allow ${mcpToolName}.`,
      };
    }

    const queryContextCalls = countToolCalls(acc.toolCalls, "krw_ontology_query_context");
    if (queryContextCalls === 0 && mcpToolName !== "krw_ontology_query_context") {
      return {
        behavior: "deny",
        message: "Call krw_ontology_query_context first before using follow-up tools.",
      };
    }

    const researchStatePolicy = toolPolicyFromLatestQueryContext(acc);
    if (researchStatePolicy?.blockedTools.has(mcpToolName)) {
      return {
        behavior: "deny",
        message: `query_context research state says not to call ${mcpToolName}.`,
      };
    }
    if (
      researchStatePolicy &&
      !researchStatePolicy.allowedTools.has(mcpToolName) &&
      mcpToolName !== "krw_ontology_query_context"
    ) {
      return {
        behavior: "deny",
        message:
          researchStatePolicy.reason ||
          `query_context research state does not allow ${mcpToolName}.`,
      };
    }

    const projectedCalls = [...acc.toolCalls, { toolName: mcpToolName }];
    const violation = toolBudgetViolation(
      projectedCalls as Array<Pick<AccumulatedToolCall, "toolName">>,
      budget,
      mcpToolName,
    );
    if (violation) {
      return {
        behavior: "deny",
        message: buildToolBudgetDenyMessage(violation),
      };
    }

    return allowWithFullResponseDetailDowngrade(mcpToolName, input);
  };
}

const RESPONSE_DETAIL_TOOL_SET = new Set<MCPToolName>([
  "krw_ontology_query",
  "krw_ontology_retrieve",
  "krw_ontology_compare",
]);

function downgradeFullResponseDetailInput(
  mcpToolName: MCPToolName | null,
  input: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!mcpToolName || !RESPONSE_DETAIL_TOOL_SET.has(mcpToolName)) return null;
  if (input.response_detail !== "full") return null;
  return {
    ...input,
    response_detail: "compact",
  };
}

function allowWithFullResponseDetailDowngrade(
  mcpToolName: MCPToolName | null,
  input: Record<string, unknown>,
): PermissionResult {
  const updatedInput = downgradeFullResponseDetailInput(mcpToolName, input);
  if (updatedInput) {
    return {
      behavior: "allow",
      updatedInput,
    };
  }
  return { behavior: "allow" };
}

function toolBudgetViolation(
  toolCalls: Array<Pick<AccumulatedToolCall, "toolName">>,
  budget: ResearchModeToolBudget,
  attemptedTool?: MCPToolName,
): ToolBudgetViolation | null {
  const usage = toolBudgetUsage(toolCalls);
  const remaining = remainingToolBudget(usage, budget);
  const attempted =
    attemptedTool ?? toolCalls.at(-1)?.toolName ?? "krw_ontology_query_context";

  if (usage.total > budget.maxToolCalls) {
    return {
      kind: "max_tool_calls",
      attemptedTool: attempted,
      usage,
      remaining,
    };
  }
  if (usage.queryContext > budget.queryContext) {
    return {
      kind: "query_context",
      attemptedTool: attempted,
      usage,
      remaining,
    };
  }
  if (usage.query > budget.query) {
    return {
      kind: "query",
      attemptedTool: attempted,
      usage,
      remaining,
    };
  }
  if (usage.retrieve > budget.retrieve) {
    return {
      kind: "retrieve",
      attemptedTool: attempted,
      usage,
      remaining,
    };
  }
  if (usage.compare > budget.compare) {
    return {
      kind: "compare",
      attemptedTool: attempted,
      usage,
      remaining,
    };
  }

  if (usage.traceChain > budget.traceChain) {
    return {
      kind: "trace_chain",
      attemptedTool: attempted,
      usage,
      remaining,
    };
  }

  return null;
}

function toolBudgetUsage(
  toolCalls: Array<Pick<AccumulatedToolCall, "toolName">>,
): ToolBudgetUsage {
  return {
    total: toolCalls.length,
    queryContext: countToolCalls(toolCalls, "krw_ontology_query_context"),
    query: countToolCalls(toolCalls, "krw_ontology_query"),
    retrieve: countToolCalls(toolCalls, "krw_ontology_retrieve"),
    traceChain:
      countToolCalls(toolCalls, "krw_ontology_trace") +
      countToolCalls(toolCalls, "krw_ontology_chain"),
    compare: countToolCalls(toolCalls, "krw_ontology_compare"),
  };
}

function remainingToolBudget(
  usage: ToolBudgetUsage,
  budget: ResearchModeToolBudget,
): ToolBudgetUsage {
  return {
    total: Math.max(0, budget.maxToolCalls - usage.total),
    queryContext: Math.max(0, budget.queryContext - usage.queryContext),
    query: Math.max(0, budget.query - usage.query),
    retrieve: Math.max(0, budget.retrieve - usage.retrieve),
    traceChain: Math.max(0, budget.traceChain - usage.traceChain),
    compare: Math.max(0, budget.compare - usage.compare),
  };
}

function hasRemainingToolBudget(
  violation: ToolBudgetViolation,
  bucket: keyof ToolBudgetUsage,
): boolean {
  return violation.remaining.total > 0 && violation.remaining[bucket] > 0;
}

function buildToolBudgetDenyMessage(
  violation: ToolBudgetViolation,
): string {
  const finalAnswerGuidance =
    "Otherwise write the final Korean Markdown answer from the evidence already collected.";

  if (violation.kind === "max_tool_calls") {
    return [
      "No more KRW Ontology MCP tools can be called in this run.",
      "Do not call another tool.",
      "Write the final Korean Markdown answer from the evidence already collected.",
    ].join(" ");
  }

  if (violation.kind === "compare") {
    return [
      "The krw_ontology_compare limit for this run has been reached.",
      "Do not call krw_ontology_compare again.",
      "Use existing comparison evidence.",
      hasRemainingToolBudget(violation, "query")
        ? "If one narrow missing fact remains, use one targeted krw_ontology_query."
        : null,
      finalAnswerGuidance,
    ].filter(Boolean).join(" ");
  }

  if (violation.kind === "query") {
    return [
      "The krw_ontology_query limit for this run has been reached.",
      "Do not call krw_ontology_query again.",
      "Use the existing research evidence.",
      hasRemainingToolBudget(violation, "traceChain")
        ? "If a specific existing claim needs verification, use one krw_ontology_trace or krw_ontology_chain call."
        : null,
      finalAnswerGuidance,
    ].filter(Boolean).join(" ");
  }

  if (violation.kind === "trace_chain") {
    return [
      "The trace/chain limit for this run has been reached.",
      "Do not call krw_ontology_trace or krw_ontology_chain again.",
      "Use existing traced evidence and write the final Korean Markdown answer.",
    ].join(" ");
  }

  if (violation.kind === "retrieve") {
    return [
      "The krw_ontology_retrieve limit for this run has been reached.",
      "Do not call krw_ontology_retrieve again.",
      "Use query_context, query, trace, and chain evidence already collected.",
      hasRemainingToolBudget(violation, "query")
        ? "If one narrow missing fact remains, use one targeted krw_ontology_query."
        : null,
      finalAnswerGuidance,
    ].filter(Boolean).join(" ");
  }

  return [
    "The krw_ontology_query_context limit for this run has been reached.",
    "Do not call krw_ontology_query_context again.",
    "Use the existing research state.",
    hasRemainingToolBudget(violation, "query")
      ? "If one narrow missing fact remains, use one targeted krw_ontology_query."
      : null,
    finalAnswerGuidance,
  ].filter(Boolean).join(" ");
}

function describeToolBudgetViolation(
  violation: ToolBudgetViolation,
): string {
  return `${violation.kind}:${violation.attemptedTool}`;
}

function countToolCalls(
  toolCalls: Array<Pick<AccumulatedToolCall, "toolName">>,
  toolName: MCPToolName,
): number {
  return toolCalls.filter((toolCall) => toolCall.toolName === toolName).length;
}

function toolPolicyFromLatestQueryContext(acc: AccumulatedRun): {
  allowedTools: Set<MCPToolName>;
  blockedTools: Set<MCPToolName>;
  reason: string | null;
} | null {
  const queryContextCall = [...acc.toolCalls]
    .reverse()
    .find((toolCall) => toolCall.toolName === "krw_ontology_query_context");
  if (!queryContextCall?.resultJson && !queryContextCall?.resultText) return null;

  const payload = coerceRecord(
    queryContextCall.resultJson,
    queryContextCall.resultText,
  );
  if (!payload) return null;

  const agentAutonomy =
    coerceRecord(payload.agent_autonomy) ||
    coerceRecord(getNested(payload, ["kernel", "agent_autonomy"])) ||
    coerceRecord(getNested(payload, ["research_pack", "agent_autonomy"]));
  const kernel = coerceRecord(payload.kernel);
  const status = stringValue(payload.research_status) || stringValue(kernel?.status);
  const allowedRaw =
    arrayValue(agentAutonomy?.allowed_next_tools) ||
    arrayValue(kernel?.allowed_next_tools) ||
    arrayValue(getNested(payload, ["context_policy", "allowed_next_tools"]));
  const doNotCallRaw =
    arrayValue(agentAutonomy?.do_not_call) ||
    arrayValue(kernel?.do_not_call) ||
    arrayValue(getNested(payload, ["context_policy", "do_not_call"]));
  const mayContinue = agentAutonomy?.may_continue_research;
  const blockedTools = new Set<MCPToolName>();

  for (const item of doNotCallRaw ?? []) {
    for (const mappedTool of mcpToolsFromPolicyValue(item)) {
      blockedTools.add(mappedTool);
    }
  }

  if (mayContinue === false) {
    return {
      allowedTools: new Set<MCPToolName>(),
      blockedTools,
      reason: "query_context says the research state is sufficient; answer without more MCP calls.",
    };
  }

  if (!allowedRaw) {
    return null;
  }

  const allowedTools = new Set<MCPToolName>();
  for (const item of allowedRaw) {
    for (const mappedTool of mcpToolsFromPolicyValue(item)) {
      allowedTools.add(mappedTool);
    }
  }

  if (
    allowedTools.size === 0 &&
    (status === "sufficient_for_default_answer" ||
      status === "out_of_scope_for_filing_ontology")
  ) {
    return {
      allowedTools,
      blockedTools,
      reason: "query_context says the research state is sufficient; answer without more MCP calls.",
    };
  }

  return {
    allowedTools,
    blockedTools,
    reason: null,
  };
}

function mcpToolsFromPolicyValue(value: unknown): MCPToolName[] {
  if (typeof value !== "string") return [];
  const normalized = value.trim().toLowerCase();
  if (!normalized) return [];

  const direct = normalizeMcpToolName(normalized);
  if (direct) return [direct];

  if (normalized === "trace") return ["krw_ontology_trace"];
  if (normalized === "chain") return ["krw_ontology_chain"];
  if (normalized === "query") return ["krw_ontology_query"];
  if (normalized === "retrieve" || normalized === "broad_retrieve") {
    return ["krw_ontology_retrieve"];
  }
  if (normalized === "compare") return ["krw_ontology_compare"];
  if (normalized === "quality") return ["krw_ontology_quality"];
  if (normalized === "catalog") return ["krw_ontology_catalog"];
  if (normalized === "company_context") return ["krw_ontology_company_context"];
  if (normalized === "index_context") return ["krw_ontology_index_context"];
  if (normalized === "topic_map") return ["krw_ontology_topic_map"];
  if (normalized === "plan_query") return ["krw_ontology_plan_query"];

  return [];
}

function coerceRecord(
  value: unknown,
  fallbackText?: string | null,
): Record<string, unknown> | null {
  if (isRecord(value)) return value;
  if (!fallbackText) return null;

  try {
    const parsed = JSON.parse(fallbackText);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getNested(
  value: Record<string, unknown>,
  pathParts: string[],
): unknown {
  let current: unknown = value;
  for (const part of pathParts) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function arrayValue(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

async function getCompanyPromptContexts(
  tickers: string[],
): Promise<CompanyPromptContext[]> {
  const uniqueTickers = Array.from(
    new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean)),
  );

  const companies = await Promise.all(
    uniqueTickers.map((ticker) => getIndexedCompany(ticker)),
  );

  return companies
    .filter((company): company is NonNullable<typeof company> => Boolean(company))
    .map((company) => ({
      ticker: company.ticker,
      documentTypes: company.document_types,
      latestPeriod: company.latest_period,
      latestPeriods: company.periods.slice(0, 6),
      indexedFilingCount: company.document_count,
    }));
}

async function consumeSdkMessage(params: {
  message: SDKMessage;
  acc: AccumulatedRun;
  openToolCalls: Set<string>;
  sendEvent: (event: Parameters<ReturnType<typeof createSSEWriter>["sendEvent"]>[0], data: unknown) => Promise<void>;
  onTextDelta?: (delta: string, fullText: string) => Promise<void>;
  onToolCallStart?: (toolCall: AccumulatedToolCall) => Promise<void>;
  onToolCallEnd?: (toolCall: AccumulatedToolCall) => Promise<void>;
  onCitation?: (citation: StreamingCitation) => Promise<void>;
  passName: "research" | "composer";
  suppressTextDeltas?: boolean;
}) {
  const {
    message,
    acc,
    openToolCalls,
    sendEvent,
    onTextDelta,
    onToolCallStart,
    onToolCallEnd,
    onCitation,
    passName,
    suppressTextDeltas,
  } = params;

  if (message.type === "assistant") {
    const blocks = getContentBlocks(message.message);
    const containsToolUse = blocks.some((block) => block.type === "tool_use");

    for (const block of blocks) {
      if (block.type === "text" && typeof block.text === "string") {
        if (containsToolUse || suppressTextDeltas) continue;
        addToken(acc, block.text);
        await onTextDelta?.(block.text, acc.fullText);
        await sendEvent("token", { text: block.text });
      }

      if (block.type === "tool_use") {
        const toolName = normalizeMcpToolName(block.name);
        if (!toolName) continue;

        const toolCallId =
          typeof block.id === "string" ? block.id : crypto.randomUUID();
        const rawInput = isRecord(block.input) ? block.input : {};
        const input =
          downgradeFullResponseDetailInput(toolName, rawInput) ?? rawInput;

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
        toolResult.toolUseId !== null && openToolCalls.has(toolResult.toolUseId);

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

  if (toolUseResult) {
    const text = stringifyToolResult(toolUseResult);
    results.push({
      toolUseId: null,
      text,
      json: parseToolJson(text),
    });
  }

  for (const block of getContentBlocks(message.message)) {
    if (block.type !== "tool_result") continue;
    const text = stringifyToolResult(block.content);
    results.push({
      toolUseId: typeof block.tool_use_id === "string" ? block.tool_use_id : null,
      text,
      json: parseToolJson(text),
    });
  }

  return results.filter((result) => result.text.trim().length > 0);
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
  if (typeof name !== "string") return null;
  const bareName = name.includes("__") ? name.split("__").at(-1) : name;
  if (!bareName || !MCP_TOOL_SET.has(bareName)) return null;
  return bareName as MCPToolName;
}

function closeOpenToolCalls(
  acc: AccumulatedRun,
  openToolCalls: Set<string>,
  passName: "research" | "composer",
) {
  const closed: AccumulatedToolCall[] = [];
  for (const toolCallId of openToolCalls) {
    const toolCall = endToolCall(acc, toolCallId, "Completed by KRW-AI Agent SDK", null);
    if (toolCall) {
      closed.push(toolCall);
    }
    logToolDuration(acc, toolCallId, passName, "closed");
  }
  openToolCalls.clear();
  return closed;
}

function toolCallDurationMs(acc: AccumulatedRun, toolCallId: string): number {
  const toolCall = acc.toolCalls.find((tc) => tc.id === toolCallId);
  if (!toolCall) return 0;
  return Date.now() - new Date(toolCall.startedAt).getTime();
}

function logToolDuration(
  acc: AccumulatedRun,
  toolCallId: string,
  passName: "research" | "composer",
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
} {
  if (message.type !== "result") {
    return { inputTokens: 0, outputTokens: 0 };
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

  return {
    inputTokens: usageInput ?? 0,
    outputTokens: usageOutput ?? 0,
  };
}

function modelFromSdkMessage(message: SDKMessage): string | null {
  if (message.type === "assistant" && isRecord(message.message)) {
    return typeof message.message.model === "string" ? message.message.model : null;
  }

  if (message.type === "result") {
    const record = message as UnknownRecord;
    return typeof record.model === "string" ? record.model : null;
  }

  return null;
}

function sumModelUsage(
  modelUsage: UnknownRecord,
  field: "inputTokens" | "outputTokens",
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
  if (code === "claude_rate_limited") {
    return "현재 KRW-AI 계정/API 요청 한도에 도달했습니다. 잠시 후 다시 시도하거나, 실제 ANTHROPIC_API_KEY를 설정한 뒤 서버를 재시작해주세요.";
  }
  if (code === "auth_required") {
    return "KRW-AI 인증 정보가 서버 실행 환경에 없거나 유효하지 않습니다. 서버에서 KRW-AI 인증을 마친 뒤 앱 컨테이너가 그 실행 파일과 설정을 볼 수 있게 재시작해주세요.";
  }
  if (code === "mcp_unavailable") {
    return "온톨로지 도구 연결을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.";
  }

  if (process.env.NODE_ENV !== "production") {
    console.warn("[krw-ai-agent-sdk] execution failed", rawMessage);
  }
  return "에이전트 실행 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.";
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

function extractCitations(
  acc: AccumulatedRun,
  resultContent: string,
  parsedResult: unknown = null,
) {
  try {
    const data = normalizeCitationPayload(parsedResult ?? resultContent);
    if (!isRecord(data)) return;

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
