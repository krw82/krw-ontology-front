import type { EntitlementPlanKey } from "@/types/entitlement";

export interface BillingPlan {
  key: EntitlementPlanKey;
  label: string;
  statusLabel: string;
  description: string;
  monthlyQuestionLimit: number;
  sortOrder: number;
  public: boolean;
}

export const DEFAULT_PLAN_KEY: EntitlementPlanKey = "free";

export const BILLING_PLANS: Record<EntitlementPlanKey, BillingPlan> = {
  free: {
    key: "free",
    label: "Free",
    statusLabel: "무료",
    description: "개인 테스트와 가벼운 기업 리서치용 기본 플랜",
    monthlyQuestionLimit: 10,
    sortOrder: 10,
    public: true,
  },
  pro: {
    key: "pro",
    label: "Pro",
    statusLabel: "개인 분석",
    description: "정기적으로 기업 리서치를 수행하는 사용자를 위한 플랜",
    monthlyQuestionLimit: 100,
    sortOrder: 20,
    public: true,
  },
  power: {
    key: "power",
    label: "Power",
    statusLabel: "고빈도 분석",
    description: "여러 기업과 주제를 반복적으로 확인하는 고사용량 플랜",
    monthlyQuestionLimit: 300,
    sortOrder: 30,
    public: true,
  },
  beta: {
    key: "beta",
    label: "Beta",
    statusLabel: "운영 전 테스트",
    description: "정식 과금 전 품질과 사용량 제한을 검증하는 내부 베타 플랜",
    monthlyQuestionLimit: 100,
    sortOrder: 5,
    public: false,
  },
  internal: {
    key: "internal",
    label: "Internal",
    statusLabel: "내부 운영",
    description: "운영 검증과 장애 대응을 위한 내부 플랜",
    monthlyQuestionLimit: 1000,
    sortOrder: 1,
    public: false,
  },
};

export function resolvePlanKey(value: unknown): EntitlementPlanKey {
  if (typeof value !== "string") return DEFAULT_PLAN_KEY;
  if (value in BILLING_PLANS) return value as EntitlementPlanKey;
  return DEFAULT_PLAN_KEY;
}

export function getBillingPlan(planKey: EntitlementPlanKey): BillingPlan {
  return BILLING_PLANS[planKey] ?? BILLING_PLANS[DEFAULT_PLAN_KEY];
}

export function listPublicBillingPlans(): BillingPlan[] {
  return Object.values(BILLING_PLANS)
    .filter((plan) => plan.public)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}
