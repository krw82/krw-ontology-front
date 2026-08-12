import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/analytics/server", () => ({
  recordAnalyticsEventFromRequest: vi.fn(),
}));
vi.mock("@/lib/ontology/catalog", () => ({
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
vi.mock("@/lib/agent-v1/runtime", () => ({
  getRustAgentRuntime: vi.fn(),
  RustAgentRuntimeError: class RustAgentRuntimeError extends Error {
    readonly code: string;

    constructor(code: string) {
      super(code);
      this.name = "RustAgentRuntimeError";
      this.code = code;
    }
  },
}));
vi.mock("@/lib/agent-v1/readiness", () => ({
  getResearchAdmissionMode: vi.fn(),
}));
vi.mock("@/lib/agent/daemon-heartbeat", () => ({
  getReadyRustAgentDaemon: vi.fn(),
}));
vi.mock("@/lib/agent/run-events", () => ({
  streamAgentRunEventsResponse: vi.fn(() => new Response("stream")),
}));
vi.mock("@/lib/concurrency/execution-budget", () => ({
  releaseExecutionBudget: vi.fn(),
}));
vi.mock("@/lib/concurrency/analysis-credits", () => ({
  attachAnalysisCreditRunShadow: vi.fn(),
  releaseAnalysisCreditsShadow: vi.fn(),
  reserveAnalysisCreditsShadow: vi.fn(),
}));
vi.mock("@/lib/billing/feature-access", () => ({
  getFeatureSplitMode: vi.fn(() => "off"),
  getMenuFeatureDefinition: vi.fn(() => ({
    label: "리서치",
    required_plan: "free",
  })),
  isEntitlementFeatureEnabled: vi.fn(() => true),
}));
vi.mock("@/lib/billing/entitlement", () => ({
  getEntitlementStatus: vi.fn(),
}));
vi.mock("@/lib/security/chat-safety", () => ({
  assessChatPromptSafety: vi.fn(() => ({ blocked: false })),
  blockedChatSafetyMessage: vi.fn(() => "blocked"),
}));
vi.mock("@/lib/api/chat/immediate-response", () => ({
  createImmediateAssistantResponse: vi.fn(({ content }: { content: string }) =>
    Response.json({ content }),
  ),
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { recordAnalyticsEventFromRequest } from "@/lib/analytics/server";
import {
  fetchHistory,
  resolveSession,
  reserveBudgetStep,
  validateRequest,
} from "@/lib/api/chat";
import { checkChatRunRateLimit } from "@/lib/api/chat/rate-limit";
import {
  getRustAgentRuntime,
  RustAgentRuntimeError,
} from "@/lib/agent-v1/runtime";
import { getResearchAdmissionMode } from "@/lib/agent-v1/readiness";
import { getReadyRustAgentDaemon } from "@/lib/agent/daemon-heartbeat";
import { streamAgentRunEventsResponse } from "@/lib/agent/run-events";
import {
  attachAnalysisCreditRunShadow,
  releaseAnalysisCreditsShadow,
  reserveAnalysisCreditsShadow,
} from "@/lib/concurrency/analysis-credits";
import { releaseExecutionBudget } from "@/lib/concurrency/execution-budget";
import { getIndexedCompanies } from "@/lib/ontology/catalog";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { POST } from "./route";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "550e8400-e29b-41d4-a716-446655440001";
const USER_MESSAGE_ID = "22222222-2222-4222-8222-222222222222";

type TestBody = {
  content: string;
  request_id: string;
  session_id?: string;
  scope_type?: "global" | "company";
  default_tickers?: string[];
  research_mode: "fast" | "standard" | "deep";
  analysis_mode: "company" | "news";
  run_kind?: string;
};

let body: TestBody;

function request() {
  return new NextRequest("http://localhost/api/chat/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function createAdmin({
  existingRuns = [null],
  sessionUserId = "user-1",
}: {
  existingRuns?: Array<{ id: string; session_id: string } | null>;
  sessionUserId?: string;
} = {}) {
  const runLookups = [...existingRuns];
  const insertedSessions: Array<Record<string, unknown>> = [];
  const insertedMessages: Array<Record<string, unknown>> = [];
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
                  data: filters.id ? { id: filters.id, user_id: sessionUserId } : null,
                  error: null,
                });
              }
              return Promise.resolve({ data: null, error: null });
            },
          };
          return query;
        },
        insert(payload: Record<string, unknown>) {
          if (table === "chat_sessions") {
            insertedSessions.push(payload);
            return {
              select() {
                return {
                  single() {
                    return Promise.resolve({ data: { id: SESSION_ID }, error: null });
                  },
                };
              },
            };
          }
          if (table === "messages") {
            insertedMessages.push(payload);
          }
          throw new Error(`unexpected admin insert: ${table}`);
        },
      };
    },
  };
  return { admin, insertedSessions, insertedMessages };
}

function setSession(session: {
  scopeType: "global" | "company";
  defaultTickers: string[];
}) {
  vi.mocked(resolveSession).mockResolvedValue({
    ok: true,
    session: {
      id: SESSION_ID,
      userId: "user-1",
      scopeType: session.scopeType,
      defaultTickers: session.defaultTickers,
      defaultDocumentTypes: [],
    },
  });
}

async function responseJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("POST /api/chat/run Rust Agent V1 contract", () => {
  let runtimeEnqueue: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    body = {
      content: "Apple 알려줘",
      request_id: REQUEST_ID,
      session_id: SESSION_ID,
      research_mode: "fast",
      analysis_mode: "company",
      run_kind: "company_research",
    };
    vi.mocked(validateRequest).mockResolvedValue({
      ok: true,
      data: {
        userId: "user-1",
        userEmail: "user@example.test",
        body: { ...body } as never,
      },
    });
    vi.mocked(checkChatRunRateLimit).mockResolvedValue({ ok: true });
    vi.mocked(resolveSession).mockResolvedValue({
      ok: true,
      session: {
        id: SESSION_ID,
        userId: "user-1",
        scopeType: "company",
        defaultTickers: ["AAPL"],
        defaultDocumentTypes: [],
      },
    });
    vi.mocked(reserveBudgetStep).mockResolvedValue({
      ok: true,
      budget: { entitlement: { usage: { unlimited: false } } },
    } as never);
    vi.mocked(reserveAnalysisCreditsShadow).mockResolvedValue({
      ok: true,
      allowed: true,
      reservationId: "credit-reservation-1",
    });
    vi.mocked(fetchHistory).mockResolvedValue({
      ok: true,
      result: { userMessageId: USER_MESSAGE_ID, history: [] },
    });
    vi.mocked(getResearchAdmissionMode).mockReturnValue("open");
    vi.mocked(getReadyRustAgentDaemon).mockResolvedValue({
      ok: true,
      required: false,
      daemon: null,
    });
    runtimeEnqueue = vi.fn().mockResolvedValue({
      runId: "run-1",
      assistantMessageId: "assistant-message-1",
      queuedAt: "2026-05-27T00:00:00.000Z",
      outcome: "enqueued",
    });
    vi.mocked(getRustAgentRuntime).mockResolvedValue({
      enqueue: runtimeEnqueue,
      cancel: vi.fn(),
    } as never);
    vi.mocked(getSupabaseAdmin).mockReturnValue(createAdmin().admin as never);
    setSession({ scopeType: "company", defaultTickers: ["AAPL"] });
  });

  it("queues company research through the pinned Rust runtime", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Chat-Session-Id")).toBe(SESSION_ID);
    expect(runtimeEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      requestId: REQUEST_ID,
      userId: "user-1",
      sessionId: SESSION_ID,
      userMessageId: USER_MESSAGE_ID,
      runKind: "company_research",
      locale: "ko-KR",
      question: "Apple 알려줘",
      context: { kind: "company_ticker_set", tickers: ["AAPL"] },
    }));
    expect(streamAgentRunEventsResponse).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      sessionId: SESSION_ID,
      runId: "run-1",
      requestId: REQUEST_ID,
    }));
    expect(attachAnalysisCreditRunShadow).toHaveBeenCalledWith(
      "user-1",
      REQUEST_ID,
      "run-1",
    );
  });

  it("routes a tickerless global question to wide research with covered-universe context", async () => {
    body = {
      ...body,
      content: "소비재 기업들의 소비 둔화 영향을 비교해줘",
      run_kind: "company_research",
      session_id: SESSION_ID,
    };
    vi.mocked(validateRequest).mockResolvedValue({
      ok: true,
      data: { userId: "user-1", userEmail: "user@example.test", body: { ...body } as never },
    });
    setSession({ scopeType: "global", defaultTickers: [] });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(runtimeEnqueue).toHaveBeenCalledWith(expect.objectContaining({
      runKind: "wide_research",
      context: { kind: "covered_universe", universe: "covered" },
    }));
    expect(recordAnalyticsEventFromRequest).toHaveBeenCalledWith(
      expect.any(NextRequest),
      expect.objectContaining({
        properties: expect.objectContaining({
          run_kind: "wide_research",
          routing_mode: "auto",
          scope_type: "global",
        }),
      }),
    );
  });

  it("keeps a follow-up in the same chat session while creating a new run", async () => {
    const firstRequestId = REQUEST_ID;
    const secondRequestId = "550e8400-e29b-41d4-a716-446655440002";
    const requests = [firstRequestId, secondRequestId];
    vi.mocked(validateRequest).mockImplementation(async () => {
      const requestId = requests.shift() ?? secondRequestId;
      return {
        ok: true,
        data: {
          userId: "user-1",
          userEmail: "user@example.test",
          body: { ...body, request_id: requestId } as never,
        },
      };
    });
    vi.mocked(fetchHistory)
      .mockResolvedValueOnce({ ok: true, result: { userMessageId: "message-1", history: [] } })
      .mockResolvedValueOnce({ ok: true, result: { userMessageId: "message-2", history: [] } });
    runtimeEnqueue
      .mockResolvedValueOnce({ runId: "run-1", assistantMessageId: "assistant-1", queuedAt: "2026-05-27T00:00:00.000Z", outcome: "enqueued" })
      .mockResolvedValueOnce({ runId: "run-2", assistantMessageId: "assistant-2", queuedAt: "2026-05-27T00:01:00.000Z", outcome: "enqueued" });

    const first = await POST(request());
    const second = await POST(request());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(runtimeEnqueue).toHaveBeenNthCalledWith(1, expect.objectContaining({
      requestId: firstRequestId,
      sessionId: SESSION_ID,
      userMessageId: "message-1",
    }));
    expect(runtimeEnqueue).toHaveBeenNthCalledWith(2, expect.objectContaining({
      requestId: secondRequestId,
      sessionId: SESSION_ID,
      userMessageId: "message-2",
    }));
  });

  it("saves the question and returns a terminal message while admission is closed", async () => {
    vi.mocked(getResearchAdmissionMode).mockReturnValue("drain");

    const response = await POST(request());
    const payload = await responseJson(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Chat-Session-Id")).toBe(SESSION_ID);
    expect(payload.content).toContain("전환 중입니다");
    expect(fetchHistory).toHaveBeenCalledWith(
      SESSION_ID,
      "Apple 알려줘",
      REQUEST_ID,
      {},
      { loadHistory: false },
    );
    expect(runtimeEnqueue).not.toHaveBeenCalled();
    expect(reserveBudgetStep).not.toHaveBeenCalled();
  });

  it("saves the question without reserving a credit when the local Rust daemon is unavailable", async () => {
    vi.mocked(getReadyRustAgentDaemon).mockResolvedValue({
      ok: false,
      reason: "daemon_unavailable",
      message: "Local Rust research daemon is unavailable",
    });

    const response = await POST(request());
    const payload = await responseJson(response);

    expect(response.status).toBe(200);
    expect(payload.content).toContain("준비 중");
    expect(fetchHistory).toHaveBeenCalledWith(
      SESSION_ID,
      "Apple 알려줘",
      REQUEST_ID,
      {},
      { loadHistory: false },
    );
    expect(reserveBudgetStep).not.toHaveBeenCalled();
    expect(runtimeEnqueue).not.toHaveBeenCalled();
  });

  it("returns a terminal same-session response when the pinned runtime cannot enqueue", async () => {
    runtimeEnqueue.mockRejectedValue(new RustAgentRuntimeError("agent_v1_release_pin_missing"));

    const response = await POST(request());
    const payload = await responseJson(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Chat-Session-Id")).toBe(SESSION_ID);
    expect(payload.content).toContain("리서치 엔진이 잠시 준비되지 않았습니다");
    expect(releaseExecutionBudget).toHaveBeenCalledWith(
      "user-1",
      REQUEST_ID,
      null,
      "agent_v1_release_pin_missing",
    );
    expect(releaseAnalysisCreditsShadow).toHaveBeenCalledWith(
      "user-1",
      REQUEST_ID,
      null,
      "agent_v1_release_pin_missing",
    );
  });

  it("reattaches an idempotent request to an existing run before reserving work", async () => {
    vi.mocked(getSupabaseAdmin).mockReturnValue(
      createAdmin({
        existingRuns: [{ id: "existing-run-1", session_id: SESSION_ID }],
      }).admin as never,
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(streamAgentRunEventsResponse).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: SESSION_ID,
      runId: "existing-run-1",
      requestId: REQUEST_ID,
    }));
    expect(checkChatRunRateLimit).not.toHaveBeenCalled();
    expect(reserveBudgetStep).not.toHaveBeenCalled();
    expect(runtimeEnqueue).not.toHaveBeenCalled();
  });

  it("checks user/IP rate limits before session ownership and does not leak work on denial", async () => {
    vi.mocked(resolveSession).mockResolvedValue({
      ok: false,
      response: Response.json(
        { error: { code: "forbidden", message: "세션에 접근할 수 없습니다." } },
        { status: 403 },
      ),
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(checkChatRunRateLimit).toHaveBeenCalledOnce();
    expect(reserveBudgetStep).not.toHaveBeenCalled();
    expect(fetchHistory).not.toHaveBeenCalled();
    expect(runtimeEnqueue).not.toHaveBeenCalled();
  });

  it("rejects unsupported URL/attachment work without sending it to the Rust lane", async () => {
    body = { ...body, user_url: "https://example.com" } as TestBody & { user_url: string };
    vi.mocked(validateRequest).mockResolvedValue({
      ok: true,
      data: { userId: "user-1", userEmail: "user@example.test", body: { ...body } as never },
    });

    const response = await POST(request());

    expect(response.status).toBe(400);
    expect((await responseJson(response)).error).toMatchObject({ code: "validation_error" });
    expect(runtimeEnqueue).not.toHaveBeenCalled();
  });

  it("validates a new company session's tickers before creating the session", async () => {
    body = {
      ...body,
      session_id: undefined,
      scope_type: "company",
      default_tickers: ["AAPL", "MSFT"],
    };
    vi.mocked(validateRequest).mockResolvedValue({
      ok: true,
      data: { userId: "user-1", userEmail: "user@example.test", body: { ...body } as never },
    });
    vi.mocked(getIndexedCompanies).mockResolvedValue([
      { ticker: "AAPL", name: "Apple Inc." },
    ] as Awaited<ReturnType<typeof getIndexedCompanies>>);

    const response = await POST(request());
    const payload = await responseJson(response);

    expect(response.status).toBe(400);
    expect(payload.error).toMatchObject({ code: "validation_error" });
    expect(getIndexedCompanies).toHaveBeenCalledWith(["AAPL", "MSFT"]);
    expect(reserveBudgetStep).not.toHaveBeenCalled();
    expect(runtimeEnqueue).not.toHaveBeenCalled();
  });
});
