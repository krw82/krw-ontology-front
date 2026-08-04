import {
  canonicalHash,
  isContentHash,
  isJsonValue,
  type JsonObject,
} from "./canonical-json";
import {
  ProductHostContractError,
  type AtomicProductEnqueueRequest,
  type AtomicProductEnqueueResult,
  type AtomicProductCancelRequest,
  type AtomicProductCancelResult,
  type ProductCancelStore,
  type ProductRunStore,
} from "./product-host";

export interface PgQueryResult<Row> {
  readonly rowCount: number | null;
  readonly rows: readonly Row[];
}

export interface PgQueryClient {
  query<Row>(config: {
    readonly name: string;
    readonly text: string;
    readonly values: readonly unknown[];
  }): Promise<PgQueryResult<Row>>;
}

export class RedactedAgentDatabaseError extends Error {
  constructor(
    readonly operation: string,
    readonly sqlstate: string | null,
    readonly diagnosticHash: string,
  ) {
    super(`agent database operation failed: ${operation}`);
    this.name = "RedactedAgentDatabaseError";
  }
}

const PRODUCT_ENQUEUE_STATEMENT = Object.freeze({
  name: "krw_front_agent_v1_product_enqueue",
  text: "SELECT public.enqueue_agent_v1_product_run($1::jsonb) AS result",
});
const PRODUCT_CANCEL_STATEMENT = Object.freeze({
  name: "krw_front_agent_v1_product_cancel",
  text: "SELECT public.cancel_agent_v1_product_run($1::jsonb) AS result",
});

export class PostgresProductRunStore implements ProductRunStore {
  constructor(private readonly client: PgQueryClient) {}

  async enqueue(
    request: AtomicProductEnqueueRequest,
  ): Promise<AtomicProductEnqueueResult> {
    const value = await executeFixed(
      this.client,
      "product_enqueue",
      PRODUCT_ENQUEUE_STATEMENT,
      request,
    );
    const result = exactObject(value, [
      "outcome",
      "run_id",
      "assistant_message_id",
      "queued_at",
      "kernel_outcome",
    ]);
    if (result.outcome !== "enqueued" && result.outcome !== "already_enqueued") {
      throw new ProductHostContractError("invalid_product_enqueue_outcome");
    }
    if (result.run_id !== request.product.run_id) {
      throw new ProductHostContractError("product_enqueue_run_id_mismatch");
    }
    if (
      typeof result.assistant_message_id !== "string" ||
      typeof result.queued_at !== "string" ||
      Number.isNaN(Date.parse(result.queued_at)) ||
      (result.kernel_outcome !== "enqueued" &&
        result.kernel_outcome !== "already_enqueued")
    ) {
      throw new ProductHostContractError("invalid_product_enqueue_response");
    }
    return {
      outcome: result.outcome,
      runId: result.run_id,
      assistantMessageId: result.assistant_message_id,
      queuedAt: result.queued_at,
      kernelOutcome: result.kernel_outcome,
    };
  }
}

export class PostgresProductCancelStore implements ProductCancelStore {
  constructor(private readonly client: PgQueryClient) {}

  async cancel(
    request: AtomicProductCancelRequest,
  ): Promise<AtomicProductCancelResult> {
    const value = await executeFixed(
      this.client,
      "product_cancel",
      PRODUCT_CANCEL_STATEMENT,
      request,
    );
    const result = exactObject(value, ["outcome", "run_id", "kernel_outcome"]);
    const outcomes = new Set([
      "cancelled",
      "already_final",
      "already_cancelled",
      "already_failed",
    ]);
    if (
      typeof result.outcome !== "string" ||
      !outcomes.has(result.outcome) ||
      result.kernel_outcome !== result.outcome ||
      result.run_id !== request.product.run_id
    ) {
      throw new ProductHostContractError("invalid_product_cancel_response");
    }
    return {
      outcome: result.outcome as AtomicProductCancelResult["outcome"],
      runId: result.run_id,
      kernelOutcome: result.outcome as AtomicProductCancelResult["outcome"],
    };
  }
}

export interface FixedStatement {
  readonly name: string;
  readonly text: string;
}

export async function executeFixed(
  client: PgQueryClient,
  operation: string,
  statement: FixedStatement,
  request: JsonObject,
): Promise<unknown> {
  try {
    const result = await client.query<{ readonly result: unknown }>({
      name: statement.name,
      text: statement.text,
      values: [request],
    });
    if (result.rowCount !== 1 || result.rows.length !== 1) {
      throw new ProductHostContractError("database_response_cardinality");
    }
    const row = result.rows[0];
    if (!row || Object.keys(row).length !== 1 || !Object.hasOwn(row, "result")) {
      throw new ProductHostContractError("database_response_shape");
    }
    if (!isJsonValue(row.result)) {
      throw new ProductHostContractError("database_result_not_json");
    }
    return row.result;
  } catch (error) {
    if (error instanceof ProductHostContractError) throw error;
    const sqlstate = databaseCode(error);
    throw new RedactedAgentDatabaseError(
      operation,
      sqlstate,
      canonicalHash({
        class:
          error instanceof Error && error.name.length <= 128
            ? error.name || "UnknownDatabaseFailure"
            : "UnknownDatabaseFailure",
        sqlstate,
      }),
    );
  }
}

export function exactObject(
  value: unknown,
  expectedKeys: readonly string[],
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ProductHostContractError("response_not_object");
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expectedKeys].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new ProductHostContractError("unknown_or_missing_response_field");
  }
  return value as Record<string, unknown>;
}

export function requireContentHash(value: unknown, field: string): string {
  if (!isContentHash(value)) throw new ProductHostContractError(`invalid_${field}`);
  return value;
}

function databaseCode(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  const code = Reflect.get(error, "code");
  return typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? code : null;
}
