import type { MarketIssueSourceClass } from "@/lib/market-issues/contract";

export type MarketIssueEnvironment = "dev" | "staging" | "prod";
export type MarketIssueSummarizerProvider = "external" | "zai_coding";

export interface MarketIssueSourceSeed {
  accountHandle: string;
  displayName: string;
  sourceClass: MarketIssueSourceClass;
  sourceTags: string[];
  allowSingleSourcePublish: boolean;
}

export interface MarketIssueRuntimeConfig {
  environment: MarketIssueEnvironment;
  workerId: string;
  intervalMs: number;
  enrichmentWorkerId: string;
  enrichmentIntervalMs: number;
  maxEnrichmentJobsPerCycle: number;
  maxPostsPerSource: number;
  dailyTweetCap: number;
  xApiBaseUrl: string;
  xBearerToken: string | null;
  summarizerProvider: MarketIssueSummarizerProvider;
  summarizerUrl: string | null;
  summarizerToken: string | null;
  zaiApiKey: string | null;
  zaiBaseUrl: string;
  zaiModel: string;
  zaiTimeoutMs: number;
  zaiMaxTokens: number;
  visionModel: string;
  visionMaxTokens: number;
  composerModel: string;
  composerMaxTokens: number;
  sourceSeeds: MarketIssueSourceSeed[];
}

const SOURCE_CLASSES: readonly MarketIssueSourceClass[] = [
  "government",
  "regulator",
  "company_official",
  "exchange",
  "registered_media",
  "journalist",
  "expert",
];

// Stream-first X sources: macro commentary, policy wires, and market-moving
// statements. Earnings/EPS/ticker flash news are intentionally excluded — that
// coverage is owned by the 328 web/RSS IR feeds and the SEC catalog adapter.
// Regulators (SEC, Fed) and exchanges were moved off X to free official RSS
// feeds (see migration 20260804_market_regulator_rss_sources.sql) because their
// X output is no faster than the official feed and costs API credits.
// Set MARKET_ISSUE_X_SOURCES to [] to disable this baseline or provide a
// replacement source list. realDonaldTrump uses a keyword filter in the stream
// worker so only market-moving statements are billed.
const DEFAULT_X_SOURCE_SEEDS: readonly MarketIssueSourceSeed[] = [
  {
    accountHandle: "SoberLook",
    displayName: "SoberLook (Daily Shot)",
    sourceClass: "expert",
    sourceTags: [],
    allowSingleSourcePublish: false,
  },
  {
    accountHandle: "profplum99",
    displayName: "Michael Green",
    sourceClass: "expert",
    sourceTags: [],
    allowSingleSourcePublish: false,
  },
  {
    accountHandle: "LynAldenContact",
    displayName: "Lyn Alden",
    sourceClass: "expert",
    sourceTags: [],
    allowSingleSourcePublish: false,
  },
  {
    accountHandle: "EPBResearch",
    displayName: "EPB Research",
    sourceClass: "expert",
    sourceTags: [],
    allowSingleSourcePublish: false,
  },
  {
    accountHandle: "BCAppelbaum",
    displayName: "Binyamin Appelbaum (NYT)",
    sourceClass: "journalist",
    sourceTags: [],
    allowSingleSourcePublish: false,
  },
  {
    accountHandle: "realDonaldTrump",
    displayName: "Donald Trump",
    sourceClass: "government",
    sourceTags: [],
    allowSingleSourcePublish: false,
  },
  {
    accountHandle: "USTradeRep",
    displayName: "U.S. Trade Representative",
    sourceClass: "government",
    sourceTags: [],
    allowSingleSourcePublish: true,
  },
  {
    accountHandle: "USTreasury",
    displayName: "U.S. Treasury",
    sourceClass: "government",
    sourceTags: [],
    allowSingleSourcePublish: true,
  },
];

export function marketIssueEnvironment(): MarketIssueEnvironment {
  const raw = (
    process.env.MARKET_ISSUE_ENV ||
    process.env.FILING_WORKER_ENV ||
    process.env.NODE_ENV ||
    "production"
  ).trim().toLowerCase();

  if (raw === "dev" || raw === "development") return "dev";
  if (raw === "staging" || raw === "stage") return "staging";
  return "prod";
}

function marketIssueSummarizerProvider(
  value: string | undefined,
): MarketIssueSummarizerProvider {
  return value?.trim().toLowerCase() === "zai_coding"
    ? "zai_coding"
    : "external";
}

export function readMarketIssueRuntimeConfig(): MarketIssueRuntimeConfig {
  return {
    environment: marketIssueEnvironment(),
    workerId: normalizedText(process.env.MARKET_ISSUE_WORKER_ID)
      || "market-issue-worker",
    intervalMs: boundedInt(process.env.MARKET_ISSUE_INGESTION_INTERVAL_MS, 1800000, 60000, 3600000),
    enrichmentWorkerId: normalizedText(process.env.MARKET_ISSUE_ENRICHMENT_WORKER_ID)
      || "market-issue-enrichment-worker",
    enrichmentIntervalMs: boundedInt(process.env.MARKET_ISSUE_ENRICHMENT_INTERVAL_MS, 60000, 30000, 3600000),
    maxEnrichmentJobsPerCycle: boundedInt(process.env.MARKET_ISSUE_ENRICHMENT_MAX_JOBS, 4, 1, 20),
    maxPostsPerSource: boundedInt(process.env.MARKET_ISSUE_X_MAX_POSTS_PER_SOURCE, 10, 10, 100),
    dailyTweetCap: boundedInt(process.env.MARKET_ISSUE_DAILY_TWEET_CAP, 100, 0, 10000),
    xApiBaseUrl: (normalizedText(process.env.MARKET_ISSUE_X_API_BASE_URL) || "https://api.x.com").replace(/\/+$/, ""),
    xBearerToken: normalizedText(process.env.MARKET_ISSUE_X_BEARER_TOKEN),
    summarizerProvider: marketIssueSummarizerProvider(process.env.MARKET_ISSUE_LLM_PROVIDER),
    summarizerUrl: normalizedText(process.env.MARKET_ISSUE_SUMMARIZER_URL),
    summarizerToken: normalizedText(process.env.MARKET_ISSUE_SUMMARIZER_TOKEN),
    zaiApiKey: normalizedText(process.env.MARKET_ISSUE_ZAI_API_KEY)
      || normalizedText(process.env.ZAI_API_KEY),
    zaiBaseUrl: (normalizedText(process.env.MARKET_ISSUE_ZAI_BASE_URL)
      || "https://api.z.ai/api/coding/paas/v4").replace(/\/+$/, ""),
    zaiModel: normalizedText(process.env.MARKET_ISSUE_ZAI_MODEL) || "glm-5.1",
    zaiTimeoutMs: boundedInt(process.env.MARKET_ISSUE_ZAI_TIMEOUT_MS, 120000, 10000, 300000),
    zaiMaxTokens: boundedInt(process.env.MARKET_ISSUE_ZAI_MAX_TOKENS, 4096, 512, 8192),
    visionModel: normalizedText(process.env.MARKET_ISSUE_ZAI_VISION_MODEL) || "glm-4.6v",
    visionMaxTokens: boundedInt(process.env.MARKET_ISSUE_ZAI_VISION_MAX_TOKENS, 2048, 512, 8192),
    composerModel: normalizedText(process.env.MARKET_ISSUE_ZAI_COMPOSER_MODEL) || "glm-5.3",
    composerMaxTokens: boundedInt(process.env.MARKET_ISSUE_ZAI_COMPOSER_MAX_TOKENS, 4096, 512, 8192),
    sourceSeeds: !process.env.MARKET_ISSUE_X_SOURCES?.trim()
      ? [...DEFAULT_X_SOURCE_SEEDS]
      : parseMarketIssueSourceSeeds(process.env.MARKET_ISSUE_X_SOURCES),
  };
}

export function parseMarketIssueSourceSeeds(value: string | undefined): MarketIssueSourceSeed[] {
  if (!value?.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const unique = new Map<string, MarketIssueSourceSeed>();
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const accountHandle = normalizeHandle(record.accountHandle ?? record.handle);
    const sourceClass = typeof record.sourceClass === "string"
      && SOURCE_CLASSES.includes(record.sourceClass as MarketIssueSourceClass)
      ? record.sourceClass as MarketIssueSourceClass
      : null;
    if (!accountHandle || !sourceClass) continue;
    const displayName = normalizedText(record.displayName) || accountHandle;

    const sourceTags = Array.isArray(record.sourceTags)
      ? record.sourceTags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 20)
      : [];
    unique.set(accountHandle.toLowerCase(), {
      accountHandle,
      displayName,
      sourceClass,
      sourceTags,
      allowSingleSourcePublish: record.allowSingleSourcePublish === true,
    });
  }
  return [...unique.values()].slice(0, 60);
}

function normalizedText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || null;
}

function normalizeHandle(value: unknown): string | null {
  const normalized = normalizedText(value)?.replace(/^@/, "") || "";
  return /^[A-Za-z0-9_]{1,30}$/.test(normalized) ? normalized : null;
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
