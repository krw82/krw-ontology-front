import "server-only";

import { createHash } from "node:crypto";
import {
  reserveAnalysisCreditsShadow,
  settleAnalysisCreditsShadow,
} from "@/lib/concurrency/analysis-credits";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { DesktopLlmJobRow, Json } from "@/types/database";
import type { DesktopAuthContext } from "./auth";
import { DesktopContractError } from "./ontology-contracts";
import { resolveDesktopLlmModelProfile } from "./llm-models";
import { createLlmJobToken } from "./llm-token";

const MAX_LOCAL_ID_LENGTH = 160;

export interface CreateDesktopLlmJobInput {
  localRunId: string;
  localSessionId: string | null;
  requestedModel: string | null;
  runtime: "claude-sdk";
  requestedMaxBudgetUsd: number | null;
  requestedTtlSeconds: number | null;
}

export interface FinalizeDesktopLlmJobInput {
  terminalStatus: "completed" | "failed" | "cancelled";
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  errorCode: string | null;
}

export async function createDesktopLlmJob(
  auth: DesktopAuthContext,
  input: CreateDesktopLlmJobInput,
  now = new Date(),
) {
  const secret = requireJobTokenSecret();
  const profile = resolveDesktopLlmModelProfile(input.requestedModel);
  const ttlSeconds = clampInteger(
    input.requestedTtlSeconds,
    60,
    profile.jobTokenTtlSeconds,
    profile.jobTokenTtlSeconds,
  );
  const maxBudgetUsd = clampNumber(
    input.requestedMaxBudgetUsd,
    0.000001,
    profile.maxBudgetUsd,
    profile.maxBudgetUsd,
  );
  const issuedAt = now;
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  const jobId = deterministicUuid(
    "desktop-llm-job",
    auth.userId,
    auth.deviceId ?? "no-device",
    input.localRunId,
  );
  const jti = deterministicUuid("desktop-llm-token", jobId);
  const requestId = `desktop-llm:${jobId}`;

  const creditReservation = await reserveAnalysisCreditsShadow(
    auth.userId,
    requestId,
    {
      runKind: "company_research",
      researchMode: "standard",
    },
  );
  if (creditReservation.ok && creditReservation.allowed === false) {
    throw new DesktopContractError("Desktop LLM credits exhausted", {
      code: "entitlement_required",
      publicMessage: "KRW Desktop 분석 크레딧이 부족합니다.",
      status: 403,
    });
  }

  const unsignedToken = createLlmJobToken({
    secret,
    jobId,
    jti,
    userId: auth.userId,
    deviceId: auth.deviceId,
    localRunId: input.localRunId,
    localSessionId: input.localSessionId,
    provider: profile.provider,
    modelProfile: profile.modelProfile,
    sdkModel: profile.sdkModel,
    upstreamModel: profile.upstreamModel,
    maxRequestCount: profile.maxRequestCount,
    maxBudgetUsd,
    expiresAt,
    issuedAt,
  });

  const metadata: Json = {
    credit_request_id: requestId,
    credit_reservation_id: creditReservation.reservationId ?? null,
    credit_reservation_ok: creditReservation.ok,
  };
  const { data, error } = await getSupabaseAdmin()
    .from("desktop_llm_jobs")
    .insert({
      id: jobId,
      user_id: auth.userId,
      device_id: auth.deviceId,
      local_session_id: input.localSessionId,
      local_run_id: input.localRunId,
      runtime: input.runtime,
      token_jti: unsignedToken.jti,
      token_hash: unsignedToken.tokenHash,
      provider: profile.provider,
      model_profile: profile.modelProfile,
      sdk_model: profile.sdkModel,
      upstream_model: profile.upstreamModel,
      gateway_base_url: profile.gatewayBaseUrl,
      max_budget_usd: maxBudgetUsd,
      max_request_count: profile.maxRequestCount,
      max_input_tokens: profile.maxInputTokens,
      max_output_tokens: profile.maxOutputTokens,
      expires_at: expiresAt.toISOString(),
      metadata,
      created_at: issuedAt.toISOString(),
      updated_at: issuedAt.toISOString(),
    })
    .select(
      "id, user_id, device_id, local_session_id, local_run_id, runtime, token_jti, token_hash, status, provider, model_profile, sdk_model, upstream_model, gateway_base_url, max_budget_usd, max_request_count, request_count, max_input_tokens, max_output_tokens, expires_at, last_used_at, finalized_at, usage_input_tokens, usage_output_tokens, usage_cache_read_input_tokens, usage_cache_creation_input_tokens, actual_provider_cost_usd, error_code, metadata, created_at, updated_at",
    )
    .single<DesktopLlmJobRow>();

  if (isUniqueViolation(error)) {
    return existingDesktopLlmJobResponse({
      auth,
      input,
      jobId,
      secret,
      now,
    });
  }

  if (error || !data) {
    throw new DesktopContractError("Failed to create Desktop LLM job", {
      code: "provider_unavailable",
      publicMessage: "LLM 연결 권한을 만들지 못했습니다.",
      status: 503,
      retryable: true,
    });
  }

  return desktopLlmJobResponse(data, unsignedToken.token, unsignedToken.payload.aud);
}

async function existingDesktopLlmJobResponse(input: {
  auth: DesktopAuthContext;
  input: CreateDesktopLlmJobInput;
  jobId: string;
  secret: string;
  now: Date;
}) {
  const { data, error } = await getSupabaseAdmin()
    .from("desktop_llm_jobs")
    .select(
      "id, user_id, device_id, local_session_id, local_run_id, runtime, token_jti, token_hash, status, provider, model_profile, sdk_model, upstream_model, gateway_base_url, max_budget_usd, max_request_count, request_count, max_input_tokens, max_output_tokens, expires_at, last_used_at, finalized_at, usage_input_tokens, usage_output_tokens, usage_cache_read_input_tokens, usage_cache_creation_input_tokens, actual_provider_cost_usd, error_code, metadata, created_at, updated_at",
    )
    .eq("id", input.jobId)
    .eq("user_id", input.auth.userId)
    .maybeSingle<DesktopLlmJobRow>();

  if (
    error ||
    !data ||
    data.local_run_id !== input.input.localRunId ||
    (input.auth.deviceId && data.device_id !== input.auth.deviceId)
  ) {
    throw new DesktopContractError("Failed to load idempotent Desktop LLM job", {
      code: "provider_unavailable",
      publicMessage: "LLM 연결 권한을 확인하지 못했습니다.",
      status: 503,
      retryable: true,
    });
  }

  if (
    data.status !== "active" ||
    data.finalized_at ||
    Date.parse(data.expires_at) <= input.now.getTime()
  ) {
    throw new DesktopContractError("Desktop LLM job is no longer reusable", {
      code: "invalid_job_token",
      publicMessage: "이미 종료되었거나 만료된 LLM 작업입니다.",
      status: 409,
    });
  }

  const token = createLlmJobToken({
    secret: input.secret,
    jobId: data.id,
    jti: data.token_jti,
    userId: data.user_id,
    deviceId: data.device_id,
    localRunId: data.local_run_id,
    localSessionId: data.local_session_id,
    provider: data.provider,
    modelProfile: data.model_profile,
    sdkModel: data.sdk_model,
    upstreamModel: data.upstream_model,
    maxRequestCount: data.max_request_count,
    maxBudgetUsd: data.max_budget_usd,
    expiresAt: new Date(data.expires_at),
    issuedAt: new Date(data.created_at),
  });

  if (token.tokenHash !== data.token_hash) {
    throw new DesktopContractError("Idempotent Desktop LLM job token mismatch", {
      code: "provider_unavailable",
      publicMessage: "LLM 연결 권한 무결성을 확인하지 못했습니다.",
      status: 503,
      retryable: true,
    });
  }

  return desktopLlmJobResponse(data, token.token, token.payload.aud);
}

function desktopLlmJobResponse(
  data: DesktopLlmJobRow,
  token: string,
  audience: string,
) {
  return {
    ok: true as const,
    job_id: data.id,
    token,
    expires_at: data.expires_at,
    audience,
    base_url: data.gateway_base_url,
    provider: data.provider,
    model_profile: data.model_profile,
    sdk_model: data.sdk_model,
    upstream_model: data.upstream_model,
    max_budget_usd: data.max_budget_usd,
    limits: {
      max_requests: data.max_request_count,
      max_input_tokens: data.max_input_tokens,
      max_output_tokens: data.max_output_tokens,
    },
  };
}

export function validateCreateDesktopLlmJobInput(
  value: unknown,
): CreateDesktopLlmJobInput {
  const body = plainObject(value);
  const runtime = optionalString(body.runtime) ?? "claude-sdk";
  if (runtime !== "claude-sdk") {
    throw new DesktopContractError("Unsupported Desktop LLM runtime", {
      code: "invalid_tool_arguments",
      publicMessage: "지원하지 않는 Desktop LLM runtime입니다.",
      status: 400,
    });
  }

  return {
    localRunId: requiredBoundedString(
      body.local_run_id,
      "local_run_id",
      MAX_LOCAL_ID_LENGTH,
    ),
    localSessionId: optionalBoundedString(
      body.local_session_id,
      "local_session_id",
      MAX_LOCAL_ID_LENGTH,
    ),
    requestedModel: optionalBoundedString(body.model, "model", 120),
    runtime,
    requestedMaxBudgetUsd: optionalPositiveNumber(body.max_budget_usd),
    requestedTtlSeconds: optionalPositiveInteger(body.ttl_seconds),
  };
}

export async function finalizeDesktopLlmJob(
  auth: DesktopAuthContext,
  jobId: string,
  input: FinalizeDesktopLlmJobInput,
  now = new Date(),
) {
  const { data: job, error } = await getSupabaseAdmin()
    .from("desktop_llm_jobs")
    .select(
      "id, user_id, device_id, local_session_id, local_run_id, runtime, token_jti, token_hash, status, provider, model_profile, sdk_model, upstream_model, gateway_base_url, max_budget_usd, max_request_count, request_count, max_input_tokens, max_output_tokens, expires_at, last_used_at, finalized_at, usage_input_tokens, usage_output_tokens, usage_cache_read_input_tokens, usage_cache_creation_input_tokens, actual_provider_cost_usd, error_code, metadata, created_at, updated_at",
    )
    .eq("id", jobId)
    .eq("user_id", auth.userId)
    .maybeSingle<DesktopLlmJobRow>();

  if (error || !job || (auth.deviceId && job.device_id !== auth.deviceId)) {
    throw new DesktopContractError("Desktop LLM job not found", {
      code: "invalid_job_token",
      publicMessage: "LLM 작업을 찾지 못했습니다.",
      status: 404,
    });
  }
  if (job.finalized_at) {
    return {
      ok: true as const,
      job_id: job.id,
      status: job.status,
      finalized_at: job.finalized_at,
      already_finalized: true,
    };
  }

  const inputTokens = Math.max(job.usage_input_tokens, input.inputTokens);
  const outputTokens = Math.max(job.usage_output_tokens, input.outputTokens);
  const cacheReadInputTokens = Math.max(
    job.usage_cache_read_input_tokens,
    input.cacheReadInputTokens,
  );
  const cacheCreationInputTokens = Math.max(
    job.usage_cache_creation_input_tokens,
    input.cacheCreationInputTokens,
  );
  const status = input.terminalStatus === "completed" ? "completed" : "failed";
  const finalizedAt = now.toISOString();

  const { data: claimedFinalization, error: updateError } =
    await getSupabaseAdmin()
    .from("desktop_llm_jobs")
    .update({
      status,
      finalized_at: finalizedAt,
      usage_input_tokens: inputTokens,
      usage_output_tokens: outputTokens,
      usage_cache_read_input_tokens: cacheReadInputTokens,
      usage_cache_creation_input_tokens: cacheCreationInputTokens,
      error_code: input.errorCode,
      updated_at: finalizedAt,
    })
    .eq("id", job.id)
    .is("finalized_at", null)
    .select("id, status, finalized_at")
    .maybeSingle<
      Pick<DesktopLlmJobRow, "id" | "status" | "finalized_at">
    >();

  if (updateError) {
    throw new DesktopContractError("Failed to finalize Desktop LLM job", {
      code: "provider_unavailable",
      publicMessage: "LLM 사용량을 정산하지 못했습니다.",
      status: 503,
      retryable: true,
    });
  }
  if (!claimedFinalization) {
    const { data: current, error: reloadError } = await getSupabaseAdmin()
      .from("desktop_llm_jobs")
      .select("id, status, finalized_at")
      .eq("id", job.id)
      .eq("user_id", auth.userId)
      .maybeSingle<
        Pick<DesktopLlmJobRow, "id" | "status" | "finalized_at">
      >();
    if (reloadError || !current?.finalized_at) {
      throw new DesktopContractError("Failed to claim Desktop LLM finalization", {
        code: "provider_unavailable",
        publicMessage: "LLM 사용량 정산 상태를 확인하지 못했습니다.",
        status: 503,
        retryable: true,
      });
    }
    return {
      ok: true as const,
      job_id: current.id,
      status: current.status,
      finalized_at: current.finalized_at,
      already_finalized: true,
    };
  }

  const metadata = plainJsonObject(job.metadata);
  const requestId =
    typeof metadata.credit_request_id === "string"
      ? metadata.credit_request_id
      : `desktop-llm:${job.id}`;
  await settleAnalysisCreditsShadow(auth.userId, requestId, null, {
    terminalStatus: input.terminalStatus,
    inputTokens,
    outputTokens,
    cacheHitInputTokens: cacheReadInputTokens,
    cacheMissInputTokens: Math.max(0, inputTokens - cacheReadInputTokens),
    metadata: {
      source: "desktop_llm_gateway",
      desktop_llm_job_id: job.id,
      local_run_id: job.local_run_id,
      model_profile: job.model_profile,
      upstream_model: job.upstream_model,
      cache_creation_input_tokens: cacheCreationInputTokens,
    },
  });

  return {
    ok: true as const,
    job_id: job.id,
    status: claimedFinalization.status,
    finalized_at: claimedFinalization.finalized_at ?? finalizedAt,
    already_finalized: false,
  };
}

export function validateFinalizeDesktopLlmJobInput(
  value: unknown,
): FinalizeDesktopLlmJobInput {
  const body = plainObject(value);
  const terminalStatus = optionalString(body.terminal_status);
  if (
    terminalStatus !== "completed" &&
    terminalStatus !== "failed" &&
    terminalStatus !== "cancelled"
  ) {
    throw new DesktopContractError(
      "terminal_status must be completed, failed, or cancelled",
    );
  }

  return {
    terminalStatus,
    inputTokens: nonNegativeInteger(body.input_tokens),
    outputTokens: nonNegativeInteger(body.output_tokens),
    cacheReadInputTokens: nonNegativeInteger(body.cache_read_input_tokens),
    cacheCreationInputTokens: nonNegativeInteger(
      body.cache_creation_input_tokens,
    ),
    errorCode: optionalBoundedString(body.error_code, "error_code", 120),
  };
}

function requireJobTokenSecret(): string {
  const secret = process.env.KRW_LLM_JOB_TOKEN_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new DesktopContractError("KRW_LLM_JOB_TOKEN_SECRET is not configured", {
      code: "provider_unavailable",
      publicMessage: "LLM gateway 설정이 완료되지 않았습니다.",
      status: 503,
      retryable: true,
    });
  }
  return secret;
}

function plainObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new DesktopContractError("Request body must be an object");
}

function requiredBoundedString(value: unknown, name: string, max: number): string {
  const text = optionalBoundedString(value, name, max);
  if (!text) throw new DesktopContractError(`${name} is required`);
  return text;
}

function optionalBoundedString(
  value: unknown,
  name: string,
  max: number,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new DesktopContractError(`${name} must be a string`);
  }
  const text = value.trim();
  if (!text || text.length > max) {
    throw new DesktopContractError(`${name} must be between 1 and ${max} characters`);
  }
  return text;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalPositiveNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new DesktopContractError("max_budget_usd must be a positive number");
  }
  return parsed;
}

function optionalPositiveInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new DesktopContractError("ttl_seconds must be a positive integer");
  }
  return parsed;
}

function nonNegativeInteger(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new DesktopContractError("usage token counts must be non-negative integers");
  }
  return parsed;
}

function plainJsonObject(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return (error as { code?: unknown }).code === "23505";
}

function deterministicUuid(...parts: string[]): string {
  const bytes = createHash("sha256").update(parts.join("\u001f")).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function clampInteger(
  value: number | null,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === null || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function clampNumber(
  value: number | null,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value as number));
}
