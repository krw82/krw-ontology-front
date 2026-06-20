import { calculateProviderUsageCost } from "@/lib/billing/provider-pricing";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Json } from "@/types/database";
import type { ResearchMode } from "@/lib/research-mode";
import type { RunKind } from "@/lib/run-kind";

const INITIAL_ANALYSIS_CREDIT_RESERVATION_RAW = 1_000;

export interface AnalysisCreditReservationResult {
  ok: boolean;
  reservationId?: string | null;
  allowed?: boolean;
  reason?: string | null;
}

export function getInitialAnalysisCreditReservationRaw(
  _runKind?: RunKind,
  _researchMode?: ResearchMode,
): number {
  return INITIAL_ANALYSIS_CREDIT_RESERVATION_RAW;
}

export async function reserveAnalysisCreditsShadow(
  userId: string,
  requestId: string,
  params: {
    runKind?: RunKind;
    researchMode?: ResearchMode;
  } = {},
): Promise<AnalysisCreditReservationResult> {
  const reserveCreditsRaw = getInitialAnalysisCreditReservationRaw(
    params.runKind,
    params.researchMode,
  );

  try {
    const { data, error } = await getSupabaseAdmin().rpc(
      "reserve_analysis_credits",
      {
        p_user_id: userId,
        p_request_id: requestId,
        p_reserve_credits_raw: reserveCreditsRaw,
        p_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      },
    );

    if (error) {
      console.warn("[analysis-credits] shadow reserve failed", {
        code: error.code,
        message: error.message,
      });
      return { ok: false, reason: "shadow_reserve_failed" };
    }

    const result = data?.[0];
    if (!result?.allowed) {
      console.warn("[analysis-credits] shadow reserve would block", {
        userId,
        requestId,
        reason: result?.reason,
        creditsUsedRaw: result?.credits_used_raw,
        creditsReservedRaw: result?.credits_reserved_raw,
        creditsLimitRaw: result?.credits_limit_raw,
      });
    }

    return {
      ok: true,
      allowed: Boolean(result?.allowed),
      reason: result?.reason ?? null,
      reservationId: result?.reservation_id ?? null,
    };
  } catch (error) {
    console.warn("[analysis-credits] shadow reserve crashed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, reason: "shadow_reserve_failed" };
  }
}

export async function attachAnalysisCreditRunShadow(
  userId: string,
  requestId: string,
  runId: string,
) {
  try {
    const { error } = await getSupabaseAdmin().rpc("attach_analysis_credit_run", {
      p_user_id: userId,
      p_request_id: requestId,
      p_run_id: runId,
    });
    if (error) {
      console.warn("[analysis-credits] shadow attach failed", {
        code: error.code,
        message: error.message,
      });
    }
  } catch (error) {
    console.warn("[analysis-credits] shadow attach crashed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function settleAnalysisCreditsShadow(
  userId: string,
  requestId: string,
  runId: string | null,
  params: {
    terminalStatus: string;
    inputTokens: number;
    outputTokens: number;
    cacheHitInputTokens?: number | null;
    cacheMissInputTokens?: number | null;
    chargeUserCredits?: boolean;
    metadata?: Json;
  },
) {
  const usageCost = calculateProviderUsageCost({
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    cacheHitInputTokens: params.cacheHitInputTokens,
    cacheMissInputTokens: params.cacheMissInputTokens,
  });
  try {
    const { error } = await getSupabaseAdmin().rpc("settle_analysis_credits", {
      p_user_id: userId,
      p_request_id: requestId,
      p_run_id: runId,
      p_terminal_status: params.terminalStatus,
      p_settled_credits_raw:
        params.chargeUserCredits === false ? 0 : usageCost.userCreditsRaw,
      p_input_tokens: usageCost.inputTokens,
      p_output_tokens: usageCost.outputTokens,
      p_prompt_cache_hit_tokens: usageCost.cacheHitInputTokens,
      p_prompt_cache_miss_tokens: usageCost.cacheMissInputTokens,
      p_provider: usageCost.provider,
      p_provider_model: usageCost.providerModel,
      p_provider_model_version: usageCost.providerModelVersion,
      p_pricing_version: usageCost.pricingVersion,
      p_actual_provider_cost_usd: usageCost.actualProviderCostUsd,
      p_metadata: params.metadata ?? {},
    });
    if (error) {
      console.warn("[analysis-credits] shadow settle failed", {
        code: error.code,
        message: error.message,
      });
    }
  } catch (error) {
    console.warn("[analysis-credits] shadow settle crashed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function releaseAnalysisCreditsShadow(
  userId: string,
  requestId: string,
  runId: string | null,
  reason: string,
) {
  try {
    const { error } = await getSupabaseAdmin().rpc("release_analysis_credits", {
      p_user_id: userId,
      p_request_id: requestId,
      p_run_id: runId,
      p_reason: reason,
    });
    if (error) {
      console.warn("[analysis-credits] shadow release failed", {
        code: error.code,
        message: error.message,
      });
    }
  } catch (error) {
    console.warn("[analysis-credits] shadow release crashed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
