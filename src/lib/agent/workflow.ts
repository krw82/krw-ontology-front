import type { AnalysisMode, RunKind } from "@/types/api-contracts";

export const KRW_ONTOLOGY_RESEARCH_SKILL =
  "/krw-ontology:krw-ontology-research";

export const KRW_ONTOLOGY_NEWS_DISCOVERY_SKILL =
  "/krw-ontology:krw-ontology-news-discovery";

export function getKrwOntologySkillForRunKind(
  runKind: RunKind,
): string {
  return runKind === "news_discovery"
    ? KRW_ONTOLOGY_NEWS_DISCOVERY_SKILL
    : KRW_ONTOLOGY_RESEARCH_SKILL;
}

export function buildResearchPassPrompt(
  userMessage: string,
  analysisMode: AnalysisMode = "company",
  runKind: RunKind = analysisMode === "news"
    ? "news_discovery"
    : "company_research",
): string {
  const skillCommand = getKrwOntologySkillForRunKind(runKind);
  const runtimeMode =
    runKind === "news_discovery"
      ? `웹앱 뉴스 discovery 실행:
- 이번 실행의 목적은 사용자가 선택할 수 있는 최근 원자 뉴스 이벤트 후보를 찾는 것입니다.
- Stock News 도구로 시장 뉴스 기반 사건 후보 3~5개를 찾습니다.
- SEC/IR/Form 8-K/Investor Relations/오래된 filing은 사용자 카드 후보에서 제외합니다.
- 후보 카드는 한국어 사건 제목/요약과 내부 영어 ontology bridge brief를 가져야 합니다.
- read_news_sources와 KRW Ontology 도구는 호출하지 않습니다.
- 최종 투자 해석을 쓰지 않습니다. 짧은 한국어 안내문만 작성합니다.
- 카드 UI는 웹앱 런타임이 Stock News 도구 결과에서 생성합니다. JSON이나 카드 Markdown을 직접 쓰지 않습니다.`
      : runKind === "news_research"
        ? `웹앱 뉴스 research 실행:
- 사용자가 이미 선택한 하나의 시장 뉴스 내러티브를 공시 기준으로 해석하는 실행입니다.
- selected_news_event_context 안의 source_pack.ontology_search_brief_en/source_pack.original_text_for_ontology를 우선 사용하고, 없으면 ontology_bridge_brief_en을 내부 영어 투자 brief로 사용해 KRW Ontology query_context를 시작합니다.
- 뉴스 내러티브를 회사가 확인한 사실처럼 단정하지 말고, 공시 baseline 기준의 의미와 한계를 설명합니다.
- 새로운 broad news discovery는 하지 않습니다.
- 최종 답변은 사용자에게 바로 보여줄 한국어 Markdown 투자 해석만 작성합니다.`
        : `웹앱 출력 모드:
- 최종 답변은 사용자에게 바로 보여줄 Markdown 본문만 작성합니다.
- ResearchSynthesis, DisplayPlan, answer_blocks 같은 구조화 JSON은 만들지 않습니다.
- 근거는 도구 조회 결과를 바탕으로 본문 안에 자연스럽게 요약합니다.`;

  return `${skillCommand} ${userMessage}

${runtimeMode}`;
}
