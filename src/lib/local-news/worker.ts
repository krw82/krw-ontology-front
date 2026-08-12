import type { SupabaseClient } from "@supabase/supabase-js";

import {
  localNewsMissingConfiguration,
  readLocalNewsRuntimeConfig,
  type LocalNewsRuntimeConfig,
} from "@/lib/local-news/config";
import {
  listLocalNewsCoverageTickers,
  type LocalNewsCoverageTicker,
} from "@/lib/local-news/coverage";
import { curateLocalNewsArticle } from "@/lib/local-news/curator";
import {
  FinnhubNewsProvider,
  FinnhubNewsProviderError,
  type LocalNewsArticle,
} from "@/lib/local-news/finnhub";
import { publishLocalNewsIssue } from "@/lib/local-news/publish";
import { LocalNewsRequestLimiter, type LocalNewsSleep } from "@/lib/local-news/rate-limit";
import { LOCAL_NEWS_CURATION_VERSION, LocalNewsVault } from "@/lib/local-news/vault";
import { fanoutVerifiedMarketIssueNotifications } from "@/lib/filing-notifications/market-issue";
import { getMarketIssueServiceClient } from "@/lib/market-issues/service";

type Db = SupabaseClient;

export type LocalNewsCycleResult = {
  skipped: boolean;
  reason?: string;
  coverageTickers: number;
  selectedTickers: number;
  fetched: number;
  reprocessed: number;
  accepted: number;
  published: number;
  review: number;
  rejected: number;
  failed: number;
  fetchFailures: number;
  fetchRateLimited: number;
  fetchTimeouts: number;
  fetchHttpFailures: number;
  fetchNetworkFailures: number;
  curationFailures: number;
  publishFailures: number;
  notificationsCreated: number;
  notificationFailures: number;
  vaultFailures: number;
};

export async function runLocalNewsCycle(input: {
  config?: LocalNewsRuntimeConfig;
  db?: Db;
  provider?: FinnhubNewsProvider;
  vault?: LocalNewsVault;
  coverage?: (db: Db, environment: LocalNewsRuntimeConfig["environment"]) => Promise<LocalNewsCoverageTicker[]>;
  curate?: typeof curateLocalNewsArticle;
  publish?: typeof publishLocalNewsIssue;
  fanoutMarketIssueNotifications?: typeof fanoutVerifiedMarketIssueNotifications;
  sleep?: LocalNewsSleep;
  now?: Date;
} = {}): Promise<LocalNewsCycleResult> {
  const config = input.config || readLocalNewsRuntimeConfig();
  const missing = localNewsMissingConfiguration(config);
  if (missing) return emptyResult({ skipped: true, reason: missing });

  const db = input.db || getMarketIssueServiceClient();
  const provider = input.provider || new FinnhubNewsProvider({ apiKey: config.finnhubApiKey! });
  const vault = input.vault || new LocalNewsVault({ path: config.vaultPath, key: config.vaultKey! });
  const coverage = input.coverage || listLocalNewsCoverageTickers;
  const curate = input.curate || curateLocalNewsArticle;
  const publish = input.publish || publishLocalNewsIssue;
  const fanoutMarketIssueNotifications = input.fanoutMarketIssueNotifications || fanoutVerifiedMarketIssueNotifications;
  const now = input.now || new Date();
  const from = new Date(now.getTime() - config.lookbackHours * 3_600_000);
  const result = emptyResult({ skipped: false });
  const articlesByHash = new Map<string, LocalNewsArticle>();
  const requestLimiter = new LocalNewsRequestLimiter({
    minimumIntervalMs: config.finnhubRequestIntervalMs,
    sleep: input.sleep,
  });
  let coverageTickers: LocalNewsCoverageTicker[];

  try {
    coverageTickers = await coverage(db, config.environment);
    result.coverageTickers = coverageTickers.length;
  } catch {
    result.failed += 1;
    return result;
  }

  const coverageBatch = await vault.selectCoverageBatch(coverageTickers, config.coverageBatchSize);
  result.selectedTickers = coverageBatch.length;
  try {
    for (const coverageTicker of coverageBatch) {
      const articles = await fetchTickerNews({
        provider,
        limiter: requestLimiter,
        result,
        ticker: coverageTicker.ticker,
        from,
        to: now,
        timeoutMs: config.finnhubTimeoutMs,
        maxItems: config.maxArticlesPerTicker,
      });
      if (!articles) continue;
      result.fetched += articles.length;
      for (const article of articles) {
        articlesByHash.set(article.contentHash, article);
      }
    }
  } finally {
    const lastTicker = coverageBatch.at(-1)?.ticker;
    if (lastTicker) {
      try {
        await vault.advanceCoverageCursor(lastTicker);
      } catch {
        recordFailure(result, "vault");
      }
    }
  }

  let replayArticles: LocalNewsArticle[];
  try {
    replayArticles = await vault.articlesNeedingCuration();
  } catch {
    recordFailure(result, "vault");
    return result;
  }
  for (const article of replayArticles) {
    if (articlesByHash.has(article.contentHash)) continue;
    articlesByHash.set(article.contentHash, article);
    result.reprocessed += 1;
  }

  for (const article of articlesByHash.values()) {
    let reservation;
    try {
      reservation = await vault.reserve(article);
    } catch {
      recordFailure(result, "vault");
      continue;
    }
    if ((reservation.status === "published" || reservation.status === "rejected")
      && reservation.curationVersion === LOCAL_NEWS_CURATION_VERSION) continue;

    let curated;
    try {
      curated = await curate({ article, config });
    } catch {
      recordFailure(result, "curation");
      continue;
    }
    if (curated.status === "rejected") {
      try {
        await vault.markRejected(article.contentHash, curated.reason);
        result.rejected += 1;
      } catch {
        recordFailure(result, "vault");
      }
      continue;
    }
    let marketIssueId: string;
    try {
      marketIssueId = await publish({
        db,
        environment: config.environment,
        eventKey: reservation.publicEventKey,
        ticker: article.ticker,
        issue: curated.issue,
        publishMode: config.publishMode,
        original: { headline: article.headline, summary: article.summary },
      });
    } catch {
      recordFailure(result, "publish");
      continue;
    }
    if (config.marketIssueNotificationsEnabled && config.publishMode === "publish") {
      try {
        result.notificationsCreated += await fanoutMarketIssueNotifications({
          db,
          environment: config.environment,
          marketIssueId,
          now,
        });
      } catch {
        // News publication is durable and must not be rolled back merely
        // because optional personal fanout telemetry needs operator review.
        result.notificationFailures += 1;
      }
    }
    const evidence = curated.issue.claims.map((claim) => ({
      claimKo: claim.textKo,
      sourceQuote: claim.sourceQuote,
    }));
    try {
      if (config.publishMode === "publish") await vault.markPublished({ contentHash: article.contentHash, evidence });
      else await vault.markReviewed({ contentHash: article.contentHash, evidence });
      result.accepted += 1;
      if (config.publishMode === "publish") result.published += 1;
      else result.review += 1;
    } catch {
      recordFailure(result, "vault");
    }
  }
  return result;
}

async function fetchTickerNews(input: {
  provider: FinnhubNewsProvider;
  limiter: LocalNewsRequestLimiter;
  result: LocalNewsCycleResult;
  ticker: string;
  from: Date;
  to: Date;
  timeoutMs: number;
  maxItems: number;
}): Promise<LocalNewsArticle[] | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await input.limiter.acquire();
    try {
      return await input.provider.fetchCompanyNews({
        ticker: input.ticker,
        from: input.from,
        to: input.to,
        timeoutMs: input.timeoutMs,
        maxItems: input.maxItems,
      });
    } catch (error) {
      if (error instanceof FinnhubNewsProviderError && error.kind === "rate_limited" && attempt === 0) {
        input.result.fetchRateLimited += 1;
        input.limiter.defer(error.retryAfterMs ?? 60_000);
        continue;
      }
      recordFetchFailure(input.result, error);
      return null;
    }
  }
  return null;
}

function recordFetchFailure(result: LocalNewsCycleResult, error: unknown): void {
  result.failed += 1;
  result.fetchFailures += 1;
  if (!(error instanceof FinnhubNewsProviderError)) return;
  if (error.kind === "rate_limited") result.fetchRateLimited += 1;
  else if (error.kind === "timeout") result.fetchTimeouts += 1;
  else if (error.kind === "http") result.fetchHttpFailures += 1;
  else if (error.kind === "network") result.fetchNetworkFailures += 1;
}

function recordFailure(
  result: LocalNewsCycleResult,
  stage: "curation" | "publish" | "vault",
): void {
  result.failed += 1;
  if (stage === "curation") result.curationFailures += 1;
  else if (stage === "publish") result.publishFailures += 1;
  else result.vaultFailures += 1;
}

function emptyResult(input: Pick<LocalNewsCycleResult, "skipped"> & Partial<Pick<LocalNewsCycleResult, "reason">>): LocalNewsCycleResult {
  return {
    skipped: input.skipped,
    ...(input.reason ? { reason: input.reason } : {}),
    coverageTickers: 0,
    selectedTickers: 0,
    fetched: 0,
    reprocessed: 0,
    accepted: 0,
    published: 0,
    review: 0,
    rejected: 0,
    failed: 0,
    fetchFailures: 0,
    fetchRateLimited: 0,
    fetchTimeouts: 0,
    fetchHttpFailures: 0,
    fetchNetworkFailures: 0,
    curationFailures: 0,
    publishFailures: 0,
    notificationsCreated: 0,
    notificationFailures: 0,
    vaultFailures: 0,
  };
}
