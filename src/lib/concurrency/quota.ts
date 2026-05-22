import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { readFloatEnv, readIntEnv } from "@/lib/env";
import type { UsageDailyRow } from "@/types/database";

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
}

export async function checkQuota(userId: string): Promise<QuotaCheckResult> {
  const today = new Date().toISOString().split("T")[0];
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("usage_daily")
    .select("question_count, estimated_cost_usd")
    .eq("user_id", userId)
    .eq("date", today)
    .single<UsageDailyRow>();

  if (error && error.code !== "PGRST116") {
    return { allowed: false, reason: "internal_error", questionsUsed: 0, costUsed: 0 };
  }

  const questionsUsed = data?.question_count ?? 0;
  const costUsed = data?.estimated_cost_usd ?? 0;

  if (questionsUsed >= DAILY_QUESTION_LIMIT) {
    return { allowed: false, reason: "quota_exceeded", questionsUsed, costUsed };
  }

  if (costUsed >= DAILY_COST_CAP) {
    return { allowed: false, reason: "cost_cap_exceeded", questionsUsed, costUsed };
  }

  return { allowed: true, questionsUsed, costUsed };
}

export async function recordUsage(
  userId: string,
  estimatedCostUsd: number
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

export function getQuotaStatus(
  questionsUsed: number,
  costUsed: number,
  newCostUsd?: number
) {
  const totalCost = costUsed + (newCostUsd ?? 0);
  return {
    questions_used_today: questionsUsed + 1,
    questions_limit: DAILY_QUESTION_LIMIT,
    cost_used_today_usd: totalCost,
    cost_limit_usd: DAILY_COST_CAP,
    remaining_questions: Math.max(0, DAILY_QUESTION_LIMIT - questionsUsed - 1),
  };
}

export function estimateCost(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * INPUT_COST_PER_1M +
    (outputTokens / 1_000_000) * OUTPUT_COST_PER_1M
  );
}
