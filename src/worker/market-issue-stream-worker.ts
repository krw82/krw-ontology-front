import nextEnv from "@next/env";

import { readMarketIssueRuntimeConfig } from "@/lib/market-issues/config";
import { runMarketIssueStreamCycle } from "@/lib/market-issues/stream-worker";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const config = readMarketIssueRuntimeConfig();

// The stream worker holds a single long-lived connection. Unlike the poll
// workers (setInterval), it loops on disconnect: when the filtered-stream
// connection drops and cannot auto-reconnect, runMarketIssueStreamCycle
// returns and we re-enter after a short backoff. SIGINT/SIGTERM abort the
// in-flight cycle and exit.
let stopped = false;
let activeController: AbortController | null = null;
let backoffTimer: NodeJS.Timeout | null = null;

const RECONNECT_BACKOFF_MS = 5000;

async function runOnce(): Promise<void> {
  if (stopped) return;
  const controller = new AbortController();
  activeController = controller;
  try {
    const result = await runMarketIssueStreamCycle({ signal: controller.signal });
    if (result.skipped) {
      console.log(JSON.stringify({
        worker: config.workerId,
        kind: "market_issue_stream_skipped",
        reason: result.reason,
      }));
    }
  } catch (error) {
    console.error(JSON.stringify({
      worker: config.workerId,
      kind: "market_issue_stream_failed",
      error: error instanceof Error ? error.message : "unknown_error",
    }));
  } finally {
    activeController = null;
  }
}

async function loop(): Promise<void> {
  while (!stopped) {
    await runOnce();
    if (stopped) break;
    // Backoff before reconnecting to avoid a tight loop on persistent failures
    // (e.g. invalid token, quota exhausted). The skipped reasons
    // (ingestion_disabled, x_credentials_missing) also land here so the worker
    // idles safely rather than hot-looping. The timer is cleared on shutdown
    // so SIGTERM exits promptly.
    await new Promise<void>((resolve) => {
      backoffTimer = setTimeout(() => {
        backoffTimer = null;
        resolve();
      }, RECONNECT_BACKOFF_MS);
    });
  }
}

void loop();

function shutdown(signal: string): void {
  stopped = true;
  if (backoffTimer) {
    clearTimeout(backoffTimer);
    backoffTimer = null;
  }
  activeController?.abort();
  console.log(JSON.stringify({ worker: config.workerId, kind: "shutdown", signal }));
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));
