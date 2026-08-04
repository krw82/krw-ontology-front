export type MarketIssueResearchContextClaim = {
  id: string;
  claimKo: string;
  rawValue: string | null;
  evidenceIds: string[];
};

export type MarketIssueResearchContextSource = {
  sourceItemId: string;
  publisher: string;
  authorHandle: string | null;
  sourceTags: string[];
  canonicalUrl: string;
  publishedAt: string;
};

export type MarketIssueResearchContext = {
  version: "news-research-context/v1";
  route: "company_event_impact" | "manual_company_selection";
  primaryTickers: string[];
  tickerResolution: Array<{
    ticker: string;
    method: "source_tag" | "official_handle";
  }>;
  eventType: "earnings" | "product_activity" | "regulatory" | "general";
  researchQuestionKo: string;
  checkpointsKo: string[];
  claimIds: string[];
  sources: Array<{
    sourceItemId: string;
    publisher: string;
    canonicalUrl: string;
    publishedAt: string;
  }>;
};

const OFFICIAL_HANDLE_TICKERS: Record<string, string[]> = {
  amd: ["AMD"],
  apple: ["AAPL"],
  cmegroup: ["CME"],
  google: ["GOOGL"],
  microsoft: ["MSFT"],
  nasdaq: ["NDAQ"],
  nvidia: ["NVDA"],
  nyse: ["ICE"],
  tsmcglobal: ["TSM"],
};

export function buildMarketIssueResearchContext(input: {
  claims: readonly MarketIssueResearchContextClaim[];
  sources: readonly MarketIssueResearchContextSource[];
}): MarketIssueResearchContext {
  const tickerResolution = resolveTickers(input.sources);
  const primaryTickers = tickerResolution.map((entry) => entry.ticker);
  const eventType = resolveEventType(input.claims);

  return {
    version: "news-research-context/v1",
    route: primaryTickers.length > 0 ? "company_event_impact" : "manual_company_selection",
    primaryTickers,
    tickerResolution,
    eventType,
    researchQuestionKo: researchQuestion(eventType, primaryTickers),
    checkpointsKo: researchCheckpoints(eventType),
    claimIds: input.claims.map((claim) => claim.id),
    sources: input.sources.map((source) => ({
      sourceItemId: source.sourceItemId,
      publisher: source.publisher,
      canonicalUrl: source.canonicalUrl,
      publishedAt: source.publishedAt,
    })),
  };
}

function resolveTickers(sources: readonly MarketIssueResearchContextSource[]): MarketIssueResearchContext["tickerResolution"] {
  const resolved: MarketIssueResearchContext["tickerResolution"] = [];
  const seen = new Set<string>();
  const add = (ticker: string, method: "source_tag" | "official_handle") => {
    if (!/^[A-Z]{1,5}(?:\.[A-Z])?$/.test(ticker) || seen.has(ticker)) return;
    seen.add(ticker);
    resolved.push({ ticker, method });
  };

  for (const source of sources) {
    const handle = normalizeHandle(source.authorHandle || source.publisher);
    const officialTickers = OFFICIAL_HANDLE_TICKERS[handle] || [];
    for (const ticker of officialTickers) add(ticker, "official_handle");
    for (const tag of source.sourceTags) {
      if (!isExplicitTickerTag(tag)) continue;
      const ticker = normalizeTicker(tag);
      if (officialTickers.length > 0 && !officialTickers.includes(ticker)) continue;
      add(ticker, "source_tag");
    }
  }
  return resolved;
}

function resolveEventType(claims: readonly MarketIssueResearchContextClaim[]): MarketIssueResearchContext["eventType"] {
  const text = claims.map((claim) => claim.claimKo).join(" ").toLocaleLowerCase("en-US");
  if (/(revenue|earnings|financial results|annual|quarter|매출|실적|수익)/i.test(text)) return "earnings";
  if (/(futures|options|contracts|notional|trading volume|launch|product|선물|계약|거래량|출시)/i.test(text)) return "product_activity";
  if (/(sec|fomc|regulat|규제|금리|연준)/i.test(text)) return "regulatory";
  return "general";
}

function researchQuestion(eventType: MarketIssueResearchContext["eventType"], tickers: string[]): string {
  const company = tickers.join(", ") || "이 회사";
  if (eventType === "earnings") {
    return company + "의 발표 수치가 매출 성장의 질, 마진, 현금흐름과 다음 가이던스에 어떤 변화를 의미하는지 확인한다.";
  }
  if (eventType === "product_activity") {
    return company + "의 제품·거래 활동이 전체 거래량과 매출에서 유의미한지, 수수료·지속성 경로를 확인한다.";
  }
  if (eventType === "regulatory") {
    return company + "에 대한 규제·정책 변화가 사업, 비용, 수요에 미치는 경로를 확인한다.";
  }
  return company + "의 이번 발표가 사업과 재무에 연결되는 경로를 확인한다.";
}

function researchCheckpoints(eventType: MarketIssueResearchContext["eventType"]): string[] {
  if (eventType === "earnings") {
    return ["뉴스 수치와 다음 공시의 매출·세그먼트 지표", "마진과 현금흐름의 동행 여부", "CAPEX·가이던스 변화"];
  }
  if (eventType === "product_activity") {
    return ["제품 활동의 전체 거래량·매출 비중", "활동이 수수료·매출로 이어지는 경로", "일시적 변동성인지 지속적 수요인지"];
  }
  if (eventType === "regulatory") {
    return ["직접 노출된 사업·지역", "비용·수요·자본 경로", "다음 공시에서 확인할 조건"];
  }
  return ["사업 연결 경로", "재무 영향 경로", "다음 공시 확인 지점"];
}

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

function isExplicitTickerTag(value: string): boolean {
  return /^[A-Z]{1,5}(?:\.[A-Z])?$/.test(value.trim());
}

function normalizeHandle(value: string): string {
  return value.trim().replace(/^@/, "").toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, "");
}
