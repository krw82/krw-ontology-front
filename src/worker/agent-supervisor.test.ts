import { describe, expect, it, vi } from "vitest";
import type { McpHealthResult } from "@/lib/agent/mcp-client";
import type { AgentWorkerStatus } from "@/lib/agent/worker-heartbeat";
import {
  AgentSupervisor,
  type AgentQueueListener,
  type AgentQueueWakeReason,
  type AgentSupervisorLogger,
} from "@/worker/agent-supervisor";

const READY_HEALTH = {
  connected: true,
  env: "prod",
  releaseId: "release-1",
  manifestValid: true,
} as McpHealthResult;

class ManualQueueListener implements AgentQueueListener {
  private onWake: ((reason: AgentQueueWakeReason) => void) | null = null;
  readonly stop = vi.fn(async () => undefined);

  start(onWake: (reason: AgentQueueWakeReason) => void): void {
    this.onWake = onWake;
  }

  notify(reason: AgentQueueWakeReason = "notification"): void {
    this.onWake?.(reason);
  }
}

function createLogger(): AgentSupervisorLogger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(check()).toBe(true);
}

function createSupervisor(overrides: {
  claimNextAgentRun?: (workerId: string) => Promise<string | null>;
  runAgentJob?: (runId: string, workerId: string) => Promise<void>;
  listener?: ManualQueueListener;
  concurrency?: number;
  statusRef?: { getStatus: (() => AgentWorkerStatus) | null };
}) {
  const listener = overrides.listener ?? new ManualQueueListener();
  const statusRef = overrides.statusRef ?? { getStatus: null };
  const supervisor = new AgentSupervisor({
    workerId: "mac-supervisor-test",
    concurrency: overrides.concurrency ?? 1,
    reconcileIntervalMs: 3_600_000,
    claimHealthIntervalMs: 30_000,
    idleLogIntervalMs: 3_600_000,
    checkMcpHealth: vi.fn(async () => READY_HEALTH),
    isReadyMcpHealth: vi.fn(() => true),
    claimNextAgentRun: overrides.claimNextAgentRun ?? vi.fn(async () => null),
    runAgentJob: overrides.runAgentJob ?? vi.fn(async () => undefined),
    startHeartbeat: vi.fn((_workerId, getStatus) => {
      statusRef.getStatus = getStatus;
      return async () => undefined;
    }),
    createQueueListener: () => listener,
    logger: createLogger(),
  });

  return { supervisor, listener, statusRef };
}

describe("AgentSupervisor", () => {
  it("does not repeatedly claim an idle queue without wakeups", async () => {
    const claimNextAgentRun = vi.fn(async () => null);
    const { supervisor, listener } = createSupervisor({ claimNextAgentRun });

    await supervisor.start();
    await waitFor(() => claimNextAgentRun.mock.calls.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(claimNextAgentRun).toHaveBeenCalledTimes(1);

    listener.notify();
    await waitFor(() => claimNextAgentRun.mock.calls.length === 2);
    expect(claimNextAgentRun).toHaveBeenCalledTimes(2);

    await supervisor.stop();
  });

  it("drains again when a notification arrives during an in-flight claim", async () => {
    const firstClaim = createDeferred();
    const claimNextAgentRun = vi
      .fn<() => Promise<string | null>>()
      .mockReturnValueOnce(firstClaim.promise.then(() => null))
      .mockResolvedValueOnce(null);
    const listener = new ManualQueueListener();
    const { supervisor } = createSupervisor({ claimNextAgentRun, listener });

    await supervisor.start();
    await waitFor(() => claimNextAgentRun.mock.calls.length === 1);

    listener.notify();
    firstClaim.resolve();
    await waitFor(() => claimNextAgentRun.mock.calls.length === 2);

    await supervisor.stop();
  });

  it("uses one process with an internal concurrency pool", async () => {
    const jobs = {
      run1: createDeferred(),
      run2: createDeferred(),
      run3: createDeferred(),
    };
    const claimNextAgentRun = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce("run1")
      .mockResolvedValueOnce("run2")
      .mockResolvedValueOnce("run3")
      .mockResolvedValue(null);
    const runAgentJob = vi.fn((runId: string) => {
      return jobs[runId as keyof typeof jobs].promise;
    });
    const { supervisor } = createSupervisor({
      claimNextAgentRun,
      runAgentJob,
      concurrency: 2,
    });

    await supervisor.start();
    await waitFor(() => runAgentJob.mock.calls.length === 2);
    expect(runAgentJob.mock.calls.map(([runId]) => runId)).toEqual(["run1", "run2"]);
    expect(supervisor.getActiveJobCount()).toBe(2);

    jobs.run1.resolve();
    await waitFor(() => runAgentJob.mock.calls.length === 3);
    expect(runAgentJob.mock.calls.map(([runId]) => runId)).toEqual([
      "run1",
      "run2",
      "run3",
    ]);

    jobs.run2.resolve();
    jobs.run3.resolve();
    await waitFor(() => supervisor.getActiveJobCount() === 0);
    await supervisor.stop();
  });

  it("reports heartbeat status from active jobs", async () => {
    const job = createDeferred();
    const statusRef = { getStatus: null as (() => AgentWorkerStatus) | null };
    const { supervisor } = createSupervisor({
      claimNextAgentRun: vi
        .fn()
        .mockResolvedValueOnce("run1")
        .mockResolvedValue(null),
      runAgentJob: vi.fn(async () => job.promise),
      statusRef,
    });

    await supervisor.start();
    await waitFor(() => statusRef.getStatus?.() === "running");

    job.resolve();
    await waitFor(() => statusRef.getStatus?.() === "idle");
    await supervisor.stop();
  });
});
