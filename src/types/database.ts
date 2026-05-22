export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// Table row types - used as explicit generic params in supabase queries
export interface ChatSessionRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  title: string;
  claude_session_id: string | null;
  client_request_id: string | null;
  scope_type: "global" | "company";
  default_tickers: string[] | null;
  default_document_types: string[] | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow extends Record<string, unknown> {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "pending" | "streaming" | "completed" | "failed";
  request_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentRunRow extends Record<string, unknown> {
  id: string;
  session_id: string;
  user_message_id: string;
  assistant_message_id: string | null;
  request_id: string;
  claude_session_id: string | null;
  model: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  lease_expires_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  web_commit: string;
  krw_ontology_commit: string;
  ontology_release_id: string | null;
  index_generated_at: string | null;
  company_count: number | null;
  document_count: number | null;
  error_code: string | null;
  error_message: string | null;
  sdk_diagnostics: Json | null;
}

export interface ToolCallRow extends Record<string, unknown> {
  id: string;
  run_id: string;
  tool_use_id: string | null;
  tool_name: string;
  arguments_json: Json;
  result_summary: string | null;
  result_json: Json | null;
  result_text: string | null;
  started_at: string;
  finished_at: string | null;
  error_message: string | null;
}

export interface CitationRow extends Record<string, unknown> {
  id: string;
  message_id: string;
  run_id: string;
  object_id: string | null;
  ticker: string | null;
  document_type: string | null;
  period: string | null;
  section: string | null;
  quote_text: string | null;
  claim_text: string | null;
  evidence_grade: string | null;
  source_quality: string | null;
  trace_json: Json | null;
}

export interface UsageDailyRow extends Record<string, unknown> {
  user_id: string;
  date: string;
  question_count: number;
  estimated_cost_usd: number;
}

export interface UserEntitlementRow extends Record<string, unknown> {
  user_id: string;
  plan_key: "free" | "pro" | "power" | "beta" | "internal";
  status: "active" | "paused" | "cancelled";
  current_period_start: string;
  current_period_end: string;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UsageEventRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  request_id: string;
  run_id: string | null;
  usage_kind: "question";
  quantity: number;
  estimated_cost_usd: number;
  period_start: string;
  period_end: string;
  metadata: Json;
  occurred_at: string;
}

export interface UsagePeriodCounterRow extends Record<string, unknown> {
  user_id: string;
  period_start: string;
  period_end: string;
  question_count: number;
  estimated_cost_usd: number;
  updated_at: string;
}

export interface ConcurrencyLeaseRow extends Record<string, unknown> {
  id: string;
  run_id: string;
  acquired_at: string;
  expires_at: string;
  released_at: string | null;
}

export interface ResearchArtifactRow extends Record<string, unknown> {
  id: string;
  session_id: string;
  run_id: string;
  message_id: string;
  artifact_version: "krw-artifact/v1";
  artifact_type:
    | "company_overview"
    | "financial_snapshot"
    | "scenario_impact"
    | "market_report_impact"
    | "risk_review"
    | "filing_timeline"
    | "comparison"
    | "evidence_path";
  title: string;
  summary: string;
  tickers: string[] | null;
  source_scope: Json | null;
  answer_alignment: Json | null;
  artifact_json: Json | null;
  blocks_json: Json;
  evidence_refs: Json | null;
  quality_json: Json | null;
  source_json: Json | null;
  html_snapshot: string | null;
  created_at: string;
}

export interface RateLimitCounterRow extends Record<string, unknown> {
  key: string;
  bucket: string;
  window_start: string;
  count: number;
  created_at: string;
  updated_at: string;
}

export interface MessageShareRow extends Record<string, unknown> {
  id: string;
  token: string;
  owner_user_id: string;
  source_session_id: string;
  source_message_id: string;
  title: string;
  answer_content: string;
  answer_created_at: string;
  tickers: string[] | null;
  created_at: string;
  revoked_at: string | null;
}

export interface AnalyticsEventRow extends Record<string, unknown> {
  id: string;
  user_id: string | null;
  anonymous_id: string | null;
  event_name:
    | "page_viewed"
    | "cta_clicked"
    | "home_cta_clicked"
    | "signup_started"
    | "login_completed"
    | "company_selected"
    | "question_prefilled"
    | "starter_question_clicked"
    | "question_submitted"
    | "answer_completed"
    | "answer_failed"
    | "citation_opened"
    | "share_created"
    | "session_renamed"
    | "session_deleted"
    | "attachment_added"
    | "attachment_rejected"
    | "usage_warning_shown"
    | "usage_limit_reached"
    | "quota_warning_shown"
    | "quota_blocked"
    | "upgrade_clicked"
    | "subscription_started";
  properties: Json;
  path: string | null;
  referrer: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  session_id: string | null;
  message_id: string | null;
  run_id: string | null;
  created_at: string;
}

// Supabase Database type for createClient generic
export interface Database {
  public: {
    Tables: {
      chat_sessions: {
        Row: ChatSessionRow;
        Insert: Omit<
          ChatSessionRow,
          "id" | "created_at" | "updated_at" | "client_request_id" | "deleted_at"
        > & {
          id?: string;
          client_request_id?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<ChatSessionRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      messages: {
        Row: MessageRow;
        Insert: Omit<
          MessageRow,
          "id" | "created_at" | "updated_at" | "request_id"
        > & {
          id?: string;
          request_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<MessageRow, "id" | "created_at" | "updated_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      agent_runs: {
        Row: AgentRunRow;
        Insert: Pick<
          AgentRunRow,
          | "session_id"
          | "user_message_id"
          | "request_id"
          | "model"
          | "status"
          | "web_commit"
          | "krw_ontology_commit"
        > &
          Partial<
            Omit<
              AgentRunRow,
              | "session_id"
              | "user_message_id"
              | "request_id"
              | "model"
              | "status"
              | "web_commit"
              | "krw_ontology_commit"
            >
          > & {
          id?: string;
          started_at?: string;
        };
        Update: Partial<Omit<AgentRunRow, "id" | "started_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      tool_calls: {
        Row: ToolCallRow;
        Insert: Omit<ToolCallRow, "id"> & { id?: string };
        Update: Partial<Omit<ToolCallRow, "id">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      citations: {
        Row: CitationRow;
        Insert: Omit<CitationRow, "id" | "trace_json"> & {
          id?: string;
          trace_json?: Json | null;
        };
        Update: Partial<Omit<CitationRow, "id">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      usage_daily: {
        Row: UsageDailyRow;
        Insert: Omit<UsageDailyRow, "date"> & { date?: string };
        Update: Partial<UsageDailyRow>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_entitlements: {
        Row: UserEntitlementRow;
        Insert: Omit<UserEntitlementRow, "created_at" | "updated_at"> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<UserEntitlementRow, "user_id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      usage_events: {
        Row: UsageEventRow;
        Insert: Omit<UsageEventRow, "id" | "occurred_at" | "usage_kind" | "quantity" | "metadata"> & {
          id?: string;
          usage_kind?: "question";
          quantity?: number;
          metadata?: Json;
          occurred_at?: string;
        };
        Update: Partial<Omit<UsageEventRow, "id" | "user_id" | "request_id">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      usage_period_counters: {
        Row: UsagePeriodCounterRow;
        Insert: Omit<UsagePeriodCounterRow, "updated_at"> & {
          updated_at?: string;
        };
        Update: Partial<Omit<UsagePeriodCounterRow, "user_id" | "period_start" | "period_end">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      concurrency_leases: {
        Row: ConcurrencyLeaseRow;
        Insert: Omit<ConcurrencyLeaseRow, "id" | "acquired_at"> & {
          id?: string;
          acquired_at?: string;
        };
        Update: Partial<Omit<ConcurrencyLeaseRow, "id">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      research_artifacts: {
        Row: ResearchArtifactRow;
        Insert: Omit<ResearchArtifactRow, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<ResearchArtifactRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      message_shares: {
        Row: MessageShareRow;
        Insert: Omit<MessageShareRow, "id" | "created_at" | "revoked_at"> & {
          id?: string;
          created_at?: string;
          revoked_at?: string | null;
        };
        Update: Partial<Omit<MessageShareRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      rate_limit_counters: {
        Row: RateLimitCounterRow;
        Insert: Omit<
          RateLimitCounterRow,
          "created_at" | "updated_at" | "count"
        > & {
          count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<RateLimitCounterRow, "key" | "bucket" | "window_start">>;
        Relationships: [];
      };
      analytics_events: {
        Row: AnalyticsEventRow;
        Insert: Omit<AnalyticsEventRow, "id" | "created_at" | "properties"> & {
          id?: string;
          properties?: Json;
          created_at?: string;
        };
        Update: Partial<Omit<AnalyticsEventRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
    };
    Views: Record<string, never>;
    Functions: {
      increment_usage_daily: {
        Args: {
          p_user_id: string;
          p_date: string;
          p_cost: number;
        };
        Returns: undefined;
      };
      record_usage_event: {
        Args: {
          p_user_id: string;
          p_request_id: string;
          p_run_id: string | null;
          p_period_start: string;
          p_period_end: string;
          p_cost: number;
        };
        Returns: Array<{
          inserted: boolean;
          question_count: number;
          estimated_cost_usd: number;
        }>;
      };
      try_acquire_lease: {
        Args: {
          p_session_id: string;
          p_user_message_id: string;
          p_request_id: string;
          p_model: string;
          p_web_commit: string;
          p_krw_ontology_commit: string;
          p_expires_at: string;
          p_global_limit: number;
        };
        Returns: Array<{ id: string }>;
      };
      increment_rate_limit: {
        Args: {
          p_key: string;
          p_bucket: string;
          p_window_start: string;
          p_window_seconds: number;
          p_limit: number;
        };
        Returns: Array<{
          allowed: boolean;
          current_count: number;
          retry_after_seconds: number;
        }>;
      };
    };
    Enums: Record<string, string>;
    CompositeTypes: Record<string, never>;
  };
}
