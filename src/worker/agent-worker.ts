import { randomUUID } from "node:crypto";
import { claimNextAgentRun } from "@/lib/agent/job-queue";
import { runAgentJob } from "@/lib/agent/job-runner";
import { readIntEnv } from "@/lib/env";

const WORKER_ID = process.env.AGENT_WORKER_ID || `agent-worker-${randomUUID()}`;
const POLL_INTERVAL_MS = readIntEnv("AGENT_WORKER_POLL_INTERVAL_MS", 1000, {
  min: 100,
});
const IDLE_LOG_INTERVAL_MS = readIntEnv("AGENT_WORKER_IDLE_LOG_INTERVAL_MS", 60_000, {
  min: 5_000,
});

let stopping = false;

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  console.info("[agent-worker] started", { workerId: WORKER_ID });
  let lastIdleLogAt = 0;

  while (!stopping) {
    const runId = await claimNextAgentRun(WORKER_ID);

    if (!runId) {
      if (Date.now() - lastIdleLogAt > IDLE_LOG_INTERVAL_MS) {
        console.info("[agent-worker] idle", { workerId: WORKER_ID });
        lastIdleLogAt = Date.now();
      }
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    console.info("[agent-worker] claimed", { workerId: WORKER_ID, runId });
    await runAgentJob(runId, WORKER_ID);
    console.info("[agent-worker] finished", { workerId: WORKER_ID, runId });
  }

  console.info("[agent-worker] stopped", { workerId: WORKER_ID });
}

main().catch((error) => {
  console.error("[agent-worker] fatal", {
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  });
  process.exit(1);
});
