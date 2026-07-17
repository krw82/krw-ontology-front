import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { describe, expect, it, vi } from "vitest";
import type { DesktopLlmJobRow } from "../../../src/types/database";
import { createLlmJobToken } from "../../../src/lib/desktop/llm-token";
import {
  createLlmGatewayServerFromContext,
  enforceJobRequest,
  parseFilingBriefGatewayPayload,
  upstreamHeaders,
  type GatewayContext,
} from "./server";

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
  it("accepts only a bounded, server-approved filing brief payload", () => {
    const payload = parseFilingBriefGatewayPayload(
      {
        job_id: "71d9a791-dc4a-4a90-a8f8-2a0957920352",
        claim_token: "a49cdc67-2383-47de-837b-a4cd06907d31",
        model: "deepseek-v4-flash",
        system_prompt: "Return JSON.",
        user_prompt: "A bounded SEC source.",
        max_tokens: 600,
      },
      "deepseek-v4-flash",
    );

    expect(payload).toMatchObject({
      jobId: "71d9a791-dc4a-4a90-a8f8-2a0957920352",
      model: "deepseek-v4-flash",
      maxTokens: 600,
    });
    expect(() => parseFilingBriefGatewayPayload(
      {
        job_id: "71d9a791-dc4a-4a90-a8f8-2a0957920352",
        claim_token: "a49cdc67-2383-47de-837b-a4cd06907d31",
        model: "another-model",
        system_prompt: "Return JSON.",
        user_prompt: "source",
        max_tokens: 600,
      },
      "deepseek-v4-flash",
    )).toThrow("model is not allowed");
  });

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

  it("injects the job output limit when max_tokens is omitted", () => {
    const result = enforceJobRequest(
      { model: "claude-sonnet-4-6" },
      job({ max_output_tokens: 4096 }),
    );

    expect(result.max_tokens).toBe(4096);
  });

  it("does not add max_tokens to token-counting requests", () => {
    const result = enforceJobRequest(
      { model: "claude-sonnet-4-6" },
      job({ max_output_tokens: 4096 }),
      { enforceOutputLimit: false },
    );

    expect(result).not.toHaveProperty("max_tokens");
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

  it("validates a job token, claims the job, and proxies to DeepSeek", async () => {
    const secret = "0123456789abcdef0123456789abcdef";
    const token = createLlmJobToken({
      secret,
      jobId: "job-1",
      userId: "user-1",
      deviceId: "device-1",
      localRunId: "run-1",
      localSessionId: "session-1",
      provider: "deepseek",
      modelProfile: "deepseek-v4-flash",
      sdkModel: "claude-sonnet-4-6",
      upstreamModel: "deepseek-v4-flash",
      maxRequestCount: 128,
      maxBudgetUsd: 1,
      expiresAt: new Date(Date.now() + 60_000),
      issuedAt: new Date(Date.now() - 1_000),
      jti: "jti-1",
    });
    const supabase = createSupabaseFake(
      job({
        token_hash: token.tokenHash,
        token_jti: token.jti,
        request_count: 0,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    const upstreamCalls: Array<{ input: string; init: RequestInit }> = [];
    const clientFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      upstreamCalls.push({ input: String(input), init: init ?? {} });
      return new Response(
        JSON.stringify({
          id: "msg-1",
          type: "message",
          usage: { input_tokens: 5, output_tokens: 7 },
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "request-id": "deepseek-request-1",
          },
        },
      );
    });

    const server = createLlmGatewayServerFromContext({
      env: process.env,
      supabase: supabase.client,
      jobTokenSecret: secret,
      deepSeekApiKey: "deepseek-secret",
      upstreamBaseUrl: "https://deepseek.test/anthropic",
      maxBodyBytes: 1024 * 1024,
    } as unknown as GatewayContext);

    try {
      const baseUrl = await listen(server);
      const response = await clientFetch(`${baseUrl}/anthropic/v1/messages`, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${token.token}`,
          "content-type": "application/json",
          "x-api-key": "client-key",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-opus-4-6",
          metadata: { client_field: "kept" },
        }),
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("x-krw-llm-job-id")).toBe("job-1");
      await expect(response.json()).resolves.toMatchObject({
        id: "msg-1",
        usage: { input_tokens: 5, output_tokens: 7 },
      });

      expect(upstreamCalls).toHaveLength(1);
      expect(upstreamCalls[0].input).toBe(
        "https://deepseek.test/anthropic/v1/messages",
      );
      const upstreamRequest = upstreamCalls[0].init;
      const upstreamRequestHeaders = upstreamRequest.headers as Headers;
      expect(upstreamRequestHeaders.get("x-api-key")).toBe("deepseek-secret");
      expect(upstreamRequestHeaders.get("authorization")).toBeNull();
      expect(upstreamRequestHeaders.get("anthropic-version")).toBe("2023-06-01");
      expect(JSON.parse(String(upstreamRequest.body))).toMatchObject({
        model: "deepseek-v4-flash",
        max_tokens: 4096,
        metadata: {
          client_field: "kept",
          user_id: expect.stringMatching(/^krw_[0-9a-f]{32}$/),
        },
      });
      expect(supabase.updates).toEqual([
        expect.objectContaining({ request_count: 1 }),
      ]);
      expect(supabase.rpcs).toEqual([
        {
          name: "record_desktop_llm_job_usage",
          params: expect.objectContaining({
            p_job_id: "job-1",
            p_input_tokens: 5,
            p_output_tokens: 7,
            p_upstream_ok: true,
          }),
        },
      ]);
    } finally {
      vi.unstubAllGlobals();
      await close(server);
    }
  });

  it("keeps serving when a streaming gateway client disconnects", async () => {
    const secret = "0123456789abcdef0123456789abcdef";
    const token = createLlmJobToken({
      secret,
      jobId: "job-1",
      userId: "user-1",
      deviceId: "device-1",
      localRunId: "run-1",
      localSessionId: "session-1",
      provider: "deepseek",
      modelProfile: "deepseek-v4-flash",
      sdkModel: "claude-sonnet-4-6",
      upstreamModel: "deepseek-v4-flash",
      maxRequestCount: 128,
      maxBudgetUsd: 1,
      expiresAt: new Date(Date.now() + 60_000),
      issuedAt: new Date(Date.now() - 1_000),
      jti: "jti-1",
    });
    const supabase = createSupabaseFake(
      job({
        token_hash: token.tokenHash,
        token_jti: token.jti,
        request_count: 0,
        expires_at: new Date(Date.now() + 60_000).toISOString(),
      }),
    );
    const clientFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
      const encoder = new TextEncoder();
      const signal = init?.signal;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'event: message_delta\ndata: {"usage":{"input_tokens":1,"output_tokens":1}}\n\n',
              ),
            );
            signal?.addEventListener("abort", () => {
              controller.error(signal.reason ?? new Error("aborted"));
            });
          },
        }),
        {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        },
      );
    });

    const server = createLlmGatewayServerFromContext({
      env: process.env,
      supabase: supabase.client,
      jobTokenSecret: secret,
      deepSeekApiKey: "deepseek-secret",
      upstreamBaseUrl: "https://deepseek.test/anthropic",
      maxBodyBytes: 1024 * 1024,
    } as unknown as GatewayContext);

    try {
      const baseUrl = await listen(server);
      const response = await clientFetch(`${baseUrl}/anthropic/v1/messages`, {
        method: "POST",
        headers: {
          "authorization": `Bearer ${token.token}`,
          "content-type": "application/json",
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-opus-4-6",
          max_tokens: 128,
          stream: true,
        }),
      });

      expect(response.status).toBe(200);
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
      await reader?.read();
      await reader?.cancel();

      await waitFor(() =>
        supabase.updates.some((update) => update.error_code === "client_disconnected"),
      );
      const health = await clientFetch(`${baseUrl}/healthz`);
      expect(health.status).toBe(200);
    } finally {
      vi.unstubAllGlobals();
      await close(server);
    }
  });
});

function createSupabaseFake(initialJob: DesktopLlmJobRow) {
  let storedJob = initialJob;
  const updates: Array<Record<string, unknown>> = [];
  const rpcs: Array<{ name: string; params: Record<string, unknown> }> = [];
  const client = {
    from(table: string) {
      expect(table).toBe("desktop_llm_jobs");
      let updatePayload: Record<string, unknown> | null = null;
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        update(payload: Record<string, unknown>) {
          updatePayload = payload;
          updates.push(payload);
          return builder;
        },
        async maybeSingle() {
          if (updatePayload) {
            storedJob = {
              ...storedJob,
              ...updatePayload,
            };
          }
          return { data: storedJob, error: null };
        },
      };
      return builder;
    },
    async rpc(name: string, params: Record<string, unknown>) {
      rpcs.push({ name, params });
      return { data: null, error: null };
    },
  };
  return { client, updates, rpcs };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

async function waitFor(predicate: () => boolean, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  expect(predicate()).toBe(true);
}
