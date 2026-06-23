import { sanitizeAssistantContent } from "@/lib/chat/assistant-content";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";

export interface FilingAnchorContext {
  latestAvailable: string | null;
  currentDriver: string | null;
  annualBaseline: string | null;
  historicalContext: string[];
}

export interface CompanyPromptContext {
  ticker: string;
  documentTypes: string[];
  latestPeriod: string | null;
  latestPeriods: string[];
  indexedFilingCount: number;
  filingAnchor?: FilingAnchorContext;
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
  responseLocale?: Locale;
}

export const MAX_PROMPT_HISTORY_MESSAGES = 12;
export const MAX_PROMPT_HISTORY_MESSAGE_CHARS = 8_000;
export const MAX_PROMPT_HISTORY_CONTEXT_CHARS = 48_000;
const RUNTIME_TIME_ZONE = "Asia/Seoul";

type PromptHistoryMessage = { role: string; content: string };

export function buildSystemPrompt(
  context?: PromptContext,
  history: PromptHistoryMessage[] = [],
  features: PromptRuntimeFeatures = {},
): string {
  const contextBlock = context ? `\n\n${buildRuntimeContext(context, history)}` : "";
  const stockNewsPolicy = buildStockNewsPolicy(features);
  const responseLanguagePolicy = buildResponseLanguagePolicy(
    features.responseLocale ?? DEFAULT_LOCALE,
  );
  const runtimeDatePolicy = buildRuntimeDatePolicy();

  return `You are the KRW Ontology web chat runtime.

The user prompt begins with the exact KRW-AI skill command for the active pass. Follow that skill.
Use configured read-only KRW Ontology tools for filing evidence retrieval and, when explicitly enabled, the configured read-only stock-news MCP tool for current context.
${stockNewsPolicy}
${responseLanguagePolicy}
${runtimeDatePolicy}
Use the runtime context only as scope and history for that active pass.
Return only the final user-visible answer in Markdown. Do not include tool-use narration, hidden planning notes, or progress phrases such as "I will query", "Let me get", "Let me verify", "Now let me", or "I'll check". Do not expose internal provenance labels such as "verified by trace", "trace", "chain", "query_context", "tool", or "MCP".${contextBlock}`;
}

function buildRuntimeDatePolicy(now = new Date()): string {
  return [
    `Runtime as-of date: ${formatDateInTimeZone(now, RUNTIME_TIME_ZONE)}`,
    `Runtime timezone: ${RUNTIME_TIME_ZONE}`,
    "The runtime date is temporal context only. It does not prove that a filing, earnings release, or reporting period exists.",
    "Use an explicit period label only when it appears in the Company filing anchor, retrieved evidence, or the user's request.",
    'Never invent an unconfirmed future period label. Refer to unpublished or unconfirmed future evidence relatively, such as "the next earnings release", "a future filing", or "the next results update", including in tables and follow-up prompts.',
  ].join("\n");
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  if (!year || !month || !day) {
    throw new Error(`Unable to format runtime date for ${timeZone}`);
  }

  return `${year}-${month}-${day}`;
}

function buildStockNewsPolicy(features: PromptRuntimeFeatures): string {
  const responseLocale = features.responseLocale ?? DEFAULT_LOCALE;
  const investorInterpretation =
    responseLocale === "en"
      ? "English investor interpretation"
      : "Korean investor interpretation";

  if (features.stockNewsEnabled) {
    return [
      "Do not use built-in WebSearch or WebFetch.",
      features.stockNewsRequired
        ? "This run is in news mode: use only the configured read-only Stock News MCP tool for current news/event discovery before the final answer."
        : "When recent, current, post-filing, or explicitly news-based context is needed, use only the configured read-only Stock News MCP tool.",
      `Preserve filing-vs-news source provenance internally, but synthesize both into one ${investorInterpretation} in the final answer.`,
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

function buildResponseLanguagePolicy(responseLocale: Locale): string {
  if (responseLocale === "en") {
    return "Final user-visible answers must be English Markdown only. Keep internal evidence-retrieval briefs in English as needed, and do not answer in Korean.";
  }

  return "Final user-visible answers must be Korean Markdown only. Internal evidence-retrieval briefs may be English, but do not expose them.";
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
          .map(formatCompanyContext)
          .join("\n")}`
      : "";
  const historyContext = buildHistoryContext(history);

  return `<web_runtime_context>
${scopeContext}${docTypeContext}
${companyCatalogContext}${historyContext}
</web_runtime_context>`;
}

function formatCompanyContext(company: CompanyPromptContext): string {
  const base = `- ${company.ticker}: ${company.indexedFilingCount} indexed filings; document types: ${company.documentTypes.join(", ") || "unknown"}; latest period: ${company.latestPeriod ?? "unknown"}; recent periods: ${company.latestPeriods.join(", ") || "unknown"}.`;
  const anchor = company.filingAnchor;
  if (!anchor) return base;

  return [
    base,
    `  Company filing anchor: latest available filing: ${anchor.latestAvailable ?? "unknown"}; current driver: ${anchor.currentDriver ?? "unknown"}; annual baseline: ${anchor.annualBaseline ?? "unknown"}; historical context: ${anchor.historicalContext.join(", ") || "none"}.`,
    `  Confirmed recent filing periods: ${company.latestPeriods.join(", ") || "none"}.`,
    "  Anchor instruction: Start current company and investment-decision judgments from Current driver. Use Annual baseline only for annual business mix, historical trend, and risk baseline. Use Historical context only for cycle comparison or change over time.",
    "  Period boundary instruction: Do not infer a newer filing or period from the runtime date. Treat only periods listed here, returned by tools, or explicitly supplied by the user as confirmed.",
  ].join("\n");
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
