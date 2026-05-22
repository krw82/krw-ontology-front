import type { EntitlementStatus } from "@/types/entitlement";

export interface EntitlementUsageInput {
  questionsUsed: number;
  costUsedUsd: number;
  dailyQuestionLimit: number;
  dailyCostCapUsd: number;
  now?: Date;
}

function nextUtcMidnight(now: Date): string {
  return new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + 1,
    ),
  ).toISOString();
}

function clampUsage(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function buildBetaEntitlementStatus({
  questionsUsed,
  costUsedUsd,
  dailyQuestionLimit,
  dailyCostCapUsd,
  now = new Date(),
}: EntitlementUsageInput): EntitlementStatus {
  const used = clampUsage(questionsUsed);
  const questionLimit = Math.max(1, Math.floor(dailyQuestionLimit));
  const costUsed = clampUsage(costUsedUsd);
  const costLimit = Math.max(0, dailyCostCapUsd);
  const remaining = Math.max(0, questionLimit - used);
  const percentUsed = Math.min(100, Math.round((used / questionLimit) * 100));

  return {
    plan: {
      key: "beta",
      label: "베타 플랜",
      status_label: "운영 전 테스트",
      description:
        "정식 과금 전까지 리서치 품질과 사용량 제한을 함께 검증합니다.",
    },
    usage: {
      period: "daily",
      period_label: "오늘",
      questions_used: used,
      questions_limit: questionLimit,
      remaining_questions: remaining,
      cost_used_usd: costUsed,
      cost_limit_usd: costLimit,
      percent_used: percentUsed,
      resets_at: nextUtcMidnight(now),
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
        key: "html_export",
        label: "HTML 내보내기",
        description: "구조화된 답변을 HTML 산출물로 저장",
        enabled: true,
      },
      {
        key: "company_compare",
        label: "기업 비교",
        description: "여러 기업을 같은 기준으로 비교하는 분석",
        enabled: false,
      },
      {
        key: "priority_queue",
        label: "우선 분석 큐",
        description: "혼잡 시간대에 리서치 작업을 우선 처리",
        enabled: false,
      },
    ],
    upgrade: {
      label: "요금제 준비 중",
      href: "/settings/billing",
      enabled: false,
    },
  };
}
