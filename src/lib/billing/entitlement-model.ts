import type { EntitlementStatus } from "@/types/entitlement";
import {
  budgetUsdToAnalysisCredits,
  getEffectiveDailyBudgetUsd,
  getBillingPlan,
  type BillingPlan,
} from "./plans";
import { rawCreditsToDisplayCredits } from "./credit-policy";
import type { BillingPeriod } from "./period";
import type {
  EntitlementAccessStatus,
  EntitlementPlanKey,
} from "@/types/entitlement";
import {
  getFeatureSplitMode,
  isPlanFeatureEnabled,
  MENU_FEATURE_DEFINITIONS,
} from "./feature-access";

export interface EntitlementUsageInput {
  planKey: EntitlementPlanKey;
  plan?: BillingPlan;
  budgetUsedUsd: number;
  budgetReservedUsd: number;
  dailyBudgetUsedUsd: number;
  dailyBudgetReservedUsd: number;
  runCount: number;
  period: BillingPeriod;
  status?: EntitlementAccessStatus;
  creditsUsedRaw?: number;
  creditsReservedRaw?: number;
  creditsLimitRaw?: number;
  creditRunCount?: number;
  creditPolicyVersion?: string;
  creditEnforcementMode?: "shadow" | "soft_warning" | "enforced";
}

function clampUsage(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function roundUsd(value: number): number {
  return Math.round(clampUsage(value) * 100) / 100;
}

function creditLimit(budgetUsd: number): number {
  return budgetUsdToAnalysisCredits(budgetUsd, "floor");
}

function usedCredits(budgetUsd: number): number {
  return budgetUsdToAnalysisCredits(budgetUsd, "ceil");
}

function remainingCredits(budgetUsd: number): number {
  return budgetUsdToAnalysisCredits(budgetUsd, "floor");
}

function upgradeCopy(
  percentUsed: number,
  usageLabel: string,
  planKey: EntitlementPlanKey,
  status: EntitlementAccessStatus,
) {
  if (status === "admin") {
    return {
      enabled: false,
      title: "관리자 계정입니다.",
      message: "주간 분석 한도가 적용되지 않습니다.",
      label: "플랜 확인",
    };
  }

  if (planKey === "standard" || planKey === "pro") {
    if (percentUsed >= 100) {
      return {
        enabled: false,
        title: `${usageLabel} 분석 한도를 모두 사용했습니다.`,
        message: "다음 충전 후 새 분석을 다시 실행할 수 있습니다.",
        label: "사용량 확인",
      };
    }

    if (percentUsed >= 90) {
      return {
        enabled: false,
        title: `${usageLabel} 분석량이 거의 찼습니다.`,
        message: "다음 충전 시각을 확인하세요.",
        label: "사용량 확인",
      };
    }

    return {
      enabled: false,
      title: "현재 플랜으로 사용할 수 있습니다.",
      message: "사용량이 안정 범위 안에 있습니다.",
      label: "사용량 확인",
    };
  }

  if (percentUsed >= 100) {
    return {
      enabled: true,
      title: `${usageLabel} 체험 사용량을 모두 사용했습니다.`,
      message: "Standard로 업그레이드하면 더 넉넉한 주간 분석량을 사용할 수 있습니다.",
      label: "Standard 보기",
    };
  }

  if (percentUsed >= 80) {
    return {
      enabled: true,
      title: `${usageLabel} 체험 사용량이 거의 찼습니다.`,
      message: "Standard로 업그레이드하면 더 넉넉한 주간 분석량을 사용할 수 있습니다.",
      label: "플랜 확인",
    };
  }

  return {
    enabled: false,
    title: "현재 플랜으로 사용할 수 있습니다.",
    message: "사용량이 안정 범위 안에 있습니다.",
    label: "플랜 확인",
  };
}

export function buildEntitlementStatus({
  planKey,
  plan: providedPlan,
  budgetUsedUsd,
  budgetReservedUsd,
  dailyBudgetUsedUsd,
  dailyBudgetReservedUsd,
  runCount,
  period,
  status,
  creditsUsedRaw,
  creditsReservedRaw,
  creditsLimitRaw,
  creditRunCount,
  creditPolicyVersion,
  creditEnforcementMode = "shadow",
}: EntitlementUsageInput): EntitlementStatus {
  const plan = providedPlan ?? getBillingPlan(planKey);
  const used = roundUsd(budgetUsedUsd);
  const reserved = roundUsd(budgetReservedUsd);
  const dailyUsed = roundUsd(dailyBudgetUsedUsd);
  const dailyReserved = roundUsd(dailyBudgetReservedUsd);
  const accessStatus =
    status ?? (plan.key === "beta" ? "beta" : "standard");
  const unlimited = accessStatus === "admin" || plan.unlimited;
  const budgetLimit = unlimited
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0.01, plan.monthlyBudgetUsd);
  const dailyBudgetLimit = unlimited
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0.01, getEffectiveDailyBudgetUsd(plan));
  const effectiveBudgetUsed = used + reserved;
  const rawLimit = unlimited
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0, Math.floor(clampUsage(creditsLimitRaw ?? plan.weeklyAnalysisCreditsRaw)));
  const rawUsed = unlimited ? 0 : Math.floor(clampUsage(creditsUsedRaw ?? 0));
  const rawReserved = unlimited
    ? 0
    : Math.floor(clampUsage(creditsReservedRaw ?? 0));
  const rawRemaining = unlimited
    ? Number.MAX_SAFE_INTEGER
    : Math.max(0, rawLimit - rawUsed - rawReserved);
  const remaining = unlimited
    ? Number.MAX_SAFE_INTEGER
    : roundUsd(Math.max(0, budgetLimit - effectiveBudgetUsed));
  const percentUsed = unlimited
    ? 0
    : rawLimit > 0
      ? Math.min(100, Math.round(((rawUsed + rawReserved) / rawLimit) * 100))
      : 100;
  const canRun =
    unlimited ||
    rawRemaining > 0;
  const alertLevel =
    !unlimited && !canRun
      ? "blocked"
      : !unlimited && percentUsed >= 90
        ? "warning"
        : "ok";
  const upgrade = upgradeCopy(percentUsed, period.label, plan.key, accessStatus);
  const analysisCreditLimit = unlimited
    ? Number.MAX_SAFE_INTEGER
    : creditLimit(budgetLimit);
  const dailyAnalysisCreditLimit = unlimited
    ? Number.MAX_SAFE_INTEGER
    : creditLimit(dailyBudgetLimit);
  const effectiveRunCount = Math.floor(
    clampUsage(creditRunCount ?? runCount),
  );

  return {
    status: accessStatus,
    plan: {
      key: plan.key,
      label: plan.label,
      status_label: plan.statusLabel,
      description: plan.description,
    },
    usage: {
      period: plan.budgetPeriod,
      period_label: period.label,
      period_start: period.start,
      period_end: period.end,
      budget_used_usd: used,
      budget_reserved_usd: reserved,
      budget_limit_usd: budgetLimit,
      remaining_budget_usd: remaining,
      daily_budget_used_usd: dailyUsed,
      daily_budget_reserved_usd: dailyReserved,
      daily_budget_limit_usd: dailyBudgetLimit,
      per_run_reserve_usd: plan.perRunReserveUsd,
      credits_used_raw: rawUsed,
      credits_reserved_raw: rawReserved,
      credits_limit_raw: rawLimit,
      credits_remaining_raw: rawRemaining,
      credits_used_display: rawCreditsToDisplayCredits(rawUsed),
      credits_reserved_display: rawCreditsToDisplayCredits(rawReserved),
      credits_limit_display: rawCreditsToDisplayCredits(rawLimit),
      credits_remaining_display: rawCreditsToDisplayCredits(rawRemaining),
      credit_policy_version: creditPolicyVersion ?? plan.creditPolicyVersion,
      credit_enforcement_mode: creditEnforcementMode,
      analysis_credits_used: unlimited
        ? 0
        : Math.min(usedCredits(used), analysisCreditLimit),
      analysis_credits_reserved: unlimited
        ? 0
        : Math.min(usedCredits(reserved), analysisCreditLimit),
      analysis_credits_limit: analysisCreditLimit,
      remaining_analysis_credits: unlimited
        ? Number.MAX_SAFE_INTEGER
        : remainingCredits(remaining),
      daily_analysis_credits_used: unlimited
        ? 0
        : usedCredits(dailyUsed),
      daily_analysis_credits_reserved: unlimited
        ? 0
        : usedCredits(dailyReserved),
      daily_analysis_credits_limit: dailyAnalysisCreditLimit,
      per_run_analysis_credits: unlimited
        ? 0
        : budgetUsdToAnalysisCredits(plan.perRunReserveUsd, "ceil"),
      run_count: effectiveRunCount,
      percent_used: percentUsed,
      alert_level: alertLevel,
      can_run: canRun,
      unlimited,
      resets_at: period.end,
    },
    features: [
      {
        key: "evidence_research",
        label: "근거 기반 리서치",
        description: "기업 공시와 온톨로지 인덱스를 사용한 기본 분석",
        enabled: true,
      },
      {
        key: "evidence_path",
        label: "근거 경로",
        description: "도구 호출과 인용 근거를 화면에서 추적",
        enabled: true,
      },
      {
        key: "share_links",
        label: "답변 공유",
        description: "완성된 답변을 공유 링크로 전달",
        enabled: true,
      },
      {
        key: "markdown_answer",
        label: "Markdown 답변",
        description: "모바일과 웹에서 읽기 쉬운 텍스트 리서치 답변",
        enabled: true,
      },
      {
        key: "company_compare",
        label: "기업 비교",
        description: "여러 기업을 같은 기준으로 비교하는 분석",
        enabled: true,
      },
      {
        key: "priority_queue",
        label: "우선 분석 큐",
        description: "플랜과 사용량 상태에 따라 작업 처리 순서를 조정",
        enabled: true,
      },
      ...MENU_FEATURE_DEFINITIONS.map((feature) => ({
        ...feature,
        enabled: isPlanFeatureEnabled(
          planKey,
          feature.key,
          getFeatureSplitMode(),
        ),
      })),
    ],
    upgrade: {
      label: upgrade.label,
      href: "/settings/billing",
      enabled: upgrade.enabled,
      title: upgrade.title,
      message: upgrade.message,
    },
  };
}
