import type {
  EntitlementPlanKey,
  EntitlementUsagePeriod,
} from "@/types/entitlement";

export interface BillingPlan {
  key: EntitlementPlanKey;
  label: string;
  statusLabel: string;
  description: string;
  budgetPeriod: EntitlementUsagePeriod;
  monthlyBudgetUsd: number;
  dailyBudgetUsd: number;
  perRunReserveUsd: number;
  sortOrder: number;
  public: boolean;
}

export const ANALYSIS_CREDIT_USD_UNIT = 0.1;
export const ANALYSIS_CREDITS_PER_USD_UNIT = 100;
export const ANALYSIS_CREDITS_PER_USD =
  ANALYSIS_CREDITS_PER_USD_UNIT / ANALYSIS_CREDIT_USD_UNIT;

export const DEFAULT_PLAN_KEY: EntitlementPlanKey = "beta";

export const BILLING_PLANS: Record<EntitlementPlanKey, BillingPlan> = {
  free: {
    key: "free",
    label: "Free",
    statusLabel: "무료",
    description: "개인 테스트와 가벼운 기업 리서치용 기본 분석 크레딧",
    budgetPeriod: "monthly",
    monthlyBudgetUsd: 2,
    dailyBudgetUsd: 0.5,
    perRunReserveUsd: 0.25,
    sortOrder: 10,
    public: true,
  },
  pro: {
    key: "pro",
    label: "Pro",
    statusLabel: "개인 분석",
    description: "정기적으로 기업 리서치를 수행하는 사용자를 위한 분석 크레딧",
    budgetPeriod: "monthly",
    monthlyBudgetUsd: 20,
    dailyBudgetUsd: 3,
    perRunReserveUsd: 0.5,
    sortOrder: 20,
    public: true,
  },
  power: {
    key: "power",
    label: "Power",
    statusLabel: "고빈도 분석",
    description: "여러 기업과 주제를 반복 확인하는 고사용량 분석 크레딧",
    budgetPeriod: "monthly",
    monthlyBudgetUsd: 60,
    dailyBudgetUsd: 10,
    perRunReserveUsd: 1,
    sortOrder: 30,
    public: true,
  },
  beta: {
    key: "beta",
    label: "Beta",
    statusLabel: "운영 전 테스트",
    description: "정식 과금 전 품질과 분석 크레딧 정책을 검증하는 무료 베타 플랜",
    budgetPeriod: "monthly",
    monthlyBudgetUsd: 5,
    dailyBudgetUsd: 1,
    perRunReserveUsd: 0.25,
    sortOrder: 5,
    public: false,
  },
  internal: {
    key: "internal",
    label: "Internal",
    statusLabel: "내부 운영",
    description: "운영 검증과 장애 대응을 위한 내부 플랜",
    budgetPeriod: "monthly",
    monthlyBudgetUsd: 500,
    dailyBudgetUsd: 100,
    perRunReserveUsd: 1,
    sortOrder: 1,
    public: false,
  },
};

export function resolvePlanKey(value: unknown): EntitlementPlanKey {
  if (typeof value !== "string") return DEFAULT_PLAN_KEY;
  if (value in BILLING_PLANS) return value as EntitlementPlanKey;
  return DEFAULT_PLAN_KEY;
}

export function getBillingPlanLimitLabel(plan: BillingPlan): string {
  return plan.budgetPeriod === "daily"
    ? "분석 크레딧/일"
    : "분석 크레딧/월";
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
  return Math.max(1, budgetUsdToAnalysisCredits(plan.monthlyBudgetUsd, "floor"));
}

export function getBillingPlanBaseRunCredits(plan: BillingPlan): number {
  return Math.max(1, budgetUsdToAnalysisCredits(plan.perRunReserveUsd, "ceil"));
}

export function getBillingPlan(planKey: EntitlementPlanKey): BillingPlan {
  return BILLING_PLANS[planKey] ?? BILLING_PLANS[DEFAULT_PLAN_KEY];
}

export function listPublicBillingPlans(): BillingPlan[] {
  return Object.values(BILLING_PLANS)
    .filter((plan) => plan.public)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
