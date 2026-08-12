import { Pool } from "pg";
import { lstatSync, readFileSync } from "node:fs";

const connectionString = firstNonEmpty(
  process.env.AGENT_V1_DATABASE_URL,
  process.env.SUPABASE_DB_URL,
  process.env.DATABASE_URL,
  process.env.POSTGRES_URL,
);

if (!connectionString) {
  fail("agent_v1_database_url_missing");
}

const pool = new Pool({
  connectionString,
  application_name: "krw-front-agent-v1-compatibility-gate",
  max: 1,
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 5_000,
  ssl: resolvePostgresTls(connectionString, process.env),
});

try {
  const client = await pool.connect();
  try {
    const { rows } = await client.query({
      name: "krw_agent_v1_compatibility_gate",
      text: `
        select
          to_regprocedure('agent_v1.enqueue_run(jsonb)') is not null as enqueue_run,
          to_regprocedure('agent_v1.request_cancel(jsonb)') is not null as request_cancel,
          to_regprocedure('agent_v1.read_final_projection(jsonb)') is not null as read_final_projection,
          to_regprocedure('agent_v1.claim_outbox(jsonb)') is not null as claim_outbox,
          to_regprocedure('agent_v1.ack_outbox(jsonb)') is not null as ack_outbox,
          to_regprocedure('agent_v1.heartbeat_daemon(jsonb)') is not null as daemon_heartbeat,
          to_regprocedure('public.enqueue_agent_v1_product_run_v7(jsonb)') is not null as product_enqueue,
          to_regprocedure('public.cancel_agent_v1_product_run(jsonb)') is not null as product_cancel,
          to_regprocedure('public.apply_agent_v1_product_outbox(jsonb)') is not null as product_outbox,
          coalesce(
            position(
              'wide_research' in pg_get_functiondef(
                to_regprocedure('public.enqueue_agent_v1_product_run_v7(jsonb)')
              )
            ),
            0
          ) > 0 as wide_research_enqueue,
          exists (
            select 1
              from pg_constraint
             where conrelid = 'public.agent_runs'::regclass
               and conname = 'agent_runs_run_kind_check'
               and pg_get_constraintdef(oid) like '%wide_research%'
               and pg_get_constraintdef(oid) like '%guru_buffett%'
          ) as research_run_kind_constraint,
          to_regprocedure('agent_v1.commit_final(jsonb)') is not null as commit_final,
          to_regprocedure('public.mark_agent_run_terminal(uuid,public.run_status,timestamptz,text,text,integer,integer,numeric,integer,uuid,text)') is not null as terminal_lifecycle,
          to_regclass('public.agent_v1_product_run_mappings') is not null as mappings_table,
          to_regclass('public.agent_v1_product_outbox_receipts') is not null as receipts_table,
          to_regclass('public.agent_v1_daemon_heartbeats') is not null as daemon_heartbeats_table,
          to_regclass('agent_store.session_memory_frontiers') is not null as session_memory_frontiers,
          to_regclass('agent_store.session_memory_deltas') is not null as session_memory_deltas,
          exists (
            select 1 from information_schema.columns
             where table_schema = 'agent_store'
               and table_name = 'answer_bundles'
               and column_name = 'final_output_hash'
          ) as final_output_hash_column,
          not exists (
            select 1 from agent_store.answer_bundles
             where final_output_hash is null
          ) as final_output_hash_complete,
          exists (
            select 1 from information_schema.columns
             where table_schema = 'public'
               and table_name = 'chat_sessions'
               and column_name = 'agent_backend'
          ) as session_backend_column,
          exists (
            select 1 from information_schema.columns
             where table_schema = 'public'
               and table_name = 'chat_sessions'
               and column_name = 'closed_at'
          ) as session_closed_column
      `,
    });
    const row = rows[0] ?? {};
    const required = [
      "enqueue_run",
      "request_cancel",
      "read_final_projection",
      "claim_outbox",
      "ack_outbox",
      "daemon_heartbeat",
      "product_enqueue",
      "product_cancel",
      "product_outbox",
      "wide_research_enqueue",
      "research_run_kind_constraint",
      "commit_final",
      "terminal_lifecycle",
      "mappings_table",
      "receipts_table",
      "daemon_heartbeats_table",
      "session_memory_frontiers",
      "session_memory_deltas",
      "final_output_hash_column",
      "final_output_hash_complete",
      "session_backend_column",
      "session_closed_column",
    ];
    const missing = required.filter((key) => row[key] !== true);
    if (missing.length > 0) fail(`agent_v1_compatibility_missing:${missing.join(",")}`);
    console.log(JSON.stringify({ ok: true, checked: required.length, schema_compatibility: "agent_v1_v7" }));
  } finally {
    client.release();
  }
} catch (error) {
  fail(error instanceof Error ? error.message.slice(0, 200) : "agent_v1_compatibility_query_failed");
} finally {
  await pool.end();
}

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === "string" && value.trim())?.trim() ?? null;
}

function resolvePostgresTls(value, env) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") return undefined;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return undefined;
  const pem = firstNonEmpty(env.AGENT_V1_DATABASE_CA_PEM);
  const file = firstNonEmpty(env.AGENT_V1_DATABASE_CA_FILE);
  if (pem && file) fail("agent_v1_database_ca_ambiguous");
  if (url.searchParams.get("sslmode") === "disable") {
    if (env.KRW_RUNTIME_ENVIRONMENT === "prod" || env.NODE_ENV === "production") {
      fail("agent_v1_database_tls_disabled");
    }
    return undefined;
  }
  if (env.KRW_RUNTIME_ENVIRONMENT === "prod" || env.NODE_ENV === "production") {
    if (!pem && !file) fail("agent_v1_database_ca_missing");
  }
  if (file) {
    try {
      if (!lstatSync(file).isFile()) fail("agent_v1_database_ca_file_invalid");
      return { ca: readFileSync(file, "utf8"), rejectUnauthorized: true };
    } catch {
      fail("agent_v1_database_ca_file_unreadable");
    }
  }
  return pem ? { ca: pem, rejectUnauthorized: true } : { rejectUnauthorized: true };
}

function fail(code) {
  console.error(code);
  process.exit(1);
}
