import {
  canonicalHash,
  isContentHash,
  isJsonValue,
  type ContentHash,
  type JsonObject,
  type JsonValue,
} from "./canonical-json";
import {
  ProductHostContractError,
} from "./product-host";
import {
  exactObject,
  executeFixed,
  type PgQueryClient,
} from "./postgres-transport";

export type AgentV1ProductOutboxKind =
  | "answer.committed"
  | "answer.presentation"
  | "answer.billing"
  | "answer.notification"
  | "run.cancelled"
  | "run.failed"
  | "run.deferred";

export interface AgentV1OutboxReceipt {
  readonly outbox_id: number;
  readonly run_id: string;
  readonly event_kind: AgentV1ProductOutboxKind;
  readonly dedupe_key: string;
  readonly payload: JsonValue;
  readonly delivery_attempts: number;
  readonly delivery_deadline: string;
}

export interface AgentV1OutboxPort {
  claim(
    workerId: string,
    limit: number,
    leaseMs: number,
  ): Promise<readonly AgentV1OutboxReceipt[]>;
  apply(
    event: AgentV1OutboxReceipt,
  ): Promise<"applied" | "already_applied" | "ignored">;
  ack(
    workerId: string,
    outboxId: number,
    result:
      | { readonly success: true }
      | { readonly success: false; readonly errorHash: ContentHash },
  ): Promise<"delivered" | "already_delivered" | "released" | "already_released">;
}

export interface DispatchProductOutboxOptions {
  readonly workerId: string;
  readonly claimLimit: number;
  readonly leaseMs: number;
  readonly concurrency: number;
}

export interface DispatchProductOutboxReport {
  readonly claimed: number;
  readonly applied: number;
  readonly alreadyApplied: number;
  readonly ignored: number;
  readonly delivered: number;
  readonly released: number;
  readonly ackFailures: number;
}

/** One bounded pass; it creates no timers and no run/session-owned tasks. */
export async function dispatchProductOutboxOnce(
  port: AgentV1OutboxPort,
  options: DispatchProductOutboxOptions,
): Promise<DispatchProductOutboxReport> {
  validateIdentifier(options.workerId, "worker_id", 128);
  boundedInteger(options.claimLimit, 1, 100, "claim_limit");
  boundedInteger(options.leaseMs, 1_000, 600_000, "lease_ms");
  boundedInteger(options.concurrency, 1, 16, "concurrency");

  const events = await port.claim(
    options.workerId,
    options.claimLimit,
    options.leaseMs,
  );
  if (events.length > options.claimLimit) {
    throw new ProductHostContractError("outbox_claim_exceeds_limit");
  }

  let cursor = 0;
  let applied = 0;
  let alreadyApplied = 0;
  let ignored = 0;
  let delivered = 0;
  let released = 0;
  let ackFailures = 0;
  const workerCount = Math.min(options.concurrency, events.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      for (;;) {
        const index = cursor;
        cursor += 1;
        const event = events[index];
        if (!event) return;

        let projectionCommitted = false;
        try {
          const outcome = await port.apply(event);
          projectionCommitted = true;
          if (outcome === "applied") applied += 1;
          else if (outcome === "already_applied") alreadyApplied += 1;
          else ignored += 1;

          try {
            await port.ack(options.workerId, event.outbox_id, { success: true });
            delivered += 1;
          } catch {
            // Keep the successful product projection. Lease expiry will replay
            // it and the product receipt makes that replay a no-op.
            ackFailures += 1;
          }
        } catch (error) {
          if (projectionCommitted) continue;
          const errorHash = canonicalHash(redactedFailureClass(error));
          try {
            await port.ack(options.workerId, event.outbox_id, {
              success: false,
              errorHash,
            });
            released += 1;
          } catch {
            ackFailures += 1;
          }
        }
      }
    }),
  );

  return {
    claimed: events.length,
    applied,
    alreadyApplied,
    ignored,
    delivered,
    released,
    ackFailures,
  };
}

const CLAIM_STATEMENT = Object.freeze({
  name: "krw_front_agent_v1_claim_outbox",
  text: "SELECT agent_v1.claim_outbox($1::jsonb) AS result",
});
const ACK_STATEMENT = Object.freeze({
  name: "krw_front_agent_v1_ack_outbox",
  text: "SELECT agent_v1.ack_outbox($1::jsonb) AS result",
});
const APPLY_STATEMENT = Object.freeze({
  name: "krw_front_agent_v1_apply_product_outbox",
  text: "SELECT public.apply_agent_v1_product_outbox($1::jsonb) AS result",
});
const PRODUCT_MAPPING_STATEMENT = Object.freeze({
  name: "krw_front_agent_v1_product_mapping_exists",
  text: "SELECT EXISTS(SELECT 1 FROM public.agent_v1_product_run_mappings WHERE run_id=$1::uuid) AS is_product",
});

export class PostgresAgentV1OutboxPort implements AgentV1OutboxPort {
  constructor(private readonly client: PgQueryClient) {}

  async claim(
    workerId: string,
    limit: number,
    leaseMs: number,
  ): Promise<readonly AgentV1OutboxReceipt[]> {
    validateIdentifier(workerId, "worker_id", 128);
    boundedInteger(limit, 1, 100, "outbox_limit");
    boundedInteger(leaseMs, 1_000, 600_000, "outbox_lease_ms");
    const response = exactObject(
      await executeFixed(this.client, "claim_outbox", CLAIM_STATEMENT, {
        abi_version: 1,
        worker_id: workerId,
        limit,
        lease_ms: leaseMs,
      }),
      ["events"],
    );
    if (!Array.isArray(response.events) || response.events.length > 100) {
      throw new ProductHostContractError("invalid_outbox_events");
    }
    return response.events.map(parseOutboxReceipt);
  }

  async apply(
    event: AgentV1OutboxReceipt,
  ): Promise<"applied" | "already_applied" | "ignored"> {
    // This worker owns only product chat runs. Local CLI/quality runs can use
    // the same Agent V1 database, but they have no product mapping and must
    // not poison the product queue with an invalid UUID cast or retries.
    if (!isUuid(event.run_id) || !(await this.hasProductMapping(event.run_id))) {
      return "ignored";
    }
    const eventObject = event as unknown as JsonObject;
    const response = exactObject(
      await executeFixed(this.client, "apply_product_outbox", APPLY_STATEMENT, {
        schema_version: 1,
        event_hash: canonicalHash(eventObject),
        event: eventObject,
      }),
      ["outcome", "run_id", "dedupe_key"],
    );
    if (response.outcome !== "applied" && response.outcome !== "already_applied") {
      throw new ProductHostContractError("invalid_product_outbox_outcome");
    }
    if (response.run_id !== event.run_id || response.dedupe_key !== event.dedupe_key) {
      throw new ProductHostContractError("product_outbox_identity_mismatch");
    }
    return response.outcome;
  }

  private async hasProductMapping(runId: string): Promise<boolean> {
    const result = await this.client.query<{ readonly is_product: unknown }>({
      ...PRODUCT_MAPPING_STATEMENT,
      values: [runId],
    });
    if (result.rowCount !== 1 || result.rows.length !== 1) {
      throw new ProductHostContractError("product_mapping_response_cardinality");
    }
    const isProduct = result.rows[0]?.is_product;
    if (typeof isProduct !== "boolean") {
      throw new ProductHostContractError("invalid_product_mapping_response");
    }
    return isProduct;
  }

  async ack(
    workerId: string,
    outboxId: number,
    result:
      | { readonly success: true }
      | { readonly success: false; readonly errorHash: ContentHash },
  ): Promise<"delivered" | "already_delivered" | "released" | "already_released"> {
    validateIdentifier(workerId, "worker_id", 128);
    boundedInteger(outboxId, 1, Number.MAX_SAFE_INTEGER, "outbox_id");
    if (!result.success && !isContentHash(result.errorHash)) {
      throw new ProductHostContractError("invalid_outbox_error_hash");
    }
    const request: JsonObject = result.success
      ? {
          abi_version: 1,
          worker_id: workerId,
          outbox_id: outboxId,
          success: true,
        }
      : {
          abi_version: 1,
          worker_id: workerId,
          outbox_id: outboxId,
          success: false,
          error_hash: result.errorHash,
        };
    const response = exactObject(
      await executeFixed(this.client, "ack_outbox", ACK_STATEMENT, request),
      ["outcome", "outbox_id"],
    );
    if (response.outbox_id !== outboxId) {
      throw new ProductHostContractError("outbox_ack_id_mismatch");
    }
    if (
      response.outcome !== "delivered" &&
      response.outcome !== "already_delivered" &&
      response.outcome !== "released" &&
      response.outcome !== "already_released"
    ) {
      throw new ProductHostContractError("invalid_outbox_ack_outcome");
    }
    return response.outcome;
  }
}

function parseOutboxReceipt(value: unknown): AgentV1OutboxReceipt {
  const object = exactObject(value, [
    "outbox_id",
    "run_id",
    "event_kind",
    "dedupe_key",
    "payload",
    "delivery_attempts",
    "delivery_deadline",
  ]);
  boundedInteger(object.outbox_id, 1, Number.MAX_SAFE_INTEGER, "outbox_id");
  validateIdentifier(asString(object.run_id, "run_id"), "run_id", 128);
  if (!OUTBOX_KINDS.has(object.event_kind as AgentV1ProductOutboxKind)) {
    throw new ProductHostContractError("unsupported_outbox_event");
  }
  validateIdentifier(asString(object.dedupe_key, "dedupe_key"), "dedupe_key", 256);
  boundedInteger(
    object.delivery_attempts,
    1,
    Number.MAX_SAFE_INTEGER,
    "delivery_attempts",
  );
  if (
    typeof object.delivery_deadline !== "string" ||
    Number.isNaN(Date.parse(object.delivery_deadline))
  ) {
    throw new ProductHostContractError("invalid_delivery_deadline");
  }
  if (!isJsonValue(object.payload)) {
    throw new ProductHostContractError("invalid_outbox_payload");
  }
  return object as unknown as AgentV1OutboxReceipt;
}

function redactedFailureClass(error: unknown): JsonObject {
  return {
    class:
      error instanceof Error && error.name.length > 0 && error.name.length <= 128
        ? error.name
        : "UnknownOutboxFailure",
  };
}

function validateIdentifier(value: string, field: string, maxBytes: number): void {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > maxBytes ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
  ) {
    throw new ProductHostContractError(`invalid_${field}`);
  }
}

function boundedInteger(
  value: unknown,
  min: number,
  max: number,
  field: string,
): void {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new ProductHostContractError(`invalid_${field}`);
  }
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new ProductHostContractError(`invalid_${field}`);
  return value;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const OUTBOX_KINDS = new Set<AgentV1ProductOutboxKind>([
  "answer.committed",
  "answer.presentation",
  "answer.billing",
  "answer.notification",
  "run.cancelled",
  "run.failed",
  "run.deferred",
]);
