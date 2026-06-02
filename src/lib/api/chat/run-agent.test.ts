import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/concurrency/execution-budget", () => ({
  attachExecutionBudgetRun: vi.fn(),
  releaseExecutionBudget: vi.fn(),
  settleExecutionBudget: vi.fn(),
  checkExecutionBudget: vi.fn().mockResolvedValue({
    allowed: true,
    budgetUsedUsd: 0,
    budgetReservedUsd: 0,
    budgetLimitUsd: 20,
    dailyBudgetUsedUsd: 0,
    dailyBudgetReservedUsd: 0,
    dailyBudgetLimitUsd: 20,
    reserveCostUsd: 0,
    runCount: 0,
  }),
  getExecutionBudgetStatus: vi.fn(() => ({
    budget_used_usd: 0,
    budget_reserved_usd: 0,
    budget_limit_usd: 20,
    remaining_budget_usd: 20,
    daily_budget_used_usd: 0,
    daily_budget_reserved_usd: 0,
    daily_budget_limit_usd: 20,
    per_run_reserve_usd: 0,
    analysis_credits_used: 0,
    analysis_credits_reserved: 0,
    analysis_credits_limit: 20000,
    remaining_analysis_credits: 20000,
    daily_analysis_credits_used: 0,
    daily_analysis_credits_reserved: 0,
    daily_analysis_credits_limit: 20000,
    per_run_analysis_credits: 0,
    run_count: 0,
    percent_used: 0,
    can_run: true,
  })),
  estimateCost: vi.fn(() => 0),
}));

import { streamPersistedRunEvents } from "./run-agent";
import type { StreamWriter } from "@/lib/agent/stream-handler";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";

type FakeRun = {
  id: string;
  session_id: string;
  assistant_message_id: string | null;
  request_id: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  lease_expires_at: string | null;
  started_at: string;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  latency_ms: number | null;
  ontology_release_id: string | null;
  index_generated_at: string | null;
  company_count: number | null;
  document_count: number | null;
  error_code: string | null;
  error_message: string | null;
};

type FakeMessage = {
  id: string;
  content: string;
  status: "pending" | "streaming" | "completed" | "failed";
};

function makeRun(overrides: Partial<FakeRun> = {}): FakeRun {
  return {
    id: "550e8400-e29b-41d4-a716-446655440001",
    session_id: "550e8400-e29b-41d4-a716-446655440000",
    assistant_message_id: "550e8400-e29b-41d4-a716-446655440002",
    request_id: "req-1",
    status: "running",
    lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    started_at: new Date().toISOString(),
    input_tokens: null,
    output_tokens: null,
    estimated_cost_usd: null,
    latency_ms: null,
    ontology_release_id: null,
    index_generated_at: null,
    company_count: null,
    document_count: null,
    error_code: null,
    error_message: null,
    ...overrides,
  };
}

function createFakeAdmin(params: {
  runs?: FakeRun[];
  messages?: FakeMessage[];
  updates?: Array<{ table: string; payload: Record<string, unknown> }>;
}) {
  const runs = params.runs ?? [];
  const messages = params.messages ?? [];
  const updates = params.updates ?? [];

  const makeQuery = (table: string, mode: "select" | "update", payload?: Record<string, unknown>) => {
    const filters: Record<string, unknown> = {};
    const inFilters: Record<string, unknown[]> = {};

    const query = {
      eq(key: string, value: unknown) {
        filters[key] = value;
        return query;
      },
      in(key: string, value: unknown[]) {
        inFilters[key] = value;
        return query;
      },
      is() {
        return query;
      },
      order() {
        return query;
      },
      limit() {
        return query;
      },
      maybeSingle() {
        if (mode === "update") {
          updates.push({ table, payload: payload ?? {} });
          return Promise.resolve({ data: null, error: null });
        }

        const rows = table === "agent_runs" ? runs : messages;
        const matched = rows.filter((row) => {
          const record = row as Record<string, unknown>;
          return (
            Object.entries(filters).every(([key, value]) => record[key] === value) &&
            Object.entries(inFilters).every(([key, values]) =>
              values.includes(record[key]),
            )
          );
        });
        return Promise.resolve({ data: matched[0] ?? null, error: null });
      },
      returns() {
        if (table === "tool_calls") {
          return Promise.resolve({
            data: [{ id: "tool-open-1", error_message: null }],
            error: null,
          });
        }
        return Promise.resolve({ data: [], error: null });
      },
      then(resolve: (value: { data: null; error: null }) => unknown) {
        updates.push({ table, payload: payload ?? {} });
        return Promise.resolve({ data: null, error: null }).then(resolve);
      },
    };

    return query;
  };

  return {
    from(table: string) {
      return {
        select() {
          return makeQuery(table, "select");
        },
        update(payload: Record<string, unknown>) {
          return makeQuery(table, "update", payload);
        },
      };
    },
  } as unknown as ReturnType<typeof getSupabaseAdmin>;
}

function createWriter() {
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  const writer: StreamWriter = {
    write: async (chunk) => {
      chunks.push(decoder.decode(chunk));
    },
  };

  return {
    writer,
    events() {
      return chunks
        .join("")
        .trim()
        .split("\n\n")
        .filter(Boolean)
        .map((block) => {
          const eventLine = block.split("\n").find((line) => line.startsWith("event: "));
          const dataLine = block.split("\n").find((line) => line.startsWith("data: "));
          return {
            event: eventLine?.slice("event: ".length),
            data: dataLine ? JSON.parse(dataLine.slice("data: ".length)) : null,
          };
        });
    },
  };
}

describe("streamPersistedRunEvents", () => {
  it("turns a stale run id into session state sync instead of a user-visible error", async () => {
    const io = createWriter();
    const admin = createFakeAdmin({});

    await streamPersistedRunEvents({
      admin,
      writer: io.writer,
      encoder: new TextEncoder(),
      runId: "550e8400-e29b-41d4-a716-446655440099",
      sessionId: "550e8400-e29b-41d4-a716-446655440000",
      userId: "user-1",
    });

    expect(io.events()).toEqual([
      {
        event: "state_sync",
        data: {
          session_id: "550e8400-e29b-41d4-a716-446655440000",
          run_id: "550e8400-e29b-41d4-a716-446655440099",
          status: "idle",
          reason: "stale_run",
        },
      },
    ]);
  });

  it("expires an abandoned running run during reconnect", async () => {
    const updates: Array<{ table: string; payload: Record<string, unknown> }> = [];
    const run = makeRun({
      lease_expires_at: new Date(Date.now() - 60_000).toISOString(),
    });
    const message: FakeMessage = {
      id: run.assistant_message_id!,
      content: "",
      status: "streaming",
    };
    const io = createWriter();
    const admin = createFakeAdmin({ runs: [run], messages: [message], updates });

    await streamPersistedRunEvents({
      admin,
      writer: io.writer,
      encoder: new TextEncoder(),
      runId: run.id,
      sessionId: run.session_id,
      userId: "user-1",
    });

    const events = io.events();
    expect(events.map((event) => event.event)).toEqual([
      "run_started",
      "activity_update",
      "error",
    ]);
    expect(events.at(-1)?.data).toMatchObject({
      run_id: run.id,
      error_code: "lease_expired",
      error_message: "분석 시간이 초과되었습니다. 다시 시도해주세요.",
    });
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "agent_runs",
          payload: expect.objectContaining({
            status: "failed",
            error_code: "lease_expired",
            lease_expires_at: null,
          }),
        }),
        expect.objectContaining({
          table: "messages",
          payload: expect.objectContaining({
            status: "failed",
            content: "분석 시간이 초과되었습니다. 다시 시도해주세요.",
          }),
        }),
        expect.objectContaining({
          table: "tool_calls",
          payload: expect.objectContaining({
            finished_at: expect.any(String),
            error_message: "Lease expired before tool result was received",
          }),
        }),
      ]),
    );
  });

  it("does not stream raw persisted agent errors to the browser", async () => {
    const run = makeRun({
      status: "failed",
      error_code: "claude_api_error",
      error_message: "stack trace: secret=/srv/claude-prod/token",
    });
    const io = createWriter();
    const admin = createFakeAdmin({ runs: [run] });

    await streamPersistedRunEvents({
      admin,
      writer: io.writer,
      encoder: new TextEncoder(),
      runId: run.id,
      sessionId: run.session_id,
      userId: "user-1",
    });

    const errorEvent = io.events().find((event) => event.event === "error");
    expect(errorEvent?.data).toMatchObject({
      run_id: run.id,
      error_code: "claude_api_error",
      error_message: "에이전트 실행 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
    });
    expect(JSON.stringify(errorEvent?.data)).not.toContain("secret=");
  });
});
