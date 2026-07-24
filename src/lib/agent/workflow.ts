import type { AnalysisMode, RunKind } from "@/types/api-contracts";
import { DEFAULT_LOCALE, type Locale } from "@/i18n/config";
import type { GuruLensKey } from "@/lib/guru-lenses";

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

export const KRW_ONTOLOGY_NEWS_FILING_CORRELATION_SKILL =
  "/krw-ontology:krw-ontology-news-filing-correlation";

export const KRW_ONTOLOGY_SCENARIO_SENSITIVITY_SKILL =
  "/krw-ontology:krw-ontology-scenario-sensitivity";

export const KRW_ONTOLOGY_FILING_FOLLOW_UP_SKILL =
  "/krw-ontology:krw-ontology-filing-follow-up";

export const KRW_GURU_BUFFETT_ADVISOR_SKILL =
  "/krw-guru-advisor:krw-guru-buffett-advisor";

export const KRW_GURU_MARKS_ADVISOR_SKILL =
  "/krw-guru-advisor:krw-guru-marks-advisor";

export const KRW_GURU_ACKMAN_ADVISOR_SKILL =
  "/krw-guru-advisor:krw-guru-ackman-advisor";

export const KRW_GURU_FLATT_ADVISOR_SKILL =
  "/krw-guru-advisor:krw-guru-flatt-advisor";

export const KRW_GURU_TERRY_SMITH_ADVISOR_SKILL =
  "/krw-guru-advisor:krw-guru-terry-smith-advisor";

type GuruLensSelection = {
  authorKey: string | null;
  label: string;
  skillCommand: string | null;
};

export function getKrwOntologySkillForRunKind(
  runKind: RunKind,
  responseLocale: Locale = DEFAULT_LOCALE,
  hasSourceFilingContext = false,
  filingCorrelationActive = false,
): string {
  if (hasSourceFilingContext) return KRW_ONTOLOGY_FILING_FOLLOW_UP_SKILL;
  if (filingCorrelationActive) {
    return KRW_ONTOLOGY_NEWS_FILING_CORRELATION_SKILL;
  }
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
  guruLensKey?: GuruLensKey | null,
  hasSourceFilingContext = false,
  filingCorrelationActive = false,
): string {
  if (runKind === "guru_advisor") {
    return buildGuruAdvisorResearchPassPrompt(
      userMessage,
      responseLocale,
      guruLensKey,
    );
  }

  const skillCommand = getKrwOntologySkillForRunKind(
    runKind,
    responseLocale,
    hasSourceFilingContext,
    filingCorrelationActive,
  );
  const runtimeMode =
    hasSourceFilingContext
      ? sourceFilingRuntimePrompt(responseLocale)
      : filingCorrelationActive
        ? newsFilingCorrelationRuntimePrompt(responseLocale)
      : runKind === "idea_generation"
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

function newsFilingCorrelationRuntimePrompt(responseLocale: Locale): string {
  if (responseLocale === "en") {
    return `Web app news-filing correlation run:
- Establish the current market move or selected market narrative first, then compare it with a small number of closely timed, relevant 8-K or 6-K disclosures for the same ticker.
- Treat price/news as market observations. Search catalog metadata once before reading a filing; use a filing brief only for orientation; list sections before reading a material section or a verified exhibit.
- Do not search an issuer's full filing history, use a nearby filing as proof of price causality, or turn this into a full company report.
- Clearly distinguish market reporting, what the company directly disclosed, and the remaining uncertainty. If there is no relevant filing, say that the available filing record does not independently confirm that market narrative.
- Do not expose provider, tool, MCP, plugin, event-ID, document-key, or internal workflow names. Write final English Markdown investor prose only.`;
  }

  return `웹앱 뉴스·공시 상관관계 research 실행:
- 현재 주가 움직임 또는 선택된 시장 서사를 먼저 파악한 뒤, 같은 ticker의 시점과 주제가 가까운 8-K 또는 6-K 몇 건만 대조합니다.
- 가격/뉴스는 시장 관찰값으로 취급합니다. 공시 목록 메타데이터는 한 번만 찾고, 자동 요약은 방향을 잡는 데만 쓰며, 중요한 원문 주장을 하기 전에는 항목 목록을 확인한 뒤 필요한 항목이나 검증된 첨부문서만 읽습니다.
- 한 회사의 공시 이력을 넓게 훑지 말고, 가까운 공시가 주가 원인을 증명한다고 단정하지 말며, 전체 회사 리포트로 확장하지 않습니다.
- 시장 보도, 회사가 공시로 직접 확인한 사실, 아직 남는 불확실성을 분명히 나눕니다. 관련 공시가 없으면 현재 확인 가능한 공시 기록만으로 그 시장 서사를 독립적으로 확인하지 못했다고 설명합니다.
- provider·tool·MCP·plugin·event ID·문서 키·내부 절차 이름을 노출하지 않습니다. 최종 답변은 사용자에게 바로 보여줄 한국어 Markdown 투자 해석만 작성합니다.`;
}

function sourceFilingRuntimePrompt(responseLocale: Locale): string {
  if (responseLocale === "en") {
    return `Web app source-filing follow-up run:
- This chat was opened from one verified SEC filing card. Read and interpret that filing only.
- Do not broaden into company research, current news, another filing, valuation, or a trading recommendation.
- Write a direct English Markdown answer. Do not expose internal workflow or tool details.`;
  }

  return `웹앱 원문 공시 후속 질문 실행:
- 이 대화는 검증된 SEC 공시 카드 한 건에서 시작되었습니다. 해당 공시만 읽고 해석합니다.
- 일반 회사 리서치, 최신 뉴스, 다른 공시, 밸류에이션, 매매 추천으로 범위를 넓히지 않습니다.
- 한국어 Markdown 본문으로 바로 답합니다. 내부 절차나 도구 이름은 노출하지 않습니다.`;
}

function buildGuruAdvisorResearchPassPrompt(
  userMessage: string,
  responseLocale: Locale,
  guruLensKey?: GuruLensKey | null,
): string {
  const lens =
    guruLensKey != null
      ? guruLensSelectionForKey(guruLensKey)
      : parseGuruLensSelection(userMessage);
  const skillCommand = lens.skillCommand ? `${lens.skillCommand} ` : "";

  return `${skillCommand}${userMessage}

${guruAdvisorRuntimePrompt(responseLocale, lens)}`;
}

function guruLensSelectionForKey(key: GuruLensKey): GuruLensSelection {
  if (key === "buffett") {
    return {
      authorKey: "buffett",
      label: "Warren Buffett",
      skillCommand: KRW_GURU_BUFFETT_ADVISOR_SKILL,
    };
  }
  if (key === "marks") {
    return {
      authorKey: "marks",
      label: "Howard Marks",
      skillCommand: KRW_GURU_MARKS_ADVISOR_SKILL,
    };
  }
  if (key === "ackman") {
    return {
      authorKey: "ackman",
      label: "Bill Ackman",
      skillCommand: KRW_GURU_ACKMAN_ADVISOR_SKILL,
    };
  }
  if (key === "flatt") {
    return {
      authorKey: "flatt",
      label: "Bruce Flatt",
      skillCommand: KRW_GURU_FLATT_ADVISOR_SKILL,
    };
  }
  if (key === "terry_smith") {
    return {
      authorKey: "terry_smith",
      label: "Terry Smith",
      skillCommand: KRW_GURU_TERRY_SMITH_ADVISOR_SKILL,
    };
  }

  return {
    authorKey: null,
    label: "auto-selected guru lenses",
    skillCommand: null,
  };
}

function parseGuruLensSelection(userMessage: string): GuruLensSelection {
  const text = userMessage.toLowerCase();
  if (/buffett|버핏|워런|warren/.test(text)) {
    return {
      authorKey: "buffett",
      label: "Warren Buffett",
      skillCommand: KRW_GURU_BUFFETT_ADVISOR_SKILL,
    };
  }
  if (/marks|하워드\s*막스|막스|howard/.test(text)) {
    return {
      authorKey: "marks",
      label: "Howard Marks",
      skillCommand: KRW_GURU_MARKS_ADVISOR_SKILL,
    };
  }
  if (/ackman|애크먼|액먼|bill\s+ackman|빌\s*애크먼|빌\s*액먼/.test(text)) {
    return {
      authorKey: "ackman",
      label: "Bill Ackman",
      skillCommand: KRW_GURU_ACKMAN_ADVISOR_SKILL,
    };
  }
  if (/flatt|플랫|bruce\s+flatt|브루스\s*플랫/.test(text)) {
    return {
      authorKey: "flatt",
      label: "Bruce Flatt",
      skillCommand: KRW_GURU_FLATT_ADVISOR_SKILL,
    };
  }
  if (/terry\s*smith|테리\s*스미스|terry-smith|smith/.test(text)) {
    return {
      authorKey: "terry_smith",
      label: "Terry Smith",
      skillCommand: KRW_GURU_TERRY_SMITH_ADVISOR_SKILL,
    };
  }

  return {
    authorKey: null,
    label: "auto-selected guru lenses",
    skillCommand: null,
  };
}

function guruAdvisorRuntimePrompt(
  responseLocale: Locale,
  lens: GuruLensSelection,
): string {
  const authorInstruction = lens.authorKey
    ? `- Selected guru lens: ${lens.label}. Build an English-first internal investment brief, then call krw_guru_query_context with author_keys=["${lens.authorKey}"] and English-first query text before answering. The selected advisor skill must read and apply its skill-local references/answer-style.md before final rendering.`
    : "- Selected guru lens: auto. Build an English-first internal investment brief first. Call krw_guru_select_lenses with English-first query text, then call krw_guru_query_context using the selected author_keys when the selector returns them. If selection is weak, call krw_guru_query_context without author_keys, still using English-first query text.";

  if (responseLocale === "en") {
    return `KRW Guru Advisor web run:
${authorInstruction}
- Use Guru ontology only: investing principles, question frames, risk lenses, consultation playbooks, and data needs.
- V1 scope: this is an investment-idea pressure-test lens. Help the user find weak assumptions, missing questions, and practical next checks.
- Guru sources are English-first. Even when the user asks in Korean, translate the intent into an English internal investment brief before any Guru MCP selection/search/context call.
- Guru MCP query text must lead with the English brief and English retrieval terms. Preserve the Korean original question only as secondary context.
- If a fixed advisor lens is selected, apply the selected skill's local answer-style file before composing. Do not fall back to a report-style "Buffett lens/perspective" explanation.
- Company-specific Guru workflow: when the active web runtime selects one company ticker, treat it as the company named for this run even if the user's short follow-up does not repeat it. First use krw_guru_query_context -> krw_guru_company_brief -> Agent(subagent_type="company_evidence_researcher") before making durable company claims. Then try krw_guru_review_company_evidence as interpretation guidance. If the review tool fails, do not stop or mention the failure; continue from the subagent's company research and Guru ResearchPack.
- Do not call KRW Ontology filing tools directly from the main Guru Advisor run, even if krw_ontology_* tools appear available. If company-specific filing evidence is needed, call the SDK Agent tool with subagent_type="company_evidence_researcher", a short description, and a prompt containing the ticker, the English company research brief, and latest-10-Q/10-K priority. It uses query_context/query/trace only; the runtime turns its actual ResearchState v2 results into internal company research context.
- Prefer a stable order: gather the Guru lens context, prepare company evidence needs when needed, delegate filing evidence to company_evidence_researcher, review the runtime-built company research context with krw_guru_review_company_evidence, then write the final consultation answer. If a tool input is denied, do not restart the workflow or repeat that denied call; continue from the evidence actually returned in this run.
- For any named-company or ticker-specific judgment, the company_evidence_researcher step is mandatory before making durable company claims. In the default web runtime, do not use Guru source-support tools as a detour after a company brief; they never replace company filing evidence. Do not answer a company-specific judgment after only Guru MCP calls.
- Use krw_guru_company_brief before delegating company evidence when the Guru MCP identifies required filing topics. The default runtime does not use krw_guru_company_pack or krw_ontology_verify_evidence. After company_evidence_researcher returns filing results, krw_guru_review_company_evidence receives the runtime-built company research context to identify what the selected guru lens strengthens, weakens, or cannot resolve. Do not call the review tool with a self-authored context, a retrieval plan, or company_filing_brief itself. If the review tool fails or the context is unavailable, do not stop; continue with conservative consultation prose from the available filing facts.
- The final Guru LLM must do the interpretation work: connect the Guru lens, the user's question, the company research context, and the Guru evidence review into consultation prose without adding new facts, dumping raw numbers, or imposing a fixed report template. A short comparison to a documented historical episode or prior cycle is welcome only when that history appears in the selected Guru ResearchPack; phrase it in third person and never invent an anecdote or claim the investor's identity.
- Before writing the final Guru answer, silently compress the evidence into one core interpretation, one practical concern, and one change condition. These are private reasoning axes, not visible section labels. Do not dump a research summary.
- Use exact figures, dates, and periods when they materially support the user's judgment and are directly supported by the retrieved company evidence. Do not invent figures, thresholds, ratios, or forecasts. Prefer clear business interpretation, durability, incentives, risks, and change conditions over a numeric dump. Use natural consultation paragraphs whose flow changes with the question and selected guru; do not impose a rigid report template or recurring labels unless the user asks for one. In Korean, use standard investor/accounting terms such as 매출총이익률, 영업이익률, 자유현금흐름, 자사주 매입, 반복매출; do not coin awkward terms or mistranslate financial labels.
- When company evidence is partial, give the supported interpretation first and name only the specific business uncertainty that matters to the judgment. Do not turn an internal retrieval gap into a generic refusal.
- Do not tell the user that the current session, tool budget, subagent, MCP, or retrieval process could not confirm data. Translate gaps into investor language: "the exact split is the next check" or "this would need the segment detail to confirm", not process language.
- Do not write interim workflow status to the user. Never include phrases like "ResearchPack received", "company research context received", "delegating to the subagent", "parameter encoding issue", "tool failed", "now writing the final answer", "수신 완료", or "서브에이전트에 위임하겠습니다" before or inside the answer. If a tool call is denied or returns an unusable internal payload, do not retry the overall workflow; continue from available evidence and express only the relevant business uncertainty in normal investor language.
- Start the final answer directly in ${responseLocale === "en" ? "English" : "Korean"} consultation prose. Do not prepend English workflow narration, packet status, separators, or tool diagnostics.
- Do not call current-news tools, visualization tools, WebSearch, or WebFetch.
- Do not use Guru source-support tools as an alternative route in the default web runtime; keep the path focused on lens context, company evidence delegation, evidence review, and final consultation.
- Do not expose tool names, raw reviewed_ids, internal ResearchPack field names, or private excerpts.
- Do not present the guru lens as personal financial advice, a buy/sell/hold recommendation, target price, or valuation conclusion.
- If the user asks for a company-specific judgment, use the company evidence subagent before making durable company claims. Do not invent company facts.
- For a fixed selected guru lens, every Guru MCP call must include the same author_keys value for that selected lens. Do not omit author_keys on krw_guru_company_brief or krw_guru_review_company_evidence.
- Do not force a fixed "what I like / what bothers me / what would change my mind" structure, and do not keep repeating "I like..." or "I worry..." as visible scaffolding. Use those ideas only as private reasoning; the visible answer should read like one coherent consultation whose shape depends on the question and selected guru.
- End with exactly 3 concrete follow-up prompts that continue the guru-lens consultation or deepen the company filing evidence already connected. Put them under the exact Markdown heading "### Follow-up questions" in English answers.
- The final answer must be user-visible English Markdown investor interpretation only.`;
  }

  return `웹앱 구루 온톨로지 실행:
${authorInstruction}
- 구루 온톨로지만 사용합니다. 투자 원칙, 질문 프레임, 리스크 렌즈, 상담 플레이북, 필요한 회사 데이터 항목만 다룹니다.
- v1 범위는 투자 아이디어 점검 렌즈입니다. 사용자의 아이디어에서 약한 가정, 빠진 질문, 다음 확인 포인트를 찾아주는 데 집중합니다.
- 구루 원문/자료는 영어 중심입니다. 사용자가 한국어로 질문해도 Guru MCP 선택/검색/context 호출 전에는 반드시 영어 내부 투자 브리프로 의도를 정리합니다.
- Guru MCP에 넘기는 query text는 영어 브리프와 영어 retrieval terms가 먼저 와야 합니다. 한국어 원문 질문은 보조 context로만 보존합니다.
- 고정 advisor 렌즈가 선택된 경우, 최종 작성 전에 선택된 skill의 로컬 answer-style 파일을 적용합니다. "버핏 렌즈/관점" 같은 보고서식 설명으로 돌아가지 않습니다.
- 활성 웹 런타임에서 회사 티커가 하나 선택된 구루 답변 흐름: 사용자의 짧은 후속 질문에 티커가 다시 없어도 이 실행의 회사로 봅니다. durable한 회사 주장을 하기 전 krw_guru_query_context -> krw_guru_company_brief -> Agent(subagent_type="company_evidence_researcher")로 회사 근거를 먼저 확보합니다. 그다음 krw_guru_review_company_evidence를 해석 보조로 시도합니다. review tool이 실패하면 멈추거나 실패를 노출하지 말고, 서브에이전트의 회사 리서치와 Guru ResearchPack을 바탕으로 계속 답합니다.
- 메인 구루 런에서는 KRW Ontology 공시 도구를 직접 호출하지 않습니다. krw_ontology_* 도구가 보이더라도 메인 런에서 직접 쓰지 않습니다. 회사별 공시 근거가 필요하면 Agent 도구를 subagent_type="company_evidence_researcher"로 호출하고, ticker, 영어 회사 리서치 브리프, 최신 10-Q/10-K 우선순위를 prompt에 넣습니다. 서브에이전트는 query_context/query/trace만 쓰며, 런타임이 실제 ResearchState v2 결과를 내부 회사 리서치 컨텍스트로 바꿉니다.
- 안정적인 순서를 선호합니다. 먼저 Guru lens context를 모으고, 필요하면 회사 근거 요구사항을 정리한 뒤, company_evidence_researcher에 공시 근거를 위임하고, 런타임이 만든 회사 리서치 컨텍스트를 krw_guru_review_company_evidence로 검토합니다. 그 다음 상담형 최종 답변을 씁니다. 도구 입력이 거부되면 전체 workflow를 다시 시작하거나 같은 거부 호출을 반복하지 말고, 이 실행에서 실제로 반환된 근거로 계속 진행합니다.
- 회사명이나 티커가 있는 회사별 판단에서는 durable한 회사 주장을 하기 전에 company_evidence_researcher 단계를 반드시 거칩니다. 기본 웹 런타임에서는 company brief 이후 Guru source-support 도구로 우회하지 않습니다. 그런 도구는 회사 공시 근거를 대체하지 못합니다. Guru MCP 호출만으로 회사별 판단 답변을 끝내지 않습니다.
- Guru MCP가 필요한 회사 공시 주제를 정리하면, 서브에이전트 위임 전 krw_guru_company_brief를 사용합니다. 기본 런타임에서는 krw_guru_company_pack과 krw_ontology_verify_evidence를 사용하지 않습니다. company_evidence_researcher가 공시 결과를 반환하면 런타임이 만든 회사 리서치 컨텍스트를 krw_guru_review_company_evidence에 붙여 선택된 구루 렌즈가 강화되는 부분, 약해지는 부분, 아직 해소하지 못한 부분을 확인합니다. 모델이 만든 컨텍스트, 조회 계획, company_filing_brief 자체를 review tool에 넘기지 않습니다. review tool이 실패하거나 컨텍스트를 만들 수 없어도 멈추지 말고, 확보된 공시 사실을 바탕으로 보수적인 상담형 답변을 계속 씁니다.
- 최종 Guru LLM이 해석을 직접 수행합니다. 구루 렌즈, 사용자 질문, 회사 리서치 컨텍스트, Guru evidence review를 연결해 상담형 문장으로 쓰되 새 사실을 만들거나 숫자를 나열하거나 고정 보고서 템플릿으로 굳히지 않습니다. 선택된 Guru ResearchPack에 문서화된 과거 사례나 사이클이 있을 때만 짧게 비교할 수 있으며, 해당 인물의 역사로 3인칭으로 표현하고 일화나 본인 정체성을 지어내지 않습니다.
- 최종 답변을 쓰기 전, 내부적으로 근거를 하나의 핵심 해석, 하나의 실질적 우려, 하나의 판단 변경 조건으로 압축합니다. 이것은 내부 사고축이지, 사용자에게 보이는 섹션 제목이 아닙니다. 리서치 요약을 그대로 내보내지 않습니다.
- 정확한 수치·날짜·기간이 사용자의 판단에 중요하고 조회된 회사 근거가 직접 뒷받침할 때는 자연스럽게 사용합니다. 수치, 임계값, 비율, 전망을 지어내지 않습니다. 숫자 나열보다 사업 해석, 내구성, 인센티브, 리스크, 판단 변경 조건을 우선합니다. 답변 흐름은 질문과 선택된 구루에 맞춰 자연스럽게 달라져야 하며, 사용자가 요청하지 않는 한 고정 보고서 템플릿이나 반복 라벨을 강요하지 않습니다. 한국어 답변에서는 매출총이익률, 영업이익률, 자유현금흐름, 자사주 매입, 반복매출 같은 표준 투자/회계 용어를 쓰고 어색한 번역어를 만들지 않습니다.
- 회사 근거가 부분적이면, 뒷받침되는 해석을 먼저 제시하고 판단에 중요한 특정 사업상 불확실성만 말합니다. 내부 조회 공백을 일반적인 거절로 바꾸지 않습니다.
- 현재 세션, tool budget, subagent, MCP, retrieval process 때문에 데이터를 확인하지 못했다는 식으로 사용자에게 말하지 않습니다. 부족한 부분은 "정확한 비중은 다음 확인 포인트입니다" 또는 "이 부분은 세그먼트 세부 정보로 확인해야 합니다"처럼 투자자 언어로 바꿉니다.
- 중간 진행 상태를 사용자에게 쓰지 않습니다. "ResearchPack 수신 완료", "회사 리서치 컨텍스트 수신 완료", "서브에이전트에 위임하겠습니다", "parameter encoding issue", "tool failed", "최종 답변을 작성합니다" 같은 내부 workflow 문장은 답변 앞이나 중간에 절대 넣지 않습니다. 도구 호출이 거부되거나 내부 payload를 쓸 수 없으면 전체 workflow를 재시도하지 말고, 확보된 근거로 계속 진행하며 판단에 중요한 사업상 불확실성만 일반 투자자 언어로 표현합니다.
- 최종 답변은 바로 한국어 상담문으로 시작합니다. 영어 workflow 설명, packet 상태, 구분선, 도구 진단 문장을 앞에 붙이지 않습니다.
- 현재 뉴스 도구, 차트 도구, WebSearch, WebFetch를 호출하지 않습니다.
- 기본 웹 런타임에서는 Guru source-support 도구로 우회하지 않고, lens context → company evidence delegation → evidence review → final consultation 흐름을 유지합니다.
- 도구명, raw reviewed_id, 내부 ResearchPack 필드명, private excerpt를 최종 답변에 노출하지 않습니다.
- 구루 렌즈를 개인 투자자문, 매수/매도/보유 추천, 목표가, 밸류에이션 결론처럼 쓰지 않습니다.
- 사용자가 회사별 판단을 물으면 durable한 회사 주장을 하기 전에 회사 evidence 서브에이전트를 사용합니다. 회사 사실은 지어내지 않습니다.
- 고정 구루 렌즈가 선택된 경우, 이 실행의 모든 Guru MCP 호출에는 같은 author_keys 값을 넣습니다. krw_guru_company_brief나 krw_guru_review_company_evidence에서 author_keys를 빠뜨리지 않습니다.
- "무엇을 확인할지", "무엇이 거슬리는지", "무엇이 판단을 바꿀지"는 내부적으로만 점검합니다. "내가 좋아하는...", "내가 불편한...", "내가 조심할..." 같은 표현도 반복하지 않습니다. 사용자에게는 이 생각들을 고정 섹션이나 반복 말투로 내보내지 말고 자연스러운 상담 문장으로 녹입니다.
- 답변 끝에는 구루 렌즈 상담을 이어가거나 이미 연결된 회사 공시 근거를 더 깊게 보는 후속질문 3개를 구체적으로 제안합니다. 후속질문 앞에는 반드시 정확히 "### 이어서 볼 질문" Markdown 제목을 씁니다.
- 최종 답변은 사용자에게 바로 보여줄 한국어 Markdown 투자 해석만 작성합니다.`;
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
- Use the configured current market-news MCP tools directly at runtime to find recent ticker news that answers the user's question.
- Prefer the session/default ticker or the ticker/company named by the user. The current market-news lookup is ticker-based; if no resolvable ticker/company context exists, say the current news read is limited and ask for a specific company.
- Use get_yahoo_finance_news first. Use get_stock_info only when ticker/company identity needs confirmation.
- Treat get_stock_info as safe quote/identity context only. Do not use provider valuation, analyst consensus, target price, recommendation, forward PE, PEG, or growth-estimate fields in the answer.
- Provider names, MCP/tool names, API names, and raw provider payload labels are internal only. Never mention Yahoo Finance or similar provider names in the final answer unless the user explicitly asks about data/debug provenance; say recent market data, price data, or market reporting instead.
- Do not summarize provider results in returned order. First classify results into direct ticker news, indirect market/sector news, and low-relevance news.
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
- 설정된 현재 시장/뉴스 MCP 도구를 런타임에서 직접 호출해서 사용자가 물어본 최근 ticker news를 확인합니다.
- 세션/default ticker 또는 사용자가 말한 ticker/company를 우선합니다. 현재 시장/뉴스 조회는 ticker 기반이므로, 확인 가능한 ticker/company 컨텍스트가 없으면 현재 뉴스 확인 범위가 제한적이라고 말하고 특정 회사를 물어봅니다.
- 먼저 get_yahoo_finance_news를 사용합니다. ticker/company 확인이 필요할 때만 get_stock_info를 보조로 사용합니다.
- get_stock_info는 안전한 가격/회사 식별 맥락으로만 사용합니다. provider의 밸류에이션, 애널리스트 컨센서스, 목표가, 추천등급, forward PE, PEG, 성장률 추정치는 답변에 쓰지 않습니다.
- provider 이름, MCP/tool 이름, API 이름, 원본 provider payload 표현은 내부 정보입니다. 사용자가 데이터/debug 출처를 명시적으로 묻지 않는 한 최종 답변에는 Yahoo Finance 같은 provider 이름을 절대 쓰지 말고, "최근 시장 자료", "가격 데이터", "시장 보도"처럼 사용자-facing 표현으로 씁니다.
- provider 결과를 나온 순서대로 요약하지 않습니다. 먼저 직접 ticker 뉴스, 간접 시장/섹터 뉴스, 낮은 관련 뉴스로 분류합니다.
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
- Use the configured current market-news MCP tools directly at runtime. Use get_stock_info for current price/move and safe technical context, and get_yahoo_finance_news for recent ticker news candidates.
- Treat get_stock_info as safe quote/identity/technical context only. Use only currentPrice, previousClose, regularMarketChangePercent, volume, averageVolume, fiftyDayAverage, twoHundredDayAverage, fiftyTwoWeekLow, fiftyTwoWeekHigh, and marketCap for market/technical interpretation. Do not use provider valuation, analyst consensus, target price, recommendation, forward PE, PEG, or growth-estimate fields in the answer.
- Provider names, MCP/tool names, API names, and raw provider payload labels are internal only. Never mention Yahoo Finance or similar provider names in the final answer unless the user explicitly asks about data/debug provenance; say recent market data, price data, or market reporting instead.
- Prefer the session/default ticker or the ticker/company named by the user. The current market-news lookup is ticker-based; if no ticker/company context is resolvable, say the live market/news read is limited and ask for a specific company.
- Treat quote/news data as market observations, not confirmed company disclosure.
- Do not summarize provider results in returned order. Classify results into direct company news, indirect market/sector context, and low-relevance/newsletter-style items; exclude low-relevance items from the explanation unless needed as a limitation.
- Default first answer: write a compact but substantive market/news investment brief, not a headline summary.
- When there is a usable direct company-news candidate, do not stop after naming the catalyst. Explain what the news actually says, why it could move this stock, which investor assumption it touches, what still needs additional confirmation, and why the move may still be an overreaction or incomplete evidence.
- If the user asks for technical analysis, chart position, moving averages, volume, or trend strength, interpret safe technical fields as market confirmation only. Do not create buy/sell signals, exact entry prices, target prices, or stop-loss levels.
- When both news and technical signals are available, treat news as the catalyst candidate and technical signals as evidence of whether the market reaction is confirmed, stretched, weak, or mixed. Do not say a headline caused the move solely because it appeared near the price move.
- The answer should create a natural next question by making the filing/scenario check feel useful, not by asking the user to choose from generic cards.
- Do not automatically turn every price-move question into a full filing-grounded ontology report.
- Use KRW Ontology only when the user asks for filings, long-term thesis impact, revenue, margin, cash flow, balance sheet, dilution, risk, capital allocation, or when the answer would otherwise imply a durable investment-view change.
- For simple "why did it move" questions, normally stop before KRW Ontology and let numbered follow-up prompts re-enter the router for deeper filing or scenario work.
- Do not write a full forward outlook or scenario analysis in the default market-move answer; offer a numbered scenario follow-up instead.
- End with exactly 3 numbered follow-up prompts. For technical answers, frame them around whether the observed trend can continue, weaken, or reverse. If news and technical signals are both discussed, use one trend-continuation prompt tied to the news, one trend-break/risk prompt, and one scenario-sensitivity prompt. Avoid awkward prompts that mechanically connect a price move to revenue, margin, and cash flow.
- If the current market-news lookup fails, returns no useful direct/indirect results, or the price move cannot be confirmed, state the live market/news read was limited and do not invent a news explanation.
- The final answer must be user-visible English Markdown investor interpretation only.`;
  }

  return `웹앱 주가 변동 research 실행:
- 사용자는 현재 주가가 왜 움직였는지 묻고 있습니다.
- 설정된 현재 시장/뉴스 MCP 도구를 런타임에서 직접 호출합니다. get_stock_info로 현재 가격/변동과 안전한 기술적 맥락을 확인하고, get_yahoo_finance_news로 최근 ticker news 후보를 확인합니다.
- get_stock_info는 안전한 가격/회사 식별/기술적 맥락으로만 사용합니다. 기술적 해석에는 currentPrice, previousClose, regularMarketChangePercent, volume, averageVolume, fiftyDayAverage, twoHundredDayAverage, fiftyTwoWeekLow, fiftyTwoWeekHigh, marketCap만 사용합니다. provider의 밸류에이션, 애널리스트 컨센서스, 목표가, 추천등급, forward PE, PEG, 성장률 추정치는 답변에 쓰지 않습니다.
- provider 이름, MCP/tool 이름, API 이름, 원본 provider payload 표현은 내부 정보입니다. 사용자가 데이터/debug 출처를 명시적으로 묻지 않는 한 최종 답변에는 Yahoo Finance 같은 provider 이름을 절대 쓰지 말고, "최근 시장 자료", "가격 데이터", "시장 보도"처럼 사용자-facing 표현으로 씁니다.
- 세션/default ticker 또는 사용자가 말한 ticker/company를 우선합니다. 현재 시장/뉴스 조회는 ticker 기반이므로, 확인 가능한 ticker/company 컨텍스트가 없으면 실시간 시장/뉴스 확인 범위가 제한적이라고 말하고 특정 회사를 물어봅니다.
- 가격/뉴스 데이터는 시장 관찰값으로만 보고, 회사가 확인한 공시/발표처럼 취급하지 않습니다.
- provider 결과를 나온 순서대로 요약하지 않습니다. 먼저 회사 직접 뉴스, 간접 시장/섹터 맥락, 낮은 관련성/뉴스레터성 항목으로 분류하고, 낮은 관련성 항목은 한계 설명이 필요할 때 외에는 답변 근거에서 제외합니다.
- 기본 첫 답변은 헤드라인 요약이 아니라, 짧지만 얕지 않은 시장/뉴스 투자 브리프로 작성합니다.
- 쓸 만한 회사 직접 뉴스 후보가 있으면 촉매를 이름만 말하고 끝내지 않습니다. 그 뉴스가 실제로 무엇을 말하는지, 왜 이 종목을 움직일 수 있는지, 어떤 투자자 가정에 닿는지, 무엇을 추가로 확인해야 하는지, 아직 과잉반응이거나 불완전한 증거일 수 있는 이유를 설명합니다.
- 사용자가 기술적 분석, 차트 위치, 이평선, 거래량, 추세 강도를 묻는 경우 안전한 기술적 필드만 시장 확인 신호로 해석합니다. 기술 지표만으로 매수/매도 신호, 정확한 진입가, 목표가, 손절가를 만들지 않습니다.
- 뉴스와 기술 신호가 같이 있으면 뉴스는 촉매 후보로, 기술 신호는 시장 반응이 확인됐는지/과열됐는지/약한지/혼재됐는지를 보여주는 보조 신호로 해석합니다. 헤드라인과 가격 움직임이 가까이 있었다는 이유만으로 인과관계를 단정하지 않습니다.
- 답변은 일반 카드 선택을 유도하기보다, 다음 공시/시나리오 확인이 자연스럽게 궁금해지도록 작성합니다.
- 모든 가격 변동 질문을 자동으로 공시 기반 온톨로지 보고서로 바꾸지 않습니다.
- 사용자가 공시, 장기 투자 가정, 매출, 마진, 현금흐름, 재무상태, 희석, 리스크, 자본배분을 묻거나 답변이 지속적인 투자 판단 변화를 암시할 때만 KRW Ontology를 사용합니다.
- 단순한 "왜 움직였나" 질문은 보통 KRW Ontology 조회 전에서 멈추고, 번호가 붙은 후속질문으로 더 깊은 공시/시나리오 작업이 라우터를 다시 타게 합니다.
- 기본 주가 변동 답변 안에서 향후 전망/상승·하락 시나리오를 길게 쓰지 말고, 번호가 붙은 시나리오 후속질문으로 제안합니다.
- 후속질문은 정확히 3개를 쓰고, 모두 "1.", "2.", "3." 번호가 붙은 형태로 작성합니다.
- 후속질문은 1개는 같은 회사의 추가 확인 질문, 1개는 scenario_sensitivity로 이어지는 시나리오 질문, 1개는 반대 근거/과잉반응/판단이 깨지는 조건 질문으로 씁니다.
- 기술적 분석 답변의 후속질문은 "이 추세가 이어질 수 있는 조건", "이 흐름이 꺾일 수 있는 리스크", "상승·하락·횡보 시나리오" 중심으로 씁니다. "이 가격 움직임이 매출·마진·현금흐름 변화와 연결되는지 확인해줘"처럼 부자연스러운 문구는 쓰지 않습니다.
- 뉴스와 기술 신호를 같이 설명했다면 후속질문도 뉴스와 추세를 연결합니다. 예: "이 뉴스가 추세를 이어가게 만들 조건을 회사 자료 기준으로 확인해줘.", "이 흐름이 꺾일 수 있는 리스크 신호를 정리해줘.", "상승·하락·횡보 시나리오별로 이 뉴스와 추세를 나눠줘."
- 시나리오 질문은 "상승·하락·횡보 시나리오별로 이 움직임을 나눠줘", "이 움직임이 과잉반응인지 시나리오별로 점검해줘"처럼 일반 개인투자자가 바로 보낼 수 있는 말로 씁니다.
- 후속질문은 전문 리서치 과제처럼 쓰지 말고, 설명 없는 영어 약어·공시 항목명·밸류에이션 모델 용어를 피합니다.
- 현재 시장/뉴스 조회가 실패하거나, 직접/간접 관련 뉴스가 부족하거나, 가격 변동을 확인하지 못하면 실시간 시장/뉴스 확인이 제한적이었다고 말하고 뉴스 설명을 지어내지 않습니다.
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
