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

export function buildSystemPrompt(
  context?: PromptContext,
  history: Array<{ role: string; content: string }> = [],
): string {
  const contextBlock = context ? `\n\n${buildRuntimeContext(context, history)}` : "";

  return `You are the KRW Ontology web chat runtime.

The user prompt begins with the exact Claude Code skill command for the active pass. Follow that skill.
Use only the configured read-only KRW Ontology tools for evidence retrieval.
Do not perform web searches or mutate local files.
Use the runtime context only as scope and history for that active pass.${contextBlock}`;
}

function buildRuntimeContext(
  context: PromptContext,
  history: Array<{ role: string; content: string }>,
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
  history: Array<{ role: string; content: string }>,
): string {
  const compactHistory = history
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-12);

  if (compactHistory.length === 0) return "";

  const transcript = compactHistory
    .map((message) => {
      const role = message.role === "assistant" ? "Assistant" : "User";
      return `${role}: ${message.content}`;
    })
    .join("\n\n");

  return `\n\nPrevious web chat context:\n${transcript}`;
}
