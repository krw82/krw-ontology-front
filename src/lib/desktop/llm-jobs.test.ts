import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/concurrency/analysis-credits", () => ({
  reserveAnalysisCreditsShadow: vi.fn(),
  settleAnalysisCreditsShadow: vi.fn(),
}));

import {
  reserveAnalysisCreditsShadow,
  settleAnalysisCreditsShadow,
} from "@/lib/concurrency/analysis-credits";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { DesktopLlmJobRow } from "@/types/database";
import { verifyLlmJobToken } from "./llm-token";
import { createDesktopLlmJob, finalizeDesktopLlmJob } from "./llm-jobs";

const JOB_TOKEN_SECRET = "test-secret-that-is-long-enough-for-job-tokens";

const auth = {
  userId: "user-1",
  userEmail: null,
  deviceId: "device-1",
  authMethod: "desktop_access_token" as const,
};

function job(overrides: Partial<DesktopLlmJobRow> = {}): DesktopLlmJobRow {
  return {
    id: "job-1",
    user_id: "user-1",
    device_id: "device-1",
    local_session_id: "session-1",
    local_run_id: "run-1",
    runtime: "claude-sdk",
    token_jti: "jti-1",
    token_hash: "hash-1",
    status: "active",
    provider: "deepseek",
    model_profile: "deepseek-v4-flash",
    sdk_model: "claude-sonnet-4-6",
    upstream_model: "deepseek-v4-flash",
    gateway_base_url: "https://app.example.com/llm/anthropic",
    max_budget_usd: 1,
    max_request_count: 128,
    request_count: 2,
    max_input_tokens: null,
    max_output_tokens: 8192,
    expires_at: "2026-06-21T01:00:00.000Z",
    last_used_at: "2026-06-21T00:05:00.000Z",
    finalized_at: null,
    usage_input_tokens: 100,
    usage_output_tokens: 20,
    usage_cache_read_input_tokens: 10,
    usage_cache_creation_input_tokens: 0,
    actual_provider_cost_usd: null,
    error_code: null,
    metadata: { credit_request_id: "desktop-llm:job-1" },
    created_at: "2026-06-21T00:00:00.000Z",
    updated_at: "2026-06-21T00:05:00.000Z",
    ...overrides,
  };
}

function queryResult<T>(data: T, error: unknown = null) {
  const query = {
    select: vi.fn(() => query),
    update: vi.fn(() => query),
    eq: vi.fn(() => query),
    is: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data, error })),
  };
  return query;
}

describe("Desktop LLM job finalization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.KRW_LLM_JOB_TOKEN_SECRET = JOB_TOKEN_SECRET;
    vi.mocked(reserveAnalysisCreditsShadow).mockResolvedValue({
      ok: true,
      allowed: true,
      reservationId: "reservation-1",
    });
    vi.mocked(settleAnalysisCreditsShadow).mockResolvedValue(undefined);
  });

  it("returns the same job token for duplicate device-scoped local run requests", async () => {
    const admin = createLlmJobAdminFake();
    vi.mocked(getSupabaseAdmin).mockReturnValue(admin as never);
    const input = {
      localRunId: "run-1",
      localSessionId: "session-1",
      requestedModel: null,
      runtime: "claude-sdk" as const,
      requestedMaxBudgetUsd: null,
      requestedTtlSeconds: null,
    };
    const now = new Date("2026-06-21T00:00:00.000Z");

    const first = await createDesktopLlmJob(auth, input, now);
    const duplicate = await createDesktopLlmJob(auth, input, now);

    expect(duplicate.job_id).toBe(first.job_id);
    expect(duplicate.token).toBe(first.token);
    expect(admin.rows.size).toBe(1);
    expect(reserveAnalysisCreditsShadow).toHaveBeenCalledTimes(2);
    expect(reserveAnalysisCreditsShadow).toHaveBeenNthCalledWith(
      1,
      "user-1",
      `desktop-llm:${first.job_id}`,
      expect.any(Object),
    );
    expect(reserveAnalysisCreditsShadow).toHaveBeenNthCalledWith(
      2,
      "user-1",
      `desktop-llm:${first.job_id}`,
      expect.any(Object),
    );
    expect(
      verifyLlmJobToken(first.token, JOB_TOKEN_SECRET, new Date("2026-06-21T00:05:00.000Z")),
    ).toMatchObject({
      job_id: first.job_id,
      user_id: "user-1",
      device_id: "device-1",
      local_run_id: "run-1",
      provider: "deepseek",
    });
  });

  it("settles credits only when this request claims finalization", async () => {
    const initial = queryResult(job());
    const claimed = queryResult({
      id: "job-1",
      status: "completed",
      finalized_at: "2026-06-21T00:10:00.000Z",
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue({
      from: vi
        .fn()
        .mockReturnValueOnce(initial)
        .mockReturnValueOnce(claimed),
    } as never);

    const result = await finalizeDesktopLlmJob(
      auth,
      "job-1",
      {
        terminalStatus: "completed",
        inputTokens: 120,
        outputTokens: 30,
        cacheReadInputTokens: 15,
        cacheCreationInputTokens: 0,
        errorCode: null,
      },
      new Date("2026-06-21T00:10:00.000Z"),
    );

    expect(result.already_finalized).toBe(false);
    expect(settleAnalysisCreditsShadow).toHaveBeenCalledTimes(1);
    expect(settleAnalysisCreditsShadow).toHaveBeenCalledWith(
      auth.userId,
      "desktop-llm:job-1",
      null,
      expect.objectContaining({
        terminalStatus: "completed",
        inputTokens: 120,
        outputTokens: 30,
        metadata: expect.objectContaining({
          source: "desktop_llm_gateway",
          desktop_llm_job_id: "job-1",
          local_run_id: "run-1",
        }),
      }),
    );
  });

  it("does not settle credits twice when another request finalized first", async () => {
    const initial = queryResult(job());
    const lostClaim = queryResult(null);
    const finalized = queryResult({
      id: "job-1",
      status: "completed",
      finalized_at: "2026-06-21T00:10:00.000Z",
    });
    vi.mocked(getSupabaseAdmin).mockReturnValue({
      from: vi
        .fn()
        .mockReturnValueOnce(initial)
        .mockReturnValueOnce(lostClaim)
        .mockReturnValueOnce(finalized),
    } as never);

    const result = await finalizeDesktopLlmJob(
      auth,
      "job-1",
      {
        terminalStatus: "completed",
        inputTokens: 120,
        outputTokens: 30,
        cacheReadInputTokens: 15,
        cacheCreationInputTokens: 0,
        errorCode: null,
      },
      new Date("2026-06-21T00:10:00.000Z"),
    );

    expect(result.already_finalized).toBe(true);
    expect(settleAnalysisCreditsShadow).not.toHaveBeenCalled();
  });
});

function createLlmJobAdminFake() {
  const rows = new Map<string, DesktopLlmJobRow>();
  const admin = {
    rows,
    from(table: string) {
      expect(table).toBe("desktop_llm_jobs");
      let insertPayload: Record<string, unknown> | null = null;
      const filters = new Map<string, unknown>();
      const query = {
        insert(payload: Record<string, unknown>) {
          insertPayload = payload;
          return query;
        },
        select() {
          return query;
        },
        eq(key: string, value: unknown) {
          filters.set(key, value);
          return query;
        },
        async single() {
          if (!insertPayload) throw new Error("single called without insert");
          const id = String(insertPayload.id);
          if (rows.has(id)) {
            return { data: null, error: { code: "23505", message: "duplicate" } };
          }
          const row = job({
            id,
            user_id: String(insertPayload.user_id),
            device_id: insertPayload.device_id as string | null,
            local_session_id: insertPayload.local_session_id as string | null,
            local_run_id: String(insertPayload.local_run_id),
            runtime: insertPayload.runtime as "claude-sdk",
            token_jti: String(insertPayload.token_jti),
            token_hash: String(insertPayload.token_hash),
            provider: insertPayload.provider as "deepseek",
            model_profile: String(insertPayload.model_profile),
            sdk_model: String(insertPayload.sdk_model),
            upstream_model: String(insertPayload.upstream_model),
            gateway_base_url: String(insertPayload.gateway_base_url),
            max_budget_usd: insertPayload.max_budget_usd as number | null,
            max_request_count: Number(insertPayload.max_request_count),
            request_count: 0,
            max_input_tokens: insertPayload.max_input_tokens as number | null,
            max_output_tokens: insertPayload.max_output_tokens as number | null,
            expires_at: String(insertPayload.expires_at),
            metadata: insertPayload.metadata as DesktopLlmJobRow["metadata"],
            created_at: String(insertPayload.created_at),
            updated_at: String(insertPayload.updated_at),
          });
          rows.set(id, row);
          return { data: row, error: null };
        },
        async maybeSingle() {
          const id = filters.get("id");
          const userId = filters.get("user_id");
          const row =
            typeof id === "string" && rows.get(id)?.user_id === userId
              ? rows.get(id)
              : null;
          return { data: row ?? null, error: null };
        },
      };
      return query;
    },
  };
  return admin;
}
