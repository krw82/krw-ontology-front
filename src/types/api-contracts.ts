import type {
  ChatMessagePresentation,
  ChatMessageVisualization,
} from "@/lib/visualizations/contracts";

export type {
  ChatMessagePresentation,
  ChatMessageVisualization,
  KrwVisualizationArtifact,
  PresentationBlock,
  VisualizationIntent,
  VisualizationSeries,
  VisualizationToolResult,
  VisualizationView,
} from "@/lib/visualizations/contracts";

/**
 * API Contracts: KRW Ontology Web Chat
 *
 * This file defines ALL TypeScript interfaces for the web chat system.
 * Frontend and backend teams implement against these contracts.
 *
 * Conventions:
 * - All dates are ISO 8601 strings
 * - All IDs are UUID v4 strings
 * - Optional fields use `?` suffix
 * - Readonly fields are marked (set server-side only)
 */

// ============================================================
// Enums
// ============================================================

/** Agent run lifecycle states */
export type RunStatus =
  | "pending"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

/** Chat message role */
export type MessageRole = "user" | "assistant" | "system";

/** Chat message persistence state */
export type MessageStatus =
  "pending" | "streaming" | "completed" | "failed" | "cancelled";

/** Chat session scope */
export type SessionScopeType = "global" | "company";

/** Chat analysis mode */
export type AnalysisMode = "company" | "news";

/** Durable agent run intent */
export type RunKind =
  | "company_research"
  | "idea_generation"
  | "news_discovery"
  | "market_move_research"
  | "scenario_sensitivity"
  | "guru_advisor";

export type AgentRunExecutorType = "claude_agent";

/** SSE streaming event types */
export type StreamingEventType =
  | "run_queued"
  | "run_started"
  | "token"
  | "tool_call_start"
  | "tool_call_end"
  | "activity_update"
  | "citation"
  | "artifact"
  | "visualization"
  | "state_sync"
  | "done"
  | "error"
  | "cancelled";

/** Error codes returned by the API */
export type ErrorCode =
  | "auth_required"
  | "authentication_error"
  | "service_unavailable"
  | "not_found"
  | "forbidden"
  | "active_run_exists"
  | "no_active_run"
  | "quota_exceeded"
  | "cost_cap_exceeded"
  | "tool_budget_exceeded"
  | "concurrency_limit"
  | "lease_expired"
  | "cancelled"
  | "mcp_unavailable"
  | "worker_unavailable"
  | "mcp_error"
  | "claude_api_error"
  | "claude_rate_limited"
  | "rate_limited"
  | "coverage_limit_reached"
  | "judgment_revision_conflict"
  | "validation_error"
  | "internal_error";

const VALID_ERROR_CODES: ReadonlySet<string> = new Set<ErrorCode>([
  "auth_required",
  "authentication_error",
  "service_unavailable",
  "not_found",
  "forbidden",
  "active_run_exists",
  "no_active_run",
  "quota_exceeded",
  "cost_cap_exceeded",
  "tool_budget_exceeded",
  "concurrency_limit",
  "lease_expired",
  "cancelled",
  "mcp_unavailable",
  "worker_unavailable",
  "mcp_error",
  "claude_api_error",
  "claude_rate_limited",
  "rate_limited",
  "coverage_limit_reached",
  "judgment_revision_conflict",
  "validation_error",
  "internal_error",
]);

export function isValidErrorCode(code: string): code is ErrorCode {
  return VALID_ERROR_CODES.has(code);
}

export function toErrorCode(code: string): ErrorCode {
  return isValidErrorCode(code) ? code : "internal_error";
}

/** Citation evidence grades */
export type EvidenceGrade = "high" | "medium" | "low";

/** MCP source quality ratings */
export type SourceQuality = "filing_direct" | "derived" | "estimated";

/** Allowed KRW Ontology MCP tool names */
export type KRWOntologyMCPToolName =
  | "krw_ontology_catalog"
  | "krw_ontology_company_context"
  | "krw_ontology_index_context"
  | "krw_ontology_topic_map"
  | "krw_ontology_query"
  | "krw_ontology_query_context"
  | "krw_ontology_retrieve"
  | "krw_ontology_trace"
  | "krw_ontology_verify_evidence"
  | "krw_ontology_quality"
  | "krw_ontology_compare"
  | "krw_ontology_plan_query"
  | "krw_ontology_chain";

/** Allowed read-only stock-news MCP tool names */
export type StockNewsMCPToolName =
  | "route_news_question"
  | "resolve_news_entities"
  | "search_company_news_events"
  | "search_market_news_events"
  | "search_news_by_domain"
  | "read_news_sources"
  | "build_news_timeline"
  | "audit_news_sources";

/** Allowed Yahoo Finance MCP tool names */
export type YahooFinanceMCPToolName =
  "get_yahoo_finance_news" | "get_stock_info";

/** Local presentation MCP tool name. */
export type VisualizationMCPToolName = "compose_visualization";

/** On-demand SEC filing MCP tools. Document bodies are never persisted. */
export type KrwFilingsMCPToolName =
  | "get_filing"
  | "get_filing_brief"
  | "search_catalog_filings"
  | "list_filing_sections"
  | "read_filing_section"
  | "list_filing_documents"
  | "read_filing_document"
  | "get_form4_insider_transactions"
  | "get_coverage_state"
  | "list_filing_judgments"
  | "get_decision_timeline"
  | "list_open_questions";

/** Allowed Guru Advisor MCP tool names */
export type GuruMCPToolName =
  | "krw_guru_status"
  | "krw_guru_search"
  | "krw_guru_query_context"
  | "krw_guru_select_lenses"
  | "krw_guru_context"
  | "krw_guru_trace"
  | "krw_guru_chain"
  | "krw_guru_evidence"
  | "krw_guru_data_needs"
  | "krw_guru_eval_questions"
  | "krw_guru_company_brief"
  | "krw_guru_company_pack"
  | "krw_guru_review_company_evidence";

/** Allowed MCP tool names */
export type MCPToolName =
  | KRWOntologyMCPToolName
  | StockNewsMCPToolName
  | YahooFinanceMCPToolName
  | VisualizationMCPToolName
  | KrwFilingsMCPToolName
  | GuruMCPToolName;

/** Document types in the ontology */
export type DocumentType =
  | "business_report"
  | "audit_report"
  | "securities_report"
  | "quarterly_report"
  | "semi_annual_report"
  | "annual_report"
  | "registration_statement"
  | "current_report"
  | "other";

// ============================================================
// Session Types
// ============================================================

/** A chat session */
export interface Session {
  readonly id: string;
  user_id: string;
  title: string;
  scope_type: SessionScopeType;
  default_tickers: string[];
  default_document_types: string[];
  deleted_at?: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

/** Session summary for list views */
export interface SessionSummary {
  id: string;
  title: string;
  scope_type: SessionScopeType;
  default_tickers: string[];
  last_message_preview: string | null;
  last_message_at: string | null;
  latest_run_status: RunStatus | null;
  created_at: string;
  updated_at: string;
}

// ============================================================
// Personal Research Workspace Types
// ============================================================

export type UserCompanyQuestionStatus = "open" | "answered" | "dismissed";
export type UserCompanyQuestionSource =
  | "manual"
  | "generated_from_tearsheet"
  | "generated_from_thesis_check"
  | "saved_from_chat";
export type UserCompanyThesisStatus =
  "active" | "needs_review" | "weakened" | "mixed" | "archived";
export type UserCompanyCoverageLevel = "interest";
export type FilingJudgmentImpact =
  | "positive"
  | "neutral"
  | "negative"
  | "unclear";
export type FilingJudgmentNextAction =
  | "complete"
  | "update_thesis"
  | "create_question"
  | "review_later";
export type FilingMonitoringRuleType =
  | "filing_form"
  | "filing_item"
  | "keyword"
  | "scheduled_review";
export type FilingMonitoringRuleOperator =
  | "matches"
  | "contains"
  | "on_or_after";
export type UserThesisCheckResultStatus =
  "strengthened" | "weakened" | "mixed" | "insufficient" | "needs_review";
export type UserResearchNoteType =
  | "manual"
  | "chat_summary"
  | "thesis_check"
  | "filing_check"
  | "risk_memo"
  | "earnings_setup"
  | "earnings_review"
  | "tearsheet";

export interface UserCompanyMark {
  user_id: string;
  ticker: string;
  coverage_level: UserCompanyCoverageLevel | null;
  priority: number;
  interest_reason: string | null;
  tags: string[];
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserCompanyCoverageEvent {
  id: string;
  user_id: string;
  ticker: string;
  previous_coverage_level: UserCompanyCoverageLevel | null;
  coverage_level: UserCompanyCoverageLevel | null;
  changed: boolean;
  source: string;
  idempotency_key: string;
  created_at: string;
}

export interface UserFilingJudgmentSummary {
  id: string;
  filing_event_id: string;
  ticker: string;
  current_revision_id: string;
  revision_number: number;
  impact: FilingJudgmentImpact;
  next_action: FilingJudgmentNextAction;
  summary: string;
  updated_at: string;
}

export interface PulseLinkedThesis {
  id: string;
  title: string;
  status: UserCompanyThesisStatus;
}

export interface UserFilingJudgmentThesisLink extends PulseLinkedThesis {
  impact: FilingJudgmentImpact;
  position: number;
}

export interface UserCompanyMonitoringRule {
  id: string;
  user_id: string;
  ticker: string;
  rule_type: FilingMonitoringRuleType;
  operator: FilingMonitoringRuleOperator;
  value: string | null;
  next_review_at: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserFilingJudgment extends UserFilingJudgmentSummary {
  rationale: string;
  thesis_links: UserFilingJudgmentThesisLink[];
  monitoring_rules: UserCompanyMonitoringRule[];
  created_at: string;
  revision_created_at: string;
}

export type CompanyCoverageTimelineItem =
  | {
      type: "coverage_change";
      id: string;
      occurred_at: string;
      previous_coverage_level: UserCompanyCoverageLevel | null;
      coverage_level: UserCompanyCoverageLevel | null;
      changed: boolean;
      source: string;
    }
  | {
      type: "filing_judgment";
      id: string;
      occurred_at: string;
      filing_event_id: string;
      revision_number: number;
      impact: FilingJudgmentImpact;
      next_action: FilingJudgmentNextAction;
      summary: string;
    };

export interface CompanyCoverageTimelineResponse {
  ticker: string;
  items: CompanyCoverageTimelineItem[];
  next_cursor: string | null;
}

export interface UserCompanyQuestion {
  id: string;
  user_id: string;
  ticker: string;
  question: string;
  status: UserCompanyQuestionStatus;
  source: UserCompanyQuestionSource;
  source_chat_session_id: string | null;
  source_message_id: string | null;
  answered_at: string | null;
  visible_after_at: string;
  created_at: string;
  updated_at: string;
}

export interface UserCompanyCard {
  id: string;
  user_id: string;
  ticker: string;
  title: string;
  summary: string | null;
  content_md: string;
  basis_release_id: string | null;
  basis_period: string | null;
  basis_document_type: string | null;
  source_chat_session_id: string | null;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserCompanyNotebook {
  id: string | null;
  user_id: string;
  ticker: string;
  title: string;
  content_md: string;
  previous_content_md: string | null;
  basis_release_id: string | null;
  basis_period: string | null;
  last_source_chat_session_id: string | null;
  last_source_message_id: string | null;
  created_at: string | null;
  updated_at: string | null;
}

export type UserCompanyNotebookRefreshJobStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface UserCompanyNotebookRefreshJob {
  id: string;
  user_id: string;
  ticker: string;
  status: UserCompanyNotebookRefreshJobStatus;
  notebook_id: string | null;
  recent_conversation_count: number;
  saved_question_count: number;
  last_source_chat_session_id: string | null;
  last_source_message_id: string | null;
  error_code: string | null;
  error_message: string | null;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserCompanyThesis {
  id: string;
  user_id: string;
  ticker: string;
  title: string;
  thesis_text: string;
  monitored_variables: string[];
  counter_evidence: string;
  decision_change_condition: string;
  status: UserCompanyThesisStatus;
  tags: string[];
  archived_at: string | null;
  source_chat_session_id: string | null;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserThesisCheck {
  id: string;
  thesis_id: string;
  user_id: string;
  ticker: string;
  result_status: UserThesisCheckResultStatus;
  summary: string;
  strengthening_points: string[];
  weakening_points: string[];
  neutral_points: string[];
  next_questions: string[];
  basis_release_id: string | null;
  basis_period: string | null;
  source_chat_session_id: string | null;
  source_message_id: string | null;
  created_at: string;
}

export interface UserResearchNote {
  id: string;
  user_id: string;
  ticker: string;
  title: string;
  body: string;
  note_type: UserResearchNoteType;
  tags: string[];
  source_chat_session_id: string | null;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
}

export type ResearchStatus = "ready" | "empty" | "has_open_questions" | "stale";

export type ResearchInboxReason =
  "empty_notebook" | "open_questions" | "stale_notebook";

export interface ResearchInboxItem {
  ticker: string;
  company_name: string;
  status: ResearchStatus;
  status_label: string;
  reason: ResearchInboxReason;
  title: string;
  description: string;
  current_question_id: string | null;
  current_question: string | null;
  dismiss_question_id: string | null;
  action_label: string;
  action_href: string;
  secondary_action_label: string | null;
  secondary_action_href: string | null;
  priority: number;
  age_days: number | null;
  open_question_count: number;
}

export interface WatchlistCompanySummary {
  ticker: string;
  name: string;
  companyNameKo?: string;
  sector: string | null;
  description: string;
  latest_period: string | null;
  coverage: string;
  document_count: number;
  document_types: string[];
  notebook_preview: string;
  mark: UserCompanyMark;
  open_question_count: number;
  note_count: number;
  recent_chat_count: number;
  latest_activity_at: string | null;
  research_status: ResearchStatus;
  research_status_label: string;
  research_status_reason: ResearchInboxReason | null;
  notebook_updated_at: string | null;
  notebook_age_days: number | null;
}

export interface WatchlistOverviewResponse {
  companies: WatchlistCompanySummary[];
  research_inbox: ResearchInboxItem[];
  stats: {
    total: number;
    interest: number;
    open_questions: number;
    notes: number;
    recent_activity: number;
  };
}

export interface WatchlistCompanyDetailResponse {
  company: WatchlistCompanySummary;
  notebook: UserCompanyNotebook;
  questions: UserCompanyQuestion[];
  card: UserCompanyCard | null;
  theses: UserCompanyThesis[];
  thesis_checks: UserThesisCheck[];
  monitoring_rules: UserCompanyMonitoringRule[];
  notes: UserResearchNote[];
  recent_sessions: SessionSummary[];
}

// ============================================================
// Message Types
// ============================================================

/** A chat message */
export interface Message {
  readonly id: string;
  session_id: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  metadata?: Record<string, unknown> | null;
  readonly created_at: string;
  readonly updated_at?: string;
}

// ============================================================
// Agent Run Types
// ============================================================

/** Full agent run record (stored in DB) */
export interface AgentRun {
  readonly id: string;
  session_id: string;
  user_message_id: string;
  assistant_message_id: string | null;
  request_id: string;
  model: string;
  status: RunStatus;
  lease_expires_at: string | null;
  readonly started_at: string;
  finished_at: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  web_commit: string;
  krw_ontology_commit: string;
  ontology_env: "dev" | "staging" | "prod";
  worker_env?: "dev" | "staging" | "prod" | null;
  ontology_release_id: string | null;
  index_generated_at: string | null;
  company_count: number | null;
  document_count: number | null;
  object_count: number | null;
  ontology_root?: string | null;
  index_path?: string | null;
  manifest_path?: string | null;
  manifest_valid?: boolean | null;
  agent_index_schema_version?: string | null;
  ontology_manifest?: Record<string, unknown> | null;
  error_code: ErrorCode | null;
  error_message: string | null;
  sdk_diagnostics: Record<string, unknown> | null;
  run_kind: RunKind;
  executor_type?: AgentRunExecutorType;
  selected_news_event_context?: Record<string, unknown> | null;
  source_artifact_id?: string | null;
  source_event_id?: string | null;
}

/** Agent run summary (returned in session fetch) */
export interface AgentRunSummary {
  id: string;
  status: RunStatus;
  model: string;
  assistant_message_id: string | null;
  queued_at?: string | null;
  started_at: string;
  finished_at: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  ontology_env?: "dev" | "staging" | "prod";
  worker_env?: "dev" | "staging" | "prod" | null;
  ontology_release_id: string | null;
  index_generated_at: string | null;
  company_count?: number | null;
  document_count?: number | null;
  object_count?: number | null;
  manifest_valid?: boolean | null;
  agent_index_schema_version?: string | null;
  error_code: ErrorCode | null;
  error_message?: string | null;
  run_kind?: RunKind;
  source_artifact_id?: string | null;
  source_event_id?: string | null;
}

// ============================================================
// MCP Tool Call Types
// ============================================================

/** A single MCP tool call within an agent run */
export interface ToolCall {
  readonly id: string;
  run_id: string;
  tool_use_id: string | null;
  tool_name: MCPToolName;
  arguments_json:
    Record<string, unknown> | unknown[] | string | number | boolean | null;
  result_summary: string | null;
  result_json: Record<string, unknown> | unknown[] | null;
  result_text: string | null;
  readonly started_at: string;
  finished_at: string | null;
  error_message: string | null;
}

/** Tool call as sent during streaming (partial) */
export interface StreamingToolCallStart {
  tool_call_id: string;
  tool_name: MCPToolName;
  arguments: Record<string, unknown>;
  started_at?: string;
}

/** Tool call completion during streaming */
export interface StreamingToolCallEnd {
  tool_call_id: string;
  result_summary: string | null;
  error_message: string | null;
  duration_ms: number;
}

export type ResearchActivityStage =
  | "preparing"
  | "queued"
  | "routing"
  | "connecting"
  | "researching"
  | "checking_evidence"
  | "composing"
  | "complete";

export interface ResearchActivityUpdate {
  stage: ResearchActivityStage;
  label: string;
  queue?: QueueStatus | null;
  routing?: {
    mode?: string;
    source?: string;
    confidence?: string;
    original_analysis_mode?: string;
    original_run_kind?: string;
    analysis_mode?: string;
    run_kind?: string;
    executor_type?: string;
    reason?: string;
    note?: string | null;
    has_selected_news_event_context?: boolean;
  };
}

export interface QueueStatus {
  queued_ahead: number;
  running_count: number;
  concurrency_limit: number;
  queued_at: string | null;
}

// ============================================================
// Citation Types
// ============================================================

/** A citation linking an answer to filing evidence */
export interface Citation {
  readonly id: string;
  message_id: string;
  run_id: string;
  object_id: string | null;
  ticker: string | null;
  document_type: DocumentType | null;
  period: string | null;
  section: string | null;
  quote_text: string | null;
  claim_text: string | null;
  evidence_grade: EvidenceGrade | null;
  source_quality: SourceQuality | null;
  trace_json: Record<string, unknown> | null;
}

/** Citation metadata sent during streaming */
export interface StreamingCitation {
  object_id: string | null;
  ticker: string | null;
  document_type: DocumentType | null;
  period: string | null;
  section: string | null;
  quote_text: string | null;
  claim_text: string | null;
  evidence_grade: EvidenceGrade | null;
  source_quality: SourceQuality | null;
  trace_json: Record<string, unknown> | null;
}

export type ChatCitation = StreamingCitation &
  Partial<Pick<Citation, "id" | "message_id" | "run_id">>;

export type ResearchArtifactType =
  | "company_overview"
  | "financial_snapshot"
  | "scenario_impact"
  | "market_report_impact"
  | "risk_review"
  | "filing_timeline"
  | "comparison"
  | "evidence_path";

export type ResearchArtifactVersion = "krw-artifact/v1";

export type ArtifactConfidence =
  "direct" | "indirect" | "inferred" | "unsupported";

export type ArtifactEvidenceGrade =
  "direct" | "indirect" | "derived" | "unsupported";

export interface ResearchArtifactSourceScope {
  document_types?: string[];
  periods?: string[];
  source_label?: string;
  external_sources?: string[];
}

export interface ResearchArtifactAnswerAlignment {
  visible_answer_summary: string;
  no_new_thesis: boolean;
}

export interface ResearchArtifactQuality {
  overall: "high" | "medium" | "low";
  warnings: string[];
}

export interface ResearchArtifactEvidenceRef {
  id: string;
  source_label: string;
  object_type?: string;
  evidence_grade: ArtifactEvidenceGrade;
  trace_id?: string | null;
  quote_text?: string | null;
  chain_summary?: Record<string, unknown> | null;
}

export type AnswerBlock =
  | {
      type: "markdown";
      content: string;
      evidence_refs?: string[];
    }
  | {
      type: "metric_grid";
      title: string;
      evidence_refs?: string[];
      metrics: Array<{
        label: string;
        value: string;
        period?: string;
        unit?: string;
        delta?: string;
        source_label?: string;
        evidence_refs?: string[];
      }>;
    }
  | {
      type: "period_delta";
      title: string;
      evidence_refs?: string[];
      changes: Array<{
        label: string;
        from: string;
        to: string;
        direction?: "up" | "down" | "flat" | "mixed" | "unknown";
        interpretation: string;
        evidence_refs?: string[];
      }>;
    }
  | {
      type: "business_segments";
      title: string;
      evidence_refs?: string[];
      segments: Array<{
        name: string;
        role: string;
        why_it_matters: string;
        evidence_refs?: string[];
      }>;
    }
  | {
      type: "premise_card";
      title: string;
      evidence_refs?: string[];
      source_kind?:
        "filing" | "external_report" | "user_provided" | "web" | "mixed";
      premises: Array<{
        label: string;
        text: string;
        source_label?: string;
        evidence_refs?: string[];
      }>;
    }
  | {
      type: "impact_channels";
      title: string;
      evidence_refs?: string[];
      channels: Array<{
        name: string;
        direction: "positive" | "negative" | "mixed" | "uncertain" | "neutral";
        mechanism: string;
        affected_metrics?: string[];
        confidence: ArtifactConfidence;
        evidence_refs?: string[];
      }>;
    }
  | {
      type: "risk_driver_map";
      title: string;
      evidence_refs?: string[];
      items: Array<{
        label: string;
        kind: "risk" | "driver" | "headwind" | "offset" | "watch_item";
        text: string;
        severity: "high" | "medium" | "low" | "unknown";
        evidence_refs?: string[];
      }>;
    }
  | {
      type: "timeline";
      title: string;
      evidence_refs?: string[];
      events: Array<{
        label: string;
        date_or_period: string;
        text: string;
        status?:
          | "reported"
          | "targeted"
          | "expected"
          | "completed"
          | "delayed"
          | "unknown";
        evidence_refs?: string[];
      }>;
    }
  | {
      type: "comparison_table";
      title: string;
      evidence_refs?: string[];
      columns: string[];
      rows: Array<{
        label: string;
        values: string[];
        winner?: string | null;
        note?: string;
        evidence_refs?: string[];
      }>;
    }
  | {
      type: "evidence_chain";
      title: string;
      evidence_refs?: string[];
      chains: Array<{
        claim: string;
        source_label: string;
        confidence: ArtifactConfidence;
        chain_steps?: string[];
        quality_warnings?: string[];
        evidence_refs?: string[];
      }>;
    }
  | {
      type: "caveat_list";
      title: string;
      evidence_refs?: string[];
      items: Array<{
        text: string;
        severity: "info" | "warning" | "critical";
        evidence_refs?: string[];
      }>;
    }
  | {
      type: "glossary";
      title: string;
      evidence_refs?: string[];
      terms: Array<{
        term: string;
        definition: string;
      }>;
    };

export type ResearchArtifactBlock = AnswerBlock;

export interface RichAnswer {
  answer_blocks: AnswerBlock[];
  evidence_refs?: ResearchArtifactEvidenceRef[];
  quality: ResearchArtifactQuality;
}

export type CanonicalAnswerUnitType =
  | "heading"
  | "paragraph"
  | "metric"
  | "period_delta"
  | "business_segment"
  | "premise"
  | "impact_channel"
  | "risk_item"
  | "driver_item"
  | "headwind_item"
  | "watch_item"
  | "timeline_event"
  | "comparison_row"
  | "caveat"
  | "glossary_term"
  | "evidence_note";

export interface CanonicalAnswerUnit extends Record<string, unknown> {
  id: string;
  type: CanonicalAnswerUnitType;
  importance?: "required" | "supporting" | "optional";
  confidence?: ArtifactConfidence;
  display_policy?: "show" | "hidden_by_default";
  evidence_refs?: string[];
}

export interface ResearchSynthesis {
  synthesis_version: "krw-research-synthesis/v1";
  question?: string;
  scope?: Record<string, unknown>;
  thesis?: string;
  canonical_answer: {
    language?: string;
    default_order: string[];
    units: CanonicalAnswerUnit[];
  };
  research_facts?: Record<string, unknown>;
  display_guidance?: Record<string, unknown>;
  evidence_refs?: ResearchArtifactEvidenceRef[];
  quality: ResearchArtifactQuality;
}

export interface DisplayPlanBlock {
  block_id: string;
  block_type: AnswerBlock["type"];
  source_ids: string[];
  title?: string | null;
  options?: Record<string, unknown>;
}

export interface DisplayPlanOutput {
  display_plan_version: "krw-display-plan/v1";
  source_synthesis_version: string;
  display_plan: DisplayPlanBlock[];
  quality: ResearchArtifactQuality;
}

export interface ResearchArtifactEnvelope {
  artifact_version: ResearchArtifactVersion;
  artifact_type: ResearchArtifactType;
  title: string;
  summary: string;
  tickers?: string[];
  source_scope?: ResearchArtifactSourceScope;
  answer_alignment?: ResearchArtifactAnswerAlignment;
  blocks: ResearchArtifactBlock[];
  evidence_refs?: ResearchArtifactEvidenceRef[];
  quality: ResearchArtifactQuality;
}

export type ResearchAgentOutput = RichAnswer;

export interface ResearchArtifact extends ResearchArtifactEnvelope {
  readonly id: string;
  session_id: string;
  run_id: string;
  message_id: string;
  artifact_json: ResearchArtifactEnvelope | null;
  blocks_json: ResearchArtifactBlock[];
  quality_json: ResearchArtifactQuality | null;
  source_json: Record<string, unknown> | null;
  html_snapshot: string | null;
  readonly created_at: string;
}

export type ChatArtifactType =
  "news_event_selection" | "verified_source_summary";

export interface SourcePreview {
  title?: string;
  title_original?: string;
  title_ko?: string;
  url?: string;
  domain?: string;
  publisher?: string | null;
  published_at?: string | null;
  summary_ko?: string;
  source_kind?: string;
  snippet_summary?: string;
  source_role?: string;
  verification_status?: string;
  [key: string]: unknown;
}

export interface AtomicNewsEventCard {
  id: string;
  ticker?: string;
  company_name?: string;
  event_title: string;
  event_title_ko?: string;
  original_headline?: string;
  primary_source?: SourcePreview;
  event_type?: string;
  event_date?: string | null;
  source_date?: string | null;
  status?: string;
  short_summary?: string;
  summary_ko?: string;
  price_impact_direction?: "negative" | "positive" | "mixed" | "unclear";
  source_summary?: {
    publishers_ko?: string[];
    source_count?: number;
    latest_published_at?: string | null;
    display_time_ko?: string;
  };
  key_facts?: Array<Record<string, unknown>>;
  actors?: Record<string, unknown>;
  instrument?: Record<string, unknown>;
  investment_axes?: string[];
  ontology_baseline_questions?: string[];
  source_previews?: SourcePreview[];
  reader_urls?: string[];
  official_source_urls?: string[];
  major_news_urls?: string[];
  materiality_score?: number;
  specificity_score?: number;
  confidence?: string;
  ontology_bridge_brief?: string;
  ontology_bridge_brief_en?: {
    ticker?: string;
    company_name?: string;
    event?: string;
    likely_financial_axes?: string[];
    likely_business_axes?: string[];
    suggested_ontology_questions?: string[];
    source_urls?: string[];
  };
  source_pack?: {
    version: "news-source-pack/v1";
    selected_event_id: string;
    read_at: string;
    source_urls: string[];
    source_previews: SourcePreview[];
    reads: Array<{
      url: string;
      ok: boolean;
      title?: string;
      text?: string;
      published_at?: string | null;
      error?: string;
      truncated?: boolean;
      [key: string]: unknown;
    }>;
    original_text_for_ontology: string;
    ontology_search_brief_en: string;
    source_read_status: "read" | "partial" | "fallback";
    claims_ko: string[];
  };
  ui?: {
    button_label_ko?: string;
    badge_ko?: string;
    confidence_label_ko?: string;
  };
  ranking?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface NewsEventSelectionArtifactPayload {
  kind: "news_event_selection";
  version: 1;
  original_question: string;
  resolved_entities?: Array<Record<string, unknown>>;
  lookback?: Record<string, unknown>;
  discovery_policy?: Record<string, unknown>;
  events: AtomicNewsEventCard[];
  cards?: AtomicNewsEventCard[];
  discovery_summary?: Record<string, unknown>;
  empty_state?: Record<string, unknown>;
  raw_result?: Record<string, unknown> | unknown[] | null;
}

export interface ChatArtifact {
  readonly id: string;
  session_id: string;
  message_id: string;
  run_id: string;
  type: ChatArtifactType;
  payload_json: NewsEventSelectionArtifactPayload | Record<string, unknown>;
  readonly created_at: string;
}

export interface ChatArtifactSelection {
  readonly id: string;
  artifact_id: string;
  session_id?: string;
  event_id: string;
  user_id?: string;
  selected_payload_json: Record<string, unknown>;
  user_message_id: string | null;
  research_run_id: string | null;
  status?: RunStatus;
  updated_at?: string;
  readonly created_at: string;
}

// ============================================================
// Release Metadata Types
// ============================================================

/** Ontology release metadata */
export interface OntologyRelease {
  readonly id: string;
  env?: "dev" | "staging" | "prod";
  release_path: string;
  krw_ontology_commit: string;
  index_generated_at: string;
  company_count: number;
  document_count: number;
  object_count?: number;
  manifest_path?: string;
  manifest_valid?: boolean;
  agent_index_schema_version?: string;
  readonly created_at: string;
}

/** Release metadata embedded in run completion events */
export interface ReleaseMetadata {
  ontology_release_id: string;
  ontology_env?: "dev" | "staging" | "prod";
  index_generated_at: string;
  company_count: number;
  document_count: number;
  object_count?: number;
  manifest_valid?: boolean;
  agent_index_schema_version?: string;
  krw_ontology_commit: string;
  web_commit: string;
}

// ============================================================
// Usage / Execution Budget Types
// ============================================================

/** Daily usage tracking record */
export interface UsageDaily {
  user_id: string;
  date: string; // YYYY-MM-DD
  question_count: number;
  estimated_cost_usd: number;
}

/** Current execution budget status (returned alongside responses) */
export interface ExecutionBudgetStatus {
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
  can_run: boolean;
}

// ============================================================
// Streaming Event Types
// ============================================================

/** Base shape for all SSE events */
export interface StreamingEventBase {
  event: StreamingEventType;
}

/** Text token chunk */
export interface StreamingTokenEvent extends StreamingEventBase {
  event: "token";
  data: {
    text: string;
  };
}

/** Run accepted and assistant message placeholder created */
export interface StreamingRunQueuedEvent extends StreamingEventBase {
  event: "run_queued";
  data: {
    run_id: string;
    message_id: string;
    session_id: string;
    request_id?: string;
    queued_at?: string;
    research_mode?: string;
    analysis_mode?: AnalysisMode;
    run_kind?: RunKind;
    executor_type?: AgentRunExecutorType;
    queue?: QueueStatus | null;
  };
}

/** Worker claimed the run and started execution */
export interface StreamingRunStartedEvent extends StreamingEventBase {
  event: "run_started";
  data: {
    run_id: string;
    message_id: string;
    session_id: string;
    request_id?: string;
    started_at?: string;
  };
}

/** Tool call started */
export interface StreamingToolCallStartEvent extends StreamingEventBase {
  event: "tool_call_start";
  data: StreamingToolCallStart;
}

/** Tool call ended */
export interface StreamingToolCallEndEvent extends StreamingEventBase {
  event: "tool_call_end";
  data: StreamingToolCallEnd;
}

/** User-facing research activity update */
export interface StreamingActivityUpdateEvent extends StreamingEventBase {
  event: "activity_update";
  data: ResearchActivityUpdate;
}

/** Citation extracted during response */
export interface StreamingCitationEvent extends StreamingEventBase {
  event: "citation";
  data: StreamingCitation;
}

export interface StreamingArtifactEvent extends StreamingEventBase {
  event: "artifact";
  data: ChatArtifact;
}

export interface StreamingVisualizationEvent extends StreamingEventBase {
  event: "visualization";
  data: ChatMessageVisualization;
}

/** Server-side session state reconciliation after reconnect races */
export interface StreamingStateSyncEvent extends StreamingEventBase {
  event: "state_sync";
  data: {
    session_id: string;
    run_id?: string | null;
    status: RunStatus | "idle";
    reason?: "stale_run" | "poll_timeout" | "session_synced";
    queue?: QueueStatus | null;
  };
}

/** Run completed successfully */
export interface StreamingDoneEvent extends StreamingEventBase {
  event: "done";
  data: {
    run_id: string;
    message_id: string;
    content?: string;
    rich_answers?: ResearchArtifact[];
    artifacts?: ResearchArtifact[];
    chat_artifacts?: ChatArtifact[];
    visualizations?: ChatMessageVisualization[];
    presentation?: ChatMessagePresentation | null;
    release: ReleaseMetadata;
    usage: {
      input_tokens: number;
      output_tokens: number;
      estimated_cost_usd: number;
      latency_ms: number;
    };
    execution_budget: ExecutionBudgetStatus;
  };
}

/** Run failed */
export interface StreamingErrorEvent extends StreamingEventBase {
  event: "error";
  data: {
    run_id: string;
    error_code: ErrorCode;
    error_message: string;
  };
}

/** Run was cancelled */
export interface StreamingCancelledEvent extends StreamingEventBase {
  event: "cancelled";
  data: {
    run_id: string;
    message_id: string | null;
  };
}

/** Union of all streaming events */
export type StreamingEvent =
  | StreamingRunQueuedEvent
  | StreamingRunStartedEvent
  | StreamingTokenEvent
  | StreamingToolCallStartEvent
  | StreamingToolCallEndEvent
  | StreamingActivityUpdateEvent
  | StreamingCitationEvent
  | StreamingArtifactEvent
  | StreamingVisualizationEvent
  | StreamingStateSyncEvent
  | StreamingDoneEvent
  | StreamingErrorEvent
  | StreamingCancelledEvent;

// ============================================================
// API Request Types
// ============================================================

/** POST /api/chat/run request body */
export interface ChatRunRequest {
  session_id?: string;
  content: string; // 1-20000 chars, or 120000 when text attachments are included
  request_id: string; // client-generated UUID
  research_mode?: "fast" | "standard" | "deep";
  analysis_mode?: AnalysisMode;
  run_kind?: RunKind;
  guru_lens?: string;
  user_url?: string;
  user_urls?: string[];
  attachment_ids?: string[];
  scope_type?: SessionScopeType;
  default_tickers?: string[];
  default_document_types?: string[];
}

/** POST /api/chat/news-event-selection request body */
export interface NewsEventSelectionRequest {
  session_id: string;
  artifact_id: string;
  event_id: string;
  request_id: string;
  research_mode?: "fast" | "standard" | "deep";
}

/** POST /api/chat/[sessionId]/cancel - no request body */

/** GET /api/sessions query parameters */
export interface SessionsListParams {
  page?: number; // default 1
  limit?: number; // default 20, max 50
}

/** POST /api/sessions request body */
export interface CreateSessionRequest {
  title?: string; // auto-generated if omitted
  scope_type: SessionScopeType;
  default_tickers?: string[]; // required when scope_type is "company"
  default_document_types?: string[];
  /** Runtime-owned pointer to the Pulse filing card that opened this chat. */
  source_filing_event_id?: string;
}

/** PATCH /api/sessions/[sessionId] request body */
export interface UpdateSessionRequest {
  title: string;
}

// ============================================================
// API Response Types
// ============================================================

/** Standard error response */
export interface ErrorResponse {
  error: {
    code: ErrorCode;
    message: string;
    detail?: string;
  };
  request_id?: string;
}

/** POST /api/chat/run response is SSE stream (not JSON) */

/** POST /api/chat/[sessionId]/cancel response */
export interface CancelRunResponse {
  success: true;
  run_id: string;
}

/** GET /api/chat/[sessionId] response */
export interface GetChatSessionResponse {
  session: Session;
  messages: Message[];
  runs: AgentRunSummary[];
  message_pagination?: {
    limit: number;
    has_more: boolean;
    before: string | null;
    next_before: string | null;
  };
  citations?: Citation[];
  tool_calls?: ToolCall[];
  chat_artifacts?: ChatArtifact[];
  visualizations?: ChatMessageVisualization[];
  presentations?: ChatMessagePresentation[];
  artifact_selections?: ChatArtifactSelection[];
  rich_answers?: ResearchArtifact[];
  research_artifacts?: ResearchArtifact[];
}

/** GET /api/chat/[sessionId]/evidence response */
export interface GetChatEvidenceResponse {
  message_id: string;
  run_ids: string[];
  citations: Citation[];
  tool_calls: ToolCall[];
}

/** GET /api/sessions response */
export interface ListSessionsResponse {
  sessions: SessionSummary[];
  total: number;
  page: number;
  limit: number;
}

/** POST /api/sessions response */
export interface CreateSessionResponse {
  session: Session;
}

/** PATCH /api/sessions/[sessionId] response */
export interface UpdateSessionResponse {
  session: Pick<SessionSummary, "id" | "title" | "updated_at">;
}

/** DELETE /api/sessions/[sessionId] response */
export interface DeleteSessionResponse {
  success: true;
  session_id: string;
  deleted_at: string;
}

/** GET /healthz response */
export interface HealthzResponse {
  status: "ok";
  timestamp: string;
}

/** GET /internal/mcp-health response */
export interface McpHealthResponse {
  mcp_connected: boolean;
  ontology_env: "dev" | "staging" | "prod" | null;
  ontology_release_id: string | null;
  manifest_path: string | null;
  manifest_valid: boolean;
  agent_index_schema_version: string | null;
  index_generated_at: string | null;
  company_count: number | null;
  document_count: number | null;
  object_count: number | null;
  index_path: string | null;
  krw_ontology_commit: string;
  worker_id?: string;
  worker_status?: "idle" | "running" | "stopped" | "unhealthy";
  worker_last_seen_at?: string;
  catalog_release_id?: string;
  error?: string;
}

// ============================================================
// MCP Service Types (for internal use)
// ============================================================

/** MCP health endpoint response shape */
export interface McpServiceHealth {
  status: "ok" | "error";
  env?: "dev" | "staging" | "prod";
  release_id: string;
  manifest_valid?: boolean;
  index_generated_at: string;
  company_count: number;
  document_count: number;
  object_count?: number;
  package_version: string;
}

/** MCP tool response envelope (generic) */
export interface McpToolResponse<T = unknown> {
  success: boolean;
  data: T;
  error?: string;
  request_id?: string;
}

/** MCP catalog tool response data */
export interface McpCatalogData {
  companies: Array<{
    ticker: string;
    name: string;
    latest_period: string | null;
    coverage: string | null;
  }>;
  release_id: string;
  total_companies: number;
}

/** MCP query tool response data */
export interface McpQueryData {
  results: Array<{
    object_id: string;
    ticker: string;
    document_type: string;
    period: string;
    relevance_score: number;
    snippet: string;
  }>;
  total_results: number;
  query: string;
}

/** MCP retrieve tool response data */
export interface McpRetrieveData {
  object_id: string;
  ticker: string;
  document_type: string;
  period: string;
  section: string;
  content: string;
  metadata: Record<string, unknown>;
}

/** MCP trace tool response data */
export interface McpTraceData {
  object_id: string;
  trace: Record<string, unknown>;
  source_file: string;
  lineage: Array<{
    step: string;
    timestamp: string;
    detail: string;
  }>;
}

/** MCP quality tool response data */
export interface McpQualityData {
  object_id: string;
  quality_score: number;
  completeness: number;
  freshness: number;
  issues: Array<{
    type: string;
    description: string;
    severity: "warning" | "error";
  }>;
}

/** MCP compare tool response data */
export interface McpCompareData {
  objects: Array<{
    object_id: string;
    ticker: string;
    period: string;
    metric: string;
    value: number | string;
  }>;
  comparison_summary: string;
}

/** MCP plan_query tool response data */
export interface McpPlanQueryData {
  planned_steps: Array<{
    step: number;
    tool: MCPToolName;
    arguments: Record<string, unknown>;
    purpose: string;
  }>;
  estimated_results: number;
  suggested_refinements: string[];
}

// ============================================================
// Docker Compose Types (for deployment reference)
// ============================================================

/** Environment variables required by web container */
export interface WebContainerEnv {
  ANTHROPIC_API_KEY: string;
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  TOSS_PAYMENTS_CLIENT_KEY?: string;
  TOSS_PAYMENTS_SECRET_KEY?: string;
  BILLING_CRON_SECRET?: string;
  BILLING_WORKER_ID?: string;
  BILLING_WORKER_RECONCILE_INTERVAL_MS?: string;
  BILLING_MUTATIONS_PER_USER_PER_MINUTE?: string;
  ANALYSIS_CREDIT_ENFORCEMENT_MODE?: "shadow" | "soft_warning" | "enforced";
  KRW_ONTOLOGY_PLUGIN_PATH: string;
  KRW_CHAT_ROUTER_MODE?: "claude" | "1" | "true";
  WEB_COMMIT: string;
  KRW_ONTOLOGY_COMMIT: string;
  GLOBAL_CONCURRENT_RUN_LIMIT: string; // "5"
  CLAUDE_MODEL: string; // "sonnet"
  CLAUDE_AGENT_MAX_TURNS: string; // "40"
  AGENT_MAX_TOOL_CALLS: string; // "18"
  AGENT_MAX_TOOL_RESULT_CHARS: string; // "100000"
  RESEARCH_ANSWER_ENVELOPE_ENABLED?: "0" | "1" | "true" | "false";
  LEASE_TIMEOUT_MINUTES: string; // "10"
}

/** Environment variables required by optional standalone MCP container */
export interface McpContainerEnv {
  KRW_ONTOLOGY_ROOT: string; // "/data"
}

// ============================================================
// Research Pulse Feed
// ============================================================

export type PulseItemKind =
  | "filing"
  | "analysis"
  | "checkup"
  | "question"
  | "resurface"
  | "learning";

export type PulseFilter = "all" | PulseItemKind;

export type PulseTrigger = "event" | "schedule" | "state" | "editorial";

export type PulseItemPriority = "urgent" | "high" | "normal" | "low";

export type PulseItemState = "new" | "seen" | "reviewed";

export type PulseAnalysisPhase = "active" | "completed" | "failed";

export type PulseMutationAction =
  | "review"
  | "unreview"
  | "save"
  | "unsave"
  | "snooze"
  | "dismiss";

export interface PulseLinkAction {
  type: "link";
  label: string;
  href: string;
  analytics_name?: string;
}

export interface PulseMutationItemAction {
  type: "mutation";
  label: string;
  action: PulseMutationAction;
  analytics_name?: string;
}

export type PulseItemAction = PulseLinkAction | PulseMutationItemAction;

export interface PulseItemBase<K extends PulseItemKind> {
  /** Opaque, server-issued identifier. Clients must not derive source ownership from it. */
  id: string;
  kind: K;
  trigger: PulseTrigger;
  source_type: K;
  source_id: string;
  ticker: string | null;
  coverage_level: UserCompanyCoverageLevel | null;
  judgment: UserFilingJudgmentSummary | null;
  linked_thesis: PulseLinkedThesis | null;
  eyebrow: string;
  title: string;
  body: string;
  reason_code: string;
  reason_label: string;
  feed_slot: PulseFeedSlot;
  /** Deterministic server baseline before the bounded device-only adjustment. */
  server_rank: number;
  priority: PulseItemPriority;
  occurred_at: string;
  available_at: string;
  expires_at: string | null;
  reviewed_at: string | null;
  saved_at: string | null;
  snoozed_until: string | null;
  state: PulseItemState;
  actionable: boolean;
  phase: PulseAnalysisPhase | null;
  group_key: string | null;
  primary_action: PulseItemAction;
  secondary_actions: PulseItemAction[];
  metadata: Record<string, string | number | boolean | null>;
}

export type PulseFilingItem = PulseItemBase<"filing">;
export type PulseAnalysisItem = PulseItemBase<"analysis">;
export type PulseCheckupItem = PulseItemBase<"checkup">;
export type PulseQuestionItem = PulseItemBase<"question">;
export type PulseResurfaceItem = PulseItemBase<"resurface">;
export type PulseLearningItem = PulseItemBase<"learning">;

export type PulseItem =
  | PulseFilingItem
  | PulseAnalysisItem
  | PulseCheckupItem
  | PulseQuestionItem
  | PulseResurfaceItem
  | PulseLearningItem;

/**
 * An internal diversity/reason label. It never creates a visible feed section;
 * the device may only make a bounded local adjustment to the server baseline.
 */
export type PulseFeedSlot =
  | "signal"
  | "continue"
  | "discovery"
  | "resurface"
  | "learning";

export interface PulseSourceStatus {
  source: PulseItemKind;
  status: "ready" | "empty" | "degraded" | "unavailable";
  item_count: number;
  latency_ms?: number;
}

export interface PulseFeedSummary {
  actionable_count: number;
  active_analysis_count: number;
  counts: {
    filing: number;
    analysis: number;
    question: number;
    resurface: number;
  };
  primary_action: PulseLinkAction | null;
}

export interface PulseFeedResponse {
  /** Opaque, account-scoped snapshot revision used for status and delta. */
  revision: string;
  generated_at: string;
  snapshot_at: string;
  ranking_version: "rule_v4" | "rule_v5_flat";
  timezone: string;
  date_label: string;
  filter: PulseFilter;
  active_analysis_items: PulseItem[];
  /** Server-authorized candidates. The device selects one continuous visible slate. */
  candidate_items: PulseItem[];
  /** Maximum cards the device may render from candidate_items. */
  visible_limit: number;
  /** Render fingerprints for private delta synchronization. */
  item_versions: Record<string, string>;
  new_item_count: number;
  source_statuses: PulseSourceStatus[];
}

export interface PulseFeedStatusResponse {
  generated_at: string;
  revision: string;
  changed: boolean;
}

/** Aggregate-only result metadata for a successful device feed sync. */
export interface PulseFeedRefreshSummary {
  /** Cards newly authorized for this device that were absent from its snapshot. */
  added_candidate_count: number;
  /** Existing cards whose render fingerprint changed. */
  updated_item_count: number;
  /** Previously cached cards no longer present in the authoritative feed. */
  removed_item_count: number;
}

export interface PulseFeedDeltaResponse {
  generated_at: string;
  revision: string;
  changed: boolean;
  /** Null when the caller already has the exact current revision. */
  snapshot: Omit<
    PulseFeedResponse,
    "revision" | "generated_at" | "snapshot_at" | "candidate_items" | "active_analysis_items" | "item_versions"
  > | null;
  ordered_candidate_ids: string[];
  active_analysis_item_ids: string[];
  /** Only cards whose rendering fingerprint changed since the device snapshot. */
  upserts: PulseItem[];
  removed_item_ids: string[];
  item_versions: Record<string, string>;
  refresh_summary: PulseFeedRefreshSummary;
}

export interface PulsePreferences {
  timezone: string;
  enabled_kinds: PulseItemKind[];
  muted_tickers: string[];
  daily_checkup_enabled: boolean;
  daily_checkup_at: string;
  question_cadence: "daily" | "three_weekly" | "off";
  resurface_cadence: "weekly" | "biweekly" | "off";
  learning_cadence: "weekly" | "off";
  learning_enabled: boolean;
  resurfacing_enabled: boolean;
  updated_at: string | null;
}

export interface PulsePreferencesPatch {
  timezone?: string;
  enabled_kinds?: PulseItemKind[];
  muted_tickers?: string[];
  daily_checkup_enabled?: boolean;
  daily_checkup_at?: string;
  question_cadence?: "daily" | "three_weekly" | "off";
  resurface_cadence?: "weekly" | "biweekly" | "off";
  learning_cadence?: "weekly" | "off";
  learning_enabled?: boolean;
  resurfacing_enabled?: boolean;
}

export interface PulseItemMutationRequest {
  action: PulseMutationAction;
  snoozed_until?: string;
}

export interface PulseItemMutationResponse {
  item_id: string;
  action: PulseMutationAction;
  reviewed_at: string | null;
  saved_at: string | null;
  snoozed_until: string | null;
  dismissed_at: string | null;
}
