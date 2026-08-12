import nextEnv from "@next/env";

import { readLocalNewsRuntimeConfig } from "@/lib/local-news/config";
import { runLocalNewsCycle } from "@/lib/local-news/worker";

const { loadEnvConfig } = nextEnv;
const localWorkerEnvKeys = [
  "NODE_ENV",
  "MARKET_ISSUE_ENV",
  "FILING_WORKER_ENV",
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "FINNHUB_API_KEY",
  "ZAI_API_KEY",
  "MARKET_ISSUE_ZAI_API_KEY",
  "LOCAL_NEWS_ENABLED",
  "LOCAL_NEWS_WORKER_ID",
  "LOCAL_NEWS_INTERVAL_MS",
  "LOCAL_NEWS_COVERAGE_BATCH_SIZE",
  "LOCAL_NEWS_MAX_ARTICLES_PER_TICKER",
  "LOCAL_NEWS_LOOKBACK_HOURS",
  "LOCAL_NEWS_FINNHUB_TIMEOUT_MS",
  "LOCAL_NEWS_FINNHUB_REQUEST_INTERVAL_MS",
  "LOCAL_NEWS_VAULT_KEY",
  "LOCAL_NEWS_VAULT_PATH",
  "LOCAL_NEWS_PUBLISH_MODE",
  "LOCAL_NEWS_NOTIFICATION_CREATION_ENABLED",
  "FILING_NOTIFICATION_CREATION_ENABLED",
  "LOCAL_NEWS_ZAI_API_KEY",
  "LOCAL_NEWS_ZAI_BASE_URL",
  "LOCAL_NEWS_ZAI_MODEL",
  "LOCAL_NEWS_ZAI_TIMEOUT_MS",
  "LOCAL_NEWS_ZAI_MAX_TOKENS",
] as const;
const localWorkerEnvOverrides = new Map(
  localWorkerEnvKeys
    .map((key) => [key, process.env[key]] as const)
    .filter((entry): entry is readonly [typeof localWorkerEnvKeys[number], string] => entry[1] !== undefined),
);
loadEnvConfig(process.cwd());
const runtimeEnv = process.env as Record<string, string | undefined>;
for (const [key, value] of localWorkerEnvOverrides) runtimeEnv[key] = value;

const config = readLocalNewsRuntimeConfig();
const once = process.argv.slice(2).includes("--once");
const help = process.argv.slice(2).some((argument) => argument === "--help" || argument === "-h");
let running = false;
let stopped = false;
let collectionInterval: NodeJS.Timeout | null = null;

async function tick(): Promise<boolean> {
  if (running || stopped) return false;
  running = true;
  try {
    const result = await runLocalNewsCycle({ config });
    console.log(JSON.stringify({ worker: config.workerId, environment: config.environment, kind: "local_news_cycle", ...result }));
    return result.failed === 0;
  } catch (error) {
    console.error(JSON.stringify({
      worker: config.workerId,
      kind: "local_news_cycle_failed",
      error: error instanceof Error ? error.message : "unknown_error",
    }));
    return false;
  } finally {
    running = false;
  }
}

function shutdown(signal: string): void {
  stopped = true;
  if (collectionInterval) clearInterval(collectionInterval);
  console.log(JSON.stringify({ worker: config.workerId, kind: "shutdown", signal }));
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

void (async () => {
  if (help) {
    console.log("Usage: local-news-worker [--once]");
    return;
  }
  const collectionSuccess = await tick();
  if (once) {
    process.exitCode = collectionSuccess ? 0 : 1;
    return;
  }
  collectionInterval = setInterval(() => void tick(), config.intervalMs);
})();
