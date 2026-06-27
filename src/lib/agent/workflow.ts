import type { AnalysisMode, RunKind } from "@/types/api-contracts";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";

export const KRW_ONTOLOGY_RESEARCH_SKILL =
  "/krw-ontology:krw-ontology-research";

export const KRW_ONTOLOGY_RESEARCH_EN_SKILL =
  "/krw-ontology:krw-ontology-research-en";

export const KRW_ONTOLOGY_IDEA_GENERATION_SKILL =
  "/krw-ontology:krw-ontology-idea-generation";

export const KRW_ONTOLOGY_NEWS_DISCOVERY_SKILL =
  "/krw-ontology:krw-ontology-news-discovery";

export const KRW_ONTOLOGY_MARKET_MOVE_RESEARCH_SKILL =
  "/krw-ontology:krw-ontology-market-move-research";

export const KRW_ONTOLOGY_SCENARIO_SENSITIVITY_SKILL =
  "/krw-ontology:krw-ontology-scenario-sensitivity";

export function getKrwOntologySkillForRunKind(
  runKind: RunKind,
  responseLocale: Locale = DEFAULT_LOCALE,
): string {
  if (runKind === "idea_generation") {
    return KRW_ONTOLOGY_IDEA_GENERATION_SKILL;
  }
  if (runKind === "news_discovery") return KRW_ONTOLOGY_NEWS_DISCOVERY_SKILL;
  if (runKind === "market_move_research") {
    return KRW_ONTOLOGY_MARKET_MOVE_RESEARCH_SKILL;
  }
  if (runKind === "scenario_sensitivity") {
    return KRW_ONTOLOGY_SCENARIO_SENSITIVITY_SKILL;
  }
  return responseLocale === "en"
    ? KRW_ONTOLOGY_RESEARCH_EN_SKILL
    : KRW_ONTOLOGY_RESEARCH_SKILL;
}

export function buildResearchPassPrompt(
  userMessage: string,
  analysisMode: AnalysisMode = "company",
  runKind: RunKind = analysisMode === "news"
    ? "news_discovery"
    : "company_research",
  responseLocale: Locale = DEFAULT_LOCALE,
): string {
  const skillCommand = getKrwOntologySkillForRunKind(runKind, responseLocale);
  const runtimeMode =
    runKind === "idea_generation"
      ? ideaGenerationRuntimePrompt()
      : runKind === "news_discovery"
      ? newsDiscoveryRuntimePrompt(responseLocale)
      : runKind === "market_move_research"
          ? marketMoveResearchRuntimePrompt(responseLocale)
          : runKind === "scenario_sensitivity"
            ? scenarioSensitivityRuntimePrompt(responseLocale)
            : defaultRuntimePrompt(responseLocale);

  return `${skillCommand} ${userMessage}

${runtimeMode}`;
}

function ideaGenerationRuntimePrompt(): string {
  return `웹앱 종목 발굴 실행:
- 이번 실행은 사용자의 조건에 맞는 온톨로지 지원 기업을 찾고, 다음 리서치 우선순위를 정하는 deep 리서치입니다.
- 최종 매수·매도 추천이 아니라 공시 근거가 강한 후보, 약한 후보, 제외 후보를 구분합니다.
- 최종 답변은 사용자에게 바로 보여줄 한국어 Markdown 본문만 작성합니다.
- ResearchSynthesis, DisplayPlan, answer_blocks 같은 구조화 JSON이나 별도 아티팩트는 만들지 않습니다.`;
}

function newsDiscoveryRuntimePrompt(responseLocale: Locale): string {
  if (responseLocale === "en") {
    return `Web app news discovery run:
- The user is asking about a recent/current market-news event, issue, or named news topic.
- Use the Yahoo Finance MCP tools directly at runtime to find recent ticker news that answers the user's question.
- Prefer the session/default ticker or the ticker/company named by the user. Yahoo Finance news is ticker-based; if no resolvable ticker/company context exists, say the current news read is limited and ask for a specific company.
- Use get_yahoo_finance_news first. Use get_stock_info only when ticker/company identity needs confirmation.
- Do not summarize Yahoo Finance results in returned order. First classify results into direct ticker news, indirect market/sector news, and low-relevance news.
- Separate company-specific news from indirect market/sector context. Do not present indirect market news as if it were company-specific news.
- Do not call KRW Ontology tools in this run.
- Treat news as market reporting, not confirmed company disclosure.
- Answer with a compact but complete first-pass investor brief. Do not stop at headline listing.
- Explain why the news may matter for investors, but stop before filing-grounded revenue, margin, cash-flow, balance-sheet, valuation, or long-term thesis conclusions.
- End with exactly 3 numbered follow-up prompts. Use one company filing-research continuation, one scenario-sensitivity prompt, and one opposite-view or thesis-break prompt.
- The final answer must be user-visible English Markdown investor interpretation only.`;
  }

  return `웹앱 뉴스 discovery 실행:
- 사용자는 최근/현재 시장 뉴스, 특정 이슈, 또는 이름이 나온 뉴스 주제에 대해 묻고 있습니다.
- Yahoo Finance MCP 도구를 런타임에서 직접 호출해서 사용자가 물어본 최근 ticker news를 확인합니다.
- 세션/default ticker 또는 사용자가 말한 ticker/company를 우선합니다. Yahoo Finance 뉴스는 ticker 기반이므로, 확인 가능한 ticker/company 컨텍스트가 없으면 현재 뉴스 확인 범위가 제한적이라고 말하고 특정 회사를 물어봅니다.
- 먼저 get_yahoo_finance_news를 사용합니다. ticker/company 확인이 필요할 때만 get_stock_info를 보조로 사용합니다.
- Yahoo Finance 결과를 나온 순서대로 요약하지 않습니다. 먼저 직접 ticker 뉴스, 간접 시장/섹터 뉴스, 낮은 관련 뉴스로 분류합니다.
- 회사 직접 뉴스와 시장/섹터 간접 맥락을 반드시 분리합니다. 간접 시장 뉴스를 회사 고유 뉴스처럼 쓰지 않습니다.
- 이벤트 선택 카드나 JSON을 만들지 않습니다.
- 이 실행에서는 KRW Ontology 도구를 호출하지 않습니다.
- 뉴스는 시장 보도로만 취급하고, 회사가 확인한 공시/발표처럼 단정하지 않습니다.
- 사용자의 뉴스 질문에 짧지만 완결된 1차 투자 브리프로 답합니다. 헤드라인 나열로 끝내지 않습니다.
- 뉴스가 투자자에게 왜 중요해 보이는지 설명하되, 매출·마진·현금흐름·재무상태·밸류에이션·장기 투자판단 결론은 공시 기반 분석 전에서 멈춥니다.
- 답변은 기본적으로 "최근 뉴스 요약", "직접 관련된 내용", "시장 전반에서 같이 작용한 내용", "투자자가 봐야 할 의미", "아직 단정하면 안 되는 부분" 흐름을 따릅니다.
- 후속질문은 정확히 3개를 쓰고, 모두 "1.", "2.", "3." 번호가 붙은 형태로 작성합니다.
- 후속질문 앞에는 반드시 "### 이어서 볼 질문" 제목을 씁니다.
- "분석이 필요하신 주제를 골라주세요", "선택해주세요", "후보를 골라주세요" 같은 카드 선택형 문구는 쓰지 않습니다.
- 후속질문은 1개는 같은 회사의 추가 확인 질문, 1개는 scenario_sensitivity로 이어지는 시나리오 질문, 1개는 반대 근거/과잉반응/판단이 깨지는 조건 질문으로 씁니다.
- 시나리오 질문은 "상승·하락·횡보 시나리오별로 이 뉴스의 영향을 나눠줘", "좋게 볼 때와 나쁘게 볼 때를 나눠줘"처럼 일반 개인투자자가 바로 보낼 수 있는 말로 씁니다.
- 후속질문은 전문 리서치 과제처럼 쓰지 말고, 설명 없는 영어 약어·공시 항목명·밸류에이션 모델 용어를 피합니다.
- 최종 답변은 사용자에게 바로 보여줄 한국어 Markdown 투자 해석만 작성합니다.`;
}

function marketMoveResearchRuntimePrompt(responseLocale: Locale): string {
  if (responseLocale === "en") {
    return `Web app market-move research run:
- The user is asking why a covered stock moved now.
- Use the Yahoo Finance MCP tools directly at runtime. Use get_stock_info for current price/move context and get_yahoo_finance_news for recent ticker news candidates.
- Prefer the session/default ticker or the ticker/company named by the user. Yahoo Finance news is ticker-based; if no ticker/company context is resolvable, say the live market/news read is limited and ask for a specific company.
- Treat quote/news data as market observations, not confirmed company disclosure.
- Do not summarize Yahoo Finance results in returned order. Classify results into direct company news, indirect market/sector context, and low-relevance/newsletter-style items; exclude low-relevance items from the explanation unless needed as a limitation.
- Default first answer: write a compact but substantive market/news investment brief, not a headline summary.
- When there is a usable direct company-news candidate, do not stop after naming the catalyst. Explain what the news actually says, why it could move this stock, which investor assumption it touches, what still needs additional confirmation, and why the move may still be an overreaction or incomplete evidence.
- The answer should create a natural next question by making the filing/scenario check feel useful, not by asking the user to choose from generic cards.
- Do not automatically turn every price-move question into a full filing-grounded ontology report.
- Use KRW Ontology only when the user asks for filings, long-term thesis impact, revenue, margin, cash flow, balance sheet, dilution, risk, capital allocation, or when the answer would otherwise imply a durable investment-view change.
- For simple "why did it move" questions, normally stop before KRW Ontology and let numbered follow-up prompts re-enter the router for deeper filing or scenario work.
- Do not write a full forward outlook or scenario analysis in the default market-move answer; offer a numbered scenario follow-up instead.
- End with exactly 3 numbered follow-up prompts. Use one company filing-research continuation, one scenario-sensitivity prompt, and one opposite-view or thesis-break prompt.
- If Yahoo Finance MCP fails, returns no useful direct/indirect results, or the price move cannot be confirmed, state the live market/news read was limited and do not invent a news explanation.
- The final answer must be user-visible English Markdown investor interpretation only.`;
  }

  return `웹앱 주가 변동 research 실행:
- 사용자는 현재 주가가 왜 움직였는지 묻고 있습니다.
- Yahoo Finance MCP 도구를 런타임에서 직접 호출합니다. get_stock_info로 현재 가격/변동 맥락을 확인하고, get_yahoo_finance_news로 최근 ticker news 후보를 확인합니다.
- 세션/default ticker 또는 사용자가 말한 ticker/company를 우선합니다. Yahoo Finance 뉴스는 ticker 기반이므로, 확인 가능한 ticker/company 컨텍스트가 없으면 실시간 시장/뉴스 확인 범위가 제한적이라고 말하고 특정 회사를 물어봅니다.
- 가격/뉴스 데이터는 시장 관찰값으로만 보고, 회사가 확인한 공시/발표처럼 취급하지 않습니다.
- Yahoo Finance 결과를 나온 순서대로 요약하지 않습니다. 먼저 회사 직접 뉴스, 간접 시장/섹터 맥락, 낮은 관련성/뉴스레터성 항목으로 분류하고, 낮은 관련성 항목은 한계 설명이 필요할 때 외에는 답변 근거에서 제외합니다.
- 기본 첫 답변은 헤드라인 요약이 아니라, 짧지만 얕지 않은 시장/뉴스 투자 브리프로 작성합니다.
- 쓸 만한 회사 직접 뉴스 후보가 있으면 촉매를 이름만 말하고 끝내지 않습니다. 그 뉴스가 실제로 무엇을 말하는지, 왜 이 종목을 움직일 수 있는지, 어떤 투자자 가정에 닿는지, 무엇을 추가로 확인해야 하는지, 아직 과잉반응이거나 불완전한 증거일 수 있는 이유를 설명합니다.
- 답변은 일반 카드 선택을 유도하기보다, 다음 공시/시나리오 확인이 자연스럽게 궁금해지도록 작성합니다.
- 모든 가격 변동 질문을 자동으로 공시 기반 온톨로지 보고서로 바꾸지 않습니다.
- 사용자가 공시, 장기 투자 가정, 매출, 마진, 현금흐름, 재무상태, 희석, 리스크, 자본배분을 묻거나 답변이 지속적인 투자 판단 변화를 암시할 때만 KRW Ontology를 사용합니다.
- 단순한 "왜 움직였나" 질문은 보통 KRW Ontology 조회 전에서 멈추고, 번호가 붙은 후속질문으로 더 깊은 공시/시나리오 작업이 라우터를 다시 타게 합니다.
- 기본 주가 변동 답변 안에서 향후 전망/상승·하락 시나리오를 길게 쓰지 말고, 번호가 붙은 시나리오 후속질문으로 제안합니다.
- 후속질문은 정확히 3개를 쓰고, 모두 "1.", "2.", "3." 번호가 붙은 형태로 작성합니다.
- 후속질문은 1개는 같은 회사의 추가 확인 질문, 1개는 scenario_sensitivity로 이어지는 시나리오 질문, 1개는 반대 근거/과잉반응/판단이 깨지는 조건 질문으로 씁니다.
- 시나리오 질문은 "상승·하락·횡보 시나리오별로 이 움직임을 나눠줘", "이 움직임이 과잉반응인지 시나리오별로 점검해줘"처럼 일반 개인투자자가 바로 보낼 수 있는 말로 씁니다.
- 후속질문은 전문 리서치 과제처럼 쓰지 말고, 설명 없는 영어 약어·공시 항목명·밸류에이션 모델 용어를 피합니다.
- Yahoo Finance MCP가 실패하거나, 직접/간접 관련 뉴스가 부족하거나, 가격 변동을 확인하지 못하면 실시간 시장/뉴스 확인이 제한적이었다고 말하고 뉴스 설명을 지어내지 않습니다.
- 최종 답변은 사용자에게 바로 보여줄 한국어 Markdown 투자 해석만 작성합니다.`;
}

function scenarioSensitivityRuntimePrompt(responseLocale: Locale): string {
  if (responseLocale === "en") {
    return `Web app scenario-sensitivity run:
- The user is asking for scenarios, sensitivity, upside/base/downside paths, thesis-break conditions, or what would change the investment view.
- Start from the latest available filing/company context, then extract the 1-3 investment assumptions that actually drive the scenario.
- Connect business path and financial path before writing scenarios.
- Define strengthen / maintain / weaken / thesis-break conditions.
- Use explicit upside/base/downside scenarios only when they help the user's question; do not force a valuation model.
- The final answer must be user-visible English Markdown investor interpretation only.`;
  }

  return `웹앱 시나리오/민감도 research 실행:
- 사용자는 시나리오, 민감도, 상승/기준/하락 경로, 투자 가정 변화, 판단이 깨지는 조건을 묻고 있습니다.
- 최신 available filing/company context에서 시작한 뒤, 시나리오를 실제로 움직이는 핵심 투자 가정 1~3개를 먼저 뽑습니다.
- 사업 경로와 재무 경로를 연결한 뒤 시나리오를 작성합니다.
- 강화 / 유지 / 약화 / 가정 파기 조건을 명확히 나눕니다.
- 사용자 질문에 도움이 될 때만 상승/기준/하락 시나리오를 사용하고, 밸류에이션 모델을 억지로 만들지 않습니다.
- 최종 답변은 사용자에게 바로 보여줄 한국어 Markdown 투자 해석만 작성합니다.`;
}

function defaultRuntimePrompt(responseLocale: Locale): string {
  if (responseLocale === "en") {
    return `Web app output mode:
- The final answer must be user-visible English Markdown only.
- Do not create structured JSON such as ResearchSynthesis, DisplayPlan, or answer_blocks.
- Summarize evidence naturally in the body based on tool results.`;
  }

  return `웹앱 출력 모드:
- 최종 답변은 사용자에게 바로 보여줄 Markdown 본문만 작성합니다.
- ResearchSynthesis, DisplayPlan, answer_blocks 같은 구조화 JSON은 만들지 않습니다.
- 근거는 도구 조회 결과를 바탕으로 본문 안에 자연스럽게 요약합니다.`;
}
