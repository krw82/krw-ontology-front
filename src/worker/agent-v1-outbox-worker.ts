import { randomUUID } from "node:crypto";
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
  shouldUsePostgresListenSsl,
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

async function main(): Promise<void> {
  const connectionString = resolveConnectionString(process.env);
  if (!connectionString) throw new Error("agent_v1_outbox_database_url_missing");

  const pool = new Pool({
    connectionString,
    application_name: "krw-front-agent-v1-outbox",
    max: concurrency + 2,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
    ssl: shouldUsePostgresListenSsl(connectionString)
      ? { rejectUnauthorized: false }
      : undefined,
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
        if (report.claimed > 0) {
          console.info("[agent-v1-outbox] bounded pass complete", report);
        }
      },
      onFailure(failure) {
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

export function resolveConnectionString(
  env: Record<string, string | undefined>,
): string | null {
  const explicit = firstNonEmpty(
    env.AGENT_V1_OUTBOX_DATABASE_URL,
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
