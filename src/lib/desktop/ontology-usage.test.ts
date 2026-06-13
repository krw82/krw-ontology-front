import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  checkDesktopOntologyRateLimit,
  createDesktopOntologyToolAuditStart,
  finishDesktopOntologyToolAuditFailure,
  finishDesktopOntologyToolAuditSuccess,
  withDesktopOntologyUsage,
} from "./ontology-usage";
import type { DesktopAuthContext } from "./auth";
import type {
  DesktopOntologyToolCallRequest,
  DesktopOntologyToolCallSuccess,
} from "./ontology-contracts";

const auth: DesktopAuthContext = {
  userId: "user-1",
  userEmail: "user@example.test",
  deviceId: "device-1",
  authMethod: "desktop_access_token",
};

const request: DesktopOntologyToolCallRequest = {
  local_session_id: "local-session-1",
  local_run_id: "local-run-1",
  tool_call_id: "tool-1",
  tool_name: "krw_ontology_query_context",
  arguments: {
    question: "AAPL very sensitive demand question",
    tickers: ["AAPL"],
    limit_results: 3,
    response_detail: "compact",
  },
  desktop_context: {
    app_version: "0.1.0",
    protocol_version: "desktop/v1",
  },
};

const response: DesktopOntologyToolCallSuccess = {
  ok: true,
  tool_call_id: "tool-1",
  tool_name: "krw_ontology_query_context",
  result_text: "Evidence",
  result_json: {
    evidence: [{ ticker: "AAPL" }, { ticker: "MSFT" }],
    citations: [{ ticker: "AAPL" }],
  },
  ontology_release: {
    release_id: "release-1",
    api_version: "ontology-search/v1",
  },
  usage: {
    tool_calls_consumed: 1,
  },
};

function mockAdmin(admin: unknown) {
  vi.mocked(getSupabaseAdmin).mockReturnValue(
    admin as ReturnType<typeof getSupabaseAdmin>,
  );
}

describe("Desktop ontology usage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DESKTOP_ONTOLOGY_TOOL_CALLS_PER_USER_PER_MINUTE;
    delete process.env.DESKTOP_ONTOLOGY_TOOL_CALLS_PER_DEVICE_PER_MINUTE;
    delete process.env.DESKTOP_ONTOLOGY_TOOL_CALLS_PER_USER_PER_DAY;
  });

  it("checks user, device, and daily durable rate-limit buckets", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{ allowed: true, current_count: 1, retry_after_seconds: 0 }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ allowed: true, current_count: 1, retry_after_seconds: 0 }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ allowed: true, current_count: 11, retry_after_seconds: 0 }],
        error: null,
      });
    mockAdmin({ rpc });

    const result = await checkDesktopOntologyRateLimit(
      auth,
      new Date("2026-06-10T12:34:56.000Z"),
    );

    expect(result).toEqual({ ok: true, remainingToday: 489 });
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(rpc).toHaveBeenNthCalledWith(1, "increment_rate_limit", {
      p_key: "user:user-1",
      p_bucket: "desktop_ontology:user:minute",
      p_window_start: "2026-06-10T12:34:00.000Z",
      p_window_seconds: 60,
      p_limit: 30,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "increment_rate_limit", {
      p_key: "device:device-1",
      p_bucket: "desktop_ontology:device:minute",
      p_window_start: "2026-06-10T12:34:00.000Z",
      p_window_seconds: 60,
      p_limit: 30,
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "increment_rate_limit", {
      p_key: "user:user-1",
      p_bucket: "desktop_ontology:user:day",
      p_window_start: "2026-06-10T00:00:00.000Z",
      p_window_seconds: 86400,
      p_limit: 500,
    });
  });

  it("returns a 429 response with Retry-After when a bucket is exhausted", async () => {
    mockAdmin({
      rpc: vi.fn().mockResolvedValue({
        data: [{ allowed: false, current_count: 31, retry_after_seconds: 17 }],
        error: null,
      }),
    });

    const result = await checkDesktopOntologyRateLimit(auth);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("Retry-After")).toBe("17");
    await expect(result.response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: "rate_limited",
      },
    });
  });

  it("creates a redacted audit start row before execution", async () => {
    const single = vi.fn().mockResolvedValue({
      data: {
        id: "audit-1",
        created_at: "2026-06-10T12:00:00.000Z",
      },
      error: null,
    });
    const select = vi.fn(() => ({ single }));
    const insert = vi.fn(() => ({ select }));
    mockAdmin({
      from: vi.fn(() => ({ insert })),
    });

    const audit = await createDesktopOntologyToolAuditStart(request, auth);

    expect(audit).toEqual({
      id: "audit-1",
      startedAt: Date.parse("2026-06-10T12:00:00.000Z"),
    });
    expect(insert).toHaveBeenCalledOnce();
    const insertCalls = insert.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    const payload = insertCalls[0][0];
    expect(payload).toMatchObject({
      user_id: "user-1",
      device_id: "device-1",
      local_session_id: "local-session-1",
      local_run_id: "local-run-1",
      tool_call_id: "tool-1",
      tool_name: "krw_ontology_query_context",
      status: "running",
      arguments_summary: {
        tickers: ["AAPL"],
        has_question: true,
        question_chars: 35,
      },
    });
    expect(payload.arguments_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(payload)).not.toContain(
      "AAPL very sensitive demand question",
    );
  });

  it("marks audit success with release, counts, size, and latency", async () => {
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    mockAdmin({
      from: vi.fn(() => ({ update })),
    });

    const latency = await finishDesktopOntologyToolAuditSuccess(
      {
        id: "audit-1",
        startedAt: Date.parse("2026-06-10T12:00:00.000Z"),
      },
      response,
      new Date("2026-06-10T12:00:01.234Z"),
    );

    expect(latency).toBe(1234);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "succeeded",
        ontology_release_id: "release-1",
        latency_ms: 1234,
        result_count: 2,
        completed_at: "2026-06-10T12:00:01.234Z",
      }),
    );
    const updateCalls = update.mock.calls as unknown as Array<
      [Record<string, unknown>]
    >;
    const payload = updateCalls[0][0];
    expect(payload.result_size_bytes).toEqual(expect.any(Number));
  });

  it("counts actual MCP query_context evidence nested in research_pack", async () => {
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    mockAdmin({
      from: vi.fn(() => ({ update })),
    });
    const mcpResponse: DesktopOntologyToolCallSuccess = {
      ...response,
      result_json: {
        research_status: "sufficient_for_default_answer",
        ticker_candidates: [],
        research_pack: {
          company_topic_pack: {
            top_candidates: [
              { ticker: "AAPL", id: "claim-1" },
              { ticker: "AAPL", id: "claim-2" },
              { ticker: "AAPL", id: "claim-3" },
            ],
          },
        },
        citations: [],
      },
    };

    await finishDesktopOntologyToolAuditSuccess(
      { id: "audit-1", startedAt: 0 },
      mcpResponse,
      new Date(500),
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        result_count: 3,
      }),
    );
  });

  it("sums actual MCP results_by_ticker arrays for comparison audits", async () => {
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    mockAdmin({
      from: vi.fn(() => ({ update })),
    });
    const mcpResponse: DesktopOntologyToolCallSuccess = {
      ...response,
      result_json: {
        results_by_ticker: {
          AAPL: [{ id: "a1" }, { id: "a2" }],
          MSFT: [{ id: "m1" }],
        },
      },
    };

    await finishDesktopOntologyToolAuditSuccess(
      { id: "audit-1", startedAt: 0 },
      mcpResponse,
      new Date(500),
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        result_count: 3,
      }),
    );
  });

  it("marks audit failure with a bounded error code", async () => {
    const update = vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) }));
    mockAdmin({
      from: vi.fn(() => ({ update })),
    });
    const error = Object.assign(new Error("failed"), {
      code: "ontology_unavailable",
    });

    await finishDesktopOntologyToolAuditFailure(
      {
        id: "audit-1",
        startedAt: Date.parse("2026-06-10T12:00:00.000Z"),
      },
      error,
      new Date("2026-06-10T12:00:02.000Z"),
    );

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        latency_ms: 2000,
        error_code: "ontology_unavailable",
        completed_at: "2026-06-10T12:00:02.000Z",
      }),
    );
  });

  it("merges audit id, latency, and remaining usage into tool responses", () => {
    expect(
      withDesktopOntologyUsage(
        response,
        { id: "audit-1", startedAt: 0 },
        { ok: true, remainingToday: 321 },
        456,
      ),
    ).toMatchObject({
      usage: {
        tool_calls_consumed: 1,
        remaining_today: 321,
      },
      audit: {
        server_tool_call_id: "audit-1",
        latency_ms: 456,
      },
    });
  });
});
