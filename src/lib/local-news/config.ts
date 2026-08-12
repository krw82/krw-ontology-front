import { homedir } from "node:os";
import { join } from "node:path";

import { marketIssueEnvironment, type MarketIssueEnvironment } from "@/lib/market-issues/config";

export type LocalNewsPublishMode = "review" | "publish";

export type LocalNewsRuntimeConfig = {
  enabled: boolean;
  environment: MarketIssueEnvironment;
  workerId: string;
  intervalMs: number;
  coverageBatchSize: number;
  maxArticlesPerTicker: number;
  lookbackHours: number;
  finnhubTimeoutMs: number;
  finnhubRequestIntervalMs: number;
  finnhubApiKey: string | null;
  zaiApiKey: string | null;
  zaiBaseUrl: string;
  zaiModel: string;
  zaiTimeoutMs: number;
  zaiMaxTokens: number;
  vaultPath: string;
  vaultKey: string | null;
  publishMode: LocalNewsPublishMode;
  marketIssueNotificationsEnabled: boolean;
};

export function readLocalNewsRuntimeConfig(
  env: Record<string, string | undefined> = process.env,
): LocalNewsRuntimeConfig {
  return {
    enabled: readBoolean(env.LOCAL_NEWS_ENABLED),
    environment: marketIssueEnvironment(),
    workerId: text(env.LOCAL_NEWS_WORKER_ID) || "local-finnhub-news-worker",
    intervalMs: boundedInt(env.LOCAL_NEWS_INTERVAL_MS, 900_000, 60_000, 86_400_000),
    coverageBatchSize: boundedInt(env.LOCAL_NEWS_COVERAGE_BATCH_SIZE, 45, 1, 50),
    maxArticlesPerTicker: boundedInt(env.LOCAL_NEWS_MAX_ARTICLES_PER_TICKER, 4, 1, 25),
    lookbackHours: boundedInt(env.LOCAL_NEWS_LOOKBACK_HOURS, 3, 1, 168),
    finnhubTimeoutMs: boundedInt(env.LOCAL_NEWS_FINNHUB_TIMEOUT_MS, 15_000, 2_000, 60_000),
    // Finnhub currently advertises a 60 requests/minute limit for this key.
    // 1.25 seconds keeps one local worker below that ceiling without bursts.
    finnhubRequestIntervalMs: boundedInt(env.LOCAL_NEWS_FINNHUB_REQUEST_INTERVAL_MS, 1_250, 250, 60_000),
    finnhubApiKey: text(env.FINNHUB_API_KEY),
    zaiApiKey: text(env.LOCAL_NEWS_ZAI_API_KEY)
      || text(env.MARKET_ISSUE_ZAI_API_KEY)
      || text(env.ZAI_API_KEY),
    zaiBaseUrl: (text(env.LOCAL_NEWS_ZAI_BASE_URL)
      || "https://api.z.ai/api/coding/paas/v4").replace(/\/+$/, ""),
    zaiModel: text(env.LOCAL_NEWS_ZAI_MODEL) || "glm-5.1",
    zaiTimeoutMs: boundedInt(env.LOCAL_NEWS_ZAI_TIMEOUT_MS, 120_000, 10_000, 300_000),
    zaiMaxTokens: boundedInt(env.LOCAL_NEWS_ZAI_MAX_TOKENS, 2_048, 512, 8_192),
    vaultPath: text(env.LOCAL_NEWS_VAULT_PATH)
      || join(homedir(), ".krw-ontology", "local-news-vault.enc"),
    vaultKey: text(env.LOCAL_NEWS_VAULT_KEY),
    publishMode: text(env.LOCAL_NEWS_PUBLISH_MODE)?.toLowerCase() === "publish"
      ? "publish"
      : "review",
    marketIssueNotificationsEnabled: readBoolean(
      env.LOCAL_NEWS_NOTIFICATION_CREATION_ENABLED
      ?? env.FILING_NOTIFICATION_CREATION_ENABLED,
    ),
  };
}

export function localNewsMissingConfiguration(
  config: LocalNewsRuntimeConfig,
): string | null {
  if (!config.enabled) return "local_news_disabled";
  if (!config.finnhubApiKey) return "finnhub_api_key_missing";
  if (!config.zaiApiKey) return "local_news_zai_api_key_missing";
  if (!config.vaultKey) return "local_news_vault_key_missing";
  return null;
}

function text(value: string | undefined): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() || "";
  return normalized || null;
}

function readBoolean(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() || "");
}

function boundedInt(
  value: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
