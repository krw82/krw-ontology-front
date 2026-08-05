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
  source_filing_event_id?: string | null;
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

export interface SessionShareMessage {
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export interface SessionShareRow {
  id: string;
  token: string;
  owner_user_id: string;
  source_session_id: string;
  title: string;
  tickers: string[] | null;
  locale: string;
  messages: SessionShareMessage[];
  message_count: number;
  share_context: Record<string, unknown>;
  snapshot_version: number;
  created_at: string;
  revoked_at: string | null;
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
  storage_kind: "local_fs" | "object_storage";
  original_path: string | null;
  original_object_path: string | null;
  extracted_object_path: string | null;
  chunks_object_path: string | null;
  content_hash: string | null;
  extracted_md: string | null;
  extracted_char_count: number | null;
  extraction_status:
    | "uploaded"
    | "queued"
    | "processing"
    | "completed"
    | "failed"
    | "cancelled"
    | "expired";
  extraction_stage:
    | "accepted"
    | "extracting"
    | "chunking"
    | "embedding"
    | "indexing"
    | "completed"
    | "failed";
  progress_percent: number;
  last_event_seq: number;
  error_code: string | null;
  error_message: string | null;
  extraction_error: string | null;
  expires_at: string;
  created_at: string;
  updated_at: string;
}

export interface DocumentIngestionJobRow extends Record<string, unknown> {
  id: string;
  attachment_id: string;
  status: "queued" | "running" | "processing" | "completed" | "failed" | "cancelled";
  stage:
    | "accepted"
    | "extracting"
    | "chunking"
    | "embedding"
    | "indexing"
    | "completed"
    | "failed";
  progress_percent: number;
  last_event_seq: number;
  queue_job_id: string | null;
  worker_id: string | null;
  claim_token: string | null;
  claim_version: number;
  attempts: number;
  max_attempts: number;
  queued_at: string;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  lease_expires_at: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentSourceCleanupJobRow extends Record<string, unknown> {
  id: string;
  attachment_id: string;
  ingestion_job_id: string;
  storage_kind: "local_fs" | "object_storage";
  source_path: string;
  status: "pending" | "processing" | "failed" | "completed" | "unsupported";
  worker_id: string | null;
  claim_token: string | null;
  claim_version: number;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  lease_expires_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface DocumentJobOutboxRow extends Record<string, unknown> {
  id: string;
  job_id: string;
  queue_name: string;
  queue_job_id: string;
  payload_json: Json;
  status: "pending" | "dispatched" | "failed";
  attempts: number;
  next_attempt_at: string;
  dispatched_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDocumentIngestionJobResult extends Record<string, unknown> {
  attachment: ChatAttachmentRow;
  job: DocumentIngestionJobRow;
  queue_name: string;
  queue_job_id: string;
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

export interface ChatMessageVisualizationRow extends Record<string, unknown> {
  id: string;
  session_id: string;
  message_id: string;
  run_id: string;
  artifact_ref: string;
  payload_json: Json;
  created_at: string;
}

export interface ChatMessagePresentationRow extends Record<string, unknown> {
  message_id: string;
  session_id: string;
  run_id: string;
  blocks_json: Json;
  created_at: string;
  updated_at: string;
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
  browse_core_strength: string | null;
  browse_critical_risk: string | null;
  coverage_json: Json;
  documents_json: Json;
  company_json: Json;
  generated_at: string | null;
  sec_cik: string | null;
  sec_ticker: string | null;
  sec_mapping_source: "exact" | "verified_alias" | "catalog_native" | null;
  sec_mapping_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserCompanyMarkRow extends Record<string, unknown> {
  user_id: string;
  ticker: string;
  coverage_level: "interest" | null;
  coverage_cleared_at: string | null;
  priority: number;
  interest_reason: string | null;
  tags: string[];
  last_activity_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserCompanyCoverageEventRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  ticker: string;
  previous_coverage_level: UserCompanyMarkRow["coverage_level"];
  coverage_level: UserCompanyMarkRow["coverage_level"];
  event_type:
    | "selected"
    | "level_changed"
    | "cleared"
    | "unchanged"
    | "plan_reconciliation"
    | "legacy";
  changed: boolean;
  source: string;
  idempotency_key: string;
  request_payload: Json;
  response_payload: Json;
  created_at: string;
}

export interface UserFilingJudgmentRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  filing_event_id: string;
  ticker: string;
  current_revision_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserFilingJudgmentRevisionRow extends Record<string, unknown> {
  id: string;
  judgment_id: string;
  user_id: string;
  filing_event_id: string;
  ticker: string;
  revision_number: number;
  impact: "positive" | "neutral" | "negative" | "unclear";
  next_action: "complete" | "update_thesis" | "create_question" | "review_later";
  summary: string;
  rationale: string;
  is_current: boolean;
  idempotency_key: string;
  request_payload: Json;
  created_at: string;
}

export interface UserFilingJudgmentThesisLinkRow extends Record<string, unknown> {
  revision_id: string;
  judgment_id: string;
  user_id: string;
  filing_event_id: string;
  ticker: string;
  thesis_id: string;
  impact: UserFilingJudgmentRevisionRow["impact"];
  position: number;
  is_current: boolean;
  created_at: string;
}

export interface UserCompanyMonitoringRuleRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  ticker: string;
  rule_type: "filing_form" | "filing_item" | "keyword" | "scheduled_review";
  operator: "matches" | "contains" | "on_or_after";
  value: string | null;
  next_review_at: string | null;
  dedupe_key: string;
  enabled: boolean;
  created_by_judgment_revision_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserFilingJudgmentMonitoringRuleRow extends Record<string, unknown> {
  revision_id: string;
  rule_id: string;
  user_id: string;
  position: number;
  created_at: string;
}

export interface UserFilingSourceOpenRow extends Record<string, unknown> {
  user_id: string;
  filing_event_id: string;
  ticker: string;
  first_opened_at: string;
  last_opened_at: string;
}

export interface UserRetentionMilestoneRow extends Record<string, unknown> {
  user_id: string;
  milestone: "coverage_activated";
  achieved_at: string;
  metadata: Json;
}

export type SecFilingFormType = "8-K" | "8-K/A" | "6-K" | "6-K/A" | "4" | "4/A";

export interface SecCompanyIdentifierRow extends Record<string, unknown> {
  ticker: string;
  cik: string | null;
  company_name: string | null;
  lookup_status: "pending" | "resolved" | "not_found" | "failed";
  last_checked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecFilingEventRow extends Record<string, unknown> {
  id: string;
  env: "dev" | "staging" | "prod";
  ticker: string;
  cik: string;
  accession_number: string;
  form_type: SecFilingFormType;
  is_amendment: boolean;
  filing_date: string;
  report_date: string | null;
  accepted_at: string | null;
  primary_document_name: string | null;
  filing_detail_url: string;
  primary_document_url: string | null;
  source_metadata: Json;
  first_seen_at: string;
  sec_items: string[];
  event_tags: string[];
  primary_event_tag: string | null;
  classification_source: "sec_items" | "metadata" | "unclassified";
  classification_version: number;
  alert_priority: "urgent" | "normal" | "digest";
  enrichment_status: "not_requested" | "queued" | "ready" | "failed";
  event_family: "material_event" | "insider_trade";
  discovery_source: "legacy" | "atom" | "submissions" | "daily_index";
  processing_status: "discovered" | "processing" | "ready" | "failed";
  feed_eligible: boolean;
  feed_available_at: string | null;
  feed_expires_at: string | null;
  feed_lane: number | null;
  feed_priority_rank: number | null;
  occurred_at: string;
  parser_version: number;
  original_filing_date: string | null;
  processing_error: string | null;
  // Reserved for the future 8-K/6-K automatic analysis pipeline.
  analysis_status: "not_requested" | "queued" | "processing" | "ready" | "failed";
  analysis_requested_at: string | null;
  analysis_completed_at: string | null;
  analysis_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface PulseGlobalFilingCandidateRow extends Record<string, unknown> {
  env: "dev" | "staging" | "prod";
  filing_event_id: string;
  ticker: string;
  covered_tickers: string[];
  alert_priority: "urgent" | "normal" | "digest";
  priority_rank: number | null;
  occurred_at: string;
  available_at: string;
  expires_at: string | null;
  payload: Json;
  candidate_updated_at: string;
}

export interface PulseGlobalCandidateTickerRow extends Record<string, unknown> {
  env: "dev" | "staging" | "prod";
  filing_event_id: string;
  ticker: string;
}

export interface PulseGlobalFeedRevisionRow extends Record<string, unknown> {
  env: "dev" | "staging" | "prod";
  revision: number;
  updated_at: string;
}

export interface UserPulseFeedRevisionRow extends Record<string, unknown> {
  user_id: string;
  revision: number;
  updated_at: string;
}

export interface FilingNotificationPreferencesRow extends Record<string, unknown> {
  user_id: string;
  enabled: boolean;
  notify_8k: boolean;
  notify_6k: boolean;
  notify_form4: boolean;
  include_amendments: boolean;
  insider_notification_mode: "none" | "reported_p_s" | "all";
  delivery_mode: "important_immediate" | "all_immediate" | "daily_digest";
  daily_digest_at: string;
  last_digest_at: string | null;
  timezone: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserFilingSubscriptionRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  ticker: string;
  cik: string;
  env: "dev" | "staging" | "prod";
  catalog_collection_status: "active" | "dormant";
  enabled: boolean;
  alert_preset: "important" | "all";
  delivery_mode: "inherit" | "important_immediate" | "all_immediate" | "daily_digest";
  subscribed_at: string;
  disabled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecFilingPollStateRow extends Record<string, unknown> {
  cik: string;
  enabled: boolean;
  baseline_completed_at: string | null;
  last_polled_at: string | null;
  last_success_at: string | null;
  next_poll_at: string;
  consecutive_errors: number;
  last_error: string | null;
  worker_id: string | null;
  claim_token: string | null;
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecFilingDocumentRow extends Record<string, unknown> {
  id: string;
  filing_event_id: string;
  sequence: number | null;
  document_name: string;
  document_type: string | null;
  description: string | null;
  document_url: string;
  size_bytes: number | null;
  is_primary: boolean;
  recommendation_score: number;
  created_at: string;
  updated_at: string;
}

export interface SecFilingEventCatalogCoverageRow extends Record<string, unknown> {
  filing_event_id: string;
  env: "dev" | "staging" | "prod";
  release_id: string;
  ticker: string;
  covered_at: string;
  created_at: string;
}

export interface SecFilingDiscoveryCheckpointRow extends Record<string, unknown> {
  env: "dev" | "staging" | "prod";
  source_key: "atom:8-K" | "atom:8-K/A" | "atom:6-K" | "atom:6-K/A" | "atom:4" | "atom:4/A" | "daily_index:master";
  enabled: boolean;
  watermark_at: string | null;
  watermark_accession: string | null;
  next_poll_at: string;
  last_success_at: string | null;
  consecutive_errors: number;
  gap_risk: boolean;
  worker_id: string | null;
  claim_token: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecCatalogFilingReconciliationStateRow extends Record<string, unknown> {
  env: "dev" | "staging" | "prod";
  cik: string;
  enabled: boolean;
  coverage_started_at: string;
  baseline_completed_at: string | null;
  last_polled_at: string | null;
  last_success_at: string | null;
  next_poll_at: string;
  consecutive_errors: number;
  last_error: string | null;
  worker_id: string | null;
  claim_token: string | null;
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecFilingWorkerLeaseRow extends Record<string, unknown> {
  env: "dev" | "staging" | "prod";
  lease_key: "sec_request_scheduler";
  deployment_id: string;
  worker_id: string;
  claim_token: string;
  lease_expires_at: string;
  heartbeat_at: string;
  created_at: string;
  updated_at: string;
}

export interface SecFilingProcessingJobRow extends Record<string, unknown> {
  id: string;
  env: "dev" | "staging" | "prod";
  filing_event_id: string;
  stage: "enrich" | "notification_fanout" | "brief";
  status: "queued" | "claimed" | "retry" | "completed" | "failed";
  priority: number;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  worker_id: string | null;
  claim_token: string | null;
  lease_expires_at: string | null;
  progress_json: Json;
  last_error: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Source-grounded Korean brief. It holds no raw SEC document body. */
export interface SecFilingBriefRow extends Record<string, unknown> {
  filing_event_id: string;
  locale: "ko-KR";
  headline_ko: string;
  summary_sentences: Json;
  facts: Json;
  question_suggestions: Json;
  uncertainty_notes: Json;
  source_document_url: string;
  source_sha256: string;
  source_section_keys: string[];
  source_truncated: boolean;
  input_char_count: number;
  generator_model: string;
  prompt_version: string;
  schema_version: number;
  generated_at: string;
  created_at: string;
  updated_at: string;
}

/** Immutable operational audit rows for a filing-brief generation attempt. */
export interface SecFilingBriefRunRow extends Record<string, unknown> {
  id: string;
  env: "dev" | "staging" | "prod";
  filing_event_id: string;
  job_id: string | null;
  outcome: "succeeded" | "failed" | "validation_failed";
  model: string;
  prompt_version: string;
  schema_version: number;
  source_document_url: string | null;
  source_sha256: string | null;
  source_truncated: boolean | null;
  input_char_count: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_input_tokens: number | null;
  provider_cost_usd: number | null;
  latency_ms: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  completed_at: string;
}

export interface SecForm4ReportingOwnerRow extends Record<string, unknown> {
  filing_event_id: string;
  reporting_owner_index: number;
  owner_cik: string | null;
  owner_name: string;
  is_director: boolean;
  is_officer: boolean;
  is_ten_percent_owner: boolean;
  is_other: boolean;
  officer_title: string | null;
  created_at: string;
  updated_at: string;
}

export interface SecForm4TransactionRow extends Record<string, unknown> {
  id: string;
  filing_event_id: string;
  reporting_owner_index: number;
  transaction_index: number;
  security_kind: "non_derivative" | "derivative";
  security_title: string;
  transaction_date: string | null;
  transaction_code: string | null;
  equity_swap_involved: boolean | null;
  transaction_shares: number | null;
  transaction_price_per_share: number | null;
  acquired_disposed_code: "A" | "D" | null;
  shares_owned_following: number | null;
  direct_indirect_code: "D" | "I" | null;
  nature_of_ownership: string | null;
  reported_transaction_value: number | null;
  reported_value_basis: "p_or_s" | "not_reported";
  footnotes: Json;
  created_at: string;
  updated_at: string;
}

export interface SecForm4EventSummaryRow extends Record<string, unknown> {
  filing_event_id: string;
  reporting_owner_count: number;
  transaction_count: number;
  reported_purchase_count: number;
  reported_sale_count: number;
  reported_purchase_shares: number | null;
  reported_sale_shares: number | null;
  reported_purchase_value: number | null;
  reported_sale_value: number | null;
  net_reported_shares: number | null;
  tenb5_one_status: "yes" | "no" | "unknown";
  has_reported_open_market_trade: boolean;
  source_xml_version: string | null;
  created_at: string;
  updated_at: string;
}

export interface FilingNotificationWorkerHeartbeatRow extends Record<string, unknown> {
  worker_id: string;
  detection_enabled: boolean;
  push_enabled: boolean;
  last_seen_at: string;
  last_success_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface PushSubscriptionRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  endpoint_hash: string | null;
  expiration_time: string | null;
  vapid_key_id: string;
  status: "active" | "revoked";
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

export interface UserFilingNotificationRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  filing_event_id: string;
  kind: "filing_received" | "analysis_ready" | "filing_digest";
  title: string;
  body: string;
  destination_path: string;
  read_at: string | null;
  clicked_at: string | null;
  pinned_at: string | null;
  snoozed_until: string | null;
  archived_at: string | null;
  digest_bucket: string;
  created_at: string;
  updated_at: string;
}

export interface UserPulsePreferencesRow extends Record<string, unknown> {
  user_id: string;
  timezone: string;
  enabled_kinds: Array<"filing" | "analysis" | "checkup" | "question" | "resurface" | "learning" | "news">;
  muted_tickers: string[];
  daily_checkup_enabled: boolean;
  daily_checkup_at: string;
  question_cadence: "daily" | "three_weekly" | "off";
  resurface_cadence: "weekly" | "biweekly" | "off";
  learning_cadence: "weekly" | "off";
  learning_enabled: boolean;
  resurfacing_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserOnboardingStateRow extends Record<string, unknown> {
  user_id: string;
  onboarding_version: 2;
  status: "not_started" | "in_progress" | "completed" | "skipped";
  started_at: string | null;
  first_company_selected_at: string | null;
  first_question_started_at: string | null;
  first_evidence_opened_at: string | null;
  completed_at: string | null;
  skipped_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserPulseItemStateRow extends Record<string, unknown> {
  user_id: string;
  item_key: string;
  source_type: "filing" | "analysis" | "checkup" | "question" | "resurface" | "learning" | "news";
  source_id: string;
  kind: "filing" | "analysis" | "checkup" | "question" | "resurface" | "learning" | "news";
  first_seen_at: string | null;
  reviewed_at: string | null;
  saved_at: string | null;
  snoozed_until: string | null;
  dismissed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserFilingKeywordRuleRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  ticker: string | null;
  phrase: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface FilingKeywordMatchRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  filing_event_id: string;
  rule_id: string;
  document_name: string | null;
  matched_context: string;
  created_at: string;
}

export interface FilingPushReceiptRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  notification_id: string | null;
  receipt_key: string;
  receipt_type: "sw_push_received" | "notification_show_called" | "notification_clicked" | "test_push_received";
  created_at: string;
}

export interface UserFilingFeedTokenRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  token_hash: string;
  last_used_at: string | null;
  revoked_at: string | null;
  created_at: string;
}

export interface FilingNotificationDeliveryRow extends Record<string, unknown> {
  id: string;
  notification_id: string;
  subscription_id: string;
  status: "pending" | "claimed" | "sent" | "retry" | "failed";
  attempts: number;
  next_attempt_at: string;
  worker_id: string | null;
  claim_token: string | null;
  lease_expires_at: string | null;
  provider_status: number | null;
  last_error: string | null;
  sent_at: string | null;
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
  monitored_variables: string[];
  counter_evidence: string;
  decision_change_condition: string;
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

export type BillingTossOperationKind =
  | "subscribe"
  | "upgrade"
  | "downgrade"
  | "cancel_subscription"
  | "resume_subscription"
  | "cancel_plan_change"
  | "replace_payment_method";

export type BillingTossOperationStatus =
  | "prepared"
  | "awaiting_auth"
  | "processing"
  | "payment_uncertain"
  | "paid_pending_apply"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "expired";

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
    | "processing"
    | "paid"
    | "failed"
    | "cancelled"
    | "expired"
    | "superseded";
  success_url: string;
  fail_url: string;
  auth_key_received_at: string | null;
  billing_key_idempotency_key: string;
  purpose: "initial_subscription" | "replace_payment_method";
  operation_id: string | null;
  callback_token_hash: string | null;
  processing_started_at: string | null;
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
  terminal_entitlement_applied_at: string | null;
  billing_key_delete_pending: boolean;
  billing_key_deleted_at: string | null;
  last_payment_id: string | null;
  state_version: number;
  active_operation_id: string | null;
  active_operation_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BillingTossPaymentRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  subscription_id: string | null;
  checkout_session_id: string | null;
  operation_id: string | null;
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
  fulfillment_status: "pending" | "failed" | "applied";
  fulfillment_error: string | null;
  fulfillment_attempted_at: string | null;
  fulfillment_applied_at: string | null;
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

export interface BillingTossOperationRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  subscription_id: string | null;
  kind: BillingTossOperationKind;
  status: BillingTossOperationStatus;
  from_plan_key: BillingTossPlanKey | null;
  target_plan_key: BillingTossPlanKey | null;
  from_plan_version_id: string | null;
  target_plan_version_id: string | null;
  expected_subscription_version: number | null;
  quoted_amount_krw: number;
  next_amount_krw: number;
  effective_at: string | null;
  next_billing_at: string | null;
  payment_id: string | null;
  checkout_session_id: string | null;
  idempotency_key: string;
  failure_code: string | null;
  failure_message: string | null;
  expires_at: string;
  confirmed_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface BillingTossRetiredBillingKeyRow extends Record<string, unknown> {
  id: string;
  user_id: string;
  subscription_id: string;
  billing_key: string;
  status: "pending" | "deleted" | "failed";
  failure_code: string | null;
  attempted_at: string | null;
  deleted_at: string | null;
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
  share_context: Json;
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
    | "onboarding_started"
    | "onboarding_company_selected"
    | "onboarding_question_started"
    | "onboarding_evidence_opened"
    | "onboarding_skipped"
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
    | "subscription_started"
    | "company_followed"
    | "push_permission_requested"
    | "push_permission_prompted"
    | "push_permission_granted"
    | "push_permission_denied"
    | "push_subscribed"
    | "push_unsubscribed"
    | "filing_notification_clicked"
    | "filing_subscription_created"
    | "filing_subscription_removed"
    | "filing_history_loaded"
    | "filing_detail_viewed"
    | "push_notification_clicked"
    | "key_exhibit_opened"
    | "sec_source_opened"
    | "filing_analysis_started"
    | "filing_history_backfilled"
    | "historical_filing_opened"
    | "pwa_install_prompt_seen"
    | "pwa_installed"
    | "test_push_requested"
    | "test_push_received"
    | "filing_detected"
    | "filing_notification_created"
    | "push_provider_accepted"
    | "sw_push_received"
    | "notification_show_called"
    | "notification_clicked"
    | "filings_inbox_viewed"
    | "filing_marked_read"
    | "filing_snoozed"
    | "filing_pinned"
    | "filing_archived"
    | "digest_opened"
    | "alert_rule_created"
    | "alert_rule_removed"
    | "filing_delivery_mode_changed"
    | "amendment_comparison_opened"
    | "company_filing_timeline_viewed"
    | "pulse_viewed"
    | "pulse_item_impression"
    | "pulse_item_opened"
    | "pulse_item_actioned"
    | "pulse_summary_actioned"
    | "pulse_filter_changed"
    | "pulse_preferences_updated"
    | "pulse_new_items_seen"
    | "pulse_refresh_requested"
    | "pulse_refresh_completed"
    | "pulse_refresh_failed"
    | "pulse_end_reached"
    | "pulse_feedback_submitted"
    | "pulse_source_degraded"
    | "pulse_answer_prefilled"
    | "performance_metric_reported"
    | "coverage_level_changed"
    | "coverage_cleared"
    | "coverage_activated"
    | "filing_judgment_started"
    | "filing_judgment_completed"
    | "filing_judgment_revised"
    | "thesis_updated"
    | "monitoring_rule_created"
    | "decision_session_closed"
    | "second_opportunity_resolved";
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

export interface PulseEditorialEntryRow extends Record<string, unknown> {
  id: string;
  series_id: string | null;
  episode_number: number | null;
  company_visible: boolean;
  slug: string;
  status: "draft" | "published" | "archived";
  format: "single_image" | "carousel" | "text";
  title: string;
  body: string;
  ticker: string | null;
  action_label: string | null;
  action_href: string | null;
  publish_at: string | null;
  expires_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PulseEditorialSeriesRow extends Record<string, unknown> {
  id: string;
  ticker: string;
  slug: string;
  status: "draft" | "published" | "archived";
  title: string;
  summary: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface PulseEditorialAssetRow extends Record<string, unknown> {
  id: string;
  entry_id: string;
  position: number;
  storage_path: string;
  alt_text: string;
  mime_type: "image/jpeg" | "image/png" | "image/webp";
  byte_size: number;
  width: number | null;
  height: number | null;
  created_at: string;
}

export interface PulseEditorialDistributionRow extends Record<string, unknown> {
  id: string;
  entry_id: string;
  channel: "pulse";
  status: "draft" | "active" | "paused" | "archived";
  placement: "early" | "standard";
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
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
          | "source_filing_event_id"
        > & {
          id?: string;
          client_request_id?: string | null;
          deleted_at?: string | null;
          last_message_preview?: string | null;
          last_message_at?: string | null;
          latest_run_status?: AgentRunRow["status"] | null;
          source_filing_event_id?: string | null;
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
          | "original_object_path"
          | "extracted_object_path"
          | "chunks_object_path"
          | "content_hash"
          | "extracted_md"
          | "extracted_char_count"
          | "extraction_stage"
          | "progress_percent"
          | "last_event_seq"
          | "error_code"
          | "error_message"
          | "extraction_error"
        > & {
          id?: string;
          session_id?: string | null;
          message_id?: string | null;
          ticker?: string | null;
          original_object_path?: string | null;
          extracted_object_path?: string | null;
          chunks_object_path?: string | null;
          content_hash?: string | null;
          extracted_md?: string | null;
          extracted_char_count?: number | null;
          extraction_stage?: ChatAttachmentRow["extraction_stage"];
          progress_percent?: number;
          last_event_seq?: number;
          error_code?: string | null;
          error_message?: string | null;
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
          | "stage"
          | "progress_percent"
          | "last_event_seq"
          | "queue_job_id"
          | "worker_id"
          | "claim_token"
          | "claim_version"
          | "attempts"
          | "queued_at"
          | "started_at"
          | "completed_at"
          | "cancelled_at"
          | "lease_expires_at"
          | "error_code"
          | "error_message"
          | "created_at"
          | "updated_at"
        > & {
          id?: string;
          status?: DocumentIngestionJobRow["status"];
          stage?: DocumentIngestionJobRow["stage"];
          progress_percent?: number;
          last_event_seq?: number;
          queue_job_id?: string | null;
          worker_id?: string | null;
          claim_token?: string | null;
          claim_version?: number;
          attempts?: number;
          queued_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
          cancelled_at?: string | null;
          lease_expires_at?: string | null;
          error_code?: string | null;
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
      document_source_cleanup_jobs: {
        Row: DocumentSourceCleanupJobRow;
        Insert: Omit<
          DocumentSourceCleanupJobRow,
          | "id"
          | "status"
          | "worker_id"
          | "claim_token"
          | "claim_version"
          | "attempts"
          | "max_attempts"
          | "next_attempt_at"
          | "lease_expires_at"
          | "completed_at"
          | "last_error"
          | "created_at"
          | "updated_at"
        > & {
          id?: string;
          status?: DocumentSourceCleanupJobRow["status"];
          worker_id?: string | null;
          claim_token?: string | null;
          claim_version?: number;
          attempts?: number;
          max_attempts?: number;
          next_attempt_at?: string;
          lease_expires_at?: string | null;
          completed_at?: string | null;
          last_error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<
          Omit<DocumentSourceCleanupJobRow, "id" | "created_at">
        >;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      document_job_outbox: {
        Row: DocumentJobOutboxRow;
        Insert: Omit<
          DocumentJobOutboxRow,
          | "id"
          | "status"
          | "attempts"
          | "next_attempt_at"
          | "dispatched_at"
          | "last_error"
          | "created_at"
          | "updated_at"
        > & {
          id?: string;
          status?: DocumentJobOutboxRow["status"];
          attempts?: number;
          next_attempt_at?: string;
          dispatched_at?: string | null;
          last_error?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<DocumentJobOutboxRow, "id" | "created_at">>;
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
          | "coverage_level"
          | "coverage_cleared_at"
          | "priority"
          | "interest_reason"
          | "tags"
          | "last_activity_at"
          | "created_at"
          | "updated_at"
        > & {
          coverage_level?: UserCompanyMarkRow["coverage_level"];
          coverage_cleared_at?: string | null;
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
      user_company_coverage_events: {
        Row: UserCompanyCoverageEventRow;
        Insert: Pick<
          UserCompanyCoverageEventRow,
          | "user_id"
          | "ticker"
          | "coverage_level"
          | "changed"
          | "source"
          | "idempotency_key"
          | "request_payload"
          | "response_payload"
        > &
          Partial<
            Pick<
              UserCompanyCoverageEventRow,
              "id" | "previous_coverage_level" | "created_at"
              | "event_type"
            >
          >;
        Update: Partial<
          Omit<UserCompanyCoverageEventRow, "id" | "user_id" | "created_at">
        >;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_filing_judgments: {
        Row: UserFilingJudgmentRow;
        Insert: Pick<UserFilingJudgmentRow, "user_id" | "filing_event_id" | "ticker"> &
          Partial<Pick<UserFilingJudgmentRow, "id" | "current_revision_id" | "created_at" | "updated_at">>;
        Update: Partial<Omit<UserFilingJudgmentRow, "id" | "user_id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_filing_judgment_revisions: {
        Row: UserFilingJudgmentRevisionRow;
        Insert: Pick<
          UserFilingJudgmentRevisionRow,
          | "judgment_id"
          | "user_id"
          | "filing_event_id"
          | "ticker"
          | "revision_number"
          | "impact"
          | "next_action"
          | "summary"
          | "idempotency_key"
          | "request_payload"
        > & Partial<Pick<UserFilingJudgmentRevisionRow, "id" | "rationale" | "is_current" | "created_at">>;
        Update: Partial<Omit<UserFilingJudgmentRevisionRow, "id" | "user_id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_filing_judgment_thesis_links: {
        Row: UserFilingJudgmentThesisLinkRow;
        Insert: Omit<UserFilingJudgmentThesisLinkRow, "created_at"> & { created_at?: string };
        Update: Partial<Omit<UserFilingJudgmentThesisLinkRow, "revision_id" | "thesis_id" | "user_id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_company_monitoring_rules: {
        Row: UserCompanyMonitoringRuleRow;
        Insert: Pick<UserCompanyMonitoringRuleRow, "user_id" | "ticker" | "rule_type" | "operator" | "dedupe_key"> &
          Partial<Omit<UserCompanyMonitoringRuleRow, "user_id" | "ticker" | "rule_type" | "operator" | "dedupe_key" | "created_at" | "updated_at">> &
          { created_at?: string; updated_at?: string };
        Update: Partial<Omit<UserCompanyMonitoringRuleRow, "id" | "user_id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_filing_judgment_monitoring_rules: {
        Row: UserFilingJudgmentMonitoringRuleRow;
        Insert: Omit<UserFilingJudgmentMonitoringRuleRow, "created_at"> & { created_at?: string };
        Update: Partial<Omit<UserFilingJudgmentMonitoringRuleRow, "revision_id" | "rule_id" | "user_id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_filing_source_opens: {
        Row: UserFilingSourceOpenRow;
        Insert: Pick<UserFilingSourceOpenRow, "user_id" | "filing_event_id" | "ticker"> &
          Partial<Pick<UserFilingSourceOpenRow, "first_opened_at" | "last_opened_at">>;
        Update: Partial<Pick<UserFilingSourceOpenRow, "ticker" | "last_opened_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_retention_milestones: {
        Row: UserRetentionMilestoneRow;
        Insert: Pick<UserRetentionMilestoneRow, "user_id" | "milestone"> &
          Partial<Pick<UserRetentionMilestoneRow, "achieved_at" | "metadata">>;
        Update: Partial<Pick<UserRetentionMilestoneRow, "achieved_at" | "metadata">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      sec_company_identifiers: {
        Row: SecCompanyIdentifierRow;
        Insert: Pick<SecCompanyIdentifierRow, "ticker"> &
          Partial<Omit<SecCompanyIdentifierRow, "ticker" | "created_at" | "updated_at">> & {
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<SecCompanyIdentifierRow, "ticker" | "created_at">>;
        Relationships: [];
      };
      sec_filing_events: {
        Row: SecFilingEventRow;
        Insert: Pick<
          SecFilingEventRow,
          | "ticker"
          | "cik"
          | "accession_number"
          | "form_type"
          | "filing_date"
          | "filing_detail_url"
        > &
          Partial<
            Omit<
              SecFilingEventRow,
              | "id"
              | "ticker"
              | "cik"
              | "accession_number"
              | "form_type"
              | "filing_date"
              | "filing_detail_url"
              | "created_at"
              | "updated_at"
            >
          > & {
            id?: string;
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<SecFilingEventRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      pulse_global_filing_candidates: {
        Row: PulseGlobalFilingCandidateRow;
        Insert: Pick<PulseGlobalFilingCandidateRow, "env" | "filing_event_id" | "ticker" | "alert_priority" | "occurred_at" | "available_at" | "payload"> &
          Partial<Omit<PulseGlobalFilingCandidateRow, "env" | "filing_event_id" | "ticker" | "alert_priority" | "occurred_at" | "available_at" | "payload" | "candidate_updated_at">> & {
            candidate_updated_at?: string;
          };
        Update: Partial<Omit<PulseGlobalFilingCandidateRow, "env" | "filing_event_id">>;
        Relationships: [];
      };
      pulse_global_candidate_tickers: {
        Row: PulseGlobalCandidateTickerRow;
        Insert: PulseGlobalCandidateTickerRow;
        Update: Partial<PulseGlobalCandidateTickerRow>;
        Relationships: [];
      };
      pulse_global_feed_revisions: {
        Row: PulseGlobalFeedRevisionRow;
        Insert: Pick<PulseGlobalFeedRevisionRow, "env"> & Partial<Omit<PulseGlobalFeedRevisionRow, "env" | "updated_at">> & { updated_at?: string };
        Update: Partial<Omit<PulseGlobalFeedRevisionRow, "env">>;
        Relationships: [];
      };
      filing_notification_preferences: {
        Row: FilingNotificationPreferencesRow;
        Insert: Pick<FilingNotificationPreferencesRow, "user_id"> &
          Partial<Omit<FilingNotificationPreferencesRow, "user_id" | "created_at" | "updated_at">> & {
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<FilingNotificationPreferencesRow, "user_id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_filing_subscriptions: {
        Row: UserFilingSubscriptionRow;
        Insert: Pick<UserFilingSubscriptionRow, "user_id" | "ticker" | "cik"> &
          Partial<
            Omit<
              UserFilingSubscriptionRow,
              "id" | "user_id" | "ticker" | "cik" | "subscribed_at" | "created_at" | "updated_at"
            >
          > & {
            id?: string;
            subscribed_at?: string;
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<UserFilingSubscriptionRow, "id" | "user_id" | "ticker" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      sec_filing_poll_state: {
        Row: SecFilingPollStateRow;
        Insert: Pick<SecFilingPollStateRow, "cik"> &
          Partial<Omit<SecFilingPollStateRow, "cik" | "created_at" | "updated_at">> & {
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<SecFilingPollStateRow, "cik" | "created_at">>;
        Relationships: [];
      };
      sec_filing_documents: {
        Row: SecFilingDocumentRow;
        Insert: Pick<SecFilingDocumentRow, "filing_event_id" | "document_name" | "document_url"> &
          Partial<Omit<SecFilingDocumentRow, "id" | "filing_event_id" | "document_name" | "document_url" | "created_at" | "updated_at">> & {
            id?: string;
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<SecFilingDocumentRow, "id" | "filing_event_id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      sec_filing_event_catalog_coverage: {
        Row: SecFilingEventCatalogCoverageRow;
        Insert: Omit<SecFilingEventCatalogCoverageRow, "covered_at" | "created_at"> & {
          covered_at?: string;
          created_at?: string;
        };
        Update: Partial<Omit<SecFilingEventCatalogCoverageRow, "filing_event_id" | "env" | "release_id" | "ticker" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      sec_filing_discovery_checkpoints: {
        Row: SecFilingDiscoveryCheckpointRow;
        Insert: Pick<SecFilingDiscoveryCheckpointRow, "env" | "source_key"> &
          Partial<Omit<SecFilingDiscoveryCheckpointRow, "env" | "source_key" | "created_at" | "updated_at">> & {
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<SecFilingDiscoveryCheckpointRow, "env" | "source_key" | "created_at">>;
        Relationships: [];
      };
      sec_catalog_filing_reconciliation_state: {
        Row: SecCatalogFilingReconciliationStateRow;
        Insert: Pick<SecCatalogFilingReconciliationStateRow, "env" | "cik"> &
          Partial<Omit<SecCatalogFilingReconciliationStateRow, "env" | "cik" | "created_at" | "updated_at">> & {
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<SecCatalogFilingReconciliationStateRow, "env" | "cik" | "created_at">>;
        Relationships: [];
      };
      sec_filing_worker_leases: {
        Row: SecFilingWorkerLeaseRow;
        Insert: Omit<SecFilingWorkerLeaseRow, "created_at" | "updated_at" | "heartbeat_at"> & {
          heartbeat_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<SecFilingWorkerLeaseRow, "env" | "lease_key" | "created_at">>;
        Relationships: [];
      };
      sec_filing_processing_jobs: {
        Row: SecFilingProcessingJobRow;
        Insert: Pick<SecFilingProcessingJobRow, "env" | "filing_event_id" | "stage"> &
          Partial<Omit<SecFilingProcessingJobRow, "id" | "env" | "filing_event_id" | "stage" | "created_at" | "updated_at">> & {
            id?: string;
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<SecFilingProcessingJobRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      sec_filing_briefs: {
        Row: SecFilingBriefRow;
        Insert: Pick<
          SecFilingBriefRow,
          | "filing_event_id"
          | "headline_ko"
          | "summary_sentences"
          | "facts"
          | "source_document_url"
          | "source_sha256"
          | "source_section_keys"
          | "input_char_count"
          | "generator_model"
          | "prompt_version"
          | "schema_version"
        > &
          Partial<Omit<SecFilingBriefRow, "filing_event_id" | "created_at" | "updated_at">> & {
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<SecFilingBriefRow, "filing_event_id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      sec_filing_brief_runs: {
        Row: SecFilingBriefRunRow;
        Insert: Pick<
          SecFilingBriefRunRow,
          "env" | "filing_event_id" | "outcome" | "model" | "prompt_version" | "schema_version"
        > &
          Partial<Omit<SecFilingBriefRunRow, "id" | "created_at" | "completed_at">> & {
            id?: string;
            created_at?: string;
            completed_at?: string;
          };
        Update: Partial<Omit<SecFilingBriefRunRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      sec_form4_reporting_owners: {
        Row: SecForm4ReportingOwnerRow;
        Insert: Pick<SecForm4ReportingOwnerRow, "filing_event_id" | "reporting_owner_index" | "owner_name"> &
          Partial<Omit<SecForm4ReportingOwnerRow, "filing_event_id" | "reporting_owner_index" | "owner_name" | "created_at" | "updated_at">> & {
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<SecForm4ReportingOwnerRow, "filing_event_id" | "reporting_owner_index" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      sec_form4_transactions: {
        Row: SecForm4TransactionRow;
        Insert: Pick<
          SecForm4TransactionRow,
          "filing_event_id" | "reporting_owner_index" | "transaction_index" | "security_kind" | "security_title"
        > &
          Partial<Omit<SecForm4TransactionRow, "id" | "filing_event_id" | "reporting_owner_index" | "transaction_index" | "security_kind" | "security_title" | "created_at" | "updated_at">> & {
            id?: string;
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<SecForm4TransactionRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      sec_form4_event_summaries: {
        Row: SecForm4EventSummaryRow;
        Insert: Pick<SecForm4EventSummaryRow, "filing_event_id"> &
          Partial<Omit<SecForm4EventSummaryRow, "filing_event_id" | "created_at" | "updated_at">> & {
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<SecForm4EventSummaryRow, "filing_event_id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      filing_notification_worker_heartbeats: {
        Row: FilingNotificationWorkerHeartbeatRow;
        Insert: Pick<FilingNotificationWorkerHeartbeatRow, "worker_id" | "detection_enabled" | "push_enabled"> &
          Partial<Omit<FilingNotificationWorkerHeartbeatRow, "worker_id" | "detection_enabled" | "push_enabled" | "created_at" | "updated_at">> & {
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<FilingNotificationWorkerHeartbeatRow, "worker_id" | "created_at">>;
        Relationships: [];
      };
      push_subscriptions: {
        Row: PushSubscriptionRow;
        Insert: Pick<PushSubscriptionRow, "user_id" | "endpoint" | "p256dh" | "auth"> &
          Partial<
            Omit<
              PushSubscriptionRow,
              "id" | "user_id" | "endpoint" | "p256dh" | "auth" | "created_at" | "last_seen_at"
            >
          > & {
            id?: string;
            created_at?: string;
            last_seen_at?: string;
          };
        Update: Partial<Omit<PushSubscriptionRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_filing_notifications: {
        Row: UserFilingNotificationRow;
        Insert: Pick<
          UserFilingNotificationRow,
          "user_id" | "filing_event_id" | "title" | "body" | "destination_path"
        > &
          Partial<
            Omit<
              UserFilingNotificationRow,
              | "id"
              | "user_id"
              | "filing_event_id"
              | "title"
              | "body"
              | "destination_path"
              | "created_at"
            >
          > & {
            id?: string;
            created_at?: string;
          };
        Update: Partial<Omit<UserFilingNotificationRow, "id" | "user_id" | "filing_event_id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_pulse_preferences: {
        Row: UserPulsePreferencesRow;
        Insert: Pick<UserPulsePreferencesRow, "user_id"> &
          Partial<Omit<UserPulsePreferencesRow, "user_id" | "created_at" | "updated_at">> & {
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<UserPulsePreferencesRow, "user_id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_onboarding_states: {
        Row: UserOnboardingStateRow;
        Insert: Pick<UserOnboardingStateRow, "user_id"> &
          Partial<Omit<UserOnboardingStateRow, "user_id" | "created_at" | "updated_at">> & {
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<UserOnboardingStateRow, "user_id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_pulse_feed_revisions: {
        Row: UserPulseFeedRevisionRow;
        Insert: Pick<UserPulseFeedRevisionRow, "user_id"> & Partial<Omit<UserPulseFeedRevisionRow, "user_id" | "updated_at">> & { updated_at?: string };
        Update: Partial<Omit<UserPulseFeedRevisionRow, "user_id">>;
        Relationships: [];
      };
      user_pulse_item_states: {
        Row: UserPulseItemStateRow;
        Insert: Pick<UserPulseItemStateRow, "user_id" | "item_key" | "source_type" | "source_id" | "kind"> &
          Partial<
            Omit<
              UserPulseItemStateRow,
              "user_id" | "item_key" | "source_type" | "source_id" | "kind" | "created_at" | "updated_at"
            >
          > & {
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<UserPulseItemStateRow, "user_id" | "item_key" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_filing_keyword_rules: {
        Row: UserFilingKeywordRuleRow;
        Insert: Pick<UserFilingKeywordRuleRow, "user_id" | "phrase"> &
          Partial<Omit<UserFilingKeywordRuleRow, "id" | "user_id" | "phrase" | "created_at" | "updated_at">> & {
            id?: string;
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<UserFilingKeywordRuleRow, "id" | "user_id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      filing_keyword_matches: {
        Row: FilingKeywordMatchRow;
        Insert: Pick<FilingKeywordMatchRow, "user_id" | "filing_event_id" | "rule_id" | "matched_context"> &
          Partial<Omit<FilingKeywordMatchRow, "id" | "user_id" | "filing_event_id" | "rule_id" | "matched_context" | "created_at">> & {
            id?: string;
            created_at?: string;
          };
        Update: Partial<Omit<FilingKeywordMatchRow, "id" | "user_id" | "filing_event_id" | "rule_id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      filing_push_receipts: {
        Row: FilingPushReceiptRow;
        Insert: Pick<FilingPushReceiptRow, "user_id" | "receipt_key" | "receipt_type"> &
          Partial<Omit<FilingPushReceiptRow, "id" | "user_id" | "receipt_key" | "receipt_type" | "created_at">> & {
            id?: string;
            created_at?: string;
          };
        Update: Partial<Omit<FilingPushReceiptRow, "id" | "user_id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      user_filing_feed_tokens: {
        Row: UserFilingFeedTokenRow;
        Insert: Pick<UserFilingFeedTokenRow, "user_id" | "token_hash"> &
          Partial<Omit<UserFilingFeedTokenRow, "id" | "user_id" | "token_hash" | "created_at">> & {
            id?: string;
            created_at?: string;
          };
        Update: Partial<Omit<UserFilingFeedTokenRow, "id" | "user_id" | "token_hash" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      filing_notification_deliveries: {
        Row: FilingNotificationDeliveryRow;
        Insert: Pick<FilingNotificationDeliveryRow, "notification_id" | "subscription_id"> &
          Partial<
            Omit<
              FilingNotificationDeliveryRow,
              | "id"
              | "notification_id"
              | "subscription_id"
              | "status"
              | "attempts"
              | "next_attempt_at"
              | "worker_id"
              | "claim_token"
              | "lease_expires_at"
              | "provider_status"
              | "last_error"
              | "sent_at"
              | "created_at"
              | "updated_at"
            >
          > & {
            id?: string;
            status?: FilingNotificationDeliveryRow["status"];
            attempts?: number;
            next_attempt_at?: string;
            worker_id?: string | null;
            claim_token?: string | null;
            lease_expires_at?: string | null;
            provider_status?: number | null;
            last_error?: string | null;
            sent_at?: string | null;
            created_at?: string;
            updated_at?: string;
          };
        Update: Partial<Omit<FilingNotificationDeliveryRow, "id" | "created_at">>;
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
          | "monitored_variables"
          | "counter_evidence"
          | "decision_change_condition"
          | "archived_at"
          | "source_chat_session_id"
          | "source_message_id"
          | "created_at"
          | "updated_at"
        > & {
          id?: string;
          status?: UserCompanyThesisRow["status"];
          tags?: string[];
          monitored_variables?: string[];
          counter_evidence?: string;
          decision_change_condition?: string;
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
          | "purpose"
          | "operation_id"
          | "callback_token_hash"
          | "processing_started_at"
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
          purpose?: BillingTossCheckoutSessionRow["purpose"];
          operation_id?: string | null;
          callback_token_hash?: string | null;
          processing_started_at?: string | null;
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
          | "terminal_entitlement_applied_at"
          | "billing_key_delete_pending"
          | "billing_key_deleted_at"
          | "last_payment_id"
          | "state_version"
          | "active_operation_id"
          | "active_operation_expires_at"
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
          terminal_entitlement_applied_at?: string | null;
          billing_key_delete_pending?: boolean;
          billing_key_deleted_at?: string | null;
          last_payment_id?: string | null;
          state_version?: number;
          active_operation_id?: string | null;
          active_operation_expires_at?: string | null;
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
          | "operation_id"
          | "currency"
          | "billing_period_start"
          | "billing_period_end"
          | "attempt_number"
          | "status"
          | "fulfillment_status"
          | "fulfillment_error"
          | "fulfillment_attempted_at"
          | "fulfillment_applied_at"
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
          operation_id?: string | null;
          currency?: "KRW";
          billing_period_start?: string | null;
          billing_period_end?: string | null;
          attempt_number?: number;
          status?: BillingTossPaymentRow["status"];
          fulfillment_status?: BillingTossPaymentRow["fulfillment_status"];
          fulfillment_error?: string | null;
          fulfillment_attempted_at?: string | null;
          fulfillment_applied_at?: string | null;
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
      billing_toss_operations: {
        Row: BillingTossOperationRow;
        Insert: Omit<
          BillingTossOperationRow,
          | "id"
          | "status"
          | "idempotency_key"
          | "failure_code"
          | "failure_message"
          | "expires_at"
          | "confirmed_at"
          | "completed_at"
          | "created_at"
          | "updated_at"
        > & {
          id?: string;
          status?: BillingTossOperationStatus;
          idempotency_key?: string;
          failure_code?: string | null;
          failure_message?: string | null;
          expires_at?: string;
          confirmed_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<BillingTossOperationRow, "id" | "user_id" | "created_at">>;
        Relationships: [];
      };
      billing_toss_retired_billing_keys: {
        Row: BillingTossRetiredBillingKeyRow;
        Insert: Omit<
          BillingTossRetiredBillingKeyRow,
          | "id"
          | "status"
          | "failure_code"
          | "attempted_at"
          | "deleted_at"
          | "created_at"
          | "updated_at"
        > & {
          id?: string;
          status?: BillingTossRetiredBillingKeyRow["status"];
          failure_code?: string | null;
          attempted_at?: string | null;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<BillingTossRetiredBillingKeyRow, "id" | "user_id" | "created_at">>;
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
      chat_message_visualizations: {
        Row: ChatMessageVisualizationRow;
        Insert: Omit<ChatMessageVisualizationRow, "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Omit<ChatMessageVisualizationRow, "id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      chat_message_presentations: {
        Row: ChatMessagePresentationRow;
        Insert: Omit<ChatMessagePresentationRow, "created_at" | "updated_at"> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<ChatMessagePresentationRow, "message_id" | "created_at">>;
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
      pulse_editorial_entries: {
        Row: PulseEditorialEntryRow;
        Insert: Omit<PulseEditorialEntryRow, "id" | "created_at" | "updated_at"> & {
          id?: string;
          series_id?: string | null;
          episode_number?: number | null;
          company_visible?: boolean;
          status?: PulseEditorialEntryRow["status"];
          format?: PulseEditorialEntryRow["format"];
          body?: string;
          ticker?: string | null;
          action_label?: string | null;
          action_href?: string | null;
          publish_at?: string | null;
          expires_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<PulseEditorialEntryRow, "id" | "created_at" | "created_by">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      pulse_editorial_series: {
        Row: PulseEditorialSeriesRow;
        Insert: Omit<PulseEditorialSeriesRow, "id" | "created_at" | "updated_at"> & {
          id?: string;
          status?: PulseEditorialSeriesRow["status"];
          summary?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<PulseEditorialSeriesRow, "id" | "created_at" | "created_by">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      pulse_editorial_assets: {
        Row: PulseEditorialAssetRow;
        Insert: Omit<PulseEditorialAssetRow, "id" | "created_at" | "width" | "height"> & {
          id?: string;
          width?: number | null;
          height?: number | null;
          created_at?: string;
        };
        Update: Partial<Omit<PulseEditorialAssetRow, "id" | "entry_id" | "created_at">>;
        Relationships: Array<{
          foreignKeyName: string;
          columns: string[];
          isOneToOne: boolean;
          referencedRelation: string;
          referencedColumns: string[];
        }>;
      };
      pulse_editorial_distributions: {
        Row: PulseEditorialDistributionRow;
        Insert: Omit<PulseEditorialDistributionRow, "id" | "created_at" | "updated_at"> & {
          id?: string;
          channel?: PulseEditorialDistributionRow["channel"];
          status?: PulseEditorialDistributionRow["status"];
          placement?: PulseEditorialDistributionRow["placement"];
          priority?: number;
          starts_at?: string | null;
          ends_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<PulseEditorialDistributionRow, "id" | "created_at" | "created_by">>;
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
      get_active_catalog_sec_targets: {
        Args: { p_env: string };
        Returns: Array<{ cik: string; release_id: string }>;
      };
      reserve_sec_request_slot: {
        Args: { p_scope?: string; p_min_interval_ms?: number };
        Returns: string;
      };
      sync_catalog_sec_filing_reconciliation_targets: {
        Args: { p_env: string };
        Returns: number;
      };
      ensure_sec_filing_discovery_sources: {
        Args: { p_env: string };
        Returns: number;
      };
      claim_sec_filing_discovery_checkpoint: {
        Args: { p_env: string; p_worker_id: string; p_lease_seconds?: number };
        Returns: Array<{
          env: "dev" | "staging" | "prod";
          source_key: SecFilingDiscoveryCheckpointRow["source_key"];
          watermark_at: string | null;
          watermark_accession: string | null;
          claim_token: string;
        }>;
      };
      claim_catalog_sec_filing_reconciliation_targets: {
        Args: { p_env: string; p_worker_id: string; p_limit?: number; p_lease_seconds?: number };
        Returns: Array<{
          env: "dev" | "staging" | "prod";
          cik: string;
          release_id: string;
          coverage_started_at: string;
          baseline_completed_at: string | null;
          claim_token: string;
        }>;
      };
      claim_sec_filing_scheduler_leader: {
        Args: { p_env: string; p_deployment_id: string; p_worker_id: string; p_lease_seconds?: number };
        Returns: Array<{ claim_token: string; lease_expires_at: string }>;
      };
      record_catalog_sec_filing_discovery: {
        Args: {
          p_env: string;
          p_release_id: string;
          p_cik: string;
          p_accession_number: string;
          p_form_type: SecFilingFormType;
          p_filing_date: string;
          p_report_date: string | null;
          p_accepted_at: string | null;
          p_primary_document_name: string | null;
          p_filing_detail_url: string;
          p_primary_document_url: string | null;
          p_source_metadata: Json;
          p_discovery_source: "atom" | "submissions" | "daily_index";
          p_seen_at?: string;
        };
        Returns: Array<{ filing_event_id: string; inserted: boolean }>;
      };
      record_catalog_sec_filing_discoveries: {
        Args: { p_candidates: Json };
        Returns: Array<{ filing_event_id: string; inserted: boolean }>;
      };
      claim_sec_filing_processing_jobs: {
        Args: { p_env: string; p_worker_id: string; p_stage?: "enrich" | "notification_fanout" | "brief" | null; p_limit?: number; p_lease_seconds?: number };
        Returns: Array<{
          id: string;
          filing_event_id: string;
          stage: SecFilingProcessingJobRow["stage"];
          claim_token: string;
          attempts: number;
          progress_json: Json;
        }>;
      };
      enqueue_ready_sec_filing_brief_jobs: {
        Args: { p_env: string; p_limit?: number };
        Returns: number;
      };
      prune_catalog_sec_baseline_backfill: {
        Args: { p_env: string; p_before_occurred_at: string; p_limit?: number };
        Returns: number;
      };
      complete_sec_filing_discovery_checkpoint: {
        Args: {
          p_env: string;
          p_source_key: SecFilingDiscoveryCheckpointRow["source_key"];
          p_worker_id: string;
          p_claim_token: string;
          p_watermark_at: string | null;
          p_watermark_accession: string | null;
          p_next_poll_seconds?: number;
        };
        Returns: boolean;
      };
      fail_sec_filing_discovery_checkpoint: {
        Args: {
          p_env: string;
          p_source_key: SecFilingDiscoveryCheckpointRow["source_key"];
          p_worker_id: string;
          p_claim_token: string;
          p_error: string;
          p_retry_after_seconds?: number | null;
        };
        Returns: boolean;
      };
      complete_catalog_sec_filing_reconciliation: {
        Args: {
          p_env: string;
          p_cik: string;
          p_worker_id: string;
          p_claim_token: string;
          p_baseline_completed: boolean;
          p_next_poll_seconds?: number;
        };
        Returns: boolean;
      };
      fail_catalog_sec_filing_reconciliation: {
        Args: {
          p_env: string;
          p_cik: string;
          p_worker_id: string;
          p_claim_token: string;
          p_error: string;
          p_retry_after_seconds?: number | null;
        };
        Returns: boolean;
      };
      complete_sec_filing_enrichment: {
        Args: {
          p_job_id: string;
          p_claim_token: string;
          p_sec_items: string[];
          p_event_tags: string[];
          p_primary_event_tag: string | null;
          p_classification_source: "sec_items" | "metadata" | "unclassified";
          p_alert_priority: "urgent" | "normal" | "digest";
          p_documents: Json;
          p_form4_owners: Json;
          p_form4_transactions: Json;
          p_form4_summary: Json;
          p_parser_version: number;
        };
        Returns: boolean;
      };
      complete_sec_filing_brief: {
        Args: {
          p_job_id: string;
          p_claim_token: string;
          p_locale: "ko-KR";
          p_headline_ko: string;
          p_summary_sentences: Json;
          p_facts: Json;
          p_question_suggestions: Json;
          p_uncertainty_notes: Json;
          p_source_document_url: string;
          p_source_sha256: string;
          p_source_section_keys: string[];
          p_source_truncated: boolean;
          p_input_char_count: number;
          p_generator_model: string;
          p_prompt_version: string;
          p_schema_version: number;
          p_input_tokens: number;
          p_output_tokens: number;
          p_cache_read_input_tokens: number;
          p_provider_cost_usd: number;
          p_latency_ms: number;
        };
        Returns: boolean;
      };
      record_sec_filing_brief_failure: {
        Args: {
          p_job_id: string;
          p_claim_token: string;
          p_outcome: "failed" | "validation_failed";
          p_model: string;
          p_prompt_version: string;
          p_schema_version: number;
          p_source_document_url?: string | null;
          p_source_sha256?: string | null;
          p_source_truncated?: boolean | null;
          p_input_char_count?: number | null;
          p_latency_ms?: number | null;
          p_error_code?: string | null;
          p_error_message?: string | null;
        };
        Returns: boolean;
      };
      fail_sec_filing_processing_job: {
        Args: { p_job_id: string; p_claim_token: string; p_error: string; p_retry_after_seconds?: number | null };
        Returns: boolean;
      };
      sync_catalog_filing_subscription_status: {
        Args: { p_env: string };
        Returns: number;
      };
      set_user_company_coverage_level: {
        Args: {
          p_user_id: string;
          p_ticker: string;
          p_coverage_level: UserCompanyMarkRow["coverage_level"];
          p_idempotency_key: string;
          p_source?: string;
          p_priority?: number | null;
          p_interest_reason?: string | null;
          p_tags?: string[] | null;
          p_active_limit?: number | null;
        };
        Returns: Json;
      };
      reconcile_user_company_coverage_limit: {
        Args: {
          p_user_id: string;
          p_active_limit: number;
          p_preferred_ticker?: string | null;
        };
        Returns: string[];
      };
      sweep_expired_company_coverage_limits: {
        Args: {
          p_now?: string;
          p_limit?: number;
        };
        Returns: number;
      };
      save_user_filing_judgment_revision: {
        Args: {
          p_user_id: string;
          p_filing_event_id: string;
          p_ticker: string;
          p_impact: UserFilingJudgmentRevisionRow["impact"];
          p_next_action: UserFilingJudgmentRevisionRow["next_action"];
          p_summary: string;
          p_rationale: string;
          p_thesis_links: Json;
          p_monitoring_rules: Json;
          p_idempotency_key: string;
          p_expected_revision_number?: number | null;
        };
        Returns: Json;
      };
      try_record_coverage_activation: {
        Args: { p_user_id: string };
        Returns: boolean;
      };
      resolve_scheduled_monitoring_pulse_item: {
        Args: {
          p_user_id: string;
          p_rule_id: string;
          p_item_key: string;
          p_action: "review" | "dismiss";
          p_resolved_at?: string;
        };
        Returns: Json;
      };
      /**
       * V3 Pulse global filing read model. This is intentionally catalog-only:
       * it never receives user IDs or returns personalized state.
       */
      get_pulse_global_filing_candidates_v1: {
        Args: {
          p_env: string;
          p_snapshot_at?: string;
          p_preferred_tickers?: string[];
          p_urgent_limit?: number;
          p_priority_limit?: number;
          p_preferred_limit?: number;
          p_discovery_limit?: number;
        };
        Returns: Array<{
          filing_event_id: string;
          payload: Json;
          candidate_bucket: "urgent" | "priority" | "preferred" | "discovery";
        }>;
      };
      /** Returns the opaque components used by the private Pulse V3 revision. */
      get_pulse_feed_revisions_v1: {
        Args: { p_env: string; p_user_id: string; p_now?: string };
        Returns: Array<{
          global_revision: number;
          user_revision: number;
          time_bucket: number;
        }>;
      };
      /** Backfills the global candidate model after a catalog release changes. */
      rebuild_pulse_global_filing_candidates: {
        Args: { p_env: string; p_snapshot_at?: string };
        Returns: number;
      };
      complete_sec_filing_notification_fanout: {
        Args: { p_job_id: string; p_claim_token: string; p_progress_json?: Json };
        Returns: boolean;
      };
      claim_sec_filing_poll_targets: {
        Args: {
          p_worker_id: string;
          p_limit?: number;
          p_lease_seconds?: number;
        };
        Returns: Array<{ cik: string; claim_token: string }>;
      };
      claim_filing_notification_deliveries: {
        Args: {
          p_worker_id: string;
          p_limit?: number;
          p_lease_seconds?: number;
        };
        Returns: Array<{ id: string; claim_token: string }>;
      };
      cleanup_filing_notification_retention: {
        Args: Record<PropertyKey, never>;
        Returns: Array<{
          deliveries_deleted: number;
          notifications_deleted: number;
          filing_events_deleted: number;
        }>;
      };
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
      prepare_toss_billing_operation: {
        Args: {
          p_user_id: string;
          p_kind: BillingTossOperationKind;
          p_target_plan_key: BillingTossPlanKey | null;
          p_now?: string;
        };
        Returns: Array<{
          operation_id: string;
        }>;
      };
      confirm_toss_billing_operation: {
        Args: {
          p_user_id: string;
          p_operation_id: string;
          p_now?: string;
        };
        Returns: Array<{
          operation_id: string;
          operation_status: BillingTossOperationStatus;
        }>;
      };
      mark_toss_billing_operation_recoverable: {
        Args: {
          p_user_id: string;
          p_operation_id: string;
          p_status: "failed" | "payment_uncertain" | "paid_pending_apply";
          p_failure_code: string;
          p_failure_message: string;
          p_now?: string;
        };
        Returns: boolean;
      };
      finalize_toss_billing_v2_payment: {
        Args: {
          p_user_id: string;
          p_operation_id: string;
          p_payment_id: string;
          p_billing_key: string | null;
          p_billing_key_issued_at: string | null;
          p_card_snapshot: Json;
          p_now?: string;
        };
        Returns: Array<{
          subscription_id: string;
          already_applied: boolean;
        }>;
      };
      finalize_toss_billing_key_replacement: {
        Args: {
          p_user_id: string;
          p_operation_id: string;
          p_billing_key: string;
          p_billing_key_issued_at: string | null;
          p_card_snapshot: Json;
          p_now?: string;
        };
        Returns: Array<{
          subscription_id: string;
          already_applied: boolean;
        }>;
      };
      expire_toss_billing_operations: {
        Args: { p_now?: string };
        Returns: number;
      };
      claim_toss_subscription_for_payment_recovery: {
        Args: {
          p_user_id: string;
          p_subscription_id: string;
          p_worker_id: string;
          p_now?: string;
          p_lease_seconds?: number;
        };
        Returns: boolean;
      };
      cancel_toss_billing_operation: {
        Args: {
          p_user_id: string;
          p_operation_id: string;
          p_now?: string;
        };
        Returns: boolean;
      };
      apply_toss_renewal_failure: {
        Args: {
          p_user_id: string;
          p_subscription_id: string;
          p_grace_until: string;
          p_retry_at: string | null;
          p_next_attempt_count: number;
          p_now?: string;
        };
        Returns: string;
      };
      finalize_toss_terminal_subscriptions: {
        Args: {
          p_now?: string;
          p_limit?: number;
        };
        Returns: number;
      };
      finalize_toss_billing_payment: {
        Args: {
          p_operation: "initial" | "renewal" | "upgrade";
          p_user_id: string;
          p_subscription_id: string;
          p_payment_id: string;
          p_checkout_session_id: string | null;
          p_plan_version_id: string;
          p_period_start: string;
          p_period_end: string;
          p_credit_anchor_at: string;
          p_customer_key: string;
          p_billing_key: string | null;
          p_billing_key_issued_at: string | null;
          p_card_snapshot: Json;
          p_paid_at: string;
          p_renewal_lease_owner: string | null;
          p_defer_plan_change_until: string | null;
          p_now: string;
        };
        Returns: Array<{
          subscription_id: string;
          already_applied: boolean;
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
      claim_document_ingestion_job_v2: {
        Args: {
          p_worker_id: string;
          p_lease_seconds: number;
          p_global_limit: number;
        };
        Returns: Array<{ id: string; claim_token: string }>;
      };
      claim_document_ingestion_job_by_id_v2: {
        Args: {
          p_job_id: string;
          p_worker_id: string;
          p_lease_seconds: number;
          p_global_limit: number;
        };
        Returns: Array<{
          id: string;
          claim_token: string | null;
          lease_expires_at: string | null;
          claim_state: "claimed" | "active_lease" | "concurrency_limited";
        }>;
      };
      renew_document_ingestion_job_lease: {
        Args: {
          p_job_id: string;
          p_claim_token: string;
          p_lease_seconds: number;
        };
        Returns: boolean;
      };
      advance_document_ingestion_job: {
        Args: {
          p_job_id: string;
          p_claim_token: string;
          p_stage: DocumentIngestionJobRow["stage"];
          p_progress_percent: number;
        };
        Returns: boolean;
      };
      complete_document_ingestion_job: {
        Args: {
          p_job_id: string;
          p_claim_token: string;
          p_extracted_md: string;
          p_source_path: string;
        };
        Returns: boolean;
      };
      fail_document_ingestion_job: {
        Args: {
          p_job_id: string;
          p_claim_token: string;
          p_error_code: string;
          p_error_message: string;
        };
        Returns: boolean;
      };
      reconcile_expired_document_attachment_cleanup: {
        Args: {
          p_limit?: number;
        };
        Returns: number;
      };
      claim_document_source_cleanup_job: {
        Args: {
          p_worker_id: string;
          p_lease_seconds: number;
        };
        Returns: Array<{
          id: string;
          attachment_id: string;
          storage_kind: DocumentSourceCleanupJobRow["storage_kind"];
          source_path: string;
          claim_token: string;
        }>;
      };
      complete_document_source_cleanup_job: {
        Args: {
          p_cleanup_job_id: string;
          p_claim_token: string;
        };
        Returns: boolean;
      };
      fail_document_source_cleanup_job: {
        Args: {
          p_cleanup_job_id: string;
          p_claim_token: string;
          p_error_message: string;
        };
        Returns: boolean;
      };
      create_document_ingestion_job: {
        Args: {
          p_attachment_id: string;
          p_user_id: string;
          p_session_id: string | null;
          p_ticker: string | null;
          p_file_name: string;
          p_mime_type: string;
          p_file_size: number;
          p_storage_kind: "local_fs";
          p_original_path: string | null;
          p_original_object_path: string | null;
          p_content_hash: string | null;
          p_expires_at: string;
          p_queue_name?: string;
        };
        Returns: CreateDocumentIngestionJobResult;
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
