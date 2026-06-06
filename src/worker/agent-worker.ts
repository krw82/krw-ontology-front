import { randomUUID } from "node:crypto";
import { checkMcpHealth } from "@/lib/agent/mcp-client";
import { claimNextAgentRun } from "@/lib/agent/job-queue";
import { runAgentJob } from "@/lib/agent/job-runner";
import {
  isReadyMcpHealth,
  startAgentWorkerHeartbeat,
} from "@/lib/agent/worker-heartbeat";
import { readIntEnv } from "@/lib/env";
import { AgentSupervisor } from "@/worker/agent-supervisor";
import { createPostgresQueueListenerFromEnv } from "@/worker/postgres-queue-listener";

const WORKER_ID =
  process.env.AGENT_SUPERVISOR_ID ||
  process.env.AGENT_WORKER_ID ||
  `agent-supervisor-${randomUUID()}`;

const SUPERVISOR_CONCURRENCY = readSupervisorConcurrency();
const RECONCILE_INTERVAL_MS = readIntEnv(
  "AGENT_QUEUE_RECONCILE_INTERVAL_MS",
  60_000,
  { min: 5_000 },
);
const IDLE_LOG_INTERVAL_MS = readIntEnv("AGENT_WORKER_IDLE_LOG_INTERVAL_MS", 60_000, {
  min: 5_000,
});
const CLAIM_HEALTH_INTERVAL_MS = readIntEnv(
  "AGENT_WORKER_CLAIM_HEALTH_INTERVAL_MS",
  30_000,
  { min: 1_000 },
);

function readSupervisorConcurrency(): number {
  if (process.env.AGENT_SUPERVISOR_CONCURRENCY?.trim()) {
    return readIntEnv("AGENT_SUPERVISOR_CONCURRENCY", 1, { min: 1 });
  }
  if (process.env.MAC_WORKER_COUNT?.trim()) {
    return readIntEnv("MAC_WORKER_COUNT", 1, { min: 1 });
  }
  return 1;
}

async function waitForStopSignal(): Promise<void> {
  await new Promise<void>((resolve) => {
    let resolved = false;
    const stop = () => {
      if (resolved) return;
      resolved = true;
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

async function main() {
  process.env.AGENT_WORKER_ID = WORKER_ID;
  process.env.AGENT_SUPERVISOR_ID = WORKER_ID;

  const supervisor = new AgentSupervisor({
    workerId: WORKER_ID,
    concurrency: SUPERVISOR_CONCURRENCY,
    reconcileIntervalMs: RECONCILE_INTERVAL_MS,
    claimHealthIntervalMs: CLAIM_HEALTH_INTERVAL_MS,
    idleLogIntervalMs: IDLE_LOG_INTERVAL_MS,
    checkMcpHealth,
    isReadyMcpHealth,
    claimNextAgentRun,
    runAgentJob,
    startHeartbeat: startAgentWorkerHeartbeat,
    createQueueListener: () => createPostgresQueueListenerFromEnv(console),
    logger: console,
  });

  await supervisor.start();
  await waitForStopSignal();
  await supervisor.stop();
}

main().catch((error) => {
  console.error("[agent-supervisor] fatal", {
    error: error instanceof Error ? error.stack ?? error.message : String(error),
  });
  process.exit(1);
});
