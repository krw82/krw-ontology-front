import {
  isMarketIssueStatusLabel,
  parseMarketIssueResearchPaths,
  type MarketIssueEntity,
  type MarketIssueResearchPath,
  type MarketIssueStatusLabel,
} from "@/lib/market-issues/contract";

const PROHIBITED_INVESTMENT_LANGUAGE = [
  /매수/,
  /매도/,
  /손절/,
  /급등/,
  /폭등/,
  /대박/,
  /수혜주/,
  /저점/,
  /목표가/,
  /무조건\s*오/,
  /반드시\s*오/,
  /buy\b/i,
  /sell\b/i,
  /price target/i,
  /must rise/i,
  /moon\b/i,
];

const HIGH_RISK_LANGUAGE = [
  /인수|합병|merger|acquisition/i,
  /파산|bankrupt/i,
  /회계\s*부정|fraud/i,
  /fda|임상|clinical/i,
  /제재|sanction|수출\s*규제|export control/i,
  /실적|earnings|guidance/i,
];

export interface MarketIssueGeneratedBrief {
  marketRelevant: boolean;
  eventKey: string;
  titleKo: string;
  summaryKo: string;
  impactPath: string[];
  confirmedFacts: string[];
  unconfirmedFacts: string[];
  researchPaths: MarketIssueResearchPath[];
  statusLabels: MarketIssueStatusLabel[];
  entities: Omit<MarketIssueEntity, "id" | "followed">[];
  riskLevel: "low" | "medium" | "high";
}

export function normalizeMarketIssueText(value: unknown, maxLength = 500): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export function containsProhibitedInvestmentLanguage(value: unknown): boolean {
  const normalized = normalizeMarketIssueText(value, 2000);
  return PROHIBITED_INVESTMENT_LANGUAGE.some((pattern) => pattern.test(normalized));
}

export function classifyMarketIssueRisk(value: unknown): "low" | "medium" | "high" {
  const normalized = normalizeMarketIssueText(value, 4000);
  if (HIGH_RISK_LANGUAGE.some((pattern) => pattern.test(normalized))) {
    const preliminaryInquiry = /예비(?:적)?|비구속(?:적)?|preliminary|non-binding|inquiry/i.test(normalized);
    const noDetermination = /(?:위법행위|벌금|제재|구제조치|finding|fine|penalty|remedy).{0,100}(?:없(?:다|으며|고)?|없음|확정되지|확정된\s*바가\s*없|미확정|not\s+(?:been\s+)?(?:made|determined))|no\s+(?:finding|fine|penalty|remedy)/i.test(normalized);
    if (preliminaryInquiry && noDetermination) return "medium";
    return "high";
  }
  return normalized ? "medium" : "low";
}

export function parseMarketIssueGeneratedBrief(value: unknown): MarketIssueGeneratedBrief | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.market_relevant !== true) return null;

  const eventKey = normalizeEventKey(record.event_key);
  const titleKo = normalizeMarketIssueText(record.title_ko, 160);
  const summaryKo = normalizeMarketIssueText(record.summary_ko, 700);
  if (!eventKey || !titleKo || !summaryKo) return null;
  if (
    containsProhibitedInvestmentLanguage(titleKo) ||
    containsProhibitedInvestmentLanguage(summaryKo)
  ) {
    return null;
  }

  const impactPath = stringArray(record.impact_path, 5, 180);
  const confirmedFacts = stringArray(record.confirmed_facts, 5, 260);
  const unconfirmedFacts = stringArray(record.unconfirmed_facts, 5, 260);
  const researchPaths = parseMarketIssueResearchPaths(record.research_paths ?? record.researchPaths);
  const statusLabels = stringArray(record.status_labels, 3, 30)
    .filter(isMarketIssueStatusLabel);
  const entities = parseEntities(record.entities);
  const declaredRisk = record.risk_level === "low" || record.risk_level === "high"
    ? record.risk_level
    : "medium";
  const riskLevel = classifyMarketIssueRisk(
    [titleKo, summaryKo, ...confirmedFacts, ...unconfirmedFacts].join(" "),
  ) === "high" ? "high" : declaredRisk;

  return {
    marketRelevant: true,
    eventKey,
    titleKo,
    summaryKo,
    impactPath,
    confirmedFacts,
    unconfirmedFacts,
    researchPaths,
    statusLabels: statusLabels.length > 0 ? statusLabels : ["추가 확인 필요"],
    entities,
    riskLevel,
  };
}

export function buildReviewOnlyDraft(input: {
  eventKey: string;
  displayName: string;
  originalText: string;
  sourceTags: string[];
}): MarketIssueGeneratedBrief {
  const firstLine = normalizeMarketIssueText(input.originalText, 120);
  const fallbackTitle = input.sourceTags[0]
    ? input.sourceTags[0] + " 관련 원문 검토 대기"
    : input.displayName + " 원문 검토 대기";

  return {
    marketRelevant: true,
    eventKey: normalizeEventKey(input.eventKey) || "review-pending",
    titleKo: fallbackTitle,
    summaryKo: firstLine
      ? "자동 요약이 준비되지 않아 원문과 함께 운영자 검토가 필요합니다."
      : "자동 요약이 준비되지 않아 운영자 검토가 필요합니다.",
    impactPath: [],
    confirmedFacts: [],
    unconfirmedFacts: ["한국어 요약과 사건 분류를 검토해야 합니다."],
    researchPaths: [],
    statusLabels: ["추가 확인 필요"],
    entities: input.sourceTags.slice(0, 3).map((ticker) => ({
      type: "company",
      ticker,
      name: ticker,
      relationship: "direct",
      relationshipReason: "선별 출처의 기업 태그",
      confidence: 0.5,
    })),
    riskLevel: classifyMarketIssueRisk(input.originalText),
  };
}

function normalizeEventKey(value: unknown): string | null {
  const normalized = normalizeMarketIssueText(value, 140)
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length >= 3 ? normalized : null;
}

function stringArray(value: unknown, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizeMarketIssueText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function parseEntities(value: unknown): Omit<MarketIssueEntity, "id" | "followed">[] {
  if (!Array.isArray(value)) return [];
  const entities: Omit<MarketIssueEntity, "id" | "followed">[] = [];
  for (const item of value.slice(0, 8)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const type = record.type === "industry" || record.type === "theme"
      ? record.type
      : "company";
    const ticker = typeof record.ticker === "string"
      ? record.ticker.trim().toUpperCase().slice(0, 16) || null
      : null;
    const name = normalizeMarketIssueText(record.name || ticker, 100);
    const relationship = record.relationship === "supply_chain"
      || record.relationship === "customer"
      || record.relationship === "competitor"
      || record.relationship === "industry"
      || record.relationship === "theme"
      ? record.relationship
      : "direct";
    const reason = normalizeMarketIssueText(record.relationship_reason, 180);
    if (!name || containsProhibitedInvestmentLanguage(reason)) continue;
    entities.push({
      type,
      ticker,
      name,
      relationship,
      relationshipReason: reason,
      confidence: typeof record.confidence === "number"
        ? Math.max(0, Math.min(1, record.confidence))
        : 0.5,
    });
  }
  return entities;
}
