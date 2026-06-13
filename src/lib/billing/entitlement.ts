import { createClient } from "@/lib/supabase/server";
import type {
  UsageBudgetBalanceRow,
  UsageDailyRow,
  UsagePeriodCounterRow,
  UserEntitlementRow,
} from "@/types/database";
import type { EntitlementStatus } from "@/types/entitlement";
import { isAdminEntitlementEmail } from "./admin-emails";
import { buildEntitlementStatus } from "./entitlement-model";
import {
  getCurrentBillingPeriod,
  getCurrentDailyBillingPeriod,
  getCurrentMonthlyBillingPeriod,
} from "./period";
import { getBillingPlanFromStore } from "./plan-store";
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
  userEmail?: string | null,
): Promise<EntitlementStatus> {
  const isAdmin = isAdminEntitlementEmail(userEmail);
  const planKey = isAdmin ? "internal" : await loadPlanKey(userId);
  const plan = await getBillingPlanFromStore(planKey);
  const period = getCurrentBillingPeriod(plan.budgetPeriod);
  const monthlyPeriod = getCurrentMonthlyBillingPeriod();
  const dailyPeriod = getCurrentDailyBillingPeriod();
  const budget = await loadExecutionBudgetSnapshot(
    userId,
    monthlyPeriod,
    dailyPeriod,
  );

  return buildEntitlementStatus({
    planKey,
    plan,
    budgetUsedUsd: budget.monthly.settledCostUsd,
    budgetReservedUsd: budget.monthly.reservedCostUsd,
    dailyBudgetUsedUsd: budget.daily.settledCostUsd,
    dailyBudgetReservedUsd: budget.daily.reservedCostUsd,
    runCount: budget.monthly.runCount,
    period,
    status: isAdmin ? "admin" : undefined,
  });
}

export { isAdminEntitlementEmail };

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

async function loadDailyQuestionCount(
  userId: string,
  period: { start: string },
) {
  const supabase = await createClient();
  const date = period.start.slice(0, 10);
  const { data, error } = await supabase
    .from("usage_daily")
    .select("question_count")
    .eq("user_id", userId)
    .eq("date", date)
    .maybeSingle<Pick<UsageDailyRow, "question_count">>();

  if (error) throw new Error("Failed to load daily usage");
  return data?.question_count ?? 0;
}

interface BudgetSnapshotPart {
  settledCostUsd: number;
  reservedCostUsd: number;
  runCount: number;
}

async function loadExecutionBudgetSnapshot(
  userId: string,
  monthlyPeriod: { start: string; end: string },
  dailyPeriod: { start: string; end: string },
) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("usage_budget_balances")
    .select(
      "period_kind, period_start, settled_cost_usd, reserved_cost_usd, run_count",
    )
    .eq("user_id", userId)
    .in("period_kind", ["monthly", "daily"])
    .in("period_start", [monthlyPeriod.start, dailyPeriod.start])
    .returns<
      Pick<
        UsageBudgetBalanceRow,
        | "period_kind"
        | "period_start"
        | "settled_cost_usd"
        | "reserved_cost_usd"
        | "run_count"
      >[]
    >();

  if (!error) {
    const monthly = data?.find(
      (row) =>
        row.period_kind === "monthly" &&
        row.period_start === monthlyPeriod.start,
    );
    const daily = data?.find(
      (row) =>
        row.period_kind === "daily" &&
        row.period_start === dailyPeriod.start,
    );

    return {
      monthly: balancePart(monthly),
      daily: balancePart(daily),
    };
  }

  if (!isMissingRelationError(error)) {
    throw new Error("Failed to load execution budget usage");
  }

  const [monthlyRuns, dailyRuns] = await Promise.all([
    loadMonthlyQuestionCount(userId, monthlyPeriod),
    loadDailyQuestionCount(userId, dailyPeriod),
  ]);

  return {
    monthly: {
      settledCostUsd: 0,
      reservedCostUsd: 0,
      runCount: monthlyRuns,
    },
    daily: {
      settledCostUsd: 0,
      reservedCostUsd: 0,
      runCount: dailyRuns,
    },
  };
}

function balancePart(
  row:
    | Pick<
        UsageBudgetBalanceRow,
        "settled_cost_usd" | "reserved_cost_usd" | "run_count"
      >
    | undefined,
): BudgetSnapshotPart {
  return {
    settledCostUsd: Number(row?.settled_cost_usd ?? 0),
    reservedCostUsd: Number(row?.reserved_cost_usd ?? 0),
    runCount: Number(row?.run_count ?? 0),
  };
}
