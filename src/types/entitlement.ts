export type EntitlementPlanKey =
  | "free"
  | "lite"
  | "standard"
  | "pro"
  | "beta"
  | "internal";

export type EntitlementAlertLevel = "ok" | "warning" | "blocked";
export type EntitlementAccessStatus = "standard" | "beta" | "admin";
export type EntitlementUsagePeriod = "daily" | "weekly" | "monthly";

export interface EntitlementFeature {
  key:
    | "evidence_research"
    | "evidence_path"
    | "share_links"
    | "markdown_answer"
    | "company_compare"
    | "priority_queue"
    | "company_search"
    | "guru_advisor"
    | "recent_chats"
    | "institutional_holdings"
    | "stock_discovery"
    | "wide_research"
    | "research_notebook";
  label: string;
  description: string;
  enabled: boolean;
  required_plan?: EntitlementPlanKey;
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
  credits_used_raw?: number;
  credits_reserved_raw?: number;
  credits_limit_raw?: number;
  credits_remaining_raw?: number;
  credits_used_display?: number;
  credits_reserved_display?: number;
  credits_limit_display?: number;
  credits_remaining_display?: number;
  credit_policy_version?: string;
  credit_enforcement_mode?: "shadow" | "soft_warning" | "enforced";
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
