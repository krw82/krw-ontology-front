import type { AnalysisMode } from "@/types/api-contracts";

export const KRW_ONTOLOGY_RESEARCH_SKILL =
  "/krw-ontology:krw-ontology-research";

export const KRW_ONTOLOGY_NEWS_RESEARCH_SKILL =
  "/krw-ontology:krw-ontology-news-research";

export function getKrwOntologySkillForAnalysisMode(
  analysisMode: AnalysisMode = "company",
): string {
  return analysisMode === "news"
    ? KRW_ONTOLOGY_NEWS_RESEARCH_SKILL
    : KRW_ONTOLOGY_RESEARCH_SKILL;
}

export function buildResearchPassPrompt(
  userMessage: string,
  analysisMode: AnalysisMode = "company",
): string {
  const skillCommand = getKrwOntologySkillForAnalysisMode(analysisMode);

  return `${skillCommand} ${userMessage}

웹앱 출력 모드:
- 최종 답변은 사용자에게 바로 보여줄 Markdown 본문만 작성합니다.
- ResearchSynthesis, DisplayPlan, answer_blocks 같은 구조화 JSON은 만들지 않습니다.
- 근거는 도구 조회 결과를 바탕으로 본문 안에 자연스럽게 요약합니다.`;
}
