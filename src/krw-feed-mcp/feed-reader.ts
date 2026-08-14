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
const MAX_CONTEXT_POST_TEXT_CHARS = 25_000;
const MAX_CONTEXT_SOURCE_TEXT_CHARS = 120_000;

// Keep MCP payloads bounded at the database boundary.  These projections are
// intentionally explicit so a newly-added media, enrichment, or operational
// column cannot silently inflate every research prompt.
const MARKET_ISSUE_COLUMNS = [
  "id",
  "env",
  "event_key",
  "state",
  "title_ko",
  "summary_ko",
  "impact_path",
  "confirmed_facts",
  "unconfirmed_facts",
  "status_labels",
  "source_summary",
  "source_count",
  "market_score",
  "risk_level",
  "first_observed_at",
  "published_at",
  "last_published_at",
  "updated_at",
  "merged_into_issue_id",
  "active_research_packet_id",
].join(",");
const MARKET_ISSUE_ENTITY_COLUMNS =
  "issue_id,ticker,entity_name,relationship,relationship_reason,confidence";
const MARKET_SOURCE_ITEM_COLUMNS = [
  "id",
  "env",
  "source_id",
  "external_item_id",
  "canonical_url",
  "original_text",
  "normalized_text_hash",
  "public_metrics",
  "source_metadata",
  "published_at",
  "deleted_at",
  "status",
  "title",
  "content_kind",
  "extraction_method",
  "extraction_confidence",
  "signal_level",
].join(",");
const MARKET_SOURCE_COLUMNS =
  "id,source_type,account_handle,display_name,source_class";
const MARKET_MEDIA_COLUMNS = [
  "id",
  "source_item_id",
  "ordinal",
  "media_type",
  "media_url",
  "content_hash",
  "extraction_status",
  "extraction_model",
  "extraction_confidence",
  "extraction_payload",
].join(",");
const MARKET_RESEARCH_PACKET_COLUMNS =
  "id,issue_id,version,status,source_context_hash,payload,created_at,updated_at";

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
    .select(MARKET_ISSUE_COLUMNS)
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
  version: "krw-feed-context/v2";
  environment: string;
  context_hash: string;
  requested_issue_ids: string[];
  items: FeedIssueSummary[];
  tickers: string[];
  company_groups: Array<{ ticker: string; issue_ids: string[] }>;
  gaps: Array<{ issue_id: string; code: "not_found_or_not_published" }>;
  source_materials: FeedSourceMaterial[];
  research_packets: FeedResearchPacket[];
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
  const researchArtifacts = await loadResearchArtifacts(bundles, maxPostsPerIssue);
  const sourceMaterials = applySourceTextBudget(researchArtifacts.sourceMaterials);
  const hashPayload = {
    version: "krw-feed-context/v2" as const,
    environment: env,
    requested_issue_ids: issueIds,
    tickers,
    items,
    company_groups: companyGroups,
    gaps,
    source_materials: sourceMaterials,
    research_packets: researchArtifacts.researchPackets,
  };

  return {
    ...hashPayload,
    context_hash: `sha256:${createHash("sha256").update(JSON.stringify(hashPayload)).digest("hex")}`,
  };
}

type FeedSourceMaterial = {
  issue_id: string;
  source_item_id: string;
  source_type: string;
  external_item_id: string;
  x_post_id: string;
  filing_event_id: string | null;
  source_class: string;
  publisher: string;
  author_handle: string | null;
  canonical_url: string;
  published_at: string;
  title: string | null;
  content_kind: string | null;
  signal_level: string | null;
  extraction: { method: string | null; confidence: number | null };
  source_metadata: Record<string, unknown>;
  original_text: string;
  original_text_truncated: boolean;
  original_text_omitted_due_to_budget: boolean;
  original_text_hash: string | null;
  public_metrics: Record<string, unknown>;
  media: Array<{
    id: string;
    ordinal: number;
    media_type: string;
    media_url: string | null;
    content_hash: string | null;
    extraction_status: string;
    extraction_model: string | null;
    extraction_confidence: number | null;
    extraction: Record<string, unknown>;
  }>;
};

type FeedResearchPacket = {
  issue_id: string;
  id: string;
  version: number;
  status: string;
  source_context_hash: string;
  generated_at: string | null;
  packet: Record<string, unknown>;
};

async function loadResearchArtifacts(
  bundles: Array<{ issue: Row; entities: FeedEntity[]; posts: FeedSourcePost[] }>,
  maxPosts: number,
): Promise<{ sourceMaterials: FeedSourceMaterial[]; researchPackets: FeedResearchPacket[] }> {
  const issueIds = bundles.map((bundle) => text(bundle.issue.id)).filter(Boolean);
  if (issueIds.length === 0) return { sourceMaterials: [], researchPackets: [] };
  const db = getMarketIssueServiceClient();
  const [{ data: linkData, error: linkError }, { data: packetData, error: packetError }] = await Promise.all([
    db.from("market_issue_items").select("issue_id,source_item_id").in("issue_id", issueIds),
    db
      .from("market_issue_research_packets")
      .select(MARKET_RESEARCH_PACKET_COLUMNS)
      .in("issue_id", issueIds),
  ]);
  if (linkError) throw queryError(linkError);
  if (packetError) throw queryError(packetError);
  const links = rows(linkData);
  const sourceItemIds = unique(links.map((link) => text(link.source_item_id)).filter(Boolean));
  const { data: itemData, error: itemError } = sourceItemIds.length > 0
    ? await db
      .from("market_source_items")
      .select(MARKET_SOURCE_ITEM_COLUMNS)
      .eq("env", marketIssueEnvironment())
      .in("id", sourceItemIds)
    : { data: [], error: null };
  if (itemError) throw queryError(itemError);
  const items = rows(itemData).filter((item) => text(item.status, "active") === "active" && !item.deleted_at);
  const sourceIds = unique(items.map((item) => text(item.source_id)).filter(Boolean));
  const [{ data: sourceData, error: sourceError }, { data: mediaData, error: mediaError }] = await Promise.all([
    sourceIds.length > 0
      ? db.from("market_issue_sources").select(MARKET_SOURCE_COLUMNS).in("id", sourceIds)
      : Promise.resolve({ data: [], error: null }),
    sourceItemIds.length > 0
      ? db
        .from("market_source_media")
        .select(MARKET_MEDIA_COLUMNS)
        .in("source_item_id", sourceItemIds)
        .order("ordinal")
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (sourceError) throw queryError(sourceError);
  if (mediaError) throw queryError(mediaError);
  const sourceById = new Map(rows(sourceData).map((source) => [text(source.id), source]));
  const itemById = new Map(items.map((item) => [text(item.id), item]));
  const mediaByItem = groupRows(rows(mediaData), (media) => text(media.source_item_id));
  const packetsById = new Map(rows(packetData).map((packet) => [text(packet.id), packet]));
  const linksByIssue = groupRows(links, (link) => text(link.issue_id));
  const sourceMaterials: FeedSourceMaterial[] = [];
  const researchPackets: FeedResearchPacket[] = [];

  for (const bundle of bundles) {
    const issueId = text(bundle.issue.id);
    const linkedItems = (linksByIssue.get(issueId) ?? [])
      .map((link) => itemById.get(text(link.source_item_id)))
      .filter((item): item is Row => Boolean(item))
      .sort((left, right) => Date.parse(text(right.published_at)) - Date.parse(text(left.published_at)))
      .slice(0, maxPosts);
    for (const item of linkedItems) {
      const source = sourceById.get(text(item.source_id)) || {};
      sourceMaterials.push({
        issue_id: issueId,
        source_item_id: text(item.id),
        source_type: text(source.source_type, "unknown"),
        external_item_id: text(item.external_item_id),
        x_post_id: text(source.source_type) === "x" ? text(item.external_item_id) : "",
        filing_event_id: nullableText(record(item.source_metadata).filing_event_id),
        source_class: text(source.source_class, "unknown"),
        publisher: clip(text(source.display_name, text(source.account_handle)), 120),
        author_handle: nullableText(source.account_handle),
        canonical_url: text(item.canonical_url),
        published_at: text(item.published_at),
        title: nullableText(item.title),
        content_kind: nullableText(item.content_kind),
        signal_level: nullableText(item.signal_level),
        extraction: {
          method: nullableText(item.extraction_method),
          confidence: typeof item.extraction_confidence === "number" ? item.extraction_confidence : null,
        },
        source_metadata: record(item.source_metadata),
        original_text: text(item.original_text),
        original_text_truncated: false,
        original_text_omitted_due_to_budget: false,
        original_text_hash: nullableText(item.normalized_text_hash),
        public_metrics: record(item.public_metrics),
        media: (mediaByItem.get(text(item.id)) || []).map((media) => ({
          id: text(media.id),
          ordinal: integer(media.ordinal),
          media_type: text(media.media_type, "unknown"),
          media_url: nullableText(media.media_url),
          content_hash: nullableText(media.content_hash),
          extraction_status: text(media.extraction_status, "pending"),
          extraction_model: nullableText(media.extraction_model),
          extraction_confidence: nullableNumber(media.extraction_confidence),
          extraction: record(media.extraction_payload),
        })),
      });
    }
    const activePacket = packetsById.get(text(bundle.issue.active_research_packet_id));
    if (activePacket) {
      researchPackets.push({
        issue_id: issueId,
        id: text(activePacket.id),
        version: integer(activePacket.version),
        status: text(activePacket.status, "ready"),
        source_context_hash: text(activePacket.source_context_hash),
        generated_at: nullableText(activePacket.updated_at) || nullableText(activePacket.created_at),
        packet: record(activePacket.payload),
      });
    }
  }
  return { sourceMaterials, researchPackets };
}

function applySourceTextBudget(materials: FeedSourceMaterial[]): FeedSourceMaterial[] {
  let remaining = MAX_CONTEXT_SOURCE_TEXT_CHARS;
  return materials.map((material) => {
    const allowed = Math.max(0, Math.min(MAX_CONTEXT_POST_TEXT_CHARS, remaining));
    const originalText = material.original_text.slice(0, allowed);
    remaining -= originalText.length;
    return {
      ...material,
      original_text: originalText,
      original_text_truncated: originalText.length < material.original_text.length,
      original_text_omitted_due_to_budget: material.original_text.length > 0 && allowed === 0,
    };
  });
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
    .select(MARKET_ISSUE_COLUMNS)
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
      db
        .from("market_issue_entities")
        .select(MARKET_ISSUE_ENTITY_COLUMNS)
        .in("issue_id", issueIds),
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
    .select(MARKET_SOURCE_ITEM_COLUMNS)
    .eq("env", marketIssueEnvironment())
    .eq("status", "active")
    .is("deleted_at", null)
    .in("id", sourceItemIds);
  if (itemError) throw queryError(itemError);
  const items = rows(itemData);
  const sourceIds = unique(items.map((item) => text(item.source_id)).filter(Boolean));
  const { data: sourceData, error: sourceError } = sourceIds.length > 0
    ? await db.from("market_issue_sources").select(MARKET_SOURCE_COLUMNS).in("id", sourceIds)
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
  source_type: string;
  external_item_id: string;
  x_post_id: string;
  filing_event_id: string | null;
  source_class: string;
  publisher: string;
  author_handle: string | null;
  canonical_url: string;
  original_text: string;
  published_at: string;
  public_metrics: Record<string, unknown>;
  source_metadata: Record<string, unknown>;
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
    source_type: text(source.source_type, "unknown"),
    external_item_id: text(item.external_item_id),
    x_post_id: text(source.source_type) === "x" ? text(item.external_item_id) : "",
    filing_event_id: nullableText(record(item.source_metadata).filing_event_id),
    source_class: text(source.source_class, "unknown"),
    publisher: clip(text(source.display_name, text(source.account_handle)), 120),
    author_handle: nullableText(source.account_handle),
    canonical_url: text(item.canonical_url),
    original_text: clip(text(item.original_text), MAX_POST_TEXT_CHARS),
    published_at: text(item.published_at),
    public_metrics: record(item.public_metrics),
    source_metadata: record(item.source_metadata),
  };
}

function groupRows(values: Row[], key: (value: Row) => string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const value of values) {
    const groupKey = key(value);
    const group = groups.get(groupKey) ?? [];
    group.push(value);
    groups.set(groupKey, group);
  }
  return groups;
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
