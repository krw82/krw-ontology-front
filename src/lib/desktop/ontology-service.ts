import "server-only";

import {
  getActiveOntologyCatalogRelease,
  getIndexedCompanies,
  getIndexedCompany,
  searchIndexedCompanies,
  type IndexedCompany,
} from "@/lib/ontology/catalog";
import type { DesktopAuthContext } from "./auth";
import {
  DESKTOP_ONTOLOGY_API_VERSION,
  type DesktopErrorCode,
  type DesktopOntologyToolCallRequest,
  type DesktopOntologyToolCallSuccess,
} from "./ontology-contracts";
import {
  callKrwOntologyMcpTool,
  checkKrwOntologyMcpHealth,
  shouldUseDesktopOntologyMcp,
} from "./ontology-mcp-client";

const DEFAULT_MAX_RESULT_BYTES = 60_000;
const MAX_RESULT_TEXT_CHARS = 12_000;

export class DesktopOntologyServiceError extends Error {
  code: DesktopErrorCode;
  publicMessage: string;
  status: number;
  retryable: boolean;

  constructor(
    message: string,
    options: {
      code?: DesktopErrorCode;
      publicMessage?: string;
      status?: number;
      retryable?: boolean;
    } = {},
  ) {
    super(message);
    this.name = "DesktopOntologyServiceError";
    this.code = options.code ?? "ontology_unavailable";
    this.publicMessage = options.publicMessage ?? message;
    this.status = options.status ?? 503;
    this.retryable = Boolean(options.retryable);
  }
}

export async function executeDesktopOntologyTool(
  request: DesktopOntologyToolCallRequest,
  auth: DesktopAuthContext,
): Promise<DesktopOntologyToolCallSuccess> {
  const startedAt = Date.now();
  const release = await getActiveOntologyReleaseOrThrow();
  const useMcp =
    shouldUseDesktopOntologyMcp() &&
    request.tool_name !== "krw_ontology_catalog";
  if (useMcp) await requireMatchingMcpRelease(release.release_id);
  const result = useMcp
    ? await executeMcpBackedTool(request)
    : await executeCatalogBackedTool(request);
  const resultJson = {
    ...result.json,
    citations: result.citations,
    local_session_id: request.local_session_id,
    local_run_id: request.local_run_id,
    executor: result.executor,
  };
  assertResultWithinLimit(resultJson);

  return {
    ok: true,
    tool_call_id: request.tool_call_id,
    tool_name: request.tool_name,
    result_text: result.text,
    result_json: resultJson,
    ontology_release: {
      release_id: release.release_id,
      api_version: DESKTOP_ONTOLOGY_API_VERSION,
      index_generated_at: release.index_generated_at,
    },
    usage: {
      tool_calls_consumed: 1,
    },
    audit: {
      server_tool_call_id: `${auth.userId}:${request.local_run_id}:${request.tool_call_id}`,
      latency_ms: Date.now() - startedAt,
    },
  };
}

async function requireMatchingMcpRelease(expectedReleaseId: string) {
  const health = await checkKrwOntologyMcpHealth();
  if (!health.ok) {
    throw new DesktopOntologyServiceError(
      health.error ?? "Ontology MCP health check failed",
      {
        publicMessage: "온톨로지 검색 서비스가 준비되지 않았습니다.",
        status: 503,
        retryable: true,
      },
    );
  }
  if (!health.releaseId || health.releaseId !== expectedReleaseId) {
    throw new DesktopOntologyServiceError(
      `Ontology release mismatch: catalog=${expectedReleaseId}, mcp=${health.releaseId ?? "unknown"}`,
      {
        publicMessage: "온톨로지 검색 릴리스가 일치하지 않습니다.",
        status: 503,
        retryable: true,
      },
    );
  }
}

async function getActiveOntologyReleaseOrThrow() {
  const release = await getActiveOntologyCatalogRelease();
  if (!release?.release_id) {
    throw new DesktopOntologyServiceError("No active ontology release", {
      publicMessage: "활성화된 온톨로지 릴리스가 없습니다.",
      retryable: true,
    });
  }
  return release;
}

async function executeCatalogBackedTool(
  request: DesktopOntologyToolCallRequest,
): Promise<{
  text: string;
  json: Record<string, unknown>;
  citations: Array<Record<string, unknown>>;
  executor: "catalog";
}> {
  const result = await (async () => {
    switch (request.tool_name) {
    case "krw_ontology_catalog":
      return catalogResult(request.arguments);
    case "krw_ontology_company_context":
      return companyContextResult(request.arguments);
    case "krw_ontology_compare":
      return compareResult(request.arguments);
    case "krw_ontology_query_context":
      return queryContextResult(request.arguments);
    case "krw_ontology_query":
      return queryResult(request.arguments);
    case "krw_ontology_trace":
    case "krw_ontology_chain":
      return graphPlaceholderResult(request.tool_name, request.arguments);
    }
  })();
  return { ...result, executor: "catalog" };
}

async function executeMcpBackedTool(
  request: DesktopOntologyToolCallRequest,
): Promise<{
  text: string;
  json: Record<string, unknown>;
  citations: Array<Record<string, unknown>>;
  executor: "mcp";
}> {
  try {
    const result = await callKrwOntologyMcpTool(
      request.tool_name,
      mcpArguments(request),
    );
    return {
      text: boundText(result.resultText, MAX_RESULT_TEXT_CHARS),
      json: result.resultJson,
      citations: extractMcpCitations(result.resultJson),
      executor: "mcp",
    };
  } catch (error) {
    throw new DesktopOntologyServiceError(
      error instanceof Error ? error.message : "Ontology MCP tool call failed",
      {
        code: "ontology_unavailable",
        publicMessage: "온톨로지 검색 서비스에 연결할 수 없습니다.",
        status: 503,
        retryable: true,
      },
    );
  }
}

function mcpArguments(
  request: DesktopOntologyToolCallRequest,
): Record<string, unknown> {
  const args = request.arguments;
  switch (request.tool_name) {
    case "krw_ontology_catalog": {
      const query = stringArg(args.query);
      return {
        ...(query && /^[A-Z][A-Z0-9.-]{0,10}$/i.test(query)
          ? { ticker: query.toUpperCase() }
          : {}),
        limit: numberArg(args.limit) ?? 10,
      };
    }
    case "krw_ontology_company_context":
      return { ticker: args.ticker };
    case "krw_ontology_query_context":
      return {
        question: args.question,
        ...(Array.isArray(args.tickers) ? { tickers: args.tickers } : {}),
        limit_results: args.limit_results,
      };
    case "krw_ontology_query":
      return {
        ...(args.ticker ? { ticker: args.ticker } : {}),
        topic: args.topic,
        limit: args.limit,
        response_detail: mcpResponseDetail(args.response_detail),
      };
    case "krw_ontology_trace":
      return { object_id: args.root_id };
    case "krw_ontology_chain":
      return {
        object_id: args.root_id,
        max_depth: args.depth,
        include_quote_text: false,
      };
    case "krw_ontology_compare":
      return {
        tickers: args.tickers,
        topic: args.question,
        limit_per_ticker: args.limit_per_ticker,
        response_detail: "compact",
      };
  }
}

function mcpResponseDetail(value: unknown): "compact" | "ticker_summary" {
  return value === "summary" ? "ticker_summary" : "compact";
}

function assertResultWithinLimit(result: Record<string, unknown>) {
  const size = Buffer.byteLength(JSON.stringify(result), "utf8");
  const limit = readPositiveIntEnv(
    "DESKTOP_ONTOLOGY_MAX_RESULT_BYTES",
    DEFAULT_MAX_RESULT_BYTES,
  );
  if (size > limit) {
    throw new DesktopOntologyServiceError(
      `Desktop ontology result is too large: ${size} bytes`,
      {
        code: "result_too_large",
        publicMessage: "검색 결과가 너무 큽니다. 질문이나 검색 범위를 좁혀주세요.",
        status: 413,
        retryable: false,
      },
    );
  }
}

function extractMcpCitations(
  result: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const direct = Array.isArray(result.citations)
    ? result.citations.filter(isRecord).slice(0, 20)
    : [];
  if (direct.length) return direct;

  const citations: Array<Record<string, unknown>> = [];
  collectCitations(result, citations, 0);
  return citations.slice(0, 20);
}

function collectCitations(
  value: unknown,
  citations: Array<Record<string, unknown>>,
  depth: number,
) {
  if (depth > 6 || citations.length >= 20) return;
  if (Array.isArray(value)) {
    for (const item of value) collectCitations(item, citations, depth + 1);
    return;
  }
  if (!isRecord(value)) return;

  const ticker = stringArg(value.ticker);
  const documentType =
    stringArg(value.document_type) ?? stringArg(value.doc_type);
  const period = stringArg(value.period);
  const objectId = stringArg(value.object_id) ?? stringArg(value.id);
  const quoteText =
    stringArg(value.quote_text) ??
    (isQuoteLike(value) ? stringArg(value.text) : undefined);
  if (ticker && (documentType || period || objectId || quoteText)) {
    citations.push({
      ticker,
      document_type: documentType ?? null,
      period: period ?? null,
      section: stringArg(value.section) ?? null,
      quote_text: quoteText ?? null,
      claim_text:
        stringArg(value.claim_text) ??
        stringArg(value.claim) ??
        stringArg(value.summary) ??
        null,
      source_quality: stringArg(value.source_quality) ?? "ontology",
      trace_json: objectId ? { object_id: objectId } : {},
    });
  }

  for (const entry of Object.values(value)) {
    collectCitations(entry, citations, depth + 1);
  }
}

function isQuoteLike(value: Record<string, unknown>): boolean {
  const type = stringArg(value.type)?.toLowerCase() ?? "";
  return type.includes("quote") || "quote_type" in value;
}

function boundText(value: string, maxChars: number): string {
  return value.length <= maxChars
    ? value
    : `${value.slice(0, maxChars)}\n[truncated]`;
}

function readPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1_000 ? parsed : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function catalogResult(args: Record<string, unknown>) {
  const companies = await searchIndexedCompanies({
    query: stringArg(args.query),
    limit: numberArg(args.limit) ?? 10,
  });
  return {
    text: summarizeCompanies("Ontology catalog", companies),
    json: {
      summary: summarizeCompanies("Ontology catalog", companies),
      companies,
    },
    citations: [],
  };
}

async function companyContextResult(args: Record<string, unknown>) {
  const ticker = stringArg(args.ticker);
  const company = ticker ? await getIndexedCompany(ticker) : null;
  const summary = company
    ? `${company.ticker} ${company.name}: ${company.coverage}`
    : `No indexed company context found for ${ticker ?? "unknown"}.`;

  return {
    text: summary,
    json: {
      summary,
      company,
    },
    citations: company ? companyCitations([company]) : [],
  };
}

async function queryContextResult(args: Record<string, unknown>) {
  const tickers = stringArrayArg(args.tickers);
  const companies = tickers.length
    ? await getIndexedCompanies(tickers)
    : await searchIndexedCompanies({
        query: stringArg(args.question),
        limit: numberArg(args.limit_results) ?? 3,
      });
  const summary = summarizeCompanies("Compact ontology context", companies);

  return {
    text: summary,
    json: {
      summary,
      question: stringArg(args.question),
      evidence: companies.map(companyEvidence),
      companies,
    },
    citations: companyCitations(companies),
  };
}

async function queryResult(args: Record<string, unknown>) {
  const ticker = stringArg(args.ticker);
  const companies = ticker
    ? await getIndexedCompanies([ticker])
    : await searchIndexedCompanies({
        query: stringArg(args.topic),
        limit: numberArg(args.limit) ?? 3,
      });
  const summary = summarizeCompanies("Ontology query result", companies);

  return {
    text: summary,
    json: {
      summary,
      topic: stringArg(args.topic),
      evidence: companies.map(companyEvidence),
      companies,
    },
    citations: companyCitations(companies),
  };
}

async function compareResult(args: Record<string, unknown>) {
  const companies = await getIndexedCompanies(stringArrayArg(args.tickers));
  const summary = summarizeCompanies("Ontology compare result", companies);

  return {
    text: summary,
    json: {
      summary,
      question: stringArg(args.question),
      comparisons: companies.map(companyEvidence),
      companies,
    },
    citations: companyCitations(companies),
  };
}

async function graphPlaceholderResult(
  toolName: string,
  args: Record<string, unknown>,
) {
  const summary =
    `${toolName} accepted for root ${stringArg(args.root_id) ?? "unknown"}, ` +
    "but graph expansion is not enabled in the Desktop HTTP bridge yet.";
  return {
    text: summary,
    json: {
      summary,
      root_id: stringArg(args.root_id),
      graph_expansion_available: false,
    },
    citations: [],
  };
}

function summarizeCompanies(prefix: string, companies: IndexedCompany[]) {
  if (!companies.length) return `${prefix}: no indexed companies found.`;
  const items = companies
    .slice(0, 5)
    .map((company) => `${company.ticker} ${company.name} (${company.coverage})`);
  return `${prefix}: ${items.join("; ")}`;
}

function companyEvidence(company: IndexedCompany) {
  return {
    ticker: company.ticker,
    company_name: company.name,
    latest_period: company.latest_period,
    coverage: company.coverage,
    document_types: company.document_types,
    periods: company.periods,
    core_strength: company.core_strength,
    critical_risk: company.critical_risk,
  };
}

function companyCitations(companies: IndexedCompany[]) {
  return companies.flatMap((company) =>
    company.documents.slice(0, 2).map((document) => ({
      ticker: company.ticker,
      company_name: company.name,
      document_type: document.document_type,
      period: document.period,
      section: "ontology_catalog",
      quote_text: null,
      claim_text: company.coverage,
      source_quality: "filing_catalog",
      trace_json: {
        doc_type_key: document.doc_type_key,
        generated_at: document.generated_at,
      },
    })),
  );
}

function stringArg(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberArg(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayArg(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
