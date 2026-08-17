import { createHash } from "node:crypto";

import { XMLParser } from "fast-xml-parser";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

import { enqueueMarketEventBatch, enqueueMarketIssueEnrichment } from "./enrichment";
import { assessMarketIssueFreshness } from "./freshness";
import { classifyAsNewsEvent, type NewsClassifierConfig } from "./news-classifier";
import { fetchFmpJson, fmpApiKey } from "../valuation/fmp-client";

type Row = Record<string, unknown>;
type Db = SupabaseClient;
type QueueKind = "poll" | "detail" | "correlate";
type MarketWebFetchPurpose = "discovery" | "detail";
type RealtimeTransport = NonNullable<
  NonNullable<Parameters<typeof createClient>[2]>["realtime"]
>["transport"];

const MAX_QUEUE_READS = 4;
const USER_AGENT = "KRW-Ontology-Market-Source-Worker/1.0 (+https://krwontology.com)";
const COVERAGE_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const coverageSyncAt = new Map<string, number>();

export type MarketIssueEnvironment = "dev" | "staging" | "prod";

export type MarketWebSourceSeed = {
  sourceKey: string;
  displayName: string;
  sourceType?: "web" | "sec";
  sourceClass?: string;
  sourceTags?: string[];
  companyTickers?: string[];
  adapterType: "rss" | "atom" | "json_feed" | "sitemap" | "html_list" | "json_api" | "sec_catalog";
  channelType?: string;
  discoveryUrl: string;
  canonicalHost: string;
  pollIntervalSeconds?: number;
  priority?: number;
  maxItemsPerPoll?: number;
  requiresBrowser?: boolean;
  adapterConfig?: Record<string, unknown>;
  active?: boolean;
};

export type MarketWebSourceRuntimeConfig = {
  environment: MarketIssueEnvironment;
  workerId: string;
  maxQueueJobs: number;
  visibilitySeconds: number;
  httpTimeoutMs: number;
  maxResponseBytes: number;
  hardMaxResponseBytes: number;
  webSources: MarketWebSourceSeed[];
  newsClassifierEnabled: boolean;
  zaiBaseUrl: string;
  zaiApiKey: string;
  zaiModel: string;
  zaiTimeoutMs: number;
  fmpNewsEnabled: boolean;
  fmpNewsMaxAgeHours: number;
  fmpNewsSymbolBatchSize: number;
};

export type MarketWebIngestionResult = {
  environment: MarketIssueEnvironment;
  seededSources: number;
  refreshedCompanyCoverage: number | null;
  fmpSeededSources: number | null;
  poll: QueueResult;
  detail: QueueResult;
  correlate: QueueResult;
};

type QueueResult = {
  claimed: number;
  succeeded: number;
  deferred: number;
  deadLettered: number;
};

export type MarketWebSourceHealth =
  | "pending_first_fetch"
  | "healthy"
  | "empty"
  | "degraded"
  | "blocked"
  | "invalid"
  | "needs_browser";

export type MarketWebFailureClassification = {
  code: string;
  healthStatus: MarketWebSourceHealth;
  terminal: boolean;
  retryAfterSeconds: number;
  httpStatus: number | null;
};

export type MarketWebSourceProfile = {
  fetchBackend: "http" | "browser" | "rsshub";
  articleExtractor: "feed_content" | "semantic_html" | "json";
  maxRedirects: number;
  maxResponseBytes: number;
  minBodyChars: number;
  requirePublishedAt: boolean;
  fallbackSourceKeys: string[];
};

type QueueMessage = {
  msg_id: number;
  read_ct: number;
  message: Record<string, unknown>;
};

export type MarketWebSourceCandidate = {
  url: string;
  title: string | null;
  publishedAt: string | null;
  publishedAtIsInferred: boolean;
  raw: Record<string, unknown>;
};

type Candidate = MarketWebSourceCandidate;

export type MarketWebFetchDocument = {
  url: string;
  status: number;
  body: string;
  contentType: string;
  etag: string | null;
  lastModified: string | null;
};

export type MarketWebExtractedArticle = {
  canonicalUrl: string;
  title: string | null;
  body: string;
  imageUrls: string[];
  publishedAt: string | null;
  publishedAtIsInferred: boolean;
  extractionMethod: string;
  extractionConfidence: number;
};

export type MarketWebArticleQuality = {
  accepted: boolean;
  reason: string | null;
  bodyLength: number;
  extractionConfidence: number;
};

export function getMarketWebSourceRuntimeConfig(
  environment: Record<string, string | undefined> = process.env,
): MarketWebSourceRuntimeConfig {
  const configuredEnvironment = environment.MARKET_ISSUE_ENV
    || environment.MARKET_ISSUE_ENVIRONMENT
    || (environment.NODE_ENV === "production" ? "prod" : "dev");
  if (!["dev", "staging", "prod"].includes(configuredEnvironment)) {
    throw new Error(`invalid_market_issue_environment:${configuredEnvironment}`);
  }

  return {
    environment: configuredEnvironment as MarketIssueEnvironment,
    workerId: environment.MARKET_ISSUE_WEB_WORKER_ID || `web-source-${process.pid}`,
    maxQueueJobs: boundedNumber(environment.MARKET_ISSUE_WEB_MAX_QUEUE_JOBS, 20, 1, 100),
    visibilitySeconds: boundedNumber(environment.MARKET_ISSUE_WEB_QUEUE_VISIBILITY_SECONDS, 300, 30, 1800),
    httpTimeoutMs: boundedNumber(environment.MARKET_ISSUE_WEB_HTTP_TIMEOUT_MS, 12000, 1000, 60000),
    maxResponseBytes: boundedNumber(environment.MARKET_ISSUE_WEB_MAX_RESPONSE_BYTES, 2_000_000, 32_000, 8_000_000),
    hardMaxResponseBytes: boundedNumber(environment.MARKET_ISSUE_WEB_HARD_MAX_RESPONSE_BYTES, 8_000_000, 32_000, 8_000_000),
    webSources: parseWebSourceSeeds(environment.MARKET_ISSUE_WEB_SOURCES),
    newsClassifierEnabled: environment.MARKET_ISSUE_NEWS_CLASSIFIER_ENABLED !== "0"
      && environment.MARKET_ISSUE_NEWS_CLASSIFIER_ENABLED !== "false"
      && environment.MARKET_ISSUE_NEWS_CLASSIFIER_ENABLED !== "off",
    zaiBaseUrl: (environment.MARKET_ISSUE_ZAI_BASE_URL || "https://api.z.ai/api/coding/paas/v4" || "").replace(/\/+$/, ""),
    zaiApiKey: environment.MARKET_ISSUE_ZAI_API_KEY || environment.ZAI_API_KEY || "",
    zaiModel: environment.MARKET_ISSUE_ZAI_MODEL || "glm-5.1",
    zaiTimeoutMs: boundedNumber(environment.MARKET_ISSUE_ZAI_TIMEOUT_MS, 120000, 10000, 300000),
    fmpNewsEnabled: environment.MARKET_FMP_NEWS_ENABLED === "true" || environment.MARKET_FMP_NEWS_ENABLED === "1",
    fmpNewsMaxAgeHours: boundedNumber(environment.MARKET_FMP_NEWS_MAX_AGE_HOURS, 72, 1, 720),
    fmpNewsSymbolBatchSize: boundedNumber(environment.MARKET_FMP_NEWS_SYMBOL_BATCH_SIZE, 40, 1, 100),
  };
}

export function createMarketWebSourceClient(
  environment: Record<string, string | undefined> = process.env,
): Db {
  const url = environment.SUPABASE_URL || environment.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = environment.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("market_web_source_supabase_credentials_missing");

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket as unknown as RealtimeTransport },
  });
}

export async function runMarketWebSourceIngestionCycle(input: {
  db?: Db;
  config?: MarketWebSourceRuntimeConfig;
  maxQueueJobs?: number;
} = {}): Promise<MarketWebIngestionResult> {
  const config = input.config || getMarketWebSourceRuntimeConfig();
  const db = input.db || createMarketWebSourceClient();
  const maxQueueJobs = input.maxQueueJobs || config.maxQueueJobs;
  const seededSources = await syncMarketIssueWebSources(db, config);
  const refreshedCompanyCoverage = await refreshMarketCompanySourceCoverage(db, config.environment);
  const fmpSeededSources = await syncFmpNewsSources(db, config);

  const poll = await consumeQueue(db, config, "poll", maxQueueJobs, processPollMessage);
  const detail = await consumeQueue(db, config, "detail", maxQueueJobs, processDetailMessage);
  const correlate = await consumeQueue(db, config, "correlate", maxQueueJobs, processCorrelateMessage);

  return { environment: config.environment, seededSources, refreshedCompanyCoverage, fmpSeededSources, poll, detail, correlate };
}

async function refreshMarketCompanySourceCoverage(
  db: Db,
  environment: MarketIssueEnvironment,
): Promise<number | null> {
  const now = Date.now();
  const previous = coverageSyncAt.get(environment) || 0;
  if (now - previous < COVERAGE_SYNC_INTERVAL_MS) return null;

  const { data, error } = await db.rpc("refresh_market_company_source_registry", {
    p_environment: environment,
  });
  if (error) throw error;
  coverageSyncAt.set(environment, now);
  const refreshed = Number(data);
  return Number.isFinite(refreshed) ? refreshed : 0;
}

export async function syncMarketIssueWebSources(
  db: Db,
  config: MarketWebSourceRuntimeConfig,
): Promise<number> {
  if (config.webSources.length === 0) return 0;

  const rows = config.webSources.map((seed) => ({
    env: config.environment,
    source_type: seed.sourceType || "web",
    source_key: seed.sourceKey,
    account_handle: null,
    display_name: seed.displayName,
    source_class: seed.sourceClass || "company_official",
    source_tags: seed.sourceTags || [],
    active: seed.active !== false,
    allow_single_source_publish: false,
    adapter_type: seed.adapterType,
    channel_type: seed.channelType || "newsroom",
    discovery_url: seed.discoveryUrl,
    canonical_host: normalizeHost(seed.canonicalHost),
    poll_interval_seconds: boundedNumber(seed.pollIntervalSeconds, 900, 60, 86400),
    priority: boundedNumber(seed.priority, 50, 1, 100),
    max_items_per_poll: boundedNumber(seed.maxItemsPerPoll, 25, 1, 100),
    requires_browser: seed.requiresBrowser === true,
    adapter_config: {
      ...(seed.adapterConfig || {}),
      ...(seed.companyTickers ? { company_tickers: seed.companyTickers } : {}),
    },
    updated_at: new Date().toISOString(),
  }));
  const { error } = await db
    .from("market_issue_sources")
    .upsert(rows, { onConflict: "env,source_type,source_key", ignoreDuplicates: true });
  if (error) throw error;
  return rows.length;
}

async function consumeQueue(
  db: Db,
  config: MarketWebSourceRuntimeConfig,
  queueKind: QueueKind,
  quantity: number,
  handler: (db: Db, config: MarketWebSourceRuntimeConfig, payload: Row) => Promise<void>,
): Promise<QueueResult> {
  const { data, error } = await db.rpc("claim_market_issue_queue_messages", {
    p_environment: config.environment,
    p_queue_kind: queueKind,
    p_visibility_seconds: config.visibilitySeconds,
    p_quantity: quantity,
  });
  if (error) throw error;

  const messages = asRows(data).map((row) => ({
    msg_id: Number(row.msg_id),
    read_ct: Number(row.read_ct || 0),
    message: asRow(row.message) || {},
  })).filter((message) => Number.isFinite(message.msg_id));

  const result: QueueResult = { claimed: messages.length, succeeded: 0, deferred: 0, deadLettered: 0 };
  for (const message of messages) {
    try {
      await handler(db, config, message.message);
      await acknowledgeQueueMessage(db, config, queueKind, message.msg_id);
      result.succeeded += 1;
    } catch (error) {
      if (message.read_ct >= MAX_QUEUE_READS || classifyMarketWebFetchFailure(error).terminal) {
        await deadLetterQueueMessage(db, config, queueKind, message, error);
        await acknowledgeQueueMessage(db, config, queueKind, message.msg_id);
        result.deadLettered += 1;
      } else {
        result.deferred += 1;
      }
    }
  }
  return result;
}

async function processPollMessage(db: Db, config: MarketWebSourceRuntimeConfig, payload: Row): Promise<void> {
  const sourceId = text(payload.source_id);
  if (!sourceId) throw new Error("market_web_poll_source_id_missing");
  const source = await loadSource(db, config.environment, sourceId);
  if (!source) return;

  if (text(source.adapter_type) === "sec_catalog") {
    await pollSecCatalogSource(db, config, source);
    return;
  }

  if (text(source.adapter_type) === FMP_NEWS_ADAPTER_TYPE) {
    await pollFmpNewsSource(db, config, source);
    return;
  }

  const fetchState = await loadFetchState(db, sourceId);
  const startedAt = new Date().toISOString();
  let document: MarketWebFetchDocument;
  try {
    document = await fetchMarketWebTextDocument(text(source.discovery_url), source, config, {
      etag: nullableText(fetchState?.etag),
      lastModified: nullableText(fetchState?.last_modified),
    });
  } catch (error) {
    await recordFetchFailure(db, sourceId, "discovery", text(source.discovery_url), config.workerId, error);
    throw error;
  }

  if (document.status === 304) {
    await completeFetchState(db, sourceId, { status: 304, etag: document.etag, lastModified: document.lastModified });
    await insertFetchRun(db, {
      sourceId,
      phase: "discovery",
      workerId: config.workerId,
      requestUrl: document.url,
      status: "not_modified",
      httpStatus: 304,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    return;
  }

  const candidates = extractDiscoveryCandidates(document, source)
    .filter((candidate) => candidateMatchesSource(candidate, source))
    .slice(0, boundedNumber(source.max_items_per_poll, 25, 1, 100));

  for (const candidate of candidates) {
    const candidateId = await createCandidate(db, source, candidate);
    if (!candidateId) continue;
    const { error } = await db.rpc("enqueue_market_issue_queue_message", {
      p_environment: config.environment,
      p_queue_kind: "detail",
      p_message: { job_type: "detail", candidate_id: candidateId },
      p_delay_seconds: 0,
    });
    if (error) throw error;
  }

  await completeFetchState(db, sourceId, {
    status: document.status,
    etag: document.etag,
    lastModified: document.lastModified,
    healthStatus: candidates.length > 0 ? "healthy" : "empty",
    healthReason: candidates.length > 0 ? null : "no_matching_candidates",
  });
  await insertFetchRun(db, {
    sourceId,
    phase: "discovery",
    workerId: config.workerId,
    requestUrl: document.url,
    status: "succeeded",
    httpStatus: document.status,
    responseBytes: Buffer.byteLength(document.body),
    extractionMethod: text(source.adapter_type),
    metadata: { discovered_candidate_count: candidates.length },
    startedAt,
    finishedAt: new Date().toISOString(),
  });
  await db.from("market_issue_sources")
    .update({ last_collected_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() })
    .eq("id", sourceId);
}

async function pollSecCatalogSource(
  db: Db,
  config: MarketWebSourceRuntimeConfig,
  source: Row,
): Promise<void> {
  const startedAt = new Date().toISOString();
  const adapterConfig = asRow(source.adapter_config) || {};
  const fetchState = await loadFetchState(db, text(source.id));
  const state = asRow(fetchState?.state) || {};
  const seenEventIds = new Set(stringArray(state.recent_filing_event_ids));
  const formTypes = stringArray(adapterConfig.form_types).filter((form) => ["8-K", "8-K/A", "6-K", "6-K/A", "4", "4/A"].includes(form));
  const permittedForms = formTypes.length > 0
    ? formTypes
    : adapterConfig.include_form4 === true ? ["8-K", "8-K/A", "6-K", "6-K/A", "4", "4/A"] : ["8-K", "8-K/A", "6-K", "6-K/A"];
  let query = db.from("sec_filing_events")
    .select("*")
    .eq("env", config.environment)
    .eq("processing_status", "ready")
    .in("form_type", permittedForms)
    .order("occurred_at", { ascending: false })
    .limit(boundedNumber(source.max_items_per_poll, 25, 1, 100));
  if (adapterConfig.only_feed_eligible !== false) query = query.eq("feed_eligible", true);
  const { data, error } = await query;
  if (error) {
    await recordFetchFailure(db, text(source.id), "discovery", "supabase://sec_filing_events", config.workerId, error);
    throw error;
  }

  const filings = asRows(data);
  let queuedCount = 0;
  for (const filing of filings) {
    const filingEventId = text(filing.id);
    if (filingEventId && seenEventIds.has(filingEventId)) continue;
    const primaryUrl = nullableText(filing.primary_document_url) || nullableText(filing.filing_detail_url);
    if (!primaryUrl) continue;
    const candidate = makeCandidate(
      primaryUrl,
      `SEC ${text(filing.form_type)}: ${text(filing.ticker)} ${text(filing.primary_event_tag)}`.trim(),
      parsePublishedDate(filing.occurred_at || filing.accepted_at || filing.first_seen_at),
      filing,
    );
    if (!candidate || !candidateMatchesSource(candidate, source)) continue;
    const candidateId = await createCandidate(db, source, candidate);
    if (!candidateId) continue;
    const { error: queueError } = await db.rpc("enqueue_market_issue_queue_message", {
      p_environment: config.environment,
      p_queue_kind: "detail",
      p_message: { job_type: "detail", candidate_id: candidateId },
      p_delay_seconds: 0,
    });
    if (queueError) throw queueError;
    queuedCount += 1;
  }

  const recentFilingEventIds = uniqueStrings([
    ...filings.map((filing) => text(filing.id)),
    ...stringArray(state.recent_filing_event_ids),
  ]).slice(0, 200);
  await completeFetchState(db, text(source.id), {
    status: 200,
    etag: null,
    lastModified: null,
    state: { ...state, recent_filing_event_ids: recentFilingEventIds },
  });
  await insertFetchRun(db, {
    sourceId: text(source.id),
    phase: "discovery",
    workerId: config.workerId,
    requestUrl: "supabase://sec_filing_events",
    status: "succeeded",
    httpStatus: 200,
    extractionMethod: "sec_catalog",
    metadata: { discovered_filing_count: filings.length, queued_candidate_count: queuedCount, form_types: permittedForms },
    startedAt,
    finishedAt: new Date().toISOString(),
  });
  await db.from("market_issue_sources")
    .update({ last_collected_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() })
    .eq("id", source.id);
}

// ---- FMP market news adapter ----
//
// One active "dispatcher" source polls /stable/news/stock in ticker batches
// (one API call per batch) and routes each article to a per-ticker attribution
// source row seeded from market_company_source_registry. Ticker rows stay
// active=false so the poll scheduler never enqueues them directly; items are
// persisted against them by the dispatcher for display name + ticker
// source_tags (deterministic entity attachment).

const FMP_NEWS_ADAPTER_TYPE = "fmp_news";
const FMP_NEWS_SOURCE_KEY = "fmp-market-news";
const FMP_NEWS_POLL_INTERVAL_SECONDS = 900;
const FMP_NEWS_SYNC_INTERVAL_MS = 10 * 60 * 1000;
const FMP_NEWS_MAP_TTL_MS = 5 * 60 * 1000;
const FMP_NEWS_BODY_MAX_CHARS = 20_000;
const FMP_NEWS_ENDPOINT = "/news/stock";

export type FmpNewsArticle = {
  ticker: string;
  title: string;
  body: string;
  url: string;
  site: string | null;
  image: string | null;
  publishedAt: string;
};

export function parseFmpNewsArticles(value: unknown): FmpNewsArticle[] {
  if (!Array.isArray(value)) return [];
  const articles: FmpNewsArticle[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const ticker = text(record.symbol || record.ticker).trim().toUpperCase();
    const url = text(record.url || record.link).trim();
    const body = text(record.text || record.content || record.body).trim();
    const title = text(record.title || record.headline).trim();
    const publishedAt = parseFmpNewsDate(text(record.publishedDate || record.published_date || record.date));
    if (!ticker || !url || !body || !publishedAt) continue;
    articles.push({
      ticker: ticker.slice(0, 16),
      title: title.slice(0, 500),
      body,
      url,
      site: nullableText(record.site) || nullableText(record.publisher),
      image: nullableText(record.image),
      publishedAt,
    });
  }
  return articles;
}

// FMP space-separated datetimes ("2026-08-17 10:00:00") carry no timezone
// designator; treat them as UTC so freshness windows stay deterministic
// regardless of the worker host timezone.
function parseFmpNewsDate(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);
  const normalized = trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T");
  const parsed = new Date(hasTimezone ? normalized : `${normalized}Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function filterFmpArticlesForIngest(
  articles: FmpNewsArticle[],
  input: { now: Date; maxAgeHours: number; maxItems: number; knownTickers: ReadonlySet<string> },
): {
  accepted: FmpNewsArticle[];
  skippedStale: number;
  skippedUnknownTicker: number;
  skippedInvalidUrl: number;
  seenUrls: Set<string>;
} {
  const cutoffMs = input.now.getTime() - input.maxAgeHours * 60 * 60 * 1000;
  const accepted: FmpNewsArticle[] = [];
  const seenUrls = new Set<string>();
  let skippedStale = 0;
  let skippedUnknownTicker = 0;
  let skippedInvalidUrl = 0;
  for (const article of articles) {
    if (accepted.length >= input.maxItems) break;
    let canonical: URL;
    try {
      canonical = new URL(article.url);
      if (canonical.protocol !== "https:" && canonical.protocol !== "http:") throw new Error("invalid_protocol");
    } catch {
      skippedInvalidUrl += 1;
      continue;
    }
    const dedupeKey = `${article.ticker}:${normalizeCanonicalUrl(canonical.href).toLowerCase()}`;
    if (seenUrls.has(dedupeKey)) continue;
    seenUrls.add(dedupeKey);
    if (Date.parse(article.publishedAt) < cutoffMs) {
      skippedStale += 1;
      continue;
    }
    if (!input.knownTickers.has(article.ticker)) {
      skippedUnknownTicker += 1;
      continue;
    }
    accepted.push(article);
  }
  return { accepted, skippedStale, skippedUnknownTicker, skippedInvalidUrl, seenUrls };
}

const fmpNewsSyncAt = new Map<string, number>();
const fmpNewsTickerMapCache = new Map<string, { at: number; map: Map<string, Row> }>();

export async function syncFmpNewsSources(db: Db, config: MarketWebSourceRuntimeConfig): Promise<number | null> {
  const now = Date.now();
  const previous = fmpNewsSyncAt.get(config.environment) || 0;
  if (now - previous < FMP_NEWS_SYNC_INTERVAL_MS) return null;
  fmpNewsSyncAt.set(config.environment, now);

  const { data: registryRows, error: registryError } = await db
    .from("market_company_source_registry")
    .select("ticker,company_name")
    .eq("env", config.environment)
    .eq("active", true)
    .limit(2000);
  if (registryError) throw registryError;

  const dispatcherActive = config.fmpNewsEnabled && fmpApiKey().length > 0;
  const dispatcher = {
    env: config.environment,
    source_type: "web",
    source_key: FMP_NEWS_SOURCE_KEY,
    adapter_type: FMP_NEWS_ADAPTER_TYPE,
    channel_type: "newsroom",
    display_name: "FMP 시장 뉴스",
    source_class: "registered_media",
    discovery_url: "https://financialmodelingprep.com/stable/news/stock",
    canonical_host: "financialmodelingprep.com",
    poll_interval_seconds: FMP_NEWS_POLL_INTERVAL_SECONDS,
    priority: 40,
    max_items_per_poll: 50,
    source_tags: ["company_news", "aggregator"],
    adapter_config: { mode: "dispatcher" },
    active: dispatcherActive,
    updated_at: new Date().toISOString(),
  };
  const tickerRows = asRows(registryRows).map((row) => {
    const ticker = text(row.ticker).trim().toUpperCase();
    return {
      env: config.environment,
      source_type: "web",
      source_key: `fmp-news-${ticker}`,
      adapter_type: FMP_NEWS_ADAPTER_TYPE,
      channel_type: "newsroom",
      display_name: `${text(row.company_name, ticker)} 시장 뉴스 (FMP)`,
      source_class: "registered_media",
      discovery_url: "https://financialmodelingprep.com/stable/news/stock",
      canonical_host: "financialmodelingprep.com",
      poll_interval_seconds: 86_400,
      priority: 30,
      max_items_per_poll: 10,
      source_tags: ["company_news", ticker],
      adapter_config: { mode: "attribution", ticker },
      active: false,
      updated_at: new Date().toISOString(),
    };
  });

  const { error: upsertError } = await db
    .from("market_issue_sources")
    .upsert([dispatcher, ...tickerRows], { onConflict: "env,source_type,source_key" });
  if (upsertError) throw upsertError;
  fmpNewsTickerMapCache.delete(config.environment);
  return tickerRows.length;
}

async function loadFmpTickerSources(db: Db, config: MarketWebSourceRuntimeConfig): Promise<Map<string, Row>> {
  const cached = fmpNewsTickerMapCache.get(config.environment);
  if (cached && Date.now() - cached.at < FMP_NEWS_MAP_TTL_MS) return cached.map;
  const { data, error } = await db
    .from("market_issue_sources")
    .select("id,display_name,source_tags,adapter_config,source_key")
    .eq("env", config.environment)
    .eq("source_type", "web")
    .eq("adapter_type", FMP_NEWS_ADAPTER_TYPE)
    .limit(2000);
  if (error) throw error;
  const map = new Map<string, Row>();
  for (const raw of asRows(data)) {
    const adapterConfig = asRow(raw.adapter_config) || {};
    if (text(adapterConfig.mode) !== "attribution") continue;
    const ticker = text(adapterConfig.ticker).trim().toUpperCase();
    if (ticker) map.set(ticker, raw);
  }
  fmpNewsTickerMapCache.set(config.environment, { at: Date.now(), map });
  return map;
}

async function pollFmpNewsSource(db: Db, config: MarketWebSourceRuntimeConfig, source: Row): Promise<void> {
  const adapterConfig = asRow(source.adapter_config) || {};
  if (text(adapterConfig.mode) !== "dispatcher") return;
  if (!config.fmpNewsEnabled) return;

  const startedAt = new Date().toISOString();
  const tickerSources = await loadFmpTickerSources(db, config);
  let articles: FmpNewsArticle[] = [];
  let apiCallCount = 0;
  try {
    const tickers = Array.from(tickerSources.keys());
    const batchSize = Math.max(1, Math.min(config.fmpNewsSymbolBatchSize, 100));
    for (let offset = 0; offset < tickers.length; offset += batchSize) {
      const batch = tickers.slice(offset, offset + batchSize);
      apiCallCount += 1;
      const pageArticles = await fetchFmpJson<unknown>(FMP_NEWS_ENDPOINT, {
        symbols: batch.join(","),
        page: "0",
      });
      articles = articles.concat(parseFmpNewsArticles(pageArticles));
    }
  } catch (error) {
    await recordFetchFailure(db, text(source.id), "discovery", text(source.discovery_url), config.workerId, error);
    throw error;
  }
  articles.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));

  const maxItems = Math.max(1, Number(source.max_items_per_poll) || 50);
  const filtered = filterFmpArticlesForIngest(articles, {
    now: new Date(),
    maxAgeHours: config.fmpNewsMaxAgeHours,
    maxItems,
    knownTickers: new Set(tickerSources.keys()),
  });

  const failures: string[] = [];
  let ingested = 0;
  for (const article of filtered.accepted) {
    const tickerSource = tickerSources.get(article.ticker);
    if (!tickerSource) continue;
    try {
      const sourceItem = await persistWebSourceItem(
        db,
        config,
        tickerSource,
        {
          candidate_url: article.url,
          published_at: article.publishedAt,
          discovered_at: new Date().toISOString(),
        },
        {
          canonicalUrl: normalizeCanonicalUrl(article.url),
          title: article.title || null,
          body: article.body.slice(0, FMP_NEWS_BODY_MAX_CHARS),
          imageUrls: article.image ? [article.image] : [],
          publishedAt: article.publishedAt,
          publishedAtIsInferred: false,
          extractionMethod: "fmp_news_api",
          extractionConfidence: 0.95,
        },
      );
      await processCorrelateMessage(db, config, { source_item_id: text(sourceItem.id) });
      ingested += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown fmp news ingestion failure";
      failures.push(`${article.ticker}: ${message}`.slice(0, 300));
    }
  }

  await insertFetchRun(db, {
    sourceId: text(source.id),
    phase: "discovery",
    workerId: config.workerId,
    requestUrl: text(source.discovery_url),
    status: failures.length > 0 && ingested === 0 ? "failed" : "succeeded",
    httpStatus: 200,
    extractionMethod: FMP_NEWS_ADAPTER_TYPE,
    errorMessage: failures.length > 0 ? failures.join(" | ").slice(0, 900) : undefined,
    metadata: {
      fetched_article_count: articles.length,
      api_call_count: apiCallCount,
      ingested_item_count: ingested,
      skipped_stale: filtered.skippedStale,
      skipped_unknown_ticker: filtered.skippedUnknownTicker,
      skipped_invalid_url: filtered.skippedInvalidUrl,
      failure_count: failures.length,
    },
    startedAt,
    finishedAt: new Date().toISOString(),
  });
  await db.from("market_issue_sources")
    .update({
      last_collected_at: new Date().toISOString(),
      last_error: failures.length > 0 ? failures.join(" | ").slice(0, 500) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", text(source.id));
}

async function processDetailMessage(db: Db, config: MarketWebSourceRuntimeConfig, payload: Row): Promise<void> {
  const candidateId = text(payload.candidate_id);
  if (!candidateId) throw new Error("market_web_detail_candidate_id_missing");
  const candidate = await loadCandidate(db, candidateId);
  if (!candidate || ["fetched", "ignored"].includes(text(candidate.status))) return;
  const source = await loadSource(db, config.environment, text(candidate.source_id));
  if (!source) throw new Error("market_web_detail_source_missing");

  const now = new Date().toISOString();
  await db.from("market_source_candidates")
    .update({
      status: "processing",
      attempt_count: Number(candidate.attempt_count || 0) + 1,
      last_attempt_at: now,
      updated_at: now,
    })
    .eq("id", candidateId);

  const startedAt = now;
  let document: MarketWebFetchDocument;
  try {
    document = await fetchMarketWebTextDocument(text(candidate.candidate_url), source, config, {}, "detail");
  } catch (error) {
    await db.from("market_source_candidates")
      .update({ status: "failed", last_error: errorMessage(error), updated_at: new Date().toISOString() })
      .eq("id", candidateId);
    await recordFetchFailure(db, text(source.id), "detail", text(candidate.candidate_url), config.workerId, error, candidateId);
    throw error;
  }

  const article = extractMarketWebArticle(document, source, candidate);
  const quality = assessMarketWebArticleQuality(article, source, config);
  if (!quality.accepted) {
    await db.from("market_source_candidates")
      .update({
        status: "ignored",
        quality_status: "rejected",
        quality_reason: quality.reason,
        last_error: `detail_quality_${quality.reason || "rejected"}`,
        updated_at: new Date().toISOString(),
      })
      .eq("id", candidateId);
    await insertFetchRun(db, {
      sourceId: text(source.id),
      candidateId,
      phase: "detail",
      workerId: config.workerId,
      requestUrl: document.url,
      status: "skipped",
      httpStatus: document.status,
      responseBytes: Buffer.byteLength(document.body),
      errorCode: `detail_quality_${quality.reason || "rejected"}`,
      metadata: { quality },
      startedAt,
      finishedAt: new Date().toISOString(),
    });
    return;
  }

  // ── News event pre-filter ──────────────────────────────────────────────
  // Reject IR page chrome / navigation / stock widgets / historical background
  // BEFORE creating a source_item row, so no issue, no enrichment, no compose.
  // Fail-open: classifier errors never block ingestion (downstream gates remain).
  if (config.newsClassifierEnabled && config.zaiApiKey) {
    const newsCheck = await classifyAsNewsEvent(
      {
        zaiBaseUrl: config.zaiBaseUrl,
        zaiApiKey: config.zaiApiKey,
        zaiModel: config.zaiModel,
        zaiTimeoutMs: config.zaiTimeoutMs,
      } satisfies NewsClassifierConfig,
      document.url,
      article.title || "",
      article.body || "",
    );
    if (!newsCheck.isNewsEvent) {
      await db.from("market_source_candidates")
        .update({
          status: "ignored",
          quality_status: "rejected",
          quality_reason: "not_news_event",
          last_error: `not_news_event:${newsCheck.eventType}:${newsCheck.reason.slice(0, 120)}`,
          updated_at: new Date().toISOString(),
        })
        .eq("id", candidateId);
      await insertFetchRun(db, {
        sourceId: text(source.id),
        candidateId,
        phase: "detail",
        workerId: config.workerId,
        requestUrl: document.url,
        status: "skipped",
        httpStatus: document.status,
        responseBytes: Buffer.byteLength(document.body),
        errorCode: "not_news_event",
        metadata: { newsCheck },
        startedAt,
        finishedAt: new Date().toISOString(),
      });
      return;
    }
  }

  const sourceItem = await persistWebSourceItem(db, config, source, candidate, article);
  await db.from("market_source_candidates")
    .update({ status: "fetched", quality_status: "accepted", quality_reason: null, last_error: null, updated_at: new Date().toISOString() })
    .eq("id", candidateId);
  await markSourceItemValidated(db, text(source.id), article);
  await insertFetchRun(db, {
    sourceId: text(source.id),
    candidateId,
    phase: "detail",
    workerId: config.workerId,
    requestUrl: document.url,
    status: "succeeded",
    httpStatus: document.status,
    responseBytes: Buffer.byteLength(document.body),
    extractionMethod: article.extractionMethod,
    metadata: { title: article.title, extraction_confidence: article.extractionConfidence, quality },
    startedAt,
    finishedAt: new Date().toISOString(),
  });

  const { error } = await db.rpc("enqueue_market_issue_queue_message", {
    p_environment: config.environment,
    p_queue_kind: "correlate",
    p_message: { job_type: "correlate", source_item_id: sourceItem.id },
    p_delay_seconds: 0,
  });
  if (error) throw error;
}

async function processCorrelateMessage(db: Db, config: MarketWebSourceRuntimeConfig, payload: Row): Promise<void> {
  const sourceItemId = text(payload.source_item_id);
  if (!sourceItemId) throw new Error("market_web_correlate_source_item_id_missing");
  const sourceItem = await loadSourceItem(db, sourceItemId);
  if (!sourceItem || text(sourceItem.env) !== config.environment) return;
  const source = await loadSource(db, config.environment, text(sourceItem.source_id));
  if (!source) throw new Error("market_web_correlate_source_missing");
  if (!assessMarketIssueFreshness(source, sourceItem).eligible) return;

  if (await enqueueMarketEventBatch({
    db,
    source,
    sourceItem,
    environment: config.environment,
  })) return;

  const existingIssue = await findCorrelatedIssue(db, config.environment, sourceItemId, sourceItem);
  const issue = existingIssue || await createWebIssue(db, config, source, sourceItem);
  await attachSourceItemToIssue(db, issue, sourceItem, existingIssue ? "corroborating" : "primary");
  await enqueueMarketIssueEnrichment({ db, issueId: text(issue.id), environment: config.environment });
}

async function persistWebSourceItem(
  db: Db,
  config: MarketWebSourceRuntimeConfig,
  source: Row,
  candidate: Row,
  article: MarketWebExtractedArticle,
): Promise<Row> {
  const signal = classifySignal(article.title || "", article.body, stringArray(source.source_tags));
  const canonicalUrlHash = hashText(article.canonicalUrl.toLowerCase().trim());
  const candidateRaw = asRow(candidate.raw_candidate) || {};
  const filingEventId = text(source.adapter_type) === "sec_catalog" ? nullableText(candidateRaw.id) : null;
  const externalItemId = filingEventId
    ? `sec:${filingEventId}`
    : text(source.adapter_type) === FMP_NEWS_ADAPTER_TYPE
      ? `fmp:${canonicalUrlHash}`
      : `web:${canonicalUrlHash}`;
  const publishedAt = article.publishedAt || nullableText(candidate.published_at) || new Date().toISOString();
  const row = {
    env: config.environment,
    source_id: source.id,
    external_item_id: externalItemId,
    canonical_url: article.canonicalUrl,
    original_text: article.body,
    language: containsKorean(article.body) ? "ko" : "en",
    normalized_text_hash: hashText(normalizeText(article.body)),
    public_metrics: {},
    source_metadata: {
      source_key: text(source.source_key),
      source_display_name: text(source.display_name),
      source_type: text(source.source_type),
      adapter_type: text(source.adapter_type),
      discovery_url: text(source.discovery_url),
      original_candidate_url: text(candidate.candidate_url),
      image_analysis: "deferred_remote_only",
      ...(filingEventId ? {
        filing_event_id: filingEventId,
        ticker: nullableText(candidateRaw.ticker),
        accession_number: nullableText(candidateRaw.accession_number),
        form_type: nullableText(candidateRaw.form_type),
        sec_items: stringArray(candidateRaw.sec_items),
        event_tags: stringArray(candidateRaw.event_tags),
        filing_detail_url: nullableText(candidateRaw.filing_detail_url),
      } : {}),
    },
    published_at: publishedAt,
    status: "active",
    canonical_url_hash: canonicalUrlHash,
    related_url_hashes: uniqueStrings([
      canonicalUrlHash,
      nullableText(candidate.candidate_url) ? hashText(normalizeCanonicalUrl(text(candidate.candidate_url)).toLowerCase()) : "",
      nullableText(candidateRaw.filing_detail_url) ? hashText(normalizeCanonicalUrl(text(candidateRaw.filing_detail_url)).toLowerCase()) : "",
      nullableText(candidateRaw.primary_document_url) ? hashText(normalizeCanonicalUrl(text(candidateRaw.primary_document_url)).toLowerCase()) : "",
    ]),
    title: article.title,
    content_kind: text(source.channel_type, "newsroom"),
    discovered_at: nullableText(candidate.discovered_at) || new Date().toISOString(),
    fetched_at: new Date().toISOString(),
    extraction_method: article.extractionMethod,
    extraction_confidence: article.extractionConfidence,
    published_at_is_inferred: article.publishedAtIsInferred,
    signal_level: signal.level,
    signal_reason: signal.reason,
    event_type_hint: signal.eventType,
  };
  const { data, error } = await db
    .from("market_source_items")
    .upsert(row, { onConflict: "env,source_id,external_item_id" })
    .select("*")
    .single();
  if (error) throw error;
  const sourceItem = asRow(data);
  if (!sourceItem) throw new Error("market_web_source_item_upsert_empty");
  await persistWebSourceMedia(db, config, source, sourceItem, article.imageUrls);
  return sourceItem;
}

async function persistWebSourceMedia(
  db: Db,
  config: MarketWebSourceRuntimeConfig,
  source: Row,
  sourceItem: Row,
  imageUrls: string[],
): Promise<void> {
  const adapterConfig = asRow(source.adapter_config) || {};
  if (adapterConfig.analyze_images !== true || imageUrls.length === 0) return;
  const allowedHosts = sourceAllowedHosts(source);
  const records = imageUrls.slice(0, 4).map((mediaUrl, ordinal) => ({
    env: config.environment,
    source_item_id: sourceItem.id,
    ordinal,
    x_media_key: null,
    media_type: "photo",
    media_url: mediaUrl,
    source_url_hash: hashText(mediaUrl.toLowerCase()),
    extraction_status: "pending",
    extraction_payload: {
      source: "web_article_metadata",
      allowed_hosts: allowedHosts,
    },
    updated_at: new Date().toISOString(),
  }));
  const { error } = await db
    .from("market_source_media")
    .upsert(records, { onConflict: "source_item_id,ordinal" });
  if (error) throw error;
}

async function createWebIssue(
  db: Db,
  config: MarketWebSourceRuntimeConfig,
  source: Row,
  sourceItem: Row,
): Promise<Row> {
  const eventKey = `web:${hashText(`${text(sourceItem.title)}\n${normalizeText(text(sourceItem.original_text)).slice(0, 12000)}`).slice(0, 40)}`;
  const { data: existingData, error: existingError } = await db
    .from("market_issues")
    .select("*")
    .eq("env", config.environment)
    .eq("event_key", eventKey)
    .maybeSingle();
  if (existingError) throw existingError;
  const existing = asRow(existingData);

  const { data: settingsData, error: settingsError } = await db
    .from("market_issue_settings")
    .select("manual_review_required")
    .eq("env", config.environment)
    .maybeSingle();
  if (settingsError) throw settingsError;
  const settings = asRow(settingsData);
  const isLowSignal = text(sourceItem.signal_level) === "low";
  const preservePublished = text(existing?.state) === "published";
  const sourceCount = Math.max(1, Number(existing?.source_count || 0) + 1);
  const sourceClass = text(source.source_class, "company_official");
  const isOfficial = ["company_official", "regulator", "exchange"].includes(sourceClass);
  const labels = new Set(stringArray(existing?.status_labels));
  labels.add(isOfficial ? "공식 원문" : "등록 언론");
  if (isLowSignal) labels.add("저신호");

  const now = new Date().toISOString();
  const update = {
    env: config.environment,
    event_key: eventKey,
    state: preservePublished ? "published" : "review",
    summary_status: preservePublished ? text(existing?.summary_status, "ready") : "pending",
    title_ko: preservePublished
      ? text(existing?.title_ko, `${text(source.display_name, "공식 출처")} 원문 업데이트`)
      : `${text(source.display_name, "공식 출처")} 원문 분석 중`,
    summary_ko: preservePublished ? text(existing?.summary_ko) : "",
    impact_path: preservePublished ? stringArray(existing?.impact_path) : [],
    confirmed_facts: preservePublished ? stringArray(existing?.confirmed_facts) : [],
    unconfirmed_facts: preservePublished ? stringArray(existing?.unconfirmed_facts) : [],
    research_paths: preservePublished ? existing?.research_paths || [] : [],
    status_labels: [...labels].slice(0, 3),
    source_summary: {
      total: sourceCount,
      official: isOfficial ? sourceCount : 0,
      independent: isOfficial ? 0 : sourceCount,
      source_classes: [sourceClass],
    },
    source_count: sourceCount,
    market_score: Math.max(Number(existing?.market_score || 0), isLowSignal ? 10 : 45),
    risk_level: preservePublished ? text(existing?.risk_level, "medium") : (isLowSignal ? "low" : "medium"),
    requires_manual_review: settings?.manual_review_required === true || isLowSignal,
    update_count: existing ? Number(existing.update_count || 0) + 1 : 0,
    first_observed_at: existing?.first_observed_at || now,
    published_at: preservePublished ? existing?.published_at || now : null,
    last_published_at: preservePublished ? existing?.last_published_at || now : null,
    updated_at: now,
  };
  const { data, error } = await db
    .from("market_issues")
    .upsert(update, { onConflict: "env,event_key" })
    .select("*")
    .single();
  if (error) throw error;
  const issue = asRow(data);
  if (!issue) throw new Error("market_web_issue_upsert_empty");
  return issue;
}

async function attachSourceItemToIssue(
  db: Db,
  issue: Row,
  sourceItem: Row,
  relationType: "primary" | "corroborating",
): Promise<void> {
  const { error } = await db.from("market_issue_items").upsert({
    issue_id: issue.id,
    source_item_id: sourceItem.id,
    relation_type: relationType,
    correlation_method: relationType === "primary" ? "content_fingerprint" : "canonical_url_or_text_hash",
    correlation_confidence: relationType === "primary" ? 1 : 0.98,
    evidence_locator: {
      canonical_url: sourceItem.canonical_url,
      canonical_url_hash: sourceItem.canonical_url_hash,
    },
    evidence_rank: relationType === "primary" ? 1 : 10,
    is_primary: relationType === "primary",
    attached_at: new Date().toISOString(),
  }, { onConflict: "issue_id,source_item_id" });
  if (error) throw error;
}

async function findCorrelatedIssue(
  db: Db,
  environment: MarketIssueEnvironment,
  sourceItemId: string,
  sourceItem: Row,
): Promise<Row | null> {
  const candidateIds = new Set<string>();
  const canonicalHash = nullableText(sourceItem.canonical_url_hash);
  const textHash = nullableText(sourceItem.normalized_text_hash);
  for (const [column, value] of [["canonical_url_hash", canonicalHash], ["normalized_text_hash", textHash]] as const) {
    if (!value) continue;
    const { data, error } = await db.from("market_source_items")
      .select("id")
      .eq("env", environment)
      .eq(column, value)
      .neq("id", sourceItemId)
      .limit(20);
    if (error) throw error;
    for (const row of asRows(data)) candidateIds.add(text(row.id));
  }
  const relatedHashes = uniqueStrings([
    ...stringArray(sourceItem.related_url_hashes),
    canonicalHash || "",
  ]);
  if (relatedHashes.length > 0) {
    const { data, error } = await db.from("market_source_items")
      .select("id")
      .eq("env", environment)
      .overlaps("related_url_hashes", relatedHashes)
      .neq("id", sourceItemId)
      .limit(20);
    if (error) throw error;
    for (const row of asRows(data)) candidateIds.add(text(row.id));
  }
  if (candidateIds.size === 0) return null;

  const { data: linksData, error: linksError } = await db.from("market_issue_items")
    .select("issue_id")
    .in("source_item_id", [...candidateIds]);
  if (linksError) throw linksError;
  const issueIds = uniqueStrings(asRows(linksData).map((row) => text(row.issue_id)));
  if (issueIds.length === 0) return null;
  const { data, error } = await db.from("market_issues")
    .select("*")
    .eq("env", environment)
    .in("id", issueIds)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return asRow(data);
}

async function createCandidate(db: Db, source: Row, candidate: Candidate): Promise<string | null> {
  const candidateUrl = normalizeCanonicalUrl(candidate.url);
  const row = {
    source_id: source.id,
    candidate_url: candidateUrl,
    candidate_url_hash: hashText(candidateUrl.toLowerCase()),
    title: candidate.title,
    published_at: candidate.publishedAt,
    published_at_is_inferred: candidate.publishedAtIsInferred,
    raw_candidate: candidate.raw,
  };
  const { data: existingData, error: existingError } = await db
    .from("market_source_candidates")
    .select("id")
    .eq("source_id", source.id)
    .eq("candidate_url_hash", row.candidate_url_hash)
    .maybeSingle();
  if (existingError) throw existingError;
  if (asRow(existingData)) return null;

  const { data, error } = await db.from("market_source_candidates").insert(row).select("id").single();
  if (error) {
    if (error.code === "23505") return null;
    throw error;
  }
  return text(asRow(data)?.id) || null;
}

async function loadSource(db: Db, environment: MarketIssueEnvironment, sourceId: string): Promise<Row | null> {
  const { data, error } = await db.from("market_issue_sources")
    .select("*")
    .eq("id", sourceId)
    .eq("env", environment)
    .eq("active", true)
    .in("source_type", ["web", "sec"])
    .maybeSingle();
  if (error) throw error;
  return asRow(data);
}

async function loadFetchState(db: Db, sourceId: string): Promise<Row | null> {
  const { data, error } = await db.from("market_source_fetch_states")
    .select("*")
    .eq("source_id", sourceId)
    .maybeSingle();
  if (error) throw error;
  return asRow(data);
}

async function loadCandidate(db: Db, candidateId: string): Promise<Row | null> {
  const { data, error } = await db.from("market_source_candidates")
    .select("*")
    .eq("id", candidateId)
    .maybeSingle();
  if (error) throw error;
  return asRow(data);
}

async function loadSourceItem(db: Db, sourceItemId: string): Promise<Row | null> {
  const { data, error } = await db.from("market_source_items")
    .select("*")
    .eq("id", sourceItemId)
    .maybeSingle();
  if (error) throw error;
  return asRow(data);
}

async function completeFetchState(
  db: Db,
  sourceId: string,
  input: {
    status: number;
    etag: string | null;
    lastModified: string | null;
    state?: Row;
    healthStatus?: MarketWebSourceHealth;
    healthReason?: string | null;
  },
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db.from("market_source_fetch_states").upsert({
    source_id: sourceId,
    etag: input.etag,
    last_modified: input.lastModified,
    last_success_at: now,
    last_attempt_at: now,
    failure_count: 0,
    consecutive_failure_count: 0,
    last_status_code: input.status,
    last_error: null,
    health_status: input.healthStatus || "healthy",
    health_reason: input.healthReason || null,
    retry_after: null,
    ...(input.state ? { state: input.state } : {}),
    updated_at: now,
  }, { onConflict: "source_id" });
  if (error) throw error;
}

async function recordFetchFailure(
  db: Db,
  sourceId: string,
  phase: "discovery" | "detail",
  requestUrl: string,
  workerId: string,
  failure: unknown,
  candidateId?: string,
): Promise<void> {
  const state = await loadFetchState(db, sourceId);
  const now = new Date().toISOString();
  const failureCount = Number(state?.failure_count || 0) + 1;
  const consecutiveFailureCount = Number(state?.consecutive_failure_count || 0) + 1;
  const classification = classifyMarketWebFetchFailure(failure, consecutiveFailureCount);
  const retryAfter = new Date(Date.now() + classification.retryAfterSeconds * 1000).toISOString();
  await db.from("market_source_fetch_states").upsert({
    source_id: sourceId,
    last_attempt_at: now,
    failure_count: failureCount,
    consecutive_failure_count: consecutiveFailureCount,
    last_status_code: classification.httpStatus,
    last_error: classification.code,
    health_status: classification.healthStatus,
    health_reason: classification.code,
    retry_after: retryAfter,
    next_poll_at: retryAfter,
    updated_at: now,
  }, { onConflict: "source_id" });
  await insertFetchRun(db, {
    sourceId,
    candidateId,
    phase,
    workerId,
    requestUrl,
    status: "failed",
    errorCode: classification.code,
    errorMessage: errorMessage(failure),
    startedAt: now,
    finishedAt: now,
  });
}

async function markSourceItemValidated(
  db: Db,
  sourceId: string,
  article: MarketWebExtractedArticle,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db.from("market_source_fetch_states").upsert({
    source_id: sourceId,
    health_status: "healthy",
    health_reason: null,
    last_valid_item_at: now,
    last_content_hash: hashText(`${article.canonicalUrl}\n${article.title || ""}\n${article.body}`),
    consecutive_failure_count: 0,
    retry_after: null,
    updated_at: now,
  }, { onConflict: "source_id" });
  if (error) throw error;
}

async function insertFetchRun(db: Db, input: {
  sourceId: string;
  candidateId?: string;
  phase: "discovery" | "detail";
  workerId: string;
  requestUrl: string;
  status: "not_modified" | "succeeded" | "skipped" | "failed";
  httpStatus?: number;
  extractionMethod?: string;
  responseBytes?: number;
  errorCode?: string;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
}): Promise<void> {
  const { error } = await db.from("market_source_fetch_runs").insert({
    source_id: input.sourceId,
    candidate_id: input.candidateId || null,
    phase: input.phase,
    worker_id: input.workerId,
    request_url: input.requestUrl,
    status: input.status,
    http_status: input.httpStatus || null,
    extraction_method: input.extractionMethod || null,
    response_bytes: input.responseBytes || null,
    error_code: input.errorCode || null,
    error_message: input.errorMessage || null,
    metadata: input.metadata || {},
    started_at: input.startedAt,
    finished_at: input.finishedAt,
  });
  if (error) throw error;
}

async function acknowledgeQueueMessage(
  db: Db,
  config: MarketWebSourceRuntimeConfig,
  queueKind: QueueKind,
  messageId: number,
): Promise<void> {
  const { error } = await db.rpc("ack_market_issue_queue_message", {
    p_environment: config.environment,
    p_queue_kind: queueKind,
    p_message_id: messageId,
  });
  if (error) throw error;
}

async function deadLetterQueueMessage(
  db: Db,
  config: MarketWebSourceRuntimeConfig,
  queueKind: QueueKind,
  message: QueueMessage,
  failure: unknown,
): Promise<void> {
  const { error } = await db.from("market_worker_dead_letters").insert({
    environment: config.environment,
    queue_kind: queueKind,
    queue_message_id: message.msg_id,
    payload: message.message,
    error_code: failure instanceof Error ? failure.name : "market_web_worker_error",
    error_message: errorMessage(failure),
  });
  if (error) throw error;
}

export async function fetchMarketWebTextDocument(
  inputUrl: string,
  source: Row,
  config: MarketWebSourceRuntimeConfig,
  conditional: { etag?: string | null; lastModified?: string | null } = {},
  purpose: MarketWebFetchPurpose = "discovery",
): Promise<MarketWebFetchDocument> {
  let currentUrl = assertAllowedSourceUrl(inputUrl, source, purpose);
  const adapterConfig = asRow(source.adapter_config) || {};
  const profile = resolveMarketWebSourceProfile(source, config);
  const userAgent = text(adapterConfig.user_agent, USER_AGENT).slice(0, 256) || USER_AGENT;
  for (let redirectCount = 0; redirectCount <= profile.maxRedirects; redirectCount += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.httpTimeoutMs);
    let response: Response;
    try {
      response = await fetch(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": userAgent,
          Accept: "application/rss+xml, application/atom+xml, application/feed+json, application/json, text/html, application/xhtml+xml;q=0.9, */*;q=0.1",
          ...(conditional.etag ? { "If-None-Match": conditional.etag } : {}),
          ...(conditional.lastModified ? { "If-Modified-Since": conditional.lastModified } : {}),
        },
      });
    } finally {
      clearTimeout(timeout);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("market_web_redirect_location_missing");
      currentUrl = assertAllowedSourceUrl(new URL(location, currentUrl).toString(), source, purpose);
      continue;
    }
    if (response.status === 304) {
      return {
        url: currentUrl,
        status: 304,
        body: "",
        contentType: response.headers.get("content-type") || "",
        etag: response.headers.get("etag"),
        lastModified: response.headers.get("last-modified"),
      };
    }
    if (!response.ok) throw new Error(`market_web_http_${response.status}`);
    const declaredSize = Number(response.headers.get("content-length") || 0);
    if (declaredSize > profile.maxResponseBytes) throw new Error("market_web_response_too_large");
    const document = {
      url: currentUrl,
      status: response.status,
      body: await readLimitedResponse(response, profile.maxResponseBytes),
      contentType: response.headers.get("content-type") || "",
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    };
    if (purpose === "discovery") validateSourceDocument(document, source);
    return document;
  }
  throw new Error("market_web_redirect_limit_exceeded");
}

function extractDiscoveryCandidates(document: MarketWebFetchDocument, source: Row): Candidate[] {
  const adapterType = text(source.adapter_type).toLowerCase();
  if (adapterType === "rss" || adapterType === "atom") return extractXmlCandidates(document.body, document.url);
  if (adapterType === "json_feed" || adapterType === "json_api") return extractJsonCandidates(document.body, document.url, asRow(source.adapter_config) || {});
  if (adapterType === "sitemap") return extractSitemapCandidates(document.body, document.url);
  return extractHtmlCandidates(document.body, document.url, asRow(source.adapter_config) || {});
}

export function extractMarketWebSourceCandidates(
  document: MarketWebFetchDocument,
  source: Row,
): MarketWebSourceCandidate[] {
  return extractDiscoveryCandidates(document, source);
}

function extractXmlCandidates(body: string, baseUrl: string): Candidate[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true, trimValues: true });
  const parsed = asRow(parser.parse(body)) || {};
  const channel = asRow(asRow(parsed.rss)?.channel) || {};
  const feed = asRow(parsed.feed) || {};
  const rawItems = [...asArray(channel.item), ...asArray(feed.entry)];
  return rawItems.map((raw) => {
    const item = asRow(raw) || {};
    const link = xmlLink(item.link);
    return makeCandidate(link ? new URL(link, baseUrl).toString() : "", text(item.title) || null,
      parsePublishedDate(item.pubDate || item.published || item.updated), item);
  }).filter((item): item is Candidate => item !== null);
}

function extractJsonCandidates(body: string, baseUrl: string, adapterConfig: Row): Candidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const itemPath = text(adapterConfig.item_path, "items");
  const rawItems = asArray(valueAtPath(parsed, itemPath));
  const urlField = text(adapterConfig.url_field, "url");
  const titleField = text(adapterConfig.title_field, "title");
  const publishedField = text(adapterConfig.published_at_field, "date_published");
  return rawItems.map((raw) => {
    const item = asRow(raw) || {};
    const link = text(valueAtPath(item, urlField)) || text(item.external_url);
    return makeCandidate(link ? new URL(link, baseUrl).toString() : "", text(valueAtPath(item, titleField)) || null,
      parsePublishedDate(valueAtPath(item, publishedField)), item);
  }).filter((item): item is Candidate => item !== null);
}

function extractSitemapCandidates(body: string, baseUrl: string): Candidate[] {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", removeNSPrefix: true, trimValues: true });
  const parsed = asRow(parser.parse(body)) || {};
  const entries = asArray(asRow(parsed.urlset)?.url);
  return entries.map((raw) => {
    const entry = asRow(raw) || {};
    const link = text(entry.loc);
    return makeCandidate(link ? new URL(link, baseUrl).toString() : "", null, parsePublishedDate(entry.lastmod), entry);
  }).filter((item): item is Candidate => item !== null);
}

function extractHtmlCandidates(body: string, baseUrl: string, adapterConfig: Row): Candidate[] {
  const includePattern = safeRegExp(nullableText(adapterConfig.include_path_regex));
  const excludePattern = safeRegExp(nullableText(adapterConfig.exclude_path_regex));
  const candidates: Candidate[] = [];
  const anchorPattern = /<a\b([^>]*?)href\s*=\s*(["'])(.*?)\2[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of body.matchAll(anchorPattern)) {
    const rawHref = decodeHtml(match[3]).trim();
    if (!rawHref || rawHref.startsWith("#") || /^(mailto:|javascript:|tel:)/i.test(rawHref)) continue;
    let url: string;
    try {
      url = new URL(rawHref, baseUrl).toString();
    } catch {
      continue;
    }
    const path = new URL(url).pathname;
    if (includePattern && !includePattern.test(path)) continue;
    if (excludePattern && excludePattern.test(path)) continue;
    const title = cleanText(stripHtml(match[4])).slice(0, 300) || null;
    const candidate = makeCandidate(url, title, null, { href: rawHref, anchor_text: title });
    if (candidate) candidates.push(candidate);
  }
  return dedupeCandidates(candidates);
}

export function extractMarketWebArticle(
  document: MarketWebFetchDocument,
  source: Row,
  candidate: Row,
): MarketWebExtractedArticle {
  if (isJsonDocument(document, source)) return extractJsonArticle(document, candidate, source);
  const metadata = extractHtmlMetadata(document.body);
  const jsonLd = extractJsonLdArticle(document.body);
  const canonicalUrl = normalizeCanonicalUrl(new URL(metadata.canonicalUrl || document.url, document.url).toString());
  const title = metadata.title || jsonLd.title || nullableText(candidate.title);
  const published = parsePublishedDate(metadata.publishedAt || jsonLd.publishedAt || candidate.published_at);
  const schemaBody = cleanText(jsonLd.body || "");
  const semanticBody = extractSemanticHtmlBody(document.body);
  const htmlBody = cleanText(stripHtml(removeChromeHtml(document.body)));
  const useSchema = schemaBody.length >= 80;
  const useSemantic = !useSchema && semanticBody.length >= 80;
  const body = (useSchema ? schemaBody : useSemantic ? semanticBody : htmlBody).slice(0, 120000);
  return {
    canonicalUrl,
    title,
    body,
    imageUrls: sanitizeSourceImageUrls([...metadata.imageUrls, ...jsonLd.imageUrls], document.url, source),
    publishedAt: published?.value || null,
    publishedAtIsInferred: published?.inferred || false,
    extractionMethod: useSchema ? "json_ld_article_body" : useSemantic ? "semantic_html" : "html_text",
    extractionConfidence: useSchema ? 0.92 : useSemantic ? 0.82 : 0.4,
  };
}

function extractJsonArticle(document: MarketWebFetchDocument, candidate: Row, source: Row): MarketWebExtractedArticle {
  let parsed: unknown = {};
  try {
    parsed = JSON.parse(document.body);
  } catch {
    return {
      canonicalUrl: normalizeCanonicalUrl(document.url),
      title: nullableText(candidate.title),
      body: "",
      imageUrls: [],
      publishedAt: null,
      publishedAtIsInferred: false,
      extractionMethod: "json_parse_failed",
      extractionConfidence: 0,
    };
  }
  const config = asRow(source.adapter_config) || {};
  const title = text(valueAtPath(parsed, text(config.detail_title_field, "title"))) || nullableText(candidate.title);
  const body = cleanText(text(valueAtPath(parsed, text(config.detail_body_field, "content_text"))) || text(valueAtPath(parsed, "content_html")));
  const published = parsePublishedDate(valueAtPath(parsed, text(config.detail_published_at_field, "date_published")) || candidate.published_at);
  const canonical = text(valueAtPath(parsed, text(config.detail_url_field, "url"))) || document.url;
  const images = imageUrlsFromValue(valueAtPath(parsed, text(config.detail_image_field, "image")));
  return {
    canonicalUrl: normalizeCanonicalUrl(canonical),
    title,
    body: stripHtml(body).slice(0, 120000),
    imageUrls: sanitizeSourceImageUrls(images, document.url, source),
    publishedAt: published?.value || null,
    publishedAtIsInferred: published?.inferred || false,
    extractionMethod: "json_detail",
    extractionConfidence: body.length >= 80 ? 0.8 : 0.2,
  };
}

export function resolveMarketWebSourceProfile(
  source: Row,
  config: Pick<MarketWebSourceRuntimeConfig, "maxResponseBytes" | "hardMaxResponseBytes">,
): MarketWebSourceProfile {
  const adapterConfig = asRow(source.adapter_config) || {};
  const adapterType = text(source.adapter_type).toLowerCase();
  const requestedBackend = text(adapterConfig.fetch_backend, source.requires_browser === true ? "browser" : "http").toLowerCase();
  const fetchBackend = requestedBackend === "browser" || requestedBackend === "rsshub" ? requestedBackend : "http";
  const requestedExtractor = text(adapterConfig.article_extractor, adapterType === "rss" || adapterType === "atom" ? "feed_content" : "semantic_html").toLowerCase();
  const articleExtractor = requestedExtractor === "json" || requestedExtractor === "feed_content" ? requestedExtractor : "semantic_html";
  return {
    fetchBackend,
    articleExtractor,
    maxRedirects: boundedNumber(adapterConfig.max_redirects, 5, 0, 8),
    maxResponseBytes: boundedNumber(adapterConfig.max_response_bytes, config.maxResponseBytes, 32_000, config.hardMaxResponseBytes),
    minBodyChars: boundedNumber(adapterConfig.min_body_chars, stringArray(source.source_tags).includes("ir") ? 160 : 240, 80, 20_000),
    requirePublishedAt: adapterConfig.require_published_at === true,
    fallbackSourceKeys: stringArray(adapterConfig.fallback_source_keys),
  };
}

export function assessMarketWebArticleQuality(
  article: MarketWebExtractedArticle,
  source: Row,
  config: Pick<MarketWebSourceRuntimeConfig, "maxResponseBytes" | "hardMaxResponseBytes">,
): MarketWebArticleQuality {
  const profile = resolveMarketWebSourceProfile(source, config);
  const bodyLength = cleanText(article.body).length;
  if (!cleanText(article.title || "")) {
    return { accepted: false, reason: "missing_title", bodyLength, extractionConfidence: article.extractionConfidence };
  }
  if (bodyLength < profile.minBodyChars) {
    return { accepted: false, reason: "body_too_short", bodyLength, extractionConfidence: article.extractionConfidence };
  }
  if (profile.requirePublishedAt && !article.publishedAt) {
    return { accepted: false, reason: "missing_published_at", bodyLength, extractionConfidence: article.extractionConfidence };
  }
  if (article.extractionConfidence < 0.5) {
    return { accepted: false, reason: "low_extraction_confidence", bodyLength, extractionConfidence: article.extractionConfidence };
  }
  return { accepted: true, reason: null, bodyLength, extractionConfidence: article.extractionConfidence };
}

export function classifyMarketWebFetchFailure(
  failure: unknown,
  consecutiveFailures = 1,
): MarketWebFailureClassification {
  const message = errorMessage(failure).toLowerCase();
  const httpMatch = message.match(/market_web_http_(\d{3})/);
  const httpStatus = httpMatch ? Number(httpMatch[1]) : null;
  const cappedBackoff = Math.min(6 * 60 * 60, 60 * 2 ** Math.max(0, consecutiveFailures - 1));
  if (httpStatus === 404 || /non_https_url_rejected|private_host_rejected|feed_payload_invalid/.test(message)) {
    return { code: httpStatus === 404 ? "market_web_http_404" : message, healthStatus: "invalid", terminal: true, retryAfterSeconds: 7 * 24 * 60 * 60, httpStatus };
  }
  if (httpStatus === 401 || httpStatus === 403 || /host_not_allowlisted/.test(message)) {
    return { code: httpStatus ? `market_web_http_${httpStatus}` : "market_web_host_not_allowlisted", healthStatus: "blocked", terminal: true, retryAfterSeconds: 24 * 60 * 60, httpStatus };
  }
  if (/response_too_large/.test(message)) {
    return { code: "market_web_response_too_large", healthStatus: "degraded", terminal: false, retryAfterSeconds: Math.max(60 * 60, cappedBackoff), httpStatus };
  }
  if (/aborted|aborterror|timeout|fetch failed|redirect_location_missing|redirect_limit_exceeded/.test(message)) {
    return { code: /redirect/.test(message) ? "market_web_redirect_failed" : "market_web_transient_fetch_failed", healthStatus: "degraded", terminal: false, retryAfterSeconds: cappedBackoff, httpStatus };
  }
  return { code: "market_web_fetch_failed", healthStatus: "degraded", terminal: false, retryAfterSeconds: cappedBackoff, httpStatus };
}

function validateSourceDocument(document: MarketWebFetchDocument, source: Row): void {
  const adapterType = text(source.adapter_type).toLowerCase();
  if (adapterType !== "rss" && adapterType !== "atom") return;
  const payload = document.body.trim().toLowerCase();
  const isRss = /<rss\b|<rdf:rdf\b/.test(payload);
  const isAtom = /<feed\b/.test(payload);
  if ((adapterType === "rss" && !isRss) || (adapterType === "atom" && !isAtom)) {
    throw new Error("market_web_feed_payload_invalid");
  }
}

function extractSemanticHtmlBody(html: string): string {
  const cleaned = removeChromeHtml(html);
  const blocks = ["article", "main"].flatMap((tag) => [...cleaned.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))]
    .map((match) => cleanText(stripHtml(match[1]))));
  return blocks.sort((left, right) => right.length - left.length)[0] || "";
}

function removeChromeHtml(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|header|footer|aside|form)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");
}

function extractHtmlMetadata(html: string): { title: string | null; publishedAt: string | null; canonicalUrl: string | null; imageUrls: string[] } {
  const tags = [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => parseHtmlAttributes(match[0]));
  const valueFor = (keys: string[]) => {
    const tag = tags.find((attributes) => keys.includes((attributes.property || attributes.name || "").toLowerCase()));
    return tag?.content ? cleanText(tag.content) : null;
  };
  const valuesFor = (keys: string[]) => tags
    .filter((attributes) => keys.includes((attributes.property || attributes.name || "").toLowerCase()))
    .map((attributes) => cleanText(attributes.content || ""))
    .filter(Boolean);
  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const canonicalTag = html.match(/<link\b[^>]*rel\s*=\s*(["'])canonical\1[^>]*href\s*=\s*(["'])(.*?)\2[^>]*>/i)?.[3]
    || html.match(/<link\b[^>]*href\s*=\s*(["'])(.*?)\1[^>]*rel\s*=\s*(["'])canonical\3[^>]*>/i)?.[2];
  return {
    title: valueFor(["og:title", "twitter:title"]) || cleanText(titleTag || "") || null,
    publishedAt: valueFor(["article:published_time", "date", "publishdate", "datepublished"]),
    canonicalUrl: canonicalTag ? decodeHtml(canonicalTag) : null,
    imageUrls: valuesFor(["og:image", "twitter:image"]),
  };
}

function extractJsonLdArticle(html: string): { title: string | null; body: string | null; publishedAt: string | null; imageUrls: string[] } {
  const entries: Row[] = [];
  const scriptPattern = /<script\b[^>]*type\s*=\s*(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    try {
      const parsed = JSON.parse(match[2]);
      entries.push(...flattenJsonLd(parsed));
    } catch {
      // Invalid JSON-LD is common in production pages; HTML extraction remains available.
    }
  }
  const article = entries.find((entry) => {
    const type = entry["@type"];
    return stringArray(type).some((value) => /article|newsarticle|report/i.test(value));
  }) || entries[0];
  if (!article) return { title: null, body: null, publishedAt: null, imageUrls: [] };
  return {
    title: nullableText(article.headline) || nullableText(article.name),
    body: nullableText(article.articleBody),
    publishedAt: nullableText(article.datePublished) || nullableText(article.dateModified),
    imageUrls: imageUrlsFromValue(article.image),
  };
}

function classifySignal(title: string, body: string, sourceTags: string[]): { level: "high" | "low"; reason: string; eventType: string } {
  const haystack = `${title}\n${body}`.toLowerCase();
  const highSignal = [
    ["earnings", "실적"], ["revenue", "매출"], ["guidance", "가이던스"], ["dividend", "배당"],
    ["share repurchase", "자사주"], ["acquisition", "인수"], ["merger", "합병"], ["sec filing", "공시"],
    ["investigation", "조사"], ["lawsuit", "소송"], ["recall", "리콜"], ["outage", "장애"],
    ["capacity", "생산능력"], ["capital expenditure", "capex"], ["contract", "계약"], ["guidance", "전망"],
  ];
  const matched = highSignal.find((terms) => terms.some((term) => haystack.includes(term)));
  if (matched) return { level: "high", reason: `keyword:${matched[0]}`, eventType: matched[0] };

  const lowSignal = ["webinar", "event", "award", "anniversary", "hiring", "채용", "행사", "웨비나", "수상", "기념"];
  const low = lowSignal.find((term) => haystack.includes(term));
  if (low) return { level: "low", reason: `keyword:${low}`, eventType: "low_signal" };
  return { level: sourceTags.includes("ir") ? "high" : "low", reason: sourceTags.includes("ir") ? "source_tag:ir" : "no_material_event_keyword", eventType: "unknown" };
}

function candidateMatchesSource(candidate: Candidate, source: Row): boolean {
  try {
    assertAllowedSourceUrl(candidate.url, source, "detail");
  } catch {
    return false;
  }
  const config = asRow(source.adapter_config) || {};
  const path = new URL(candidate.url).pathname;
  const includePattern = safeRegExp(nullableText(config.include_path_regex));
  const excludePattern = safeRegExp(nullableText(config.exclude_path_regex));
  return (!includePattern || includePattern.test(path)) && (!excludePattern || !excludePattern.test(path));
}

function assertAllowedSourceUrl(
  input: string,
  source: Row,
  purpose: MarketWebFetchPurpose = "discovery",
): string {
  const url = new URL(input);
  if (url.protocol !== "https:") throw new Error("market_web_non_https_url_rejected");
  const host = normalizeHost(url.hostname);
  if (isPrivateHost(host)) throw new Error("market_web_private_host_rejected");
  const allowedHosts = sourceAllowedHosts(source, purpose);
  if (allowedHosts.length === 0 || !allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) {
    throw new Error("market_web_host_not_allowlisted");
  }
  return url.toString();
}

function sourceAllowedHosts(source: Row, purpose: MarketWebFetchPurpose = "discovery"): string[] {
  const config = asRow(source.adapter_config) || {};
  const purposeHosts = purpose === "detail"
    ? stringArray(config.detail_allowed_hosts)
    : stringArray(config.discovery_allowed_hosts);
  return uniqueStrings([
    normalizeHost(text(source.canonical_host)),
    ...stringArray(config.allowed_hosts).map(normalizeHost),
    ...purposeHosts.map(normalizeHost),
  ]);
}

function sanitizeSourceImageUrls(values: string[], baseUrl: string, source: Row): string[] {
  return uniqueStrings(values.flatMap((value) => {
    try {
      return [normalizeCanonicalUrl(assertAllowedSourceUrl(new URL(value, baseUrl).toString(), source, "detail"))];
    } catch {
      return [];
    }
  }));
}

function imageUrlsFromValue(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(imageUrlsFromValue);
  const row = asRow(value);
  if (!row) return [];
  return [text(row.url), text(row.contentUrl), text(row.thumbnailUrl)].filter(Boolean);
}

async function readLimitedResponse(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("market_web_response_too_large");
    }
    chunks.push(value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(output);
}

function parseWebSourceSeeds(value: string | undefined): MarketWebSourceSeed[] {
  if (!value) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("market_issue_web_sources_invalid_json");
  }
  if (!Array.isArray(parsed)) throw new Error("market_issue_web_sources_must_be_array");
  return parsed.map((raw, index) => {
    const source = asRow(raw) || {};
    const sourceKey = text(source.sourceKey || source.source_key);
    const discoveryUrl = text(source.discoveryUrl || source.discovery_url);
    const canonicalHost = text(source.canonicalHost || source.canonical_host);
    const sourceType = text(source.sourceType || source.source_type, "web");
    const adapterType = text(source.adapterType || source.adapter_type) as MarketWebSourceSeed["adapterType"];
    if (
      !sourceKey
      || !discoveryUrl
      || !canonicalHost
      || !["web", "sec"].includes(sourceType)
      || !["rss", "atom", "json_feed", "sitemap", "html_list", "json_api", "sec_catalog"].includes(adapterType)
    ) {
      throw new Error(`market_issue_web_sources_invalid_entry:${index}`);
    }
    return {
      sourceKey,
      displayName: text(source.displayName || source.display_name, sourceKey),
      sourceType: sourceType as "web" | "sec",
      sourceClass: nullableText(source.sourceClass || source.source_class) || undefined,
      sourceTags: stringArray(source.sourceTags || source.source_tags),
      companyTickers: stringArray(source.companyTickers || source.company_tickers),
      adapterType,
      channelType: nullableText(source.channelType || source.channel_type) || undefined,
      discoveryUrl,
      canonicalHost,
      pollIntervalSeconds: numeric(source.pollIntervalSeconds || source.poll_interval_seconds),
      priority: numeric(source.priority),
      maxItemsPerPoll: numeric(source.maxItemsPerPoll || source.max_items_per_poll),
      requiresBrowser: source.requiresBrowser === true || source.requires_browser === true,
      adapterConfig: asRow(source.adapterConfig || source.adapter_config) || {},
      active: source.active !== false,
    };
  });
}

function makeCandidate(url: string, title: string | null, parsedDate: { value: string; inferred: boolean } | null, raw: Row): Candidate | null {
  if (!url) return null;
  try {
    return {
      url: normalizeCanonicalUrl(url),
      title: title ? cleanText(title) : null,
      publishedAt: parsedDate?.value || null,
      publishedAtIsInferred: parsedDate?.inferred || false,
      raw,
    };
  } catch {
    return null;
  }
}

function parsePublishedDate(value: unknown): { value: string; inferred: boolean } | null {
  const raw = text(value).trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return { value: date.toISOString(), inferred: false };
}

function xmlLink(value: unknown): string {
  if (typeof value === "string") return value;
  for (const item of asArray(value)) {
    const row = asRow(item) || {};
    if (text(row["@_href"])) return text(row["@_href"]);
    if (text(row["#text"])) return text(row["#text"]);
  }
  const row = asRow(value) || {};
  return text(row["@_href"]) || text(row["#text"]);
}

function valueAtPath(value: unknown, path: string): unknown {
  return path.split(".").filter(Boolean).reduce<unknown>((current, segment) => asRow(current)?.[segment], value);
}

function flattenJsonLd(value: unknown): Row[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  const row = asRow(value);
  if (!row) return [];
  return [row, ...flattenJsonLd(row["@graph"])];
}

function parseHtmlAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/g)) {
    attributes[match[1].toLowerCase()] = decodeHtml(match[3]);
  }
  return attributes;
}

function stripHtml(value: string): string {
  return decodeHtml(value
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " "));
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeText(value: string): string {
  return cleanText(value).toLowerCase();
}

function normalizeCanonicalUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function isPrivateHost(host: string): boolean {
  if (["localhost", "localhost.localdomain", "0.0.0.0", "::1"].includes(host)) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) {
    return parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168);
  }
  return /^(fc|fd|fe80)/i.test(host);
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const hash = hashText(candidate.url.toLowerCase());
    if (seen.has(hash)) return false;
    seen.add(hash);
    return true;
  });
}

function isJsonDocument(document: MarketWebFetchDocument, source: Row): boolean {
  return text(source.adapter_type) === "json_api"
    || document.contentType.includes("json")
    || /^[\s\n\r]*[\[{]/.test(document.body);
}

function safeRegExp(value: string | null): RegExp | null {
  if (!value) return null;
  try {
    return new RegExp(value, "i");
  } catch {
    return null;
  }
}

function containsKorean(value: string): boolean {
  return /[\uac00-\ud7a3]/.test(value);
}

function hashText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function numeric(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asRow(value: unknown): Row | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null;
}

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.map(asRow).filter((row): row is Row => row !== null) : [];
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : fallback;
}

function nullableText(value: unknown): string | null {
  const result = text(value).trim();
  return result || null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? uniqueStrings(value.map((entry) => text(entry)).filter(Boolean)) : typeof value === "string" ? [value] : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 1000) : text(error, "market_web_worker_error").slice(0, 1000);
}
