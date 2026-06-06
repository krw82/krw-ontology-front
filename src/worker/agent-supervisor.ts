import type { McpHealthResult } from "@/lib/agent/mcp-client";
import type { AgentWorkerStatus } from "@/lib/agent/worker-heartbeat";

export type AgentQueueWakeReason =
  | "startup"
  | "listen_connected"
  | "notification"
  | "reconcile"
  | "slot_available";

export interface AgentQueueListener {
  start(onWake: (reason: AgentQueueWakeReason) => void): Promise<void> | void;
  stop(): Promise<void> | void;
}

export interface AgentSupervisorLogger {
  info(message: string, details?: Record<string, unknown>): void;
  warn(message: string, details?: Record<string, unknown>): void;
  error(message: string, details?: Record<string, unknown>): void;
}

export interface AgentSupervisorOptions {
  workerId: string;
  concurrency: number;
  reconcileIntervalMs: number;
  claimHealthIntervalMs: number;
  idleLogIntervalMs: number;
  checkMcpHealth: () => Promise<McpHealthResult>;
  isReadyMcpHealth: (health: McpHealthResult) => boolean;
  claimNextAgentRun: (workerId: string) => Promise<string | null>;
  runAgentJob: (runId: string, workerId: string) => Promise<void>;
  startHeartbeat: (
    workerId: string,
    getStatus: () => AgentWorkerStatus,
  ) => () => Promise<void>;
  createQueueListener?: () => AgentQueueListener | null;
  logger?: AgentSupervisorLogger;
}

const DEFAULT_LOGGER: AgentSupervisorLogger = {
  info(message, details) {
    console.info(message, details ?? {});
  },
  warn(message, details) {
    console.warn(message, details ?? {});
  },
  error(message, details) {
    console.error(message, details ?? {});
  },
};

export class AgentSupervisor {
  private readonly options: AgentSupervisorOptions;
  private readonly logger: AgentSupervisorLogger;
  private activeJobs = new Set<Promise<void>>();
  private draining = false;
  private drainScheduled = false;
  private drainRequested = false;
  private stopping = false;
  private started = false;
  private lastReadyHealthCheckAt = 0;
  private lastReadyHealthOk = false;
  private lastIdleLogAt = 0;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private stopHeartbeat: (() => Promise<void>) | null = null;
  private queueListener: AgentQueueListener | null = null;
  private drainPromise: Promise<void> | null = null;

  constructor(options: AgentSupervisorOptions) {
    if (!options.workerId.trim()) {
      throw new Error("Agent supervisor requires a worker id.");
    }
    if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
      throw new Error(`Agent supervisor concurrency must be >= 1: ${options.concurrency}`);
    }
    if (
      !Number.isInteger(options.reconcileIntervalMs) ||
      options.reconcileIntervalMs < 1_000
    ) {
      throw new Error(
        `Agent supervisor reconcile interval must be >= 1000ms: ${options.reconcileIntervalMs}`,
      );
    }

    this.options = options;
    this.logger = options.logger ?? DEFAULT_LOGGER;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.logger.info("[agent-supervisor] started", {
      workerId: this.options.workerId,
      concurrency: this.options.concurrency,
      reconcileIntervalMs: this.options.reconcileIntervalMs,
    });

    this.stopHeartbeat = this.options.startHeartbeat(
      this.options.workerId,
      () => this.currentStatus(),
    );

    const listener = this.options.createQueueListener?.() ?? null;
    if (listener) {
      this.queueListener = listener;
      await listener.start((reason) => this.wake(reason));
    } else {
      this.logger.warn("[agent-supervisor] queue listener unavailable; using reconcile polling only", {
        workerId: this.options.workerId,
      });
    }

    this.reconcileTimer = setInterval(() => {
      this.wake("reconcile");
    }, this.options.reconcileIntervalMs);

    this.wake("startup");
  }

  async stop(): Promise<void> {
    if (!this.started || this.stopping) return;
    this.stopping = true;

    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }

    await this.queueListener?.stop();
    this.queueListener = null;

    if (this.drainPromise) {
      await this.drainPromise.catch(() => undefined);
    }
    if (this.activeJobs.size > 0) {
      await Promise.allSettled(Array.from(this.activeJobs));
    }
    if (this.stopHeartbeat) {
      await this.stopHeartbeat();
      this.stopHeartbeat = null;
    }

    this.logger.info("[agent-supervisor] stopped", {
      workerId: this.options.workerId,
    });
  }

  wake(reason: AgentQueueWakeReason): void {
    if (this.stopping) return;
    if (this.drainScheduled || this.draining) {
      this.drainRequested = true;
      return;
    }

    this.drainScheduled = true;
    this.drainPromise = Promise.resolve()
      .then(() => this.drain(reason))
      .finally(() => {
        this.drainPromise = null;
      });
  }

  getActiveJobCount(): number {
    return this.activeJobs.size;
  }

  private currentStatus(): AgentWorkerStatus {
    return this.activeJobs.size > 0 ? "running" : "idle";
  }

  private async drain(reason: AgentQueueWakeReason): Promise<void> {
    if (this.stopping) return;
    this.drainScheduled = false;
    this.draining = true;

    try {
      await this.claimAvailableRuns(reason);
    } finally {
      this.draining = false;
      if (this.drainRequested && !this.stopping) {
        this.drainRequested = false;
        this.wake("notification");
      }
    }
  }

  private async claimAvailableRuns(reason: AgentQueueWakeReason): Promise<void> {
    let claimedAny = false;

    while (!this.stopping && this.activeJobs.size < this.options.concurrency) {
      if (!(await this.workerCanClaim())) {
        break;
      }

      const runId = await this.options.claimNextAgentRun(this.options.workerId);
      if (!runId) {
        if (!claimedAny && Date.now() - this.lastIdleLogAt > this.options.idleLogIntervalMs) {
          this.logger.info("[agent-supervisor] idle", {
            workerId: this.options.workerId,
            reason,
          });
          this.lastIdleLogAt = Date.now();
        }
        break;
      }

      claimedAny = true;
      this.startJob(runId);
    }
  }

  private startJob(runId: string): void {
    this.logger.info("[agent-supervisor] claimed", {
      workerId: this.options.workerId,
      runId,
      activeJobs: this.activeJobs.size + 1,
    });

    const job = this.options
      .runAgentJob(runId, this.options.workerId)
      .catch((error) => {
        this.logger.error("[agent-supervisor] job failed", {
          workerId: this.options.workerId,
          runId,
          error: error instanceof Error ? error.stack ?? error.message : String(error),
        });
      })
      .finally(() => {
        this.activeJobs.delete(job);
        this.logger.info("[agent-supervisor] finished", {
          workerId: this.options.workerId,
          runId,
          activeJobs: this.activeJobs.size,
        });
        this.wake("slot_available");
      });

    this.activeJobs.add(job);
  }

  private async workerCanClaim(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastReadyHealthCheckAt < this.options.claimHealthIntervalMs) {
      return this.lastReadyHealthOk;
    }

    const mcpHealth = await this.options.checkMcpHealth();
    this.lastReadyHealthCheckAt = now;
    this.lastReadyHealthOk = this.options.isReadyMcpHealth(mcpHealth);
    if (this.lastReadyHealthOk) return true;

    this.logger.warn("[agent-supervisor] refusing to claim; MCP release is not ready", {
      env: mcpHealth.env,
      releaseId: mcpHealth.releaseId,
      manifestValid: mcpHealth.manifestValid,
      connected: mcpHealth.connected,
      error: mcpHealth.error,
    });
    return false;
  }
}
