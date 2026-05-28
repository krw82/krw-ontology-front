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

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for schema smoke test.",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const checks = [
  {
    table: "chat_sessions",
    select: "id,deleted_at,client_request_id",
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

console.log("Supabase schema smoke test passed.");
