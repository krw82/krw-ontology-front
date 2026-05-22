export type EntitlementPlanKey = "free" | "pro" | "power" | "beta" | "internal";

export type EntitlementAlertLevel = "ok" | "warning" | "blocked";

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
  period: "monthly";
  period_label: string;
  period_start: string;
  period_end: string;
  questions_used: number;
  questions_limit: number;
  remaining_questions: number;
  percent_used: number;
  alert_level: EntitlementAlertLevel;
  can_run: boolean;
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
    title: string;
    message: string;
  };
}
