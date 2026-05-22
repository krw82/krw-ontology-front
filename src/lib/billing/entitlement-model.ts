import type { EntitlementStatus } from "@/types/entitlement";
import {
  getBillingPlan,
  type BillingPlan,
} from "./plans";
import type { BillingPeriod } from "./period";
import type { EntitlementPlanKey } from "@/types/entitlement";

export interface EntitlementUsageInput {
  planKey: EntitlementPlanKey;
  questionsUsed: number;
  period: BillingPeriod;
}

function clampUsage(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
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

function upgradeCopy(percentUsed: number) {
  if (percentUsed >= 100) {
    return {
      enabled: true,
      title: "이번 달 질문 한도를 모두 사용했습니다.",
      message: "플랜을 올리면 더 많은 기업 리서치를 계속 실행할 수 있습니다.",
      label: "플랜 확인",
    };
  }

  if (percentUsed >= 80) {
    return {
      enabled: true,
      title: "이번 달 질문 한도에 가까워졌습니다.",
      message: "남은 질문 수를 확인하고 필요한 경우 상위 플랜을 준비하세요.",
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
  questionsUsed,
  period,
}: EntitlementUsageInput): EntitlementStatus {
  const plan = getBillingPlan(planKey);
  const used = clampUsage(questionsUsed);
  const questionLimit = Math.max(1, Math.floor(plan.monthlyQuestionLimit));
  const remaining = Math.max(0, questionLimit - used);
  const percentUsed = Math.min(100, Math.round((used / questionLimit) * 100));
  const alertLevel =
    percentUsed >= 100 ? "blocked" : percentUsed >= 80 ? "warning" : "ok";
  const upgrade = upgradeCopy(percentUsed);

  return {
    plan: {
      key: plan.key,
      label: plan.label,
      status_label: plan.statusLabel,
      description: plan.description,
    },
    usage: {
      period: "monthly",
      period_label: period.label,
      period_start: period.start,
      period_end: period.end,
      questions_used: used,
      questions_limit: questionLimit,
      remaining_questions: remaining,
      percent_used: percentUsed,
      alert_level: alertLevel,
      can_run: remaining > 0,
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
