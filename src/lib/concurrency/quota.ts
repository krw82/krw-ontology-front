import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { readFloatEnv, readIntEnv } from "@/lib/env";
import { getEntitlementStatus } from "@/lib/billing/entitlement";
import { getCurrentMonthlyBillingPeriod } from "@/lib/billing/period";
import type { EntitlementStatus } from "@/types/entitlement";

const DAILY_QUESTION_LIMIT = readIntEnv("DAILY_USER_QUESTION_LIMIT", 20, {
  min: 1,
});
const DAILY_COST_CAP = readFloatEnv("DAILY_COST_CAP_USD", 5.0, {
  min: 0,
});
const INPUT_COST_PER_1M = readFloatEnv("INPUT_COST_PER_MILLION", 3.0, {
  min: 0,
});
const OUTPUT_COST_PER_1M = readFloatEnv("OUTPUT_COST_PER_MILLION", 15.0, {
  min: 0,
});

export function getQuotaLimits() {
  return {
    dailyQuestionLimit: DAILY_QUESTION_LIMIT,
    dailyCostCapUsd: DAILY_COST_CAP,
  };
}

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: "quota_exceeded" | "cost_cap_exceeded" | "internal_error";
  questionsUsed: number;
  costUsed: number;
  questionsLimit: number;
  costLimit: number;
  entitlement?: EntitlementStatus;
}

export async function checkQuota(userId: string): Promise<QuotaCheckResult> {
  try {
    const entitlement = await getEntitlementStatus(userId);
    const questionsUsed = entitlement.usage.questions_used;
    const questionsLimit = entitlement.usage.questions_limit;

    if (!entitlement.usage.can_run) {
      return {
        allowed: false,
        reason: "quota_exceeded",
        questionsUsed,
        costUsed: 0,
        questionsLimit,
        costLimit: DAILY_COST_CAP,
        entitlement,
      };
    }

    return {
      allowed: true,
      questionsUsed,
      costUsed: 0,
      questionsLimit,
      costLimit: DAILY_COST_CAP,
      entitlement,
    };
  } catch {
    return {
      allowed: false,
      reason: "internal_error",
      questionsUsed: 0,
      costUsed: 0,
      questionsLimit: 0,
      costLimit: DAILY_COST_CAP,
    };
  }
}

export async function recordUsage(
  userId: string,
  estimatedCostUsd: number,
  params: { requestId?: string; runId?: string } = {},
) {
  await Promise.all([
    recordDailyUsage(userId, estimatedCostUsd),
    recordMonthlyUsage(userId, estimatedCostUsd, params),
  ]);
}

async function recordDailyUsage(
  userId: string,
  estimatedCostUsd: number,
) {
  const today = new Date().toISOString().split("T")[0];
  const admin = getSupabaseAdmin();

  // Use atomic RPC function (INSERT ... ON CONFLICT DO UPDATE).
  // Requires migration: supabase/migrations/20260511000000_atomic_usage_increment.sql
  const { error } = await admin.rpc("increment_usage_daily", {
    p_user_id: userId,
    p_date: today,
    p_cost: estimatedCostUsd,
  });

  if (error) {
    // Fallback when RPC is not deployed: upsert with increment via raw SQL not
    // available in JS client. We use a read-modify-write inside a tight loop to
    // reduce (but not eliminate) the race window. Deploy the RPC migration for
    // full atomicity.
    const { data: existing } = await admin
      .from("usage_daily")
      .select("question_count, estimated_cost_usd")
      .eq("user_id", userId)
      .eq("date", today)
      .single();

    if (existing) {
      // Update atomically via conditional SET to reduce lost-update risk
      await admin
        .from("usage_daily")
        .update({
          question_count: existing.question_count + 1,
          estimated_cost_usd: existing.estimated_cost_usd + estimatedCostUsd,
        })
        .eq("user_id", userId)
        .eq("date", today)
        .eq("question_count", existing.question_count);
    } else {
      await admin
        .from("usage_daily")
        .upsert(
          {
            user_id: userId,
            date: today,
            question_count: 1,
            estimated_cost_usd: estimatedCostUsd,
          },
          { onConflict: "user_id,date" }
        );
    }
  }
}

async function recordMonthlyUsage(
  userId: string,
  estimatedCostUsd: number,
  params: { requestId?: string; runId?: string },
) {
  if (!params.requestId) return;

  const period = getCurrentMonthlyBillingPeriod();
  const admin = getSupabaseAdmin();
  const { error } = await admin.rpc("record_usage_event", {
    p_user_id: userId,
    p_request_id: params.requestId,
    p_run_id: params.runId ?? null,
    p_period_start: period.start,
    p_period_end: period.end,
    p_cost: estimatedCostUsd,
  });

  if (!error) return;

  console.warn("[quota] Failed to record monthly usage", {
    code: error.code,
    message: error.message,
  });
}

export function getQuotaStatus(
  questionsUsed: number,
  costUsed: number,
  newCostUsd?: number,
  limits: { questionsLimit?: number; costLimit?: number } = {},
) {
  const totalCost = costUsed + (newCostUsd ?? 0);
  const questionsLimit = limits.questionsLimit ?? DAILY_QUESTION_LIMIT;
  return {
    questions_used_today: questionsUsed + 1,
    questions_limit: questionsLimit,
    cost_used_today_usd: totalCost,
    cost_limit_usd: limits.costLimit ?? DAILY_COST_CAP,
    remaining_questions: Math.max(0, questionsLimit - questionsUsed - 1),
  };
}

export function estimateCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * INPUT_COST_PER_1M +
    (outputTokens / 1_000_000) * OUTPUT_COST_PER_1M
  );
}
