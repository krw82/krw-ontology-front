type Row = Record<string, unknown>;

type BriefLike = {
  entities: Array<{
    type: string;
    ticker: string | null;
    name: string;
    relationship: string;
    relationshipReason: string;
    confidence: number;
  }>;
  researchPaths: Array<{
    id: string;
    question: string;
    evidenceTargets: string[];
    relatedTickers: string[];
    priority: number;
    chatQuery: string;
  }>;
};

export function supplementMarketIssueComposedBrief<T extends { brief: BriefLike }>(
  composed: T,
  packet: Row,
): T {
  const ticker = primaryTicker(packet);
  if (!ticker) return composed;

  const entities = composed.brief.entities.length > 0
    ? composed.brief.entities
    : [{
      type: "company",
      ticker,
      name: ticker,
      relationship: "direct",
      relationshipReason: "공식 발표 원문과 직접 연결된 기업",
      confidence: 0.9,
    }];
  const researchPaths = composed.brief.researchPaths.length > 0
    ? composed.brief.researchPaths
    : [{
      id: "filing-baseline",
      question: `${ticker}의 이번 발표가 매출 성장, 매출총이익률, 현금흐름에 어떻게 이어지는지 확인할까?`,
      evidenceTargets: ["최근 10-Q 또는 10-K", "경영진 실적 발표 자료"],
      relatedTickers: [ticker],
      priority: 1,
      chatQuery: `${ticker}의 이번 공식 발표가 기존 투자 논지에 미치는 영향을 분석해줘. 최근 10-Q 또는 10-K와 경영진 코멘트를 기준으로 매출 성장의 질, 매출총이익률, 현금흐름에서 확인된 내용과 추가로 봐야 할 조건을 나눠줘.`,
    }];

  if (entities === composed.brief.entities && researchPaths === composed.brief.researchPaths) {
    return composed;
  }

  return {
    ...composed,
    brief: {
      ...composed.brief,
      entities,
      researchPaths,
    },
  } as T;
}

function primaryTicker(packet: Row): string | null {
  const payload = asRow(packet.payload);
  const researchContext = asRow(payload.research_context);
  for (const value of stringArray(researchContext.primaryTickers)) {
    const ticker = value.trim().toUpperCase();
    if (/^[A-Z]{1,5}(?:\.[A-Z])?$/.test(ticker)) return ticker;
  }
  return null;
}

function asRow(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
