import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { BillingPlanRow } from "@/types/database";
import type {
  EntitlementPlanKey,
  EntitlementUsagePeriod,
} from "@/types/entitlement";
import {
  BILLING_PLANS,
  DEFAULT_PLAN_KEY,
  getBillingPlan,
  resolvePlanKey,
  type BillingPlan,
} from "./plans";

const BILLING_PLAN_SELECT =
  "key, label, status_label, description, budget_period, monthly_analysis_credits, daily_analysis_credits, monthly_budget_usd, daily_budget_usd, per_run_analysis_credits, per_run_reserve_usd, unlimited, sort_order, is_public, created_at, updated_at";

function isMissingRelationError(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.message?.toLowerCase().includes("could not find the table")
  );
}

function rowToBillingPlan(row: BillingPlanRow): BillingPlan {
  const key = resolvePlanKey(row.key);
  const fallback = getBillingPlan(key);
  const unlimited = Boolean(row.unlimited);

  return {
    key,
    label: row.label,
    statusLabel: row.status_label,
    description: row.description,
    budgetPeriod: row.budget_period as EntitlementUsagePeriod,
    monthlyAnalysisCredits: unlimited
      ? Number.MAX_SAFE_INTEGER
      : Number(row.monthly_analysis_credits ?? fallback.monthlyAnalysisCredits),
    dailyAnalysisCredits:
      row.daily_analysis_credits === null
        ? null
        : Number(row.daily_analysis_credits),
    monthlyBudgetUsd: unlimited
      ? Number.MAX_SAFE_INTEGER
      : Number(row.monthly_budget_usd ?? fallback.monthlyBudgetUsd),
    dailyBudgetUsd:
      row.daily_budget_usd === null ? null : Number(row.daily_budget_usd),
    perRunReserveUsd: Number(row.per_run_reserve_usd ?? 0),
    perRunAnalysisCredits: Number(
      row.per_run_analysis_credits ?? fallback.perRunAnalysisCredits,
    ),
    unlimited,
    sortOrder: Number(row.sort_order),
    public: Boolean(row.is_public),
  };
}

export async function getBillingPlanFromStore(
  planKey: EntitlementPlanKey,
): Promise<BillingPlan> {
  const fallback = getBillingPlan(planKey);

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("billing_plans")
      .select(BILLING_PLAN_SELECT)
      .eq("key", planKey)
      .maybeSingle<BillingPlanRow>();

    if (error) {
      if (isMissingRelationError(error)) return fallback;
      throw error;
    }

    return data ? rowToBillingPlan(data) : fallback;
  } catch {
    return fallback;
  }
}

export async function listPublicBillingPlansFromStore(): Promise<BillingPlan[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("billing_plans")
      .select(BILLING_PLAN_SELECT)
      .eq("is_public", true)
      .order("sort_order", { ascending: true })
      .returns<BillingPlanRow[]>();

    if (error) {
      if (isMissingRelationError(error)) return fallbackPublicPlans();
      throw error;
    }

    const plans = (data ?? []).map(rowToBillingPlan);
    return plans.length > 0 ? plans : fallbackPublicPlans();
  } catch {
    return fallbackPublicPlans();
  }
}

function fallbackPublicPlans(): BillingPlan[] {
  return Object.values(BILLING_PLANS)
    .filter((plan) => plan.public)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getDefaultBillingPlanKey(): EntitlementPlanKey {
  return DEFAULT_PLAN_KEY;
}
