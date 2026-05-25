import type { EntitlementStatus } from "@/types/entitlement";
import {
  budgetUsdToAnalysisCredits,
  getEffectiveDailyBudgetUsd,
  getBillingPlan,
  type BillingPlan,
} from "./plans";
import type { BillingPeriod } from "./period";
import type {
  EntitlementAccessStatus,
  EntitlementPlanKey,
} from "@/types/entitlement";

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

function featureEnabled(plan: BillingPlan, feature: string): boolean {
  if (plan.key === "internal") return true;
  if (feature === "company_compare") {
    return plan.key === "pro" || plan.key === "power" || plan.key === "beta";
  }
  if (feature === "priority_queue") {
    return plan.key === "power" || plan.key === "beta";
  }
  return true;
}

function upgradeCopy(
  percentUsed: number,
  usageLabel: string,
  status: EntitlementAccessStatus,
) {
  if (status === "admin") {
    return {
      enabled: false,
      title: "관리자 계정입니다.",
      message: "분석 크레딧 한도가 적용되지 않습니다.",
      label: "플랜 확인",
    };
  }

  if (percentUsed >= 100) {
    return {
      enabled: true,
      title: `${usageLabel} 분석 크레딧을 모두 사용했습니다.`,
      message: "플랜을 올리면 더 많은 기업 리서치를 계속 실행할 수 있습니다.",
      label: "플랜 확인",
    };
  }

  if (percentUsed >= 80) {
    return {
      enabled: true,
      title: `${usageLabel} 분석 크레딧 한도에 가까워졌습니다.`,
      message: "남은 크레딧을 확인하고 필요한 경우 상위 플랜을 준비하세요.",
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
  const effectiveDailyBudgetUsed = dailyUsed + dailyReserved;
  const remaining = unlimited
    ? Number.MAX_SAFE_INTEGER
    : roundUsd(Math.max(0, budgetLimit - effectiveBudgetUsed));
  const dailyRemaining = unlimited
    ? Number.MAX_SAFE_INTEGER
    : roundUsd(Math.max(0, dailyBudgetLimit - effectiveDailyBudgetUsed));
  const percentUsed = unlimited
    ? 0
    : Math.min(100, Math.round((effectiveBudgetUsed / budgetLimit) * 100));
  const canRun =
    unlimited ||
    (remainingCredits(remaining) > 0 && remainingCredits(dailyRemaining) > 0);
  const alertLevel =
    !unlimited && !canRun
      ? "blocked"
      : !unlimited && percentUsed >= 80
        ? "warning"
        : "ok";
  const upgrade = upgradeCopy(percentUsed, period.label, accessStatus);
  const analysisCreditLimit = unlimited
    ? Number.MAX_SAFE_INTEGER
    : plan.monthlyAnalysisCredits;
  const dailyAnalysisCreditLimit = unlimited
    ? Number.MAX_SAFE_INTEGER
    : (plan.dailyAnalysisCredits ?? creditLimit(dailyBudgetLimit));

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
      analysis_credits_used: unlimited
        ? 0
        : usedCredits(used),
      analysis_credits_reserved: unlimited
        ? 0
        : usedCredits(reserved),
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
      run_count: Math.floor(clampUsage(runCount)),
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
        enabled: featureEnabled(plan, "company_compare"),
      },
      {
        key: "priority_queue",
        label: "우선 분석 큐",
        description: "혼잡 시간대에 리서치 작업을 우선 처리",
        enabled: featureEnabled(plan, "priority_queue"),
      },
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
