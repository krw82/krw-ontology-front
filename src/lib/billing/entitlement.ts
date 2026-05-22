import { getQuotaLimits } from "@/lib/concurrency/quota";
import { createClient } from "@/lib/supabase/server";
import type { UsageDailyRow } from "@/types/database";
import type { EntitlementStatus } from "@/types/entitlement";
import { buildBetaEntitlementStatus } from "./entitlement-model";

export async function getEntitlementStatus(
  userId: string,
): Promise<EntitlementStatus> {
  const today = new Date().toISOString().split("T")[0];
  const supabase = await createClient();
  const { dailyQuestionLimit, dailyCostCapUsd } = getQuotaLimits();

  const { data, error } = await supabase
    .from("usage_daily")
    .select("question_count, estimated_cost_usd")
    .eq("user_id", userId)
    .eq("date", today)
    .single<UsageDailyRow>();

  if (error && error.code !== "PGRST116") {
    throw new Error("Failed to load entitlement usage");
  }

  return buildBetaEntitlementStatus({
    questionsUsed: data?.question_count ?? 0,
    costUsedUsd: data?.estimated_cost_usd ?? 0,
    dailyQuestionLimit,
    dailyCostCapUsd,
  });
}
