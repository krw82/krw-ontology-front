import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable, Transform } from "node:stream";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, DesktopLlmJobRow } from "../../../src/types/database";
import {
  hashLlmJobToken,
  verifyLlmJobToken,
} from "../../../src/lib/desktop/llm-token";

const DEFAULT_PORT = 8787;
const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;
const DEFAULT_UPSTREAM_BASE_URL = "https://api.deepseek.com/anthropic";
const SUPPORTED_PATHS = new Set([
  "/anthropic/v1/messages",
  "/anthropic/v1/messages/count_tokens",
]);

type GatewayEnv = NodeJS.ProcessEnv;

interface GatewayContext {
  env: GatewayEnv;
  supabase: SupabaseClient<Database>;
  jobTokenSecret: string;
  deepSeekApiKey: string;
  upstreamBaseUrl: string;
  maxBodyBytes: number;
}

export function createLlmGatewayServer(env: GatewayEnv = process.env) {
  const context = createGatewayContext(env);
  return createServer((request, response) => {
    void handleRequest(request, response, context);
  });
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  context: GatewayContext,
) {
  try {
    const url = new URL(request.url ?? "/", "http://llm-gateway.local");
    if (request.method === "GET" && url.pathname === "/healthz") {
      return sendJson(response, 200, {
        ok: true,
        service: "krw-llm-gateway",
        provider: "deepseek",
      });
    }

    if (request.method !== "POST" || !SUPPORTED_PATHS.has(url.pathname)) {
      return sendJson(response, 404, {
        error: {
          type: "not_found_error",
          message: "Unsupported LLM gateway route",
        },
      });
    }

    const token = bearerToken(request.headers.authorization);
    if (!token) return gatewayAuthError(response, "Missing LLM job token");

    let claims;
    try {
      claims = verifyLlmJobToken(token, context.jobTokenSecret);
    } catch {
      return gatewayAuthError(response, "Invalid or expired LLM job token");
    }

    const job = await loadAndClaimJob(context.supabase, claims.job_id, token);
    if (!job) {
      return gatewayAuthError(response, "LLM job is inactive, expired, or exhausted");
    }

    const body = await readJsonBody(request, context.maxBodyBytes);
    const upstreamBody = enforceJobRequest(body, job);
    const upstreamPath = url.pathname.replace(/^\/anthropic/, "");
    const upstreamUrl = `${context.upstreamBaseUrl}${upstreamPath}`;
    const controller = new AbortController();
    const abort = () => controller.abort(new Error("Gateway client disconnected"));
    response.once("close", abort);

    let upstream: Response;
    try {
      upstream = await fetch(upstreamUrl, {
        method: "POST",
        headers: upstreamHeaders(request, context.deepSeekApiKey),
        body: JSON.stringify(upstreamBody),
        signal: controller.signal,
      });
    } catch (error) {
      response.removeListener("close", abort);
      await recordJobError(context.supabase, job.id, "upstream_unavailable");
      return sendJson(response, 502, {
        error: {
          type: "api_error",
          message:
            error instanceof Error
              ? `DeepSeek connection failed: ${error.message}`
              : "DeepSeek connection failed",
        },
      });
    }

    try {
      copyUpstreamHeaders(upstream, response, job.id);
      response.statusCode = upstream.status;

      if (!upstream.body) {
        response.end();
        return;
      }

      if (upstreamBody.stream === true) {
        await pipeStreamingResponse(upstream, response, context.supabase, job);
        return;
      }

      const text = await upstream.text();
      response.end(text);
      await recordJsonUsage(context.supabase, job, text, upstream.ok);
    } finally {
      response.removeListener("close", abort);
    }
  } catch (error) {
    if (response.headersSent) {
      response.destroy(error instanceof Error ? error : undefined);
      return;
    }
    const status = error instanceof RequestTooLargeError ? 413 : 400;
    sendJson(response, status, {
      error: {
        type: status === 413 ? "request_too_large" : "invalid_request_error",
        message: error instanceof Error ? error.message : "Invalid gateway request",
      },
    });
  }
}

function createGatewayContext(env: GatewayEnv): GatewayContext {
  const supabaseUrl = requireEnv(env, "SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");
  const jobTokenSecret = requireEnv(env, "KRW_LLM_JOB_TOKEN_SECRET");
  if (jobTokenSecret.length < 32) {
    throw new Error("KRW_LLM_JOB_TOKEN_SECRET must be at least 32 characters");
  }

  return {
    env,
    supabase: createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    jobTokenSecret,
    deepSeekApiKey: requireEnv(env, "DEEPSEEK_API_KEY"),
    upstreamBaseUrl: (
      env.DEEPSEEK_ANTHROPIC_BASE_URL ?? DEFAULT_UPSTREAM_BASE_URL
    ).replace(/\/+$/, ""),
    maxBodyBytes: positiveInt(
      env.LLM_GATEWAY_MAX_BODY_BYTES,
      DEFAULT_MAX_BODY_BYTES,
    ),
  };
}

async function loadAndClaimJob(
  supabase: SupabaseClient<Database>,
  jobId: string,
  token: string,
): Promise<DesktopLlmJobRow | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await supabase
      .from("desktop_llm_jobs")
      .select(
        "id, user_id, device_id, local_session_id, local_run_id, runtime, token_jti, token_hash, status, provider, model_profile, sdk_model, upstream_model, gateway_base_url, max_budget_usd, max_request_count, request_count, max_input_tokens, max_output_tokens, expires_at, last_used_at, finalized_at, usage_input_tokens, usage_output_tokens, usage_cache_read_input_tokens, usage_cache_creation_input_tokens, actual_provider_cost_usd, error_code, metadata, created_at, updated_at",
      )
      .eq("id", jobId)
      .maybeSingle<DesktopLlmJobRow>();

    if (error || !data) return null;
    if (
      data.status !== "active" ||
      data.token_hash !== hashLlmJobToken(token) ||
      Date.parse(data.expires_at) <= Date.now() ||
      data.request_count >= data.max_request_count
    ) {
      if (Date.parse(data.expires_at) <= Date.now() && data.status === "active") {
        await supabase
          .from("desktop_llm_jobs")
          .update({ status: "expired", updated_at: new Date().toISOString() })
          .eq("id", data.id)
          .eq("status", "active");
      }
      return null;
    }

    const now = new Date().toISOString();
    const { data: claimed, error: claimError } = await supabase
      .from("desktop_llm_jobs")
      .update({
        request_count: data.request_count + 1,
        last_used_at: now,
        updated_at: now,
      })
      .eq("id", data.id)
      .eq("status", "active")
      .eq("request_count", data.request_count)
      .select(
        "id, user_id, device_id, local_session_id, local_run_id, runtime, token_jti, token_hash, status, provider, model_profile, sdk_model, upstream_model, gateway_base_url, max_budget_usd, max_request_count, request_count, max_input_tokens, max_output_tokens, expires_at, last_used_at, finalized_at, usage_input_tokens, usage_output_tokens, usage_cache_read_input_tokens, usage_cache_creation_input_tokens, actual_provider_cost_usd, error_code, metadata, created_at, updated_at",
      )
      .maybeSingle<DesktopLlmJobRow>();

    if (!claimError && claimed) return claimed;
  }
  return null;
}

export function enforceJobRequest(
  body: Record<string, unknown>,
  job: DesktopLlmJobRow,
): Record<string, unknown> {
  const maxTokens = numberValue(body.max_tokens);
  if (
    job.max_output_tokens !== null &&
    maxTokens !== null &&
    maxTokens > job.max_output_tokens
  ) {
    throw new Error(
      `max_tokens exceeds the job limit of ${job.max_output_tokens}`,
    );
  }

  return {
    ...body,
    model: job.upstream_model,
    metadata: {
      ...plainObjectOrEmpty(body.metadata),
      user_id: stableProviderUserId(job.user_id),
    },
  };
}

export function upstreamHeaders(
  request: IncomingMessage,
  deepSeekApiKey: string,
): Headers {
  const headers = new Headers({
    "content-type": "application/json",
    "x-api-key": deepSeekApiKey,
  });
  for (const name of [
    "anthropic-version",
    "anthropic-beta",
    "x-claude-code-session-id",
    "x-claude-code-agent-id",
    "x-claude-code-parent-agent-id",
    "user-agent",
  ]) {
    const value = request.headers[name];
    if (typeof value === "string" && value) headers.set(name, value);
  }
  return headers;
}

function copyUpstreamHeaders(
  upstream: Response,
  response: ServerResponse,
  jobId: string,
) {
  for (const name of [
    "content-type",
    "cache-control",
    "request-id",
    "x-request-id",
  ]) {
    const value = upstream.headers.get(name);
    if (value) response.setHeader(name, value);
  }
  response.setHeader("x-krw-llm-job-id", jobId);
  response.setHeader("cache-control", "no-store");
}

async function pipeStreamingResponse(
  upstream: Response,
  response: ServerResponse,
  supabase: SupabaseClient<Database>,
  job: DesktopLlmJobRow,
) {
  const usage = createSseUsageTransform();
  await new Promise<void>((resolve, reject) => {
    Readable.fromWeb(upstream.body as never)
      .pipe(usage.transform)
      .pipe(response)
      .once("finish", resolve)
      .once("error", reject);
  });
  await recordUsage(supabase, job, usage.snapshot(), upstream.ok);
}

function createSseUsageTransform() {
  let buffer = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadInputTokens = 0;
  let cacheCreationInputTokens = 0;
  const inspect = (text: string) => {
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const value = line.slice(5).trim();
      if (!value || value === "[DONE]") continue;
      try {
        const event = JSON.parse(value);
        const usage = event.usage ?? event.message?.usage ?? {};
        inputTokens = Math.max(inputTokens, safeInteger(usage.input_tokens));
        outputTokens = Math.max(outputTokens, safeInteger(usage.output_tokens));
        cacheReadInputTokens = Math.max(
          cacheReadInputTokens,
          safeInteger(usage.cache_read_input_tokens),
        );
        cacheCreationInputTokens = Math.max(
          cacheCreationInputTokens,
          safeInteger(usage.cache_creation_input_tokens),
        );
      } catch {
        // Non-JSON SSE fields are passed through unchanged.
      }
    }
  };
  return {
    transform: new Transform({
      transform(chunk, _encoding, callback) {
        inspect(chunk.toString("utf8"));
        callback(null, chunk);
      },
      flush(callback) {
        inspect("\n");
        callback();
      },
    }),
    snapshot: () => ({
      inputTokens,
      outputTokens,
      cacheReadInputTokens,
      cacheCreationInputTokens,
    }),
  };
}

async function recordJsonUsage(
  supabase: SupabaseClient<Database>,
  job: DesktopLlmJobRow,
  text: string,
  upstreamOk: boolean,
) {
  let usage = {};
  try {
    const parsed = JSON.parse(text);
    usage = parsed?.usage ?? {};
  } catch {
    usage = {};
  }
  await recordUsage(
    supabase,
    job,
    {
      inputTokens: safeInteger((usage as Record<string, unknown>).input_tokens),
      outputTokens: safeInteger((usage as Record<string, unknown>).output_tokens),
      cacheReadInputTokens: safeInteger(
        (usage as Record<string, unknown>).cache_read_input_tokens,
      ),
      cacheCreationInputTokens: safeInteger(
        (usage as Record<string, unknown>).cache_creation_input_tokens,
      ),
    },
    upstreamOk,
  );
}

async function recordUsage(
  supabase: SupabaseClient<Database>,
  job: DesktopLlmJobRow,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  },
  upstreamOk: boolean,
) {
  await supabase.rpc("record_desktop_llm_job_usage", {
    p_job_id: job.id,
    p_input_tokens: usage.inputTokens,
    p_output_tokens: usage.outputTokens,
    p_cache_read_input_tokens: usage.cacheReadInputTokens,
    p_cache_creation_input_tokens: usage.cacheCreationInputTokens,
    p_upstream_ok: upstreamOk,
    p_now: new Date().toISOString(),
  });
}

async function recordJobError(
  supabase: SupabaseClient<Database>,
  jobId: string,
  errorCode: string,
) {
  await supabase
    .from("desktop_llm_jobs")
    .update({
      error_code: errorCode,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);
}

async function readJsonBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > maxBytes) throw new RequestTooLargeError();
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) throw new Error("Request body is required");
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Request body must be a JSON object");
  }
  return parsed;
}

function gatewayAuthError(response: ServerResponse, message: string) {
  return sendJson(response, 401, {
    error: {
      type: "authentication_error",
      message,
    },
  });
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.setHeader("cache-control", "no-store");
  response.end(JSON.stringify(body));
}

function bearerToken(value: string | undefined): string | null {
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function requireEnv(
  env: GatewayEnv,
  name: string,
  fallbackName?: string,
): string {
  const value = env[name]?.trim() || (fallbackName ? env[fallbackName]?.trim() : "");
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function plainObjectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stableProviderUserId(userId: string) {
  return `krw_${createHash("sha256").update(userId).digest("hex").slice(0, 32)}`;
}

function safeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

class RequestTooLargeError extends Error {
  constructor() {
    super("Request body exceeds the configured gateway limit");
    this.name = "RequestTooLargeError";
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = positiveInt(process.env.PORT, DEFAULT_PORT);
  const server = createLlmGatewayServer();
  server.listen(port, "0.0.0.0", () => {
    console.log(`[llm-gateway] listening on 0.0.0.0:${port}`);
  });
}
