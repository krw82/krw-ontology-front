import { readFloatEnv } from "@/lib/env";
import { calculateRawAnalysisCredits } from "./credit-policy";

export const ACTIVE_PROVIDER_PRICING_VERSION = "deepseek-v4-flash-2026-06";
export const DEFAULT_PROVIDER = "deepseek";
export const DEFAULT_PROVIDER_MODEL = "deepseek-v4-flash";
export const DEFAULT_PROVIDER_MODEL_VERSION = "DeepSeek-V4-Flash";
export const DEFAULT_PROVIDER_PRICING_SOURCE_URL =
  "https://api-docs.deepseek.com/quick_start/pricing";

const DEEPSEEK_FLASH_INPUT_CACHE_HIT_COST_PER_1M = readFloatEnv(
  "CACHE_HIT_INPUT_COST_PER_MILLION",
  0.0028,
  { min: 0 },
);
const DEEPSEEK_FLASH_INPUT_CACHE_MISS_COST_PER_1M = readFloatEnv(
  "INPUT_COST_PER_MILLION",
  0.14,
  { min: 0 },
);
const DEEPSEEK_FLASH_OUTPUT_COST_PER_1M = readFloatEnv(
  "OUTPUT_COST_PER_MILLION",
  0.28,
  { min: 0 },
);

export interface ProviderUsageInput {
  inputTokens: number;
  outputTokens: number;
  cacheHitInputTokens?: number | null;
  cacheMissInputTokens?: number | null;
}

export interface ProviderUsageCost {
  provider: string;
  providerModel: string;
  providerModelVersion: string;
  pricingVersion: string;
  inputTokens: number;
  outputTokens: number;
  cacheHitInputTokens: number;
  cacheMissInputTokens: number;
  actualProviderCostUsd: number;
  userCreditsRaw: number;
}

function safeInteger(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

function roundUsd(value: number): number {
  return Math.round(Math.max(0, Number.isFinite(value) ? value : 0) * 1_000_000) / 1_000_000;
}

export function calculateProviderUsageCost(
  usage: ProviderUsageInput,
): ProviderUsageCost {
  const inputTokens = safeInteger(usage.inputTokens);
  const outputTokens = safeInteger(usage.outputTokens);
  const providedCacheHit = safeInteger(usage.cacheHitInputTokens);
  const providedCacheMiss = safeInteger(usage.cacheMissInputTokens);
  const cacheHitInputTokens = Math.min(inputTokens, providedCacheHit);
  const classifiedCacheMissInputTokens = Math.min(
    Math.max(0, inputTokens - cacheHitInputTokens),
    providedCacheMiss,
  );
  const unclassifiedInputTokens = Math.max(
    0,
    inputTokens - cacheHitInputTokens - classifiedCacheMissInputTokens,
  );
  const cacheMissInputTokens =
    classifiedCacheMissInputTokens + unclassifiedInputTokens;
  const actualProviderCostUsd = roundUsd(
    (cacheHitInputTokens / 1_000_000) *
      DEEPSEEK_FLASH_INPUT_CACHE_HIT_COST_PER_1M +
      (cacheMissInputTokens / 1_000_000) *
        DEEPSEEK_FLASH_INPUT_CACHE_MISS_COST_PER_1M +
      (outputTokens / 1_000_000) * DEEPSEEK_FLASH_OUTPUT_COST_PER_1M,
  );

  return {
    provider: DEFAULT_PROVIDER,
    providerModel: DEFAULT_PROVIDER_MODEL,
    providerModelVersion: DEFAULT_PROVIDER_MODEL_VERSION,
    pricingVersion: ACTIVE_PROVIDER_PRICING_VERSION,
    inputTokens,
    outputTokens,
    cacheHitInputTokens,
    cacheMissInputTokens,
    actualProviderCostUsd,
    userCreditsRaw: calculateRawAnalysisCredits({
      inputTokens,
      outputTokens,
    }),
  };
}

export function estimateCost(
  inputTokens: number,
  outputTokens: number,
): number {
  return calculateProviderUsageCost({
    inputTokens,
    outputTokens,
  }).actualProviderCostUsd;
}
