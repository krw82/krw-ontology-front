import type { MCPToolName } from "@/types/api-contracts";

export type ResearchMode = "fast" | "standard" | "deep";

export const DEFAULT_RESEARCH_MODE: ResearchMode = "deep";

export const RESEARCH_MODE_LABELS: Record<ResearchMode, string> = {
  fast: "빠른 답변",
  standard: "표준 분석",
  deep: "깊은 리서치",
};

export const RESEARCH_MODE_DESCRIPTIONS: Record<ResearchMode, string> = {
  fast: "핵심 근거 중심으로 빠르게 정리합니다. 깊은 근거 추적은 제한됩니다.",
  standard: "필요한 근거만 확인하는 기본 분석입니다.",
  deep: "근거를 더 따라가며 자세히 분석합니다. 시간이 더 걸릴 수 있습니다.",
};

export interface ResearchModeToolBudget {
  maxToolCalls: number;
  queryContext: number;
  query: number;
  retrieve: number;
  traceChain: number;
  compare: number;
}

export const RESEARCH_MODE_TOOL_BUDGETS: Record<
  ResearchMode,
  ResearchModeToolBudget
> = {
  fast: {
    maxToolCalls: 2,
    queryContext: 1,
    query: 1,
    retrieve: 0,
    traceChain: 0,
    compare: 0,
  },
  standard: {
    maxToolCalls: 6,
    queryContext: 1,
    query: 3,
    retrieve: 0,
    traceChain: 2,
    compare: 1,
  },
  deep: {
    maxToolCalls: 32,
    queryContext: 4,
    query: 12,
    retrieve: 2,
    traceChain: 16,
    compare: 6,
  },
};

const FAST_ALLOWED_TOOLS: MCPToolName[] = [
  "krw_ontology_query_context",
  "krw_ontology_query",
];

const STANDARD_ALLOWED_TOOLS: MCPToolName[] = [
  "krw_ontology_query_context",
  "krw_ontology_query",
  "krw_ontology_trace",
  "krw_ontology_chain",
  "krw_ontology_compare",
];

const DEEP_ALLOWED_TOOLS: MCPToolName[] = [
  "krw_ontology_catalog",
  "krw_ontology_company_context",
  "krw_ontology_index_context",
  "krw_ontology_topic_map",
  "krw_ontology_query",
  "krw_ontology_query_context",
  "krw_ontology_retrieve",
  "krw_ontology_trace",
  "krw_ontology_quality",
  "krw_ontology_compare",
  "krw_ontology_plan_query",
  "krw_ontology_chain",
];

export function normalizeResearchMode(value: unknown): ResearchMode {
  return value === "fast" || value === "standard" || value === "deep"
    ? value
    : DEFAULT_RESEARCH_MODE;
}

export function getResearchModeToolBudget(
  mode: ResearchMode,
): ResearchModeToolBudget {
  return RESEARCH_MODE_TOOL_BUDGETS[mode];
}

export function getAllowedMcpToolsForResearchMode(
  mode: ResearchMode,
): MCPToolName[] {
  if (mode === "fast") return FAST_ALLOWED_TOOLS;
  if (mode === "deep") return DEEP_ALLOWED_TOOLS;
  return STANDARD_ALLOWED_TOOLS;
}

export function buildResearchModePrompt(mode: ResearchMode): string {
  const responseDetailPolicy =
    "Never request response_detail: full in web chat. Use compact or ticker_summary follow-up queries; use selected trace/chain for verification instead of full query output.";
  const internalEnglishBriefPolicy =
    "For sector, global, macro, or discovery questions, first rewrite the user's intent into an internal English research brief before any MCP call. Even when the user asks in Korean, MCP question/topic arguments must be English for these broad research tasks, with a bounded ticker set when possible.";
  const broadKoreanQueryPolicy =
    "Do not send Korean broad sector/global/macro/discovery question or topic text directly to query_context, query, or retrieve.";

  if (mode === "fast") {
    return [
      "Research mode: fast.",
      "Use krw_ontology_query_context first and stop if it is sufficient.",
      internalEnglishBriefPolicy,
      broadKoreanQueryPolicy,
      "Do not call trace, chain, retrieve, catalog, quality, company_context, index_context, or broad query tools.",
      "If one targeted query is still necessary, use it once only and then answer with explicit limitations.",
      responseDetailPolicy,
    ].join("\n");
  }

  if (mode === "deep") {
    return [
      "Research mode: deep.",
      "Use krw_ontology_query_context first, then perform additional trace/chain/query work only when it materially improves the answer.",
      internalEnglishBriefPolicy,
      broadKoreanQueryPolicy,
      "Deep mode can spend more tool calls, but avoid repeated identical queries and avoid unscoped retrieve.",
      responseDetailPolicy,
    ].join("\n");
  }

  return [
    "Research mode: standard.",
    "Use krw_ontology_query_context first.",
    internalEnglishBriefPolicy,
    broadKoreanQueryPolicy,
    "Use CY labels for user-facing periods; do not write FY labels. If source text says FY, convert the display label to the matching CY period and mention fiscal wording only if essential.",
    "If query_context reports sufficient research state, write the answer without more MCP calls.",
    "If targeted follow-up is necessary, use up to two precise queries or one to two trace/chain calls.",
    responseDetailPolicy,
    "Do not use retrieve by default and do not repeat similar query calls.",
  ].join("\n");
}
