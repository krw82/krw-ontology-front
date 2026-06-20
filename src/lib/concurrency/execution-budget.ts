import { getEntitlementStatus } from "@/lib/billing/entitlement";
import { getCurrentDailyBillingPeriod, getCurrentMonthlyBillingPeriod } from "@/lib/billing/period";
import {
  budgetUsdToAnalysisCredits,
  getEffectiveDailyBudgetUsd,
} from "@/lib/billing/plans";
import { getBillingPlanFromStore } from "@/lib/billing/plan-store";
import { readFloatEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  releaseAnalysisCreditsShadow,
  settleAnalysisCreditsShadow,
} from "@/lib/concurrency/analysis-credits";
import {
  normalizeResearchMode,
  type ResearchMode,
} from "@/lib/research-mode";
import type { EntitlementStatus } from "@/types/entitlement";
import type { Json } from "@/types/database";
export { estimateCost } from "@/lib/concurrency/cost-estimate";

const RESEARCH_MODE_RESERVE_COST_USD: Record<ResearchMode, number> = {
  fast: readFloatEnv("FAST_RESEARCH_RESERVE_COST_USD", 0.05, { min: 0 }),
  standard: readFloatEnv("STANDARD_RESEARCH_RESERVE_COST_USD", 0.15, {
    min: 0,
  }),
  deep: readFloatEnv("DEEP_RESEARCH_RESERVE_COST_USD", 0.5, { min: 0 }),
};

export interface ExecutionBudgetCheckResult {
  allowed: boolean;
  reason?: "cost_cap_exceeded" | "internal_error";
  reservationId?: string | null;
  budgetUsedUsd: number;
  budgetReservedUsd: number;
  budgetLimitUsd: number;
  dailyBudgetUsedUsd: number;
  dailyBudgetReservedUsd: number;
  dailyBudgetLimitUsd: number;
  reserveCostUsd: number;
  runCount: number;
  entitlement?: EntitlementStatus;
}

function roundUsd(value: number): number {
  return Math.round(Math.max(0, Number.isFinite(value) ? value : 0) * 1_000_000) / 1_000_000;
}

export function getResearchModeReserveCostUsd(
  researchMode?: ResearchMode,
): number {
  return roundUsd(RESEARCH_MODE_RESERVE_COST_USD[normalizeResearchMode(researchMode)]);
}

function creditLimit(budgetUsd: number): number {
  return budgetUsdToAnalysisCredits(budgetUsd, "floor");
}

function usedCredits(budgetUsd: number): number {
  return budgetUsdToAnalysisCredits(budgetUsd, "ceil");
}

function remainingCredits(budgetUsd: number): number {
  return budgetUsdToAnalysisCredits(budgetUsd, "floor");
}

export async function checkExecutionBudget(
  userId: string,
  userEmail?: string | null,
): Promise<ExecutionBudgetCheckResult> {
  try {
    const entitlement = await getEntitlementStatus(userId, userEmail);
    const usage = entitlement.usage;

    return {
      allowed: usage.can_run,
      reason: usage.can_run ? undefined : "cost_cap_exceeded",
      budgetUsedUsd: usage.budget_used_usd,
      budgetReservedUsd: usage.budget_reserved_usd,
      budgetLimitUsd: usage.budget_limit_usd,
      dailyBudgetUsedUsd: usage.daily_budget_used_usd,
      dailyBudgetReservedUsd: usage.daily_budget_reserved_usd,
      dailyBudgetLimitUsd: usage.daily_budget_limit_usd,
      reserveCostUsd: 0,
      runCount: usage.run_count,
      entitlement,
    };
  } catch {
    return {
      allowed: false,
      reason: "internal_error",
      budgetUsedUsd: 0,
      budgetReservedUsd: 0,
      budgetLimitUsd: 0,
      dailyBudgetUsedUsd: 0,
      dailyBudgetReservedUsd: 0,
      dailyBudgetLimitUsd: 0,
      reserveCostUsd: 0,
      runCount: 0,
    };
  }
}

export async function reserveExecutionBudget(
  userId: string,
  requestId: string,
  userEmail?: string | null,
  researchMode?: ResearchMode,
): Promise<ExecutionBudgetCheckResult> {
  const budget = await checkExecutionBudget(userId, userEmail);
  if (!budget.allowed || !budget.entitlement) return budget;
  if (budget.entitlement.usage.unlimited) return budget;

  const plan = await getBillingPlanFromStore(budget.entitlement.plan.key);
  if (plan.unlimited) return budget;
  const reserveCostUsd = roundUsd(
    Math.max(plan.perRunReserveUsd, getResearchModeReserveCostUsd(researchMode)),
  );
  const dailyBudgetUsd = getEffectiveDailyBudgetUsd(plan);
  const monthlyPeriod = getCurrentMonthlyBillingPeriod();
  const dailyPeriod = getCurrentDailyBillingPeriod();
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.rpc("reserve_execution_budget", {
    p_user_id: userId,
    p_request_id: requestId,
    p_monthly_period_start: monthlyPeriod.start,
    p_monthly_period_end: monthlyPeriod.end,
    p_daily_period_start: dailyPeriod.start,
    p_daily_period_end: dailyPeriod.end,
    p_monthly_budget_usd: plan.monthlyBudgetUsd,
    p_daily_budget_usd: dailyBudgetUsd,
    p_reserve_cost_usd: reserveCostUsd,
    p_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  });

  if (error) {
    console.warn("[execution-budget] legacy reserve failed; raw credits remain authoritative", {
      code: error.code,
      message: error.message,
    });
    return {
      ...budget,
      allowed: true,
      reason: undefined,
      reserveCostUsd,
    };
  }

  const result = data?.[0];
  if (!result?.allowed) {
    console.warn("[execution-budget] legacy budget would block; raw credits remain authoritative", {
      userId,
      requestId,
      reason: result?.reason,
    });
    return {
      ...budget,
      allowed: true,
      reason: undefined,
      reservationId: null,
      budgetUsedUsd: Number(result?.monthly_used_usd ?? budget.budgetUsedUsd),
      budgetReservedUsd: Number(result?.monthly_reserved_usd ?? budget.budgetReservedUsd),
      budgetLimitUsd: Number(result?.monthly_limit_usd ?? budget.budgetLimitUsd),
      dailyBudgetUsedUsd: Number(result?.daily_used_usd ?? budget.dailyBudgetUsedUsd),
      dailyBudgetReservedUsd: Number(result?.daily_reserved_usd ?? budget.dailyBudgetReservedUsd),
      dailyBudgetLimitUsd: Number(result?.daily_limit_usd ?? budget.dailyBudgetLimitUsd),
      reserveCostUsd,
    };
  }

  return {
    ...budget,
    allowed: true,
    reservationId: result.reservation_id,
    budgetUsedUsd: Number(result.monthly_used_usd),
    budgetReservedUsd: Number(result.monthly_reserved_usd),
    budgetLimitUsd: Number(result.monthly_limit_usd),
    dailyBudgetUsedUsd: Number(result.daily_used_usd),
    dailyBudgetReservedUsd: Number(result.daily_reserved_usd),
    dailyBudgetLimitUsd: Number(result.daily_limit_usd),
    reserveCostUsd,
  };
}

export async function attachExecutionBudgetRun(
  userId: string,
  requestId: string,
  runId: string,
) {
  const { error } = await getSupabaseAdmin().rpc("attach_execution_budget_run", {
    p_user_id: userId,
    p_request_id: requestId,
    p_run_id: runId,
  });
  if (error) {
    console.warn("[execution-budget] Failed to attach run", {
      code: error.code,
      message: error.message,
    });
  }
}

export async function settleExecutionBudget(
  userId: string,
  requestId: string,
  runId: string | null,
  actualCostUsd: number,
  terminalStatus: string,
  metadata: Json = {},
) {
  const { error } = await getSupabaseAdmin().rpc("settle_execution_budget", {
    p_user_id: userId,
    p_request_id: requestId,
    p_run_id: runId,
    p_actual_cost_usd: roundUsd(actualCostUsd),
    p_terminal_status: terminalStatus,
    p_metadata: metadata,
  });
  if (error) {
    console.warn("[execution-budget] Failed to settle budget", {
      code: error.code,
      message: error.message,
    });
  }

  const inputTokens = numberFromMetadata(metadata, "input_tokens");
  const outputTokens = numberFromMetadata(metadata, "output_tokens");
  const cacheHitInputTokens = numberFromMetadata(
    metadata,
    "prompt_cache_hit_tokens",
  );
  const cacheMissInputTokens = numberFromMetadata(
    metadata,
    "prompt_cache_miss_tokens",
  );
  if (inputTokens > 0 || outputTokens > 0) {
    await settleAnalysisCreditsShadow(userId, requestId, runId, {
      terminalStatus,
      inputTokens,
      outputTokens,
      cacheHitInputTokens,
      cacheMissInputTokens,
      chargeUserCredits:
        terminalStatus === "completed" || terminalStatus === "partial_completed",
      metadata,
    });
  } else {
    await releaseAnalysisCreditsShadow(
      userId,
      requestId,
      runId,
      terminalStatus,
    );
  }
}

export async function releaseExecutionBudget(
  userId: string,
  requestId: string,
  runId: string | null,
  reason: string,
) {
  const { error } = await getSupabaseAdmin().rpc("release_execution_budget", {
    p_user_id: userId,
    p_request_id: requestId,
    p_run_id: runId,
    p_reason: reason,
  });
  if (error) {
    console.warn("[execution-budget] Failed to release budget", {
      code: error.code,
      message: error.message,
    });
  }
  await releaseAnalysisCreditsShadow(userId, requestId, runId, reason);
}

function numberFromMetadata(metadata: Json, key: string): number {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return 0;
  }
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.floor(value))
    : 0;
}

export function getExecutionBudgetStatus(
  budget: Pick<
    ExecutionBudgetCheckResult,
    | "budgetUsedUsd"
    | "budgetReservedUsd"
    | "budgetLimitUsd"
    | "dailyBudgetUsedUsd"
    | "dailyBudgetReservedUsd"
    | "dailyBudgetLimitUsd"
    | "reserveCostUsd"
    | "runCount"
  >,
  settledCostUsd = 0,
) {
  const monthlyAvailable = Math.max(
    0,
    budget.budgetLimitUsd - budget.budgetUsedUsd - budget.budgetReservedUsd,
  );
  const dailyAvailable = Math.max(
    0,
    budget.dailyBudgetLimitUsd -
      budget.dailyBudgetUsedUsd -
      budget.dailyBudgetReservedUsd,
  );
  const billedCostUsd = Math.min(
    roundUsd(settledCostUsd),
    monthlyAvailable,
    dailyAvailable,
  );
  const used = roundUsd(budget.budgetUsedUsd + billedCostUsd);
  const reserved = roundUsd(
    Math.max(0, budget.budgetReservedUsd - budget.reserveCostUsd),
  );
  const dailyUsed = roundUsd(budget.dailyBudgetUsedUsd + billedCostUsd);
  const dailyReserved = roundUsd(
    Math.max(0, budget.dailyBudgetReservedUsd - budget.reserveCostUsd),
  );
  const percentUsed =
    budget.budgetLimitUsd > 0
      ? Math.min(100, Math.round(((used + reserved) / budget.budgetLimitUsd) * 100))
      : 100;
  const monthlyCreditLimit = creditLimit(budget.budgetLimitUsd);
  const dailyCreditLimit = creditLimit(budget.dailyBudgetLimitUsd);

  return {
    budget_used_usd: used,
    budget_reserved_usd: reserved,
    budget_limit_usd: budget.budgetLimitUsd,
    remaining_budget_usd: roundUsd(
      Math.max(0, budget.budgetLimitUsd - used - reserved),
    ),
    daily_budget_used_usd: dailyUsed,
    daily_budget_reserved_usd: dailyReserved,
    daily_budget_limit_usd: budget.dailyBudgetLimitUsd,
    per_run_reserve_usd: budget.reserveCostUsd,
    analysis_credits_used: Math.min(usedCredits(used), monthlyCreditLimit),
    analysis_credits_reserved: Math.min(
      usedCredits(reserved),
      monthlyCreditLimit,
    ),
    analysis_credits_limit: monthlyCreditLimit,
    remaining_analysis_credits: remainingCredits(
      Math.max(0, budget.budgetLimitUsd - used - reserved),
    ),
    daily_analysis_credits_used: Math.min(
      usedCredits(dailyUsed),
      dailyCreditLimit,
    ),
    daily_analysis_credits_reserved: Math.min(
      usedCredits(dailyReserved),
      dailyCreditLimit,
    ),
    daily_analysis_credits_limit: dailyCreditLimit,
    per_run_analysis_credits: usedCredits(budget.reserveCostUsd),
    run_count: budget.runCount + (settledCostUsd > 0 ? 1 : 0),
    percent_used: percentUsed,
    can_run:
      remainingCredits(budget.budgetLimitUsd - used - reserved) > 0 &&
      remainingCredits(budget.dailyBudgetLimitUsd - dailyUsed - dailyReserved) >
        0,
  };
}
