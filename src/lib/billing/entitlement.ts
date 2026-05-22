import { createClient } from "@/lib/supabase/server";
import type {
  UsageDailyRow,
  UsagePeriodCounterRow,
  UserEntitlementRow,
} from "@/types/database";
import type { EntitlementStatus } from "@/types/entitlement";
import { buildEntitlementStatus } from "./entitlement-model";
import { getCurrentMonthlyBillingPeriod } from "./period";
import { DEFAULT_PLAN_KEY, resolvePlanKey } from "./plans";

function isMissingRelationError(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.message?.toLowerCase().includes("could not find the table")
  );
}

export async function getEntitlementStatus(
  userId: string,
): Promise<EntitlementStatus> {
  const period = getCurrentMonthlyBillingPeriod();
  const planKey = await loadPlanKey(userId);
  const questionsUsed = await loadMonthlyQuestionCount(userId, period);

  return buildEntitlementStatus({
    planKey,
    questionsUsed,
    period,
  });
}

async function loadPlanKey(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_entitlements")
    .select("plan_key, status, current_period_start, current_period_end")
    .eq("user_id", userId)
    .maybeSingle<UserEntitlementRow>();

  if (error) {
    if (isMissingRelationError(error)) return DEFAULT_PLAN_KEY;
    throw new Error("Failed to load user entitlement");
  }

  if (!data || data.status !== "active") return DEFAULT_PLAN_KEY;
  return resolvePlanKey(data.plan_key);
}

async function loadMonthlyQuestionCount(
  userId: string,
  period: { start: string; end: string },
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("usage_period_counters")
    .select("question_count")
    .eq("user_id", userId)
    .eq("period_start", period.start)
    .eq("period_end", period.end)
    .maybeSingle<Pick<UsagePeriodCounterRow, "question_count">>();

  if (!error) return data?.question_count ?? 0;
  if (!isMissingRelationError(error)) {
    throw new Error("Failed to load monthly usage");
  }

  const startDate = period.start.slice(0, 10);
  const endDate = period.end.slice(0, 10);
  const { data: dailyRows, error: dailyError } = await supabase
    .from("usage_daily")
    .select("question_count")
    .eq("user_id", userId)
    .gte("date", startDate)
    .lt("date", endDate)
    .returns<Pick<UsageDailyRow, "question_count">[]>();

  if (dailyError) throw new Error("Failed to load usage fallback");
  return (dailyRows ?? []).reduce(
    (total, row) => total + (row.question_count ?? 0),
    0,
  );
}
