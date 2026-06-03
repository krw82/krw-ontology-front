import type {
  ChatCitation,
  DocumentType,
  MCPToolName,
  ResearchActivityUpdate,
} from "@/types/api-contracts";

export type EvidenceGraphNodeKind =
  | "company"
  | "document"
  | "evidence"
  | "metric"
  | "topic";

export interface EvidenceGraphToolCall {
  tool_name: MCPToolName;
  status: "running" | "completed" | "failed";
  arguments?: Record<string, unknown>;
}

export interface EvidenceGraphNode {
  id: string;
  label: string;
  detail?: string;
  kind: EvidenceGraphNodeKind;
}

export interface EvidenceGraphEdge {
  id: string;
  from: string;
  to: string;
}

export interface EvidenceGraphPreviewModel {
  title: string;
  nodes: EvidenceGraphNode[];
  edges: EvidenceGraphEdge[];
  activeNodeId: string | null;
}

const toolTitleMap: Partial<Record<MCPToolName, string>> = {
  krw_ontology_catalog: "문서 범위 확인 중",
  krw_ontology_company_context: "기업 컨텍스트 확인 중",
  krw_ontology_index_context: "인덱스 확인 중",
  krw_ontology_topic_map: "관련 토픽 확인 중",
  krw_ontology_plan_query: "검색 범위 구성 중",
  krw_ontology_query: "공시 근거 검색 중",
  krw_ontology_query_context: "검색 컨텍스트 확인 중",
  krw_ontology_retrieve: "질문 기반 근거 검색 중",
  krw_ontology_trace: "근거 연결 추적 중",
  krw_ontology_chain: "주장-근거 체인 확인 중",
  krw_ontology_quality: "근거 품질 점검 중",
  krw_ontology_compare: "항목 비교 중",
  route_news_question: "뉴스 질문 분류 중",
  resolve_news_entities: "뉴스 대상 확인 중",
  search_company_news_events: "기업 뉴스 이벤트 확인 중",
  search_market_news_events: "시장 뉴스 이벤트 확인 중",
  search_news_by_domain: "출처별 뉴스 확인 중",
  read_news_sources: "뉴스 원문 확인 중",
  build_news_timeline: "뉴스 흐름 정리 중",
  audit_news_sources: "뉴스 출처 점검 중",
};

const documentLabels: Partial<Record<DocumentType, string>> = {
  annual_report: "10-K",
  quarterly_report: "10-Q",
  securities_report: "10-K",
  current_report: "8-K",
  registration_statement: "S-1",
  business_report: "Report",
  audit_report: "Audit",
  semi_annual_report: "Semiannual",
};

const objectTypeLabels: Record<string, string> = {
  claim: "Claim",
  risk: "Risk",
  growth_driver: "Growth",
  external_factor_exposure: "External factor",
  numeric_evidence: "Numeric evidence",
  quote: "Quote",
};

const routeObjectTypeLabels: Record<string, string> = {
  BusinessFactor: "business factors",
  EvidenceQuote: "source quotes",
  ExternalFactorExposure: "external factors",
  MetricObservation: "numeric evidence",
  ResearchClaim: "filing claims",
  claim: "filing claims",
  evidence_quote: "source quotes",
  external_factor_exposure: "external factors",
  growth_driver: "growth drivers",
  numeric_evidence: "numeric evidence",
  quote: "source quotes",
  risk: "business risks",
};

const routeTopicPatterns: Array<[RegExp, string]> = [
  [/\btariff|trade policy|import cost|import costs|무역|관세/i, "tariff trade policy"],
  [/\bhormuz|geopolitical|chokepoint|해협|호르무즈/i, "geopolitical risk"],
  [
    /\bshipping|transportation|fulfillment|fuel|energy|crude oil|운송|배송|연료/i,
    "shipping & fuel cost",
  ],
  [/\bsupply chain|supplier|inventory|공급망|공급/i, "supply chain"],
  [/\bmargin|profitability|operating margin|gross margin|마진|이익률/i, "margin pressure"],
  [/\brevenue|sales|demand|customer|매출|수요|고객/i, "revenue demand"],
  [/\bcost|expense|capex|비용|원가/i, "cost pressure"],
  [/\bcash flow|ocf|fcf|현금흐름/i, "cash flow"],
  [/\bregulation|regulatory|litigation|규제|소송/i, "regulatory risk"],
];

const topicPatterns: Array<[RegExp, string]> = [
  [/\brevenue|sales|매출/i, "Revenue"],
  [/\bmargin|gross margin|operating margin|마진|이익률/i, "Margin"],
  [/\bsupply|supplier|inventory|constraint|조달|공급/i, "Supply"],
  [/\brisk|litigation|regulation|리스크|위험/i, "Risk"],
  [/\bcost|expense|capex|비용|원가/i, "Cost"],
  [/\bcash flow|ocf|fcf|현금흐름/i, "Cash flow"],
  [/\bdemand|customer|수요|고객/i, "Demand"],
];

function addNode(
  nodes: EvidenceGraphNode[],
  seen: Set<string>,
  node: EvidenceGraphNode,
) {
  if (seen.has(node.id) || nodes.length >= 6) return;
  seen.add(node.id);
  nodes.push(node);
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function getFirstArgumentValue(
  toolCalls: EvidenceGraphToolCall[],
  keys: string[],
): string | null {
  for (const toolCall of toolCalls) {
    for (const key of keys) {
      const values = asStringArray(toolCall.arguments?.[key]);
      if (values[0]) return values[0];
    }
  }
  return null;
}

function collectArgumentValues(
  toolCalls: EvidenceGraphToolCall[],
  keys: string[],
): string[] {
  return toolCalls.flatMap((toolCall) =>
    keys.flatMap((key) => asStringArray(toolCall.arguments?.[key])),
  );
}

function collectArgumentText(toolCalls: EvidenceGraphToolCall[]): string {
  return toolCalls
    .flatMap((toolCall) => [
      ...asStringArray(toolCall.arguments?.topic),
      ...asStringArray(toolCall.arguments?.question),
      ...asStringArray(toolCall.arguments?.query),
      ...asStringArray(toolCall.arguments?.object_id),
    ])
    .join(" ");
}

function addUniqueValue(values: string[], seen: Set<string>, value: string) {
  const normalized = value.trim();
  const key = normalized.toLowerCase();
  if (!normalized || seen.has(key)) return;
  seen.add(key);
  values.push(normalized);
}

function normalizeDocumentType(documentType?: string | null): string | null {
  if (!documentType) return null;
  return documentLabels[documentType as DocumentType] ?? documentType;
}

function buildDocumentLabel(
  citation?: ChatCitation,
  fallbackPeriod?: string | null,
  fallbackDocumentType?: string | null,
): string | null {
  const period = citation?.period ?? fallbackPeriod;
  const document = normalizeDocumentType(
    citation?.document_type ?? fallbackDocumentType,
  );

  if (period && document) return `${period} ${document}`;
  return document ?? period ?? null;
}

function getObjectTypeLabel(objectId?: string | null): string | null {
  if (!objectId) return null;
  const objectType = objectId.split(":")[0];
  return objectTypeLabels[objectType] ?? null;
}

function collectTopicLabels(toolCalls: EvidenceGraphToolCall[], citations: ChatCitation[]) {
  const text = [
    collectArgumentText(toolCalls),
    ...citations.map((citation) =>
      [citation.object_id, citation.claim_text, citation.quote_text]
        .filter(Boolean)
        .join(" "),
    ),
  ].join(" ");

  return topicPatterns
    .filter(([pattern]) => pattern.test(text))
    .map(([, label]) => label);
}

function collectRouteTopicLabels(
  toolCalls: EvidenceGraphToolCall[],
  citations: ChatCitation[],
): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const argumentTopicTexts = collectArgumentValues(toolCalls, [
    "topic",
    "topics",
    "query",
    "question",
  ]);

  for (const text of argumentTopicTexts) {
    if (labels.length >= 3) break;
    addUniqueValue(labels, seen, fallbackTopicLabel(text));
  }

  if (labels.length > 0) return labels.slice(0, 3);

  const citationTexts = citations.map((citation) =>
    [citation.claim_text, citation.quote_text].filter(Boolean).join(" "),
  );

  for (const text of citationTexts) {
    for (const [pattern, label] of routeTopicPatterns) {
      if (pattern.test(text)) addUniqueValue(labels, seen, label);
    }
  }

  for (const text of citationTexts) {
    if (labels.length >= 3) break;
    addUniqueValue(labels, seen, fallbackTopicLabel(text));
  }

  return labels.slice(0, 3);
}

function fallbackTopicLabel(value: string): string {
  return value
    .replace(/[_:/|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word.length > 1)
    .slice(0, 5)
    .join(" ");
}

function collectRouteEvidenceLabels(
  toolCalls: EvidenceGraphToolCall[],
  citations: ChatCitation[],
): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  const objectTypes = collectArgumentValues(toolCalls, [
    "object_type",
    "object_types",
  ]);

  for (const objectType of objectTypes) {
    const label = routeObjectTypeLabels[objectType] ?? null;
    if (label) addUniqueValue(labels, seen, label);
  }

  for (const citation of citations) {
    const objectType = citation.object_id?.split(":")[0];
    const label = objectType ? routeObjectTypeLabels[objectType] : null;
    if (label) addUniqueValue(labels, seen, label);
  }

  return labels.slice(0, 3);
}

function getActiveTitle(
  toolCalls: EvidenceGraphToolCall[],
  activity?: ResearchActivityUpdate | null,
): string {
  const runningTool = [...toolCalls]
    .reverse()
    .find((toolCall) => toolCall.status === "running");
  const latestTool = toolCalls.at(-1);
  const tool = runningTool ?? latestTool;

  if (tool) return toolTitleMap[tool.tool_name] ?? "근거 경로 생성 중";
  return activity?.label ?? "근거 경로 생성 중";
}

function getLatestToolCall(
  toolCalls: EvidenceGraphToolCall[],
): EvidenceGraphToolCall | undefined {
  return (
    [...toolCalls].reverse().find((toolCall) => toolCall.status === "running") ??
    toolCalls.at(-1)
  );
}

function getActiveNodeId({
  companyNodeId,
  evidenceNodeId,
  toolCalls,
  topicNodes,
}: {
  companyNodeId: string;
  evidenceNodeId: string;
  toolCalls: EvidenceGraphToolCall[];
  topicNodes: EvidenceGraphNode[];
}): string {
  const latestTool = getLatestToolCall(toolCalls);
  if (!latestTool) return companyNodeId;

  switch (latestTool.tool_name) {
    case "krw_ontology_catalog":
    case "krw_ontology_company_context":
    case "krw_ontology_index_context":
      return companyNodeId;
    case "krw_ontology_topic_map":
    case "krw_ontology_plan_query":
    case "krw_ontology_query":
    case "krw_ontology_query_context":
    case "krw_ontology_retrieve":
    case "route_news_question":
    case "resolve_news_entities":
    case "search_company_news_events":
    case "search_market_news_events":
    case "search_news_by_domain":
    case "read_news_sources":
    case "build_news_timeline":
    case "audit_news_sources":
      return topicNodes.at(-1)?.id ?? evidenceNodeId;
    case "krw_ontology_trace":
    case "krw_ontology_chain":
    case "krw_ontology_quality":
    case "krw_ontology_compare":
    default:
      return evidenceNodeId;
  }
}

export function buildEvidenceGraphPreview(
  toolCalls: EvidenceGraphToolCall[] = [],
  citations: ChatCitation[] = [],
  activity?: ResearchActivityUpdate | null,
): EvidenceGraphPreviewModel {
  const nodes: EvidenceGraphNode[] = [];
  const seen = new Set<string>();
  const primaryCitation = citations.find((citation) => citation.object_id) ?? citations[0];
  const fallbackTicker = getFirstArgumentValue(toolCalls, ["ticker", "tickers"]);
  const fallbackPeriod = getFirstArgumentValue(toolCalls, ["period", "periods"]);
  const fallbackDocumentType = getFirstArgumentValue(toolCalls, [
    "document_type",
    "document_types",
  ]);
  const ticker = primaryCitation?.ticker ?? fallbackTicker;
  const documentLabel = buildDocumentLabel(
    primaryCitation,
    fallbackPeriod,
    fallbackDocumentType,
  );
  const legacyEvidenceLabel = getObjectTypeLabel(primaryCitation?.object_id);
  const routeTopicLabels = collectRouteTopicLabels(toolCalls, citations);
  const topicLabels =
    routeTopicLabels.length > 0
      ? routeTopicLabels
      : collectTopicLabels(toolCalls, citations);
  const evidenceLabels = collectRouteEvidenceLabels(toolCalls, citations);
  const companyNodeId = ticker ? `company:${ticker}` : "company:research";
  const evidenceDetail =
    evidenceLabels.join(" · ") || documentLabel || legacyEvidenceLabel || undefined;

  addNode(nodes, seen, {
    id: companyNodeId,
    label: "Ontology Context",
    detail: "research scope",
    kind: "company",
  });

  for (const label of topicLabels) {
    addNode(nodes, seen, {
      id: `topic:${label}`,
      label,
      detail: "search topic",
      kind: label === "Revenue" || label === "Margin" || label === "Cost"
        ? "metric"
        : "topic",
    });
  }

  const evidenceNodeId = "evidence:filing-evidence";
  addNode(nodes, seen, {
    id: evidenceNodeId,
    label: "filing evidence",
    detail: evidenceDetail,
    kind: "evidence",
  });

  const topicNodes = nodes.filter((node) => node.kind === "topic" || node.kind === "metric");
  const edges =
    topicNodes.length > 0
      ? topicNodes.flatMap((node) => [
          {
            id: `${companyNodeId}->${node.id}`,
            from: companyNodeId,
            to: node.id,
          },
          {
            id: `${node.id}->${evidenceNodeId}`,
            from: node.id,
            to: evidenceNodeId,
          },
        ])
      : [
          {
            id: `${companyNodeId}->${evidenceNodeId}`,
            from: companyNodeId,
            to: evidenceNodeId,
          },
        ];

  return {
    title: getActiveTitle(toolCalls, activity),
    nodes,
    edges: edges.filter((edge) =>
      nodes.some((node) => node.id === edge.from) &&
      nodes.some((node) => node.id === edge.to),
    ),
    activeNodeId: getActiveNodeId({
      companyNodeId,
      evidenceNodeId,
      toolCalls,
      topicNodes,
    }),
  };
}
