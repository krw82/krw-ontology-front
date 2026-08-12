import nextEnv from "@next/env";
import { readValuationRefreshConfig } from "@/lib/valuation/config";
import { runValuationRefreshCycle } from "@/lib/valuation/refresh";
import { selectTickerBatch } from "@/lib/valuation/ticker-batches";
import {
  parseValuationTickerList,
  parseValuationWorkerCli,
} from "@/lib/valuation/worker-cli";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const config = readValuationRefreshConfig();
const cli = parseValuationWorkerCli(process.argv.slice(2));
let running = false;
let stopped = false;
let interval: NodeJS.Timeout | null = null;

function configuredTickerOverride(): string[] {
  return parseValuationTickerList(process.env.VALUATION_REFRESH_TICKERS ?? "");
}

async function loadTargetTickers(): Promise<string[]> {
  const override = cli.tickers.length > 0 ? cli.tickers : configuredTickerOverride();
  if (override.length > 0) {
    return selectTickerBatch(override, config.batchSize, 0);
  }

  // MVP: refresh all tickers known to ontology_companies that also resolve to
  // a SEC CIK. This keeps the refresh set bounded to covered companies.
  // A future iteration can add an explicit watchlist-driven target set.
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("ontology_companies")
    .select("ticker")
    .not("ticker", "is", null)
    .order("ticker");

  if (error) {
    throw new Error(`Failed to load target tickers: ${error.message}`);
  }

  const tickers = (data ?? [])
    .map((row) => (typeof row.ticker === "string" ? row.ticker : null))
    .filter((t): t is string => Boolean(t));

  // Deduplicate and rotate pages on each scheduled interval. A fixed slice of
  // the sorted list would starve every ticker after the first batch.
  const unique = [...new Set(tickers)];
  const cycleNumber = Math.floor(Date.now() / config.intervalMs);
  return selectTickerBatch(unique, config.batchSize, cycleNumber);
}

async function tick(): Promise<boolean> {
  if (running || stopped) return false;
  if (!config.enabled) {
    console.log(
      JSON.stringify({
        worker: config.workerId,
        kind: "valuation_refresh_skipped",
        reason: "fmp_disabled",
      }),
    );
    return false;
  }

  running = true;
  try {
    const tickers = await loadTargetTickers();
    if (tickers.length === 0) {
      console.log(
        JSON.stringify({ worker: config.workerId, kind: "valuation_refresh_empty" }),
      );
      return true;
    }

    const result = await runValuationRefreshCycle(tickers, config);
    console.log(
      JSON.stringify({ worker: config.workerId, kind: "valuation_refresh_cycle", ...result }),
    );
    return result.failed === 0;
  } catch (error) {
    console.error(
      JSON.stringify({
        worker: config.workerId,
        kind: "valuation_refresh_cycle_failed",
        error: error instanceof Error ? error.message : "unknown_error",
      }),
    );
    return false;
  } finally {
    running = false;
  }
}

function shutdown(signal: string): void {
  stopped = true;
  if (interval) clearInterval(interval);
  console.log(JSON.stringify({ worker: config.workerId, kind: "shutdown", signal }));
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

void (async () => {
  if (cli.help) {
    console.log("Usage: valuation-refresh-worker [--once] [--tickers AAPL,MSFT]");
    return;
  }
  const success = await tick();
  if (cli.once) {
    process.exitCode = success ? 0 : 1;
    return;
  }
  interval = setInterval(() => void tick(), config.intervalMs);
})();
