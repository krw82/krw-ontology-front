import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));
vi.mock("@/lib/concurrency/analysis-credits", () => ({
  reserveAnalysisCreditsShadow: vi.fn(),
  settleAnalysisCreditsShadow: vi.fn(),
}));

import { settleAnalysisCreditsShadow } from "@/lib/concurrency/analysis-credits";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { DesktopLlmJobRow } from "@/types/database";
import { finalizeDesktopLlmJob } from "./llm-jobs";

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
    vi.mocked(settleAnalysisCreditsShadow).mockResolvedValue(undefined);
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
