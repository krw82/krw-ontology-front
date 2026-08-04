import { describe, expect, it, vi } from "vitest";
import type { JsonObject } from "./canonical-json";
import {
  RustAgentProductHost,
  RustAgentProductCancellation,
  createHostTsCancelEncoder,
  createHostTsClaimEncoder,
  type AtomicProductCancelRequest,
  type AtomicProductEnqueueRequest,
  type ProductCancelStore,
  type ProductRunStore,
} from "./product-host";

const RUN_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000002";
const SESSION_ID = "10000000-0000-4000-8000-000000000003";
const MESSAGE_ID = "10000000-0000-4000-8000-000000000004";
const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;

describe("RustAgentProductHost", () => {
  it("uses host-ts as the only claim compiler and sends one atomic product request", async () => {
    const build = vi.fn(() => unencodedClaim());
    const encode = vi.fn((_procedure: string, claim: JsonObject) => ({
      ...claim,
      abi_version: 1,
      mutation_hash: HASH_B,
    }));
    const store = new CapturingStore();
    const host = new RustAgentProductHost(
      pinnedDescriptor(),
      createHostTsClaimEncoder({
        buildEnqueueRunRequest: build,
        encodeProcedureRequest: encode,
      }),
      store,
    );

    const result = await host.enqueue(productInput());

    expect(build).toHaveBeenCalledOnce();
    expect(encode).toHaveBeenCalledWith("agent_v1.enqueue_run", expect.any(Object));
    expect(store.request).toMatchObject({
      schema_version: 1,
      descriptor_artifact_hash: HASH_A,
      release_set_hash: HASH_B,
      product: {
        run_id: RUN_ID,
        user_id: USER_ID,
        session_id: SESSION_ID,
        user_message_id: MESSAGE_ID,
        request_id: "request-1",
        run_kind: "company_research",
      },
      agent_request: {
        run_id: RUN_ID,
        mutation_hash: HASH_B,
      },
    });
    expect(Object.hasOwn(store.request?.product ?? {}, "model")).toBe(false);
    expect(result.kernelOutcome).toBe("enqueued");
  });

  it("fails closed when an encoder changes a server-derived identity", async () => {
    const store = new CapturingStore();
    const host = new RustAgentProductHost(
      pinnedDescriptor(),
      {
        encode() {
          return {
            ...unencodedClaim(),
            abi_version: 1,
            mutation_hash: HASH_B,
            session_id: "10000000-0000-4000-8000-000000000099",
          };
        },
      },
      store,
    );

    await expect(host.enqueue(productInput())).rejects.toMatchObject({
      code: "encoded_session_id_mismatch",
    });
    expect(store.request).toBeNull();
  });
});

describe("RustAgentProductCancellation", () => {
  it("uses host-ts mutation hashing and sends one ownership-bound cancel", async () => {
    let request: AtomicProductCancelRequest | null = null;
    const store: ProductCancelStore = {
      async cancel(value) {
        request = value;
        return {
          outcome: "cancelled",
          runId: RUN_ID,
          kernelOutcome: "cancelled",
        };
      },
    };
    const cancellation = new RustAgentProductCancellation(
      createHostTsCancelEncoder({
        encodeProcedureRequest(_procedure, value) {
          return { ...value, abi_version: 1, mutation_hash: HASH_A };
        },
      }),
      store,
    );

    await cancellation.cancel({
      mutationId: "cancel:request-1",
      runId: RUN_ID,
      userId: USER_ID,
      tenantId: USER_ID,
      sessionId: SESSION_ID,
      reasonCode: "user_cancelled",
      release: { schema_version: 1, request_id: "request-1" },
    });

    expect(request).toMatchObject({
      schema_version: 1,
      product: { run_id: RUN_ID, user_id: USER_ID, session_id: SESSION_ID },
      agent_request: {
        abi_version: 1,
        mutation_hash: HASH_A,
        reason_code: "user_cancelled",
      },
    });
  });
});

class CapturingStore implements ProductRunStore {
  request: AtomicProductEnqueueRequest | null = null;

  async enqueue(request: AtomicProductEnqueueRequest) {
    this.request = request;
    return {
      outcome: "enqueued" as const,
      runId: request.product.run_id,
      assistantMessageId: MESSAGE_ID,
      queuedAt: "2026-08-02T00:00:00.000Z",
      kernelOutcome: "enqueued" as const,
    };
  }
}

function pinnedDescriptor() {
  return {
    descriptor: { release_set_hash: HASH_B, entries: [] as const },
    identity: {
      artifactHash: HASH_A,
      releaseSetHash: HASH_B,
      fileDevice: 1n,
      fileInode: 2n,
      fileSize: 100,
    },
  } as const;
}

function productInput() {
  return {
    runId: RUN_ID,
    mutationId: "enqueue:request-1",
    requestId: "request-1",
    userId: USER_ID,
    tenantId: USER_ID,
    principalId: USER_ID,
    sessionId: SESSION_ID,
    userMessageId: MESSAGE_ID,
    runKind: "company_research",
    locale: "ko-KR",
    question: "이 회사를 분석해줘",
    context: { kind: "company_ticker_set", tickers: ["AAPL"] } as const,
    sessionMemory: null,
    webCommit: "dev",
    runtimeEnvironment: "dev" as const,
  };
}

function unencodedClaim(): JsonObject {
  return {
    mutation_id: "enqueue:request-1",
    run_id: RUN_ID,
    tenant_id: USER_ID,
    principal_id: USER_ID,
    session_id: SESSION_ID,
    agent_image_hash: HASH_A,
    runtime_version: "runtime-1",
    priority: 0,
    immutable_snapshot_hash: HASH_A,
    immutable_snapshot: {},
    resource_profile: {},
    budgets: {},
  };
}
