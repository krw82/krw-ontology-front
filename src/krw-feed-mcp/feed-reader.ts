import "server-only";

import { createHash } from "node:crypto";

import { marketIssueEnvironment } from "@/lib/market-issues/config";
import { getMarketIssueServiceClient } from "@/lib/market-issues/service";

type Row = Record<string, unknown>;

const MAX_LIST_LIMIT = 20;
const MAX_TICKERS = 5;
const MAX_ISSUES = 8;
const MAX_POSTS_PER_ISSUE = 3;
const MAX_POST_TEXT_CHARS = 1_200;

export class KrwFeedReaderError extends Error {
  constructor(
    readonly code:
      | "invalid_ticker"
      | "invalid_cursor"
      | "invalid_date"
      | "feed_query_failed",
    message: string,
  ) {
    super(message);
    this.name = "KrwFeedReaderError";
  }
}

export type FeedIssueSummary = ReturnType<typeof serializeIssue>;

export async function listFeedItems(input: {
  tickers?: string[];
  publishedAfter?: string;
  limit?: number;
  cursor?: string;
}): Promise<{
  environment: string;
  items: FeedIssueSummary[];
  pagination: { limit: number; next_cursor: string | null; has_more: boolean };
}> {
  const tickers = normalizeTickers(input.tickers ?? []);
  const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, input.limit ?? 10));
  const offset = parseCursor(input.cursor);
  const publishedAfter = parseDate(input.publishedAfter);
  const db = getMarketIssueServiceClient();
  const env = marketIssueEnvironment();

  let matchingIssueIds: string[] | null = null;
  if (tickers.length > 0) {
    const { data, error } = await db
      .from("market_issue_entities")
      .select("issue_id")
      .in("ticker", tickers);
    if (error) throw queryError(error);
    matchingIssueIds = unique(rows(data).map((row) => text(row.issue_id)).filter(Boolean));
    if (matchingIssueIds.length === 0) {
      return emptyListResult(env, limit);
    }
  }

  let query = db
    .from("market_issues")
    .select("*")
    .eq("env", env)
    .eq("state", "published")
    .is("merged_into_issue_id", null)
    .order("market_score", { ascending: false })
    .order("last_published_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .range(offset, offset + limit);

  if (matchingIssueIds) query = query.in("id", matchingIssueIds);
  if (publishedAfter) query = query.gte("last_published_at", publishedAfter);

  const { data, error } = await query;
  if (error) throw queryError(error);
  const issueRows = rows(data);
  const hasMore = issueRows.length > limit;
  const bundles = await loadIssueBundles(issueRows.slice(0, limit), 0);

  return {
    environment: env,
    items: bundles.map((bundle) => serializeIssue(bundle.issue, bundle.entities, [])),
    pagination: {
      limit,
      next_cursor: hasMore ? String(offset + limit) : null,
      has_more: hasMore,
    },
  };
}

export async function getFeedItems(input: {
  issueIds: string[];
  includeSources?: boolean;
}): Promise<{
  environment: string;
  items: FeedIssueSummary[];
  missing_issue_ids: string[];
}> {
  const issueIds = unique(input.issueIds).slice(0, MAX_ISSUES);
  const env = marketIssueEnvironment();
  const bundles = await loadPublishedIssueBundles(issueIds, input.includeSources ? 2 : 0);
  const byId = new Map(bundles.map((bundle) => [text(bundle.issue.id), bundle]));

  return {
    environment: env,
    items: issueIds.flatMap((issueId) => {
      const bundle = byId.get(issueId);
      return bundle
        ? [serializeIssue(bundle.issue, bundle.entities, bundle.posts)]
        : [];
    }),
    missing_issue_ids: issueIds.filter((issueId) => !byId.has(issueId)),
  };
}

export async function getFeedContext(input: {
  issueIds: string[];
  tickers?: string[];
  maxPostsPerIssue?: number;
}): Promise<{
  version: "krw-feed-context/v1";
  environment: string;
  context_hash: string;
  requested_issue_ids: string[];
  items: FeedIssueSummary[];
  tickers: string[];
  company_groups: Array<{ ticker: string; issue_ids: string[] }>;
  gaps: Array<{ issue_id: string; code: "not_found_or_not_published" }>;
}> {
  const issueIds = unique(input.issueIds).slice(0, MAX_ISSUES);
  const requestedTickers = normalizeTickers(input.tickers ?? []);
  const maxPostsPerIssue = Math.min(
    MAX_POSTS_PER_ISSUE,
    Math.max(1, input.maxPostsPerIssue ?? 2),
  );
  const env = marketIssueEnvironment();
  const bundles = await loadPublishedIssueBundles(issueIds, maxPostsPerIssue);
  const byId = new Map(bundles.map((bundle) => [text(bundle.issue.id), bundle]));
  const items = issueIds.flatMap((issueId) => {
    const bundle = byId.get(issueId);
    return bundle
      ? [serializeIssue(bundle.issue, bundle.entities, bundle.posts)]
      : [];
  });
  const discoveredTickers = items.flatMap((item) =>
    item.entities
      .map((entity) => entity.ticker)
      .filter((ticker): ticker is string => Boolean(ticker)),
  );
  const tickers = unique([...requestedTickers, ...discoveredTickers]).slice(0, MAX_TICKERS);
  const companyGroups = tickers.map((ticker) => ({
    ticker,
    issue_ids: items
      .filter((item) => item.entities.some((entity) => entity.ticker === ticker))
      .map((item) => item.id),
  }));
  const gaps = issueIds
    .filter((issueId) => !byId.has(issueId))
    .map((issueId) => ({ issue_id: issueId, code: "not_found_or_not_published" as const }));
  const hashPayload = {
    version: "krw-feed-context/v1" as const,
    environment: env,
    requested_issue_ids: issueIds,
    tickers,
    items,
    company_groups: companyGroups,
    gaps,
  };

  return {
    ...hashPayload,
    context_hash: `sha256:${createHash("sha256").update(JSON.stringify(hashPayload)).digest("hex")}`,
  };
}

export async function checkKrwFeedReadiness(): Promise<boolean> {
  try {
    const db = getMarketIssueServiceClient();
    const { error } = await db
      .from("market_issue_settings")
      .select("env")
      .eq("env", marketIssueEnvironment())
      .limit(1);
    return !error;
  } catch {
    return false;
  }
}

async function loadPublishedIssueBundles(issueIds: string[], maxPosts: number) {
  if (issueIds.length === 0) return [];
  const db = getMarketIssueServiceClient();
  const { data, error } = await db
    .from("market_issues")
    .select("*")
    .eq("env", marketIssueEnvironment())
    .eq("state", "published")
    .is("merged_into_issue_id", null)
    .in("id", issueIds);
  if (error) throw queryError(error);
  return loadIssueBundles(rows(data), maxPosts);
}

async function loadIssueBundles(issueRows: Row[], maxPosts: number): Promise<Array<{
  issue: Row;
  entities: FeedEntity[];
  posts: FeedSourcePost[];
}>> {
  if (issueRows.length === 0) return [];
  const db = getMarketIssueServiceClient();
  const issueIds = issueRows.map((row) => text(row.id)).filter(Boolean);
  const [{ data: entityData, error: entityError }, { data: linkData, error: linkError }] =
    await Promise.all([
      db.from("market_issue_entities").select("*").in("issue_id", issueIds),
      maxPosts > 0
        ? db.from("market_issue_items").select("issue_id,source_item_id").in("issue_id", issueIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
  if (entityError) throw queryError(entityError);
  if (linkError) throw queryError(linkError);

  const entitiesByIssue = new Map<string, FeedEntity[]>();
  for (const entity of rows(entityData)) {
    const issueId = text(entity.issue_id);
    const bucket = entitiesByIssue.get(issueId) ?? [];
    bucket.push(serializeEntity(entity));
    entitiesByIssue.set(issueId, bucket);
  }

  const links = rows(linkData);
  const sourceItemIds = unique(links.map((row) => text(row.source_item_id)).filter(Boolean));
  const postsByIssue = await loadPostsByIssue(links, sourceItemIds, maxPosts);

  return issueRows.map((issue) => ({
    issue,
    entities: entitiesByIssue.get(text(issue.id)) ?? [],
    posts: postsByIssue.get(text(issue.id)) ?? [],
  }));
}

async function loadPostsByIssue(
  links: Row[],
  sourceItemIds: string[],
  maxPosts: number,
): Promise<Map<string, FeedSourcePost[]>> {
  if (maxPosts === 0 || sourceItemIds.length === 0) return new Map();
  const db = getMarketIssueServiceClient();
  const { data: itemData, error: itemError } = await db
    .from("market_source_items")
    .select("*")
    .eq("env", marketIssueEnvironment())
    .eq("status", "active")
    .is("deleted_at", null)
    .in("id", sourceItemIds);
  if (itemError) throw queryError(itemError);
  const items = rows(itemData);
  const sourceIds = unique(items.map((item) => text(item.source_id)).filter(Boolean));
  const { data: sourceData, error: sourceError } = sourceIds.length > 0
    ? await db.from("market_issue_sources").select("*").in("id", sourceIds)
    : { data: [], error: null };
  if (sourceError) throw queryError(sourceError);
  const sourceById = new Map(rows(sourceData).map((source) => [text(source.id), source]));
  const postByItemId = new Map(items.map((item) => [text(item.id), serializePost(item, sourceById.get(text(item.source_id)) ?? {})]));
  const postsByIssue = new Map<string, FeedSourcePost[]>();

  for (const link of links) {
    const issueId = text(link.issue_id);
    const post = postByItemId.get(text(link.source_item_id));
    if (!issueId || !post) continue;
    const bucket = postsByIssue.get(issueId) ?? [];
    bucket.push(post);
    postsByIssue.set(issueId, bucket);
  }

  for (const [issueId, posts] of postsByIssue) {
    postsByIssue.set(issueId, posts
      .sort((left, right) => Date.parse(right.published_at) - Date.parse(left.published_at))
      .slice(0, maxPosts));
  }
  return postsByIssue;
}

type FeedEntity = {
  ticker: string | null;
  name: string;
  relationship: string;
  relationship_reason: string;
  confidence: number;
};

type FeedSourcePost = {
  id: string;
  x_post_id: string;
  source_class: string;
  publisher: string;
  author_handle: string | null;
  canonical_url: string;
  original_text: string;
  published_at: string;
  public_metrics: Record<string, unknown>;
};

function serializeIssue(issue: Row, entities: FeedEntity[], posts: FeedSourcePost[]) {
  return {
    id: text(issue.id),
    event_key: text(issue.event_key),
    title_ko: clip(text(issue.title_ko), 240),
    summary_ko: clip(text(issue.summary_ko), 1_500),
    impact_path: textArray(issue.impact_path, 5, 360),
    confirmed_facts: textArray(issue.confirmed_facts, 5, 360),
    unconfirmed_facts: textArray(issue.unconfirmed_facts, 5, 360),
    status_labels: textArray(issue.status_labels, 3, 80),
    source_summary: record(issue.source_summary),
    source_count: integer(issue.source_count),
    market_score: numeric(issue.market_score),
    risk_level: text(issue.risk_level, "medium"),
    first_observed_at: nullableText(issue.first_observed_at),
    published_at: nullableText(issue.last_published_at) ?? nullableText(issue.published_at),
    updated_at: nullableText(issue.updated_at),
    entities,
    source_posts: posts,
  };
}

function serializeEntity(entity: Row): FeedEntity {
  const ticker = nullableText(entity.ticker)?.toUpperCase() ?? null;
  return {
    ticker,
    name: clip(text(entity.entity_name, ticker ?? "관련 기업"), 120),
    relationship: text(entity.relationship, "theme"),
    relationship_reason: clip(text(entity.relationship_reason), 240),
    confidence: Math.max(0, Math.min(1, numeric(entity.confidence, 0.5))),
  };
}

function serializePost(item: Row, source: Row): FeedSourcePost {
  return {
    id: text(item.id),
    x_post_id: text(item.external_item_id),
    source_class: text(source.source_class, "unknown"),
    publisher: clip(text(source.display_name, text(source.account_handle)), 120),
    author_handle: nullableText(source.account_handle),
    canonical_url: text(item.canonical_url),
    original_text: clip(text(item.original_text), MAX_POST_TEXT_CHARS),
    published_at: text(item.published_at),
    public_metrics: record(item.public_metrics),
  };
}

function emptyListResult(environment: string, limit: number) {
  return {
    environment,
    items: [],
    pagination: { limit, next_cursor: null, has_more: false },
  };
}

function normalizeTickers(values: string[]): string[] {
  const normalized = unique(values.map((value) => value.trim().toUpperCase()).filter(Boolean));
  if (normalized.length > MAX_TICKERS) {
    throw new KrwFeedReaderError("invalid_ticker", `At most ${MAX_TICKERS} tickers are allowed.`);
  }
  for (const ticker of normalized) {
    if (!/^[A-Z0-9.-]{1,16}$/.test(ticker)) {
      throw new KrwFeedReaderError("invalid_ticker", `Invalid ticker: ${ticker}`);
    }
  }
  return normalized;
}

function parseCursor(value: string | undefined): number {
  if (!value) return 0;
  if (!/^\d{1,6}$/.test(value)) {
    throw new KrwFeedReaderError("invalid_cursor", "cursor must be a non-negative integer string.");
  }
  return Number.parseInt(value, 10);
}

function parseDate(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new KrwFeedReaderError("invalid_date", "published_after must be an ISO-8601 datetime.");
  }
  return new Date(parsed).toISOString();
}

function queryError(error: unknown): KrwFeedReaderError {
  const message = error instanceof Error ? error.message : "market_issue_query_failed";
  return new KrwFeedReaderError("feed_query_failed", message);
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Row {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function nullableText(value: unknown): string | null {
  const result = text(value);
  return result || null;
}

function numeric(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value: unknown): number {
  return Math.max(0, Math.trunc(numeric(value)));
}

function textArray(value: unknown, maxItems: number, maxChars: number): string[] {
  return Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === "string")
      .map((item) => clip(item, maxChars))
      .filter(Boolean)
      .slice(0, maxItems)
    : [];
}

function clip(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1).trimEnd()}…`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
