import { Client } from "pg";
import {
  deriveSupabaseDatabaseUrl,
  firstNonEmpty,
  normalizePostgresListenChannel,
  shouldUsePostgresListenSsl,
} from "@/lib/postgres/listen-config";

const DEFAULT_CHANNEL = "agent_run_cancel";
const DEFAULT_RECONNECT_INTERVAL_MS = 5_000;

export type AgentRunCancelWaitResult =
  | "notification"
  | "timeout"
  | "aborted";

export interface AgentRunCancelWaiter {
  waitForRunCancel(
    runId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentRunCancelWaitResult>;
}

interface PostgresAgentRunCancelWaiterOptions {
  connectionString: string;
  channel: string;
  reconnectIntervalMs: number;
  logger?: Pick<typeof console, "info" | "warn">;
}

type WaiterEntry = {
  notify: () => void;
};

let singletonWaiter: AgentRunCancelWaiter | null = null;
let warnedMissingConnection = false;

export function getAgentRunCancelWaiter(
  env: Record<string, string | undefined> = process.env,
): AgentRunCancelWaiter {
  if (singletonWaiter) return singletonWaiter;

  const connectionString =
    env.AGENT_RUN_CANCEL_LISTEN_ENABLED === "0"
      ? null
      : getAgentRunCancelListenConnectionString(env);
  if (!connectionString) {
    if (!warnedMissingConnection && env.AGENT_RUN_CANCEL_LISTEN_ENABLED !== "0") {
      warnedMissingConnection = true;
      console.warn("[agent-run-cancel] missing Postgres LISTEN connection string", {
        required:
          "AGENT_RUN_CANCEL_LISTEN_DATABASE_URL, AGENT_QUEUE_LISTEN_DATABASE_URL, SUPABASE_DB_URL, DATABASE_URL, POSTGRES_URL, or SUPABASE_DB_PASSWORD",
      });
    }
    singletonWaiter = new SleepAgentRunCancelWaiter();
    return singletonWaiter;
  }

  singletonWaiter = new PostgresAgentRunCancelWaiter({
    connectionString,
    channel: normalizePostgresListenChannel(
      env.AGENT_RUN_CANCEL_LISTEN_CHANNEL,
      DEFAULT_CHANNEL,
    ),
    reconnectIntervalMs: parsePositiveInt(
      env.AGENT_RUN_CANCEL_LISTEN_RECONNECT_INTERVAL_MS,
      DEFAULT_RECONNECT_INTERVAL_MS,
    ),
    logger: console,
  });
  return singletonWaiter;
}

export function getAgentRunCancelListenConnectionString(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const explicit =
    firstNonEmpty(
      env.AGENT_RUN_CANCEL_LISTEN_DATABASE_URL,
      env.AGENT_QUEUE_LISTEN_DATABASE_URL,
      env.SUPABASE_LISTEN_DATABASE_URL,
      env.SUPABASE_DB_URL,
      env.DATABASE_URL,
      env.POSTGRES_URL,
    ) ?? null;
  if (explicit) return explicit;

  return deriveSupabaseDatabaseUrl(
    env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_DB_PASSWORD,
    env.SUPABASE_DB_PORT,
  );
}

export function resetAgentRunCancelWaiterForTests() {
  singletonWaiter = null;
  warnedMissingConnection = false;
}

export class SleepAgentRunCancelWaiter implements AgentRunCancelWaiter {
  waitForRunCancel(
    _runId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentRunCancelWaitResult> {
    if (signal?.aborted) return Promise.resolve("aborted");

    return new Promise((resolve) => {
      let settled = false;
      const finish = (result: AgentRunCancelWaitResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const onAbort = () => finish("aborted");
      const timer = setTimeout(() => finish("timeout"), Math.max(0, timeoutMs));
      timer.unref?.();
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

export class PostgresAgentRunCancelWaiter implements AgentRunCancelWaiter {
  private readonly options: PostgresAgentRunCancelWaiterOptions;
  private readonly waitersByRunId = new Map<string, Set<WaiterEntry>>();
  private client: Client | null = null;
  private connecting = false;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: PostgresAgentRunCancelWaiterOptions) {
    this.options = options;
  }

  waitForRunCancel(
    runId: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<AgentRunCancelWaitResult> {
    if (signal?.aborted) return Promise.resolve("aborted");
    this.ensureStarted();

    return new Promise((resolve) => {
      let settled = false;
      const entry: WaiterEntry = {
        notify: () => finish("notification"),
      };
      const finish = (result: AgentRunCancelWaitResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        this.deleteWaiter(runId, entry);
        resolve(result);
      };
      const onAbort = () => finish("aborted");
      const timer = setTimeout(() => finish("timeout"), Math.max(0, timeoutMs));
      timer.unref?.();

      this.addWaiter(runId, entry);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.closeClient();
  }

  private addWaiter(runId: string, entry: WaiterEntry) {
    const set = this.waitersByRunId.get(runId) ?? new Set<WaiterEntry>();
    set.add(entry);
    this.waitersByRunId.set(runId, set);
  }

  private deleteWaiter(runId: string, entry: WaiterEntry) {
    const set = this.waitersByRunId.get(runId);
    if (!set) return;
    set.delete(entry);
    if (set.size === 0) this.waitersByRunId.delete(runId);
  }

  private notifyRun(runId: string) {
    const set = this.waitersByRunId.get(runId);
    if (!set) return;
    for (const entry of Array.from(set)) {
      entry.notify();
    }
  }

  private ensureStarted() {
    if (this.client || this.connecting || this.stopped) return;
    void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connecting) return;
    this.connecting = true;

    const client = new Client({
      connectionString: this.options.connectionString,
      application_name: "krw-ontology-agent-run-cancel",
      ssl: shouldUsePostgresListenSsl(this.options.connectionString)
        ? { rejectUnauthorized: false }
        : undefined,
    });
    this.client = client;

    client.on("notification", (message) => {
      if (message.channel !== this.options.channel) return;
      const runId = message.payload?.trim();
      if (runId) this.notifyRun(runId);
    });
    client.on("error", (error) => {
      this.options.logger?.warn("[agent-run-cancel] Postgres LISTEN error", {
        error: error.message,
      });
      void this.reconnect();
    });
    client.on("end", () => {
      void this.reconnect();
    });

    try {
      await client.connect();
      await client.query(`LISTEN ${this.options.channel}`);
      this.options.logger?.info("[agent-run-cancel] listening for cancel requests", {
        channel: this.options.channel,
      });
    } catch (error) {
      this.options.logger?.warn(
        "[agent-run-cancel] failed to start Postgres LISTEN",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
      await this.closeClient();
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  private async reconnect(): Promise<void> {
    if (this.stopped) return;
    await this.closeClient();
    this.connecting = false;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.options.reconnectIntervalMs);
    this.reconnectTimer.unref?.();
  }

  private async closeClient(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (!client) return;

    client.removeAllListeners("notification");
    client.removeAllListeners("error");
    client.removeAllListeners("end");
    await client.end().catch(() => undefined);
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = value ? Number.parseInt(value, 10) : NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
