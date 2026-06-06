import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/agent/worker-heartbeat", () => ({
  getReadyAgentWorker: vi.fn(),
}));
vi.mock("@/lib/agent/job-queue", () => ({
  enqueueAgentRun: vi.fn(),
  findRunByRequestId: vi.fn(),
}));
vi.mock("@/lib/agent/run-events", () => ({
  streamAgentRunEventsResponse: vi.fn(() => new Response("stream")),
}));
vi.mock("@/lib/auth", () => ({
  getAuthUser: vi.fn(),
  handleAuthError: vi.fn((error: unknown, requestId?: string) =>
    Response.json(
      {
        error: {
          code: "auth_required",
          message: error instanceof Error ? error.message : "Auth failed",
        },
        request_id: requestId,
      },
      { status: 401 },
    ),
  ),
}));
vi.mock("@/lib/api/chat", () => ({
  fetchHistory: vi.fn(),
  reserveBudgetStep: vi.fn(),
  resolveSession: vi.fn(),
}));
vi.mock("@/lib/api/chat/rate-limit", () => ({
  checkChatRunRateLimit: vi.fn(),
  getClientIp: vi.fn(() => "127.0.0.1"),
}));
vi.mock("@/lib/concurrency/execution-budget", () => ({
  releaseExecutionBudget: vi.fn(),
}));
vi.mock("@/lib/ontology/catalog", () => ({
  getActiveOntologyCatalogRelease: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getReadyAgentWorker } from "@/lib/agent/worker-heartbeat";
import { enqueueAgentRun, findRunByRequestId } from "@/lib/agent/job-queue";
import { streamAgentRunEventsResponse } from "@/lib/agent/run-events";
import { getAuthUser } from "@/lib/auth";
import { fetchHistory, reserveBudgetStep, resolveSession } from "@/lib/api/chat";
import { checkChatRunRateLimit } from "@/lib/api/chat/rate-limit";
import { releaseExecutionBudget } from "@/lib/concurrency/execution-budget";
import { getActiveOntologyCatalogRelease } from "@/lib/ontology/catalog";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { POST } from "./route";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const ARTIFACT_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440001";
const EVENT_ID = "alphabet-ai-capex";

const selectedEvent = {
  id: EVENT_ID,
  ticker: "GOOGL",
  event_title: "AI 투자 부담 우려로 알파벳 주가 약세",
  event_title_ko: "AI 투자 부담 우려로 알파벳 주가 약세",
  original_headline: "Alphabet shares fall as investors weigh AI capex pressure",
  summary_ko:
    "시장 뉴스는 알파벳의 AI 데이터센터 투자 확대가 잉여현금흐름과 주주환원 여력을 압박할 수 있다고 다뤘습니다.",
  primary_source: {
    publisher: "Reuters",
    domain: "reuters.com",
    url: "https://example.test/news",
    published_at: "2026-06-04T12:00:00.000Z",
  },
  source_previews: [
    {
      publisher: "Reuters",
      domain: "reuters.com",
      title_original: "Alphabet shares fall as investors weigh AI capex pressure",
      url: "https://example.test/news",
      published_at: "2026-06-04T12:00:00.000Z",
    },
  ],
};

function request(body: Record<string, unknown> = {}) {
  return new NextRequest("http://localhost/api/chat/news-event-selection", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      session_id: SESSION_ID,
      artifact_id: ARTIFACT_ID,
      event_id: EVENT_ID,
      request_id: REQUEST_ID,
      research_mode: "standard",
      ...body,
    }),
  });
}

function createAdmin(options: { artifactExists?: boolean } = {}) {
  const artifactExists = options.artifactExists ?? true;
  const upserts: unknown[] = [];
  const deletes: unknown[] = [];

  const admin = {
    from(table: string) {
      return {
        select() {
          const filters: Record<string, unknown> = {};
          const query = {
            eq(key: string, value: unknown) {
              filters[key] = value;
              return query;
            },
            maybeSingle() {
              if (table === "chat_message_artifacts" && artifactExists) {
                return Promise.resolve({
                  data: {
                    id: ARTIFACT_ID,
                    session_id: SESSION_ID,
                    message_id: "assistant-message-discovery",
                    run_id: "discovery-run",
                    type: "news_event_selection",
                    payload_json: {
                      kind: "news_event_selection",
                      version: 1,
                      original_question: "GOOGL 뉴스 분석",
                      events: [selectedEvent],
                    },
                    created_at: "2026-06-04T00:00:00.000Z",
                  },
                  error: null,
                });
              }
              return Promise.resolve({ data: null, error: null });
            },
          };
          return query;
        },
        upsert(payload: unknown) {
          upserts.push(payload);
          return {
            select() {
              return {
                maybeSingle() {
                  return Promise.resolve({
                    data: { id: "selection-1" },
                    error: null,
                  });
                },
              };
            },
          };
        },
        delete() {
          return {
            eq(key: string, value: unknown) {
              deletes.push({ table, key, value });
              return Promise.resolve({ data: null, error: null });
            },
          };
        },
      };
    },
  };

  return { admin, upserts, deletes };
}

async function json(response: Response) {
  return response.json() as Promise<{
    error?: { code: string; message: string };
    request_id?: string;
  }>;
}

describe("POST /api/chat/news-event-selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin as never);
    vi.mocked(getAuthUser).mockResolvedValue({
      id: "user-1",
      email: "user@example.test",
    } as Awaited<ReturnType<typeof getAuthUser>>);
    vi.mocked(findRunByRequestId).mockResolvedValue(null);
    vi.mocked(checkChatRunRateLimit).mockResolvedValue({ ok: true });
    vi.mocked(getActiveOntologyCatalogRelease).mockResolvedValue({
      release_id: "release-1",
    } as Awaited<ReturnType<typeof getActiveOntologyCatalogRelease>>);
    vi.mocked(getReadyAgentWorker).mockResolvedValue({
      ok: true,
      worker: { worker_id: "mac-worker-jwc-1" } as never,
      mcpHealth: {
        connected: true,
        staticOk: true,
        commandOk: true,
        liveOk: true,
        sqliteOk: true,
        env: "dev",
        releaseId: "release-1",
        manifestPath: "/tmp/manifest.json",
        manifestValid: true,
        agentIndexSchemaVersion: "agent_index_v1",
        indexGeneratedAt: "2026-06-04T00:00:00.000Z",
        companyCount: 10,
        documentCount: 20,
        objectCount: 30,
        toolCount: 12,
        tools: ["krw_ontology_query_context"],
        root: "/tmp/ontology",
        indexPath: "/tmp/ontology/index.sqlite",
        pluginPath: "/tmp/plugin",
        releaseMetadata: {
          env: "dev",
          release_id: "release-1",
          manifest_valid: true,
        },
      },
    } as Awaited<ReturnType<typeof getReadyAgentWorker>>);
    vi.mocked(resolveSession).mockResolvedValue({
      ok: true,
      session: {
        id: SESSION_ID,
        userId: "user-1",
        scopeType: "company",
        defaultTickers: ["GOOGL"],
        defaultDocumentTypes: [],
      },
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
    vi.mocked(fetchHistory).mockResolvedValue({
      ok: true,
      result: {
        userMessageId: "user-message-selected",
        history: [],
      },
    });
    vi.mocked(enqueueAgentRun).mockResolvedValue({
      ok: true,
      runId: "research-run-1",
      assistantMessageId: "assistant-message-research",
      queuedAt: "2026-06-04T00:00:00.000Z",
    });
  });

  it("queues a news_research run for the selected MCP event", async () => {
    const fake = createAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin as never);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Chat-Session-Id")).toBe(SESSION_ID);
    expect(fetchHistory).toHaveBeenCalledWith(
      SESSION_ID,
      expect.stringContaining("선택 뉴스:"),
      REQUEST_ID,
    );
    expect(fetchHistory).toHaveBeenCalledWith(
      SESSION_ID,
      expect.stringContaining("원문 기사:"),
      REQUEST_ID,
    );
    expect(fetchHistory).toHaveBeenCalledWith(
      SESSION_ID,
      expect.stringContaining("내용 요약:"),
      REQUEST_ID,
    );
    expect(enqueueAgentRun).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: REQUEST_ID,
        analysisMode: "news",
        runKind: "news_research",
        selectedNewsEventContext: expect.objectContaining({
          ...selectedEvent,
        }),
        sourceArtifactId: ARTIFACT_ID,
        sourceEventId: EVENT_ID,
      }),
    );
    expect(fake.upserts).toEqual([
      expect.objectContaining({
        artifact_id: ARTIFACT_ID,
        session_id: SESSION_ID,
        event_id: EVENT_ID,
        selected_payload_json: expect.objectContaining({
          ...selectedEvent,
        }),
        user_message_id: "user-message-selected",
        research_run_id: "research-run-1",
        status: "queued",
      }),
    ]);
    expect(streamAgentRunEventsResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        sessionId: SESSION_ID,
        runId: "research-run-1",
        requestId: REQUEST_ID,
      }),
    );
  });

  it("does not reserve budget when the selected artifact is missing", async () => {
    const fake = createAdmin({ artifactExists: false });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin as never);

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(await json(response)).toMatchObject({
      error: { code: "not_found" },
      request_id: REQUEST_ID,
    });
    expect(reserveBudgetStep).not.toHaveBeenCalled();
    expect(fetchHistory).not.toHaveBeenCalled();
    expect(enqueueAgentRun).not.toHaveBeenCalled();
    expect(releaseExecutionBudget).not.toHaveBeenCalled();
  });
});
