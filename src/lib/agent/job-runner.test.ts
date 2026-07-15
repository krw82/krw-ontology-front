import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/analytics/server", () => ({
  recordAnalyticsEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/agent/mcp-client", () => ({
  checkMcpReady: vi.fn(),
}));
vi.mock("@/lib/agent/runner", () => ({
  runAgent: vi.fn(),
}));
vi.mock("@/lib/agent/job-queue", () => ({
  heartbeatAgentRun: vi.fn().mockResolvedValue(true),
}));
vi.mock("@/lib/agent/run-events", () => ({
  appendAgentRunEvent: vi.fn().mockResolvedValue(1),
  createAgentRunEventWriter: vi.fn(() => ({
    write: vi.fn().mockResolvedValue(undefined),
    flush: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock("@/lib/news-discovery/source-pack", () => ({
  buildSelectedNewsSourcePack: vi.fn(),
}));
vi.mock("@/lib/question-router/chat-question-router", () => ({
  resolveChatQuestionRoute: vi.fn(),
}));
import { recordAnalyticsEvent } from "@/lib/analytics/server";
import { checkMcpReady, type McpHealthResult } from "@/lib/agent/mcp-client";
import { runAgent } from "@/lib/agent/runner";
import { appendAgentRunEvent } from "@/lib/agent/run-events";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { buildSelectedNewsSourcePack } from "@/lib/news-discovery/source-pack";
import { resolveChatQuestionRoute } from "@/lib/question-router/chat-question-router";
import { runAgentJob } from "./job-runner";

function createRunnerAdmin(params: {
  openToolCalls?: Array<{ id: string; error_message: string | null }>;
  previousMessagesError?: { code?: string; message: string } | null;
  runOverrides?: Record<string, unknown>;
  queuedEventPayload?: Record<string, unknown>;
  userMessageContent?: string;
} = {}) {
  const updates: Array<{
    table: string;
    payload: Record<string, unknown>;
    filters: Record<string, unknown>;
  }> = [];
  const inserted: Array<{ table: string; payload: Record<string, unknown> }> = [];
  const rpc = vi.fn((fn: string, args: Record<string, unknown>) => {
    if (fn === "mark_agent_run_terminal") {
      updates.push({
        table: "agent_runs",
        payload: {
          status: args.p_status,
          assistant_message_id: args.p_assistant_message_id ?? undefined,
          finished_at: args.p_finished_at,
          input_tokens: args.p_input_tokens ?? undefined,
          output_tokens: args.p_output_tokens ?? undefined,
          estimated_cost_usd: args.p_estimated_cost_usd ?? undefined,
          latency_ms: args.p_latency_ms ?? undefined,
          error_code: args.p_error_code ?? undefined,
          error_message: args.p_error_message ?? undefined,
          lease_expires_at: null,
        },
        filters: { id: args.p_run_id },
      });
    }
    return Promise.resolve({ data: null, error: null });
  });

  const rows = {
    agent_runs: [
      {
        id: "run-1",
        session_id: "session-1",
        user_message_id: "user-message-1",
        assistant_message_id: "assistant-message-1",
        request_id: "req-1",
        started_at: "2026-05-25T00:00:00.000Z",
        run_kind: "company_research",
        executor_type: "claude_agent",
        selected_news_event_context: null,
        ...params.runOverrides,
      },
    ],
    chat_sessions: [
      {
        id: "session-1",
        user_id: "user-1",
        scope_type: "company",
        default_tickers: ["AAPL"],
        default_document_types: [],
        deleted_at: null,
      },
    ],
    messages: [
      {
        id: "user-message-1",
        session_id: "session-1",
        role: "user",
        content: params.userMessageContent ?? "Apple 매출 알려줘",
        status: "completed",
      },
    ],
  };

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
                  if (table === "chat_message_artifacts") {
                    return Promise.resolve({
                      data: {
                        id: "artifact-row-1",
                        session_id: payload.session_id,
                        message_id: payload.message_id,
                        run_id: payload.run_id,
                        type: payload.type,
                        payload_json: payload.payload_json,
                        created_at: "2026-05-25T00:00:02.000Z",
                      },
                      error: null,
                    });
                  }

                  return Promise.resolve({ data: null, error: null });
                },
              };
            },
          };
        },
        update(payload: Record<string, unknown>) {
          const filters: Record<string, unknown> = {};
          const query = {
            eq(key: string, value: unknown) {
              filters[key] = value;
              updates.push({ table, payload, filters: { ...filters } });
              return Promise.resolve({ data: null, error: null });
            },
          };
          return query;
        },
        select() {
          const filters: Record<string, unknown> = {};
          const inFilters: Record<string, unknown[]> = {};
          const notEqualFilters: Record<string, unknown> = {};
          const nullFilters: Record<string, null> = {};

          const query = {
            eq(key: string, value: unknown) {
              filters[key] = value;
              return query;
            },
            neq(key: string, value: unknown) {
              notEqualFilters[key] = value;
              return query;
            },
            in(key: string, values: unknown[]) {
              inFilters[key] = values;
              return query;
            },
            is(key: string, value: null) {
              nullFilters[key] = value;
              return query;
            },
            order() {
              return query;
            },
            limit() {
              return query;
            },
            maybeSingle() {
              if (table === "tool_calls") {
                return Promise.resolve({ data: null, error: null });
              }

              const candidates =
                table === "agent_runs"
                  ? rows.agent_runs
                  : table === "chat_sessions"
                    ? rows.chat_sessions
                    : table === "agent_run_events"
                      ? [
                          {
                            run_id: "run-1",
                            event_type: "run_queued",
                            payload: params.queuedEventPayload ?? {},
                          },
                        ]
                      : rows.messages;
              const row =
                candidates.find((candidate) => {
                  const record = candidate as Record<string, unknown>;
                  return (
                    Object.entries(filters).every(
                      ([key, value]) => record[key] === value,
                    ) &&
                    Object.entries(notEqualFilters).every(
                      ([key, value]) => record[key] !== value,
                    ) &&
                    Object.entries(inFilters).every(([key, values]) =>
                      values.includes(record[key]),
                    ) &&
                    Object.keys(nullFilters).every(
                      (key) => record[key] === null,
                    )
                  );
                }) ?? null;
              return Promise.resolve({ data: row, error: null });
            },
            returns() {
              if (table === "tool_calls") {
                return Promise.resolve({
                  data: params.openToolCalls ?? [],
                  error: null,
                });
              }
              if (table === "messages" && params.previousMessagesError) {
                return Promise.resolve({
                  data: null,
                  error: params.previousMessagesError,
                });
              }
              return Promise.resolve({ data: [], error: null });
            },
          };
          return query;
        },
      };
    },
  };

  return {
    admin: admin as unknown as ReturnType<typeof getSupabaseAdmin>,
    updates,
    inserted,
    rpc,
  };
}

function readyMcpHealth(): McpHealthResult {
  return {
    connected: true,
    staticOk: true,
    commandOk: true,
    liveOk: true,
    sqliteOk: true,
    contractOk: true,
    toolParityOk: true,
    fingerprintOk: true,
    fingerprintErrors: [],
    mcpContractVersion: "krw-ontology-mcp/v2",
    buildId: "build-1",
    backendGitSha: "backend-sha-1",
    toolSchemaSha256: "a".repeat(64),
    buildFingerprintSha256: "a".repeat(64),
    releaseManifestSha256: "a".repeat(64),
    serviceFingerprintSha256: "a".repeat(64),
    env: "dev",
    releaseId: "release-1",
    manifestPath: "/srv/krw-ontology-data/current/manifest.json",
    manifestValid: true,
    agentIndexSchemaVersion: "agent_index_v1",
    indexGeneratedAt: "2026-05-25T00:00:00.000Z",
    companyCount: 10,
    documentCount: 20,
    objectCount: 30,
    toolCount: 13,
    tools: ["krw_ontology_query_context"],
    root: "/srv/krw-ontology-data/current",
    indexPath: "/srv/krw-ontology-data/current/indexes/global_spine.sqlite",
    pluginPath: "/srv/krw-ontology/plugins/krw-ontology",
    releaseMetadata: {
      env: "dev",
      release_id: "release-1",
      manifest_valid: true,
    },
  };
}

describe("agent job runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.KRW_CHARTS_ENABLED;
    vi.mocked(checkMcpReady).mockResolvedValue({
      connected: false,
      staticOk: true,
      commandOk: true,
      liveOk: false,
      sqliteOk: true,
      contractOk: false,
      toolParityOk: false,
      fingerprintOk: false,
      fingerprintErrors: ["MCP unavailable"],
      mcpContractVersion: null,
      buildId: null,
      backendGitSha: null,
      toolSchemaSha256: null,
      buildFingerprintSha256: null,
      releaseManifestSha256: null,
      serviceFingerprintSha256: null,
      env: "dev",
      releaseId: null,
      manifestPath: null,
      manifestValid: false,
      agentIndexSchemaVersion: null,
      indexGeneratedAt: null,
      companyCount: null,
      documentCount: null,
      objectCount: null,
      toolCount: null,
      tools: [],
      root: "/srv/krw-ontology-data/current",
      indexPath: "/srv/krw-ontology-data/current/indexes/global_spine.sqlite",
      pluginPath: "/srv/krw-ontology/plugins/krw-ontology",
      releaseMetadata: null,
      error: "MCP unavailable",
    });
  });

  it("strips chart tokens and skips chart persistence while chart generation is disabled", async () => {
    const fake = createRunnerAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);
    vi.mocked(checkMcpReady).mockResolvedValue(readyMcpHealth());
    vi.mocked(runAgent).mockResolvedValue({
      status: "completed",
      acc: {
        fullText: [
          "요약입니다.",
          "",
          "[[krw-chart:chart_1_deadbeef]]",
          "",
          "후속 설명입니다.",
        ].join("\n"),
        structuredOutput: null,
        researchSynthesisOutput: null,
        researchSynthesisText: null,
        displayPlanOutput: null,
        toolCalls: [],
        citations: [],
        inputTokens: 10,
        outputTokens: 20,
        cacheHitInputTokens: 0,
        cacheMissInputTokens: 0,
      },
    });

    await runAgentJob("run-1", "worker-1");

    expect(fake.inserted).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ table: "chat_message_charts" }),
      ]),
    );
    expect(fake.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "messages",
          payload: expect.objectContaining({
            content: "요약입니다.\n\n후속 설명입니다.",
            status: "completed",
          }),
          filters: { id: "assistant-message-1" },
        }),
      ]),
    );
    expect(appendAgentRunEvent).toHaveBeenCalledWith(
      fake.admin,
      "run-1",
      "done",
      expect.objectContaining({
        content: "요약입니다.\n\n후속 설명입니다.",
        charts: [],
      }),
    );
  });

  it("redacts sensitive output before storing and streaming completed answers", async () => {
    const fake = createRunnerAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);
    vi.mocked(checkMcpReady).mockResolvedValue(readyMcpHealth());
    vi.mocked(runAgent).mockResolvedValue({
      status: "completed",
      acc: {
        fullText:
          "경로는 ~/krw-ontology-front 이고 SUPABASE_SERVICE_ROLE_KEY=secret 입니다.",
        structuredOutput: null,
        researchSynthesisOutput: null,
        researchSynthesisText: null,
        displayPlanOutput: null,
        toolCalls: [],
        citations: [],
        inputTokens: 10,
        outputTokens: 20,
        cacheHitInputTokens: 0,
        cacheMissInputTokens: 0,
      },
    });

    await runAgentJob("run-1", "worker-1");

    const expectedContent =
      "경로는 [내부 경로 제거됨] 이고 [민감 환경변수 제거됨] 입니다.";
    expect(fake.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "messages",
          payload: expect.objectContaining({
            content: expectedContent,
            status: "completed",
          }),
          filters: { id: "assistant-message-1" },
        }),
      ]),
    );
    expect(appendAgentRunEvent).toHaveBeenCalledWith(
      fake.admin,
      "run-1",
      "done",
      expect.objectContaining({
        content: expectedContent,
      }),
    );
  });

  it("runs auto routing inside the worker before the research SDK pass", async () => {
    const fake = createRunnerAdmin({
      userMessageContent: "AAPL 오늘 왜 떨어져?",
      queuedEventPayload: {
        research_mode: "standard",
        analysis_mode: "company",
        run_kind: "company_research",
        routing_mode: "auto",
        response_locale: "ko",
      },
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);
    vi.mocked(checkMcpReady).mockResolvedValue(readyMcpHealth());
    vi.mocked(resolveChatQuestionRoute).mockResolvedValue({
      analysisMode: "news",
      runKind: "market_move_research",
      source: "claude_router",
      confidence: "medium",
      reason: "test market move route",
    });
    vi.mocked(runAgent).mockResolvedValue({
      status: "completed",
      acc: {
        fullText: "오늘 주가 변동 요약",
        structuredOutput: null,
        researchSynthesisOutput: null,
        researchSynthesisText: null,
        displayPlanOutput: null,
        toolCalls: [],
        citations: [],
        inputTokens: 10,
        outputTokens: 20,
        cacheHitInputTokens: 0,
        cacheMissInputTokens: 0,
      },
    });

    await runAgentJob("run-1", "worker-1");

    expect(resolveChatQuestionRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "session-1",
        content: "AAPL 오늘 왜 떨어져?",
        currentAnalysisMode: "company",
        currentRunKind: "company_research",
        defaultTickers: ["AAPL"],
        scopeType: "company",
      }),
    );
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisMode: "news",
        runKind: "market_move_research",
        selectedNewsEventContext: null,
      }),
      expect.any(Object),
    );
    expect(fake.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "agent_runs",
          payload: expect.objectContaining({
            run_kind: "market_move_research",
            executor_type: "claude_agent",
          }),
          filters: { id: "run-1" },
        }),
      ]),
    );
    expect(appendAgentRunEvent).toHaveBeenCalledWith(
      fake.admin,
      "run-1",
      "activity_update",
      expect.objectContaining({
        stage: "routing",
        label: "분석 방식 확인 완료",
        routing: expect.objectContaining({
          mode: "auto",
          run_kind: "market_move_research",
          has_selected_news_event_context: false,
        }),
      }),
    );
  });

  it("keeps auto-routed scenario questions on the scenario sensitivity run kind", async () => {
    const fake = createRunnerAdmin({
      userMessageContent: "앞으로의 시나리오 알려줘",
      queuedEventPayload: {
        research_mode: "standard",
        analysis_mode: "company",
        run_kind: "company_research",
        routing_mode: "auto",
        response_locale: "ko",
      },
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);
    vi.mocked(checkMcpReady).mockResolvedValue(readyMcpHealth());
    vi.mocked(resolveChatQuestionRoute).mockResolvedValue({
      analysisMode: "company",
      runKind: "scenario_sensitivity",
      source: "claude_router",
      confidence: "medium",
      reason: "test scenario route",
    });
    vi.mocked(runAgent).mockResolvedValue({
      status: "completed",
      acc: {
        fullText: "시나리오 분석 결과",
        structuredOutput: null,
        researchSynthesisOutput: null,
        researchSynthesisText: null,
        displayPlanOutput: null,
        toolCalls: [],
        citations: [],
        inputTokens: 10,
        outputTokens: 20,
        cacheHitInputTokens: 0,
        cacheMissInputTokens: 0,
      },
    });

    await runAgentJob("run-1", "worker-1");

    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisMode: "company",
        runKind: "scenario_sensitivity",
      }),
      expect.any(Object),
    );
    expect(fake.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "agent_runs",
          payload: expect.objectContaining({
            run_kind: "scenario_sensitivity",
            executor_type: "claude_agent",
          }),
          filters: { id: "run-1" },
        }),
      ]),
    );
    expect(appendAgentRunEvent).toHaveBeenCalledWith(
      fake.admin,
      "run-1",
      "activity_update",
      expect.objectContaining({
        stage: "routing",
        label: "분석 방식 확인 완료",
        routing: expect.objectContaining({
          mode: "auto",
          run_kind: "scenario_sensitivity",
          has_selected_news_event_context: false,
        }),
      }),
    );
  });

  it("builds selected news source packs inside the worker before company research", async () => {
    const selectedEvent = {
      id: "apple-market-news",
      ticker: "AAPL",
      event_title: "Apple shares rise after market news",
      event_title_ko: "시장 뉴스 이후 애플 주가 상승",
      source_previews: [
        {
          publisher: "Reuters",
          domain: "reuters.com",
          url: "https://example.test/apple",
        },
      ],
    };
    const fake = createRunnerAdmin({
      runOverrides: {
        run_kind: "company_research",
        executor_type: "claude_agent",
        selected_news_event_context: selectedEvent,
      },
      queuedEventPayload: {
        analysis_mode: "company",
        run_kind: "company_research",
        response_locale: "en",
      },
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);
    vi.mocked(checkMcpReady).mockResolvedValue(readyMcpHealth());
    vi.mocked(buildSelectedNewsSourcePack).mockResolvedValue({
      version: "news-source-pack/v1",
      selected_event_id: "apple-market-news",
      read_at: "2026-05-25T00:00:02.000Z",
      source_urls: ["https://example.test/apple"],
      source_previews: selectedEvent.source_previews,
      reads: [
        {
          url: "https://example.test/apple",
          ok: true,
          text: "Original market news text",
        },
      ],
      original_text_for_ontology: "Original market news text",
      ontology_search_brief_en:
        "Use the article text as a market hypothesis for Apple and anchor it against filings.",
      source_read_status: "read",
      claims_ko: ["시장 뉴스 이후 애플 주가 상승"],
    });
    vi.mocked(runAgent).mockResolvedValue({
      status: "completed",
      acc: {
        fullText: "공시 기준 분석 결과",
        structuredOutput: null,
        researchSynthesisOutput: null,
        researchSynthesisText: null,
        displayPlanOutput: null,
        toolCalls: [],
        citations: [],
        inputTokens: 10,
        outputTokens: 20,
        cacheHitInputTokens: 0,
        cacheMissInputTokens: 0,
      },
    });

    await runAgentJob("run-1", "worker-1");

    expect(buildSelectedNewsSourcePack).toHaveBeenCalledWith(selectedEvent);
    expect(runAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        runKind: "company_research",
        responseLocale: "en",
        selectedNewsEventContext: expect.objectContaining({
          ...selectedEvent,
          source_pack: expect.objectContaining({
            original_text_for_ontology: "Original market news text",
            ontology_search_brief_en:
              "Use the article text as a market hypothesis for Apple and anchor it against filings.",
          }),
        }),
      }),
      expect.any(Object),
    );
    expect(fake.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "agent_runs",
          payload: {
            selected_news_event_context: expect.objectContaining({
              source_pack: expect.objectContaining({
                source_read_status: "read",
              }),
            }),
          },
          filters: { id: "run-1" },
        }),
        expect.objectContaining({
          table: "chat_message_artifact_selections",
          payload: expect.objectContaining({
            selected_payload_json: expect.objectContaining({
              source_pack: expect.objectContaining({
                source_read_status: "read",
              }),
            }),
          }),
          filters: { research_run_id: "run-1" },
        }),
      ]),
    );
  });

  it("fails safely before invoking Claude when MCP is unavailable", async () => {
    const fake = createRunnerAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    await runAgentJob("run-1", "worker-1");

    expect(runAgent).not.toHaveBeenCalled();
    expect(fake.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "messages",
          payload: { status: "streaming" },
          filters: { id: "assistant-message-1" },
        }),
        expect.objectContaining({
          table: "agent_runs",
          payload: expect.objectContaining({
            status: "failed",
            error_code: "mcp_unavailable",
            error_message: "MCP unavailable",
            lease_expires_at: null,
          }),
          filters: { id: "run-1" },
        }),
        expect.objectContaining({
          table: "messages",
          payload: expect.objectContaining({
            status: "failed",
          }),
          filters: { id: "assistant-message-1" },
        }),
      ]),
    );
    expect(fake.rpc).toHaveBeenCalledWith("release_execution_budget", {
      p_user_id: "user-1",
      p_request_id: "req-1",
      p_run_id: "run-1",
      p_reason: "mcp_unavailable",
    });
    expect(appendAgentRunEvent).toHaveBeenCalledWith(
      fake.admin,
      "run-1",
      "activity_update",
      {
        stage: "preparing",
        label: "분석 준비 중",
      },
    );
    expect(appendAgentRunEvent).toHaveBeenCalledWith(
      fake.admin,
      "run-1",
      "error",
      expect.objectContaining({
        run_id: "run-1",
        error_code: "mcp_unavailable",
      }),
    );
    expect(recordAnalyticsEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "answer_failed",
        userId: "user-1",
        sessionId: "session-1",
        runId: "run-1",
      }),
    );
  });

  it("fails the run instead of invoking Claude when job history loading fails", async () => {
    const fake = createRunnerAdmin({
      previousMessagesError: {
        code: "XX000",
        message: "database unavailable",
      },
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    await runAgentJob("run-1", "worker-1");

    expect(runAgent).not.toHaveBeenCalled();
    expect(fake.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "messages",
          payload: {
            content: "",
            status: "failed",
          },
          filters: { id: "assistant-message-1" },
        }),
        expect.objectContaining({
          table: "agent_runs",
          payload: expect.objectContaining({
            status: "failed",
            error_code: "internal_error",
            error_message:
              "Agent history load failed: XX000: database unavailable",
            lease_expires_at: null,
          }),
          filters: { id: "run-1" },
        }),
      ]),
    );
    expect(appendAgentRunEvent).toHaveBeenCalledWith(
      fake.admin,
      "run-1",
      "error",
      expect.objectContaining({
        run_id: "run-1",
        error_code: "internal_error",
      }),
    );
  });

  it("closes open tool calls when a worker failure makes the run terminal", async () => {
    const fake = createRunnerAdmin({
      openToolCalls: [{ id: "tool-open-1", error_message: null }],
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);

    await runAgentJob("run-1", "worker-1");

    expect(fake.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "tool_calls",
          payload: expect.objectContaining({
            finished_at: expect.any(String),
            error_message:
              "Run failed before tool result was received: MCP unavailable",
          }),
          filters: { id: "tool-open-1" },
        }),
      ]),
    );
  });

  it("marks a stuck SDK run expired before the worker lease expires", async () => {
    vi.useFakeTimers();
    const fake = createRunnerAdmin();
    vi.mocked(getSupabaseAdmin).mockReturnValue(fake.admin);
    vi.mocked(checkMcpReady).mockResolvedValue({
      connected: true,
      staticOk: true,
      commandOk: true,
      liveOk: true,
      sqliteOk: true,
      contractOk: true,
      toolParityOk: true,
      fingerprintOk: true,
      fingerprintErrors: [],
      mcpContractVersion: "krw-ontology-mcp/v2",
      buildId: "build-1",
      backendGitSha: "backend-sha-1",
      toolSchemaSha256: "a".repeat(64),
      buildFingerprintSha256: "a".repeat(64),
      releaseManifestSha256: "a".repeat(64),
      serviceFingerprintSha256: "a".repeat(64),
      env: "dev",
      releaseId: "release-1",
      manifestPath: "/srv/krw-ontology-data/current/manifest.json",
      manifestValid: true,
      agentIndexSchemaVersion: "agent_index_v1",
      indexGeneratedAt: "2026-05-25T00:00:00.000Z",
      companyCount: 10,
      documentCount: 20,
      objectCount: 30,
      toolCount: 13,
      tools: ["krw_ontology_query_context"],
      root: "/srv/krw-ontology-data/current",
      indexPath: "/srv/krw-ontology-data/current/indexes/global_spine.sqlite",
      pluginPath: "/srv/krw-ontology/plugins/krw-ontology",
      releaseMetadata: {
        env: "dev",
        release_id: "release-1",
        manifest_valid: true,
      },
    });
    vi.mocked(runAgent).mockReturnValue(new Promise(() => undefined));

    const job = runAgentJob("run-1", "worker-1");
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 1);
    await job;
    vi.useRealTimers();

    expect(fake.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "agent_runs",
          payload: expect.objectContaining({
            status: "expired",
            error_code: "lease_expired",
            error_message: "분석 시간이 초과되었습니다. 다시 시도해주세요.",
            lease_expires_at: null,
          }),
          filters: { id: "run-1" },
        }),
        expect.objectContaining({
          table: "messages",
          payload: expect.objectContaining({
            status: "failed",
          }),
          filters: { id: "assistant-message-1" },
        }),
      ]),
    );
  });
});
