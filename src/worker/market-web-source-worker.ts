import {
  getMarketWebSourceRuntimeConfig,
  runMarketWebSourceIngestionCycle,
} from "../lib/market-issues/web-ingestion";

let stopping = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function main(): Promise<void> {
  const config = getMarketWebSourceRuntimeConfig();
  const intervalMs = boundedNumber(process.env.MARKET_ISSUE_WEB_INGESTION_INTERVAL_MS, 15_000, 1_000, 300_000);
  while (!stopping) {
    try {
      const result = await runMarketWebSourceIngestionCycle({ config });
      process.stdout.write(`${JSON.stringify({ worker: config.workerId, ...result })}\n`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "market_web_source_worker_failed";
      process.stderr.write(`${JSON.stringify({ worker: config.workerId, error: message })}\n`);
    }
    if (!stopping) await sleep(intervalMs);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function boundedNumber(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

void main();
