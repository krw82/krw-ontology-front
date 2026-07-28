import type { MarketIssueSourceClass } from "@/lib/market-issues/contract";

export type MarketIssueEnvironment = "dev" | "staging" | "prod";

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
  maxPostsPerSource: number;
  xApiBaseUrl: string;
  xBearerToken: string | null;
  summarizerUrl: string | null;
  summarizerToken: string | null;
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

export function readMarketIssueRuntimeConfig(): MarketIssueRuntimeConfig {
  return {
    environment: marketIssueEnvironment(),
    workerId: normalizedText(process.env.MARKET_ISSUE_WORKER_ID)
      || "market-issue-worker",
    intervalMs: boundedInt(process.env.MARKET_ISSUE_INGESTION_INTERVAL_MS, 300000, 30000, 3600000),
    maxPostsPerSource: boundedInt(process.env.MARKET_ISSUE_X_MAX_POSTS_PER_SOURCE, 20, 5, 100),
    xApiBaseUrl: (normalizedText(process.env.MARKET_ISSUE_X_API_BASE_URL) || "https://api.x.com").replace(/\/+$/, ""),
    xBearerToken: normalizedText(process.env.MARKET_ISSUE_X_BEARER_TOKEN),
    summarizerUrl: normalizedText(process.env.MARKET_ISSUE_SUMMARIZER_URL),
    summarizerToken: normalizedText(process.env.MARKET_ISSUE_SUMMARIZER_TOKEN),
    sourceSeeds: parseMarketIssueSourceSeeds(process.env.MARKET_ISSUE_X_SOURCES),
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
