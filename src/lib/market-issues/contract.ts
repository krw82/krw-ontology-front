export const MARKET_ISSUE_SCOPES = ["mine", "market"] as const;
export type MarketIssueScope = (typeof MARKET_ISSUE_SCOPES)[number];

export const MARKET_ISSUE_STATUS_LABELS = [
  "새 이슈",
  "회사 발표",
  "복수 보도",
  "단독 보도",
  "업데이트됨",
  "추가 확인 필요",
] as const;

export type MarketIssueStatusLabel = (typeof MARKET_ISSUE_STATUS_LABELS)[number];

export type MarketIssueSourceClass =
  | "government"
  | "regulator"
  | "company_official"
  | "exchange"
  | "registered_media"
  | "journalist"
  | "expert";

export interface MarketIssueEntity {
  id: string;
  type: "company" | "industry" | "theme";
  ticker: string | null;
  name: string;
  relationship:
    | "direct"
    | "supply_chain"
    | "customer"
    | "competitor"
    | "industry"
    | "theme";
  relationshipReason: string;
  confidence: number;
  followed?: boolean;
}

export interface MarketIssueSourceSummary {
  total: number;
  official: number;
  independent: number;
  sourceClasses: MarketIssueSourceClass[];
}

export interface MarketIssueUserState {
  openedAt: string | null;
  isSaved: boolean;
  isHidden: boolean;
}

/**
 * A source-grounded next research step. It is deliberately distinct from
 * `unconfirmedFacts`: the latter captures uncertainty in the source summary,
 * while a research path tells a reader what evidence to inspect next.
 */
export interface MarketIssueResearchPath {
  id: string;
  question: string;
  evidenceTargets: string[];
  relatedTickers: string[];
  priority: number;
  chatQuery: string;
}

export interface MarketIssueCard {
  id: string;
  eventKey: string;
  title: string;
  summary: string;
  impactPath: string[];
  confirmedFacts: string[];
  unconfirmedFacts: string[];
  researchPaths: MarketIssueResearchPath[];
  statusLabels: MarketIssueStatusLabel[];
  sourceSummary: MarketIssueSourceSummary;
  sourceCount: number;
  updateCount: number;
  marketScore: number;
  publishedAt: string | null;
  updatedAt: string;
  entities: MarketIssueEntity[];
  userState: MarketIssueUserState;
  isPersonalized: boolean;
  personalizationReason: string | null;
}

export interface MarketIssueSource {
  id: string;
  sourceType: "x";
  sourceClass: MarketIssueSourceClass;
  accountHandle: string;
  displayName: string;
  originalText: string;
  canonicalUrl: string;
  publishedAt: string;
}

export interface MarketIssueDetail extends MarketIssueCard {
  firstObservedAt: string;
  riskLevel: "low" | "medium" | "high";
  sources: MarketIssueSource[];
}

export interface MarketIssueFeedSummary {
  focusTickerCount: number;
  matchedTickers: string[];
  unreadCount: number;
  sinceLastVisitCount: number;
}

export interface MarketIssueFeedResponse {
  scope: MarketIssueScope;
  revision: string;
  generatedAt: string;
  featureEnabled: boolean;
  manualReviewRequired: boolean;
  sourceStatus: "healthy" | "degraded" | "disabled";
  issues: MarketIssueCard[];
  summary: MarketIssueFeedSummary;
}

export interface MarketIssueStatusResponse {
  featureEnabled: boolean;
  ingestionEnabled: boolean;
  manualReviewRequired: boolean;
  sourceStatus: "healthy" | "degraded" | "disabled";
  lastSuccessfulIngestionAt: string | null;
  updatedAt: string | null;
  maxPublishedPerDay: number;
}

export function isMarketIssueScope(value: unknown): value is MarketIssueScope {
  return typeof value === "string" && (MARKET_ISSUE_SCOPES as readonly string[]).includes(value);
}

export function isMarketIssueStatusLabel(value: unknown): value is MarketIssueStatusLabel {
  return typeof value === "string" && (MARKET_ISSUE_STATUS_LABELS as readonly string[]).includes(value);
}

export function toTextArray(value: unknown, max = 12): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, max);
}

export function toJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

/**
 * Normalizes both the LLM's snake_case JSON and the camelCase shape used by
 * application clients. Invalid or generic-looking paths are discarded rather
 * than rendered as a misleading call to action.
 */
export function parseMarketIssueResearchPaths(value: unknown): MarketIssueResearchPath[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const seenIds = new Set<string>();
  const result: MarketIssueResearchPath[] = [];

  for (const [index, entry] of value.slice(0, 2).entries()) {
    const record = toJsonRecord(entry);
    const question = normalizeResearchPathText(record.question, 180);
    const chatQuery = normalizeResearchPathText(record.chat_query ?? record.chatQuery, 480);
    const evidenceTargets = toTextArray(record.evidence_targets ?? record.evidenceTargets, 3)
      .map((target) => normalizeResearchPathText(target, 60, 2))
      .filter(Boolean);
    const relatedTickers = toTextArray(record.related_tickers ?? record.relatedTickers, 4)
      .map((ticker) => ticker.toUpperCase().replace(/[^A-Z0-9.\-]/g, ""))
      .filter((ticker) => /^[A-Z0-9][A-Z0-9.\-]{0,15}$/.test(ticker));
    const id = normalizeResearchPathId(record.id, index + 1);
    const priority = Math.max(1, Math.min(9, Math.trunc(Number(record.priority) || index + 1)));
    const key = question.toLocaleLowerCase("ko-KR");

    if (!question || !chatQuery || evidenceTargets.length === 0 || seen.has(key) || seenIds.has(id)) continue;
    seen.add(key);
    seenIds.add(id);
    result.push({ id, question, evidenceTargets, relatedTickers, priority, chatQuery });
  }

  return result.sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id));
}

function normalizeResearchPathText(value: unknown, max: number, min = 12): string {
  if (typeof value !== "string") return "";
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, max);
  if (normalized.length < min || containsInvestmentRecommendation(normalized)) return "";
  return normalized;
}

function normalizeResearchPathId(value: unknown, fallbackIndex: number): string {
  const normalized = typeof value === "string"
    ? value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48)
    : "";
  return normalized || `path-${fallbackIndex}`;
}

function containsInvestmentRecommendation(value: string): boolean {
  return /매수|매도|손절|목표가|수혜주|주가\s*(상승|하락)|buy\b|sell\b|price target/i.test(value);
}
