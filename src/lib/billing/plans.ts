import type {
  EntitlementPlanKey,
  EntitlementUsagePeriod,
} from "@/types/entitlement";
import {
  ACTIVE_CREDIT_POLICY_VERSION,
  rawCreditsToDisplayCredits,
} from "./credit-policy";

export interface BillingPlan {
  key: EntitlementPlanKey;
  label: string;
  statusLabel: string;
  description: string;
  planVersion: string;
  monthlyPriceKrw: number;
  weeklyAnalysisCreditsRaw: number;
  creditPolicyVersion: string;
  budgetPeriod: EntitlementUsagePeriod;
  monthlyAnalysisCredits: number;
  dailyAnalysisCredits: number | null;
  monthlyBudgetUsd: number;
  dailyBudgetUsd: number | null;
  perRunReserveUsd: number;
  perRunAnalysisCredits: number;
  unlimited: boolean;
  sortOrder: number;
  public: boolean;
}

export const ANALYSIS_CREDIT_USD_UNIT = 0.14;
export const ANALYSIS_CREDITS_PER_USD_UNIT = 1_000_000;
export const ANALYSIS_CREDITS_PER_USD =
  ANALYSIS_CREDITS_PER_USD_UNIT / ANALYSIS_CREDIT_USD_UNIT;
const WEEKS_PER_MONTH_AVERAGE = 52 / 12;

export const DEFAULT_PLAN_KEY: EntitlementPlanKey = "free";

function monthlyBudgetUsdFromWeeklyRawCredits(weeklyCreditsRaw: number): number {
  return (
    Math.round(
      (weeklyCreditsRaw * WEEKS_PER_MONTH_AVERAGE * ANALYSIS_CREDIT_USD_UNIT) /
        ANALYSIS_CREDITS_PER_USD_UNIT *
        1_000_000,
    ) / 1_000_000
  );
}

export const BILLING_PLANS: Record<EntitlementPlanKey, BillingPlan> = {
  free: {
    key: "free",
    label: "Free",
    statusLabel: "무료",
    description: "첫 리서치 흐름을 확인하는 체험용 플랜",
    planVersion: "free-2026-06-usage-v3",
    monthlyPriceKrw: 0,
    weeklyAnalysisCreditsRaw: 400_000,
    creditPolicyVersion: ACTIVE_CREDIT_POLICY_VERSION,
    budgetPeriod: "weekly",
    monthlyAnalysisCredits: 400_000,
    dailyAnalysisCredits: null,
    monthlyBudgetUsd: monthlyBudgetUsdFromWeeklyRawCredits(400_000),
    dailyBudgetUsd: null,
    perRunReserveUsd: 0,
    perRunAnalysisCredits: 0,
    unlimited: false,
    sortOrder: 10,
    public: true,
  },
  standard: {
    key: "standard",
    label: "Standard",
    statusLabel: "확장 분석",
    description: "확장 리서치를 위한 기본 플랜",
    planVersion: "standard-2026-06-credit-v1",
    monthlyPriceKrw: 7_900,
    weeklyAnalysisCreditsRaw: 2_000_000,
    creditPolicyVersion: ACTIVE_CREDIT_POLICY_VERSION,
    budgetPeriod: "weekly",
    monthlyAnalysisCredits: 2_000_000,
    dailyAnalysisCredits: null,
    monthlyBudgetUsd: monthlyBudgetUsdFromWeeklyRawCredits(2_000_000),
    dailyBudgetUsd: null,
    perRunReserveUsd: 0,
    perRunAnalysisCredits: 0,
    unlimited: false,
    sortOrder: 20,
    public: true,
  },
  pro: {
    key: "pro",
    label: "Pro",
    statusLabel: "고급 분석",
    description: "여러 기업 비교와 고빈도 리서치를 위한 넉넉한 사용량",
    planVersion: "pro-2026-06-credit-v1",
    monthlyPriceKrw: 29_000,
    weeklyAnalysisCreditsRaw: 10_000_000,
    creditPolicyVersion: ACTIVE_CREDIT_POLICY_VERSION,
    budgetPeriod: "weekly",
    monthlyAnalysisCredits: 10_000_000,
    dailyAnalysisCredits: null,
    monthlyBudgetUsd: monthlyBudgetUsdFromWeeklyRawCredits(10_000_000),
    dailyBudgetUsd: null,
    perRunReserveUsd: 0,
    perRunAnalysisCredits: 0,
    unlimited: false,
    sortOrder: 30,
    public: true,
  },
  beta: {
    key: "beta",
    label: "Beta",
    statusLabel: "운영 전 테스트",
    description: "정식 과금 전 품질과 사용량 정책을 검증하는 무료 베타 플랜",
    planVersion: "beta-2026-06-credit-v1",
    monthlyPriceKrw: 0,
    weeklyAnalysisCreditsRaw: 2_000_000,
    creditPolicyVersion: ACTIVE_CREDIT_POLICY_VERSION,
    budgetPeriod: "weekly",
    monthlyAnalysisCredits: 2_000_000,
    dailyAnalysisCredits: null,
    monthlyBudgetUsd: monthlyBudgetUsdFromWeeklyRawCredits(2_000_000),
    dailyBudgetUsd: null,
    perRunReserveUsd: 0,
    perRunAnalysisCredits: 0,
    unlimited: false,
    sortOrder: 5,
    public: false,
  },
  internal: {
    key: "internal",
    label: "Internal",
    statusLabel: "내부 운영",
    description: "운영 검증과 장애 대응을 위한 내부 플랜",
    planVersion: "internal-2026-06-credit-v1",
    monthlyPriceKrw: 0,
    weeklyAnalysisCreditsRaw: Number.MAX_SAFE_INTEGER,
    creditPolicyVersion: ACTIVE_CREDIT_POLICY_VERSION,
    budgetPeriod: "weekly",
    monthlyAnalysisCredits: Number.MAX_SAFE_INTEGER,
    dailyAnalysisCredits: null,
    monthlyBudgetUsd: Number.MAX_SAFE_INTEGER,
    dailyBudgetUsd: null,
    perRunReserveUsd: 0,
    perRunAnalysisCredits: 0,
    unlimited: true,
    sortOrder: 1,
    public: false,
  },
};

export function resolvePlanKey(value: unknown): EntitlementPlanKey {
  if (typeof value !== "string") return DEFAULT_PLAN_KEY;
  if (value === "power") return "pro";
  if (value in BILLING_PLANS) return value as EntitlementPlanKey;
  return DEFAULT_PLAN_KEY;
}

export function getBillingPlanLimitLabel(plan: BillingPlan): string {
  if (plan.budgetPeriod === "daily") return "사용량/일";
  if (plan.budgetPeriod === "weekly") return "사용량/주";
  return "사용량/월";
}

export function budgetUsdToAnalysisCredits(
  value: number,
  rounding: "ceil" | "floor" | "round" = "round",
): number {
  const credits =
    Math.max(0, Number.isFinite(value) ? value : 0) * ANALYSIS_CREDITS_PER_USD;
  if (rounding === "ceil") return Math.ceil(credits);
  if (rounding === "floor") return Math.floor(credits);
  return Math.round(credits);
}

export function getBillingPlanAnalysisCredits(plan: BillingPlan): number {
  if (plan.unlimited) return Number.MAX_SAFE_INTEGER;
  return Math.max(1, Math.floor(rawCreditsToDisplayCredits(plan.weeklyAnalysisCreditsRaw)));
}

export function getEffectiveDailyBudgetUsd(plan: BillingPlan): number {
  if (plan.unlimited) return Number.MAX_SAFE_INTEGER;
  return plan.dailyBudgetUsd ?? plan.monthlyBudgetUsd;
}

export function getBillingPlanBaseRunCredits(plan: BillingPlan): number {
  return plan.perRunAnalysisCredits;
}

export function getBillingPlan(planKey: EntitlementPlanKey): BillingPlan {
  return BILLING_PLANS[planKey] ?? BILLING_PLANS[DEFAULT_PLAN_KEY];
}

export function listPublicBillingPlans(): BillingPlan[] {
  return Object.values(BILLING_PLANS)
    .filter((plan) => plan.public)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
