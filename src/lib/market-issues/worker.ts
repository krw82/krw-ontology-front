import "server-only";

import { createHash } from "node:crypto";
import { Client } from "@xdevplatform/xdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildReviewOnlyDraft,
  parseMarketIssueGeneratedBrief,
  type MarketIssueGeneratedBrief,
} from "@/lib/market-issues/guardrails";
import {
  marketIssueEnvironment,
  readMarketIssueRuntimeConfig,
  type MarketIssueRuntimeConfig,
} from "@/lib/market-issues/config";
import { getMarketIssueServiceClient } from "@/lib/market-issues/service";

type Db = SupabaseClient<any>;
type Row = Record<string, any>;

type XTweet = {
  id: string;
  text: string;
  created_at?: string;
  lang?: string;
  public_metrics?: Record<string, number>;
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

function hashText(value: string): string {
  return createHash("sha256").update(value.replace(/\s+/g, " ").trim()).digest("hex");
}

function officialSource(sourceClass: string): boolean {
  return ["government", "regulator", "company_official", "exchange"].includes(sourceClass);
}

function scoreTweet(tweet: XTweet): number {
  const metrics = tweet.public_metrics || {};
  const engagement = Number(metrics.like_count || 0)
    + Number(metrics.retweet_count || 0) * 2
    + Number(metrics.reply_count || 0)
    + Number(metrics.quote_count || 0) * 2;
  return Math.max(0, Math.min(10000, 1 + engagement));
}

export async function runMarketIssueIngestionCycle(): Promise<{
  skipped: boolean;
  processed: number;
  reason?: string;
}> {
  const config = readMarketIssueRuntimeConfig();
  const db = getMarketIssueServiceClient();
  await syncMarketIssueSources(db, config);
  const settings = await getWorkerSettings(db);

  if (!settings.ingestion_enabled) {
    return { skipped: true, processed: 0, reason: "ingestion_disabled" };
  }
  if (!config.xBearerToken) {
    await updateWorkerSettings(db, {
      last_error: "MARKET_ISSUE_X_BEARER_TOKEN is not configured",
      last_error_at: new Date().toISOString(),
      last_ingestion_at: new Date().toISOString(),
    });
    return { skipped: true, processed: 0, reason: "x_credentials_missing" };
  }

  const { data: sources, error } = await db
    .from("market_issue_sources")
    .select("*")
    .eq("env", config.environment)
    .eq("active", true)
    .order("source_class")
    .limit(60);
  if (error) throw error;

  let processed = 0;
  const failures: string[] = [];
  for (const source of asRows(sources)) {
    try {
      processed += await ingestSource(db, source, config, settings);
    } catch (ingestionError) {
      const message = ingestionError instanceof Error
        ? ingestionError.message
        : "unknown source ingestion failure";
      failures.push((text(source.account_handle) + ": " + message).slice(0, 500));
      await db
        .from("market_issue_sources")
        .update({ last_error: message.slice(0, 500), updated_at: new Date().toISOString() })
        .eq("id", source.id);
    }
  }

  const now = new Date().toISOString();
  await updateWorkerSettings(db, failures.length > 0
    ? {
      last_ingestion_at: now,
      last_error: failures.join(" | ").slice(0, 1000),
      last_error_at: now,
    }
    : {
      last_ingestion_at: now,
      last_successful_ingestion_at: now,
      last_error: null,
      last_error_at: null,
    });
  return { skipped: false, processed };
}

async function syncMarketIssueSources(db: Db, config: MarketIssueRuntimeConfig): Promise<void> {
  if (config.sourceSeeds.length === 0) return;
  const rows = config.sourceSeeds.map((seed) => ({
    env: config.environment,
    source_type: "x",
    account_handle: seed.accountHandle,
    display_name: seed.displayName,
    source_class: seed.sourceClass,
    source_tags: seed.sourceTags,
    allow_single_source_publish: seed.allowSingleSourcePublish,
    active: true,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await db
    .from("market_issue_sources")
    .upsert(rows, { onConflict: "env,source_type,account_handle" });
  if (error) throw error;
}

async function getWorkerSettings(db: Db): Promise<Row> {
  const { data, error } = await db
    .from("market_issue_settings")
    .select("*")
    .eq("env", marketIssueEnvironment())
    .maybeSingle();
  if (error) throw error;
  return asRow(data) || {};
}

async function updateWorkerSettings(db: Db, update: Row): Promise<void> {
  const { error } = await db
    .from("market_issue_settings")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("env", marketIssueEnvironment());
  if (error) throw error;
}

async function ingestSource(
  db: Db,
  source: Row,
  config: MarketIssueRuntimeConfig,
  settings: Row,
): Promise<number> {
  const { data: cursor } = await db
    .from("market_issue_ingestion_cursors")
    .select("*")
    .eq("env", config.environment)
    .eq("source_id", source.id)
    .maybeSingle();
  const cursorRow = asRow(cursor);
  const tweets = await fetchRecentTweets({
    source,
    config,
    sinceId: text(cursorRow?.cursor_value) || null,
  });

  let newestId = text(cursorRow?.cursor_value) || null;
  let processed = 0;
  for (const tweet of tweets) {
    const sourceItem = await persistSourceItem(db, source, tweet, config.environment);
    if (!sourceItem) continue;
    processed += 1;
    await createOrUpdateIssueForItem(db, {
      source,
      tweet,
      sourceItem,
      config,
      settings,
    });
    newestId = newestId || tweet.id;
  }

  const now = new Date().toISOString();
  const { error: cursorError } = await db
    .from("market_issue_ingestion_cursors")
    .upsert({
      env: config.environment,
      source_id: source.id,
      cursor_value: newestId,
      last_successful_at: now,
      last_error: null,
      updated_at: now,
    }, { onConflict: "env,source_id" });
  if (cursorError) throw cursorError;
  await db
    .from("market_issue_sources")
    .update({ last_collected_at: now, last_error: null, updated_at: now })
    .eq("id", source.id);
  return processed;
}

async function fetchRecentTweets(input: {
  source: Row;
  config: MarketIssueRuntimeConfig;
  sinceId: string | null;
}): Promise<XTweet[]> {
  const client = new Client({
    baseUrl: input.config.xApiBaseUrl,
    bearerToken: input.config.xBearerToken,
  });
  const payload = await client.posts.searchRecent(
    "from:" + text(input.source.account_handle) + " -is:retweet",
    {
      maxResults: input.config.maxPostsPerSource,
      ...(input.sinceId ? { sinceId: input.sinceId } : {}),
      postFields: ["created_at", "lang", "public_metrics"],
    },
  );
  return (payload.data || [])
    .map((post): XTweet | null => {
      const id = text(post.id);
      const body = text(post.text);
      return id && body
        ? {
          id,
          text: body,
          created_at: text(post.createdAt) || undefined,
          lang: text(post.lang) || undefined,
          public_metrics: post.publicMetrics
            ? {
              like_count: post.publicMetrics.likeCount,
              retweet_count: post.publicMetrics.repostCount,
              reply_count: post.publicMetrics.replyCount,
              quote_count: post.publicMetrics.quoteCount,
            }
            : undefined,
        }
        : null;
    })
    .filter((tweet): tweet is XTweet => tweet !== null);
}

async function persistSourceItem(
  db: Db,
  source: Row,
  tweet: XTweet,
  env: string,
): Promise<Row | null> {
  const row = {
    env,
    source_id: source.id,
    external_item_id: tweet.id,
    canonical_url: "https://x.com/" + text(source.account_handle) + "/status/" + tweet.id,
    original_text: tweet.text,
    language: tweet.lang || null,
    normalized_text_hash: hashText(tweet.text),
    public_metrics: tweet.public_metrics || {},
    source_metadata: {
      source_handle: text(source.account_handle),
      source_display_name: text(source.display_name),
    },
    published_at: tweet.created_at || new Date().toISOString(),
    status: "active",
  };
  const { data, error } = await db
    .from("market_source_items")
    .upsert(row, { onConflict: "env,source_id,external_item_id" })
    .select("*")
    .single();
  if (error) throw error;
  return asRow(data);
}

async function createOrUpdateIssueForItem(
  db: Db,
  input: {
    source: Row;
    tweet: XTweet;
    sourceItem: Row;
    config: MarketIssueRuntimeConfig;
    settings: Row;
  },
): Promise<void> {
  const brief = await summarizeSourceItem(input.config, input.source, input.tweet);
  if (!brief) return;

  const env = input.config.environment;
  const { data: existing, error: existingError } = await db
    .from("market_issues")
    .select("*")
    .eq("env", env)
    .eq("event_key", brief.eventKey)
    .maybeSingle();
  if (existingError) throw existingError;
  const existingIssue = asRow(existing);
  const requiresManualReview = brief.riskLevel === "high"
    || input.settings.manual_review_required !== false;
  const sourceCount = Math.max(1, Number(existingIssue?.source_count || 0) + 1);
  const labels = new Set(brief.statusLabels);
  if (input.source.source_class === "company_official") labels.add("회사 발표");
  if (sourceCount > 1) {
    labels.delete("단독 보도");
    labels.add("복수 보도");
  } else if (!labels.has("회사 발표")) {
    labels.add("단독 보도");
  }

  const now = new Date().toISOString();
  let belowDailyPublishLimit = true;
  if (existingIssue?.state !== "published") {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const { count, error: publishedCountError } = await db
      .from("market_issues")
      .select("*", { count: "exact", head: true })
      .eq("env", env)
      .eq("state", "published")
      .gte("published_at", todayStart.toISOString());
    if (publishedCountError) throw publishedCountError;
    belowDailyPublishLimit = (count || 0) < Number(input.settings.max_published_per_day || 20);
  }
  const canPublish = input.settings.feed_enabled === true
    && !requiresManualReview
    && brief.riskLevel === "low"
    && belowDailyPublishLimit
    && (sourceCount > 1 || input.source.allow_single_source_publish === true);
  const nextState = existingIssue?.state === "published"
    ? "published"
    : canPublish
      ? "published"
      : "review";
  const sourceSummary = {
    total: sourceCount,
    official: officialSource(text(input.source.source_class)) ? sourceCount : 0,
    independent: officialSource(text(input.source.source_class)) ? 0 : sourceCount,
    source_classes: [text(input.source.source_class)],
  };
  const update = {
    env,
    event_key: brief.eventKey,
    state: nextState,
    summary_status: "ready",
    title_ko: brief.titleKo,
    summary_ko: brief.summaryKo,
    impact_path: brief.impactPath,
    confirmed_facts: brief.confirmedFacts,
    unconfirmed_facts: brief.unconfirmedFacts,
    status_labels: [...labels].slice(0, 3),
    source_summary: sourceSummary,
    source_count: sourceCount,
    market_score: Math.max(Number(existingIssue?.market_score || 0), scoreTweet(input.tweet)),
    risk_level: brief.riskLevel,
    requires_manual_review: requiresManualReview,
    update_count: existingIssue ? Number(existingIssue.update_count || 0) + 1 : 0,
    first_observed_at: existingIssue?.first_observed_at || now,
    published_at: nextState === "published" ? existingIssue?.published_at || now : existingIssue?.published_at || null,
    last_published_at: nextState === "published" ? now : existingIssue?.last_published_at || null,
    updated_at: now,
  };
  const { data: issueData, error: issueError } = await db
    .from("market_issues")
    .upsert(update, { onConflict: "env,event_key" })
    .select("*")
    .single();
  if (issueError) throw issueError;
  const issue = asRow(issueData);
  if (!issue) throw new Error("market_issue_upsert_empty");

  const { error: linkError } = await db
    .from("market_issue_items")
    .upsert({
      issue_id: issue.id,
      source_item_id: input.sourceItem.id,
    }, { onConflict: "issue_id,source_item_id" });
  if (linkError) throw linkError;

  if (brief.entities.length > 0) {
    const { error: clearEntitiesError } = await db
      .from("market_issue_entities")
      .delete()
      .eq("issue_id", issue.id);
    if (clearEntitiesError) throw clearEntitiesError;
    const { error: entityError } = await db
      .from("market_issue_entities")
      .insert(
        brief.entities.map((entity) => ({
          issue_id: issue.id,
          entity_type: entity.type,
          ticker: entity.ticker,
          entity_name: entity.name,
          relationship: entity.relationship,
          relationship_reason: entity.relationshipReason,
          confidence: entity.confidence,
        })),
      );
    if (entityError) throw entityError;
  }
  await db
    .from("market_issue_rank_snapshots")
    .insert({
      env,
      issue_id: issue.id,
      market_score: update.market_score,
    });
}

async function summarizeSourceItem(
  config: MarketIssueRuntimeConfig,
  source: Row,
  tweet: XTweet,
): Promise<MarketIssueGeneratedBrief | null> {
  if (!config.summarizerUrl) {
    return buildReviewOnlyDraft({
      eventKey: "x:" + text(source.account_handle) + ":" + tweet.id,
      displayName: text(source.display_name, text(source.account_handle)),
      originalText: tweet.text,
      sourceTags: Array.isArray(source.source_tags) ? source.source_tags : [],
    });
  }

  const response = await fetch(config.summarizerUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.summarizerToken
        ? { Authorization: "Bearer " + config.summarizerToken }
        : {}),
    },
    body: JSON.stringify({
      schema: "market_issue_brief_v1",
      source: {
        platform: "x",
        handle: text(source.account_handle),
        display_name: text(source.display_name),
        source_class: text(source.source_class),
      },
      original_text: tweet.text,
      published_at: tweet.created_at || null,
    }),
  });
  if (!response.ok) throw new Error("market_issue_summarizer_failed_" + response.status);
  const payload = await response.json() as unknown;
  const record = asRow(payload);
  return parseMarketIssueGeneratedBrief(record?.brief || payload);
}
