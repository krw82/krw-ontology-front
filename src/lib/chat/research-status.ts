import type {
  MCPToolName,
  QueueStatus,
  ResearchActivityUpdate,
} from "@/types/api-contracts";

export type ResearchStepId = "scope" | "search" | "trace" | "compose";
export type ResearchStepStatus = "idle" | "running" | "complete";

export interface ResearchToolCallStatus {
  tool_name: MCPToolName;
  status: "running" | "completed" | "failed";
}

export interface ResearchStep {
  id: ResearchStepId;
  label: string;
  status: ResearchStepStatus;
}

const toolLabels: Partial<Record<MCPToolName, string>> = {
  krw_ontology_catalog: "최신 보고서 확인",
  krw_ontology_company_context: "회사 구조 확인",
  krw_ontology_index_context: "분석 범위 확인",
  krw_ontology_topic_map: "관련 이슈 확인",
  krw_ontology_plan_query: "확인할 단서 좁히기",
  krw_ontology_query: "사업·재무 단서 확인",
  krw_ontology_query_context: "핵심 근거 묶음 확인",
  krw_ontology_retrieve: "질문 관련 근거 확인",
  krw_ontology_trace: "근거 연결 확인",
  krw_ontology_chain: "판단 근거 대조",
  krw_ontology_quality: "답변 근거 점검",
  krw_ontology_compare: "회사·항목 비교",
  krw_ontology_verify_evidence: "회사 근거 검증",
  route_news_question: "뉴스 질문 분류",
  resolve_news_entities: "뉴스 대상 확인",
  search_company_news_events: "기업 뉴스 이벤트 확인",
  search_market_news_events: "시장 뉴스 이벤트 확인",
  search_news_by_domain: "출처별 뉴스 확인",
  read_news_sources: "뉴스 원문 확인",
  build_news_timeline: "뉴스 흐름 정리",
  audit_news_sources: "뉴스 출처 점검",
  get_feed_items: "선택한 피드 확인",
  list_feed_items: "피드 이슈 확인",
  get_feed_context: "피드 분석 맥락 구성",
  get_yahoo_finance_news: "최근 뉴스 확인",
  get_stock_info: "가격 움직임 확인",
  compose_visualization: "근거 기반 시각화 정리",
  krw_guru_status: "구루 온톨로지 상태 확인",
  krw_guru_search: "구루 렌즈 검색",
  krw_guru_query_context: "구루 렌즈 근거 확인",
  krw_guru_select_lenses: "적합한 구루 렌즈 선택",
  krw_guru_context: "구루 상담 맥락 구성",
  krw_guru_trace: "구루 근거 연결 확인",
  krw_guru_chain: "구루 판단 경로 확인",
  krw_guru_evidence: "구루 원칙 근거 확인",
  krw_guru_data_needs: "필요한 회사 근거 정리",
  krw_guru_eval_questions: "구루 평가 질문 확인",
  krw_guru_company_brief: "회사 질문 정리",
  krw_guru_company_pack: "회사 근거와 구루 렌즈 결합",
  krw_guru_review_company_evidence: "회사 근거를 구루 렌즈로 재검토",
  get_filing: "공시 제출 정보 확인",
  get_filing_brief: "공시 핵심 요약 확인",
  search_catalog_filings: "관련 공시 목록 확인",
  list_filing_sections: "공시 원문 항목 확인",
  read_filing_section: "공시 원문 근거 확인",
  list_filing_documents: "공시 첨부 문서 확인",
  read_filing_document: "공시 첨부 원문 확인",
  get_form4_insider_transactions: "내부자 거래 내역 확인",
  get_coverage_state: "내 커버리지와 가설 확인",
  list_filing_judgments: "이전 공시 판단 확인",
  get_decision_timeline: "판단 변화 흐름 확인",
  list_open_questions: "열린 리서치 질문 확인",
};

const toolStepMap: Record<MCPToolName, ResearchStepId> = {
  krw_ontology_catalog: "scope",
  krw_ontology_company_context: "scope",
  krw_ontology_index_context: "scope",
  krw_ontology_topic_map: "scope",
  krw_ontology_plan_query: "scope",
  krw_ontology_query: "search",
  krw_ontology_query_context: "search",
  krw_ontology_retrieve: "search",
  krw_ontology_trace: "trace",
  krw_ontology_chain: "trace",
  krw_ontology_quality: "compose",
  krw_ontology_compare: "compose",
  krw_ontology_verify_evidence: "trace",
  route_news_question: "scope",
  resolve_news_entities: "scope",
  search_company_news_events: "search",
  search_market_news_events: "search",
  search_news_by_domain: "search",
  read_news_sources: "search",
  build_news_timeline: "trace",
  audit_news_sources: "compose",
  get_feed_items: "scope",
  list_feed_items: "search",
  get_feed_context: "scope",
  get_yahoo_finance_news: "search",
  get_stock_info: "search",
  compose_visualization: "compose",
  krw_guru_status: "scope",
  krw_guru_select_lenses: "scope",
  krw_guru_search: "search",
  krw_guru_query_context: "search",
  krw_guru_context: "search",
  krw_guru_trace: "trace",
  krw_guru_chain: "trace",
  krw_guru_evidence: "trace",
  krw_guru_data_needs: "compose",
  krw_guru_eval_questions: "compose",
  krw_guru_company_brief: "scope",
  krw_guru_company_pack: "compose",
  krw_guru_review_company_evidence: "compose",
  get_filing: "scope",
  get_filing_brief: "scope",
  search_catalog_filings: "scope",
  list_filing_sections: "search",
  read_filing_section: "search",
  list_filing_documents: "search",
  read_filing_document: "search",
  get_form4_insider_transactions: "search",
  get_coverage_state: "scope",
  list_filing_judgments: "search",
  get_decision_timeline: "trace",
  list_open_questions: "scope",
};

const baseSteps: Array<{ id: ResearchStepId; label: string }> = [
  { id: "scope", label: "최신 기준 확인" },
  { id: "search", label: "사업·재무 단서 확인" },
  { id: "trace", label: "영향 경로 확인" },
  { id: "compose", label: "투자 해석 정리" },
];

export function formatResearchDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.round(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes <= 0) return `${seconds}초`;
  if (seconds === 0) return `${minutes}분`;
  return `${minutes}분 ${seconds}초`;
}

export function getResearchToolLabel(toolName: MCPToolName): string {
  return toolLabels[toolName] ?? "근거 확인";
}

export function getResearchActivityLabel(
  activity?: ResearchActivityUpdate | null,
): string {
  switch (activity?.stage) {
    case "queued":
      return "대기열 대기";
    case "routing":
      return "질문 유형 확인";
    case "connecting":
      return "자료 확인 시작";
    case "checking_evidence":
      return "사업·재무 영향 정리";
    case "composing":
      return "투자 해석 작성";
    case "complete":
      return "작업 완료";
    case "preparing":
      return "최신 기준 확인";
    case "researching":
    default:
      return "사업·재무 단서 확인";
  }
}

export function getQueueStatusLabel(queue?: QueueStatus | null): string {
  if (!queue) return "앞 작업이 끝나면 자동으로 시작됩니다";

  const ahead = queue.queued_ahead;

  if (ahead <= 0) {
    return "다음 순서";
  }

  return `앞에 ${ahead}개 대기`;
}

export function getActiveResearchLabel(
  toolCalls: ResearchToolCallStatus[] = [],
  activity?: ResearchActivityUpdate | null,
): string {
  const runningTool = [...toolCalls]
    .reverse()
    .find((toolCall) => toolCall.status === "running");

  if (runningTool) return getResearchToolLabel(runningTool.tool_name);

  const latestTool = toolCalls.at(-1);
  if (latestTool) return getResearchToolLabel(latestTool.tool_name);

  return getResearchActivityLabel(activity);
}

export function buildResearchSteps(
  toolCalls: ResearchToolCallStatus[] = [],
): ResearchStep[] {
  const touchedSteps = new Set<ResearchStepId>();
  const runningSteps = new Set<ResearchStepId>();

  for (const toolCall of toolCalls) {
    const step = toolStepMap[toolCall.tool_name];
    touchedSteps.add(step);
    if (toolCall.status === "running") {
      runningSteps.add(step);
    }
  }

  return baseSteps.map((step) => {
    if (runningSteps.has(step.id)) {
      return { ...step, status: "running" };
    }

    if (touchedSteps.has(step.id)) {
      return { ...step, status: "complete" };
    }

    return { ...step, status: "idle" };
  });
}
