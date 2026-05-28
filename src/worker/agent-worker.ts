import { randomUUID } from "node:crypto";
import { checkMcpHealth } from "@/lib/agent/mcp-client";
import { claimNextAgentRun } from "@/lib/agent/job-queue";
import { runAgentJob } from "@/lib/agent/job-runner";
import {
  isReadyMcpHealth,
  startAgentWorkerHeartbeat,
  type AgentWorkerStatus,
} from "@/lib/agent/worker-heartbeat";
import { readIntEnv } from "@/lib/env";

const WORKER_ID = process.env.AGENT_WORKER_ID || `agent-worker-${randomUUID()}`;
const POLL_INTERVAL_MS = readIntEnv("AGENT_WORKER_POLL_INTERVAL_MS", 1000, {
  min: 100,
});
const IDLE_LOG_INTERVAL_MS = readIntEnv("AGENT_WORKER_IDLE_LOG_INTERVAL_MS", 60_000, {
  min: 5_000,
});
const CLAIM_HEALTH_INTERVAL_MS = readIntEnv(
  "AGENT_WORKER_CLAIM_HEALTH_INTERVAL_MS",
  30_000,
  { min: 1_000 },
);

let stopping = false;
let workerStatus: AgentWorkerStatus = "idle";
let lastReadyHealthCheckAt = 0;
let lastReadyHealthOk = false;

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function workerCanClaim(): Promise<boolean> {
  const now = Date.now();
  if (now - lastReadyHealthCheckAt < CLAIM_HEALTH_INTERVAL_MS) {
    return lastReadyHealthOk;
  }
  const mcpHealth = await checkMcpHealth();
  lastReadyHealthCheckAt = now;
  lastReadyHealthOk = isReadyMcpHealth(mcpHealth);
  if (lastReadyHealthOk) return true;
  console.warn("[agent-worker] refusing to claim; MCP release is not ready", {
    env: mcpHealth.env,
    releaseId: mcpHealth.releaseId,
    manifestValid: mcpHealth.manifestValid,
    connected: mcpHealth.connected,
    error: mcpHealth.error,
  });
  return false;
}

async function main() {
  console.info("[agent-worker] started", { workerId: WORKER_ID });
  const stopWorkerHeartbeat = startAgentWorkerHeartbeat(
    WORKER_ID,
    () => workerStatus,
  );
  let lastIdleLogAt = 0;

  try {
    while (!stopping) {
      workerStatus = "idle";
      if (!(await workerCanClaim())) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      const runId = await claimNextAgentRun(WORKER_ID);

      if (!runId) {
        if (Date.now() - lastIdleLogAt > IDLE_LOG_INTERVAL_MS) {
          console.info("[agent-worker] idle", { workerId: WORKER_ID });
          lastIdleLogAt = Date.now();
        }
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      workerStatus = "running";
      console.info("[agent-worker] claimed", { workerId: WORKER_ID, runId });
      await runAgentJob(runId, WORKER_ID);
      console.info("[agent-worker] finished", { workerId: WORKER_ID, runId });
    }
  } finally {
    await stopWorkerHeartbeat();
  }

  console.info("[agent-worker] stopped", { workerId: WORKER_ID });
}

main().catch((error) => {
  console.error("[agent-worker] fatal", {
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  });
  process.exit(1);
});
