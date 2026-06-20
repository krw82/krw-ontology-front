import { describe, expect, it } from "vitest";
import type { DesktopLlmJobRow } from "../../../src/types/database";
import { enforceJobRequest, upstreamHeaders } from "./server";

function job(overrides: Partial<DesktopLlmJobRow> = {}): DesktopLlmJobRow {
  return {
    id: "job-1",
    user_id: "user-1",
    device_id: "device-1",
    local_session_id: "session-1",
    local_run_id: "run-1",
    runtime: "claude-sdk",
    token_jti: "jti-1",
    token_hash: "hash",
    status: "active",
    provider: "deepseek",
    model_profile: "deepseek-v4-flash",
    sdk_model: "claude-sonnet-4-6",
    upstream_model: "deepseek-v4-flash",
    gateway_base_url: "https://app.example.com/llm/anthropic",
    max_budget_usd: 1,
    max_request_count: 128,
    request_count: 1,
    max_input_tokens: null,
    max_output_tokens: 4096,
    expires_at: "2026-06-21T01:00:00.000Z",
    last_used_at: null,
    finalized_at: null,
    usage_input_tokens: 0,
    usage_output_tokens: 0,
    usage_cache_read_input_tokens: 0,
    usage_cache_creation_input_tokens: 0,
    actual_provider_cost_usd: null,
    error_code: null,
    metadata: {},
    created_at: "2026-06-21T00:00:00.000Z",
    updated_at: "2026-06-21T00:00:00.000Z",
    ...overrides,
  };
}

describe("LLM gateway request enforcement", () => {
  it("forces the server-selected DeepSeek model and replaces provider metadata", () => {
    const result = enforceJobRequest(
      {
        model: "claude-opus-4-6",
        max_tokens: 1024,
        metadata: { client_field: "kept" },
      },
      job(),
    );

    expect(result.model).toBe("deepseek-v4-flash");
    expect(result.metadata).toMatchObject({
      client_field: "kept",
      user_id: expect.stringMatching(/^krw_[0-9a-f]{32}$/),
    });
  });

  it("rejects max_tokens above the job limit", () => {
    expect(() =>
      enforceJobRequest(
        {
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
        },
        job({ max_output_tokens: 4096 }),
      ),
    ).toThrow(/exceeds the job limit/);
  });

  it("drops client provider credentials and injects only the DeepSeek key", () => {
    const headers = upstreamHeaders(
      {
        headers: {
          authorization: "Bearer krw-job-token",
          "x-api-key": "client-key",
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "tools-2025-01-01",
          "x-claude-code-session-id": "session-1",
        },
      } as never,
      "deepseek-secret",
    );

    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-api-key")).toBe("deepseek-secret");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(headers.get("anthropic-beta")).toBe("tools-2025-01-01");
    expect(headers.get("x-claude-code-session-id")).toBe("session-1");
  });
});
