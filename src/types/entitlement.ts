export type EntitlementPlanKey = "beta";

export interface EntitlementFeature {
  key:
    | "evidence_research"
    | "evidence_path"
    | "share_links"
    | "html_export"
    | "company_compare"
    | "priority_queue";
  label: string;
  description: string;
  enabled: boolean;
}

export interface EntitlementUsage {
  period: "daily";
  period_label: string;
  questions_used: number;
  questions_limit: number;
  remaining_questions: number;
  cost_used_usd: number;
  cost_limit_usd: number;
  percent_used: number;
  resets_at: string;
}

export interface EntitlementStatus {
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
  };
}
