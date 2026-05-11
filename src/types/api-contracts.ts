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
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** Chat message role */
export type MessageRole = "user" | "assistant" | "system";

/** Chat session scope */
export type SessionScopeType = "global" | "company";

/** SSE streaming event types */
export type StreamingEventType =
  | "token"
  | "tool_call_start"
  | "tool_call_end"
  | "citation"
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
  | "concurrency_limit"
  | "mcp_unavailable"
  | "mcp_error"
  | "claude_api_error"
  | "claude_rate_limited"
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
  "concurrency_limit",
  "mcp_unavailable",
  "mcp_error",
  "claude_api_error",
  "claude_rate_limited",
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

/** Allowed MCP tool names */
export type MCPToolName =
  | "krw_ontology_catalog"
  | "krw_ontology_topic_map"
  | "krw_ontology_query"
  | "krw_ontology_retrieve"
  | "krw_ontology_trace"
  | "krw_ontology_quality"
  | "krw_ontology_compare"
  | "krw_ontology_plan_query";

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
  created_at: string;
  updated_at: string;
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
  readonly created_at: string;
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
  ontology_release_id: string | null;
  index_generated_at: string | null;
  error_code: ErrorCode | null;
  error_message: string | null;
  sdk_diagnostics: Record<string, unknown> | null;
}

/** Agent run summary (returned in session fetch) */
export interface AgentRunSummary {
  id: string;
  status: RunStatus;
  model: string;
  started_at: string;
  finished_at: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  ontology_release_id: string | null;
  error_code: ErrorCode | null;
}

// ============================================================
// MCP Tool Call Types
// ============================================================

/** A single MCP tool call within an agent run */
export interface ToolCall {
  readonly id: string;
  run_id: string;
  tool_name: MCPToolName;
  arguments_json: string;
  result_summary: string | null;
  readonly started_at: string;
  finished_at: string | null;
  error_message: string | null;
}

/** Tool call as sent during streaming (partial) */
export interface StreamingToolCallStart {
  tool_call_id: string;
  tool_name: MCPToolName;
  arguments: Record<string, unknown>;
}

/** Tool call completion during streaming */
export interface StreamingToolCallEnd {
  tool_call_id: string;
  result_summary: string | null;
  error_message: string | null;
  duration_ms: number;
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
}

// ============================================================
// Release Metadata Types
// ============================================================

/** Ontology release metadata */
export interface OntologyRelease {
  readonly id: string;
  release_path: string;
  krw_ontology_commit: string;
  index_generated_at: string;
  company_count: number;
  document_count: number;
  readonly created_at: string;
}

/** Release metadata embedded in run completion events */
export interface ReleaseMetadata {
  ontology_release_id: string;
  index_generated_at: string;
  company_count: number;
  document_count: number;
  krw_ontology_commit: string;
  web_commit: string;
}

// ============================================================
// Usage / Quota Types
// ============================================================

/** Daily usage tracking record */
export interface UsageDaily {
  user_id: string;
  date: string;             // YYYY-MM-DD
  question_count: number;
  estimated_cost_usd: number;
}

/** Current user quota status (returned alongside responses) */
export interface QuotaStatus {
  questions_used_today: number;
  questions_limit: number;
  cost_used_today_usd: number;
  cost_limit_usd: number;
  remaining_questions: number;
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

/** Citation extracted during response */
export interface StreamingCitationEvent extends StreamingEventBase {
  event: "citation";
  data: StreamingCitation;
}

/** Run completed successfully */
export interface StreamingDoneEvent extends StreamingEventBase {
  event: "done";
  data: {
    run_id: string;
    message_id: string;
    release: ReleaseMetadata;
    usage: {
      input_tokens: number;
      output_tokens: number;
      estimated_cost_usd: number;
      latency_ms: number;
    };
    quota: QuotaStatus;
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
  | StreamingTokenEvent
  | StreamingToolCallStartEvent
  | StreamingToolCallEndEvent
  | StreamingCitationEvent
  | StreamingDoneEvent
  | StreamingErrorEvent
  | StreamingCancelledEvent;

// ============================================================
// API Request Types
// ============================================================

/** POST /api/chat/run request body */
export interface ChatRunRequest {
  session_id: string;
  content: string;            // 1-20000 chars, or 120000 when text attachments are included
  request_id: string;         // client-generated UUID
}

/** POST /api/chat/[sessionId]/cancel - no request body */

/** GET /api/sessions query parameters */
export interface SessionsListParams {
  page?: number;              // default 1
  limit?: number;             // default 20, max 50
}

/** POST /api/sessions request body */
export interface CreateSessionRequest {
  title?: string;             // auto-generated if omitted
  scope_type: SessionScopeType;
  default_tickers?: string[];           // required when scope_type is "company"
  default_document_types?: string[];
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

/** GET /healthz response */
export interface HealthzResponse {
  status: "ok";
  timestamp: string;
}

/** GET /internal/mcp-health response */
export interface McpHealthResponse {
  mcp_connected: boolean;
  ontology_release_id: string | null;
  index_generated_at: string | null;
  company_count: number | null;
  document_count: number | null;
  krw_ontology_commit: string;
}

// ============================================================
// MCP Service Types (for internal use)
// ============================================================

/** MCP health endpoint response shape */
export interface McpServiceHealth {
  status: "ok" | "error";
  release_id: string;
  index_generated_at: string;
  company_count: number;
  document_count: number;
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
  KRW_ONTOLOGY_PLUGIN_PATH: string;
  WEB_COMMIT: string;
  KRW_ONTOLOGY_COMMIT: string;
  DAILY_USER_QUESTION_LIMIT: string;    // "20"
  GLOBAL_CONCURRENT_RUN_LIMIT: string;  // "5"
  DAILY_COST_CAP_USD: string;           // "5.00"
  CLAUDE_MODEL: string;                 // "claude-sonnet-4-6"
  CLAUDE_AGENT_MAX_TURNS: string;        // "20"
  LEASE_TIMEOUT_MINUTES: string;        // "5"
}

/** Environment variables required by optional standalone MCP container */
export interface McpContainerEnv {
  KRW_ONTOLOGY_ROOT: string;            // "/data"
}
