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
  getIndexedCompany: vi.fn(),
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
import { checkChatRunRateLimit } from "@/lib/api/chat/rate-limit";
import { enqueueAgentRun } from "@/lib/agent/job-queue";
import { streamAgentRunEventsResponse } from "@/lib/agent/run-events";
import { getActiveOntologyCatalogRelease } from "@/lib/ontology/catalog";
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
      request_id: "req-1",
      session_id: "11111111-1111-4111-8111-111111111111",
      research_mode: "fast",
    }),
  });
}

function createAdmin() {
  return {
    from() {
      return {
        select() {
          const query = {
            eq() {
              return query;
            },
            is() {
              return query;
            },
            maybeSingle() {
              return Promise.resolve({ data: null, error: null });
            },
          };
          return query;
        },
        delete() {
          return {
            eq() {
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };
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
    vi.mocked(getSupabaseAdmin).mockReturnValue(createAdmin() as never);
    vi.mocked(validateRequest).mockResolvedValue({
      ok: true,
      data: {
        userId: "user-1",
        userEmail: "user@example.test",
        body: {
          content: "Apple 알려줘",
          request_id: "req-1",
          session_id: "11111111-1111-4111-8111-111111111111",
          research_mode: "fast",
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
      request_id: "req-1",
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
    expect(enqueueAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-1",
        model: expect.any(String),
        mcpHealth: readyMcpHealth,
        researchMode: "fast",
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
        requestId: "req-1",
      }),
    );
  });
});
