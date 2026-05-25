import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/analytics/server", () => ({
  recordAnalyticsEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/agent/mcp-client", () => ({
  checkMcpHealth: vi.fn(),
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

import { recordAnalyticsEvent } from "@/lib/analytics/server";
import { checkMcpHealth } from "@/lib/agent/mcp-client";
import { runAgent } from "@/lib/agent/runner";
import { appendAgentRunEvent } from "@/lib/agent/run-events";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { runAgentJob } from "./job-runner";

function createRunnerAdmin() {
  const updates: Array<{
    table: string;
    payload: Record<string, unknown>;
    filters: Record<string, unknown>;
  }> = [];
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

  const rows = {
    agent_runs: [
      {
        id: "run-1",
        session_id: "session-1",
        user_message_id: "user-message-1",
        assistant_message_id: "assistant-message-1",
        request_id: "req-1",
        started_at: "2026-05-25T00:00:00.000Z",
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
        content: "Apple 매출 알려줘",
        status: "completed",
      },
    ],
  };

  const admin = {
    rpc,
    from(table: string) {
      return {
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
              const candidates =
                table === "agent_runs"
                  ? rows.agent_runs
                  : table === "chat_sessions"
                    ? rows.chat_sessions
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
    rpc,
  };
}

describe("agent job runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(checkMcpHealth).mockResolvedValue({
      connected: false,
      staticOk: true,
      commandOk: true,
      liveOk: false,
      sqliteOk: true,
      releaseId: null,
      indexGeneratedAt: null,
      companyCount: null,
      documentCount: null,
      objectCount: null,
      toolCount: null,
      tools: [],
      root: "/srv/krw-ontology-data/current",
      indexPath: "/srv/krw-ontology-data/current/indexes/agent_index.sqlite",
      pluginPath: "/srv/krw-ontology/plugins/krw-ontology",
      error: "MCP unavailable",
    });
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
});
