import { createClient } from "@/lib/supabase/server";
import type {
  UsageBudgetBalanceRow,
  UsageCreditBalanceRow,
  UsageDailyRow,
  UsagePeriodCounterRow,
  UserEntitlementRow,
} from "@/types/database";
import type { EntitlementStatus } from "@/types/entitlement";
import { isAdminEntitlementEmail } from "./admin-emails";
import { getCreditEnforcementMode } from "./credit-policy";
import { buildEntitlementStatus } from "./entitlement-model";
import {
  getCurrentBillingPeriod,
  getCurrentDailyBillingPeriod,
  getCurrentMonthlyBillingPeriod,
  getCurrentWeeklyBillingPeriod,
} from "./period";
import { getBillingPlanFromStore } from "./plan-store";
import { DEFAULT_PLAN_KEY, resolvePlanKey } from "./plans";

type EntitlementQueryClient = Pick<
  Awaited<ReturnType<typeof createClient>>,
  "from"
>;

interface GetEntitlementStatusOptions {
  supabase?: EntitlementQueryClient;
}

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
  options: GetEntitlementStatusOptions = {},
): Promise<EntitlementStatus> {
  const now = new Date();
  const supabase = options.supabase ?? (await createClient());
  const isAdmin = isAdminEntitlementEmail(userEmail);
  const entitlement = isAdmin
    ? { planKey: "internal" as const, creditAnchorAt: null }
    : await loadEntitlementAccess(supabase, userId, now);
  const planKey = entitlement.planKey;
  const plan = await getBillingPlanFromStore(planKey);
  const period =
    plan.budgetPeriod === "weekly"
      ? getCurrentWeeklyBillingPeriod(
          entitlement.creditAnchorAt ?? now,
          now,
        )
      : getCurrentBillingPeriod(plan.budgetPeriod, now);
  const monthlyPeriod = getCurrentMonthlyBillingPeriod(now);
  const dailyPeriod = getCurrentDailyBillingPeriod(now);
  const budget = await loadExecutionBudgetSnapshot(
    supabase,
    userId,
    monthlyPeriod,
    dailyPeriod,
  );
  const credit = await loadCreditBudgetSnapshot(supabase, userId, now);

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
    creditsUsedRaw: credit?.creditsUsedRaw,
    creditsReservedRaw: credit?.creditsReservedRaw,
    creditsLimitRaw: credit
      ? Math.max(credit.creditsLimitRaw, plan.weeklyAnalysisCreditsRaw)
      : undefined,
    creditRunCount: credit?.runCount,
    creditPolicyVersion: credit?.creditPolicyVersion,
    creditEnforcementMode: getCreditEnforcementMode(),
  });
}

export { isAdminEntitlementEmail };

function isUsableEntitlement(
  entitlement: Pick<
    UserEntitlementRow,
    "status" | "current_period_end" | "grace_until"
  >,
  now: Date,
) {
  if (entitlement.status === "grace") {
    const graceUntil = new Date(entitlement.grace_until ?? "").getTime();
    return Number.isFinite(graceUntil) && graceUntil > now.getTime();
  }
  if (entitlement.status !== "active") return false;
  const periodEnd = new Date(entitlement.current_period_end).getTime();
  return Number.isFinite(periodEnd) && periodEnd > now.getTime();
}

async function loadEntitlementAccess(
  supabase: EntitlementQueryClient,
  userId: string,
  now: Date,
): Promise<{
  planKey: ReturnType<typeof resolvePlanKey>;
  creditAnchorAt: string | null;
}> {
  const { data, error } = await supabase
    .from("user_entitlements")
    .select(
      "plan_key, status, current_period_start, current_period_end, credit_anchor_at, grace_until",
    )
    .eq("user_id", userId)
    .maybeSingle<UserEntitlementRow>();

  if (error) {
    if (isMissingRelationError(error)) {
      return { planKey: DEFAULT_PLAN_KEY, creditAnchorAt: null };
    }
    throw new Error("Failed to load user entitlement");
  }

  if (!data || !isUsableEntitlement(data, now)) {
    return { planKey: DEFAULT_PLAN_KEY, creditAnchorAt: null };
  }
  return {
    planKey: resolvePlanKey(data.plan_key),
    creditAnchorAt: data.credit_anchor_at ?? data.current_period_start ?? null,
  };
}

async function loadMonthlyQuestionCount(
  supabase: EntitlementQueryClient,
  userId: string,
  period: { start: string; end: string },
) {
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
  supabase: EntitlementQueryClient,
  userId: string,
  period: { start: string },
) {
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
  supabase: EntitlementQueryClient,
  userId: string,
  monthlyPeriod: { start: string; end: string },
  dailyPeriod: { start: string; end: string },
) {
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
    loadMonthlyQuestionCount(supabase, userId, monthlyPeriod),
    loadDailyQuestionCount(supabase, userId, dailyPeriod),
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

async function loadCreditBudgetSnapshot(
  supabase: EntitlementQueryClient,
  userId: string,
  now: Date,
): Promise<{
  creditsUsedRaw: number;
  creditsReservedRaw: number;
  creditsLimitRaw: number;
  runCount: number;
  creditPolicyVersion: string;
} | null> {
  const { data, error } = await supabase
    .from("usage_credit_balances")
    .select(
      "credits_used_raw, credits_reserved_raw, credits_limit_raw, run_count, credit_policy_version",
    )
    .eq("user_id", userId)
    .eq("period_kind", "weekly")
    .lte("period_start", now.toISOString())
    .gt("period_end", now.toISOString())
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle<
      Pick<
        UsageCreditBalanceRow,
        | "credits_used_raw"
        | "credits_reserved_raw"
        | "credits_limit_raw"
        | "run_count"
        | "credit_policy_version"
      >
    >();

  if (error) {
    if (isMissingRelationError(error)) return null;
    throw new Error("Failed to load credit usage");
  }

  if (!data) return null;
  return {
    creditsUsedRaw: Number(data.credits_used_raw ?? 0),
    creditsReservedRaw: Number(data.credits_reserved_raw ?? 0),
    creditsLimitRaw: Number(data.credits_limit_raw ?? 0),
    runCount: Number(data.run_count ?? 0),
    creditPolicyVersion: String(data.credit_policy_version),
  };
}
