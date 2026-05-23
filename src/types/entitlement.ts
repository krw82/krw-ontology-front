export type EntitlementPlanKey = "free" | "pro" | "power" | "beta" | "internal";

export type EntitlementAlertLevel = "ok" | "warning" | "blocked";
export type EntitlementAccessStatus = "standard" | "beta" | "admin";
export type EntitlementUsagePeriod = "daily" | "monthly";

export interface EntitlementFeature {
  key:
    | "evidence_research"
    | "evidence_path"
    | "share_links"
    | "markdown_answer"
    | "company_compare"
    | "priority_queue";
  label: string;
  description: string;
  enabled: boolean;
}

export interface EntitlementUsage {
  period: EntitlementUsagePeriod;
  period_label: string;
  period_start: string;
  period_end: string;
  budget_used_usd: number;
  budget_reserved_usd: number;
  budget_limit_usd: number;
  remaining_budget_usd: number;
  daily_budget_used_usd: number;
  daily_budget_reserved_usd: number;
  daily_budget_limit_usd: number;
  per_run_reserve_usd: number;
  analysis_credits_used: number;
  analysis_credits_reserved: number;
  analysis_credits_limit: number;
  remaining_analysis_credits: number;
  daily_analysis_credits_used: number;
  daily_analysis_credits_reserved: number;
  daily_analysis_credits_limit: number;
  per_run_analysis_credits: number;
  run_count: number;
  percent_used: number;
  alert_level: EntitlementAlertLevel;
  can_run: boolean;
  unlimited: boolean;
  resets_at: string;
}

export interface EntitlementStatus {
  status: EntitlementAccessStatus;
  plan: {
    key: EntitlementPlanKey;
    label: string;
    status_label: string;
    description: string;
  };
  usage: EntitlementUsage;
  features: EntitlementFeature[];
  upgrade: {
    label: string;
    href: string;
    enabled: boolean;
    title: string;
    message: string;
  };
}
