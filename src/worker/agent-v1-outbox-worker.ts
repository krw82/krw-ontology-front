import { randomUUID } from "node:crypto";
import { rename, writeFile } from "node:fs/promises";
import { Pool } from "pg";
import {
  superviseProductOutbox,
} from "@/lib/agent-v1/outbox-supervisor";
import {
  PostgresAgentV1OutboxPort,
} from "@/lib/agent-v1/product-outbox";
import {
  deriveSupabaseDatabaseUrl,
  firstNonEmpty,
  resolvePostgresTls,
} from "@/lib/postgres/listen-config";

const workerId =
  process.env.AGENT_V1_OUTBOX_WORKER_ID ||
  `agent-v1-outbox-${randomUUID()}`;
const concurrency = boundedEnv("AGENT_V1_OUTBOX_CONCURRENCY", 4, 1, 16);
const claimLimit = boundedEnv("AGENT_V1_OUTBOX_BATCH_SIZE", 32, 1, 100);
const leaseMs = boundedEnv("AGENT_V1_OUTBOX_LEASE_MS", 30_000, 1_000, 600_000);
const idlePollMs = boundedEnv("AGENT_V1_OUTBOX_IDLE_POLL_MS", 2_000, 100, 60_000);
const failureBackoffMs = boundedEnv(
  "AGENT_V1_OUTBOX_FAILURE_BACKOFF_MS",
  5_000,
  250,
  60_000,
);
const OUTBOX_HEALTH_FILE = "/tmp/agent-v1-outbox-health.json";

async function main(): Promise<void> {
  const connectionString = resolveConnectionString(process.env);
  if (!connectionString) throw new Error("agent_v1_outbox_database_url_missing");

  // Clear a possibly recent heartbeat from a previous process. The container
  // must not become healthy until this worker has completed at least one real
  // database pass.
  await writeOutboxHealth({
    status: "degraded",
    last_failure_at: new Date().toISOString(),
    failure_class: "starting",
  });

  const pool = new Pool({
    connectionString,
    application_name: "krw-front-agent-v1-outbox",
    max: concurrency + 2,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
    ssl: resolvePostgresTls(connectionString),
  });
  pool.on("error", (error) => {
    const databaseCode = Reflect.get(error, "code");
    console.warn("[agent-v1-outbox] idle database client failed", {
      class: error.name,
      code: typeof databaseCode === "string" ? databaseCode : null,
    });
  });

  const abortController = new AbortController();
  const stop = () => abortController.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const port = new PostgresAgentV1OutboxPort({
    query: async <Row>(config: {
      readonly name: string;
      readonly text: string;
      readonly values: readonly unknown[];
    }) => {
      const result = await pool.query({
        name: config.name,
        text: config.text,
        values: [...config.values],
      });
      return {
        rowCount: result.rowCount,
        rows: result.rows as readonly Row[],
      };
    },
  });
  console.info("[agent-v1-outbox] started", {
    workerId,
    concurrency,
    claimLimit,
    leaseMs,
  });
  try {
    await superviseProductOutbox(port, {
      workerId,
      concurrency,
      claimLimit,
      leaseMs,
      idlePollMs,
      failureBackoffMs,
      signal: abortController.signal,
      onReport(report) {
        const degraded = report.released > 0 || report.ackFailures > 0;
        void writeOutboxHealth({
          status: degraded ? "degraded" : "ready",
          ...(degraded
            ? { last_failure_at: new Date().toISOString() }
            : { last_success_at: new Date().toISOString() }),
          claimed: report.claimed,
          delivered: report.delivered,
          released: report.released,
        });
        if (report.claimed > 0) {
          console.info("[agent-v1-outbox] bounded pass complete", report);
        }
      },
      onFailure(failure) {
        void writeOutboxHealth({
          status: "degraded",
          last_failure_at: new Date().toISOString(),
          failure_class: failure.class,
        });
        console.warn("[agent-v1-outbox] bounded pass failed", failure);
      },
    });
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await pool.end();
  }
  console.info("[agent-v1-outbox] stopped", { workerId });
}

/**
 * The container healthcheck must reflect a successful database pass, not just
 * that the worker JavaScript file exists. Keep this heartbeat content-free and
 * in tmpfs so it cannot become a second durable state store.
 */
async function writeOutboxHealth(value: {
  readonly status: "ready" | "degraded";
  readonly last_success_at?: string;
  readonly last_failure_at?: string;
  readonly claimed?: number;
  readonly delivered?: number;
  readonly released?: number;
  readonly failure_class?: string;
}): Promise<void> {
  const temporary = `${OUTBOX_HEALTH_FILE}.${process.pid}.tmp`;
  try {
    await writeFile(
      temporary,
      `${JSON.stringify({ schema_version: 1, ...value })}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await rename(temporary, OUTBOX_HEALTH_FILE);
  } catch (error) {
    // A health-file write must never stop the outbox worker. The database pass
    // remains authoritative; this only lets orchestration observe it.
    console.warn("[agent-v1-outbox] health heartbeat write failed", {
      class: error instanceof Error ? error.name : "UnknownHealthWriteFailure",
    });
  }
}

export function resolveConnectionString(
  env: Record<string, string | undefined>,
): string | null {
  const explicit = firstNonEmpty(
    env.AGENT_V1_OUTBOX_DATABASE_URL,
    env.AGENT_V1_DATABASE_URL,
    env.SUPABASE_DB_URL,
    env.DATABASE_URL,
    env.POSTGRES_URL,
  );
  if (explicit) return explicit;
  return deriveSupabaseDatabaseUrl(
    env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_DB_PASSWORD,
    env.SUPABASE_DB_PORT,
  );
}

function boundedEnv(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) throw new Error(`invalid_${name.toLowerCase()}`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`invalid_${name.toLowerCase()}`);
  }
  return value;
}

main().catch((error) => {
  console.error("[agent-v1-outbox] fatal", {
    class:
      error instanceof Error && error.name.length <= 128
        ? error.name || "UnknownOutboxFailure"
        : "UnknownOutboxFailure",
  });
  process.exitCode = 1;
});
