import type { AnalysisMode } from "@/types/api-contracts";

export type { AnalysisMode };

export const DEFAULT_ANALYSIS_MODE: AnalysisMode = "company";

export const ANALYSIS_MODE_LABELS: Record<AnalysisMode, string> = {
  company: "기업분석 모드",
  news: "뉴스 모드",
};

export const ANALYSIS_MODE_DESCRIPTIONS: Record<AnalysisMode, string> = {
  company: "공시와 온톨로지 근거 중심으로 분석합니다.",
  news: "최신 웹 정보를 함께 확인한 뒤 분석합니다.",
};

export function normalizeAnalysisMode(value: unknown): AnalysisMode {
  return value === "news" || value === "company"
    ? value
    : DEFAULT_ANALYSIS_MODE;
}

export function buildAnalysisModePrompt(
  mode: AnalysisMode,
  options: { webSearchAvailable: boolean } = { webSearchAvailable: false },
): string {
  if (mode === "news") {
    if (options.webSearchAvailable) {
      return [
        "Analysis mode: news.",
        "Before writing the final answer, attempt at least one current web search using the configured read-only Z.AI Web Search MCP tool.",
        "Use web search for recent, post-filing, market, news, or event context; preserve source provenance internally while synthesizing web and KRW Ontology evidence into one investor interpretation.",
        "If web search fails, times out, or returns no useful results, continue from the collected filing evidence and state that no additional current web context was confirmed.",
      ].join("\n");
    }

    return [
      "Analysis mode: news.",
      "The user requested current web context, but the web-search MCP tool is unavailable in this runtime.",
      "Continue from filing-grounded KRW Ontology evidence and state that current web context could not be checked.",
    ].join("\n");
  }

  return [
    "Analysis mode: company.",
    "Use filing-grounded KRW Ontology evidence only.",
    "Do not call web-search tools or add unverified current-news context.",
  ].join("\n");
}
