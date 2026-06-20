import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const LLM_JOB_TOKEN_AUDIENCE = "krw-llm-gateway";
export const LLM_JOB_TOKEN_PREFIX = "krw_lj_";

export interface LlmJobTokenPayload {
  aud: typeof LLM_JOB_TOKEN_AUDIENCE;
  exp: number;
  iat: number;
  jti: string;
  job_id: string;
  user_id: string;
  device_id: string | null;
  local_run_id: string;
  local_session_id: string | null;
  runtime: "claude-sdk";
  provider: "deepseek";
  model_profile: string;
  sdk_model: string;
  upstream_model: string;
  max_request_count: number;
  max_budget_usd: number | null;
}

export interface CreateLlmJobTokenInput {
  secret: string;
  jobId: string;
  userId: string;
  deviceId: string | null;
  localRunId: string;
  localSessionId: string | null;
  provider: "deepseek";
  modelProfile: string;
  sdkModel: string;
  upstreamModel: string;
  maxRequestCount: number;
  maxBudgetUsd: number | null;
  expiresAt: Date;
  issuedAt?: Date;
  jti?: string;
}

export interface CreatedLlmJobToken {
  token: string;
  tokenHash: string;
  jti: string;
  payload: LlmJobTokenPayload;
}

export class LlmJobTokenError extends Error {
  code: "missing_token" | "malformed_token" | "invalid_signature" | "expired_token";

  constructor(
    code: LlmJobTokenError["code"],
    message: string,
  ) {
    super(message);
    this.name = "LlmJobTokenError";
    this.code = code;
  }
}

export function createLlmJobToken(input: CreateLlmJobTokenInput): CreatedLlmJobToken {
  const issuedAt = input.issuedAt ?? new Date();
  const jti = input.jti ?? randomUUID();
  const payload: LlmJobTokenPayload = {
    aud: LLM_JOB_TOKEN_AUDIENCE,
    exp: secondsFromDate(input.expiresAt),
    iat: secondsFromDate(issuedAt),
    jti,
    job_id: input.jobId,
    user_id: input.userId,
    device_id: input.deviceId,
    local_run_id: input.localRunId,
    local_session_id: input.localSessionId,
    runtime: "claude-sdk",
    provider: input.provider,
    model_profile: input.modelProfile,
    sdk_model: input.sdkModel,
    upstream_model: input.upstreamModel,
    max_request_count: input.maxRequestCount,
    max_budget_usd: input.maxBudgetUsd,
  };
  const encodedHeader = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const encodedPayload = base64UrlJson(payload);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign(signingInput, input.secret);
  const token = `${LLM_JOB_TOKEN_PREFIX}${signingInput}.${signature}`;
  return {
    token,
    tokenHash: hashLlmJobToken(token),
    jti,
    payload,
  };
}

export function verifyLlmJobToken(
  token: string,
  secret: string,
  now = new Date(),
): LlmJobTokenPayload {
  if (!token) throw new LlmJobTokenError("missing_token", "Missing LLM job token");
  if (!token.startsWith(LLM_JOB_TOKEN_PREFIX)) {
    throw new LlmJobTokenError("malformed_token", "Malformed LLM job token");
  }

  const compact = token.slice(LLM_JOB_TOKEN_PREFIX.length);
  const parts = compact.split(".");
  if (parts.length !== 3) {
    throw new LlmJobTokenError("malformed_token", "Malformed LLM job token");
  }

  const [encodedHeader, encodedPayload, signature] = parts;
  const expectedSignature = sign(`${encodedHeader}.${encodedPayload}`, secret);
  if (!safeEqual(signature, expectedSignature)) {
    throw new LlmJobTokenError("invalid_signature", "Invalid LLM job token signature");
  }

  const header = parseBase64UrlJson(encodedHeader) as Record<string, unknown>;
  if (header?.alg !== "HS256" || header?.typ !== "JWT") {
    throw new LlmJobTokenError("malformed_token", "Unsupported LLM job token header");
  }

  const payload = parseBase64UrlJson(encodedPayload) as Partial<LlmJobTokenPayload>;
  assertPayload(payload);
  if (payload.exp <= secondsFromDate(now)) {
    throw new LlmJobTokenError("expired_token", "Expired LLM job token");
  }
  return payload;
}

export function hashLlmJobToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function assertPayload(payload: Partial<LlmJobTokenPayload>): asserts payload is LlmJobTokenPayload {
  if (
    payload.aud !== LLM_JOB_TOKEN_AUDIENCE ||
    typeof payload.exp !== "number" ||
    typeof payload.iat !== "number" ||
    !nonEmpty(payload.jti) ||
    !nonEmpty(payload.job_id) ||
    !nonEmpty(payload.user_id) ||
    !nonEmpty(payload.local_run_id) ||
    payload.runtime !== "claude-sdk" ||
    payload.provider !== "deepseek" ||
    !nonEmpty(payload.model_profile) ||
    !nonEmpty(payload.sdk_model) ||
    !nonEmpty(payload.upstream_model) ||
    typeof payload.max_request_count !== "number"
  ) {
    throw new LlmJobTokenError("malformed_token", "Malformed LLM job token payload");
  }
}

function sign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function parseBase64UrlJson(value: string): unknown {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw new LlmJobTokenError("malformed_token", "Malformed LLM job token JSON");
  }
}

function secondsFromDate(value: Date): number {
  return Math.floor(value.getTime() / 1000);
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
