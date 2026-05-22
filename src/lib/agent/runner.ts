import "server-only";

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

export interface AgentRunOptions {
  sessionId: string;
  userMessage: string;
  scopeType: "global" | "company";
  defaultTickers: string[];
  defaultDocumentTypes: string[];
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
  const researchPrompt = buildResearchPassPrompt(options.userMessage);

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
    allowedTools: KRW_ONTOLOGY_SDK_ALLOWED_TOOLS,
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
    });

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
      err instanceof Error ? err.message : "Unknown Claude Agent SDK error";
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
  } = params;
  const acc = createAccumulator();
  const openToolCalls = new Set<string>();
  let finalResult: AgentRunResult | null = null;

  try {
    const sdkQuery = query({ prompt, options: sdkOptions });
    await reportSdkInitialization({
      passName,
      sdkQuery,
      options,
      requestedModel,
      cwd,
      pluginPath,
      prompt,
      sdkOptions,
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
              : "Claude Agent SDK execution failed";
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
      err instanceof Error ? err.message : "Unknown Claude Agent SDK error";
    const errorCode = errorCodeFromMessage(rawErrorMessage);
    return {
      acc,
      status: "failed",
      errorCode,
      errorMessage: userFacingErrorMessage(errorCode, rawErrorMessage),
    };
  }
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
): Promise<PermissionResult> {
  if (isKrwOntologySdkTool(toolName)) {
    return { behavior: "allow" };
  }

  return {
    behavior: "deny",
    message: "Only read-only KRW Ontology MCP tools are allowed in web chat.",
  };
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
        const input = isRecord(block.input) ? block.input : {};

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
    const toolCall = endToolCall(acc, toolCallId, "Completed by Claude Agent SDK", null);
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
    return "현재 Claude Code 계정/API 요청 한도에 도달했습니다. 잠시 후 다시 시도하거나, 실제 ANTHROPIC_API_KEY를 설정한 뒤 서버를 재시작해주세요.";
  }
  if (code === "auth_required") {
    return "Claude Code 인증 정보가 서버 실행 환경에 없거나 유효하지 않습니다. 서버에서 Claude Code 인증을 마친 뒤 앱 컨테이너가 그 실행 파일과 설정을 볼 수 있게 재시작해주세요.";
  }
  if (code === "mcp_unavailable") {
    return "온톨로지 도구 연결을 확인하지 못했습니다. 잠시 후 다시 시도해주세요.";
  }

  if (process.env.NODE_ENV !== "production") {
    console.warn("[claude-agent-sdk] execution failed", rawMessage);
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
