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
import { buildClaudeAgentEnv } from "./env";
import { requireEnv } from "@/lib/env";
import {
  buildSystemPrompt,
  type CompanyPromptContext,
} from "./system-prompt";
import {
  buildComposerPassPrompt,
  buildResearchPassPrompt,
} from "./workflow";
import {
  DISPLAY_PLAN_OUTPUT_SCHEMA,
  RESEARCH_SYNTHESIS_OUTPUT_SCHEMA,
  parseDisplayPlanOutput,
  parseDisplayPlanOutputText,
  parseResearchSynthesisOutput,
  parseResearchSynthesisOutputText,
} from "@/lib/artifacts/display-plan";
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

export interface SdkDiagnostics {
  passName?: "research" | "composer";
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
  const cwd = requireEnv("CLAUDE_AGENT_CWD");
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
    maxTurns: Number(process.env.CLAUDE_AGENT_MAX_TURNS ?? DEFAULT_MAX_TURNS),
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
        outputFormat: {
          type: "json_schema",
          schema: RESEARCH_SYNTHESIS_OUTPUT_SCHEMA,
        },
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
      suppressTextDeltas: true,
    });

    if (researchResult.status !== "completed") {
      return researchResult;
    }

    const researchSynthesis =
      parseResearchSynthesisOutput(researchResult.acc.structuredOutput) ??
      parseResearchSynthesisOutputText(serializePassOutput(researchResult.acc));
    if (!researchSynthesis) {
      if (researchResult.acc.fullText.trim()) {
        researchResult.acc.structuredOutput = null;
        researchResult.acc.researchSynthesisOutput = null;
        researchResult.acc.researchSynthesisText = null;
        return researchResult;
      }

      return {
        acc: researchResult.acc,
        status: "failed",
        errorCode: "claude_api_error",
        errorMessage:
          "리서치 단계에서 화면에 표시할 수 있는 구조화 결과를 받지 못했습니다.",
      };
    }
    researchResult.acc.researchSynthesisOutput = researchSynthesis;
    researchResult.acc.researchSynthesisText = JSON.stringify(researchSynthesis);

    await sendEvent("activity_update", {
      stage: "composing",
      label: "답변 구성 중",
    });
    const composerResult = await runSdkPass({
      passName: "composer",
      prompt: buildComposerPassPrompt({
        question: options.userMessage,
        research_synthesis: researchSynthesis,
        runtime: {
          supports_structured_output: true,
          language: inferRuntimeLanguage(options.userMessage),
        },
      }),
      sdkOptions: {
        ...baseSdkOptions,
        allowedTools: [],
        outputFormat: {
          type: "json_schema",
          schema: DISPLAY_PLAN_OUTPUT_SCHEMA,
        },
        resume: options.sessionId,
      },
      options,
      requestedModel,
      cwd,
      pluginPath,
      sendEvent,
      observedModels,
      suppressTextDeltas: true,
    });

    const displayPlan =
      parseDisplayPlanOutput(composerResult.acc.structuredOutput) ??
      parseDisplayPlanOutputText(serializePassOutput(composerResult.acc));
    if (displayPlan) {
      composerResult.acc.displayPlanOutput = displayPlan;
    }

    return {
      ...composerResult,
      acc: mergePassAccumulators(researchResult.acc, composerResult.acc),
    };
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
        suppressTextDeltas,
      });

      if (message.type === "result") {
        closeOpenToolCalls(acc, openToolCalls);

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

function serializePassOutput(acc: AccumulatedRun): string {
  if (acc.structuredOutput !== null && acc.structuredOutput !== undefined) {
    return JSON.stringify(acc.structuredOutput, null, 2);
  }

  return acc.fullText.trim();
}

function mergePassAccumulators(
  researchAcc: AccumulatedRun,
  composerAcc: AccumulatedRun,
): AccumulatedRun {
  return {
    ...composerAcc,
    fullText: researchAcc.fullText,
    structuredOutput: composerAcc.structuredOutput,
    researchSynthesisOutput:
      researchAcc.researchSynthesisOutput ?? researchAcc.structuredOutput,
    researchSynthesisText:
      researchAcc.researchSynthesisText ?? serializePassOutput(researchAcc),
    displayPlanOutput: composerAcc.displayPlanOutput ?? composerAcc.structuredOutput,
    toolCalls: [...researchAcc.toolCalls, ...composerAcc.toolCalls],
    citations: [...researchAcc.citations, ...composerAcc.citations],
    inputTokens: researchAcc.inputTokens + composerAcc.inputTokens,
    outputTokens: researchAcc.outputTokens + composerAcc.outputTokens,
  };
}

function inferRuntimeLanguage(userMessage: string): string {
  return /[가-힣]/.test(userMessage) ? "ko" : "en";
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

async function consumeSdkMessage(params: {
  message: SDKMessage;
  acc: AccumulatedRun;
  openToolCalls: Set<string>;
  sendEvent: (event: Parameters<ReturnType<typeof createSSEWriter>["sendEvent"]>[0], data: unknown) => Promise<void>;
  onTextDelta?: (delta: string, fullText: string) => Promise<void>;
  suppressTextDeltas?: boolean;
}) {
  const {
    message,
    acc,
    openToolCalls,
    sendEvent,
    onTextDelta,
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
    for (const toolResult of extractToolResults(message)) {
      const wasOpen =
        toolResult.toolUseId !== null && openToolCalls.has(toolResult.toolUseId);

      if (toolResult.toolUseId) {
        endToolCall(
          acc,
          toolResult.toolUseId,
          summarizeToolResult(toolResult.text),
          null,
          toolResult.json,
          toolResult.text,
        );

        if (wasOpen) {
          openToolCalls.delete(toolResult.toolUseId);
          await sendEvent("tool_call_end", {
            tool_call_id: toolResult.toolUseId,
            result_summary: summarizeToolResult(toolResult.text),
            error_message: null,
            duration_ms: toolCallDurationMs(acc, toolResult.toolUseId),
          });
        }
      }

      const prevCitationCount = acc.citations.length;
      extractCitations(acc, toolResult.text, toolResult.json);
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
  if (lower.includes("not logged in") || lower.includes("please run /login")) {
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
    return "Claude Code 인증 정보가 이 웹 앱 실행 환경에 전달되지 않았습니다. 터미널 Claude가 된다면 사용자 Claude 설정의 인증 env를 앱이 읽도록 서버를 재시작해주세요. 계속 실패하면 실제 ANTHROPIC_API_KEY를 .env.local에 설정하세요.";
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
    const data: unknown = parsedResult ?? JSON.parse(resultContent);
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
