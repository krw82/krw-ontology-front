import { Client } from "pg";
import { readIntEnv } from "@/lib/env";
import {
  deriveSupabaseDatabaseUrl,
  firstNonEmpty,
  normalizePostgresListenChannel,
  shouldUsePostgresListenSsl,
} from "@/lib/postgres/listen-config";
import type {
  AgentQueueListener,
  AgentQueueWakeReason,
  AgentSupervisorLogger,
} from "@/worker/agent-supervisor";

export { deriveSupabaseDatabaseUrl } from "@/lib/postgres/listen-config";

const DEFAULT_CHANNEL = "agent_run_queued";
const DEFAULT_RECONNECT_INTERVAL_MS = 5_000;

interface PostgresQueueListenerOptions {
  connectionString: string;
  channel: string;
  reconnectIntervalMs: number;
  logger: AgentSupervisorLogger;
}

export function createPostgresQueueListenerFromEnv(
  logger: AgentSupervisorLogger,
  env: Record<string, string | undefined> = process.env,
): AgentQueueListener | null {
  if (env.AGENT_QUEUE_LISTEN_ENABLED === "0") return null;

  const connectionString = getAgentQueueListenConnectionString(env);
  if (!connectionString) {
    logger.warn("[agent-supervisor] missing Postgres LISTEN connection string", {
      required:
        "AGENT_QUEUE_LISTEN_DATABASE_URL, SUPABASE_DB_URL, DATABASE_URL, POSTGRES_URL, or SUPABASE_DB_PASSWORD",
    });
    return null;
  }

  return new PostgresQueueListener({
    connectionString,
    channel: normalizeListenChannel(env.AGENT_QUEUE_LISTEN_CHANNEL),
    reconnectIntervalMs: readIntEnv(
      "AGENT_QUEUE_LISTEN_RECONNECT_INTERVAL_MS",
      DEFAULT_RECONNECT_INTERVAL_MS,
      { min: 1_000 },
    ),
    logger,
  });
}

export function getAgentQueueListenConnectionString(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const explicit =
    firstNonEmpty(
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

export function normalizeListenChannel(raw: string | undefined): string {
  return normalizePostgresListenChannel(raw, DEFAULT_CHANNEL);
}

class PostgresQueueListener implements AgentQueueListener {
  private readonly options: PostgresQueueListenerOptions;
  private client: Client | null = null;
  private stopped = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private onWake: ((reason: AgentQueueWakeReason) => void) | null = null;

  constructor(options: PostgresQueueListenerOptions) {
    this.options = options;
  }

  async start(onWake: (reason: AgentQueueWakeReason) => void): Promise<void> {
    this.onWake = onWake;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    await this.closeClient();
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;

    const client = new Client({
      connectionString: this.options.connectionString,
      application_name: "krw-ontology-agent-supervisor",
      ssl: shouldUsePostgresListenSsl(this.options.connectionString)
        ? { rejectUnauthorized: false }
        : undefined,
    });
    this.client = client;

    client.on("notification", (message) => {
      if (message.channel === this.options.channel) {
        this.onWake?.("notification");
      }
    });
    client.on("error", (error) => {
      this.options.logger.warn("[agent-supervisor] Postgres LISTEN error", {
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
      this.options.logger.info("[agent-supervisor] listening for queued runs", {
        channel: this.options.channel,
      });
      this.onWake?.("listen_connected");
    } catch (error) {
      this.options.logger.warn("[agent-supervisor] failed to start Postgres LISTEN", {
        error: error instanceof Error ? error.message : String(error),
      });
      await this.closeClient();
      this.scheduleReconnect();
    }
  }

  private async reconnect(): Promise<void> {
    if (this.stopped) return;
    await this.closeClient();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.options.reconnectIntervalMs);
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
