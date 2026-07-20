#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function loadEnvFile(filePath, { override = false } = {}) {
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
    if (override || !process.env[key]) process.env[key] = value;
  }
}

const smokeEnvFile =
  process.env.SUPABASE_SMOKE_ENV_FILE ?? path.join(repoRoot, ".env.production");
loadEnvFile(smokeEnvFile, { override: true });
loadEnvFile(path.join(repoRoot, ".env"));

const supabaseUrl =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey =
  process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const requestTimeoutMs = Number(
  process.env.SUPABASE_SMOKE_REQUEST_TIMEOUT_MS ?? 15_000,
);

if (!supabaseUrl || !serviceRoleKey || !anonKey) {
  console.error(
    "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or SUPABASE_ANON_KEY/NEXT_PUBLIC_SUPABASE_ANON_KEY for schema smoke test.",
  );
  process.exit(1);
}
if (anonKey === serviceRoleKey) {
  console.error(
    "Schema smoke refused: public Supabase key equals the service-role key.",
  );
  process.exit(1);
}
if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs < 1_000) {
  console.error("SUPABASE_SMOKE_REQUEST_TIMEOUT_MS must be at least 1000ms.");
  process.exit(1);
}

async function schemaSmokeFetch(input, init = {}) {
  const timeoutSignal = AbortSignal.timeout(requestTimeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  try {
    return await fetch(input, { ...init, signal });
  } catch (error) {
    if (timeoutSignal.aborted) {
      let endpoint = "Supabase endpoint";
      try {
        endpoint = new URL(
          typeof input === "string" ? input : input.url,
        ).pathname;
      } catch {
        // Keep the non-sensitive fallback label.
      }
      throw new Error(
        `Supabase schema smoke request timed out after ${requestTimeoutMs}ms: ${init.method ?? "GET"} ${endpoint}`,
        { cause: error },
      );
    }
    throw error;
  }
}

const projectRefFile =
  process.env.SUPABASE_PROJECT_REF_FILE ??
  path.join(repoRoot, "supabase", ".temp", "project-ref");
if (!existsSync(projectRefFile)) {
  console.error(`Missing linked Supabase project ref: ${projectRefFile}`);
  process.exit(1);
}
const linkedProjectRef = readFileSync(projectRefFile, "utf8").trim();
let expectedProductionProjectRef =
  process.env.SUPABASE_EXPECTED_PRODUCTION_PROJECT_REF?.trim() ?? "";
if (!expectedProductionProjectRef) {
  const canonicalTargetFile =
    process.env.SUPABASE_PRODUCTION_TARGET_FILE ??
    path.join(repoRoot, "ops", "production-target.json");
  if (existsSync(canonicalTargetFile)) {
    const canonicalTarget = JSON.parse(readFileSync(canonicalTargetFile, "utf8"));
    if (
      canonicalTarget?.format === "krw-production-target/v1" &&
      typeof canonicalTarget.supabaseProjectRef === "string"
    ) {
      expectedProductionProjectRef = canonicalTarget.supabaseProjectRef.trim();
    }
  }
}
let smokeProjectRef = "";
try {
  const hostname = new URL(supabaseUrl).hostname;
  smokeProjectRef = hostname.endsWith(".supabase.co")
    ? hostname.slice(0, -".supabase.co".length)
    : "";
} catch {
  // Handled by the mismatch below without printing credentials.
}
if (
  !expectedProductionProjectRef ||
  !linkedProjectRef ||
  smokeProjectRef !== linkedProjectRef ||
  linkedProjectRef !== expectedProductionProjectRef
) {
  console.error(
    `Supabase schema smoke target mismatch: expected=${expectedProductionProjectRef || "missing"} linked=${linkedProjectRef || "missing"} env=${smokeProjectRef || "unrecognized"}`,
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: schemaSmokeFetch },
});
const anonSupabase = createClient(supabaseUrl, anonKey, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: schemaSmokeFetch },
});

async function assertCoverageLimitRpcSignatures() {
  // These invalid arguments are rejected by the function's first validation
  // branch, before an advisory lock, SELECT, UPDATE, or INSERT can run. SQLSTATE
  // 22023 proves PostgREST resolved the exact signature; PGRST202 would mean a
  // stale/incomplete schema cache instead.
  const { data: reconcileResult, error: reconcileError } = await supabase.rpc(
    "reconcile_user_company_coverage_limit",
    {
      p_user_id: null,
      p_active_limit: -1,
      p_preferred_ticker: null,
    },
  );
  if (
    !reconcileError ||
    String(reconcileError.code ?? "") !== "22023" ||
    String(reconcileError.code ?? "") === "PGRST202"
  ) {
    throw new Error(
      `reconcile_user_company_coverage_limit signature probe expected PostgreSQL 22023 without mutation, got ${reconcileError?.code ?? "success"} ${reconcileError?.message ?? JSON.stringify(reconcileResult)}`,
    );
  }
  console.log(
    "OK schema: reconcile_user_company_coverage_limit non-mutating signature probe",
  );

  // p_limit=0 is rejected before the sweep selects or updates any user. The
  // expected PostgreSQL error proves PostgREST resolved this exact signature;
  // PGRST202 would instead mean that the schema cache is stale or incomplete.
  const { data: sweepResult, error: sweepError } = await supabase.rpc(
    "sweep_expired_company_coverage_limits",
    { p_now: new Date().toISOString(), p_limit: 0 },
  );
  if (
    !sweepError ||
    String(sweepError.code ?? "") !== "22023" ||
    String(sweepError.code ?? "") === "PGRST202"
  ) {
    throw new Error(
      `sweep_expired_company_coverage_limits signature probe expected PostgreSQL 22023 without mutation, got ${sweepError?.code ?? "success"} ${sweepError?.message ?? JSON.stringify(sweepResult)}`,
    );
  }
  console.log(
    "OK schema: sweep_expired_company_coverage_limits non-mutating signature probe",
  );
}

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

async function assertRpcBlocked(client, roleLabel, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (!error) {
    throw new Error(
      `${name}: ${roleLabel} role executed privileged RPC (${JSON.stringify(data)})`,
    );
  }
  if (!isExpectedBlockedRpcError(error)) {
    throw new Error(
      `${name}: expected ${roleLabel} execute denial, got ${error.code ?? "unknown"} ${error.message}`,
    );
  }
  console.log(`OK schema: ${name} blocks ${roleLabel} execute`);
}

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
    select:
      "env,release_id,ticker,name,document_count,sec_cik,sec_ticker,sec_mapping_source,sec_mapping_checked_at",
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
    select:
      "user_id,period_kind,period_start,settled_cost_usd,reserved_cost_usd",
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
      "user_id,ticker,coverage_status,priority,interest_reason,tags,last_activity_at,created_at,updated_at",
  },
  {
    table: "user_company_coverage_events",
    select:
      "id,user_id,ticker,previous_status,coverage_status,changed,source,idempotency_key,created_at",
  },
  {
    table: "user_filing_judgments",
    select:
      "id,user_id,filing_event_id,ticker,current_revision_id,created_at,updated_at",
  },
  {
    table: "user_filing_judgment_revisions",
    select:
      "id,judgment_id,user_id,filing_event_id,ticker,revision_number,impact,next_action,summary,is_current,idempotency_key,created_at",
  },
  {
    table: "user_filing_judgment_thesis_links",
    select:
      "revision_id,judgment_id,user_id,filing_event_id,ticker,thesis_id,impact,position,is_current",
  },
  {
    table: "user_company_monitoring_rules",
    select:
      "id,user_id,ticker,rule_type,operator,value,next_review_at,dedupe_key,enabled,created_by_judgment_revision_id",
  },
  {
    table: "user_filing_judgment_monitoring_rules",
    select: "revision_id,rule_id,user_id,position,created_at",
  },
  {
    table: "user_filing_source_opens",
    select:
      "user_id,filing_event_id,ticker,first_opened_at,last_opened_at",
  },
  {
    table: "user_retention_milestones",
    select: "user_id,milestone,achieved_at,metadata",
  },
  {
    table: "user_decision_sessions",
    select:
      "id,user_id,local_date,timezone,feed_session_id,snapshot_at,judgment_count,open_question_count,next_check_count,outcome,closed_at,updated_at",
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
      "id,user_id,ticker,title,thesis_text,status,tags,monitored_variables,counter_evidence,decision_change_condition,archived_at,source_chat_session_id,source_message_id,created_at,updated_at",
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
    select:
      "id,env,filing_event_id,stage,status,priority,attempts,next_attempt_at",
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
    select:
      "id,filing_event_id,transaction_code,reported_transaction_value,reported_value_basis",
  },
  {
    table: "sec_form4_event_summaries",
    select:
      "filing_event_id,reported_purchase_value,reported_sale_value,tenb5_one_status",
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
    .select(check.select, { head: true })
    .limit(1);

  if (error) {
    console.error(
      `Schema smoke failed for ${check.table} (${check.select}): ${error.message}`,
    );
    process.exit(1);
  }

  console.log(`OK schema: ${check.table} (${check.select})`);
}

try {
  await assertCoverageLimitRpcSignatures();
} catch (error) {
  console.error(
    `Schema smoke failed for coverage-limit RPC signatures: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

async function runCoverageAndJudgmentWriteSmoke() {
  const suffix = `${Date.now()}-${randomUUID()}`;
  const email = `schema-smoke+${suffix}@example.com`;
  const password = `Krw!${randomUUID()}Aa1`;
  let userId = null;

  try {
    // Activation is intentionally scoped to the active catalog's company
    // identity (env + CIK + ticker), not merely to any recent SEC event. Pick
    // two events for the same active catalog company so this smoke validates
    // the coherent positive path rather than depending on ingest freshness.
    const { data: activeReleases, error: activeReleaseError } = await supabase
      .from("ontology_catalog_releases")
      .select("env,release_id")
      .eq("active", true);
    if (activeReleaseError || !activeReleases?.length) {
      throw new Error(
        `coverage/judgment write smoke requires an active catalog release: ${activeReleaseError?.message ?? "none found"}`,
      );
    }

    let filingEvent = null;
    let unrelatedFilingEvent = null;
    let coverageTicker = null;
    for (const activeRelease of activeReleases) {
      if (filingEvent) break;
      const { data: catalogCompanies, error: catalogCompanyError } =
        await supabase
          .from("ontology_companies")
          .select("ticker,sec_cik")
          .eq("env", activeRelease.env)
          .eq("release_id", activeRelease.release_id)
          .not("sec_cik", "is", null)
          .limit(500);
      if (catalogCompanyError) {
        throw new Error(
          `coverage/judgment write smoke could not read active catalog companies: ${catalogCompanyError.message}`,
        );
      }

      const companies = (catalogCompanies ?? []).filter(
        (company) => company.ticker && company.sec_cik,
      );
      for (let index = 0; index < companies.length; index += 100) {
        const companyBatch = companies.slice(index, index + 100);
        const { data: filingEvents, error: filingEventError } = await supabase
          .from("sec_filing_events")
          .select("id,ticker,cik")
          .eq("env", activeRelease.env)
          .in(
            "cik",
            companyBatch.map((company) => company.sec_cik),
          )
          .not("ticker", "is", null)
          .order("occurred_at", { ascending: false })
          .limit(200);
        if (filingEventError) {
          throw new Error(
            `coverage/judgment write smoke could not read catalog filing events: ${filingEventError.message}`,
          );
        }

        for (const company of companyBatch) {
          const matchingEvents = (filingEvents ?? []).filter(
            (event) => event.cik === company.sec_cik,
          );
          if (matchingEvents.length < 2) continue;
          [filingEvent, unrelatedFilingEvent] = matchingEvents;
          coverageTicker = company.ticker.trim().toUpperCase();
          break;
        }
        if (filingEvent) break;
      }
    }
    if (!filingEvent || !unrelatedFilingEvent || !coverageTicker) {
      throw new Error(
        "coverage/judgment write smoke requires two filing events for one active catalog company",
      );
    }

    const { data: createdUser, error: createUserError } =
      await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
    if (createUserError || !createdUser.user?.id) {
      throw new Error(
        `could not create temporary auth user: ${createUserError?.message ?? "missing user id"}`,
      );
    }
    userId = createdUser.user.id;

    const authenticatedSupabase = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: schemaSmokeFetch },
    });
    const { error: signInError } =
      await authenticatedSupabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      throw new Error(
        `temporary auth user could not sign in: ${signInError.message}`,
      );
    }

    const coverageArgs = {
      p_user_id: userId,
      p_ticker: coverageTicker,
      p_coverage_status: "exploring",
      p_idempotency_key: `schema-smoke-coverage-${suffix}`,
      p_source: "schema_smoke",
      p_priority: 0,
      p_interest_reason: null,
      p_tags: [],
      p_active_limit: null,
    };
    const { data: coverageResult, error: coverageError } = await supabase.rpc(
      "set_user_company_coverage_status",
      coverageArgs,
    );
    if (
      coverageError ||
      coverageResult?.coverage_status !== "exploring" ||
      coverageResult?.idempotent_replay !== false
    ) {
      throw new Error(
        `set_user_company_coverage_status service-role write failed: ${coverageError?.message ?? JSON.stringify(coverageResult)}`,
      );
    }
    console.log(
      "OK schema: set_user_company_coverage_status service-role write",
    );

    for (const [index, ticker] of ["SMOKEAAA", "SMOKEBBB"].entries()) {
      const { data: extraCoverage, error: extraCoverageError } =
        await supabase.rpc("set_user_company_coverage_status", {
          ...coverageArgs,
          p_ticker: ticker,
          p_idempotency_key: `schema-smoke-coverage-${index + 2}-${suffix}`,
        });
      if (
        extraCoverageError ||
        extraCoverage?.coverage_status !== "exploring"
      ) {
        throw new Error(
          `coverage activation setup failed for ${ticker}: ${extraCoverageError?.message ?? JSON.stringify(extraCoverage)}`,
        );
      }
    }

    const judgmentArgs = {
      p_user_id: userId,
      p_filing_event_id: filingEvent.id,
      p_ticker: coverageTicker,
      p_impact: "unclear",
      p_next_action: "complete",
      p_summary: "Production schema smoke judgment",
      p_rationale: "Temporary row; removed with the smoke-test auth user.",
      p_thesis_links: [],
      p_monitoring_rules: [
        {
          rule_type: "filing_form",
          operator: "matches",
          value: "8-K",
        },
      ],
      p_idempotency_key: `schema-smoke-judgment-${suffix}`,
      p_expected_revision_number: null,
    };
    const { data: judgmentResult, error: judgmentError } = await supabase.rpc(
      "save_user_filing_judgment_revision",
      judgmentArgs,
    );
    if (
      judgmentError ||
      judgmentResult?.revision_number !== 1 ||
      judgmentResult?.idempotent_replay !== false ||
      judgmentResult?.created_rule_ids?.length !== 1
    ) {
      throw new Error(
        `save_user_filing_judgment_revision service-role write failed: ${judgmentError?.message ?? JSON.stringify(judgmentResult)}`,
      );
    }

    const { data: replayResult, error: replayError } = await supabase.rpc(
      "save_user_filing_judgment_revision",
      judgmentArgs,
    );
    if (
      replayError ||
      replayResult?.revision_id !== judgmentResult.revision_id ||
      replayResult?.idempotent_replay !== true
    ) {
      throw new Error(
        `save_user_filing_judgment_revision idempotent replay failed: ${replayError?.message ?? JSON.stringify(replayResult)}`,
      );
    }
    console.log(
      "OK schema: save_user_filing_judgment_revision service-role write and replay",
    );

    const expectActivation = async (expected, label) => {
      const { data, error } = await supabase.rpc(
        "try_record_coverage_activation",
        { p_user_id: userId },
      );
      if (error || data !== expected) {
        throw new Error(
          `${label}: expected activation=${expected}, got ${error?.message ?? JSON.stringify(data)}`,
        );
      }
    };

    await expectActivation(false, "missing source-open negative check");

    const sourceOpen = {
      user_id: userId,
      filing_event_id: unrelatedFilingEvent.id,
      ticker: unrelatedFilingEvent.ticker.trim().toUpperCase(),
      first_opened_at: new Date().toISOString(),
      last_opened_at: new Date().toISOString(),
    };
    const { error: sourceOpenError } = await supabase
      .from("user_filing_source_opens")
      .insert(sourceOpen);
    if (sourceOpenError) {
      throw new Error(
        `user_filing_source_opens service-role write failed: ${sourceOpenError.message}`,
      );
    }
    await expectActivation(false, "different filing-event source-open negative check");

    const matchingSourceOpen = {
      ...sourceOpen,
      filing_event_id: filingEvent.id,
      ticker: coverageTicker,
      first_opened_at: new Date().toISOString(),
      last_opened_at: new Date().toISOString(),
    };
    const { error: sourceOpenMatchError } = await supabase
      .from("user_filing_source_opens")
      .insert(matchingSourceOpen);
    if (sourceOpenMatchError) {
      throw new Error(
        `user_filing_source_opens coherent update failed: ${sourceOpenMatchError.message}`,
      );
    }

    // Closing a coverage deliberately disables its monitoring rules. Exercise
    // the closed/reopened negative path with an auxiliary mark so the primary
    // judgment rule remains the coherent loop under test.
    const activationLimitProbeArgs = {
      ...coverageArgs,
      p_ticker: "SMOKEAAA",
    };
    const { error: closeCoverageError } = await supabase.rpc(
      "set_user_company_coverage_status",
      {
        ...activationLimitProbeArgs,
        p_coverage_status: "closed",
        p_idempotency_key: `schema-smoke-coverage-close-${suffix}`,
      },
    );
    if (closeCoverageError) {
      throw new Error(`coverage close setup failed: ${closeCoverageError.message}`);
    }
    await expectActivation(false, "closed coverage negative check");

    const { error: reopenCoverageError } = await supabase.rpc(
      "set_user_company_coverage_status",
      {
        ...activationLimitProbeArgs,
        p_idempotency_key: `schema-smoke-coverage-reopen-${suffix}`,
      },
    );
    if (reopenCoverageError) {
      throw new Error(
        `coverage reopen setup failed: ${reopenCoverageError.message}`,
      );
    }
    await expectActivation(true, "coherent coverage loop positive check");
    await expectActivation(false, "coverage milestone idempotency check");
    console.log(
      "OK schema: coherent coverage activation requires matching source, active coverage, judgment, and linked rule",
    );

    for (const [blockedClient, roleLabel] of [
      [anonSupabase, "anon"],
      [authenticatedSupabase, "authenticated"],
    ]) {
      const { error: blockedSourceOpenError } = await blockedClient
        .from("user_filing_source_opens")
        .upsert(
          {
            ...matchingSourceOpen,
            last_opened_at: new Date().toISOString(),
          },
          { onConflict: "user_id,filing_event_id" },
        );
      if (!blockedSourceOpenError) {
        throw new Error(
          `user_filing_source_opens: ${roleLabel} role inserted privileged state`,
        );
      }
      if (!isExpectedBlockedRpcError(blockedSourceOpenError)) {
        throw new Error(
          `user_filing_source_opens: expected ${roleLabel} permission/RLS denial, got ${blockedSourceOpenError.code ?? "unknown"} ${blockedSourceOpenError.message}`,
        );
      }
    }
    console.log(
      "OK schema: user_filing_source_opens blocks anon/authenticated writes",
    );

    await assertRpcBlocked(
      anonSupabase,
      "anon",
      "set_user_company_coverage_status",
      {
        ...coverageArgs,
        p_idempotency_key: `${coverageArgs.p_idempotency_key}-anon`,
      },
    );
    await assertRpcBlocked(
      authenticatedSupabase,
      "authenticated",
      "set_user_company_coverage_status",
      {
        ...coverageArgs,
        p_idempotency_key: `${coverageArgs.p_idempotency_key}-auth`,
      },
    );
    await assertRpcBlocked(
      anonSupabase,
      "anon",
      "save_user_filing_judgment_revision",
      {
        ...judgmentArgs,
        p_idempotency_key: `${judgmentArgs.p_idempotency_key}-anon`,
      },
    );
    await assertRpcBlocked(
      authenticatedSupabase,
      "authenticated",
      "save_user_filing_judgment_revision",
      {
        ...judgmentArgs,
        p_idempotency_key: `${judgmentArgs.p_idempotency_key}-auth`,
      },
    );
  } finally {
    if (userId) {
      // `try_record_coverage_activation` intentionally writes a system
      // analytics event. analytics_events predates auth-user cascade cleanup,
      // so remove this bounded smoke-only row before deleting its temporary
      // auth user.
      const { error: deleteAnalyticsError } = await supabase
        .from("analytics_events")
        .delete()
        .eq("user_id", userId);
      if (deleteAnalyticsError) {
        throw new Error(
          `temporary schema-smoke analytics cleanup failed: ${deleteAnalyticsError.message}`,
        );
      }
      const { error: deleteUserError } =
        await supabase.auth.admin.deleteUser(userId);
      if (deleteUserError) {
        throw new Error(
          `temporary schema-smoke user cleanup failed: ${deleteUserError.message}`,
        );
      }
    }
  }
}

try {
  await runCoverageAndJudgmentWriteSmoke();
} catch (error) {
  console.error(
    `Schema smoke failed for coverage/judgment RPCs: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}

const smokeKey = `schema-smoke:${Date.now()}`;
const { error: rpcError } = await supabase.rpc("increment_rate_limit", {
  p_key: smokeKey,
  p_bucket: "schema_smoke",
  p_window_start: new Date(
    Math.floor(Date.now() / 60_000) * 60_000,
  ).toISOString(),
  p_window_seconds: 60,
  p_limit: 100,
});

if (rpcError) {
  console.error(
    `Schema smoke failed for increment_rate_limit RPC: ${rpcError.message}`,
  );
  process.exit(1);
}

await supabase.from("rate_limit_counters").delete().eq("key", smokeKey);
console.log("OK schema: increment_rate_limit RPC");

const { error: filingClaimError } = await supabase.rpc(
  "claim_filing_notification_deliveries",
  {
    p_worker_id: "",
    p_limit: 1,
    p_lease_seconds: 30,
  },
);
if (
  !filingClaimError ||
  !filingClaimError.message.toLowerCase().includes("p_worker_id is required")
) {
  console.error(
    `Schema smoke failed for non-mutating claim_filing_notification_deliveries signature probe: ${filingClaimError?.message ?? "unexpected success"}`,
  );
  process.exit(1);
}
console.log("OK schema: claim_filing_notification_deliveries non-mutating signature probe");

async function assertRequiredArgumentProbe(name, args, expectedMessage) {
  const { error } = await supabase.rpc(name, args);
  if (!error || !error.message.toLowerCase().includes(expectedMessage)) {
    console.error(
      `Schema smoke failed for non-mutating ${name} signature probe: ${error?.code ?? "unexpected-success"} ${error?.message ?? "RPC executed"}`,
    );
    process.exit(1);
  }
  console.log(`OK schema: ${name} non-mutating signature probe`);
}

// These exact overloads are called by the production document workers. Empty
// or null required arguments fail before any row can be claimed, while still
// forcing PostgREST to resolve the deployed signature from its schema cache.
await assertRequiredArgumentProbe(
  "claim_document_ingestion_job_v2",
  { p_worker_id: "", p_lease_seconds: 30, p_global_limit: 1 },
  "worker_id is required",
);
await assertRequiredArgumentProbe(
  "claim_document_ingestion_job_by_id_v2",
  {
    p_job_id: null,
    p_worker_id: "schema-smoke",
    p_lease_seconds: 30,
    p_global_limit: 1,
  },
  "job_id is required",
);
await assertRequiredArgumentProbe(
  "claim_document_source_cleanup_job",
  { p_worker_id: "", p_lease_seconds: 30 },
  "worker_id is required",
);

const pulseSnapshot = new Date();
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
  console.error(
    `Schema smoke failed for get_catalog_pulse_filing_candidates_v3 RPC: ${pulseCandidateV3RpcError.message}`,
  );
  process.exit(1);
}
console.log("OK schema: get_catalog_pulse_filing_candidates_v3 RPC");

const { data: activationResult, error: activationRpcError } =
  await supabase.rpc("try_record_coverage_activation", {
    p_user_id: "00000000-0000-0000-0000-000000000000",
  });
if (activationRpcError || activationResult !== false) {
  console.error(
    `Schema smoke failed for try_record_coverage_activation RPC: ${activationRpcError?.message ?? "unexpected activation"}`,
  );
  process.exit(1);
}
console.log("OK schema: try_record_coverage_activation RPC");

const { error: closeDecisionSessionRpcError } = await supabase.rpc(
  "close_user_decision_session",
  {
    p_user_id: "00000000-0000-0000-0000-000000000000",
    p_feed_session_id: "00000000-0000-4000-8000-000000000000",
    p_timezone: "UTC",
  },
);
if (
  closeDecisionSessionRpcError &&
  closeDecisionSessionRpcError.code !== "22023" &&
  closeDecisionSessionRpcError.code !== "23503"
) {
  console.error(
    `Schema smoke failed for close_user_decision_session RPC: ${closeDecisionSessionRpcError.message}`,
  );
  process.exit(1);
}
console.log("OK schema: close_user_decision_session RPC");

const { error: pulseStatusRpcError } = await supabase.rpc(
  "get_catalog_pulse_feed_status_v1",
  {
    p_env: "prod",
    p_since: new Date(pulseSnapshot.getTime() - 5 * 60_000).toISOString(),
    p_snapshot_at: pulseSnapshot.toISOString(),
  },
);
if (pulseStatusRpcError) {
  console.error(
    `Schema smoke failed for get_catalog_pulse_feed_status_v1 RPC: ${pulseStatusRpcError.message}`,
  );
  process.exit(1);
}
console.log("OK schema: get_catalog_pulse_feed_status_v1 RPC");

const secLimiterScope = `schema-smoke-${Date.now()}`;
const { data: secSlot, error: secSlotError } = await supabase.rpc(
  "reserve_sec_request_slot",
  {
    p_scope: secLimiterScope,
    p_min_interval_ms: 100,
  },
);
if (
  secSlotError ||
  typeof secSlot !== "string" ||
  Number.isNaN(Date.parse(secSlot))
) {
  console.error(
    `Schema smoke failed for reserve_sec_request_slot RPC: ${secSlotError?.message ?? "invalid slot timestamp"}`,
  );
  process.exit(1);
}
await supabase
  .from("sec_request_rate_limit_slots")
  .delete()
  .eq("scope", secLimiterScope);
console.log("OK schema: reserve_sec_request_slot RPC");

const zeroUuid = "00000000-0000-0000-0000-000000000000";
const { error: reserveRpcError } = await supabase.rpc(
  "reserve_execution_budget",
  {
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
  },
);

if (reserveRpcError && reserveRpcError.code !== "23503") {
  console.error(
    `Schema smoke failed for reserve_execution_budget RPC: ${reserveRpcError.message}`,
  );
  process.exit(1);
}
console.log("OK schema: reserve_execution_budget RPC");

const { error: reserveAnalysisRpcError } = await supabase.rpc(
  "reserve_analysis_credits",
  {
    p_user_id: zeroUuid,
    p_request_id: `schema-smoke-analysis:${Date.now()}`,
    p_reserve_credits_raw: 1,
    p_expires_at: new Date(Date.now() + 60_000).toISOString(),
    p_now: new Date(Date.UTC(2099, 0, 1)).toISOString(),
  },
);

if (reserveAnalysisRpcError && reserveAnalysisRpcError.code !== "23503") {
  console.error(
    `Schema smoke failed for reserve_analysis_credits RPC: ${reserveAnalysisRpcError.message}`,
  );
  process.exit(1);
}
console.log("OK schema: reserve_analysis_credits RPC");

const { error: pulseImpressionRpcError } = await supabase.rpc(
  "record_pulse_item_impression",
  {
    p_user_id: zeroUuid,
    p_item_key: "filing:schema-smoke",
    p_source_type: "filing",
    p_source_id: "schema-smoke",
    p_kind: "filing",
    p_feed_session_id: "00000000-0000-4000-8000-000000000000",
    p_seen_at: new Date().toISOString(),
  },
);
if (pulseImpressionRpcError && pulseImpressionRpcError.code !== "23503") {
  console.error(
    `Schema smoke failed for record_pulse_item_impression RPC: ${pulseImpressionRpcError.message}`,
  );
  process.exit(1);
}
console.log("OK schema: record_pulse_item_impression RPC");

async function expectAnonRpcBlocked(name, args) {
  try {
    await assertRpcBlocked(anonSupabase, "anon", name, args);
  } catch (error) {
    console.error(
      `Schema smoke failed for ${name}: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}

async function expectAnonTableBlocked(table, select) {
  const { error, status } = await anonSupabase
    .from(table)
    .select(select, { head: true })
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

await expectAnonTableBlocked("billing_toss_customers", "user_id,customer_key");
await expectAnonTableBlocked(
  "billing_toss_checkout_sessions",
  "id,user_id,status",
);
await expectAnonTableBlocked(
  "billing_toss_subscriptions",
  "id,user_id,status,billing_key",
);
await expectAnonTableBlocked("billing_toss_payments", "id,user_id,status");
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
await expectAnonRpcBlocked("get_catalog_pulse_filing_candidates_v3", {
  p_env: "prod",
  p_snapshot_at: new Date().toISOString(),
  p_preferred_tickers: [],
  p_urgent_limit: 1,
  p_priority_limit: 1,
  p_preferred_limit: 1,
  p_discovery_limit: 1,
});
await expectAnonRpcBlocked("try_record_coverage_activation", {
  p_user_id: zeroUuid,
});
await expectAnonRpcBlocked("close_user_decision_session", {
  p_user_id: zeroUuid,
  p_feed_session_id: "00000000-0000-4000-8000-000000000000",
  p_timezone: "UTC",
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
