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
  last_message_preview: string | null;
  last_message_at: string | null;
  latest_run_status: AgentRunRow["status"] | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MessageRow extends Record<string, unknown> {
  id: string;
  session_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  status: "pending" | "streaming" | "completed" | "failed" | "cancelled";
  request_id: string | null;
  metadata?: Json;
  created_at: string;
  updated_at: string;
}

export interface ChatAttachmentRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  session_id: string | null;
  message_id: string | null;
  ticker: string | null;
  file_name: string;
  mime_type: string;
  file_size: number;
  storage_kind: "local_fs";
  original_path: string | null;
  extracted_md: string | null;
  extracted_char_count: number | null;
  extraction_status:
    | "queued"
    | "processing"
    | "completed"
    | "failed"
    | "expired";
  extraction_error: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentIngestionJobRow extends Record<string, unknown> {
  id: string;
  attachment_id: string;
  status: "queued" | "running" | "completed" | "failed";
  worker_id: string | null;
  attempts: number;
  max_attempts: number;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  lease_expires_at: string | null;
  error_message: string | null;
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
  status:
    | "pending"
    | "queued"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "expired";
  lease_expires_at: string | null;
  queued_at: string | null;
  claimed_at: string | null;
  heartbeat_at: string | null;
  worker_id: string | null;
  cancel_requested_at: string | null;
  retry_count: number;
  max_retries: number;
  started_at: string | null;
  finished_at: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost_usd: number | null;
  web_commit: string;
  krw_ontology_commit: string;
  ontology_env: "dev" | "staging" | "prod";
  worker_env: "dev" | "staging" | "prod" | null;
  ontology_release_id: string | null;
  index_generated_at: string | null;
  company_count: number | null;
  document_count: number | null;
  object_count: number | null;
  ontology_root: string | null;
  index_path: string | null;
  manifest_path: string | null;
  manifest_valid: boolean | null;
  agent_index_schema_version: string | null;
  ontology_manifest: Json | null;
  error_code: string | null;
  error_message: string | null;
  sdk_diagnostics: Json | null;
  run_kind:
    | "company_research"
    | "idea_generation"
    | "news_discovery"
    | "news_research"
    | "market_move_research"
    | "scenario_sensitivity"
    | "guru_advisor";
  executor_type: "claude_agent" | "server_pipeline";
  selected_news_event_context: Json | null;
  source_artifact_id: string | null;
  source_event_id: string | null;
}

export interface AgentRunEventRow extends Record<string, unknown> {
  id: number;
  run_id: string;
  event_type: string;
  payload: Json;
  created_at: string;
}

export interface ChatMessageChartRow extends Record<string, unknown> {
  id: string;
  session_id: string;
  message_id: string;
  run_id: string;
  chart_ref: string;
  insert_token: string;
  title: string;
  chart_type: "line" | "bar";
  payload_json: Json;
  created_at: string;
}

export interface AgentWorkerHeartbeatRow extends Record<string, unknown> {
  worker_id: string;
  status: "idle" | "running" | "stopped" | "unhealthy";
  last_seen_at: string;
  heartbeat_expires_at: string;
  claude_code_version: string | null;
  web_commit: string | null;
  krw_ontology_commit: string | null;
  worker_env: "dev" | "staging" | "prod";
  ontology_env: "dev" | "staging" | "prod";
  ontology_release_id: string | null;
  index_generated_at: string | null;
  company_count: number | null;
  document_count: number | null;
  object_count: number | null;
  tool_count: number | null;
  root: string | null;
  index_path: string | null;
  manifest_path: string | null;
  manifest_valid: boolean;
  agent_index_schema_version: string | null;
  plugin_path: string | null;
  error: string | null;
  metadata: Json | null;
  created_at: string;
  updated_at: string;
}

export interface DesktopDeviceRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  device_name: string;
  installation_id: string | null;
  platform: string | null;
  arch: string | null;
  app_version: string | null;
  protocol_version: string;
  status: "active" | "revoked";
  last_seen_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DesktopDeviceLoginCodeRow extends Record<string, unknown> {
  id: string;
  device_code_hash: string;
  user_code_hash: string;
  user_code_display: string;
  device_name: string;
  installation_id: string | null;
  platform: string | null;
  arch: string | null;
  app_version: string | null;
  protocol_version: string;
  status: "pending" | "approved" | "denied" | "expired" | "complete";
  user_id: string | null;
  device_id: string | null;
  expires_at: string;
  approved_at: string | null;
  consumed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DesktopAuthorizationRequestRow
  extends Record<string, unknown> {
  id: string;
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: "S256";
  installation_id: string;
  device_name: string;
  platform: string | null;
  arch: string | null;
  app_version: string | null;
  protocol_version: string;
  status: "pending" | "approved" | "denied" | "consumed" | "expired";
  user_id: string | null;
  device_id: string | null;
  authorization_code_hash: string | null;
  expires_at: string;
  approved_at: string | null;
  consumed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DesktopAccessTokenRow extends Record<string, unknown> {
  id: string;
  device_id: string;
  user_id: string;
  token_hash: string;
  status: "active" | "revoked" | "expired";
  expires_at: string;
  last_used_at: string | null;
  created_at: string;
  revoked_at: string | null;
}

export interface DesktopRefreshTokenRow extends Record<string, unknown> {
  id: string;
  device_id: string;
  user_id: string;
  token_hash: string;
  status: "active" | "revoked" | "rotated" | "expired";
  expires_at: string;
  last_used_at: string | null;
  created_at: string;
  rotated_at: string | null;
  revoked_at: string | null;
}

export interface DesktopOntologyToolCallRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  device_id: string | null;
  local_session_id: string;
  local_run_id: string;
  tool_call_id: string;
  tool_name: string;
  arguments_hash: string;
  arguments_summary: Json;
  desktop_context: Json;
  ontology_release_id: string | null;
  latency_ms: number | null;
  result_count: number | null;
  result_size_bytes: number | null;
  status: "running" | "succeeded" | "failed";
  error_code: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface DesktopLlmJobRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  device_id: string | null;
  local_session_id: string | null;
  local_run_id: string;
  runtime: "claude-sdk";
  token_jti: string;
  token_hash: string;
  status: "active" | "completed" | "failed" | "expired" | "revoked";
  provider: "deepseek";
  model_profile: string;
  sdk_model: string;
  upstream_model: string;
  gateway_base_url: string;
  max_budget_usd: number | null;
  max_request_count: number;
  request_count: number;
  max_input_tokens: number | null;
  max_output_tokens: number | null;
  expires_at: string;
  last_used_at: string | null;
  finalized_at: string | null;
  usage_input_tokens: number;
  usage_output_tokens: number;
  usage_cache_read_input_tokens: number;
  usage_cache_creation_input_tokens: number;
  actual_provider_cost_usd: number | null;
  error_code: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface OntologyCatalogReleaseRow extends Record<string, unknown> {
  env: "dev" | "staging" | "prod";
  release_id: string;
  active: boolean;
  format: string;
  generated_at: string | null;
  release_created_at: string | null;
  index_generated_at: string | null;
  company_count: number;
  document_count: number;
  index_document_count: number | null;
  object_count: number;
  manifest_json: Json | null;
  summary_json: Json;
  source_json: Json | null;
  catalog_json: Json;
  created_at: string;
  updated_at: string;
}

export interface OntologyCompanyRow extends Record<string, unknown> {
  env: "dev" | "staging" | "prod";
  release_id: string;
  ticker: string;
  name: string;
  sector: string | null;
  description: string | null;
  latest_period: string | null;
  document_count: number;
  document_types: string[];
  periods: string[];
  coverage_json: Json;
  documents_json: Json;
  company_json: Json;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserCompanyMarkRow extends Record<string, unknown> {
  user_id: string;
  ticker: string;
  is_watchlisted: boolean;
  is_holding: boolean;
  priority: number;
  interest_reason: string | null;
  tags: string[];
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserCompanyQuestionRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  ticker: string;
  question: string;
  status: "open" | "answered" | "dismissed";
  source:
    | "manual"
    | "generated_from_tearsheet"
    | "generated_from_thesis_check"
    | "saved_from_chat";
  source_chat_session_id: string | null;
  source_message_id: string | null;
  answered_at: string | null;
  visible_after_at: string;
  created_at: string;
  updated_at: string;
}

export interface UserCompanyCardRow extends Record<string, unknown> {
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

export interface UserCompanyNotebookRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  ticker: string;
  title: string;
  content_md: string;
  previous_content_md: string | null;
  basis_release_id: string | null;
  basis_period: string | null;
  last_source_chat_session_id: string | null;
  last_source_message_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserCompanyNotebookRefreshJobRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  ticker: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
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

export interface UserCompanyThesisRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  ticker: string;
  title: string;
  thesis_text: string;
  status: "active" | "needs_review" | "weakened" | "mixed" | "archived";
  tags: string[];
  archived_at: string | null;
  source_chat_session_id: string | null;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserThesisCheckRow extends Record<string, unknown> {
  id: string;
  thesis_id: string;
  user_id: string;
  ticker: string;
  result_status:
    | "strengthened"
    | "weakened"
    | "mixed"
    | "insufficient"
    | "needs_review";
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

export interface UserResearchNoteRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  ticker: string;
  title: string;
  body: string;
  note_type:
    | "manual"
    | "chat_summary"
    | "thesis_check"
    | "filing_check"
    | "risk_memo"
    | "earnings_setup"
    | "earnings_review"
    | "tearsheet";
  tags: string[];
  source_chat_session_id: string | null;
  source_message_id: string | null;
  client_operation_id?: string | null;
  source_origin?: "web" | "desktop";
  source_device_id?: string | null;
  source_local_session_id?: string | null;
  source_local_run_id?: string | null;
  source_local_message_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserResearchNoteSourceRow extends Record<string, unknown> {
  id: string;
  note_id: string;
  user_id: string;
  ticker: string;
  citation_id: string | null;
  run_id: string | null;
  message_id: string | null;
  ontology_object_id: string | null;
  document_type: string | null;
  filing_period: string | null;
  created_at: string;
}

export interface InstitutionalManagerRow extends Record<string, unknown> {
  cik: string;
  name: string;
  display_name: string | null;
  country_code: string | null;
  notes: string | null;
  latest_refresh_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Institutional13FFilingRow extends Record<string, unknown> {
  id: string;
  cik: string;
  accession_number: string;
  form: "13F-HR" | "13F-HR/A";
  report_period: string;
  filing_date: string;
  accepted_at: string | null;
  filing_detail_url: string;
  primary_document_url: string | null;
  information_table_url: string;
  entry_count: number;
  total_value_usd: number;
  source: "sec_edgar";
  created_at: string;
  updated_at: string;
}

export interface Institutional13FHoldingRow extends Record<string, unknown> {
  id: string;
  filing_id: string;
  cik: string;
  report_period: string;
  position_key: string;
  issuer_name: string;
  title_of_class: string;
  cusip: string;
  ticker: string | null;
  value_usd: number;
  shares: number | null;
  share_type: string | null;
  put_call: string | null;
  investment_discretion: string | null;
  other_manager: string | null;
  voting_authority_sole: number | null;
  voting_authority_shared: number | null;
  voting_authority_none: number | null;
  created_at: string;
}

export interface Sec13FCusipMappingRow extends Record<string, unknown> {
  cusip: string;
  ticker: string | null;
  name: string | null;
  exch_code: string | null;
  figi: string | null;
  composite_figi: string | null;
  share_class_figi: string | null;
  market_sector: string | null;
  security_type: string | null;
  security_type_2: string | null;
  security_description: string | null;
  provider: "openfigi";
  provider_status: "mapped" | "not_found" | "error";
  raw_response: Json | null;
  mapped_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Sec13FPositionChangeRow extends Record<string, unknown> {
  id: string;
  filing_id: string;
  previous_filing_id: string | null;
  cik: string;
  report_period: string;
  previous_report_period: string | null;
  position_key: string;
  issuer_name: string;
  title_of_class: string | null;
  cusip: string;
  ticker: string | null;
  change_type: "new" | "increased" | "decreased" | "unchanged" | "sold";
  current_value_usd: number;
  previous_value_usd: number | null;
  value_change_usd: number | null;
  value_change_pct: number | null;
  current_weight: number | null;
  previous_weight: number | null;
  weight_change: number | null;
  current_shares: number | null;
  previous_shares: number | null;
  shares_change: number | null;
  shares_change_pct: number | null;
  created_at: string;
  updated_at: string;
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
  plan_key: "free" | "standard" | "pro" | "power" | "beta" | "internal";
  status:
    | "active"
    | "paused"
    | "past_due"
    | "grace"
    | "cancelled"
    | "expired";
  current_period_start: string;
  current_period_end: string;
  billing_period_start?: string | null;
  billing_period_end?: string | null;
  credit_anchor_at?: string | null;
  plan_version_id?: string | null;
  cancel_at_period_end?: boolean;
  plan_change_pending?: Json;
  grace_until?: string | null;
  provider_customer_id: string | null;
  provider_subscription_id: string | null;
  provider_price_id?: string | null;
  entitlement_updated_at?: string;
  created_at: string;
  updated_at: string;
}

export interface BillingPlanRow extends Record<string, unknown> {
  key: "free" | "standard" | "pro" | "power" | "beta" | "internal";
  label: string;
  status_label: string;
  description: string;
  budget_period: "daily" | "weekly" | "monthly";
  monthly_price_krw?: number | null;
  weekly_analysis_credits_raw?: number | null;
  plan_version?: string | null;
  credit_policy_version?: string | null;
  monthly_analysis_credits: number | null;
  daily_analysis_credits: number | null;
  monthly_budget_usd: number | null;
  daily_budget_usd: number | null;
  per_run_analysis_credits: number;
  per_run_reserve_usd: number;
  unlimited: boolean;
  sort_order: number;
  is_public: boolean;
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

export interface UsageBudgetBalanceRow extends Record<string, unknown> {
  user_id: string;
  period_kind: "daily" | "monthly";
  period_start: string;
  period_end: string;
  settled_cost_usd: number;
  reserved_cost_usd: number;
  released_cost_usd: number;
  run_count: number;
  updated_at: string;
}

export interface RunBudgetRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  request_id: string;
  run_id: string | null;
  monthly_period_start: string;
  monthly_period_end: string;
  daily_period_start: string;
  daily_period_end: string;
  reserved_cost_usd: number;
  settled_cost_usd: number;
  status: "reserved" | "running" | "settled" | "released" | "expired";
  reason: string | null;
  metadata: Json;
  expires_at: string;
  created_at: string;
  settled_at: string | null;
}

export interface UsageLedgerRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  run_budget_id: string | null;
  run_id: string | null;
  request_id: string;
  period_kind: "daily" | "monthly";
  period_start: string;
  period_end: string;
  entry_type: "reservation" | "settlement" | "release" | "adjustment" | "expiry";
  amount_usd: number;
  metadata: Json;
  created_at: string;
}

export interface CreditPolicyRow extends Record<string, unknown> {
  version: string;
  input_token_weight: number;
  output_token_weight: number;
  display_scale: number;
  created_at: string;
}

export interface ProviderPricingPolicyRow extends Record<string, unknown> {
  version: string;
  provider: string;
  provider_model: string;
  provider_model_version: string;
  input_cache_hit_cost_per_million: number;
  input_cache_miss_cost_per_million: number;
  output_cost_per_million: number;
  source_url: string | null;
  verified_at: string | null;
  effective_from: string;
  effective_to: string | null;
  created_at: string;
}

export interface BillingPlanVersionRow extends Record<string, unknown> {
  id: string;
  plan_key: "free" | "standard" | "pro" | "beta" | "internal";
  plan_version: string;
  monthly_price_krw: number;
  weekly_credit_limit_raw: number | null;
  credit_policy_version: string;
  provider_price_id: string | null;
  effective_from: string;
  effective_to: string | null;
  is_current: boolean;
  created_at: string;
}

export type BillingTossPlanKey = "standard" | "pro";

export interface BillingTossCustomerRow extends Record<string, unknown> {
  user_id: string;
  customer_key: string;
  created_at: string;
  updated_at: string;
}

export interface BillingTossCheckoutSessionRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  plan_key: BillingTossPlanKey;
  plan_version_id: string | null;
  amount_krw: number;
  currency: "KRW";
  order_name: string;
  customer_key: string;
  status:
    | "created"
    | "auth_succeeded"
    | "paid"
    | "failed"
    | "cancelled"
    | "expired";
  success_url: string;
  fail_url: string;
  auth_key_received_at: string | null;
  billing_key_idempotency_key: string;
  failure_code: string | null;
  failure_message: string | null;
  provider_response: Json;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface BillingTossSubscriptionRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  plan_key: BillingTossPlanKey;
  plan_version_id: string | null;
  status:
    | "active"
    | "past_due"
    | "grace"
    | "pending_cancel"
    | "cancelled"
    | "expired";
  customer_key: string;
  billing_key: string;
  billing_method: "CARD" | "TRANSFER";
  billing_key_issued_at: string | null;
  card_snapshot: Json;
  current_period_start: string;
  current_period_end: string;
  next_billing_at: string;
  renewal_due_at: string;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  grace_until: string | null;
  renewal_attempt_count: number;
  renewal_lease_owner: string | null;
  renewal_lease_expires_at: string | null;
  pending_plan_key: BillingTossPlanKey | null;
  pending_plan_version_id: string | null;
  last_payment_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface BillingTossPaymentRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  subscription_id: string | null;
  checkout_session_id: string | null;
  plan_key: BillingTossPlanKey;
  plan_version_id: string | null;
  payment_kind: "initial" | "renewal" | "upgrade";
  order_id: string;
  order_name: string;
  idempotency_key: string;
  amount_krw: number;
  currency: "KRW";
  billing_period_start: string | null;
  billing_period_end: string | null;
  attempt_number: number;
  status: "pending" | "paid" | "failed" | "cancelled";
  provider_payment_key: string | null;
  provider_status: string | null;
  failure_code: string | null;
  failure_message: string | null;
  provider_response: Json;
  requested_at: string | null;
  approved_at: string | null;
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UsageCreditBalanceRow extends Record<string, unknown> {
  user_id: string;
  period_kind: "weekly";
  period_start: string;
  period_end: string;
  plan_key_snapshot: "free" | "standard" | "pro" | "beta" | "internal";
  plan_version_id: string | null;
  credit_policy_version: string;
  credits_limit_raw: number;
  credits_used_raw: number;
  credits_reserved_raw: number;
  credits_released_raw: number;
  actual_provider_cost_usd: number;
  run_count: number;
  updated_at: string;
}

export interface RunCreditReservationRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  request_id: string;
  run_id: string | null;
  credit_period_start: string;
  credit_period_end: string;
  reserved_credits_raw: number;
  settled_credits_raw: number;
  status: "reserved" | "running" | "settled" | "released" | "expired";
  terminal_status: string | null;
  plan_key_snapshot: "free" | "standard" | "pro" | "beta" | "internal";
  plan_version_id: string | null;
  credit_policy_version: string;
  provider: string | null;
  provider_model: string | null;
  provider_model_version: string | null;
  pricing_version: string | null;
  input_tokens: number;
  output_tokens: number;
  prompt_cache_hit_tokens: number;
  prompt_cache_miss_tokens: number;
  actual_provider_cost_usd: number;
  metadata: Json;
  expires_at: string;
  created_at: string;
  settled_at: string | null;
}

export interface UsageCreditLedgerRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  run_credit_reservation_id: string | null;
  run_id: string | null;
  request_id: string;
  period_kind: "weekly";
  period_start: string;
  period_end: string;
  entry_type: "reservation" | "settlement" | "release" | "adjustment" | "expiry";
  amount_credits_raw: number;
  actual_provider_cost_usd: number;
  metadata: Json;
  created_at: string;
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

export interface ChatMessageArtifactRow extends Record<string, unknown> {
  id: string;
  session_id: string;
  message_id: string;
  run_id: string;
  type: "news_event_selection" | "verified_source_summary";
  payload_json: Json;
  created_at: string;
}

export interface ChatMessageArtifactSelectionRow extends Record<string, unknown> {
  id: string;
  artifact_id: string;
  session_id: string;
  event_id: string;
  user_id: string;
  selected_payload_json: Json;
  user_message_id: string | null;
  research_run_id: string | null;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  created_at: string;
  updated_at: string;
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
  source_question_message_id: string | null;
  title: string;
  question_content: string | null;
  question_created_at: string | null;
  answer_content: string;
  answer_created_at: string;
  tickers: string[] | null;
  snapshot_version: number;
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
    | "suggested_question_clicked"
    | "starter_question_clicked"
    | "question_submitted"
    | "answer_completed"
    | "answer_failed"
    | "citation_opened"
    | "share_created"
    | "share_viewed"
    | "share_answer_read"
    | "share_cta_clicked"
    | "share_starter_loaded"
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
          | "id"
          | "created_at"
          | "updated_at"
          | "client_request_id"
          | "deleted_at"
          | "last_message_preview"
          | "last_message_at"
          | "latest_run_status"
        > & {
          id?: string;
          client_request_id?: string | null;
          deleted_at?: string | null;
          last_message_preview?: string | null;
          last_message_at?: string | null;
          latest_run_status?: AgentRunRow["status"] | null;
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
          "id" | "created_at" | "updated_at" | "request_id" | "metadata"
        > & {
          id?: string;
          request_id?: string | null;
          metadata?: Json;
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
      chat_attachments: {
        Row: ChatAttachmentRow;
        Insert: Omit<
          ChatAttachmentRow,
          | "id"
          | "created_at"
          | "updated_at"
          | "extracted_md"
          | "extracted_char_count"
          | "extraction_error"
        > & {
          id?: string;
          session_id?: string | null;
          message_id?: string | null;
          ticker?: string | null;
          extracted_md?: string | null;
          extracted_char_count?: number | null;
          extraction_error?: string | null;
          expires_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<ChatAttachmentRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      document_ingestion_jobs: {
        Row: DocumentIngestionJobRow;
        Insert: Omit<
          DocumentIngestionJobRow,
          | "id"
          | "status"
          | "worker_id"
          | "attempts"
          | "queued_at"
          | "started_at"
          | "completed_at"
          | "lease_expires_at"
          | "error_message"
          | "created_at"
          | "updated_at"
        > & {
          id?: string;
          status?: DocumentIngestionJobRow["status"];
          worker_id?: string | null;
          attempts?: number;
          queued_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
          lease_expires_at?: string | null;
          error_message?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<DocumentIngestionJobRow, "id" | "created_at">>;
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
      agent_run_events: {
        Row: AgentRunEventRow;
        Insert: Omit<AgentRunEventRow, "id" | "created_at"> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Omit<AgentRunEventRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      agent_worker_heartbeats: {
        Row: AgentWorkerHeartbeatRow;
        Insert: Omit<AgentWorkerHeartbeatRow, "created_at" | "updated_at"> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<AgentWorkerHeartbeatRow, "worker_id" | "created_at">>;
        Relationships: [];
      };
      institutional_managers: {
        Row: InstitutionalManagerRow;
        Insert: Pick<InstitutionalManagerRow, "cik" | "name"> &
          Partial<
            Omit<InstitutionalManagerRow, "cik" | "name" | "created_at" | "updated_at">
          > & {
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<InstitutionalManagerRow, "cik" | "created_at">>;
        Relationships: [];
      };
      sec_13f_filings: {
        Row: Institutional13FFilingRow;
        Insert: Pick<
          Institutional13FFilingRow,
          | "cik"
          | "accession_number"
          | "form"
          | "report_period"
          | "filing_date"
          | "filing_detail_url"
          | "information_table_url"
        > &
          Partial<
            Omit<
              Institutional13FFilingRow,
              | "id"
              | "cik"
              | "accession_number"
              | "form"
              | "report_period"
              | "filing_date"
              | "filing_detail_url"
              | "information_table_url"
              | "created_at"
              | "updated_at"
            >
          > & {
            id?: string;
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<Institutional13FFilingRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      sec_13f_holdings: {
        Row: Institutional13FHoldingRow;
        Insert: Pick<
          Institutional13FHoldingRow,
          | "filing_id"
          | "cik"
          | "report_period"
          | "position_key"
          | "issuer_name"
          | "title_of_class"
          | "cusip"
          | "value_usd"
        > &
          Partial<
            Omit<
              Institutional13FHoldingRow,
              | "id"
              | "filing_id"
              | "cik"
              | "report_period"
              | "position_key"
              | "issuer_name"
              | "title_of_class"
              | "cusip"
              | "value_usd"
              | "created_at"
            >
          > & {
            id?: string;
            created_at?: string;
          };
        Update: Partial<Omit<Institutional13FHoldingRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      sec_13f_cusip_mappings: {
        Row: Sec13FCusipMappingRow;
        Insert: Pick<Sec13FCusipMappingRow, "cusip"> &
          Partial<
            Omit<
              Sec13FCusipMappingRow,
              "cusip" | "created_at" | "updated_at"
            >
          > & {
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<Sec13FCusipMappingRow, "cusip" | "created_at">>;
        Relationships: [];
      };
      sec_13f_position_changes: {
        Row: Sec13FPositionChangeRow;
        Insert: Pick<
          Sec13FPositionChangeRow,
          | "filing_id"
          | "cik"
          | "report_period"
          | "position_key"
          | "issuer_name"
          | "cusip"
          | "change_type"
        > &
          Partial<
            Omit<
              Sec13FPositionChangeRow,
              | "id"
              | "filing_id"
              | "cik"
              | "report_period"
              | "position_key"
              | "issuer_name"
              | "cusip"
              | "change_type"
              | "created_at"
              | "updated_at"
            >
          > & {
            id?: string;
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<Sec13FPositionChangeRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      desktop_devices: {
        Row: DesktopDeviceRow;
        Insert: Omit<
          DesktopDeviceRow,
          "id" | "created_at" | "updated_at" | "last_seen_at" | "revoked_at"
        > & {
          id?: string;
          last_seen_at?: string | null;
          revoked_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<DesktopDeviceRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      desktop_device_login_codes: {
        Row: DesktopDeviceLoginCodeRow;
        Insert: Omit<
          DesktopDeviceLoginCodeRow,
          | "id"
          | "status"
          | "user_id"
          | "device_id"
          | "approved_at"
          | "consumed_at"
          | "created_at"
          | "updated_at"
        > & {
          id?: string;
          status?: DesktopDeviceLoginCodeRow["status"];
          user_id?: string | null;
          device_id?: string | null;
          approved_at?: string | null;
          consumed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<DesktopDeviceLoginCodeRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      desktop_authorization_requests: {
        Row: DesktopAuthorizationRequestRow;
        Insert: Omit<
          DesktopAuthorizationRequestRow,
          | "id"
          | "status"
          | "user_id"
          | "device_id"
          | "authorization_code_hash"
          | "approved_at"
          | "consumed_at"
          | "created_at"
          | "updated_at"
        > & {
          id?: string;
          status?: DesktopAuthorizationRequestRow["status"];
          user_id?: string | null;
          device_id?: string | null;
          authorization_code_hash?: string | null;
          approved_at?: string | null;
          consumed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Omit<DesktopAuthorizationRequestRow, "id" | "created_at">
        >;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      desktop_access_tokens: {
        Row: DesktopAccessTokenRow;
        Insert: Omit<
          DesktopAccessTokenRow,
          "id" | "status" | "last_used_at" | "created_at" | "revoked_at"
        > & {
          id?: string;
          status?: DesktopAccessTokenRow["status"];
          last_used_at?: string | null;
          created_at?: string;
          revoked_at?: string | null;
        };
        Update: Partial<Omit<DesktopAccessTokenRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      desktop_refresh_tokens: {
        Row: DesktopRefreshTokenRow;
        Insert: Omit<
          DesktopRefreshTokenRow,
          | "id"
          | "status"
          | "last_used_at"
          | "created_at"
          | "rotated_at"
          | "revoked_at"
        > & {
          id?: string;
          status?: DesktopRefreshTokenRow["status"];
          last_used_at?: string | null;
          created_at?: string;
          rotated_at?: string | null;
          revoked_at?: string | null;
        };
        Update: Partial<Omit<DesktopRefreshTokenRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      desktop_ontology_tool_calls: {
        Row: DesktopOntologyToolCallRow;
        Insert: Omit<
          DesktopOntologyToolCallRow,
          | "id"
          | "arguments_summary"
          | "desktop_context"
          | "ontology_release_id"
          | "latency_ms"
          | "result_count"
          | "result_size_bytes"
          | "status"
          | "error_code"
          | "created_at"
          | "completed_at"
        > & {
          id?: string;
          arguments_summary?: Json;
          desktop_context?: Json;
          ontology_release_id?: string | null;
          latency_ms?: number | null;
          result_count?: number | null;
          result_size_bytes?: number | null;
          status?: DesktopOntologyToolCallRow["status"];
          error_code?: string | null;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: Partial<Omit<DesktopOntologyToolCallRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      desktop_llm_jobs: {
        Row: DesktopLlmJobRow;
        Insert: Omit<
          DesktopLlmJobRow,
          | "status"
          | "request_count"
          | "last_used_at"
          | "finalized_at"
          | "usage_input_tokens"
          | "usage_output_tokens"
          | "usage_cache_read_input_tokens"
          | "usage_cache_creation_input_tokens"
          | "actual_provider_cost_usd"
          | "error_code"
          | "metadata"
          | "created_at"
          | "updated_at"
        > & {
          status?: DesktopLlmJobRow["status"];
          request_count?: number;
          last_used_at?: string | null;
          finalized_at?: string | null;
          usage_input_tokens?: number;
          usage_output_tokens?: number;
          usage_cache_read_input_tokens?: number;
          usage_cache_creation_input_tokens?: number;
          actual_provider_cost_usd?: number | null;
          error_code?: string | null;
          metadata?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<DesktopLlmJobRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      ontology_catalog_releases: {
        Row: OntologyCatalogReleaseRow;
        Insert: Omit<OntologyCatalogReleaseRow, "created_at" | "updated_at"> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Omit<OntologyCatalogReleaseRow, "env" | "release_id" | "created_at">
        >;
        Relationships: [];
      };
      ontology_companies: {
        Row: OntologyCompanyRow;
        Insert: Omit<OntologyCompanyRow, "created_at" | "updated_at"> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Omit<OntologyCompanyRow, "env" | "release_id" | "ticker" | "created_at">
        >;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_company_marks: {
        Row: UserCompanyMarkRow;
        Insert: Omit<
          UserCompanyMarkRow,
          | "is_watchlisted"
          | "is_holding"
          | "priority"
          | "interest_reason"
          | "tags"
          | "last_activity_at"
          | "created_at"
          | "updated_at"
        > & {
          is_watchlisted?: boolean;
          is_holding?: boolean;
          priority?: number;
          interest_reason?: string | null;
          tags?: string[];
          last_activity_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<UserCompanyMarkRow, "user_id" | "ticker" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_company_questions: {
        Row: UserCompanyQuestionRow;
        Insert: Omit<
          UserCompanyQuestionRow,
          | "id"
          | "status"
          | "source"
          | "source_chat_session_id"
          | "source_message_id"
          | "answered_at"
          | "visible_after_at"
          | "created_at"
          | "updated_at"
        > & {
          id?: string;
          status?: UserCompanyQuestionRow["status"];
          source?: UserCompanyQuestionRow["source"];
          source_chat_session_id?: string | null;
          source_message_id?: string | null;
          answered_at?: string | null;
          visible_after_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<UserCompanyQuestionRow, "id" | "user_id" | "ticker" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_company_cards: {
        Row: UserCompanyCardRow;
        Insert: Omit<
          UserCompanyCardRow,
          | "id"
          | "title"
          | "summary"
          | "content_md"
          | "basis_release_id"
          | "basis_period"
          | "basis_document_type"
          | "source_chat_session_id"
          | "source_message_id"
          | "client_operation_id"
          | "source_origin"
          | "source_device_id"
          | "source_local_session_id"
          | "source_local_run_id"
          | "source_local_message_id"
          | "created_at"
          | "updated_at"
        > & {
          id?: string;
          title?: string;
          summary?: string | null;
          content_md?: string;
          basis_release_id?: string | null;
          basis_period?: string | null;
          basis_document_type?: string | null;
          source_chat_session_id?: string | null;
          source_message_id?: string | null;
          client_operation_id?: string | null;
          source_origin?: "web" | "desktop";
          source_device_id?: string | null;
          source_local_session_id?: string | null;
          source_local_run_id?: string | null;
          source_local_message_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<UserCompanyCardRow, "id" | "user_id" | "ticker" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_company_notebooks: {
        Row: UserCompanyNotebookRow;
        Insert: Omit<
          UserCompanyNotebookRow,
          | "id"
          | "title"
          | "content_md"
          | "previous_content_md"
          | "basis_release_id"
          | "basis_period"
          | "last_source_chat_session_id"
          | "last_source_message_id"
          | "created_at"
          | "updated_at"
        > & {
          id?: string;
          title?: string;
          content_md?: string;
          previous_content_md?: string | null;
          basis_release_id?: string | null;
          basis_period?: string | null;
          last_source_chat_session_id?: string | null;
          last_source_message_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<UserCompanyNotebookRow, "id" | "user_id" | "ticker" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_company_notebook_refresh_jobs: {
        Row: UserCompanyNotebookRefreshJobRow;
        Insert: Omit<
          UserCompanyNotebookRefreshJobRow,
          | "id"
          | "status"
          | "notebook_id"
          | "recent_conversation_count"
          | "saved_question_count"
          | "last_source_chat_session_id"
          | "last_source_message_id"
          | "error_code"
          | "error_message"
          | "requested_at"
          | "started_at"
          | "completed_at"
          | "created_at"
          | "updated_at"
        > & {
          id?: string;
          status?: UserCompanyNotebookRefreshJobRow["status"];
          notebook_id?: string | null;
          recent_conversation_count?: number;
          saved_question_count?: number;
          last_source_chat_session_id?: string | null;
          last_source_message_id?: string | null;
          error_code?: string | null;
          error_message?: string | null;
          requested_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<UserCompanyNotebookRefreshJobRow, "id" | "user_id" | "ticker" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_company_theses: {
        Row: UserCompanyThesisRow;
        Insert: Omit<
          UserCompanyThesisRow,
          | "id"
          | "status"
          | "tags"
          | "archived_at"
          | "source_chat_session_id"
          | "source_message_id"
          | "created_at"
          | "updated_at"
        > & {
          id?: string;
          status?: UserCompanyThesisRow["status"];
          tags?: string[];
          archived_at?: string | null;
          source_chat_session_id?: string | null;
          source_message_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<UserCompanyThesisRow, "id" | "user_id" | "ticker" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_thesis_checks: {
        Row: UserThesisCheckRow;
        Insert: Omit<
          UserThesisCheckRow,
          | "id"
          | "result_status"
          | "summary"
          | "strengthening_points"
          | "weakening_points"
          | "neutral_points"
          | "next_questions"
          | "basis_release_id"
          | "basis_period"
          | "source_chat_session_id"
          | "source_message_id"
          | "created_at"
        > & {
          id?: string;
          result_status?: UserThesisCheckRow["result_status"];
          summary?: string;
          strengthening_points?: string[];
          weakening_points?: string[];
          neutral_points?: string[];
          next_questions?: string[];
          basis_release_id?: string | null;
          basis_period?: string | null;
          source_chat_session_id?: string | null;
          source_message_id?: string | null;
          created_at?: string;
        };
        Update: Partial<Omit<UserThesisCheckRow, "id" | "thesis_id" | "user_id" | "ticker" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_research_notes: {
        Row: UserResearchNoteRow;
        Insert: Omit<
          UserResearchNoteRow,
          | "id"
          | "body"
          | "note_type"
          | "tags"
          | "source_chat_session_id"
          | "source_message_id"
          | "created_at"
          | "updated_at"
        > & {
          id?: string;
          body?: string;
          note_type?: UserResearchNoteRow["note_type"];
          tags?: string[];
          source_chat_session_id?: string | null;
          source_message_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<UserResearchNoteRow, "id" | "user_id" | "ticker" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_research_note_sources: {
        Row: UserResearchNoteSourceRow;
        Insert: Omit<
          UserResearchNoteSourceRow,
          | "id"
          | "citation_id"
          | "run_id"
          | "message_id"
          | "ontology_object_id"
          | "document_type"
          | "filing_period"
          | "created_at"
        > & {
          id?: string;
          citation_id?: string | null;
          run_id?: string | null;
          message_id?: string | null;
          ontology_object_id?: string | null;
          document_type?: string | null;
          filing_period?: string | null;
          created_at?: string;
        };
        Update: Partial<Omit<UserResearchNoteSourceRow, "id" | "note_id" | "user_id" | "ticker" | "created_at">>;
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
      billing_plans: {
        Row: BillingPlanRow;
        Insert: Omit<BillingPlanRow, "created_at" | "updated_at"> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<BillingPlanRow, "key" | "created_at">>;
        Relationships: [];
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
      usage_budget_balances: {
        Row: UsageBudgetBalanceRow;
        Insert: Omit<
          UsageBudgetBalanceRow,
          | "settled_cost_usd"
          | "reserved_cost_usd"
          | "released_cost_usd"
          | "run_count"
          | "updated_at"
        > & {
          settled_cost_usd?: number;
          reserved_cost_usd?: number;
          released_cost_usd?: number;
          run_count?: number;
          updated_at?: string;
        };
        Update: Partial<
          Omit<
            UsageBudgetBalanceRow,
            "user_id" | "period_kind" | "period_start" | "period_end"
          >
        >;
        Relationships: [];
      };
      run_budgets: {
        Row: RunBudgetRow;
        Insert: Omit<
          RunBudgetRow,
          | "id"
          | "run_id"
          | "settled_cost_usd"
          | "status"
          | "reason"
          | "metadata"
          | "created_at"
          | "settled_at"
        > & {
          id?: string;
          run_id?: string | null;
          settled_cost_usd?: number;
          status?: RunBudgetRow["status"];
          reason?: string | null;
          metadata?: Json;
          created_at?: string;
          settled_at?: string | null;
        };
        Update: Partial<Omit<RunBudgetRow, "id" | "user_id" | "request_id" | "created_at">>;
        Relationships: [];
      };
      usage_ledger: {
        Row: UsageLedgerRow;
        Insert: Omit<UsageLedgerRow, "id" | "created_at" | "metadata"> & {
          id?: string;
          metadata?: Json;
          created_at?: string;
        };
        Update: Partial<Omit<UsageLedgerRow, "id" | "created_at">>;
        Relationships: [];
      };
      credit_policies: {
        Row: CreditPolicyRow;
        Insert: Omit<CreditPolicyRow, "created_at"> & {
          created_at?: string;
        };
        Update: Partial<Omit<CreditPolicyRow, "version" | "created_at">>;
        Relationships: [];
      };
      provider_pricing_policies: {
        Row: ProviderPricingPolicyRow;
        Insert: Omit<
          ProviderPricingPolicyRow,
          "created_at" | "source_url" | "verified_at"
        > & {
          source_url?: string | null;
          verified_at?: string | null;
          created_at?: string;
        };
        Update: Partial<Omit<ProviderPricingPolicyRow, "version" | "created_at">>;
        Relationships: [];
      };
      billing_plan_versions: {
        Row: BillingPlanVersionRow;
        Insert: Omit<BillingPlanVersionRow, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<BillingPlanVersionRow, "id" | "plan_key" | "created_at">>;
        Relationships: [];
      };
      billing_toss_customers: {
        Row: BillingTossCustomerRow;
        Insert: Omit<BillingTossCustomerRow, "created_at" | "updated_at"> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<BillingTossCustomerRow, "user_id" | "created_at">>;
        Relationships: [];
      };
      billing_toss_checkout_sessions: {
        Row: BillingTossCheckoutSessionRow;
        Insert: Omit<
          BillingTossCheckoutSessionRow,
          | "id"
          | "currency"
          | "status"
          | "auth_key_received_at"
          | "failure_code"
          | "failure_message"
          | "provider_response"
          | "expires_at"
          | "created_at"
          | "updated_at"
        > & {
          id?: string;
          currency?: "KRW";
          status?: BillingTossCheckoutSessionRow["status"];
          auth_key_received_at?: string | null;
          billing_key_idempotency_key?: string;
          failure_code?: string | null;
          failure_message?: string | null;
          provider_response?: Json;
          expires_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Omit<BillingTossCheckoutSessionRow, "id" | "user_id" | "created_at">
        >;
        Relationships: [];
      };
      billing_toss_subscriptions: {
        Row: BillingTossSubscriptionRow;
        Insert: Omit<
          BillingTossSubscriptionRow,
          | "id"
          | "status"
          | "billing_method"
          | "card_snapshot"
          | "cancel_at_period_end"
          | "cancelled_at"
          | "grace_until"
          | "renewal_due_at"
          | "renewal_attempt_count"
          | "renewal_lease_owner"
          | "renewal_lease_expires_at"
          | "pending_plan_key"
          | "pending_plan_version_id"
          | "last_payment_id"
          | "created_at"
          | "updated_at"
        > & {
          id?: string;
          status?: BillingTossSubscriptionRow["status"];
          billing_method?: BillingTossSubscriptionRow["billing_method"];
          card_snapshot?: Json;
          cancel_at_period_end?: boolean;
          cancelled_at?: string | null;
          grace_until?: string | null;
          renewal_due_at?: string;
          renewal_attempt_count?: number;
          renewal_lease_owner?: string | null;
          renewal_lease_expires_at?: string | null;
          pending_plan_key?: BillingTossPlanKey | null;
          pending_plan_version_id?: string | null;
          last_payment_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<BillingTossSubscriptionRow, "id" | "user_id" | "created_at">>;
        Relationships: [];
      };
      billing_toss_payments: {
        Row: BillingTossPaymentRow;
        Insert: Omit<
          BillingTossPaymentRow,
          | "id"
          | "currency"
          | "billing_period_start"
          | "billing_period_end"
          | "attempt_number"
          | "status"
          | "provider_payment_key"
          | "provider_status"
          | "failure_code"
          | "failure_message"
          | "provider_response"
          | "requested_at"
          | "approved_at"
          | "paid_at"
          | "created_at"
          | "updated_at"
        > & {
          id?: string;
          currency?: "KRW";
          billing_period_start?: string | null;
          billing_period_end?: string | null;
          attempt_number?: number;
          status?: BillingTossPaymentRow["status"];
          provider_payment_key?: string | null;
          provider_status?: string | null;
          failure_code?: string | null;
          failure_message?: string | null;
          provider_response?: Json;
          requested_at?: string | null;
          approved_at?: string | null;
          paid_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<BillingTossPaymentRow, "id" | "user_id" | "created_at">>;
        Relationships: [];
      };
      usage_credit_balances: {
        Row: UsageCreditBalanceRow;
        Insert: Omit<
          UsageCreditBalanceRow,
          | "credits_used_raw"
          | "credits_reserved_raw"
          | "credits_released_raw"
          | "actual_provider_cost_usd"
          | "run_count"
          | "updated_at"
        > & {
          credits_used_raw?: number;
          credits_reserved_raw?: number;
          credits_released_raw?: number;
          actual_provider_cost_usd?: number;
          run_count?: number;
          updated_at?: string;
        };
        Update: Partial<
          Omit<
            UsageCreditBalanceRow,
            "user_id" | "period_kind" | "period_start" | "period_end"
          >
        >;
        Relationships: [];
      };
      run_credit_reservations: {
        Row: RunCreditReservationRow;
        Insert: Omit<
          RunCreditReservationRow,
          | "id"
          | "run_id"
          | "settled_credits_raw"
          | "status"
          | "terminal_status"
          | "input_tokens"
          | "output_tokens"
          | "prompt_cache_hit_tokens"
          | "prompt_cache_miss_tokens"
          | "actual_provider_cost_usd"
          | "metadata"
          | "created_at"
          | "settled_at"
        > & {
          id?: string;
          run_id?: string | null;
          settled_credits_raw?: number;
          status?: RunCreditReservationRow["status"];
          terminal_status?: string | null;
          input_tokens?: number;
          output_tokens?: number;
          prompt_cache_hit_tokens?: number;
          prompt_cache_miss_tokens?: number;
          actual_provider_cost_usd?: number;
          metadata?: Json;
          created_at?: string;
          settled_at?: string | null;
        };
        Update: Partial<Omit<RunCreditReservationRow, "id" | "user_id" | "request_id" | "created_at">>;
        Relationships: [];
      };
      usage_credit_ledger: {
        Row: UsageCreditLedgerRow;
        Insert: Omit<UsageCreditLedgerRow, "id" | "created_at" | "metadata"> & {
          id?: string;
          metadata?: Json;
          created_at?: string;
        };
        Update: Partial<Omit<UsageCreditLedgerRow, "id" | "created_at">>;
        Relationships: [];
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
      chat_message_artifacts: {
        Row: ChatMessageArtifactRow;
        Insert: Omit<ChatMessageArtifactRow, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<ChatMessageArtifactRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      chat_message_charts: {
        Row: ChatMessageChartRow;
        Insert: Omit<ChatMessageChartRow, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<ChatMessageChartRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      chat_message_artifact_selections: {
        Row: ChatMessageArtifactSelectionRow;
        Insert: Omit<ChatMessageArtifactSelectionRow, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<
          Omit<ChatMessageArtifactSelectionRow, "id" | "created_at">
        >;
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
      reserve_execution_budget: {
        Args: {
          p_user_id: string;
          p_request_id: string;
          p_monthly_period_start: string;
          p_monthly_period_end: string;
          p_daily_period_start: string;
          p_daily_period_end: string;
          p_monthly_budget_usd: number;
          p_daily_budget_usd: number;
          p_reserve_cost_usd: number;
          p_expires_at: string;
        };
        Returns: Array<{
          allowed: boolean;
          reason: string | null;
          reservation_id: string | null;
          monthly_used_usd: number;
          monthly_reserved_usd: number;
          monthly_limit_usd: number;
          daily_used_usd: number;
          daily_reserved_usd: number;
          daily_limit_usd: number;
        }>;
      };
      attach_execution_budget_run: {
        Args: {
          p_user_id: string;
          p_request_id: string;
          p_run_id: string;
        };
        Returns: undefined;
      };
      settle_execution_budget: {
        Args: {
          p_user_id: string;
          p_request_id: string;
          p_run_id: string | null;
          p_actual_cost_usd: number;
          p_terminal_status: string;
          p_metadata: Json;
        };
        Returns: Array<{
          settled: boolean;
          reservation_id: string | null;
          settled_cost_usd: number;
        }>;
      };
      release_execution_budget: {
        Args: {
          p_user_id: string;
          p_request_id: string;
          p_run_id: string | null;
          p_reason: string;
        };
        Returns: Array<{
          released: boolean;
          reservation_id: string | null;
          released_cost_usd: number;
        }>;
      };
      reserve_analysis_credits: {
        Args: {
          p_user_id: string;
          p_request_id: string;
          p_reserve_credits_raw: number;
          p_expires_at: string;
          p_now?: string;
        };
        Returns: Array<{
          allowed: boolean;
          reason: string | null;
          reservation_id: string | null;
          period_start: string | null;
          period_end: string | null;
          credits_used_raw: number;
          credits_reserved_raw: number;
          credits_limit_raw: number;
        }>;
      };
      attach_analysis_credit_run: {
        Args: {
          p_user_id: string;
          p_request_id: string;
          p_run_id: string;
        };
        Returns: undefined;
      };
      settle_analysis_credits: {
        Args: {
          p_user_id: string;
          p_request_id: string;
          p_run_id: string | null;
          p_terminal_status: string;
          p_settled_credits_raw: number;
          p_input_tokens: number;
          p_output_tokens: number;
          p_prompt_cache_hit_tokens: number;
          p_prompt_cache_miss_tokens: number;
          p_provider: string;
          p_provider_model: string;
          p_provider_model_version: string;
          p_pricing_version: string;
          p_actual_provider_cost_usd: number;
          p_metadata: Json;
        };
        Returns: Array<{
          settled: boolean;
          reservation_id: string | null;
          settled_credits_raw: number;
        }>;
      };
      release_analysis_credits: {
        Args: {
          p_user_id: string;
          p_request_id: string;
          p_run_id: string | null;
          p_reason: string;
        };
        Returns: Array<{
          released: boolean;
          reservation_id: string | null;
          released_credits_raw: number;
        }>;
      };
      expire_stale_analysis_credit_reservations: {
        Args: {
          p_now?: string;
        };
        Returns: number;
      };
      complete_desktop_device_login: {
        Args: {
          p_device_code_hash: string;
          p_new_access_token_hash: string;
          p_new_access_expires_at: string;
          p_new_refresh_token_hash: string;
          p_new_refresh_expires_at: string;
          p_now?: string;
        };
        Returns: Array<{
          completed: boolean;
          user_id: string | null;
          device_id: string | null;
          device_name: string | null;
          device_status: string | null;
        }>;
      };
      exchange_desktop_authorization_code: {
        Args: {
          p_authorization_code_hash: string;
          p_client_id: string;
          p_redirect_uri: string;
          p_code_challenge: string;
          p_new_access_token_hash: string;
          p_new_access_expires_at: string;
          p_new_refresh_token_hash: string;
          p_new_refresh_expires_at: string;
          p_now?: string;
        };
        Returns: Array<{
          exchanged: boolean;
          user_id: string | null;
          device_id: string | null;
          device_name: string | null;
          device_status: string | null;
        }>;
      };
      record_desktop_llm_job_usage: {
        Args: {
          p_job_id: string;
          p_input_tokens: number;
          p_output_tokens: number;
          p_cache_read_input_tokens: number;
          p_cache_creation_input_tokens: number;
          p_upstream_ok: boolean;
          p_now?: string;
        };
        Returns: undefined;
      };
      rotate_desktop_refresh_token: {
        Args: {
          p_device_id: string;
          p_current_token_hash: string;
          p_new_access_token_hash: string;
          p_new_access_expires_at: string;
          p_new_refresh_token_hash: string;
          p_new_refresh_expires_at: string;
          p_now?: string;
        };
        Returns: Array<{
          rotated: boolean;
          user_id: string | null;
          device_id: string | null;
        }>;
      };
      claim_due_toss_subscriptions: {
        Args: {
          p_worker_id: string;
          p_now?: string;
          p_limit?: number;
          p_lease_seconds?: number;
        };
        Returns: Array<{
          subscription_id: string;
        }>;
      };
      mark_agent_run_terminal: {
        Args: {
          p_run_id: string;
          p_status: AgentRunRow["status"];
          p_finished_at: string | null;
          p_error_code: string | null;
          p_error_message: string | null;
          p_input_tokens: number | null;
          p_output_tokens: number | null;
          p_estimated_cost_usd: number | null;
          p_latency_ms: number | null;
          p_assistant_message_id: string | null;
          p_open_tool_error_message: string | null;
        };
        Returns: boolean;
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
      claim_agent_run: {
        Args: {
          p_worker_id: string;
          p_worker_env: "dev" | "staging" | "prod";
          p_ontology_env: "dev" | "staging" | "prod";
          p_lease_seconds: number;
          p_global_limit: number;
        };
        Returns: Array<{ id: string }>;
      };
      claim_document_ingestion_job: {
        Args: {
          p_worker_id: string;
          p_lease_seconds: number;
          p_global_limit: number;
        };
        Returns: Array<{ id: string }>;
      };
      get_agent_run_queue_state: {
        Args: {
          p_run_id: string;
          p_global_limit: number;
        };
        Returns: Array<{
          status: AgentRunRow["status"];
          queued_ahead: number;
          running_count: number;
          concurrency_limit: number;
          queued_at: string | null;
        }>;
      };
      heartbeat_agent_run: {
        Args: {
          p_run_id: string;
          p_worker_id: string;
          p_lease_seconds: number;
        };
        Returns: boolean;
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
      publish_ontology_web_catalog: {
        Args: {
          p_catalog: Json;
        };
        Returns: Array<{
          env: "dev" | "staging" | "prod";
          release_id: string;
          company_count: number;
          document_count: number;
          object_count: number;
        }>;
      };
    };
    Enums: Record<string, string>;
    CompositeTypes: Record<string, never>;
  };
}
