import nextEnv from "@next/env";
import { readMarketIssueRuntimeConfig } from "@/lib/market-issues/config";
import { runMarketIssueIngestionCycle } from "@/lib/market-issues/worker";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const config = readMarketIssueRuntimeConfig();
let running = false;
let stopped = false;

async function tick(): Promise<void> {
  if (running || stopped) return;
  running = true;
  try {
    const result = await runMarketIssueIngestionCycle();
    console.log(JSON.stringify({
      worker: config.workerId,
      kind: "market_issue_cycle",
      ...result,
    }));
  } catch (error) {
    console.error(JSON.stringify({
      worker: config.workerId,
      kind: "market_issue_cycle_failed",
      error: error instanceof Error ? error.message : "unknown_error",
    }));
  } finally {
    running = false;
  }
}

void tick();
const interval = setInterval(() => void tick(), config.intervalMs);

function shutdown(signal: string): void {
  stopped = true;
  clearInterval(interval);
  console.log(JSON.stringify({ worker: config.workerId, kind: "shutdown", signal }));
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
