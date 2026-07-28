import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  isMarketIssueStatusLabel,
  toJsonRecord,
  toTextArray,
  type MarketIssueScope,
  type MarketIssueStatusLabel,
} from "@/lib/market-issues/contract";
import { marketIssueEnvironment } from "@/lib/market-issues/config";
import {
  getOrLoadMarketIssueGlobalCache,
  marketIssueGlobalCacheKey,
} from "@/lib/market-issues/cache";
import { getMarketIssueRevision } from "@/lib/market-issues/revision";

type Db = SupabaseClient<any>;
type Row = Record<string, any>;

export type MarketIssueEventName =
  | "news_tab_viewed"
  | "market_issue_opened"
  | "market_issue_source_opened"
  | "market_issue_research_draft_opened"
  | "market_issue_research_submitted"
  | "market_issue_saved"
  | "market_issue_hidden"
  | "market_issue_company_followed";

type CachedPublishedIssue = {
  issue: Row;
  entities: Row[];
};

export type MarketIssueSettings = {
  env: string;
  feedEnabled: boolean;
  ingestionEnabled: boolean;
  manualReviewRequired: boolean;
  maxPublishedPerDay: number;
  lastIngestionAt: string | null;
  lastSuccessfulIngestionAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
};

export type MarketIssueAdminUpdate = {
  state?: "draft" | "review" | "published" | "hidden" | "archived";
  title?: string;
  summary?: string;
  impactPath?: string[];
  confirmedFacts?: string[];
  unconfirmedFacts?: string[];
  statusLabels?: MarketIssueStatusLabel[];
  riskLevel?: "low" | "medium" | "high";
  reason?: string;
};

function asRows(value: unknown): Row[] {
  return Array.isArray(value)
    ? value.filter((item): item is Row => Boolean(item) && typeof item === "object")
    : [];
}

function asRow(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Row
    : null;
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function nullableText(value: unknown): string | null {
  const result = text(value);
  return result || null;
}

function number(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function iso(value: unknown): string | null {
  return nullableText(value);
}

function unique(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function relationshipLabel(value: unknown): string {
  switch (text(value)) {
    case "direct":
      return "직접 관련";
    case "supply_chain":
      return "공급망";
    case "customer":
      return "고객";
    case "competitor":
      return "경쟁사";
    case "industry":
      return "산업";
    case "theme":
      return "테마";
    default:
      return "관련";
  }
}

function statusTone(labels: readonly string[]): string {
  if (labels.includes("회사 발표") || labels.includes("복수 보도")) return "confirmed";
  if (labels.includes("새 이슈")) return "new";
  if (labels.includes("업데이트됨")) return "updated";
  if (labels.includes("추가 확인 필요")) return "caution";
  return "neutral";
}

function statusLabels(row: Row): MarketIssueStatusLabel[] {
  const labels = toTextArray(row.status_labels, 3)
    .filter(isMarketIssueStatusLabel);
  return labels.length > 0 ? labels : ["추가 확인 필요"];
}

function serializeEntity(row: Row, focusTickers: ReadonlySet<string>): Row {
  const ticker = nullableText(row.ticker)?.toUpperCase() || null;
  return {
    id: text(row.id),
    name: text(row.entity_name, ticker || "관련 기업"),
    ticker,
    relationship: relationshipLabel(row.relationship),
    relationship_type: text(row.relationship),
    relationship_reason: text(row.relationship_reason),
    confidence: number(row.confidence, 0.5),
    followed: ticker ? focusTickers.has(ticker) : false,
    href: ticker ? "/chat/new?ticker=" + encodeURIComponent(ticker) : null,
  };
}

function serializeIssue(
  issue: Row,
  entities: Row[],
  userState: Row | null,
  focusTickers: ReadonlySet<string>,
  scope: MarketIssueScope,
): Row {
  const issueEntities = entities.map((entity) => serializeEntity(entity, focusTickers));
  const matchingTickers = issueEntities
    .map((entity) => entity.ticker)
    .filter((ticker): ticker is string => Boolean(ticker) && focusTickers.has(ticker));
  const labels = statusLabels(issue);
  const reasons = matchingTickers.map((ticker) => ticker + "과 연결된 이슈");

  return {
    id: text(issue.id),
    event_key: text(issue.event_key),
    title: text(issue.title_ko, "시장 이슈 정리 중"),
    summary: text(issue.summary_ko, "한국어 맥락을 정리 중입니다."),
    impact_path: toTextArray(issue.impact_path, 5),
    confirmed: toTextArray(issue.confirmed_facts, 5),
    unconfirmed: toTextArray(issue.unconfirmed_facts, 5),
    status_label: labels[0],
    status_labels: labels,
    status_tone: statusTone(labels),
    source_count: Math.max(0, number(issue.source_count)),
    source_summary: toJsonRecord(issue.source_summary),
    update_count: Math.max(0, number(issue.update_count)),
    published_at: iso(issue.last_published_at) || iso(issue.published_at),
    updated_at: iso(issue.updated_at),
    companies: issueEntities,
    entities: issueEntities,
    user_state: {
      opened_at: iso(userState?.opened_at),
      saved: userState?.is_saved === true,
      hidden: userState?.is_hidden === true,
    },
    why_shown: scope === "mine" ? reasons : [],
    is_personalized: matchingTickers.length > 0,
    personalization_reason: reasons[0] || null,
  };
}

export async function getMarketIssueSettings(db: Db): Promise<MarketIssueSettings> {
  const env = marketIssueEnvironment();
  const { data, error } = await db
    .from("market_issue_settings")
    .select("*")
    .eq("env", env)
    .maybeSingle();
  if (error) throw error;

  const row = asRow(data) || {};
  return {
    env,
    feedEnabled: row.feed_enabled === true,
    ingestionEnabled: row.ingestion_enabled === true,
    manualReviewRequired: row.manual_review_required !== false,
    maxPublishedPerDay: Math.max(1, Math.min(100, number(row.max_published_per_day, 20))),
    lastIngestionAt: iso(row.last_ingestion_at),
    lastSuccessfulIngestionAt: iso(row.last_successful_ingestion_at),
    lastError: nullableText(row.last_error),
    updatedAt: iso(row.updated_at),
  };
}

export async function updateMarketIssueSettings(
  db: Db,
  actorUserId: string,
  input: Partial<Pick<MarketIssueSettings,
    "feedEnabled" | "ingestionEnabled" | "manualReviewRequired" | "maxPublishedPerDay"
  >>,
): Promise<MarketIssueSettings> {
  const env = marketIssueEnvironment();
  const update: Row = { updated_at: new Date().toISOString() };
  if (typeof input.feedEnabled === "boolean") update.feed_enabled = input.feedEnabled;
  if (typeof input.ingestionEnabled === "boolean") update.ingestion_enabled = input.ingestionEnabled;
  if (typeof input.manualReviewRequired === "boolean") {
    update.manual_review_required = input.manualReviewRequired;
  }
  if (typeof input.maxPublishedPerDay === "number" && Number.isFinite(input.maxPublishedPerDay)) {
    update.max_published_per_day = Math.max(1, Math.min(100, Math.trunc(input.maxPublishedPerDay)));
  }
  const { error } = await db
    .from("market_issue_settings")
    .update(update)
    .eq("env", env);
  if (error) throw error;
  await recordMarketIssueAdminAction(db, {
    actorUserId,
    action: "settings_update",
    metadata: Object.keys(update).filter((key) => key !== "updated_at"),
  });
  return getMarketIssueSettings(db);
}

async function loadFocusTickers(db: Db, userId: string): Promise<Set<string>> {
  const [{ data: follows, error: followsError }, { data: marks, error: marksError }] =
    await Promise.all([
      db
        .from("market_issue_user_company_follows")
        .select("ticker")
        .eq("user_id", userId),
      db
        .from("user_company_marks")
        .select("ticker, is_watchlisted, is_holding")
        .eq("user_id", userId)
        .or("is_watchlisted.eq.true,is_holding.eq.true"),
    ]);
  if (followsError) throw followsError;
  if (marksError) throw marksError;

  return new Set([
    ...asRows(follows).map((row) => text(row.ticker).toUpperCase()),
    ...asRows(marks).map((row) => text(row.ticker).toUpperCase()),
  ].filter(Boolean));
}

async function loadUserStates(
  db: Db,
  userId: string,
  issueIds: readonly string[],
): Promise<Map<string, Row>> {
  if (issueIds.length === 0) return new Map();
  const { data, error } = await db
    .from("market_issue_user_states")
    .select("*")
    .eq("user_id", userId)
    .in("issue_id", issueIds);
  if (error) throw error;
  return new Map(asRows(data).map((row) => [text(row.issue_id), row]));
}

async function loadPublishedIssues(db: Db): Promise<CachedPublishedIssue[]> {
  const env = marketIssueEnvironment();
  const { data: issues, error } = await db
    .from("market_issues")
    .select("*")
    .eq("env", env)
    .eq("state", "published")
    .is("merged_into_issue_id", null)
    .order("market_score", { ascending: false })
    .order("last_published_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(100);
  if (error) throw error;

  const issueRows = asRows(issues);
  const issueIds = issueRows.map((row) => text(row.id)).filter(Boolean);
  if (issueIds.length === 0) return [];

  const { data: entities, error: entitiesError } = await db
    .from("market_issue_entities")
    .select("*")
    .in("issue_id", issueIds);
  if (entitiesError) throw entitiesError;

  const entitiesByIssue = new Map<string, Row[]>();
  for (const entity of asRows(entities)) {
    const issueId = text(entity.issue_id);
    const group = entitiesByIssue.get(issueId) || [];
    group.push(entity);
    entitiesByIssue.set(issueId, group);
  }
  return issueRows.map((issue) => ({
    issue,
    entities: entitiesByIssue.get(text(issue.id)) || [],
  }));
}

export async function listMarketIssues(input: {
  db: Db;
  userId: string;
  scope: MarketIssueScope;
  cursor?: string | null;
}): Promise<Row> {
  const { db, userId, scope } = input;
  const [settings, revision, focusTickers] = await Promise.all([
    getMarketIssueSettings(db),
    getMarketIssueRevision(db),
    loadFocusTickers(db, userId),
  ]);

  await recordMarketIssueEvent(db, {
    userId,
    eventName: "news_tab_viewed",
    metadata: { scope },
  });

  if (!settings.feedEnabled) {
    return {
      scope,
      revision: revision.value,
      next_cursor: null,
      issues: [],
      summary: {
        focus_ticker_count: focusTickers.size,
        matched_tickers: [],
        unread_count: 0,
        since_last_visit_count: 0,
      },
    };
  }

  const cachedIssues = await getOrLoadMarketIssueGlobalCache(
    marketIssueGlobalCacheKey({
      env: settings.env,
      revision: revision.globalRevision,
    }),
    () => loadPublishedIssues(db),
  );
  const issueIds = cachedIssues.map(({ issue }) => text(issue.id)).filter(Boolean);
  const userStates = await loadUserStates(db, userId, issueIds);

  const visibleIssues = cachedIssues
    .filter(({ issue }) => userStates.get(text(issue.id))?.is_hidden !== true)
    .filter(({ entities }) => (
      scope === "market"
      || entities.some((entity) => focusTickers.has(text(entity.ticker).toUpperCase()))
    ));

  const offset = Math.max(0, Number.parseInt(input.cursor || "0", 10) || 0);
  const pageSize = 20;
  const page = visibleIssues.slice(offset, offset + pageSize);
  const cards = page.map(({ issue, entities }) => serializeIssue(
    issue,
    entities,
    userStates.get(text(issue.id)) || null,
    focusTickers,
    scope,
  ));
  const matchedTickers = unique(cards.flatMap((card) => card.companies
    .filter((company: Row) => company.followed)
    .map((company: Row) => text(company.ticker))));

  return {
    scope,
    revision: revision.value,
    next_cursor: offset + pageSize < visibleIssues.length ? String(offset + pageSize) : null,
    issues: cards,
    summary: {
      focus_ticker_count: focusTickers.size,
      matched_tickers: matchedTickers.slice(0, 20),
      unread_count: cards.filter((card) => !card.user_state.opened_at).length,
      since_last_visit_count: cards.length,
    },
  };
}

export async function getMarketIssueDetail(input: {
  db: Db;
  userId: string;
  issueId: string;
  includeUnpublished?: boolean;
}): Promise<Row | null> {
  const { db, userId, issueId, includeUnpublished = false } = input;
  const settings = await getMarketIssueSettings(db);
  if (!includeUnpublished && !settings.feedEnabled) return null;

  let query = db
    .from("market_issues")
    .select("*")
    .eq("id", issueId)
    .eq("env", settings.env);
  if (!includeUnpublished) query = query.eq("state", "published");
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  const issue = asRow(data);
  if (!issue) return null;

  const [{ data: entities, error: entitiesError }, { data: state, error: stateError }] =
    await Promise.all([
      db.from("market_issue_entities").select("*").eq("issue_id", issueId),
      db.from("market_issue_user_states").select("*").eq("user_id", userId).eq("issue_id", issueId).maybeSingle(),
    ]);
  if (entitiesError) throw entitiesError;
  if (stateError) throw stateError;

  const focusTickers = await loadFocusTickers(db, userId);
  const now = new Date().toISOString();
  await db
    .from("market_issue_user_states")
    .upsert({
      user_id: userId,
      issue_id: issueId,
      opened_at: asRow(state)?.opened_at || now,
      last_seen_at: now,
      is_saved: asRow(state)?.is_saved === true,
      is_hidden: asRow(state)?.is_hidden === true,
      updated_at: now,
    }, { onConflict: "user_id,issue_id" });
  await recordMarketIssueEvent(db, {
    userId,
    issueId,
    eventName: "market_issue_opened",
  });

  const { data: links, error: linksError } = await db
    .from("market_issue_items")
    .select("source_item_id")
    .eq("issue_id", issueId);
  if (linksError) throw linksError;
  const sourceItemIds = asRows(links).map((row) => text(row.source_item_id)).filter(Boolean);
  let sources: Row[] = [];
  if (sourceItemIds.length > 0) {
    const { data: items, error: itemsError } = await db
      .from("market_source_items")
      .select("*")
      .in("id", sourceItemIds)
      .eq("status", "active")
      .is("deleted_at", null);
    if (itemsError) throw itemsError;
    const itemRows = asRows(items);
    const sourceIds = unique(itemRows.map((row) => text(row.source_id)).filter(Boolean));
    const { data: sourceRows, error: sourcesError } = sourceIds.length > 0
      ? await db.from("market_issue_sources").select("*").in("id", sourceIds)
      : { data: [], error: null };
    if (sourcesError) throw sourcesError;
    const sourceById = new Map(asRows(sourceRows).map((row) => [text(row.id), row]));
    sources = itemRows
      .sort((a, b) => Date.parse(text(b.published_at)) - Date.parse(text(a.published_at)))
      .map((item) => {
        const source = sourceById.get(text(item.source_id)) || {};
        return {
          id: text(item.id),
          source_type: text(source.source_type, "x"),
          source_class: text(source.source_class),
          publisher: text(source.display_name, text(source.account_handle)),
          author: source.account_handle ? "@" + text(source.account_handle) : null,
          original_text: text(item.original_text).slice(0, 700),
          href: "/api/news/sources/" + encodeURIComponent(text(item.id)) + "/open",
          published_at: iso(item.published_at),
        };
      });
  }

  const card = serializeIssue(
    issue,
    asRows(entities),
    asRow(state),
    focusTickers,
    "market",
  );
  return {
    issue: {
      ...card,
      first_observed_at: iso(issue.first_observed_at),
      risk_level: text(issue.risk_level, "medium"),
      sources,
    },
  };
}

export async function updateMarketIssueUserState(input: {
  db: Db;
  userId: string;
  issueId: string;
  isSaved?: boolean;
  isHidden?: boolean;
}): Promise<Row> {
  const { db, userId, issueId } = input;
  const { data: current, error: currentError } = await db
    .from("market_issue_user_states")
    .select("*")
    .eq("user_id", userId)
    .eq("issue_id", issueId)
    .maybeSingle();
  if (currentError) throw currentError;

  const now = new Date().toISOString();
  const row = asRow(current) || {};
  const next = {
    user_id: userId,
    issue_id: issueId,
    opened_at: row.opened_at || null,
    last_seen_at: row.last_seen_at || null,
    is_saved: typeof input.isSaved === "boolean" ? input.isSaved : row.is_saved === true,
    is_hidden: typeof input.isHidden === "boolean" ? input.isHidden : row.is_hidden === true,
    updated_at: now,
  };
  const { error } = await db
    .from("market_issue_user_states")
    .upsert(next, { onConflict: "user_id,issue_id" });
  if (error) throw error;

  if (typeof input.isSaved === "boolean") {
    await recordMarketIssueEvent(db, {
      userId,
      issueId,
      eventName: "market_issue_saved",
      metadata: { saved: input.isSaved },
    });
  }
  if (typeof input.isHidden === "boolean") {
    await recordMarketIssueEvent(db, {
      userId,
      issueId,
      eventName: "market_issue_hidden",
      metadata: { hidden: input.isHidden },
    });
  }
  return { saved: next.is_saved, hidden: next.is_hidden };
}

export async function setMarketIssueCompanyFollow(input: {
  db: Db;
  userId: string;
  ticker: string;
  following: boolean;
}): Promise<void> {
  const ticker = input.ticker.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,15}$/.test(ticker)) {
    throw new Error("invalid_market_issue_ticker");
  }
  if (input.following) {
    const { error } = await input.db
      .from("market_issue_user_company_follows")
      .upsert({ user_id: input.userId, ticker, updated_at: new Date().toISOString() });
    if (error) throw error;
  } else {
    const { error } = await input.db
      .from("market_issue_user_company_follows")
      .delete()
      .eq("user_id", input.userId)
      .eq("ticker", ticker);
    if (error) throw error;
  }
  await recordMarketIssueEvent(input.db, {
    userId: input.userId,
    eventName: "market_issue_company_followed",
    metadata: { ticker, following: input.following },
  });
}

export async function createMarketIssueResearchDraft(input: {
  db: Db;
  userId: string;
  issueId: string;
}): Promise<{ href: string }> {
  const { data: issue, error: issueError } = await input.db
    .from("market_issues")
    .select("id, title_ko")
    .eq("id", input.issueId)
    .eq("env", marketIssueEnvironment())
    .eq("state", "published")
    .maybeSingle();
  if (issueError) throw issueError;
  const issueRow = asRow(issue);
  if (!issueRow) throw new Error("market_issue_not_found");

  const { data: entities, error: entitiesError } = await input.db
    .from("market_issue_entities")
    .select("ticker, entity_name, relationship")
    .eq("issue_id", input.issueId)
    .not("ticker", "is", null)
    .order("confidence", { ascending: false })
    .limit(1);
  if (entitiesError) throw entitiesError;
  const entity = asRows(entities)[0] || null;
  const ticker = nullableText(entity?.ticker)?.toUpperCase() || null;
  const company = ticker || text(entity?.entity_name, "관련 기업");
  const prompt = text(issueRow.title_ko) + " 이슈가 " + company
    + "의 기존 투자 논지에 미치는 영향을 분석해줘. "
    + "최근 공시와 경영진 코멘트를 기준으로 확인된 내용과 추가 검토할 내용을 나눠줘.";
  const params = new URLSearchParams({
    query: prompt,
    news_issue_id: input.issueId,
  });
  if (ticker) params.set("ticker", ticker);

  await recordMarketIssueEvent(input.db, {
    userId: input.userId,
    issueId: input.issueId,
    eventName: "market_issue_research_draft_opened",
    metadata: ticker ? { ticker } : {},
  });
  return { href: "/chat/new?" + params.toString() };
}

export async function getMarketIssueSourceRedirect(input: {
  db: Db;
  userId: string;
  sourceItemId: string;
}): Promise<string | null> {
  const { data, error } = await input.db
    .from("market_source_items")
    .select("canonical_url")
    .eq("id", input.sourceItemId)
    .eq("env", marketIssueEnvironment())
    .eq("status", "active")
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  const href = nullableText(asRow(data)?.canonical_url);
  if (!href || !/^https:\/\//i.test(href)) return null;

  const { data: relation, error: relationError } = await input.db
    .from("market_issue_items")
    .select("issue_id")
    .eq("source_item_id", input.sourceItemId)
    .limit(1)
    .maybeSingle();
  if (relationError) throw relationError;
  const issueId = nullableText(asRow(relation)?.issue_id);
  if (!issueId) return null;
  const { data: issue, error: issueError } = await input.db
    .from("market_issues")
    .select("id")
    .eq("id", issueId)
    .eq("env", marketIssueEnvironment())
    .eq("state", "published")
    .maybeSingle();
  if (issueError) throw issueError;
  if (!asRow(issue)) return null;
  await recordMarketIssueEvent(input.db, {
    userId: input.userId,
    issueId,
    eventName: "market_issue_source_opened",
  });
  return href;
}

export async function getMarketIssueStatus(db: Db): Promise<Row> {
  const settings = await getMarketIssueSettings(db);
  const sourceStatus = !settings.ingestionEnabled
    ? "disabled"
    : settings.lastError
      ? "degraded"
      : "healthy";
  return {
    label: !settings.feedEnabled
      ? "검수 기반 베타"
      : !settings.ingestionEnabled
        ? "검수된 이슈만 표시"
        : sourceStatus === "degraded"
          ? "수집 상태 점검 중"
          : "검수된 이슈",
    feature_enabled: settings.feedEnabled,
    ingestion_enabled: settings.ingestionEnabled,
    manual_review_required: settings.manualReviewRequired,
    source_status: sourceStatus,
    last_successful_ingestion_at: settings.lastSuccessfulIngestionAt,
    updated_at: settings.updatedAt || settings.lastSuccessfulIngestionAt,
    max_published_per_day: settings.maxPublishedPerDay,
  };
}

export async function listMarketIssueAdminIssues(
  db: Db,
  state?: string | null,
): Promise<Row[]> {
  const env = marketIssueEnvironment();
  let query = db
    .from("market_issues")
    .select("*")
    .eq("env", env)
    .order("updated_at", { ascending: false })
    .limit(100);
  if (state && ["draft", "review", "published", "hidden", "archived"].includes(state)) {
    query = query.eq("state", state);
  }
  const { data, error } = await query;
  if (error) throw error;
  const rows = asRows(data);
  const ids = rows.map((row) => text(row.id)).filter(Boolean);
  const { data: entities, error: entitiesError } = ids.length > 0
    ? await db.from("market_issue_entities").select("*").in("issue_id", ids)
    : { data: [], error: null };
  if (entitiesError) throw entitiesError;
  const entityByIssue = new Map<string, Row[]>();
  for (const entity of asRows(entities)) {
    const group = entityByIssue.get(text(entity.issue_id)) || [];
    group.push(entity);
    entityByIssue.set(text(entity.issue_id), group);
  }
  const { data: links, error: linksError } = ids.length > 0
    ? await db
      .from("market_issue_items")
      .select("issue_id, source_item_id")
      .in("issue_id", ids)
    : { data: [], error: null };
  if (linksError) throw linksError;
  const linkRows = asRows(links);
  const sourceItemIds = unique(linkRows.map((link) => text(link.source_item_id)).filter(Boolean));
  const { data: sourceItems, error: sourceItemsError } = sourceItemIds.length > 0
    ? await db
      .from("market_source_items")
      .select("id, source_id, original_text, canonical_url, published_at")
      .in("id", sourceItemIds)
    : { data: [], error: null };
  if (sourceItemsError) throw sourceItemsError;
  const sourceItemRows = asRows(sourceItems);
  const sourceIds = unique(sourceItemRows.map((item) => text(item.source_id)).filter(Boolean));
  const { data: sourceRows, error: sourceRowsError } = sourceIds.length > 0
    ? await db
      .from("market_issue_sources")
      .select("id, display_name, account_handle, source_class")
      .in("id", sourceIds)
    : { data: [], error: null };
  if (sourceRowsError) throw sourceRowsError;
  const sourceItemById = new Map(sourceItemRows.map((item) => [text(item.id), item]));
  const sourceById = new Map(asRows(sourceRows).map((source) => [text(source.id), source]));
  const sourcesByIssue = new Map<string, Row[]>();
  for (const link of linkRows) {
    const item = sourceItemById.get(text(link.source_item_id));
    if (!item) continue;
    const source = sourceById.get(text(item.source_id)) || {};
    const issueSources = sourcesByIssue.get(text(link.issue_id)) || [];
    issueSources.push({
      id: text(item.id),
      publisher: text(source.display_name, text(source.account_handle)),
      account_handle: text(source.account_handle),
      source_class: text(source.source_class),
      original_text: text(item.original_text).slice(0, 1200),
      canonical_url: text(item.canonical_url),
      published_at: iso(item.published_at),
    });
    sourcesByIssue.set(text(link.issue_id), issueSources);
  }
  return rows.map((issue) => ({
    ...issue,
    entities: entityByIssue.get(text(issue.id)) || [],
    sources: sourcesByIssue.get(text(issue.id)) || [],
  }));
}

export async function updateMarketIssueByAdmin(
  db: Db,
  actorUserId: string,
  issueId: string,
  input: MarketIssueAdminUpdate,
): Promise<Row> {
  const env = marketIssueEnvironment();
  const { data: existing, error: existingError } = await db
    .from("market_issues")
    .select("*")
    .eq("id", issueId)
    .eq("env", env)
    .maybeSingle();
  if (existingError) throw existingError;
  const current = asRow(existing);
  if (!current) throw new Error("market_issue_not_found");

  const now = new Date().toISOString();
  const update: Row = { updated_at: now };
  if (input.state) {
    update.state = input.state;
    if (input.state === "published") {
      if (current.state !== "published") {
        const settings = await getMarketIssueSettings(db);
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const { count, error: countError } = await db
          .from("market_issues")
          .select("*", { count: "exact", head: true })
          .eq("env", env)
          .eq("state", "published")
          .gte("published_at", todayStart.toISOString());
        if (countError) throw countError;
        if ((count || 0) >= settings.maxPublishedPerDay) {
          throw new Error("market_issue_daily_publish_limit_reached");
        }
      }
      update.published_at = current.published_at || now;
      update.last_published_at = now;
    }
  }
  if (input.title) update.title_ko = text(input.title).slice(0, 160);
  if (input.summary) update.summary_ko = text(input.summary).slice(0, 700);
  if (input.impactPath) update.impact_path = toTextArray(input.impactPath, 5);
  if (input.confirmedFacts) update.confirmed_facts = toTextArray(input.confirmedFacts, 5);
  if (input.unconfirmedFacts) update.unconfirmed_facts = toTextArray(input.unconfirmedFacts, 5);
  if (input.statusLabels) {
    update.status_labels = input.statusLabels.filter(isMarketIssueStatusLabel).slice(0, 3);
  }
  if (input.riskLevel) update.risk_level = input.riskLevel;

  const { data, error } = await db
    .from("market_issues")
    .update(update)
    .eq("id", issueId)
    .select("*")
    .single();
  if (error) throw error;

  await recordMarketIssueAdminAction(db, {
    actorUserId,
    issueId,
    action: input.state === "published"
      ? "publish"
      : input.state === "hidden"
        ? "hide"
        : input.state === "review"
          ? "review"
          : "edit",
    reason: input.reason,
    metadata: Object.keys(update).filter((key) => key !== "updated_at"),
  });
  return asRow(data) || {};
}

export async function listMarketIssueSources(db: Db): Promise<Row[]> {
  const { data, error } = await db
    .from("market_issue_sources")
    .select("*")
    .eq("env", marketIssueEnvironment())
    .order("source_class")
    .order("display_name")
    .limit(100);
  if (error) throw error;
  return asRows(data);
}

export async function createMarketIssueSource(input: {
  db: Db;
  actorUserId: string;
  accountHandle: string;
  displayName: string;
  sourceClass: "government" | "regulator" | "company_official" | "exchange" | "registered_media" | "journalist" | "expert";
  sourceTags?: string[];
}): Promise<Row> {
  const accountHandle = input.accountHandle.trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{1,30}$/.test(accountHandle)) {
    throw new Error("invalid_market_issue_source_handle");
  }
  const displayName = text(input.displayName).slice(0, 100);
  if (!displayName) throw new Error("invalid_market_issue_source_name");
  const { data, error } = await input.db
    .from("market_issue_sources")
    .upsert({
      env: marketIssueEnvironment(),
      source_type: "x",
      account_handle: accountHandle,
      display_name: displayName,
      source_class: input.sourceClass,
      source_tags: toTextArray(input.sourceTags || [], 20).map((tag) => tag.toUpperCase()),
      active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: "env,source_type,account_handle" })
    .select("*")
    .single();
  if (error) throw error;
  await recordMarketIssueAdminAction(input.db, {
    actorUserId: input.actorUserId,
    sourceId: text(asRow(data)?.id),
    action: "source_update",
    metadata: ["created"],
  });
  return asRow(data) || {};
}

export async function updateMarketIssueSource(input: {
  db: Db;
  actorUserId: string;
  sourceId: string;
  active?: boolean;
  displayName?: string;
  sourceTags?: string[];
  allowSingleSourcePublish?: boolean;
}): Promise<Row> {
  const update: Row = { updated_at: new Date().toISOString() };
  if (typeof input.active === "boolean") update.active = input.active;
  if (input.displayName) update.display_name = text(input.displayName).slice(0, 100);
  if (input.sourceTags) update.source_tags = toTextArray(input.sourceTags, 20)
    .map((tag) => tag.toUpperCase());
  if (typeof input.allowSingleSourcePublish === "boolean") {
    update.allow_single_source_publish = input.allowSingleSourcePublish;
  }
  const { data, error } = await input.db
    .from("market_issue_sources")
    .update(update)
    .eq("id", input.sourceId)
    .eq("env", marketIssueEnvironment())
    .select("*")
    .single();
  if (error) throw error;
  await recordMarketIssueAdminAction(input.db, {
    actorUserId: input.actorUserId,
    sourceId: input.sourceId,
    action: "source_update",
    metadata: Object.keys(update).filter((key) => key !== "updated_at"),
  });
  return asRow(data) || {};
}

export async function recordMarketIssueEvent(
  db: Db,
  input: {
    userId: string;
    eventName: MarketIssueEventName;
    issueId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const safeMetadata = Object.fromEntries(
    Object.entries(input.metadata || {})
      .filter(([key]) => ["scope", "ticker", "saved", "hidden", "following"].includes(key))
      .map(([key, value]) => [key, typeof value === "string"
        ? value.slice(0, 32)
        : typeof value === "boolean"
          ? value
          : null]),
  );
  const { error } = await db
    .from("market_issue_events")
    .insert({
      env: marketIssueEnvironment(),
      user_id: input.userId,
      issue_id: input.issueId || null,
      event_name: input.eventName,
      metadata: safeMetadata,
    });
  if (error) {
    console.warn("market_issue_event_record_failed", error.message);
  }
}

export async function recordMarketIssueAdminAction(
  db: Db,
  input: {
    actorUserId: string;
    action: "publish" | "hide" | "review" | "edit" | "merge" | "reprocess" | "source_update" | "settings_update";
    issueId?: string;
    sourceId?: string;
    reason?: string;
    metadata?: unknown;
  },
): Promise<void> {
  const { error } = await db
    .from("market_issue_admin_actions")
    .insert({
      env: marketIssueEnvironment(),
      issue_id: input.issueId || null,
      source_id: input.sourceId || null,
      actor_user_id: input.actorUserId,
      action: input.action,
      reason: nullableText(input.reason)?.slice(0, 500) || null,
      metadata: input.metadata || {},
    });
  if (error) throw error;
}
