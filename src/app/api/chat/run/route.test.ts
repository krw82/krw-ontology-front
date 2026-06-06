import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agent/worker-heartbeat", () => ({
  getReadyAgentWorker: vi.fn(),
}));
vi.mock("@/lib/analytics/server", () => ({
  recordAnalyticsEventFromRequest: vi.fn(),
}));
vi.mock("@/lib/ontology/catalog", () => ({
  getActiveOntologyCatalogRelease: vi.fn(),
  getIndexedCompanies: vi.fn(),
}));
vi.mock("@/lib/api/chat", () => ({
  validateRequest: vi.fn(),
  resolveSession: vi.fn(),
  reserveBudgetStep: vi.fn(),
  fetchHistory: vi.fn(),
}));
vi.mock("@/lib/api/chat/rate-limit", () => ({
  checkChatRunRateLimit: vi.fn(),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/agent/job-queue", () => ({
  enqueueAgentRun: vi.fn(),
}));
vi.mock("@/lib/agent/run-events", () => ({
  streamAgentRunEventsResponse: vi.fn(() => new Response("stream")),
}));
vi.mock("@/lib/concurrency/execution-budget", () => ({
  releaseExecutionBudget: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getReadyAgentWorker } from "@/lib/agent/worker-heartbeat";
import type { McpHealthResult } from "@/lib/agent/mcp-client";
import {
  validateRequest,
  resolveSession,
  reserveBudgetStep,
  fetchHistory,
} from "@/lib/api/chat";
import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import { checkChatRunRateLimit } from "@/lib/api/chat/rate-limit";
import { enqueueAgentRun } from "@/lib/agent/job-queue";
import { streamAgentRunEventsResponse } from "@/lib/agent/run-events";
import {
  getActiveOntologyCatalogRelease,
  getIndexedCompanies,
} from "@/lib/ontology/catalog";
import { releaseExecutionBudget } from "@/lib/concurrency/execution-budget";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { POST } from "./route";

const readyMcpHealth = {
  connected: true,
  staticOk: true,
  commandOk: true,
  liveOk: true,
  sqliteOk: true,
  env: "dev",
  releaseId: "release-1",
  manifestPath: "~/krw-ontology-data/manifest.json",
  manifestValid: true,
  agentIndexSchemaVersion: "agent_index_v1",
  indexGeneratedAt: "2026-05-27T00:00:00.000Z",
  companyCount: 10,
  documentCount: 20,
  objectCount: 30,
  toolCount: 12,
  tools: ["krw_ontology_query_context"],
  root: "~/krw-ontology-data",
  indexPath:
    "~/krw-ontology-data/indexes/agent_index.sqlite",
  pluginPath: "~/krw-ontology/plugins/krw-ontology",
  releaseMetadata: {
    env: "dev",
    release_id: "release-1",
    manifest_valid: true,
  },
} satisfies McpHealthResult;

function request() {
  return new NextRequest("http://localhost/api/chat/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      content: "Apple 알려줘",
      request_id: "550e8400-e29b-41d4-a716-446655440001",
      session_id: "11111111-1111-4111-8111-111111111111",
      research_mode: "fast",
      analysis_mode: "company",
    }),
  });
}

function createAdmin({
  existingRuns = [null],
  sessionUserId = "user-1",
}: {
  existingRuns?: Array<{ id: string; session_id: string } | null>;
  sessionUserId?: string;
} = {}) {
  const deleted: Array<{ table: string; key: string; value: unknown }> = [];
  const runLookups = [...existingRuns];
  const admin = {
    from(table: string) {
      const filters: Record<string, unknown> = {};
      return {
        select() {
          const query = {
            eq(key: string, value: unknown) {
              filters[key] = value;
              return query;
            },
            is(key: string, value: unknown) {
              filters[key] = value;
              return query;
            },
            maybeSingle() {
              if (table === "agent_runs") {
                return Promise.resolve({
                  data: runLookups.length > 0 ? runLookups.shift() : null,
                  error: null,
                });
              }

              if (table === "chat_sessions") {
                return Promise.resolve({
                  data: filters.id
                    ? { id: filters.id, user_id: sessionUserId }
                    : null,
                  error: null,
                });
              }

              return Promise.resolve({ data: null, error: null });
            },
          };
          return query;
        },
        delete() {
          return {
            eq(key: string, value: unknown) {
              deleted.push({ table, key, value });
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };

  return { admin, deleted };
}

async function json(response: Response) {
  return response.json() as Promise<{
    error?: { code: string; message: string };
    request_id?: string;
  }>;
}

describe("POST /api/chat/run worker admission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSupabaseAdmin).mockReturnValue(createAdmin().admin as never);
    vi.mocked(validateRequest).mockResolvedValue({
      ok: true,
      data: {
        userId: "user-1",
        userEmail: "user@example.test",
        body: {
          content: "Apple 알려줘",
          request_id: "550e8400-e29b-41d4-a716-446655440001",
          session_id: "11111111-1111-4111-8111-111111111111",
          research_mode: "fast",
          analysis_mode: "company",
          run_kind: "company_research",
        },
      },
    });
    vi.mocked(checkChatRunRateLimit).mockResolvedValue({ ok: true });
    vi.mocked(getActiveOntologyCatalogRelease).mockResolvedValue({
      env: "dev",
      release_id: "release-1",
      active: true,
      format: "krw-ontology-web-catalog/v1",
      generated_at: "2026-05-27T00:00:00.000Z",
      release_created_at: "2026-05-27T00:00:00.000Z",
      index_generated_at: "2026-05-27T00:00:00.000Z",
      company_count: 10,
      document_count: 20,
      index_document_count: 20,
      object_count: 30,
      manifest_json: null,
      summary_json: {},
      source_json: null,
      catalog_json: {},
      created_at: "2026-05-27T00:00:00.000Z",
      updated_at: "2026-05-27T00:00:00.000Z",
    });
    vi.mocked(reserveBudgetStep).mockResolvedValue({
      ok: true,
      budget: {
        allowed: true,
        reservationId: "budget-reservation-1",
        budgetUsedUsd: 0,
        budgetReservedUsd: 0,
        budgetLimitUsd: 10,
        dailyBudgetUsedUsd: 0,
        dailyBudgetReservedUsd: 0,
        dailyBudgetLimitUsd: 10,
        reserveCostUsd: 0,
        runCount: 0,
      },
    });
    vi.mocked(resolveSession).mockResolvedValue({
      ok: true,
      session: {
        id: "11111111-1111-4111-8111-111111111111",
        userId: "user-1",
        scopeType: "global",
        defaultTickers: [],
        defaultDocumentTypes: [],
      },
    });
    vi.mocked(fetchHistory).mockResolvedValue({
      ok: true,
      result: {
        userMessageId: "user-message-1",
        history: [],
      },
    });
    vi.mocked(enqueueAgentRun).mockResolvedValue({
      ok: true,
      runId: "run-1",
      assistantMessageId: "assistant-message-1",
      queuedAt: "2026-05-27T00:00:00.000Z",
    });
  });

  it("rejects before budget reservation when no ready worker heartbeat exists", async () => {
    vi.mocked(getReadyAgentWorker).mockResolvedValue({
      ok: false,
      reason: "worker_unavailable",
      message: "No ready agent worker heartbeat found",
    });

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await json(response)).toMatchObject({
      error: { code: "worker_unavailable" },
      request_id: "550e8400-e29b-41d4-a716-446655440001",
    });
    expect(reserveBudgetStep).not.toHaveBeenCalled();
    expect(enqueueAgentRun).not.toHaveBeenCalled();
    expect(getReadyAgentWorker).toHaveBeenCalledWith(
      expect.any(Date),
      "release-1",
    );
  });

  it("passes worker heartbeat MCP metadata into the queued run", async () => {
    vi.mocked(getReadyAgentWorker).mockResolvedValue({
      ok: true,
      worker: { worker_id: "mac-worker-jwc-1" } as never,
      mcpHealth: readyMcpHealth,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Chat-Session-Id")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(checkChatRunRateLimit).toHaveBeenCalledTimes(2);
    expect(checkChatRunRateLimit).toHaveBeenNthCalledWith(1, {
      userId: "user-1",
      requestId: "550e8400-e29b-41d4-a716-446655440001",
      ip: "127.0.0.1",
      scope: "user_ip",
    });
    expect(checkChatRunRateLimit).toHaveBeenNthCalledWith(2, {
      userId: "user-1",
      requestId: "550e8400-e29b-41d4-a716-446655440001",
      ip: "127.0.0.1",
      sessionId: "11111111-1111-4111-8111-111111111111",
      scope: "session",
    });
    expect(reserveBudgetStep).toHaveBeenCalledWith(
      "user-1",
      "550e8400-e29b-41d4-a716-446655440001",
      "user@example.test",
      "fast",
    );
    expect(enqueueAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "550e8400-e29b-41d4-a716-446655440001",
        model: expect.any(String),
        mcpHealth: readyMcpHealth,
        researchMode: "fast",
        analysisMode: "company",
        runKind: "company_research",
      }),
    );
    expect(getReadyAgentWorker).toHaveBeenCalledWith(
      expect.any(Date),
      "release-1",
    );
    expect(streamAgentRunEventsResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        sessionId: "11111111-1111-4111-8111-111111111111",
        runId: "run-1",
        requestId: "550e8400-e29b-41d4-a716-446655440001",
      }),
    );
  });

  it("queues news discovery for the worker server pipeline", async () => {
    vi.mocked(getReadyAgentWorker).mockResolvedValue({
      ok: true,
      worker: { worker_id: "mac-worker-jwc-1" } as never,
      mcpHealth: readyMcpHealth,
    });
    vi.mocked(validateRequest).mockResolvedValue({
      ok: true,
      data: {
        userId: "user-1",
        userEmail: "user@example.test",
        body: {
          content: "오늘 왜 떨어져?",
          request_id: "550e8400-e29b-41d4-a716-446655440001",
          session_id: "11111111-1111-4111-8111-111111111111",
          research_mode: "fast",
          analysis_mode: "news",
          run_kind: "news_discovery",
        },
      },
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(enqueueAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "550e8400-e29b-41d4-a716-446655440001",
        mcpHealth: readyMcpHealth,
        researchMode: "fast",
        analysisMode: "news",
        runKind: "news_discovery",
        executorType: "server_pipeline",
      }),
    );
    expect(streamAgentRunEventsResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        sessionId: "11111111-1111-4111-8111-111111111111",
        runId: "run-1",
        requestId: "550e8400-e29b-41d4-a716-446655440001",
      }),
    );
  });

  it("uses one batch catalog lookup before creating a new company session", async () => {
    vi.mocked(getReadyAgentWorker).mockResolvedValue({
      ok: true,
      worker: { worker_id: "mac-worker-jwc-1" } as never,
      mcpHealth: readyMcpHealth,
    });
    vi.mocked(validateRequest).mockResolvedValue({
      ok: true,
      data: {
        userId: "user-1",
        userEmail: "user@example.test",
        body: {
          content: "두 회사를 비교해줘",
          request_id: "550e8400-e29b-41d4-a716-446655440001",
          scope_type: "company",
          default_tickers: ["AAPL", "MSFT"],
          research_mode: "fast",
        },
      },
    });
    vi.mocked(getIndexedCompanies).mockResolvedValue([
      { ticker: "AAPL", name: "Apple Inc." },
    ] as Awaited<ReturnType<typeof getIndexedCompanies>>);

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({
      error: {
        code: "validation_error",
        message: "현재 온톨로지 인덱스에 없는 회사입니다: MSFT",
      },
      request_id: "550e8400-e29b-41d4-a716-446655440001",
    });
    expect(getIndexedCompanies).toHaveBeenCalledTimes(1);
    expect(getIndexedCompanies).toHaveBeenCalledWith(["AAPL", "MSFT"]);
    expect(reserveBudgetStep).not.toHaveBeenCalled();
    expect(releaseExecutionBudget).not.toHaveBeenCalled();
    expect(resolveSession).not.toHaveBeenCalled();
    expect(fetchHistory).not.toHaveBeenCalled();
    expect(enqueueAgentRun).not.toHaveBeenCalled();
  });

  it("does not spend the session rate-limit bucket before session ownership is verified", async () => {
    vi.mocked(getReadyAgentWorker).mockResolvedValue({
      ok: true,
      worker: { worker_id: "mac-worker-jwc-1" } as never,
      mcpHealth: readyMcpHealth,
    });
    vi.mocked(resolveSession).mockResolvedValue({
      ok: false,
      response: Response.json(
        {
          error: {
            code: "forbidden",
            message: "세션에 접근할 수 없습니다.",
          },
          request_id: "550e8400-e29b-41d4-a716-446655440001",
        },
        { status: 403 },
      ),
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(checkChatRunRateLimit).toHaveBeenCalledOnce();
    expect(checkChatRunRateLimit).toHaveBeenCalledWith({
      userId: "user-1",
      requestId: "550e8400-e29b-41d4-a716-446655440001",
      ip: "127.0.0.1",
      scope: "user_ip",
    });
    expect(reserveBudgetStep).not.toHaveBeenCalled();
    expect(releaseExecutionBudget).not.toHaveBeenCalled();
    expect(fetchHistory).not.toHaveBeenCalled();
    expect(enqueueAgentRun).not.toHaveBeenCalled();
  });

  it("reattaches duplicate requests to an existing run before rate limit or budget work", async () => {
    const fake = createAdmin({
      existingRuns: [
        {
          id: "existing-run-1",
          session_id: "11111111-1111-4111-8111-111111111111",
        },
      ],
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin as never);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Chat-Session-Id")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(checkChatRunRateLimit).not.toHaveBeenCalled();
    expect(getActiveOntologyCatalogRelease).not.toHaveBeenCalled();
    expect(reserveBudgetStep).not.toHaveBeenCalled();
    expect(resolveSession).not.toHaveBeenCalled();
    expect(fetchHistory).not.toHaveBeenCalled();
    expect(enqueueAgentRun).not.toHaveBeenCalled();
    expect(streamAgentRunEventsResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        sessionId: "11111111-1111-4111-8111-111111111111",
        runId: "existing-run-1",
        requestId: "550e8400-e29b-41d4-a716-446655440001",
      }),
    );
  });

  it("reattaches duplicate requests that appear after the user message is saved", async () => {
    const fake = createAdmin({
      existingRuns: [
        null,
        {
          id: "existing-run-after-message",
          session_id: "11111111-1111-4111-8111-111111111111",
        },
      ],
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin as never);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(resolveSession).toHaveBeenCalledOnce();
    expect(fetchHistory).toHaveBeenCalledOnce();
    expect(recordAnalyticsEventFromRequest).not.toHaveBeenCalled();
    expect(enqueueAgentRun).not.toHaveBeenCalled();
    expect(releaseExecutionBudget).not.toHaveBeenCalled();
    expect(fake.deleted).toEqual([]);
    expect(streamAgentRunEventsResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        sessionId: "11111111-1111-4111-8111-111111111111",
        runId: "existing-run-after-message",
        requestId: "550e8400-e29b-41d4-a716-446655440001",
      }),
    );
  });

  it("reattaches duplicate requests reported by enqueue without releasing budget or deleting the user message", async () => {
    const fake = createAdmin({ existingRuns: [null, null] });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin as never);
    vi.mocked(enqueueAgentRun).mockResolvedValue({
      ok: false,
      reason: "duplicate_request",
      runId: "enqueue-duplicate-run",
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(releaseExecutionBudget).not.toHaveBeenCalled();
    expect(fake.deleted).toEqual([]);
    expect(streamAgentRunEventsResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        sessionId: "11111111-1111-4111-8111-111111111111",
        runId: "enqueue-duplicate-run",
        requestId: "550e8400-e29b-41d4-a716-446655440001",
      }),
    );
  });

  it("releases budget and deletes the created user message when enqueue fails", async () => {
    const fake = createAdmin({ existingRuns: [null, null] });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin as never);
    vi.mocked(enqueueAgentRun).mockResolvedValue({
      ok: false,
      reason: "internal_error",
    });

    const response = await POST(request());

    expect(response.status).toBe(500);
    expect(await json(response)).toMatchObject({
      error: {
        code: "internal_error",
        message: "분석 작업을 대기열에 넣지 못했습니다.",
      },
      request_id: "550e8400-e29b-41d4-a716-446655440001",
    });
    expect(releaseExecutionBudget).toHaveBeenCalledWith(
      "user-1",
      "550e8400-e29b-41d4-a716-446655440001",
      null,
      "internal_error",
    );
    expect(fake.deleted).toEqual([
      { table: "messages", key: "id", value: "user-message-1" },
    ]);
  });

  it("returns a conflict and cleans up when another run is already active", async () => {
    const fake = createAdmin({ existingRuns: [null, null] });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin as never);
    vi.mocked(enqueueAgentRun).mockResolvedValue({
      ok: false,
      reason: "active_run_exists",
    });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await json(response)).toMatchObject({
      error: {
        code: "active_run_exists",
        message: "이미 응답을 생성 중입니다.",
      },
      request_id: "550e8400-e29b-41d4-a716-446655440001",
    });
    expect(releaseExecutionBudget).toHaveBeenCalledWith(
      "user-1",
      "550e8400-e29b-41d4-a716-446655440001",
      null,
      "active_run_exists",
    );
    expect(fake.deleted).toEqual([
      { table: "messages", key: "id", value: "user-message-1" },
    ]);
  });
});
