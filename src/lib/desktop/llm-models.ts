const DEFAULT_JOB_TOKEN_TTL_SECONDS = 10 * 60;
const DEFAULT_MAX_REQUEST_COUNT = 128;
const DEFAULT_MAX_BUDGET_USD = 1;
const DEFAULT_MODEL_PROFILE = "deepseek-v4-flash";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-v4-flash";
const DEFAULT_SDK_MODEL = "claude-sonnet-4-6";

export interface DesktopLlmModelProfile {
  provider: "deepseek";
  modelProfile: string;
  sdkModel: string;
  upstreamModel: string;
  gatewayBaseUrl: string;
  jobTokenTtlSeconds: number;
  maxRequestCount: number;
  maxBudgetUsd: number;
  maxInputTokens: number | null;
  maxOutputTokens: number | null;
}

export function resolveDesktopLlmModelProfile(
  requestedModel?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): DesktopLlmModelProfile {
  const modelProfile =
    normalizeModel(requestedModel) ??
    stringEnv(env.DESKTOP_LLM_MODEL_PROFILE) ??
    DEFAULT_MODEL_PROFILE;
  const upstreamModel =
    stringEnv(env.DESKTOP_LLM_UPSTREAM_MODEL) ??
    modelProfileToUpstreamModel(modelProfile);
  const sdkModel = stringEnv(env.DESKTOP_LLM_SDK_MODEL) ?? DEFAULT_SDK_MODEL;

  return {
    provider: "deepseek",
    modelProfile,
    sdkModel,
    upstreamModel,
    gatewayBaseUrl: gatewayBaseUrl(env),
    jobTokenTtlSeconds: intEnv(
      env.DESKTOP_LLM_JOB_TOKEN_TTL_SECONDS,
      DEFAULT_JOB_TOKEN_TTL_SECONDS,
      { min: 60, max: 30 * 60 },
    ),
    maxRequestCount: intEnv(
      env.DESKTOP_LLM_JOB_MAX_REQUESTS,
      DEFAULT_MAX_REQUEST_COUNT,
      { min: 1, max: 512 },
    ),
    maxBudgetUsd: floatEnv(
      env.DESKTOP_LLM_JOB_MAX_BUDGET_USD,
      DEFAULT_MAX_BUDGET_USD,
      { min: 0.000001, max: 100 },
    ),
    maxInputTokens: nullableIntEnv(env.DESKTOP_LLM_MAX_INPUT_TOKENS, {
      min: 1,
      max: 2_000_000,
    }),
    maxOutputTokens: nullableIntEnv(env.DESKTOP_LLM_MAX_OUTPUT_TOKENS, {
      min: 1,
      max: 500_000,
    }),
  };
}

export function availableDesktopLlmModelProfiles(
  env: NodeJS.ProcessEnv = process.env,
) {
  const profile = resolveDesktopLlmModelProfile(null, env);
  return [
    {
      model_profile: profile.modelProfile,
      sdk_model: profile.sdkModel,
      upstream_model: profile.upstreamModel,
      provider: profile.provider,
    },
  ];
}

function gatewayBaseUrl(env: NodeJS.ProcessEnv) {
  const configured = stringEnv(env.DESKTOP_LLM_GATEWAY_BASE_URL);
  if (configured) return configured.replace(/\/+$/, "");

  const appUrl =
    stringEnv(env.NEXT_PUBLIC_APP_URL) ??
    stringEnv(env.NEXT_PUBLIC_SITE_URL) ??
    "http://localhost:3000";
  return `${appUrl.replace(/\/+$/, "")}/llm/anthropic`;
}

function modelProfileToUpstreamModel(profile: string): string {
  if (profile === "deepseek-v4-flash") return "deepseek-v4-flash";
  if (profile === "deepseek-v4-pro") return "deepseek-v4-pro";
  return DEFAULT_DEEPSEEK_MODEL;
}

function normalizeModel(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  if (/^claude-/i.test(text)) return null;
  if (/^krw-deepseek/i.test(text)) return DEFAULT_MODEL_PROFILE;
  return text.slice(0, 120);
}

function stringEnv(value: string | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function intEnv(
  value: string | undefined,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, parsed));
}

function nullableIntEnv(
  value: string | undefined,
  bounds: { min: number; max: number },
): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return null;
  return Math.min(bounds.max, Math.max(bounds.min, parsed));
}

function floatEnv(
  value: string | undefined,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, parsed));
}
