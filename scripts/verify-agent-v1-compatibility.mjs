import { Pool } from "pg";

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
  ssl: isTlsUrl(connectionString) ? { rejectUnauthorized: false } : undefined,
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
          to_regprocedure('public.enqueue_agent_v1_product_run_v7(jsonb)') is not null as product_enqueue,
          to_regprocedure('public.cancel_agent_v1_product_run(jsonb)') is not null as product_cancel,
          to_regprocedure('public.apply_agent_v1_product_outbox(jsonb)') is not null as product_outbox,
          to_regprocedure('public.mark_agent_run_terminal(uuid,public.run_status,timestamptz,text,text,integer,integer,numeric,integer,uuid,text)') is not null as terminal_lifecycle,
          to_regclass('public.agent_v1_product_run_mappings') is not null as mappings_table,
          to_regclass('public.agent_v1_product_outbox_receipts') is not null as receipts_table,
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
      "product_enqueue",
      "product_cancel",
      "product_outbox",
      "terminal_lifecycle",
      "mappings_table",
      "receipts_table",
      "session_backend_column",
      "session_closed_column",
    ];
    const missing = required.filter((key) => row[key] !== true);
    if (missing.length > 0) fail(`agent_v1_compatibility_missing:${missing.join(",")}`);
    console.log(JSON.stringify({ ok: true, checked: required.length }));
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

function isTlsUrl(value) {
  return /^(postgres|postgresql):\/\//.test(value) && !/[?&]sslmode=disable(?:&|$)/i.test(value);
}

function fail(code) {
  console.error(code);
  process.exit(1);
}
