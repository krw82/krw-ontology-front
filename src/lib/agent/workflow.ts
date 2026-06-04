import type { AnalysisMode, RunKind } from "@/types/api-contracts";

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
  runKind: RunKind = analysisMode === "news"
    ? "news_discovery"
    : "company_research",
): string {
  const skillCommand = getKrwOntologySkillForAnalysisMode(analysisMode);
  const runtimeMode =
    runKind === "news_discovery"
      ? `웹앱 뉴스 discovery 실행:
- 이번 실행의 목적은 사용자가 선택할 수 있는 최근 원자 뉴스 이벤트 후보를 찾는 것입니다.
- Stock News 도구로 회사별 실제 사건 후보 3~5개를 찾습니다.
- read_news_sources와 KRW Ontology 도구는 호출하지 않습니다.
- 최종 투자 해석을 쓰지 않습니다. 짧은 한국어 안내문만 작성합니다.
- 카드 UI는 웹앱 런타임이 Stock News 도구 결과에서 생성합니다. JSON이나 카드 Markdown을 직접 쓰지 않습니다.`
      : runKind === "news_research"
        ? `웹앱 뉴스 research 실행:
- 사용자가 이미 선택한 하나의 뉴스 이벤트를 검증하고 공시 기준으로 해석하는 실행입니다.
- 선택 이벤트에서 제공된 출처를 우선 확인하고, 필요한 경우에만 공식/주요 도메인을 좁게 확인합니다.
- 이후 KRW Ontology query_context와 필요한 targeted follow-up으로 공시 baseline을 연결합니다.
- 최종 답변은 사용자에게 바로 보여줄 한국어 Markdown 투자 해석만 작성합니다.`
        : `웹앱 출력 모드:
- 최종 답변은 사용자에게 바로 보여줄 Markdown 본문만 작성합니다.
- ResearchSynthesis, DisplayPlan, answer_blocks 같은 구조화 JSON은 만들지 않습니다.
- 근거는 도구 조회 결과를 바탕으로 본문 안에 자연스럽게 요약합니다.`;

  return `${skillCommand} ${userMessage}

${runtimeMode}`;
}
