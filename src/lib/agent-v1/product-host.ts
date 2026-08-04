import {
  canonicalHash,
  isContentHash,
  isJsonValue,
  type ContentHash,
  type JsonObject,
  type JsonValue,
} from "./canonical-json";
import type { PinnedReleaseDescriptor } from "./release-descriptor";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

export class ProductHostContractError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ProductHostContractError";
  }
}

export interface HostTsRunInput<
  TContext extends JsonValue,
  TSessionMemory extends JsonValue | null,
> {
  readonly mutationId: string;
  readonly runId: string;
  readonly tenantId: string;
  readonly principalId: string;
  readonly sessionId: string;
  readonly runKind: string;
  readonly locale: string;
  readonly question: string;
  readonly context: TContext;
  readonly sessionMemory: TSessionMemory;
}

/** Structural bridge implemented with @krw-agent/host at composition time. */
export interface HostTsClaimEncoder<
  TDescriptor,
  TContext extends JsonValue,
  TSessionMemory extends JsonValue | null,
> {
  encode(
    descriptor: TDescriptor,
    input: HostTsRunInput<TContext, TSessionMemory>,
  ): JsonObject;
}

export interface HostTsClaimApi<
  TDescriptor,
  TContext extends JsonValue,
  TSessionMemory extends JsonValue | null,
> {
  buildEnqueueRunRequest(
    descriptor: TDescriptor,
    input: HostTsRunInput<TContext, TSessionMemory>,
  ): JsonObject;
  encodeProcedureRequest(
    procedure: "agent_v1.enqueue_run",
    request: JsonObject,
  ): JsonObject;
}

export function createHostTsClaimEncoder<
  TDescriptor,
  TContext extends JsonValue,
  TSessionMemory extends JsonValue | null,
>(
  api: HostTsClaimApi<TDescriptor, TContext, TSessionMemory>,
): HostTsClaimEncoder<TDescriptor, TContext, TSessionMemory> {
  return {
    encode(descriptor, input) {
      return api.encodeProcedureRequest(
        "agent_v1.enqueue_run",
        api.buildEnqueueRunRequest(descriptor, input),
      );
    },
  };
}

export interface ProductRunInput<
  TContext extends JsonValue,
  TSessionMemory extends JsonValue | null,
> {
  readonly runId: string;
  readonly mutationId: string;
  readonly requestId: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly principalId: string;
  readonly sessionId: string;
  readonly userMessageId: string;
  readonly runKind: string;
  readonly locale: string;
  readonly question: string;
  readonly context: TContext;
  readonly sessionMemory: TSessionMemory;
  readonly webCommit: string;
  readonly runtimeEnvironment: "dev" | "staging" | "prod";
}

export interface AtomicProductEnqueueRequest extends JsonObject {
  readonly schema_version: 1;
  readonly descriptor_artifact_hash: ContentHash;
  readonly release_set_hash: ContentHash;
  readonly agent_request: JsonObject;
  readonly product: {
    readonly run_id: string;
    readonly user_id: string;
    readonly session_id: string;
    readonly user_message_id: string;
    readonly request_id: string;
    readonly run_kind: string;
    readonly locale: string;
    readonly web_commit: string;
    readonly runtime_environment: "dev" | "staging" | "prod";
  };
}

export interface AtomicProductEnqueueResult {
  readonly outcome: "enqueued" | "already_enqueued";
  readonly runId: string;
  readonly assistantMessageId: string;
  readonly queuedAt: string;
  readonly kernelOutcome: "enqueued" | "already_enqueued";
}

export interface ProductRunStore {
  enqueue(request: AtomicProductEnqueueRequest): Promise<AtomicProductEnqueueResult>;
}

export interface ProductCancelInput {
  readonly mutationId: string;
  readonly runId: string;
  readonly userId: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly reasonCode: string;
  readonly release: JsonValue;
}

export interface AtomicProductCancelRequest extends JsonObject {
  readonly schema_version: 1;
  readonly agent_request: JsonObject;
  readonly product: {
    readonly run_id: string;
    readonly user_id: string;
    readonly session_id: string;
  };
}

export interface AtomicProductCancelResult {
  readonly outcome:
    | "cancelled"
    | "already_final"
    | "already_cancelled"
    | "already_failed";
  readonly runId: string;
  readonly kernelOutcome: AtomicProductCancelResult["outcome"];
}

export interface ProductCancelStore {
  cancel(request: AtomicProductCancelRequest): Promise<AtomicProductCancelResult>;
}

export interface HostTsCancelEncoder {
  encode(input: {
    readonly mutationId: string;
    readonly runId: string;
    readonly tenantId: string;
    readonly reasonCode: string;
    readonly release: JsonValue;
  }): JsonObject;
}

export interface HostTsCancelApi {
  encodeProcedureRequest(
    procedure: "agent_v1.request_cancel",
    request: JsonObject,
  ): JsonObject;
}

export function createHostTsCancelEncoder(api: HostTsCancelApi): HostTsCancelEncoder {
  return {
    encode(input) {
      return api.encodeProcedureRequest("agent_v1.request_cancel", {
        mutation_id: input.mutationId,
        run_id: input.runId,
        tenant_id: input.tenantId,
        reason_code: input.reasonCode,
        release: input.release,
      });
    },
  };
}

export class RustAgentProductCancellation {
  constructor(
    private readonly encoder: HostTsCancelEncoder,
    private readonly store: ProductCancelStore,
  ) {}

  async cancel(input: ProductCancelInput): Promise<AtomicProductCancelResult> {
    for (const [field, value] of [
      ["run_id", input.runId],
      ["user_id", input.userId],
      ["session_id", input.sessionId],
    ] as const) {
      if (!UUID_PATTERN.test(value)) {
        throw new ProductHostContractError(`invalid_${field}`);
      }
    }
    validateIdentifier(input.mutationId, "mutation_id", 128);
    validateIdentifier(input.tenantId, "tenant_id", 128);
    validateIdentifier(input.reasonCode, "reason_code", 64);
    if (!isJsonValue(input.release)) {
      throw new ProductHostContractError("invalid_cancel_release");
    }
    const encoded = this.encoder.encode(input);
    validateEncodedCancelRequest(encoded, input);
    return this.store.cancel({
      schema_version: 1,
      agent_request: encoded,
      product: {
        run_id: input.runId,
        user_id: input.userId,
        session_id: input.sessionId,
      },
    });
  }
}

/**
 * Product-only facade. Model, budget, capabilities, binding and prompt data can
 * only enter through the pinned daemon descriptor and @krw-agent/host encoder.
 */
export class RustAgentProductHost<
  TDescriptor extends { readonly release_set_hash: string },
  TContext extends JsonValue,
  TSessionMemory extends JsonValue | null,
> {
  constructor(
    private readonly release: PinnedReleaseDescriptor<TDescriptor>,
    private readonly encoder: HostTsClaimEncoder<
      TDescriptor,
      TContext,
      TSessionMemory
    >,
    private readonly store: ProductRunStore,
  ) {}

  async enqueue(
    input: ProductRunInput<TContext, TSessionMemory>,
  ): Promise<AtomicProductEnqueueResult> {
    validateProductRunInput(input);
    const hostInput: HostTsRunInput<TContext, TSessionMemory> = {
      mutationId: input.mutationId,
      runId: input.runId,
      tenantId: input.tenantId,
      principalId: input.principalId,
      sessionId: input.sessionId,
      runKind: input.runKind,
      locale: input.locale,
      question: input.question,
      context: input.context,
      sessionMemory: input.sessionMemory,
    };
    const agentRequest = this.encoder.encode(this.release.descriptor, hostInput);
    validateEncodedAgentRequest(agentRequest, hostInput);

    return this.store.enqueue({
      schema_version: 1,
      descriptor_artifact_hash: this.release.identity.artifactHash,
      release_set_hash: this.release.identity.releaseSetHash,
      agent_request: agentRequest,
      product: {
        run_id: input.runId,
        user_id: input.userId,
        session_id: input.sessionId,
        user_message_id: input.userMessageId,
        request_id: input.requestId,
        run_kind: input.runKind,
        locale: input.locale,
        web_commit: input.webCommit,
        runtime_environment: input.runtimeEnvironment,
      },
    });
  }
}

function validateProductRunInput<
  TContext extends JsonValue,
  TSessionMemory extends JsonValue | null,
>(
  input: ProductRunInput<TContext, TSessionMemory>,
): void {
  for (const [field, value] of [
    ["run_id", input.runId],
    ["user_id", input.userId],
    ["session_id", input.sessionId],
    ["user_message_id", input.userMessageId],
  ] as const) {
    if (!UUID_PATTERN.test(value)) throw new ProductHostContractError(`invalid_${field}`);
  }
  for (const [field, value, maxBytes] of [
    ["mutation_id", input.mutationId, 128],
    ["request_id", input.requestId, 128],
    ["tenant_id", input.tenantId, 128],
    ["principal_id", input.principalId, 128],
    ["run_kind", input.runKind, 128],
    ["locale", input.locale, 32],
    ["web_commit", input.webCommit, 128],
  ] as const) {
    validateIdentifier(value, field, maxBytes);
  }
  if (
    input.question.length === 0 ||
    input.question.includes("\0") ||
    Buffer.byteLength(input.question, "utf8") > 64 * 1024
  ) {
    throw new ProductHostContractError("invalid_question");
  }
  if (!isJsonValue(input.context)) {
    throw new ProductHostContractError("invalid_run_context");
  }
  if (input.sessionMemory !== null && !isJsonValue(input.sessionMemory)) {
    throw new ProductHostContractError("invalid_session_memory");
  }
}

function validateEncodedAgentRequest<
  TContext extends JsonValue,
  TSessionMemory extends JsonValue | null,
>(
  value: JsonObject,
  input: HostTsRunInput<TContext, TSessionMemory>,
): void {
  exactKeys(value, [
    "abi_version",
    "mutation_id",
    "mutation_hash",
    "run_id",
    "tenant_id",
    "principal_id",
    "session_id",
    "agent_image_hash",
    "runtime_version",
    "priority",
    "immutable_snapshot_hash",
    "immutable_snapshot",
    "resource_profile",
    "budgets",
  ]);
  if (value.abi_version !== 1 || value.priority !== 0) {
    throw new ProductHostContractError("unsupported_agent_v1_request");
  }
  for (const [field, actual, expected] of [
    ["mutation_id", value.mutation_id, input.mutationId],
    ["run_id", value.run_id, input.runId],
    ["tenant_id", value.tenant_id, input.tenantId],
    ["principal_id", value.principal_id, input.principalId],
    ["session_id", value.session_id, input.sessionId],
  ] as const) {
    if (actual !== expected) {
      throw new ProductHostContractError(`encoded_${field}_mismatch`);
    }
  }
  for (const [field, hash] of [
    ["mutation_hash", value.mutation_hash],
    ["agent_image_hash", value.agent_image_hash],
    ["immutable_snapshot_hash", value.immutable_snapshot_hash],
  ] as const) {
    if (!isContentHash(hash)) {
      throw new ProductHostContractError(`invalid_${field}`);
    }
  }
  if (
    typeof value.runtime_version !== "string" ||
    value.runtime_version.length === 0 ||
    !isJsonObject(value.immutable_snapshot) ||
    !isJsonObject(value.resource_profile) ||
    !isJsonObject(value.budgets)
  ) {
    throw new ProductHostContractError("invalid_encoded_claim_shape");
  }
}

function validateEncodedCancelRequest(
  value: JsonObject,
  input: ProductCancelInput,
): void {
  exactKeys(value, [
    "abi_version",
    "mutation_id",
    "mutation_hash",
    "run_id",
    "tenant_id",
    "reason_code",
    "release",
  ]);
  if (value.abi_version !== 1 || !isContentHash(value.mutation_hash)) {
    throw new ProductHostContractError("invalid_encoded_cancel_request");
  }
  for (const [field, actual, expected] of [
    ["mutation_id", value.mutation_id, input.mutationId],
    ["run_id", value.run_id, input.runId],
    ["tenant_id", value.tenant_id, input.tenantId],
    ["reason_code", value.reason_code, input.reasonCode],
  ] as const) {
    if (actual !== expected) {
      throw new ProductHostContractError(`encoded_cancel_${field}_mismatch`);
    }
  }
  if (!isJsonValue(value.release) || canonicalHash(value.release) !== canonicalHash(input.release)) {
    throw new ProductHostContractError("encoded_cancel_release_mismatch");
  }
}

function validateIdentifier(value: string, field: string, maxBytes: number): void {
  if (
    value.length === 0 ||
    value.includes("\0") ||
    Buffer.byteLength(value, "utf8") > maxBytes ||
    !IDENTIFIER_PATTERN.test(value)
  ) {
    throw new ProductHostContractError(`invalid_${field}`);
  }
}

function exactKeys(value: JsonObject, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new ProductHostContractError("unknown_or_missing_agent_request_field");
  }
}

function isJsonObject(value: unknown): value is JsonObject {
  return (
    isJsonValue(value) &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}
