import "server-only";

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
import {
  buildResearchPrompt,
  buildSystemPrompt,
  type CompanyPromptContext,
} from "./system-prompt";
import { getIndexedCompany } from "@/lib/ontology/catalog";
import {
  createAccumulator,
  createSSEWriter,
  addToken,
  startToolCall,
  endToolCall,
  addCitation,
  setUsage,
  type AccumulatedRun,
  type StreamWriter,
} from "./stream-handler";
import type { MCPToolName, DocumentType } from "@/types/api-contracts";

const MCP_TOOL_SET = new Set<string>(KRW_ONTOLOGY_MCP_TOOLS);
const DEFAULT_MAX_TURNS = 20;
const DEFAULT_AGENT_CWD = "~/krw-ontology";

export interface AgentRunOptions {
  sessionId: string;
  userMessage: string;
  scopeType: "global" | "company";
  defaultTickers: string[];
  defaultDocumentTypes: string[];
  history?: Array<{ role: string; content: string }>;
  abortSignal?: AbortSignal;
  onSdkDiagnostics?: (diagnostics: SdkDiagnostics) => Promise<void>;
}

export interface AgentRunResult {
  acc: AccumulatedRun;
  status: "completed" | "cancelled" | "failed";
  errorCode?: string;
  errorMessage?: string;
}

type UnknownRecord = Record<string, unknown>;

export interface SdkDiagnostics {
  requestedModel?: string;
  observedModels?: string[];
  cwd?: string;
  pluginPath?: string;
  promptPreview?: string;
  permissionMode?: string;
  settingSources?: string[];
  tools?: unknown;
  allowedTools?: string[];
  plugins?: unknown;
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
  const cwd = process.env.CLAUDE_AGENT_CWD || DEFAULT_AGENT_CWD;
  const abortController = new AbortController();

  const abortHandler = () => abortController.abort();
  options.abortSignal?.addEventListener("abort", abortHandler, { once: true });

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
  const prompt = buildResearchPrompt(options.userMessage);

  const requestedModel = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
  const sdkOptions: Options = {
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
    maxTurns: Number(process.env.CLAUDE_AGENT_MAX_TURNS ?? DEFAULT_MAX_TURNS),
    includePartialMessages: false,
    abortController,
    env: buildClaudeAgentEnv(),
    ...(shouldResume
      ? { resume: options.sessionId }
      : { sessionId: options.sessionId }),
  };

  const openToolCalls = new Set<string>();
  const observedModels = new Set<string>();
  let finalResult: AgentRunResult | null = null;

  try {
    const sdkQuery = query({ prompt, options: sdkOptions });
    await reportSdkInitialization({
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
          observedModels: Array.from(observedModels),
          observedAt: new Date().toISOString(),
        });
      }

      await consumeSdkMessage({
        message,
        acc,
        openToolCalls,
        sendEvent,
      });

      if (message.type === "result") {
        closeOpenToolCalls(acc, openToolCalls);

        if (message.subtype === "success") {
          const resultText = typeof message.result === "string" ? message.result : "";
          if (!acc.fullText.trim() && resultText.trim()) {
            addToken(acc, resultText);
            await sendEvent("token", { text: resultText });
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

async function reportSdkInitialization(params: {
  sdkQuery: ReturnType<typeof query>;
  options: AgentRunOptions;
  requestedModel: string;
  cwd: string;
  pluginPath: string;
  prompt: string;
  sdkOptions: Options;
}) {
  const {
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
    requestedModel,
    cwd,
    pluginPath,
    promptPreview: prompt.slice(0, 500),
    permissionMode: sdkOptions.permissionMode,
    settingSources: sdkOptions.settingSources,
    tools: sdkOptions.tools,
    allowedTools: sdkOptions.allowedTools,
    plugins: sdkOptions.plugins,
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

async function canUseTool(
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

function buildClaudeAgentEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_AGENT_SDK_CLIENT_APP: "krw-ontology-front/0.1.0",
  };

  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey || apiKey === "sk-placeholder" || apiKey === "sk-ant-...") {
    delete env.ANTHROPIC_API_KEY;
  }

  return env;
}

async function consumeSdkMessage(params: {
  message: SDKMessage;
  acc: AccumulatedRun;
  openToolCalls: Set<string>;
  sendEvent: (event: Parameters<ReturnType<typeof createSSEWriter>["sendEvent"]>[0], data: unknown) => Promise<void>;
}) {
  const { message, acc, openToolCalls, sendEvent } = params;

  if (message.type === "assistant") {
    for (const block of getContentBlocks(message.message)) {
      if (block.type === "text" && typeof block.text === "string") {
        addToken(acc, block.text);
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
          startToolCall(acc, toolCallId, toolName, input);
          await sendEvent("tool_call_start", {
            tool_call_id: toolCallId,
            tool_name: toolName,
            arguments: input,
          });
        }
      }
    }
  }

  if (message.type === "user") {
    for (const toolResult of extractToolResultTexts(message)) {
      const prevCitationCount = acc.citations.length;
      extractCitations(acc, toolResult);
      for (let i = prevCitationCount; i < acc.citations.length; i++) {
        await sendEvent("citation", acc.citations[i]);
      }
    }
  }

  if (message.type === "tool_progress") {
    const toolName = normalizeMcpToolName(message.tool_name);
    if (!toolName) return;

    if (!openToolCalls.has(message.tool_use_id)) {
      openToolCalls.add(message.tool_use_id);
      startToolCall(acc, message.tool_use_id, toolName, {});
      await sendEvent("tool_call_start", {
        tool_call_id: message.tool_use_id,
        tool_name: toolName,
        arguments: {},
      });
    }
  }

  if (message.type === "tool_use_summary") {
    for (const toolUseId of message.preceding_tool_use_ids) {
      if (!openToolCalls.has(toolUseId)) continue;
      openToolCalls.delete(toolUseId);
      endToolCall(acc, toolUseId, message.summary, null);
      await sendEvent("tool_call_end", {
        tool_call_id: toolUseId,
        result_summary: message.summary.slice(0, 2000),
        error_message: null,
        duration_ms: toolCallDurationMs(acc, toolUseId),
      });
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

function extractToolResultTexts(message: SDKMessage): string[] {
  if (message.type !== "user") return [];

  const texts: string[] = [];
  const toolUseResult = message.tool_use_result;

  if (toolUseResult) {
    texts.push(stringifyToolResult(toolUseResult));
  }

  for (const block of getContentBlocks(message.message)) {
    if (block.type !== "tool_result") continue;
    texts.push(stringifyToolResult(block.content));
  }

  return texts.filter((text) => text.trim().length > 0);
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

function normalizeMcpToolName(name: unknown): MCPToolName | null {
  if (typeof name !== "string") return null;
  const bareName = name.includes("__") ? name.split("__").at(-1) : name;
  if (!bareName || !MCP_TOOL_SET.has(bareName)) return null;
  return bareName as MCPToolName;
}

function closeOpenToolCalls(
  acc: AccumulatedRun,
  openToolCalls: Set<string>,
) {
  for (const toolCallId of openToolCalls) {
    endToolCall(acc, toolCallId, "Completed by Claude Agent SDK", null);
  }
  openToolCalls.clear();
}

function toolCallDurationMs(acc: AccumulatedRun, toolCallId: string): number {
  const toolCall = acc.toolCalls.find((tc) => tc.id === toolCallId);
  if (!toolCall) return 0;
  return Date.now() - new Date(toolCall.startedAt).getTime();
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

  return rawMessage;
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
  });
}

function extractCitations(acc: AccumulatedRun, resultContent: string) {
  try {
    const data: unknown = JSON.parse(resultContent);
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
