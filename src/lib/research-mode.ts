import type { KRWOntologyMCPToolName } from "@/types/api-contracts";

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
}

export const RESEARCH_MODE_TOOL_BUDGETS: Record<
  ResearchMode,
  ResearchModeToolBudget
> = {
  fast: {
    maxToolCalls: 2,
  },
  standard: {
    maxToolCalls: 6,
  },
  deep: {
    maxToolCalls: 32,
  },
};

const FAST_ALLOWED_TOOLS: KRWOntologyMCPToolName[] = [
  "krw_ontology_query_context",
  "krw_ontology_query",
];

const STANDARD_ALLOWED_TOOLS: KRWOntologyMCPToolName[] = [
  "krw_ontology_query_context",
  "krw_ontology_query",
  "krw_ontology_trace",
  "krw_ontology_chain",
  "krw_ontology_compare",
];

const DEEP_ALLOWED_TOOLS: KRWOntologyMCPToolName[] = [
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
  void value;
  return DEFAULT_RESEARCH_MODE;
}

export function getResearchModeToolBudget(
  mode: ResearchMode,
): ResearchModeToolBudget {
  return RESEARCH_MODE_TOOL_BUDGETS[mode];
}

export function getAllowedMcpToolsForResearchMode(
  mode: ResearchMode,
): KRWOntologyMCPToolName[] {
  if (mode === "fast") return FAST_ALLOWED_TOOLS;
  if (mode === "deep") return DEEP_ALLOWED_TOOLS;
  return STANDARD_ALLOWED_TOOLS;
}

export function buildResearchModePrompt(mode: ResearchMode): string {
  const responseDetailPolicy =
    "Never request response_detail: full in web chat. Use compact or ticker_summary follow-up queries; use selected trace/chain for verification instead of full query output.";

  if (mode === "fast") {
    return [
      "Research mode: fast.",
      responseDetailPolicy,
    ].join("\n");
  }

  if (mode === "deep") {
    return [
      "Research mode: deep.",
      responseDetailPolicy,
    ].join("\n");
  }

  return [
    "Research mode: standard.",
    responseDetailPolicy,
  ].join("\n");
}
