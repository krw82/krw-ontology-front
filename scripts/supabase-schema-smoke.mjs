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
      "id,deleted_at,client_request_id,last_message_preview,last_message_at,latest_run_status",
  },
  {
    table: "messages",
    select: "id,request_id,status",
  },
  {
    table: "agent_runs",
    select: "id,request_id,sdk_diagnostics",
  },
  {
    table: "agent_worker_heartbeats",
    select: "worker_id,ontology_env,ontology_release_id,manifest_valid",
  },
  {
    table: "ontology_catalog_releases",
    select: "env,release_id,active,company_count,document_count",
  },
  {
    table: "ontology_companies",
    select: "env,release_id,ticker,name,document_count",
  },
  {
    table: "message_shares",
    select: "id,token,revoked_at",
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

await expectAnonRpcBlocked("claim_agent_run", {
  p_worker_id: "",
  p_lease_seconds: 300,
  p_global_limit: 1,
});
await expectAnonRpcBlocked("claim_agent_run", {
  p_worker_id: "schema-smoke",
  p_worker_env: "invalid",
  p_ontology_env: "prod",
  p_lease_seconds: 300,
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
await expectAnonRpcBlocked("record_usage_event", {
  p_user_id: zeroUuid,
  p_request_id: "schema-smoke",
  p_run_id: zeroUuid,
  p_period_start: new Date().toISOString(),
  p_period_end: new Date().toISOString(),
  p_cost: 0,
});

console.log("Supabase schema smoke test passed.");
