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
  krw_ontology_catalog: "문서 범위 확인",
  krw_ontology_company_context: "기업 컨텍스트 확인",
  krw_ontology_index_context: "인덱스 컨텍스트 확인",
  krw_ontology_topic_map: "관련 토픽 확인",
  krw_ontology_plan_query: "검색 범위 구성",
  krw_ontology_query: "공시 근거 검색",
  krw_ontology_query_context: "검색 컨텍스트 확인",
  krw_ontology_retrieve: "질문 기반 근거 검색",
  krw_ontology_trace: "근거 연결 추적",
  krw_ontology_chain: "주장-근거 체인 확인",
  krw_ontology_quality: "근거 품질 점검",
  krw_ontology_compare: "항목 비교",
  route_news_question: "뉴스 질문 분류",
  resolve_news_entities: "뉴스 대상 확인",
  search_company_news_events: "기업 뉴스 이벤트 확인",
  search_market_news_events: "시장 뉴스 이벤트 확인",
  search_news_by_domain: "출처별 뉴스 확인",
  read_news_sources: "뉴스 원문 확인",
  build_news_timeline: "뉴스 흐름 정리",
  audit_news_sources: "뉴스 출처 점검",
  get_yahoo_finance_news: "최근 뉴스 확인",
  get_stock_info: "티커 정보 확인",
  create_chart_v1: "차트 정리",
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
  route_news_question: "scope",
  resolve_news_entities: "scope",
  search_company_news_events: "search",
  search_market_news_events: "search",
  search_news_by_domain: "search",
  read_news_sources: "search",
  build_news_timeline: "trace",
  audit_news_sources: "compose",
  get_yahoo_finance_news: "search",
  get_stock_info: "search",
  create_chart_v1: "compose",
};

const baseSteps: Array<{ id: ResearchStepId; label: string }> = [
  { id: "scope", label: "범위 설정" },
  { id: "search", label: "근거 검색" },
  { id: "trace", label: "경로 확인" },
  { id: "compose", label: "답변 정리" },
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
      return "자료 연결";
    case "checking_evidence":
      return "근거 정리";
    case "composing":
      return "답변 작성";
    case "complete":
      return "작업 완료";
    case "preparing":
      return "분석 준비";
    case "researching":
    default:
      return "근거 확인";
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
