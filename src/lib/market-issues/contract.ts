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

export interface MarketIssueCard {
  id: string;
  eventKey: string;
  title: string;
  summary: string;
  impactPath: string[];
  confirmedFacts: string[];
  unconfirmedFacts: string[];
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
