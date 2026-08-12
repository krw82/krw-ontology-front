import type { AnalysisMode, RunKind } from "@/types/api-contracts";

export type { RunKind };

export const DEFAULT_RUN_KIND: RunKind = "company_research";

export function normalizeRunKind(value: unknown): RunKind {
  return value === "idea_generation" ||
    value === "wide_research" ||
    value === "news_discovery" ||
    value === "market_move_research" ||
    value === "scenario_sensitivity" ||
    value === "guru_advisor" ||
    value === "company_research"
    ? value
    : DEFAULT_RUN_KIND;
}

export function defaultRunKindForAnalysisMode(
  analysisMode: AnalysisMode,
): RunKind {
  return analysisMode === "news" ? "news_discovery" : "company_research";
}
