import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { marketIssueEnvironment } from "@/lib/market-issues/config";
import { makePulseItemKey, type PulseCandidate } from "@/lib/pulse/contract";
import type { Database } from "@/types/database";

type Db = SupabaseClient;
type Row = Record<string, unknown>;

const DAY_MS = 24 * 60 * 60 * 1_000;
const NEWS_RETENTION_MS = 5 * DAY_MS;
const MAX_MARKET_ISSUES_READ = 100;
export const MAX_PULSE_NEWS_CANDIDATES = 18;
const MAX_PERSONAL_NEWS_CANDIDATES = 8;

export interface MarketIssuePulseInput {
  issues: Row[];
  entities: Row[];
  userStates: Row[];
  preferredTickers: readonly string[];
  followedTickers: readonly string[];
  now: Date;
}

/**
 * Pulls the reviewed market-issue projection used by the News tab. Raw social
 * posts are deliberately not a Pulse source: the same published/merged/hidden
 * guardrails remain in force here.
 */
export async function getNewsCandidates(
  supabase: SupabaseClient<Database>,
  userId: string,
  now: Date,
  preferredTickers: readonly string[] = [],
): Promise<PulseCandidate[]> {
  const db = supabase as unknown as Db;
  const env = marketIssueEnvironment();
  const { data: settingsData, error: settingsError } = await db
    .from("market_issue_settings")
    .select("feed_enabled")
    .eq("env", env)
    .maybeSingle();
  if (settingsError) throw settingsError;
  if (asRow(settingsData)?.feed_enabled !== true) return [];

  const [{ data: issuesData, error: issuesError }, { data: followsData, error: followsError }] = await Promise.all([
    db
      .from("market_issues")
      .select("id,event_key,title_ko,summary_ko,status_labels,source_summary,source_count,market_score,risk_level,update_count,published_at,last_published_at,updated_at")
      .eq("env", env)
      .eq("state", "published")
      .is("merged_into_issue_id", null)
      .order("last_published_at", { ascending: false, nullsFirst: false })
      .order("market_score", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(MAX_MARKET_ISSUES_READ),
    db
      .from("market_issue_user_company_follows")
      .select("ticker")
      .eq("user_id", userId),
  ]);
  if (issuesError) throw issuesError;
  if (followsError) throw followsError;

  const issues = asRows(issuesData);
  const issueIds = issues.map((issue) => text(issue.id)).filter(Boolean);
  if (issueIds.length === 0) return [];
  const [{ data: entitiesData, error: entitiesError }, { data: statesData, error: statesError }] = await Promise.all([
    db.from("market_issue_entities").select("issue_id,ticker,entity_name,relationship,confidence").in("issue_id", issueIds),
    db.from("market_issue_user_states").select("issue_id,opened_at,is_saved,is_hidden,updated_at").eq("user_id", userId).in("issue_id", issueIds),
  ]);
  if (entitiesError) throw entitiesError;
  if (statesError) throw statesError;

  return buildMarketIssuePulseCandidates({
    issues,
    entities: asRows(entitiesData),
    userStates: asRows(statesData),
    preferredTickers,
    followedTickers: asRows(followsData).map((row) => text(row.ticker)),
    now,
  });
}

/**
 * Pure conversion kept separate from the database read so the freshness,
 * hidden-state, and personal-priority rules stay directly unit-testable.
 */
export function buildMarketIssuePulseCandidates(input: MarketIssuePulseInput): PulseCandidate[] {
  const preferredTickers = toTickerSet(input.preferredTickers);
  const followedTickers = toTickerSet(input.followedTickers);
  const personalTickers = new Set([...preferredTickers, ...followedTickers]);
  const entitiesByIssue = groupRows(input.entities, "issue_id");
  const statesByIssue = new Map(input.userStates.map((state) => [text(state.issue_id), state]));
  const nowMs = input.now.getTime();

  const candidates = input.issues.flatMap((issue) => {
    const id = text(issue.id);
    const state = statesByIssue.get(id);
    if (!id || state?.is_hidden === true) return [];
    const occurredAt = issueOccurredAt(issue);
    const occurredMs = Date.parse(occurredAt);
    if (!Number.isFinite(occurredMs) || occurredMs > nowMs || occurredMs <= nowMs - NEWS_RETENTION_MS) {
      return [];
    }

    const entities = entitiesByIssue.get(id) || [];
    const coveredTickers = unique(entities
      .map((entity) => normalizeTicker(text(entity.ticker)))
      .filter((ticker): ticker is string => Boolean(ticker)));
    const personalMatches = coveredTickers.filter((ticker) => personalTickers.has(ticker));
    const followsMatches = coveredTickers.filter((ticker) => followedTickers.has(ticker));
    const ticker = selectTicker(entities, personalMatches, coveredTickers);
    const sourceCount = nonNegativeNumber(issue.source_count);
    const marketScore = nonNegativeNumber(issue.market_score);
    const riskLevel = riskLevelOf(issue.risk_level);
    const sourceSummary = asRow(issue.source_summary) || {};
    const officialSourceCount = nonNegativeNumber(sourceSummary.official);
    const labels = stringArray(issue.status_labels, 3);
    const personal = personalMatches.length > 0;
    const title = text(issue.title_ko, "시장 이슈를 정리하고 있습니다.");
    const summary = compactText(text(issue.summary_ko, "공개된 출처와 관련 기업을 확인해보세요."), 440);

    const candidate: PulseCandidate = {
      item_key: makePulseItemKey("news", id),
      kind: "news",
      trigger: "event",
      source_type: "news",
      source_id: id,
      ticker,
      coverage_level: null,
      judgment: null,
      linked_thesis: null,
      eyebrow: riskLevel === "high"
        ? "시장 이슈 · 확인 우선"
        : officialSourceCount > 0 ? "시장 이슈 · 공식 출처 포함" : "시장 이슈",
      title,
      body: summary,
      reason_code: personal ? "news_personal_match" : "news_market_update",
      reason_label: personal && ticker
        ? `${ticker}와 연결된 시장 이슈`
        : "검토된 시장 이슈를 확인하세요.",
      priority: newsPriority({ riskLevel, marketScore, sourceCount, personal }),
      occurred_at: occurredAt,
      available_at: occurredAt,
      expires_at: new Date(occurredMs + NEWS_RETENTION_MS).toISOString(),
      saved_at: null,
      snoozed_until: null,
      group_key: `market-issue:${text(issue.event_key, id)}`,
      primary_action: {
        type: "link",
        label: "뉴스 보기",
        href: `/news/${encodeURIComponent(id)}?source=pulse`,
        analytics_name: "pulse_news_open",
      },
      secondary_actions: [
        { type: "mutation", label: "저장", action: "save", analytics_name: "pulse_news_save" },
        { type: "mutation", label: "숨기기", action: "dismiss", analytics_name: "pulse_news_dismiss" },
      ],
      metadata: {
        market_issue_event_key: text(issue.event_key) || null,
        market_issue_source_count: sourceCount,
        market_issue_official_source_count: officialSourceCount,
        market_issue_market_score: marketScore,
        market_issue_risk_level: riskLevel,
        market_issue_status_label: labels[0] ?? null,
        market_issue_update_count: nonNegativeNumber(issue.update_count),
        covered_tickers_csv: coveredTickers.join(","),
        market_issue_personal_match: personal,
        market_issue_followed_match: followsMatches.length > 0,
        market_issue_followed_tickers_csv: followsMatches.join(","),
        news_candidate_role: personal ? "personal" : "market",
      },
      is_pinned: state?.is_saved === true,
      state: state?.opened_at ? "seen" : "new",
    };

    return [candidate];
  });

  const sorted = [...candidates].sort(compareNewsCandidates);
  const personal = sorted.filter((candidate) => candidate.metadata.market_issue_personal_match === true);
  const market = sorted.filter((candidate) => candidate.metadata.market_issue_personal_match !== true);
  return [...personal.slice(0, MAX_PERSONAL_NEWS_CANDIDATES), ...market]
    .slice(0, MAX_PULSE_NEWS_CANDIDATES);
}

function compareNewsCandidates(left: PulseCandidate, right: PulseCandidate): number {
  const personal = Number(right.metadata.market_issue_personal_match === true)
    - Number(left.metadata.market_issue_personal_match === true);
  if (personal !== 0) return personal;
  const followed = Number(right.metadata.market_issue_followed_match === true)
    - Number(left.metadata.market_issue_followed_match === true);
  if (followed !== 0) return followed;
  // Time-first: recency dominates within the same personal/followed tier so
  // yesterday's high-score story does not bury today's fresh news.
  const occurred = Date.parse(right.occurred_at) - Date.parse(left.occurred_at);
  if (occurred !== 0) return occurred;
  const priority = priorityWeight(right.priority) - priorityWeight(left.priority);
  if (priority !== 0) return priority;
  const score = numberMetadata(right, "market_issue_market_score") - numberMetadata(left, "market_issue_market_score");
  if (score !== 0) return score;
  return left.item_key.localeCompare(right.item_key);
}

function selectTicker(entities: Row[], personalMatches: string[], coveredTickers: string[]): string | null {
  if (personalMatches[0]) return personalMatches[0];
  const direct = entities
    .filter((entity) => text(entity.relationship) === "direct")
    .sort((left, right) => nonNegativeNumber(right.confidence) - nonNegativeNumber(left.confidence));
  const directTicker = normalizeTicker(text(direct[0]?.ticker));
  return directTicker ?? coveredTickers[0] ?? null;
}

function newsPriority(input: {
  riskLevel: "low" | "medium" | "high";
  marketScore: number;
  sourceCount: number;
  personal: boolean;
}): PulseCandidate["priority"] {
  if (input.riskLevel === "high" && (input.sourceCount >= 2 || input.marketScore >= 70)) return "high";
  if (input.personal || input.marketScore >= 45 || input.sourceCount >= 3) return "normal";
  return "low";
}

function issueOccurredAt(issue: Row): string {
  return iso(issue.last_published_at)
    ?? iso(issue.published_at)
    ?? iso(issue.updated_at)
    ?? "";
}

function riskLevelOf(value: unknown): "low" | "medium" | "high" {
  return value === "low" || value === "high" ? value : "medium";
}

function priorityWeight(value: PulseCandidate["priority"]): number {
  return value === "urgent" ? 4 : value === "high" ? 3 : value === "normal" ? 2 : 1;
}

function groupRows(rows: Row[], field: string): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const key = text(row[field]);
    if (!key) continue;
    const values = grouped.get(key) || [];
    values.push(row);
    grouped.set(key, values);
  }
  return grouped;
}

function asRows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter((row): row is Row => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    : [];
}

function asRow(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function iso(value: unknown): string | null {
  const normalized = text(value);
  return normalized && Number.isFinite(Date.parse(normalized)) ? normalized : null;
}

function normalizeTicker(value: string): string | null {
  const ticker = value.trim().toUpperCase();
  return ticker || null;
}

function toTickerSet(values: readonly string[]): Set<string> {
  return new Set(values.map(normalizeTicker).filter((value): value is string => Boolean(value)));
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function stringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, max);
}

function nonNegativeNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function numberMetadata(candidate: PulseCandidate, key: string): number {
  const value = candidate.metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function compactText(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}
