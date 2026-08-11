import { randomUUID } from "node:crypto";
import { Pool } from "pg";
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

let runtimePromise: Promise<RustAgentRuntime> | null = null;

/**
 * The release descriptor and DB pool are process-scoped. A request never
 * rereads the descriptor, recompiles a worker, or creates a new pool.
 */
export function getRustAgentRuntime(): Promise<RustAgentRuntime> {
  runtimePromise ??= createRustAgentRuntime();
  return runtimePromise;
}

export function resetRustAgentRuntimeForTests(): void {
  runtimePromise = null;
}

async function createRustAgentRuntime(): Promise<RustAgentRuntime> {
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
    ssl: shouldUseTls(connectionString)
      ? { rejectUnauthorized: false }
      : undefined,
  });
  pool.on("error", (error) => {
    console.warn("[agent-v1-host] idle database client failed", {
      class: error.name,
      code: databaseCode(error),
    });
  });

  const query = createQueryClient(pool);
  return {
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

function isObject(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function databaseCode(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? code : null;
}

function shouldUseTls(connectionString: string): boolean {
  return connectionString.startsWith("postgres://") || connectionString.startsWith("postgresql://");
}
