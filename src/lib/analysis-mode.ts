import type { AnalysisMode } from "@/types/api-contracts";

export type { AnalysisMode };

export const DEFAULT_ANALYSIS_MODE: AnalysisMode = "company";

export const ANALYSIS_MODE_LABELS: Record<AnalysisMode, string> = {
  company: "기업분석 모드",
  news: "뉴스 모드",
};

export const ANALYSIS_MODE_DESCRIPTIONS: Record<AnalysisMode, string> = {
  company: "공시와 온톨로지 근거 중심으로 분석합니다.",
  news: "최신 뉴스 이벤트를 함께 확인한 뒤 분석합니다.",
};

export function normalizeAnalysisMode(value: unknown): AnalysisMode {
  return value === "news" || value === "company"
    ? value
    : DEFAULT_ANALYSIS_MODE;
}
