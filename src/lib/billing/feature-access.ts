import type { EntitlementPlanKey, EntitlementStatus } from "@/types/entitlement";

export type FeatureSplitMode = "off" | "review";

export type MenuFeatureKey =
  | "company_search"
  | "guru_advisor"
  | "recent_chats"
  | "institutional_holdings"
  | "stock_discovery"
  | "wide_research"
  | "research_notebook";

export interface MenuFeatureDefinition {
  key: MenuFeatureKey;
  label: string;
  description: string;
  required_plan: "free" | "standard" | "pro";
}

export const MENU_FEATURE_DEFINITIONS: readonly MenuFeatureDefinition[] = [
  {
    key: "company_search",
    label: "회사 찾기",
    description: "기업을 검색하고 공시 근거 기반 분석을 시작합니다.",
    required_plan: "free",
  },
  {
    key: "guru_advisor",
    label: "관점별 분석",
    description: "공개된 원칙과 여러 관점으로 아이디어를 점검합니다.",
    required_plan: "free",
  },
  {
    key: "recent_chats",
    label: "최근 채팅",
    description: "이전에 진행한 리서치 채팅을 다시 확인합니다.",
    required_plan: "free",
  },
  {
    key: "institutional_holdings",
    label: "13F 기관 보유",
    description: "기관의 SEC 13F 보유 공시와 분기 변화를 확인합니다.",
    required_plan: "free",
  },
  {
    key: "stock_discovery",
    label: "조건으로 기업 검색",
    description: "조건과 아이디어를 바탕으로 관련 기업을 검색합니다.",
    required_plan: "free",
  },
  {
    key: "wide_research",
    label: "와이드 리서치",
    description: "여러 자료와 공시 근거를 종합하는 확장 리서치입니다.",
    required_plan: "standard",
  },
  {
    key: "research_notebook",
    label: "내 커버리지",
    description: "기업별 판단, 가설, 질문과 다음 확인 조건을 계속 관리합니다.",
    required_plan: "free",
  },
] as const;

const FREE_REVIEW_FEATURES: readonly MenuFeatureKey[] = [
  "company_search",
  "guru_advisor",
  "recent_chats",
  "institutional_holdings",
  "stock_discovery",
  "research_notebook",
];

const STANDARD_REVIEW_FEATURES: readonly MenuFeatureKey[] = [
  ...FREE_REVIEW_FEATURES,
  "wide_research",
];

const PRO_REVIEW_FEATURES: readonly MenuFeatureKey[] = [
  ...STANDARD_REVIEW_FEATURES,
];

const REVIEW_FEATURES_BY_PLAN: Record<
  EntitlementPlanKey,
  readonly MenuFeatureKey[]
> = {
  free: FREE_REVIEW_FEATURES,
  standard: STANDARD_REVIEW_FEATURES,
  pro: PRO_REVIEW_FEATURES,
  beta: MENU_FEATURE_DEFINITIONS.map(({ key }) => key),
  internal: MENU_FEATURE_DEFINITIONS.map(({ key }) => key),
};

export function getFeatureSplitMode(
  env: Record<string, string | undefined> = process.env,
): FeatureSplitMode {
  return env.PLAN_FEATURE_SPLIT_MODE?.trim().toLowerCase() === "review"
    ? "review"
    : "off";
}

export function isPlanFeatureEnabled(
  planKey: EntitlementPlanKey,
  featureKey: MenuFeatureKey,
  mode: FeatureSplitMode = getFeatureSplitMode(),
): boolean {
  if (mode === "off") return true;
  return REVIEW_FEATURES_BY_PLAN[planKey].includes(featureKey);
}

export function isEntitlementFeatureEnabled(
  entitlement: EntitlementStatus | null | undefined,
  featureKey: MenuFeatureKey,
): boolean {
  if (!entitlement) return true;
  return (
    entitlement.features.find((feature) => feature.key === featureKey)
      ?.enabled ?? true
  );
}

export function getMenuFeatureDefinition(
  featureKey: MenuFeatureKey,
): MenuFeatureDefinition {
  return MENU_FEATURE_DEFINITIONS.find((feature) => feature.key === featureKey)!;
}
