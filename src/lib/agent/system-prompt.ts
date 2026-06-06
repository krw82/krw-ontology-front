import { sanitizeAssistantContent } from "@/lib/chat/assistant-content";

export interface CompanyPromptContext {
  ticker: string;
  documentTypes: string[];
  latestPeriod: string | null;
  latestPeriods: string[];
  indexedFilingCount: number;
}

export interface PromptContext {
  scopeType: "global" | "company";
  defaultTickers: string[];
  defaultDocumentTypes: string[];
  companies?: CompanyPromptContext[];
}

export interface PromptRuntimeFeatures {
  stockNewsEnabled?: boolean;
  stockNewsRequired?: boolean;
  stockNewsUnavailableForNews?: boolean;
}

export const MAX_PROMPT_HISTORY_MESSAGES = 12;
export const MAX_PROMPT_HISTORY_MESSAGE_CHARS = 8_000;
export const MAX_PROMPT_HISTORY_CONTEXT_CHARS = 48_000;

type PromptHistoryMessage = { role: string; content: string };

export function buildSystemPrompt(
  context?: PromptContext,
  history: PromptHistoryMessage[] = [],
  features: PromptRuntimeFeatures = {},
): string {
  const contextBlock = context ? `\n\n${buildRuntimeContext(context, history)}` : "";
  const stockNewsPolicy = buildStockNewsPolicy(features);

  return `You are the KRW Ontology web chat runtime.

The user prompt begins with the exact KRW-AI skill command for the active pass. Follow that skill.
Use configured read-only KRW Ontology tools for filing evidence retrieval and, when explicitly enabled, the configured read-only stock-news MCP tool for current context.
${stockNewsPolicy}
Use the runtime context only as scope and history for that active pass.
Return only the final user-visible answer in Markdown. Do not include tool-use narration, hidden planning notes, or progress phrases such as "I will query", "Let me get", or "I'll check".${contextBlock}`;
}

function buildStockNewsPolicy(features: PromptRuntimeFeatures): string {
  if (features.stockNewsEnabled) {
    return [
      "Do not use built-in WebSearch or WebFetch.",
      features.stockNewsRequired
        ? "This run is in news mode: use only the configured read-only Stock News MCP tool for current news/event discovery before the final answer."
        : "When recent, current, post-filing, or explicitly news-based context is needed, use only the configured read-only Stock News MCP tool.",
      "Preserve filing-vs-news source provenance internally, but synthesize both into one Korean investor interpretation in the final answer.",
      "If the stock-news MCP call fails, times out, or returns no useful results, continue from filing evidence and state that no additional current news context was confirmed.",
    ].join("\n");
  }

  if (features.stockNewsUnavailableForNews) {
    return [
      "Do not use built-in WebSearch or WebFetch.",
      "The user selected news mode, but the configured stock-news MCP tool is unavailable in this runtime.",
      "Do not attempt current-news search. Continue from filing evidence and state that current news context could not be checked.",
    ].join("\n");
  }

  return "Do not perform web searches or mutate local files.";
}

function buildRuntimeContext(
  context: PromptContext,
  history: PromptHistoryMessage[],
): string {
  const scopeContext =
    context.scopeType === "company" && context.defaultTickers.length > 0
      ? `The user is researching specific companies: ${context.defaultTickers.join(", ")}. Default to this company context unless the user explicitly asks about other companies.`
      : "The user may ask about any company in the KRW Ontology. Search broadly as needed.";

  const docTypeContext =
    context.defaultDocumentTypes && context.defaultDocumentTypes.length > 0
      ? `\nPreferred document types: ${context.defaultDocumentTypes.join(", ")}.`
      : "";
  const companyCatalogContext =
    context.companies && context.companies.length > 0
      ? `\nCompany catalog context:\n${context.companies
          .map(
            (company) =>
              `- ${company.ticker}: ${company.indexedFilingCount} indexed filings; document types: ${company.documentTypes.join(", ") || "unknown"}; latest period: ${company.latestPeriod ?? "unknown"}; recent periods: ${company.latestPeriods.join(", ") || "unknown"}.`,
          )
          .join("\n")}`
      : "";
  const historyContext = buildHistoryContext(history);

  return `<web_runtime_context>
${scopeContext}${docTypeContext}
${companyCatalogContext}${historyContext}
</web_runtime_context>`;
}

function buildHistoryContext(
  history: PromptHistoryMessage[],
): string {
  const compactHistory = sanitizePromptHistory(history);

  if (compactHistory.length === 0) return "";

  const transcript = compactHistory
    .map((message) => {
      const role = message.role === "assistant" ? "Assistant" : "User";
      return `${role}: ${message.content}`;
    })
    .join("\n\n");

  return `\n\nPrevious web chat context:\n${transcript}`;
}

export function sanitizePromptHistory(
  history: PromptHistoryMessage[],
): PromptHistoryMessage[] {
  const compactHistory = history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-MAX_PROMPT_HISTORY_MESSAGES);

  let remainingChars = MAX_PROMPT_HISTORY_CONTEXT_CHARS;
  const selected: PromptHistoryMessage[] = [];

  for (let index = compactHistory.length - 1; index >= 0; index--) {
    const message = compactHistory[index];
    if (!message || remainingChars <= 0) break;

    const perMessageLimit = Math.min(
      MAX_PROMPT_HISTORY_MESSAGE_CHARS,
      remainingChars,
    );
    const rawContent =
      message.role === "assistant"
        ? sanitizeAssistantContent(message.content)
        : message.content;
    const content = truncatePromptText(rawContent, perMessageLimit);
    if (!content) continue;

    selected.unshift({
      role: message.role,
      content,
    });
    remainingChars -= content.length;
  }

  return selected;
}

function truncatePromptText(value: string, maxChars: number): string {
  const normalized = value.trim();
  if (!normalized || maxChars <= 0) return "";
  if (normalized.length <= maxChars) return normalized;

  const suffix = "\n... [truncated]";
  if (maxChars <= suffix.length) return normalized.slice(0, maxChars);
  return `${normalized.slice(0, maxChars - suffix.length).trimEnd()}${suffix}`;
}
