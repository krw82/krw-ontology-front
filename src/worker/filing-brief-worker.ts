import { randomUUID } from "node:crypto";
import { calculateProviderUsageCost, DEFAULT_PROVIDER_MODEL } from "@/lib/billing/provider-pricing";
import {
  FILING_BRIEF_PROMPT_VERSION,
  FILING_BRIEF_SCHEMA_VERSION,
  type FilingBriefSource,
} from "@/lib/filing-briefs/contract";
import { requestFilingBrief, FilingBriefGatewayError } from "@/lib/filing-briefs/gateway-client";
import { buildFilingBriefPrompt } from "@/lib/filing-briefs/prompt";
import {
  DEFAULT_FILING_BRIEF_MAX_DOCUMENT_BYTES,
  DEFAULT_FILING_BRIEF_MAX_INPUT_CHARS,
  loadFilingBriefSource,
} from "@/lib/filing-briefs/source-selection";
import { FilingBriefValidationError, validateFilingBriefOutput } from "@/lib/filing-briefs/validation";
import { readIntEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";

type FilingBriefEnvironment = "dev" | "staging" | "prod";
type BriefClaim = {
  id: string;
  filing_event_id: string;
  stage: "brief";
  claim_token: string;
  attempts: number;
};

export type FilingBriefWorkerConfig = {
  enabled: boolean;
  env: FilingBriefEnvironment;
  workerId: string;
  tickMs: number;
  batchSize: number;
  maxJobsPerDay: number;
  maxInputChars: number;
  maxDocumentBytes: number;
  secMinRequestIntervalMs: number;
  gatewayUrl: string;
  gatewayToken: string | null;
  gatewayTimeoutMs: number;
  model: string;
  maxOutputTokens: number;
};

export type FilingBriefCycleResult = {
  claimed: number;
  completed: number;
  failed: number;
  skippedByDailyCap: boolean;
};

export function filingBriefWorkerConfig(env: NodeJS.ProcessEnv = process.env): FilingBriefWorkerConfig {
  const configuredEnv = (env.FILING_WORKER_ENV ?? "prod").trim().toLowerCase();
  if (configuredEnv !== "dev" && configuredEnv !== "staging" && configuredEnv !== "prod") {
    throw new Error("FILING_WORKER_ENV must be dev, staging, or prod");
  }
  const enabled = env.FILING_BRIEF_ENABLED === "1";
  const gatewayToken = env.FILING_BRIEF_GATEWAY_TOKEN?.trim() || null;
  if (enabled && !gatewayToken) {
    throw new Error("FILING_BRIEF_GATEWAY_TOKEN is required when FILING_BRIEF_ENABLED=1");
  }
  return {
    enabled,
    env: configuredEnv,
    workerId: env.FILING_BRIEF_WORKER_ID?.trim() || `filing-brief-worker-${randomUUID()}`,
    tickMs: readIntEnv("FILING_BRIEF_WORKER_TICK_MS", 5_000, { min: 5_000, max: 60_000 }),
    batchSize: readIntEnv("FILING_BRIEF_BATCH_SIZE", 2, { min: 1, max: 10 }),
    maxJobsPerDay: readIntEnv("FILING_BRIEF_MAX_JOBS_PER_DAY", 500, { min: 1, max: 10_000 }),
    maxInputChars: readIntEnv("FILING_BRIEF_MAX_INPUT_CHARS", DEFAULT_FILING_BRIEF_MAX_INPUT_CHARS, {
      min: 4_000,
      max: 60_000,
    }),
    maxDocumentBytes: readIntEnv("FILING_BRIEF_MAX_DOCUMENT_BYTES", DEFAULT_FILING_BRIEF_MAX_DOCUMENT_BYTES, {
      min: 256 * 1024,
      max: 25 * 1024 * 1024,
    }),
    secMinRequestIntervalMs: readIntEnv(
      "FILING_BRIEF_SEC_MIN_REQUEST_INTERVAL_MS",
      readIntEnv("SEC_GLOBAL_MIN_REQUEST_INTERVAL_MS", 150, { min: 100, max: 10_000 }),
      { min: 100, max: 10_000 },
    ),
    gatewayUrl: (env.FILING_BRIEF_GATEWAY_URL?.trim() || "http://llm-gateway:8787").replace(/\/+$/, ""),
    gatewayToken,
    gatewayTimeoutMs: readIntEnv("FILING_BRIEF_GATEWAY_TIMEOUT_MS", 30_000, { min: 5_000, max: 60_000 }),
    model: env.FILING_BRIEF_MODEL?.trim() || DEFAULT_PROVIDER_MODEL,
    maxOutputTokens: readIntEnv("FILING_BRIEF_MAX_OUTPUT_TOKENS", 600, { min: 64, max: 1_200 }),
  };
}

export async function runFilingBriefWorkerCycle(
  config: FilingBriefWorkerConfig,
): Promise<FilingBriefCycleResult> {
  if (!config.enabled) {
    return { claimed: 0, completed: 0, failed: 0, skippedByDailyCap: false };
  }
  const admin = getSupabaseAdmin();
  const succeededToday = await countSucceededToday(config.env);
  const remaining = Math.max(0, config.maxJobsPerDay - succeededToday);
  if (remaining === 0) {
    return { claimed: 0, completed: 0, failed: 0, skippedByDailyCap: true };
  }

  const { data, error } = await admin.rpc("claim_sec_filing_processing_jobs", {
    p_env: config.env,
    p_worker_id: config.workerId,
    p_stage: "brief",
    p_limit: Math.min(config.batchSize, remaining),
    p_lease_seconds: 240,
  });
  if (error) throw new Error(`Failed to claim filing brief jobs: ${error.message}`);
  const claims = (data ?? []) as BriefClaim[];
  let completed = 0;
  let failed = 0;
  for (const claim of claims) {
    const outcome = await processFilingBriefJob(config, claim);
    if (outcome === "completed") completed += 1;
    else failed += 1;
  }
  return { claimed: claims.length, completed, failed, skippedByDailyCap: false };
}

async function processFilingBriefJob(
  config: FilingBriefWorkerConfig,
  claim: BriefClaim,
): Promise<"completed" | "failed"> {
  const admin = getSupabaseAdmin();
  const startedAt = Date.now();
  let source: FilingBriefSource | null = null;
  try {
    source = await loadFilingBriefSource(claim.filing_event_id, {
      maxInputChars: config.maxInputChars,
      maxDocumentBytes: config.maxDocumentBytes,
      secMinRequestIntervalMs: config.secMinRequestIntervalMs,
    });
    const prompt = buildFilingBriefPrompt(source);
    const response = await requestFilingBrief({
      jobId: claim.id,
      claimToken: claim.claim_token,
      model: config.model,
      systemPrompt: prompt.system,
      userPrompt: prompt.user,
      maxOutputTokens: config.maxOutputTokens,
    }, {
      baseUrl: config.gatewayUrl,
      token: config.gatewayToken!,
      timeoutMs: config.gatewayTimeoutMs,
    });
    const brief = validateFilingBriefOutput(response.content, source.sourceSections, source.sourceEvidence);
    const cost = calculateProviderUsageCost({
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      cacheHitInputTokens: response.usage.cacheReadInputTokens,
    });
    const { data: completed, error: completeError } = await admin.rpc("complete_sec_filing_brief", {
      p_job_id: claim.id,
      p_claim_token: claim.claim_token,
      p_locale: "ko-KR",
      p_headline_ko: brief.headlineKo,
      p_summary_sentences: brief.summarySentences as unknown as Json,
      p_facts: brief.facts as unknown as Json,
      p_question_suggestions: brief.questionSuggestions as unknown as Json,
      p_uncertainty_notes: brief.uncertaintyNotes as unknown as Json,
      p_source_document_url: source.sourceDocumentUrl,
      p_source_sha256: source.sourceSha256,
      p_source_section_keys: source.sourceSections.map((section) => section.key),
      p_source_truncated: source.sourceTruncated,
      p_input_char_count: source.inputCharCount,
      p_generator_model: response.model,
      p_prompt_version: FILING_BRIEF_PROMPT_VERSION,
      p_schema_version: FILING_BRIEF_SCHEMA_VERSION,
      p_input_tokens: cost.inputTokens,
      p_output_tokens: cost.outputTokens,
      p_cache_read_input_tokens: cost.cacheHitInputTokens,
      p_provider_cost_usd: cost.actualProviderCostUsd,
      p_latency_ms: Date.now() - startedAt,
    });
    if (completeError || !completed) {
      throw new Error(`Failed to complete filing brief: ${completeError?.message ?? "brief job lease lost"}`);
    }
    console.info("[filing-brief-worker] brief generated", {
      filingEventId: claim.filing_event_id,
      inputTokens: cost.inputTokens,
      outputTokens: cost.outputTokens,
      costUsd: cost.actualProviderCostUsd,
      latencyMs: Date.now() - startedAt,
    });
    return "completed";
  } catch (error) {
    const isValidationFailure = error instanceof FilingBriefValidationError;
    const gatewayError = error instanceof FilingBriefGatewayError ? error : null;
    const errorCode = errorCodeFor(error);
    const errorMessage = safeErrorMessage(error);
    try {
      const { error: recordError } = await admin.rpc("record_sec_filing_brief_failure", {
        p_job_id: claim.id,
        p_claim_token: claim.claim_token,
        p_outcome: isValidationFailure ? "validation_failed" : "failed",
        p_model: config.model,
        p_prompt_version: FILING_BRIEF_PROMPT_VERSION,
        p_schema_version: FILING_BRIEF_SCHEMA_VERSION,
        p_source_document_url: source?.sourceDocumentUrl ?? null,
        p_source_sha256: source?.sourceSha256 ?? null,
        p_source_truncated: source?.sourceTruncated ?? null,
        p_input_char_count: source?.inputCharCount ?? null,
        p_latency_ms: Date.now() - startedAt,
        p_error_code: errorCode,
        p_error_message: errorMessage,
      });
      if (recordError) {
        console.warn("[filing-brief-worker] could not record brief failure", {
          filingEventId: claim.filing_event_id,
          code: recordError.code,
          message: recordError.message,
        });
      }
    } catch {
      // The queue retry path below remains the durable fallback if recording
      // a diagnostic run is temporarily unavailable.
    }
    try {
      const { error: failJobError } = await admin.rpc("fail_sec_filing_processing_job", {
        p_job_id: claim.id,
        p_claim_token: claim.claim_token,
        p_error: errorMessage,
        p_retry_after_seconds: gatewayError?.retryable ? 60 : isValidationFailure ? 300 : 180,
      });
      if (failJobError) {
        console.warn("[filing-brief-worker] could not schedule brief retry", {
          filingEventId: claim.filing_event_id,
          code: failJobError.code,
        });
      }
    } catch {
      // A stale lease is harmless: another worker will own the retry state.
    }
    console.warn("[filing-brief-worker] brief generation failed", {
      filingEventId: claim.filing_event_id,
      errorCode,
      latencyMs: Date.now() - startedAt,
    });
    return "failed";
  }
}

async function countSucceededToday(env: FilingBriefEnvironment): Promise<number> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { count, error } = await getSupabaseAdmin()
    .from("sec_filing_brief_runs")
    .select("id", { count: "exact", head: true })
    .eq("env", env)
    .eq("outcome", "succeeded")
    .gte("created_at", dayStart.toISOString());
  if (error) throw new Error(`Failed to count filing briefs for ${env}: ${error.message}`);
  return count ?? 0;
}

function errorCodeFor(error: unknown): string {
  if (error instanceof FilingBriefValidationError || error instanceof FilingBriefGatewayError) return error.code;
  return "brief_generation_failed";
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "Filing brief generation failed.";
  return message.replace(/\s+/g, " ").trim().slice(0, 1_200);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(finish, ms);
    const onAbort = () => finish();
    function finish() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function main() {
  const config = filingBriefWorkerConfig();
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  console.info("[filing-brief-worker] started", {
    enabled: config.enabled,
    env: config.env,
    workerId: config.workerId,
    maxJobsPerDay: config.maxJobsPerDay,
  });
  while (!controller.signal.aborted) {
    try {
      const result = await runFilingBriefWorkerCycle(config);
      if (result.claimed || result.skippedByDailyCap) {
        console.info("[filing-brief-worker] cycle", result);
      }
    } catch (error) {
      console.error("[filing-brief-worker] cycle failed", {
        error: safeErrorMessage(error),
      });
    }
    await sleep(config.tickMs, controller.signal);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void main();
}
