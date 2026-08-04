import "server-only";

import { Client } from "@xdevplatform/xdk";
import {
  marketIssueEnvironment,
  readMarketIssueRuntimeConfig,
  type MarketIssueRuntimeConfig,
  type MarketIssueSourceSeed,
} from "@/lib/market-issues/config";
import { getMarketIssueServiceClient } from "@/lib/market-issues/service";
import {
  asRow,
  asRows,
  createOrUpdateIssueForItem,
  getWorkerSettings,
  hashText,
  normalizeUrlForCorrelation,
  persistSourceItem,
  persistSourceMedia,
  syncMarketIssueSources,
  text,
  updateWorkerSettings,
  type Db,
  type Row,
  type XTweet,
} from "@/lib/market-issues/worker";

// re-exported so the entrypoint can import a single module
export { readMarketIssueRuntimeConfig, type MarketIssueRuntimeConfig };

const RULE_REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
// backfill_minutes is only available on Enterprise/replay-enabled tiers; the
// pay-per-use filtered stream rejects it with HTTP 400. Keep 0 = omit.
const STREAM_BACKFILL_MINUTES = 0;

// Accounts whose full firehose would drown the budget get a keyword filter so
// only market-moving statements are billed. Plain macro/commentary accounts
// have no filter (their full output is the signal).
const KEYWORD_FILTERS: Record<string, string> = {
  realDonaldTrump: "Powell OR Fed OR tariff OR rates OR economy OR interest OR inflation OR jobs",
};

type StreamEvent = {
  data: any;
  includes?: any;
  matching_rules?: Array<{ id?: string; tag?: string }>;
};

/**
 * Build the filtered-stream rule value for a seed. Most accounts get a plain
 * `from:<handle> -is:retweet`. Accounts listed in KEYWORD_FILTERS get an
 * additional keyword clause so only market-relevant posts are delivered (and
 * billed). The handle is used as the rule `tag` so we can resolve the source
 * row when a tweet arrives.
 */
function buildRuleValue(seed: MarketIssueSourceSeed): string {
  const base = `from:${seed.accountHandle} -is:retweet`;
  const keywords = KEYWORD_FILTERS[seed.accountHandle];
  return keywords ? `(${base}) (${keywords})` : base;
}

/**
 * Synchronize the X filtered-stream rule set with the configured source seeds.
 * Fetches the current rules, deletes any that are stale, and adds any that are
 * missing. Idempotent: if the rule set already matches, only a getRules call is
 * made. Throws on API errors so the caller can record them.
 */
async function syncStreamRules(
  client: Client,
  config: MarketIssueRuntimeConfig,
): Promise<{ added: number; deleted: number; total: number }> {
  const desired = config.sourceSeeds.map((seed) => ({
    value: buildRuleValue(seed),
    tag: seed.accountHandle,
  }));
  const desiredValues = new Set(desired.map((r) => r.value));

  const existing = await client.stream.getRules();
  const existingRules = asRows((existing as Row)?.data);
  const toDelete = existingRules
    .map((r) => text(r.id))
    .filter(Boolean);
  const staleIds = existingRules
    .filter((r) => !desiredValues.has(text(r.value)))
    .map((r) => text(r.id))
    .filter(Boolean);

  // Only delete rules that are stale or no longer in the desired set. If the
  // rule set is already correct, skip the delete+add round-trip.
  if (staleIds.length > 0) {
    await client.stream.updateRules(
      { delete: { ids: staleIds } },
    );
  }

  // Add rules that don't already exist (by value).
  const existingValues = new Set(existingRules.map((r) => text(r.value)));
  const toAdd = desired.filter((r) => !existingValues.has(r.value));
  if (toAdd.length > 0) {
    const res = await client.stream.updateRules({ add: toAdd });
    const created = asRows((res as Row)?.data);
    if (created.length === 0 && toAdd.length > 0) {
      throw new Error("stream_rule_sync_failed");
    }
  }

  return {
    added: toAdd.length,
    deleted: staleIds.length,
    total: desired.length,
  };
}

/**
 * Convert a streamed post payload (data + includes) into the XTweet shape used
 * by the shared persistence pipeline. Mirrors the mapping in worker.ts's
 * fetchRecentTweets so downstream code is identical.
 */
function mapStreamPost(data: any, includes: any): XTweet {
  const mediaByKey = new Map<string, Row>();
  for (const media of asRows(includes?.media)) {
    const key = text(media.media_key);
    if (key) mediaByKey.set(key, media);
  }

  const relatedUrls: string[] = [];
  for (const url of asRows((data as Row)?.entities?.urls)) {
    const resolved = text(url.unwound_url || url.unwoundUrl || url.expanded_url || url.expandedUrl || url.url);
    if (resolved) relatedUrls.push(resolved);
  }

  // attachments.media_keys may be a string[] or an array of objects; normalize.
  const rawMediaKeys: unknown[] = Array.isArray((data as Row)?.attachments?.media_keys)
    ? (data as Row).attachments.media_keys
    : [];
  const mediaKeys: string[] = rawMediaKeys
    .map((k) => text(typeof k === "string" ? k : (k as Row)?.media_key))
    .filter(Boolean);

  const media = mediaKeys
    .map((key: string) => mediaByKey.get(key))
    .filter((m): m is Row => Boolean(m))
    .map((m: Row) => ({
      media_key: text(m.media_key),
      media_type: text(m.type),
      media_url: text(m.url || m.preview_image_url) || null,
      alt_text: text(m.alt_text) || null,
      width: Number(m.width) || null,
      height: Number(m.height) || null,
    }));

  const metrics = (data as Row)?.public_metrics || (data as Row)?.publicMetrics;
  return {
    id: text((data as Row)?.id),
    text: text((data as Row)?.text),
    created_at: text((data as Row)?.created_at || (data as Row)?.createdAt) || undefined,
    lang: text((data as Row)?.lang) || undefined,
    public_metrics: metrics as Record<string, number> | undefined,
    related_urls: [...new Set(relatedUrls)],
    media,
  };
}

/**
 * Resolve the source row from the rule tag (handle). Cached per-cycle for
 * efficiency since many events can share a source. Returns null if the source
 * is missing, inactive, or not an X source — in which case the event is
 * dropped (the rule may exist from a previous config).
 */
async function resolveSourceByHandle(
  db: Db,
  cache: Map<string, Row | null>,
  env: string,
  handle: string,
): Promise<Row | null> {
  const cached = cache.get(handle);
  if (cached !== undefined) return cached;
  const { data, error } = await db
    .from("market_issue_sources")
    .select("*")
    .eq("env", env)
    .eq("source_type", "x")
    .eq("source_key", handle)
    .maybeSingle();
  if (error) throw error;
  const row = asRow(data);
  const result = row && row.active ? row : null;
  cache.set(handle, result);
  return result;
}

/**
 * Process a single stream event: resolve the source, persist the item, and run
 * the shared downstream pipeline (media, issue creation/correlation,
 * enrichment enqueue). Mirrors ingestSource's per-tweet loop.
 */
async function handleStreamEvent(
  db: Db,
  config: MarketIssueRuntimeConfig,
  settings: Row,
  sourceCache: Map<string, Row | null>,
  event: StreamEvent,
): Promise<boolean> {
  const tag = text(event.matching_rules?.[0]?.tag);
  if (!tag) return false;

  const source = await resolveSourceByHandle(db, sourceCache, config.environment, tag);
  if (!source) return false;

  const tweet = mapStreamPost(event.data, event.includes);
  if (!tweet.id || !tweet.text) return false;

  const sourceItem = await persistSourceItem(db, source, tweet, config.environment);
  if (!sourceItem) return false;
  await persistSourceMedia(db, sourceItem, tweet, config.environment);
  await createOrUpdateIssueForItem(db, { source, tweet, sourceItem, config, settings });
  return true;
}

/**
 * Run the filtered-stream ingestion loop. This is a long-lived call: it opens
 * a persistent connection to X and yields control for each matching tweet.
 * Returns when the stream closes and cannot be reconnected, or when the
 * caller signals stop via the abort signal.
 *
 * Lifecycle:
 * 1. Gate on ingestion_enabled + bearer token (same as the poll worker).
 * 2. Sync seed source rows into market_issue_sources.
 * 3. Sync filtered-stream rules (add new, delete stale).
 * 4. Open the stream with backfillMinutes=5 to cover reconnect gaps.
 * 5. Iterate events, persisting each via the shared pipeline.
 * 6. A periodic rule-refresh interval keeps rules in sync with config changes.
 * 7. Heartbeat watchdog: if no keep-alive for 90s, close and let the caller reconnect.
 */
export async function runMarketIssueStreamCycle(input: {
  signal?: AbortSignal;
  onHeartbeat?: () => void;
}): Promise<{ skipped: boolean; reason?: string; processed: number }> {
  const config = readMarketIssueRuntimeConfig();
  const db = getMarketIssueServiceClient();

  const settings = await getWorkerSettings(db);
  if (!settings.ingestion_enabled) {
    return { skipped: true, reason: "ingestion_disabled", processed: 0 };
  }
  if (!config.xBearerToken) {
    await updateWorkerSettings(db, {
      last_error: "MARKET_ISSUE_X_BEARER_TOKEN is not configured",
      last_error_at: new Date().toISOString(),
      last_ingestion_at: new Date().toISOString(),
    });
    return { skipped: true, reason: "x_credentials_missing", processed: 0 };
  }

  // Seed source rows so events can be resolved to a source.
  await syncMarketIssueSources(db, config);

  const client = new Client({
    baseUrl: config.xApiBaseUrl,
    bearerToken: config.xBearerToken,
  });

  const ruleResult = await syncStreamRules(client, config);
  await updateWorkerSettings(db, {
    last_ingestion_at: new Date().toISOString(),
    last_error: null,
  });

  // Periodic rule refresh: keeps the rule set in sync with config.sourceSeeds
  // without restarting the worker. Errors are logged but don't kill the stream.
  const ruleRefreshTimer = setInterval(() => {
    void syncStreamRules(client, config).catch((err) => {
      console.warn(JSON.stringify({
        worker: config.workerId,
        kind: "market_issue_stream_rule_refresh_failed",
        error: String(err?.message || err),
      }));
    });
  }, RULE_REFRESH_INTERVAL_MS);

  // Note: the XDK (v0.6.6) does not emit a "keepAlive" event for X's bare
  // newline heartbeat (processChunk skips empty lines before isKeepAlive runs),
  // so a heartbeat-timeout watchdog would only produce noise. The underlying
  // fetch Response.body stays open and the async iterator yields as soon as a
  // real tweet arrives; the outer reconnect loop in the entrypoint handles
  // genuine disconnects. We still track lastActivity for diagnostic logging.
  let lastActivity = Date.now();

  let processed = 0;
  const sourceCache = new Map<string, Row | null>();

  try {
    const streamOptions: Record<string, unknown> = {
      tweetFields: ["created_at", "lang", "public_metrics", "attachments", "entities"],
      expansions: ["attachments.media_keys"],
      mediaFields: ["media_key", "type", "url", "preview_image_url", "alt_text", "width", "height"],
    };
    if (STREAM_BACKFILL_MINUTES > 0) {
      streamOptions.backfillMinutes = STREAM_BACKFILL_MINUTES;
    }
    const stream = await client.stream.posts(streamOptions);

    stream.on("keepAlive", () => {
      lastActivity = Date.now();
    });
    stream.on("error", (err: unknown) => {
      console.error(JSON.stringify({
        worker: config.workerId,
        kind: "market_issue_stream_error",
        error: String((err as Error)?.message || err),
      }));
    });

    for await (const event of stream as AsyncIterable<StreamEvent>) {
      if (input.signal?.aborted) {
        stream.close();
        break;
      }
      lastActivity = Date.now();
      try {
        const handled = await handleStreamEvent(db, config, settings, sourceCache, event);
        if (handled) processed += 1;
      } catch (err) {
        console.error(JSON.stringify({
          worker: config.workerId,
          kind: "market_issue_stream_event_failed",
          tag: text(event.matching_rules?.[0]?.tag),
          tweet_id: text(event.data?.id),
          error: String((err as Error)?.message || err),
        }));
      }
    }
  } finally {
    clearInterval(ruleRefreshTimer);
    await updateWorkerSettings(db, {
      last_successful_ingestion_at: new Date().toISOString(),
      last_ingestion_at: new Date().toISOString(),
      last_error: null,
    });
  }

  console.log(JSON.stringify({
    worker: config.workerId,
    kind: "market_issue_stream_cycle_completed",
    processed,
    rules: ruleResult.total,
  }));

  return { skipped: false, processed };
}

// Re-export helpers that the entrypoint or tests may want.
export { syncStreamRules, mapStreamPost };
