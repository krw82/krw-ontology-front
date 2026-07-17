#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;

  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;

    const separator = trimmed.indexOf("=");
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile(
  process.env.SUPABASE_SMOKE_ENV_FILE ??
    path.join(repoRoot, ".env.production"),
);
loadEnvFile(path.join(repoRoot, ".env"));

const supabaseUrl =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey =
  process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  console.error(
    "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ANON_KEY/NEXT_PUBLIC_SUPABASE_ANON_KEY for schema smoke test.",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anonSupabase = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const checks = [
  {
    table: "chat_sessions",
    select:
      "id,deleted_at,client_request_id,last_message_preview,last_message_at,latest_run_status,source_filing_event_id",
  },
  {
    table: "messages",
    select: "id,request_id,status",
  },
  {
    table: "agent_runs",
    select:
      "id,request_id,sdk_diagnostics,run_kind,executor_type,selected_news_event_context,source_artifact_id,source_event_id",
  },
  {
    table: "agent_worker_heartbeats",
    select: "worker_id,ontology_env,ontology_release_id,manifest_valid",
  },
  {
    table: "desktop_authorization_requests",
    select:
      "id,client_id,redirect_uri,installation_id,device_name,status,user_id,device_id,expires_at,approved_at,consumed_at",
  },
  {
    table: "desktop_llm_jobs",
    select:
      "id,user_id,device_id,local_run_id,status,provider,model_profile,sdk_model,upstream_model,request_count,max_request_count,expires_at,finalized_at",
  },
  {
    table: "ontology_catalog_releases",
    select: "env,release_id,active,company_count,document_count",
  },
  {
    table: "ontology_companies",
    select: "env,release_id,ticker,name,document_count,sec_cik,sec_ticker,sec_mapping_source,sec_mapping_checked_at",
  },
  {
    table: "message_shares",
    select: "id,token,share_context,revoked_at",
  },
  {
    table: "concurrency_leases",
    select: "id,run_id,released_at",
  },
  {
    table: "rate_limit_counters",
    select: "key,bucket,window_start,count",
  },
  {
    table: "usage_budget_balances",
    select: "user_id,period_kind,period_start,settled_cost_usd,reserved_cost_usd",
  },
  {
    table: "run_budgets",
    select: "id,user_id,request_id,status,reserved_cost_usd",
  },
  {
    table: "usage_ledger",
    select: "id,user_id,request_id,entry_type,amount_usd",
  },
  {
    table: "credit_policies",
    select: "version,input_token_weight,output_token_weight,display_scale",
  },
  {
    table: "provider_pricing_policies",
    select:
      "version,provider,provider_model,input_cache_hit_cost_per_million,input_cache_miss_cost_per_million,output_cost_per_million,source_url,verified_at",
  },
  {
    table: "billing_plan_versions",
    select:
      "id,plan_key,plan_version,monthly_price_krw,weekly_credit_limit_raw,credit_policy_version,is_current",
  },
  {
    table: "billing_toss_customers",
    select: "user_id,customer_key,created_at,updated_at",
  },
  {
    table: "billing_toss_checkout_sessions",
    select:
      "id,user_id,plan_key,plan_version_id,amount_krw,customer_key,status,billing_key_idempotency_key,expires_at",
  },
  {
    table: "billing_toss_subscriptions",
    select:
      "id,user_id,plan_key,plan_version_id,status,customer_key,billing_method,current_period_start,current_period_end,renewal_due_at,next_billing_at,grace_until,renewal_attempt_count,pending_plan_key",
  },
  {
    table: "billing_toss_payments",
    select:
      "id,user_id,subscription_id,checkout_session_id,plan_key,payment_kind,order_id,amount_krw,billing_period_start,billing_period_end,attempt_number,status,provider_payment_key",
  },
  {
    table: "usage_credit_balances",
    select:
      "user_id,period_kind,period_start,credits_limit_raw,credits_used_raw,credits_reserved_raw",
  },
  {
    table: "run_credit_reservations",
    select:
      "id,user_id,request_id,run_id,credit_period_start,reserved_credits_raw,status",
  },
  {
    table: "usage_credit_ledger",
    select: "id,user_id,request_id,entry_type,amount_credits_raw",
  },
  {
    table: "analysis_credit_run_costs",
    select:
      "reservation_id,user_id,request_id,input_tokens,output_tokens,settled_credits_raw,settled_credits_display,actual_provider_cost_usd",
  },
  {
    table: "analysis_credit_weekly_usage_summary",
    select:
      "user_id,period_start,credits_used_raw,credits_used_display,run_count,avg_provider_cost_usd_per_run",
  },
  {
    table: "chat_message_artifacts",
    select: "id,session_id,message_id,run_id,type,payload_json",
  },
  {
    table: "chat_message_artifact_selections",
    select:
      "id,artifact_id,session_id,event_id,user_id,user_message_id,research_run_id,status,updated_at",
  },
  {
    table: "user_company_marks",
    select:
      "user_id,ticker,is_watchlisted,is_holding,priority,interest_reason,tags,last_activity_at,created_at,updated_at",
  },
  {
    table: "user_company_questions",
    select:
      "id,user_id,ticker,question,status,source,source_chat_session_id,source_message_id,answered_at,visible_after_at,created_at,updated_at",
  },
  {
    table: "user_company_cards",
    select:
      "id,user_id,ticker,title,summary,content_md,basis_release_id,basis_period,basis_document_type,source_chat_session_id,source_message_id,created_at,updated_at",
  },
  {
    table: "user_company_notebooks",
    select:
      "id,user_id,ticker,title,content_md,previous_content_md,basis_release_id,basis_period,last_source_chat_session_id,last_source_message_id,created_at,updated_at",
  },
  {
    table: "user_company_notebook_refresh_jobs",
    select:
      "id,user_id,ticker,status,notebook_id,recent_conversation_count,saved_question_count,last_source_chat_session_id,last_source_message_id,error_code,error_message,requested_at,started_at,completed_at,created_at,updated_at",
  },
  {
    table: "user_company_theses",
    select:
      "id,user_id,ticker,title,thesis_text,status,tags,archived_at,source_chat_session_id,source_message_id,created_at,updated_at",
  },
  {
    table: "user_thesis_checks",
    select:
      "id,thesis_id,user_id,ticker,result_status,summary,strengthening_points,weakening_points,neutral_points,next_questions,basis_release_id,basis_period,source_chat_session_id,source_message_id,created_at",
  },
  {
    table: "user_research_notes",
    select:
      "id,user_id,ticker,title,body,note_type,tags,source_chat_session_id,source_message_id,created_at,updated_at",
  },
  {
    table: "user_research_note_sources",
    select:
      "id,note_id,user_id,ticker,citation_id,run_id,message_id,ontology_object_id,document_type,filing_period,created_at",
  },
  {
    table: "sec_company_identifiers",
    select: "ticker,cik,lookup_status,last_checked_at",
  },
  {
    table: "sec_filing_events",
    select:
      "id,env,ticker,cik,accession_number,form_type,is_amendment,analysis_status,filing_detail_url,event_family,discovery_source,processing_status,feed_eligible,feed_available_at,feed_expires_at,occurred_at,parser_version",
  },
  {
    table: "sec_filing_event_catalog_coverage",
    select: "filing_event_id,env,release_id,ticker,covered_at",
  },
  {
    table: "sec_filing_discovery_checkpoints",
    select: "env,source_key,watermark_at,next_poll_at,last_success_at,gap_risk",
  },
  {
    table: "sec_catalog_filing_reconciliation_state",
    select: "env,cik,baseline_completed_at,next_poll_at,last_success_at",
  },
  {
    table: "sec_filing_worker_leases",
    select: "env,lease_key,worker_id,deployment_id,lease_expires_at",
  },
  {
    table: "sec_filing_processing_jobs",
    select: "id,env,filing_event_id,stage,status,priority,attempts,next_attempt_at",
  },
  {
    table: "sec_filing_briefs",
    select:
      "filing_event_id,locale,headline_ko,summary_sentences,facts,source_document_url,source_sha256,source_section_keys,source_truncated,generator_model,prompt_version,schema_version,generated_at",
  },
  {
    table: "sec_filing_brief_runs",
    select:
      "id,env,filing_event_id,job_id,outcome,model,prompt_version,schema_version,source_sha256,input_tokens,output_tokens,provider_cost_usd,latency_ms,error_code,created_at",
  },
  {
    table: "sec_request_rate_limit_slots",
    select: "scope,next_allowed_at,updated_at",
  },
  {
    table: "sec_form4_reporting_owners",
    select: "filing_event_id,reporting_owner_index,owner_cik,owner_name",
  },
  {
    table: "sec_form4_transactions",
    select: "id,filing_event_id,transaction_code,reported_transaction_value,reported_value_basis",
  },
  {
    table: "sec_form4_event_summaries",
    select: "filing_event_id,reported_purchase_value,reported_sale_value,tenb5_one_status",
  },
  {
    table: "filing_notification_preferences",
    select:
      "user_id,enabled,notify_8k,notify_6k,notify_form4,insider_notification_mode,include_amendments,timezone",
  },
  {
    table: "push_subscriptions",
    select: "id,user_id,endpoint,status,last_seen_at,revoked_at",
  },
  {
    table: "user_filing_notifications",
    select:
      "id,user_id,filing_event_id,kind,title,destination_path,read_at,clicked_at",
  },
  {
    table: "user_filing_subscriptions",
    select: "id,user_id,ticker,cik,env,catalog_collection_status,enabled",
  },
  {
    table: "user_pulse_preferences",
    select:
      "user_id,timezone,enabled_kinds,question_cadence,resurface_cadence,learning_cadence",
  },
  {
    table: "user_pulse_item_states",
    select:
      "user_id,item_key,source_type,kind,reviewed_at,last_impression_session_id,impression_count",
  },
  {
    table: "filing_notification_deliveries",
    select:
      "id,notification_id,subscription_id,status,attempts,next_attempt_at,claim_token",
  },
];

for (const check of checks) {
  const { error } = await supabase
    .from(check.table)
    .select(check.select, { head: true, count: "exact" })
    .limit(1);

  if (error) {
    console.error(
      `Schema smoke failed for ${check.table} (${check.select}): ${error.message}`,
    );
    process.exit(1);
  }

  console.log(`OK schema: ${check.table} (${check.select})`);
}

const smokeKey = `schema-smoke:${Date.now()}`;
const { error: rpcError } = await supabase.rpc("increment_rate_limit", {
  p_key: smokeKey,
  p_bucket: "schema_smoke",
  p_window_start: new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString(),
  p_window_seconds: 60,
  p_limit: 100,
});

if (rpcError) {
  console.error(`Schema smoke failed for increment_rate_limit RPC: ${rpcError.message}`);
  process.exit(1);
}

await supabase.from("rate_limit_counters").delete().eq("key", smokeKey);
console.log("OK schema: increment_rate_limit RPC");

const { error: filingClaimError } = await supabase.rpc(
  "claim_filing_notification_deliveries",
  {
    p_worker_id: "schema-smoke",
    p_limit: 1,
    p_lease_seconds: 30,
  },
);
if (filingClaimError) {
  console.error(
    `Schema smoke failed for claim_filing_notification_deliveries RPC: ${filingClaimError.message}`,
  );
  process.exit(1);
}
console.log("OK schema: claim_filing_notification_deliveries RPC");

const { error: globalFilingFeedRpcError } = await supabase.rpc("get_catalog_global_filing_feed", {
  p_env: "prod",
  p_snapshot_at: new Date().toISOString(),
  p_before_occurred_at: null,
  p_before_filing_event_id: null,
  p_limit: 1,
});
if (globalFilingFeedRpcError) {
  console.error(`Schema smoke failed for get_catalog_global_filing_feed RPC: ${globalFilingFeedRpcError.message}`);
  process.exit(1);
}
console.log("OK schema: get_catalog_global_filing_feed RPC");

const pulseSnapshot = new Date();
const { error: pulseCandidateRpcError } = await supabase.rpc(
  "get_catalog_pulse_filing_candidates_v2",
  {
    p_env: "prod",
    p_snapshot_at: pulseSnapshot.toISOString(),
    p_preferred_tickers: [],
    p_urgent_limit: 1,
    p_priority_limit: 1,
    p_preferred_limit: 1,
    p_discovery_limit: 1,
  },
);
if (pulseCandidateRpcError) {
  console.error(`Schema smoke failed for get_catalog_pulse_filing_candidates_v2 RPC: ${pulseCandidateRpcError.message}`);
  process.exit(1);
}
console.log("OK schema: get_catalog_pulse_filing_candidates_v2 RPC");

const { error: pulseCandidateV3RpcError } = await supabase.rpc(
  "get_catalog_pulse_filing_candidates_v3",
  {
    p_env: "prod",
    p_snapshot_at: pulseSnapshot.toISOString(),
    p_preferred_tickers: [],
    p_urgent_limit: 1,
    p_priority_limit: 1,
    p_preferred_limit: 1,
    p_discovery_limit: 1,
  },
);
if (pulseCandidateV3RpcError) {
  console.error(`Schema smoke failed for get_catalog_pulse_filing_candidates_v3 RPC: ${pulseCandidateV3RpcError.message}`);
  process.exit(1);
}
console.log("OK schema: get_catalog_pulse_filing_candidates_v3 RPC");

const { error: pulseStatusRpcError } = await supabase.rpc(
  "get_catalog_pulse_feed_status_v1",
  {
    p_env: "prod",
    p_since: new Date(pulseSnapshot.getTime() - 5 * 60_000).toISOString(),
    p_snapshot_at: pulseSnapshot.toISOString(),
  },
);
if (pulseStatusRpcError) {
  console.error(`Schema smoke failed for get_catalog_pulse_feed_status_v1 RPC: ${pulseStatusRpcError.message}`);
  process.exit(1);
}
console.log("OK schema: get_catalog_pulse_feed_status_v1 RPC");

const secLimiterScope = `schema-smoke-${Date.now()}`;
const { data: secSlot, error: secSlotError } = await supabase.rpc("reserve_sec_request_slot", {
  p_scope: secLimiterScope,
  p_min_interval_ms: 100,
});
if (secSlotError || typeof secSlot !== "string" || Number.isNaN(Date.parse(secSlot))) {
  console.error(`Schema smoke failed for reserve_sec_request_slot RPC: ${secSlotError?.message ?? "invalid slot timestamp"}`);
  process.exit(1);
}
await supabase.from("sec_request_rate_limit_slots").delete().eq("scope", secLimiterScope);
console.log("OK schema: reserve_sec_request_slot RPC");

const zeroUuid = "00000000-0000-0000-0000-000000000000";
const { error: reserveRpcError } = await supabase.rpc("reserve_execution_budget", {
  p_user_id: zeroUuid,
  p_request_id: `schema-smoke:${Date.now()}`,
  p_monthly_period_start: new Date(Date.UTC(2099, 0, 1)).toISOString(),
  p_monthly_period_end: new Date(Date.UTC(2099, 1, 1)).toISOString(),
  p_daily_period_start: new Date(Date.UTC(2099, 0, 1)).toISOString(),
  p_daily_period_end: new Date(Date.UTC(2099, 0, 2)).toISOString(),
  p_monthly_budget_usd: 0,
  p_daily_budget_usd: 0,
  p_reserve_cost_usd: 1,
  p_expires_at: new Date(Date.now() + 60_000).toISOString(),
});

if (reserveRpcError && reserveRpcError.code !== "23503") {
  console.error(
    `Schema smoke failed for reserve_execution_budget RPC: ${reserveRpcError.message}`,
  );
  process.exit(1);
}
console.log("OK schema: reserve_execution_budget RPC");

const { error: reserveAnalysisRpcError } = await supabase.rpc("reserve_analysis_credits", {
  p_user_id: zeroUuid,
  p_request_id: `schema-smoke-analysis:${Date.now()}`,
  p_reserve_credits_raw: 1,
  p_expires_at: new Date(Date.now() + 60_000).toISOString(),
  p_now: new Date(Date.UTC(2099, 0, 1)).toISOString(),
});

if (reserveAnalysisRpcError && reserveAnalysisRpcError.code !== "23503") {
  console.error(
    `Schema smoke failed for reserve_analysis_credits RPC: ${reserveAnalysisRpcError.message}`,
  );
  process.exit(1);
}
console.log("OK schema: reserve_analysis_credits RPC");

const { error: pulseImpressionRpcError } = await supabase.rpc("record_pulse_item_impression", {
  p_user_id: zeroUuid,
  p_item_key: "filing:schema-smoke",
  p_source_type: "filing",
  p_source_id: "schema-smoke",
  p_kind: "filing",
  p_feed_session_id: "00000000-0000-4000-8000-000000000000",
  p_seen_at: new Date().toISOString(),
});
if (pulseImpressionRpcError && pulseImpressionRpcError.code !== "23503") {
  console.error(
    `Schema smoke failed for record_pulse_item_impression RPC: ${pulseImpressionRpcError.message}`,
  );
  process.exit(1);
}
console.log("OK schema: record_pulse_item_impression RPC");

function isExpectedBlockedRpcError(error) {
  const code = String(error?.code ?? "");
  const message = String(error?.message ?? "").toLowerCase();

  return (
    code === "42501" ||
    code === "PGRST202" ||
    message.includes("permission denied") ||
    message.includes("could not find the function") ||
    message.includes("schema cache")
  );
}

async function expectAnonRpcBlocked(name, args) {
  const { data, error } = await anonSupabase.rpc(name, args);

  if (!error) {
    console.error(
      `Schema smoke failed for ${name}: anon role executed privileged RPC (${JSON.stringify(
        data,
      )}).`,
    );
    process.exit(1);
  }

  if (!isExpectedBlockedRpcError(error)) {
    console.error(
      `Schema smoke failed for ${name}: expected anon execute denial, got ${error.code ?? "unknown"} ${error.message}`,
    );
    process.exit(1);
  }

  console.log(`OK schema: ${name} blocks anon execute`);
}

async function expectAnonTableBlocked(table, select) {
  const { error, status } = await anonSupabase
    .from(table)
    .select(select, { head: true, count: "exact" })
    .limit(1);

  if (!error) {
    console.error(
      `Schema smoke failed for ${table}: anon role can inspect service-only billing table.`,
    );
    process.exit(1);
  }

  if (status !== 401 && status !== 403 && !isExpectedBlockedRpcError(error)) {
    console.error(
      `Schema smoke failed for ${table}: expected anon select denial, got ${error.code ?? "unknown"} ${error.message}`,
    );
    process.exit(1);
  }

  console.log(`OK schema: ${table} blocks anon select`);
}

await expectAnonTableBlocked(
  "billing_toss_customers",
  "user_id,customer_key",
);
await expectAnonTableBlocked(
  "billing_toss_checkout_sessions",
  "id,user_id,status",
);
await expectAnonTableBlocked(
  "billing_toss_subscriptions",
  "id,user_id,status,billing_key",
);
await expectAnonTableBlocked(
  "billing_toss_payments",
  "id,user_id,status",
);
await expectAnonTableBlocked(
  "sec_filing_processing_jobs",
  "id,env,filing_event_id,status",
);
await expectAnonTableBlocked(
  "sec_request_rate_limit_slots",
  "scope,next_allowed_at",
);
await expectAnonTableBlocked(
  "sec_form4_transactions",
  "id,filing_event_id,reported_transaction_value",
);

await expectAnonRpcBlocked("claim_agent_run", {
  p_worker_id: "",
  p_lease_seconds: 300,
  p_global_limit: 1,
});
await expectAnonRpcBlocked("record_pulse_item_impression", {
  p_user_id: zeroUuid,
  p_item_key: "filing:schema-smoke",
  p_source_type: "filing",
  p_source_id: "schema-smoke",
  p_kind: "filing",
  p_feed_session_id: "00000000-0000-4000-8000-000000000000",
  p_seen_at: new Date().toISOString(),
});
await expectAnonRpcBlocked("claim_agent_run", {
  p_worker_id: "schema-smoke",
  p_worker_env: "invalid",
  p_ontology_env: "prod",
  p_lease_seconds: 300,
  p_global_limit: 1,
});
await expectAnonRpcBlocked("get_agent_run_queue_state", {
  p_run_id: zeroUuid,
  p_global_limit: 1,
});
await expectAnonRpcBlocked("heartbeat_agent_run", {
  p_run_id: zeroUuid,
  p_worker_id: "schema-smoke",
  p_lease_seconds: 300,
});
await expectAnonRpcBlocked("mark_agent_run_terminal", {
  p_run_id: zeroUuid,
  p_status: "failed",
  p_finished_at: new Date().toISOString(),
  p_error_code: "schema_smoke",
  p_error_message: "schema smoke",
  p_input_tokens: null,
  p_output_tokens: null,
  p_estimated_cost_usd: null,
  p_latency_ms: null,
  p_assistant_message_id: null,
  p_open_tool_error_message: null,
});
await expectAnonRpcBlocked("publish_ontology_web_catalog", {
  p_catalog: {},
});
await expectAnonRpcBlocked("get_catalog_global_filing_feed", {
  p_env: "prod",
  p_snapshot_at: new Date().toISOString(),
  p_before_occurred_at: null,
  p_before_filing_event_id: null,
  p_limit: 1,
});
await expectAnonRpcBlocked("get_catalog_pulse_filing_candidates_v2", {
  p_env: "prod",
  p_snapshot_at: new Date().toISOString(),
  p_preferred_tickers: [],
  p_urgent_limit: 1,
  p_priority_limit: 1,
  p_preferred_limit: 1,
  p_discovery_limit: 1,
});
await expectAnonRpcBlocked("get_catalog_pulse_filing_candidates_v3", {
  p_env: "prod",
  p_snapshot_at: new Date().toISOString(),
  p_preferred_tickers: [],
  p_urgent_limit: 1,
  p_priority_limit: 1,
  p_preferred_limit: 1,
  p_discovery_limit: 1,
});
await expectAnonRpcBlocked("get_catalog_pulse_feed_status_v1", {
  p_env: "prod",
  p_since: new Date(Date.now() - 5 * 60_000).toISOString(),
  p_snapshot_at: new Date().toISOString(),
});
await expectAnonRpcBlocked("reserve_sec_request_slot", {
  p_scope: "anon-schema-smoke",
  p_min_interval_ms: 100,
});
await expectAnonRpcBlocked("record_usage_event", {
  p_user_id: zeroUuid,
  p_request_id: "schema-smoke",
  p_run_id: zeroUuid,
  p_period_start: new Date().toISOString(),
  p_period_end: new Date().toISOString(),
  p_cost: 0,
});
await expectAnonRpcBlocked("reserve_analysis_credits", {
  p_user_id: zeroUuid,
  p_request_id: "schema-smoke",
  p_reserve_credits_raw: 1,
  p_expires_at: new Date(Date.now() + 60_000).toISOString(),
  p_now: new Date().toISOString(),
});
await expectAnonRpcBlocked("attach_analysis_credit_run", {
  p_user_id: zeroUuid,
  p_request_id: "schema-smoke",
  p_run_id: zeroUuid,
});
await expectAnonRpcBlocked("settle_analysis_credits", {
  p_user_id: zeroUuid,
  p_request_id: "schema-smoke",
  p_run_id: zeroUuid,
  p_terminal_status: "failed",
  p_settled_credits_raw: 0,
  p_input_tokens: 0,
  p_output_tokens: 0,
  p_prompt_cache_hit_tokens: 0,
  p_prompt_cache_miss_tokens: 0,
  p_provider: "deepseek",
  p_provider_model: "deepseek-v4-flash",
  p_provider_model_version: "DeepSeek-V4-Flash",
  p_pricing_version: "deepseek-v4-flash-2026-06",
  p_actual_provider_cost_usd: 0,
  p_metadata: {},
});
await expectAnonRpcBlocked("release_analysis_credits", {
  p_user_id: zeroUuid,
  p_request_id: "schema-smoke",
  p_run_id: zeroUuid,
  p_reason: "schema_smoke",
});
await expectAnonRpcBlocked("expire_stale_analysis_credit_reservations", {
  p_now: new Date().toISOString(),
});
await expectAnonRpcBlocked("claim_due_toss_subscriptions", {
  p_worker_id: "schema-smoke",
  p_now: new Date().toISOString(),
  p_limit: 1,
  p_lease_seconds: 60,
});

console.log("Supabase schema smoke test passed.");
