import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";
import { resolvePostgresTls } from "@/lib/postgres/listen-config";
import {
  loadPinnedReleaseArtifact,
  prepareCancelRun,
  prepareEnqueueRun,
  type AuthenticatedRunOwnershipV1,
  type EnqueueContextIntentV1,
  type EnqueueRunIntentV1,
  type PinnedReleaseArtifact,
  type PreparedCancelRunV1,
  type PreparedEnqueueRunV1,
} from "@krw-agent/host";

export type RustResearchContext = EnqueueContextIntentV1;

export interface RustAgentEnqueueInput {
  readonly runId: string;
  readonly requestId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly userMessageId: string;
  readonly runKind: string;
  readonly locale: string;
  readonly question: string;
  readonly context: RustResearchContext;
}

export interface RustAgentEnqueueResult {
  readonly runId: string;
  readonly assistantMessageId: string;
  readonly queuedAt: string;
  readonly outcome: "enqueued" | "already_enqueued";
}

export interface RustAgentCancelInput {
  readonly runId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly reasonCode: "user_cancelled";
}

export interface RustAgentCancelResult {
  readonly runId: string;
  readonly outcome:
    | "cancelled"
    | "already_final"
    | "already_cancelled"
    | "already_failed";
}

export interface RustAgentRuntime {
  enqueue(input: RustAgentEnqueueInput): Promise<RustAgentEnqueueResult>;
  cancel(input: RustAgentCancelInput): Promise<RustAgentCancelResult>;
}

export class RustAgentRuntimeError extends Error {
  constructor(readonly code: string, cause?: unknown) {
    super(code, { cause });
    this.name = "RustAgentRuntimeError";
  }
}

interface RustAgentRuntimeEntry {
  readonly runtime: RustAgentRuntime;
  /** Close the process-scoped pool after in-flight queries have drained. */
  readonly close: () => Promise<void>;
}

let runtimePromise: Promise<RustAgentRuntimeEntry> | null = null;
let runtimeDisposePromise: Promise<void> | null = null;
let localRuntimeReleaseRevision: string | null = null;
// Track only keys injected from the generated local runtime file. This lets a
// provider cutover remove a stale value (for example glm -> deepseek) without
// deleting operator-provided environment variables that were never in that
// file.
let injectedLocalRuntimeEnvValues = new Map<string, string | undefined>();

const LOCAL_AGENT_RUNTIME_ENV_KEYS = new Set([
  "KRW_AGENT_BACKEND_MODE",
  "KRW_AGENT_PROVIDER",
  "KRW_AGENT_ADMISSION_MODE",
  "KRW_RUNTIME_ENVIRONMENT",
  "KRW_AGENT_TENANT_ID",
  "KRW_AGENT_RELEASE_DESCRIPTOR_PATH",
  "KRW_AGENT_RELEASE_ARTIFACT_HASH",
  "KRW_AGENT_RELEASE_SET_HASH",
  "AGENT_V1_DATABASE_URL",
]);
const LOCAL_AGENT_RUNTIME_ENV_MAX_BYTES = 16 * 1024;

/**
 * The release descriptor and DB pool are process-scoped. A request never
 * rereads the descriptor, recompiles a worker, or creates a new pool.
 */
export async function getRustAgentRuntime(): Promise<RustAgentRuntime> {
  const localReleaseRevision = await refreshLocalDevRuntimeEnvironment();
  if (localReleaseRevision === null && localRuntimeReleaseRevision !== null) {
    // The local daemon/env pin disappeared (normally because the stack was
    // stopped). Do not keep serving requests through a pool bound to the old
    // release/provider.
    localRuntimeReleaseRevision = null;
    await disposeRustAgentRuntime();
  }
  if (
    localReleaseRevision !== null &&
    localReleaseRevision !== localRuntimeReleaseRevision
  ) {
    // The local Rust stack writes a fresh immutable release descriptor whenever
    // its image changes. Reload that non-secret pin for the next request so a
    // web dev server can survive an engine restart without being restarted too.
    localRuntimeReleaseRevision = localReleaseRevision;
    await disposeRustAgentRuntime();
  }
  if (runtimeDisposePromise) await runtimeDisposePromise;
  if (runtimePromise) return (await runtimePromise).runtime;

  // A dev gateway or release descriptor can become available just after the
  // first chat request. Do not permanently cache that transient startup
  // failure: the next user request must get a fresh chance to initialize the
  // pinned runtime without requiring a Next.js restart.
  const created = createRustAgentRuntime();
  runtimePromise = created;
  void created.catch(() => {
    if (runtimePromise === created) runtimePromise = null;
  });
  return (await created).runtime;
}

export function resetRustAgentRuntimeForTests(): void {
  void disposeRustAgentRuntime();
  runtimePromise = null;
  localRuntimeReleaseRevision = null;
  for (const [key, previous] of injectedLocalRuntimeEnvValues) {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
  injectedLocalRuntimeEnvValues = new Map();
}

/**
 * Dispose the old process-scoped pool before a new provider/release is used.
 * `pg.Pool.end()` waits for checked-out clients, so a provider cutover does
 * not interrupt an in-flight enqueue; it only prevents the retired pool from
 * surviving indefinitely after the daemon has drained.
 */
async function disposeRustAgentRuntime(): Promise<void> {
  if (runtimeDisposePromise) return runtimeDisposePromise;
  const pending = runtimePromise;
  runtimePromise = null;
  if (!pending) return;

  const dispose = (async () => {
    try {
      const entry = await pending;
      await entry.close();
    } catch {
      // A failed initialization has no usable pool. Closing an already-ended
      // pool is idempotent; disposal must never mask the next readiness error.
    }
  })();
  runtimeDisposePromise = dispose;
  try {
    await dispose;
  } finally {
    if (runtimeDisposePromise === dispose) runtimeDisposePromise = null;
  }
}

/**
 * `npm run dev` and the local Rust stack can start in either order. The
 * frontend launcher reads this file at boot, but a request-time refresh keeps
 * the pinned host contract recoverable when the Rust stack was started later
 * or rebuilt while Next stayed open. The allowlist contains the local DB URL
 * as well as release metadata; the file is mode 0600 and the URL is never
 * logged. Only a content hash is retained as the in-process revision marker.
 */
async function refreshLocalDevRuntimeEnvironment(): Promise<string | null> {
  if (process.env.NODE_ENV !== "development") return null;

  const configuredPath = process.env.KRW_AGENT_FRONTEND_ENV_FILE?.trim();
  const runtimeEnvPath = configuredPath || join(
    homedir(),
    "krw-agnet",
    ".local",
    "agent-gateway-front-dev",
    "frontend.env",
  );

  let source: string;
  try {
    source = await readFile(runtimeEnvPath, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      restoreInjectedLocalRuntimeEnvironment();
      return null;
    }
    throw new RustAgentRuntimeError("agent_v1_local_runtime_env_unreadable", error);
  }
  if (Buffer.byteLength(source, "utf8") > LOCAL_AGENT_RUNTIME_ENV_MAX_BYTES) {
    throw new RustAgentRuntimeError("agent_v1_local_runtime_env_too_large");
  }

  const values = new Map<string, string>();
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new RustAgentRuntimeError("agent_v1_local_runtime_env_invalid");
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (!LOCAL_AGENT_RUNTIME_ENV_KEYS.has(key) || value.includes("\0")) {
      throw new RustAgentRuntimeError("agent_v1_local_runtime_env_invalid");
    }
    values.set(key, value);
  }

  for (const key of [...injectedLocalRuntimeEnvValues.keys()]) {
    if (!values.has(key)) restoreInjectedLocalRuntimeEnvironment(key);
  }
  for (const [key, value] of values) {
    if (!injectedLocalRuntimeEnvValues.has(key)) {
      injectedLocalRuntimeEnvValues.set(key, process.env[key]);
    }
    process.env[key] = value;
  }
  return `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`;
}

function restoreInjectedLocalRuntimeEnvironment(key?: string): void {
  const keys = key === undefined
    ? [...injectedLocalRuntimeEnvValues.keys()]
    : [key];
  for (const current of keys) {
    const previous = injectedLocalRuntimeEnvValues.get(current);
    if (previous === undefined) delete process.env[current];
    else process.env[current] = previous;
    injectedLocalRuntimeEnvValues.delete(current);
  }
}

async function createRustAgentRuntime(): Promise<RustAgentRuntimeEntry> {
  const artifact = await loadArtifactFromEnvironment();
  const connectionString = firstNonEmpty(
    process.env.AGENT_V1_DATABASE_URL,
    process.env.SUPABASE_DB_URL,
    process.env.DATABASE_URL,
    process.env.POSTGRES_URL,
  );
  if (!connectionString) {
    throw new RustAgentRuntimeError("agent_v1_database_url_missing");
  }

  const tenantId = firstNonEmpty(process.env.KRW_AGENT_TENANT_ID);
  if (!tenantId) throw new RustAgentRuntimeError("agent_v1_tenant_id_missing");

  const runtimeEnvironment = parseRuntimeEnvironment(
    process.env.KRW_RUNTIME_ENVIRONMENT,
  );
  const webCommit = firstNonEmpty(
    process.env.VERCEL_GIT_COMMIT_SHA,
    process.env.GIT_COMMIT,
    "unversioned",
  ) ?? "unversioned";
  const pool = new Pool({
    connectionString,
    application_name: "krw-front-agent-v1-host",
    max: 6,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    maxLifetimeSeconds: 300,
    ssl: resolvePostgresTls(connectionString),
  });
  pool.on("error", (error) => {
    console.warn("[agent-v1-host] idle database client failed", {
      class: error.name,
      code: databaseCode(error),
    });
  });

  const query = createQueryClient(pool);
  return {
    runtime: {
      async enqueue(input) {
        const ownership: AuthenticatedRunOwnershipV1 = {
          schema_version: 1,
          tenant_id: tenantId,
          principal_id: input.userId,
          session_id: input.sessionId,
          run_id: input.runId,
        };
        const intent: EnqueueRunIntentV1 = {
          mutation_id: `enqueue:${input.requestId}`,
          run_kind: input.runKind,
          locale: input.locale,
          question: input.question,
          context: input.context,
        };
        const prepared = await prepareEnqueueRun({
          artifact,
          ownership,
          intent,
          materializers: {
            committedAnswers: {
              async materializeCommittedAnswerSource() {
                throw new RustAgentRuntimeError("existing_answer_not_enabled");
              },
            },
          },
        });
        return enqueueProductRun(query, prepared, {
          userId: input.userId,
          sessionId: input.sessionId,
          userMessageId: input.userMessageId,
          requestId: input.requestId,
          runKind: input.runKind,
          locale: input.locale,
          runtimeEnvironment,
          webCommit,
        });
      },
      async cancel(input) {
        const ownership: AuthenticatedRunOwnershipV1 = {
          schema_version: 1,
          tenant_id: tenantId,
          principal_id: input.userId,
          session_id: input.sessionId,
          run_id: input.runId,
        };
        const prepared = prepareCancelRun({
          mutationId: `cancel:${randomUUID()}`,
          ownership,
          reasonCode: input.reasonCode,
          release: {
            schema_version: 1,
            release_id: randomUUID(),
            reason_code: input.reasonCode,
          },
        });
        return cancelProductRun(query, prepared, ownership);
      },
    },
    close: () => pool.end(),
  };
}

async function loadArtifactFromEnvironment(): Promise<PinnedReleaseArtifact> {
  const path = firstNonEmpty(process.env.KRW_AGENT_RELEASE_DESCRIPTOR_PATH);
  const expectedArtifactHash = firstNonEmpty(
    process.env.KRW_AGENT_RELEASE_ARTIFACT_HASH,
  );
  const expectedReleaseSetHash = firstNonEmpty(
    process.env.KRW_AGENT_RELEASE_SET_HASH,
  );
  if (!path || !expectedArtifactHash || !expectedReleaseSetHash) {
    throw new RustAgentRuntimeError("agent_v1_release_pin_missing");
  }
  try {
    return await loadPinnedReleaseArtifact({
      path,
      expectedArtifactHash: expectedArtifactHash as `sha256:${string}`,
      expectedReleaseSetHash: expectedReleaseSetHash as `sha256:${string}`,
    });
  } catch (error) {
    throw new RustAgentRuntimeError("agent_v1_release_descriptor_invalid", error);
  }
}

async function enqueueProductRun(
  client: QueryClient,
  prepared: PreparedEnqueueRunV1,
  product: {
    readonly userId: string;
    readonly sessionId: string;
    readonly userMessageId: string;
    readonly requestId: string;
    readonly runKind: string;
    readonly locale: string;
    readonly runtimeEnvironment: RuntimeEnvironment;
    readonly webCommit: string;
  },
): Promise<RustAgentEnqueueResult> {
  const result = await executeProductProcedure(client, "enqueue_agent_v1_product_run_v7", {
    schema_version: 1,
    descriptor_artifact_hash: prepared.release_pin.descriptor_artifact_hash,
    release_set_hash: prepared.release_pin.release_set_hash,
    agent_request: prepared.agent_request,
    product: {
      run_id: prepared.ownership.run_id,
      user_id: product.userId,
      session_id: product.sessionId,
      user_message_id: product.userMessageId,
      request_id: product.requestId,
      run_kind: product.runKind,
      locale: product.locale,
      web_commit: product.webCommit,
      runtime_environment: product.runtimeEnvironment,
    },
  });
  if (!isObject(result)) throw new RustAgentRuntimeError("invalid_enqueue_result");
  if (result.run_id !== prepared.ownership.run_id) {
    throw new RustAgentRuntimeError("enqueue_run_id_mismatch");
  }
  if (result.outcome !== "enqueued" && result.outcome !== "already_enqueued") {
    throw new RustAgentRuntimeError("invalid_enqueue_outcome");
  }
  if (
    typeof result.assistant_message_id !== "string" ||
    typeof result.queued_at !== "string" ||
    Number.isNaN(Date.parse(result.queued_at))
  ) {
    throw new RustAgentRuntimeError("invalid_enqueue_result_fields");
  }
  return {
    runId: result.run_id,
    assistantMessageId: result.assistant_message_id,
    queuedAt: result.queued_at,
    outcome: result.outcome,
  };
}

async function cancelProductRun(
  client: QueryClient,
  prepared: PreparedCancelRunV1,
  ownership: AuthenticatedRunOwnershipV1,
): Promise<RustAgentCancelResult> {
  const result = await executeProductProcedure(client, "cancel_agent_v1_product_run", {
    schema_version: 1,
    agent_request: prepared.agent_request,
    product: {
      run_id: ownership.run_id,
      user_id: ownership.principal_id,
      session_id: ownership.session_id,
    },
  });
  if (!isObject(result) || result.run_id !== ownership.run_id) {
    throw new RustAgentRuntimeError("invalid_cancel_result");
  }
  const outcomes = new Set([
    "cancelled",
    "already_final",
    "already_cancelled",
    "already_failed",
    "cancel_requested",
    "already_terminal",
  ]);
  if (typeof result.outcome !== "string" || !outcomes.has(result.outcome)) {
    throw new RustAgentRuntimeError("invalid_cancel_outcome");
  }
  const normalizedOutcome = result.outcome === "cancel_requested"
    ? "cancelled"
    : result.outcome === "already_terminal"
      ? "already_final"
      : result.outcome;
  return {
    runId: ownership.run_id,
    outcome: normalizedOutcome as RustAgentCancelResult["outcome"],
  };
}

type RuntimeEnvironment = "dev" | "staging" | "prod";

function parseRuntimeEnvironment(value: string | undefined): RuntimeEnvironment {
  if (value === "dev" || value === "staging" || value === "prod") return value;
  if (!value) return "dev";
  throw new RustAgentRuntimeError("invalid_runtime_environment");
}

interface QueryClient {
  query<Row>(config: {
    readonly name: string;
    readonly text: string;
    readonly values: readonly unknown[];
  }): Promise<{ readonly rowCount: number | null; readonly rows: readonly Row[] }>;
}

function createQueryClient(pool: Pool): QueryClient {
  return {
    async query<Row>(config: {
      readonly name: string;
      readonly text: string;
      readonly values: readonly unknown[];
    }) {
      const result = await pool.query({
        name: config.name,
        text: config.text,
        values: [...config.values],
      });
      return { rowCount: result.rowCount, rows: result.rows as readonly Row[] };
    },
  };
}

async function executeProductProcedure(
  client: QueryClient,
  operation:
    | "enqueue_agent_v1_product_run_v7"
    | "cancel_agent_v1_product_run",
  value: Record<string, unknown>,
): Promise<unknown> {
  const statement = operation === "enqueue_agent_v1_product_run_v7"
    ? {
        name: "krw_front_agent_v1_product_enqueue",
        text: "SELECT public.enqueue_agent_v1_product_run_v7($1::jsonb) AS result",
      }
    : {
        name: "krw_front_agent_v1_product_cancel",
        text: "SELECT public.cancel_agent_v1_product_run($1::jsonb) AS result",
      };
  try {
    const result = await client.query<{ readonly result: unknown }>({
      ...statement,
      values: [value],
    });
    if (result.rowCount !== 1 || result.rows.length !== 1) {
      throw new RustAgentRuntimeError("database_response_cardinality");
    }
    return result.rows[0]?.result;
  } catch (error) {
    if (error instanceof RustAgentRuntimeError) throw error;
    throw new RustAgentRuntimeError(operation, error);
  }
}

function firstNonEmpty(...values: Array<string | undefined>): string | null {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function databaseCode(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? code : null;
}

function errorCode(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" && code.length <= 64 ? code : null;
}
