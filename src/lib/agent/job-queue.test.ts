import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/agent/run-events", () => ({
  appendAgentRunEvent: vi.fn().mockResolvedValue(1),
}));

import { appendAgentRunEvent } from "@/lib/agent/run-events";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { HistoryResult } from "@/lib/api/chat/fetch-history";
import type { ResolvedSession } from "@/lib/api/chat/resolve-session";
import type { McpHealthResult } from "@/lib/agent/mcp-client";
import {
  claimNextAgentRun,
  enqueueAgentRun,
  heartbeatAgentRun,
  requestAgentRunCancel,
} from "./job-queue";

type ExistingRun = { id: string; session_id: string; request_id?: string };

const session = {
  id: "session-1",
  userId: "user-1",
  scopeType: "company",
  defaultTickers: ["AAPL"],
  defaultDocumentTypes: [],
} satisfies ResolvedSession;

const history = {
  userMessageId: "user-message-1",
  history: [{ role: "user", content: "Apple 매출 알려줘" }],
} satisfies HistoryResult;

const mcpHealth = {
  connected: true,
  staticOk: true,
  commandOk: true,
  liveOk: true,
  sqliteOk: true,
  env: "dev",
  releaseId: "release-1",
  manifestPath: "/srv/krw-ontology-data/current/manifest.json",
  manifestValid: true,
  agentIndexSchemaVersion: "agent_index_v1",
  indexGeneratedAt: "2026-05-25T00:00:00.000Z",
  companyCount: 74,
  documentCount: 300,
  objectCount: 1000,
  toolCount: 12,
  tools: ["krw_ontology_query"],
  root: "/srv/krw-ontology-data/current",
  indexPath: "/srv/krw-ontology-data/current/indexes/agent_index.sqlite",
  pluginPath: "/srv/krw-ontology/plugins/krw-ontology",
  releaseMetadata: {
    env: "dev",
    release_id: "release-1",
    manifest_valid: true,
  },
} satisfies McpHealthResult;

function createQueueAdmin(params: {
  requestLookups?: Array<ExistingRun | null>;
  messageInsertError?: { message: string; code?: string } | null;
  runInsertError?: { message: string; code?: string } | null;
  rpcResult?: { data: unknown; error: { code?: string; message: string } | null };
  cancelRun?: {
    status: "pending" | "queued" | "running" | "completed";
    assistant_message_id: string | null;
    request_id: string | null;
  } | null;
} = {}) {
  const inserted: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const deleted: Array<{ table: string; key: string; value: unknown }> = [];
  const updates: Array<{
    table: string;
    payload: Record<string, unknown>;
    filters: Record<string, unknown>;
    inFilters: Record<string, unknown[]>;
  }> = [];
  const requestLookups = [...(params.requestLookups ?? [null])];
  const rpc = vi.fn().mockResolvedValue(
    params.rpcResult ?? {
      data: [{ id: "run-claimed-1" }],
      error: null,
    },
  );

  const admin = {
    rpc,
    from(table: string) {
      return {
        insert(payload: Record<string, unknown>) {
          inserted.push({ table, payload });
          return {
            select() {
              return {
                single() {
                  if (table === "messages") {
                    if (params.messageInsertError) {
                      return Promise.resolve({
                        data: null,
                        error: params.messageInsertError,
                      });
                    }
                    return Promise.resolve({
                      data: {
                        id: "assistant-message-1",
                        created_at: "2026-05-25T00:00:01.000Z",
                      },
                      error: null,
                    });
                  }

                  if (table === "agent_runs") {
                    if (params.runInsertError) {
                      return Promise.resolve({
                        data: null,
                        error: params.runInsertError,
                      });
                    }
                    return Promise.resolve({
                      data: { id: "run-1" },
                      error: null,
                    });
                  }

                  return Promise.resolve({ data: null, error: null });
                },
              };
            },
          };
        },
        delete() {
          return {
            eq(key: string, value: unknown) {
              deleted.push({ table, key, value });
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
        update(payload: Record<string, unknown>) {
          const filters: Record<string, unknown> = {};
          const inFilters: Record<string, unknown[]> = {};
          const query = {
            eq(key: string, value: unknown) {
              filters[key] = value;
              return query;
            },
            in(key: string, values: unknown[]) {
              inFilters[key] = values;
              return query;
            },
            select() {
              return query;
            },
            maybeSingle() {
              updates.push({ table, payload, filters, inFilters });
              return Promise.resolve({
                data: params.cancelRun ?? null,
                error: null,
              });
            },
          };
          return query;
        },
        select() {
          const filters: Record<string, unknown> = {};
          const query = {
            eq(key: string, value: unknown) {
              filters[key] = value;
              return query;
            },
            limit() {
              return query;
            },
            maybeSingle() {
              if (table === "agent_runs" && filters.request_id) {
                return Promise.resolve({
                  data: requestLookups.shift() ?? null,
                  error: null,
                });
              }
              return Promise.resolve({ data: null, error: null });
            },
          };
          return query;
        },
      };
    },
  };

  return {
    admin: admin as unknown as ReturnType<typeof getSupabaseAdmin>,
    inserted,
    deleted,
    updates,
    rpc,
  };
}

describe("agent job queue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("enqueues a run, creates the assistant placeholder, and writes initial events", async () => {
    const fake = createQueueAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const result = await enqueueAgentRun({
      session,
      history,
      requestId: "req-1",
      model: "sonnet",
      mcpHealth,
    });

    expect(result).toMatchObject({
      ok: true,
      runId: "run-1",
      assistantMessageId: "assistant-message-1",
    });
    expect(fake.inserted).toEqual([
      {
        table: "messages",
        payload: {
          session_id: "session-1",
          role: "assistant",
          content: "",
          status: "pending",
        },
      },
      {
        table: "agent_runs",
        payload: expect.objectContaining({
          session_id: "session-1",
          user_message_id: "user-message-1",
          assistant_message_id: "assistant-message-1",
          request_id: "req-1",
          model: "sonnet",
          status: "queued",
          ontology_release_id: "release-1",
          ontology_env: "dev",
          company_count: 74,
          document_count: 300,
          object_count: 1000,
          manifest_valid: true,
        }),
      },
    ]);
    expect(appendAgentRunEvent).toHaveBeenNthCalledWith(
      1,
      fake.admin,
      "run-1",
      "run_started",
      expect.objectContaining({
        run_id: "run-1",
        message_id: "assistant-message-1",
        session_id: "session-1",
        request_id: "req-1",
        research_mode: "deep",
      }),
    );
    expect(appendAgentRunEvent).toHaveBeenNthCalledWith(
      2,
      fake.admin,
      "run-1",
      "activity_update",
      {
        stage: "queued",
        label: "분석 대기 중",
      },
    );
  });

  it("persists explicit research mode on the initial run event", async () => {
    const fake = createQueueAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    await enqueueAgentRun({
      session,
      history,
      requestId: "req-1",
      model: "sonnet",
      mcpHealth,
      researchMode: "deep",
    });

    expect(appendAgentRunEvent).toHaveBeenNthCalledWith(
      1,
      fake.admin,
      "run-1",
      "run_started",
      expect.objectContaining({
        research_mode: "deep",
      }),
    );
  });

  it("returns an existing run for duplicate request ids without creating rows", async () => {
    const fake = createQueueAdmin({
      requestLookups: [
        { id: "run-existing", session_id: "session-1", request_id: "req-1" },
      ],
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const result = await enqueueAgentRun({
      session,
      history,
      requestId: "req-1",
      model: "sonnet",
      mcpHealth,
    });

    expect(result).toEqual({
      ok: false,
      reason: "duplicate_request",
      runId: "run-existing",
    });
    expect(fake.inserted).toEqual([]);
    expect(appendAgentRunEvent).not.toHaveBeenCalled();
  });

  it("cleans up the assistant placeholder when a run insert conflicts", async () => {
    const fake = createQueueAdmin({
      requestLookups: [
        null,
        { id: "run-duplicate", session_id: "session-1", request_id: "req-1" },
      ],
      runInsertError: { code: "23505", message: "duplicate key" },
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const result = await enqueueAgentRun({
      session,
      history,
      requestId: "req-1",
      model: "sonnet",
      mcpHealth,
    });

    expect(result).toEqual({
      ok: false,
      reason: "duplicate_request",
      runId: "run-duplicate",
    });
    expect(fake.deleted).toEqual([
      {
        table: "messages",
        key: "id",
        value: "assistant-message-1",
      },
    ]);
  });

  it("claims and heartbeats runs through worker RPCs", async () => {
    const fake = createQueueAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    await expect(claimNextAgentRun("worker-1")).resolves.toBe("run-claimed-1");
    await expect(heartbeatAgentRun("run-claimed-1", "worker-1")).resolves.toBe(
      true,
    );

    expect(fake.rpc).toHaveBeenNthCalledWith(
      1,
      "claim_agent_run",
      expect.objectContaining({
        p_worker_id: "worker-1",
        p_worker_env: "dev",
        p_ontology_env: "dev",
        p_global_limit: expect.any(Number),
        p_lease_seconds: expect.any(Number),
      }),
    );
    expect(fake.rpc).toHaveBeenNthCalledWith(
      2,
      "heartbeat_agent_run",
      expect.objectContaining({
        p_run_id: "run-claimed-1",
        p_worker_id: "worker-1",
        p_lease_seconds: expect.any(Number),
      }),
    );
  });

  it("marks active queued or running runs as cancel requested", async () => {
    const fake = createQueueAdmin({
      cancelRun: {
        status: "queued",
        assistant_message_id: "assistant-message-1",
        request_id: "req-1",
      },
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    const result = await requestAgentRunCancel("run-1");

    expect(result).toEqual({
      status: "queued",
      assistantMessageId: "assistant-message-1",
      requestId: "req-1",
    });
    expect(fake.updates).toEqual([
      expect.objectContaining({
        table: "agent_runs",
        payload: expect.objectContaining({
          cancel_requested_at: expect.any(String),
        }),
        filters: { id: "run-1" },
        inFilters: { status: ["queued", "running", "pending"] },
      }),
    ]);
  });
});
