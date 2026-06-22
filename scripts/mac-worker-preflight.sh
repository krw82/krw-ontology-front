#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/mac-worker-preflight.sh [--env-file FILE] [--worker-id ID] [--skip-worker-duplicate-check] [--allow-local-queue-writer] [--deep]

Validate this Mac before it is allowed to run the production agent worker.

Checks:
  - required env exists without printing secrets
  - local ontology data, plugin, and agent workspace paths exist
  - local ontology queue status is safe according to krw-ontology CLI
  - no duplicate Mac agent worker with the same worker id is already running
  - prod/current satisfies the KRW Ontology v3 startup contract
  - worker bundle builds
  - Claude executable and MCP health work
  - enabled news translation provider can translate a smoke sentence
  - Supabase service role can read the production schema

--deep is accepted for compatibility. KRW Ontology v3 deep release checks run
offline during release publish; this preflight remains startup-safe.
EOF
}

ENV_FILE=.env.mac-worker.production
WORKER_ID_OVERRIDE=
SKIP_WORKER_DUPLICATE_CHECK=0
ALLOW_LOCAL_QUEUE_WRITER=${ALLOW_LOCAL_QUEUE_WRITER:-0}
DEEP_CHECK=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE=${2:?Missing value for --env-file}
      shift
      ;;
    --worker-id)
      WORKER_ID_OVERRIDE=${2:?Missing value for --worker-id}
      shift
      ;;
    --skip-worker-duplicate-check)
      SKIP_WORKER_DUPLICATE_CHECK=1
      ;;
    --allow-local-queue-writer)
      ALLOW_LOCAL_QUEUE_WRITER=1
      ;;
    --deep)
      DEEP_CHECK=1
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
  shift
done

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_path() {
  if [ ! -e "$1" ]; then
    echo "Missing required path: $1" >&2
    exit 1
  fi
}

require_env() {
  key=$1
  eval "value=\${$key:-}"
  if [ -z "$value" ]; then
    echo "Missing required env value: $key" >&2
    exit 1
  fi
}

if [ ! -f "$ENV_FILE" ]; then
  echo "Missing Mac worker env file: $ENV_FILE" >&2
  echo "Create it with: scripts/init-mac-worker-env.sh" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

if [ -n "$WORKER_ID_OVERRIDE" ]; then
  AGENT_SUPERVISOR_ID=$WORKER_ID_OVERRIDE
fi
AGENT_SUPERVISOR_ID=${AGENT_SUPERVISOR_ID:-${AGENT_WORKER_ID:-mac-supervisor-jwc}}
AGENT_WORKER_ID=$AGENT_SUPERVISOR_ID
export AGENT_SUPERVISOR_ID
export AGENT_WORKER_ID
if [ -z "${AGENT_SUPERVISOR_CONCURRENCY:-}" ]; then
  AGENT_SUPERVISOR_CONCURRENCY=${MAC_WORKER_COUNT:-1}
  export AGENT_SUPERVISOR_CONCURRENCY
fi

KRW_ONTOLOGY_QUEUE_ROOT=${KRW_ONTOLOGY_QUEUE_ROOT:-"$HOME/krw-ontology-data-running"}

if [ -n "${CLAUDE_CONFIG_DIR:-}" ] && [ -f "$CLAUDE_CONFIG_DIR/deepseek.env" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$CLAUDE_CONFIG_DIR/deepseek.env"
  set +a
fi

case "${ANTHROPIC_API_KEY:-}" in
  ""|"sk-placeholder"|"sk-ant-..."|"sk-ant-…"|"<anthropic-api-key>")
    unset ANTHROPIC_API_KEY
    ;;
esac

case "${ANTHROPIC_AUTH_TOKEN:-}" in
  ""|"sk-placeholder"|"sk-ant-..."|"sk-ant-…"|"<anthropic-auth-token>")
    unset ANTHROPIC_AUTH_TOKEN
    ;;
esac

if [ -n "${DEEPSEEK_API_KEY:-}" ] && [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  ANTHROPIC_AUTH_TOKEN=$DEEPSEEK_API_KEY
  export ANTHROPIC_AUTH_TOKEN
fi

for key in \
  NEXT_PUBLIC_SUPABASE_URL \
  NEXT_PUBLIC_SUPABASE_ANON_KEY \
  SUPABASE_URL \
  SUPABASE_ANON_KEY \
  SUPABASE_SERVICE_ROLE_KEY \
  KRW_ONTOLOGY_ENV \
  KRW_ONTOLOGY_RELEASE_ROOT \
  KRW_ONTOLOGY_ROOT \
  KRW_ONTOLOGY_MANIFEST_PATH \
  KRW_ONTOLOGY_SOURCE_DIR \
  KRW_ONTOLOGY_PLUGIN_PATH \
  KRW_ONTOLOGY_MCP_URL \
  CLAUDE_AGENT_CWD \
  CLAUDE_CODE_EXECUTABLE \
  CLAUDE_CONFIG_DIR \
  EXPECTED_CLAUDE_CODE_VERSION \
  AGENT_SUPERVISOR_ID \
  GLOBAL_CONCURRENT_RUN_LIMIT \
  LEASE_TIMEOUT_MINUTES
do
  require_env "$key"
done

case "$AGENT_SUPERVISOR_CONCURRENCY" in
  ''|*[!0-9]*)
    echo "AGENT_SUPERVISOR_CONCURRENCY must be a positive integer: $AGENT_SUPERVISOR_CONCURRENCY" >&2
    exit 1
    ;;
esac
if [ "$AGENT_SUPERVISOR_CONCURRENCY" -lt 1 ]; then
  echo "AGENT_SUPERVISOR_CONCURRENCY must be at least 1." >&2
  exit 1
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  echo "Missing Claude auth after placeholder cleanup: set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN." >&2
  exit 1
fi

if [ "$KRW_ONTOLOGY_ENV" != "prod" ]; then
  echo "Mac production worker requires KRW_ONTOLOGY_ENV=prod, got: $KRW_ONTOLOGY_ENV" >&2
  exit 1
fi

case "$KRW_ONTOLOGY_RELEASE_ROOT" in
  */releases/prod/current) ;;
  *)
    echo "Mac production worker requires KRW_ONTOLOGY_RELEASE_ROOT to end with /releases/prod/current." >&2
    echo "Got: $KRW_ONTOLOGY_RELEASE_ROOT" >&2
    exit 1
    ;;
esac

if [ "$KRW_ONTOLOGY_ROOT" != "$KRW_ONTOLOGY_RELEASE_ROOT" ]; then
  echo "Mac production worker requires KRW_ONTOLOGY_ROOT to equal KRW_ONTOLOGY_RELEASE_ROOT." >&2
  echo "KRW_ONTOLOGY_ROOT=$KRW_ONTOLOGY_ROOT" >&2
  echo "KRW_ONTOLOGY_RELEASE_ROOT=$KRW_ONTOLOGY_RELEASE_ROOT" >&2
  exit 1
fi

case "$GLOBAL_CONCURRENT_RUN_LIMIT" in
  ''|*[!0-9]*)
    echo "GLOBAL_CONCURRENT_RUN_LIMIT must be a positive integer: $GLOBAL_CONCURRENT_RUN_LIMIT" >&2
    exit 1
    ;;
esac
if [ "$GLOBAL_CONCURRENT_RUN_LIMIT" -lt "$AGENT_SUPERVISOR_CONCURRENCY" ]; then
  echo "Refusing supervisor concurrency $AGENT_SUPERVISOR_CONCURRENCY with GLOBAL_CONCURRENT_RUN_LIMIT=$GLOBAL_CONCURRENT_RUN_LIMIT." >&2
  echo "GLOBAL_CONCURRENT_RUN_LIMIT must be at least AGENT_SUPERVISOR_CONCURRENCY." >&2
  exit 1
fi

require_command npm
require_command node
require_command ps
require_command awk
require_command uv
require_command "$CLAUDE_CODE_EXECUTABLE"

require_path "$KRW_ONTOLOGY_ROOT"
require_path "$KRW_ONTOLOGY_RELEASE_ROOT"
require_path "$KRW_ONTOLOGY_MANIFEST_PATH"
require_path "$KRW_ONTOLOGY_SOURCE_DIR/pyproject.toml"
require_path "$KRW_ONTOLOGY_PLUGIN_PATH/.mcp.json"
require_path "$KRW_ONTOLOGY_PLUGIN_PATH/.claude-plugin/plugin.json"
mkdir -p "$CLAUDE_AGENT_CWD" "$CLAUDE_CONFIG_DIR"

echo "Checking news translation readiness..."
(cd "$FRONT_DIR" && node scripts/verify-news-translation.mjs)

if [ ! -L "$KRW_ONTOLOGY_RELEASE_ROOT" ]; then
  echo "KRW_ONTOLOGY_RELEASE_ROOT must be the prod/current symlink: $KRW_ONTOLOGY_RELEASE_ROOT" >&2
  exit 1
fi

echo "Checking prod v3 release startup contract..."
uv --directory "$KRW_ONTOLOGY_SOURCE_DIR" run krw-ontology release verify \
  --startup-check \
  --root "$KRW_ONTOLOGY_RELEASE_ROOT" \
  --env prod \
  --require-current-symlink >/dev/null
echo "OK prod v3 release startup contract"

echo "Checking local ontology queue status..."
queue_status_json=$(uv --directory "$KRW_ONTOLOGY_SOURCE_DIR" run krw-ontology queue status \
  --root "$KRW_ONTOLOGY_QUEUE_ROOT" \
  --json)
QUEUE_STATUS_JSON="$queue_status_json" \
ALLOW_LOCAL_QUEUE_WRITER="$ALLOW_LOCAL_QUEUE_WRITER" \
KRW_ONTOLOGY_QUEUE_ROOT="$KRW_ONTOLOGY_QUEUE_ROOT" \
node <<'NODE'
const fs = require("fs");
const path = require("path");

const status = JSON.parse(process.env.QUEUE_STATUS_JSON || "{}");
const prodCurrent = path.resolve(process.env.KRW_ONTOLOGY_RELEASE_ROOT);
const allowLocalQueueWriter = process.env.ALLOW_LOCAL_QUEUE_WRITER === "1";

function existingRealPath(candidate) {
  try {
    return fs.realpathSync(candidate);
  } catch {
    const parent = path.dirname(candidate);
    try {
      return path.join(fs.realpathSync(parent), path.basename(candidate));
    } catch {
      return path.resolve(candidate);
    }
  }
}

const prodReal = existingRealPath(prodCurrent);
function pointsAtProdCurrent(candidate) {
  if (!candidate) return false;
  const resolved = path.resolve(candidate);
  if (resolved === prodCurrent || resolved.startsWith(prodCurrent + path.sep)) {
    return true;
  }
  const real = existingRealPath(resolved);
  return real === prodReal || real.startsWith(prodReal + path.sep);
}

const risks = [];
if (pointsAtProdCurrent(status.root)) risks.push(`queue root=${status.root}`);
for (const root of status.active_publish_roots || []) {
  if (pointsAtProdCurrent(root)) risks.push(`active publish root=${root}`);
}
for (const indexPath of status.active_publish_index_paths || []) {
  if (pointsAtProdCurrent(indexPath)) risks.push(`active publish index path=${indexPath}`);
}
const workerMode = status.worker && status.worker.mode;
if (workerMode && workerMode.publish_prod === true) {
  risks.push("worker mode publish_prod=true");
}

if (risks.length > 0 && !allowLocalQueueWriter) {
  console.error("Local ontology queue can mutate prod/current. Stop it before using this Mac as the production worker:");
  for (const risk of risks) console.error(`- ${risk}`);
  console.error("Expected: queue roots stay outside prod/current; prod changes happen through release promote/publish.");
  process.exit(1);
}

const workerState = status.worker && status.worker.state ? status.worker.state : "unknown";
const root = status.root || process.env.KRW_ONTOLOGY_QUEUE_ROOT;
const publishProd = workerMode && workerMode.publish_prod === true ? "true" : "false";
console.log(`OK local ontology queue status via CLI: worker=${workerState} root=${root} publish_prod=${publishProd}`);
NODE

if [ "$SKIP_WORKER_DUPLICATE_CHECK" != "1" ]; then
  worker_processes=$(
    ps eww -axo pid,command \
      | awk -v id="AGENT_WORKER_ID=$AGENT_SUPERVISOR_ID" '/[.]worker\/agent-worker[.]mjs/ && index($0, id) > 0 && !/awk/ { print $1 }'
  )
  if [ -n "$worker_processes" ]; then
    echo "A Mac agent supervisor with id $AGENT_SUPERVISOR_ID is already running. Refusing duplicate supervisor id. Existing PID(s):" >&2
    echo "$worker_processes" >&2
    exit 1
  fi
fi

export KRW_ONTOLOGY_ENV
export KRW_ONTOLOGY_RELEASE_ROOT
export KRW_ONTOLOGY_ROOT
export KRW_ONTOLOGY_MANIFEST_PATH
export KRW_ONTOLOGY_GLOBAL_SPINE_PATH
export KRW_ONTOLOGY_SHARD_MANIFEST_PATH
export KRW_ONTOLOGY_QUEUE_ROOT
export KRW_ONTOLOGY_SOURCE_DIR
export KRW_ONTOLOGY_PLUGIN_PATH
export KRW_ONTOLOGY_MCP_URL
export KRW_ONTOLOGY_MCP_HEALTH_URL
export CLAUDE_AGENT_CWD
export CLAUDE_CODE_EXECUTABLE
export CLAUDE_CONFIG_DIR
export AGENT_SUPERVISOR_ID
export AGENT_SUPERVISOR_CONCURRENCY

echo "Checking plugin MCP config..."
node <<'NODE'
const fs = require("fs");
const path = require("path");
const pluginPath = process.env.KRW_ONTOLOGY_PLUGIN_PATH;
const expectedRoot = path.resolve(process.env.KRW_ONTOLOGY_RELEASE_ROOT);
const expectedUrl = process.env.KRW_ONTOLOGY_MCP_URL;
const config = JSON.parse(fs.readFileSync(path.join(pluginPath, ".mcp.json"), "utf8"));
const server = config.mcpServers && config.mcpServers["krw-ontology"];
if (!server) throw new Error("Missing mcpServers.krw-ontology");
if (server.type === "http" || server.type === "sse") {
  if (!expectedUrl) throw new Error("Missing KRW_ONTOLOGY_MCP_URL for HTTP MCP plugin config");
  if (server.type !== "http") {
    throw new Error(`Production plugin must use streamable HTTP MCP, got: ${server.type}`);
  }
  if (server.url !== expectedUrl) {
    throw new Error(`Plugin .mcp.json MCP URL mismatch: ${server.url} !== ${expectedUrl}`);
  }
  console.log(`OK plugin MCP URL: ${server.url}`);
  const stockNewsServer = config.mcpServers && config.mcpServers["stock-news"];
  const expectedStockNewsUrl = process.env.STOCK_NEWS_MCP_URL || "http://127.0.0.1:8775/mcp";
  const stockNewsEnabled = isStockNewsEnabled();
  if (!stockNewsEnabled) {
    if (stockNewsServer) {
      throw new Error("Stock News MCP is disabled, but plugin .mcp.json still includes mcpServers.stock-news");
    }
    console.log("OK plugin Stock News MCP disabled");
    process.exit(0);
  }
  if (!stockNewsServer) throw new Error("Missing mcpServers.stock-news");
  if (stockNewsServer.type !== "http") {
    throw new Error(`Stock News MCP must use streamable HTTP MCP, got: ${stockNewsServer.type}`);
  }
  if (stockNewsServer.url !== expectedStockNewsUrl) {
    throw new Error(`Plugin .mcp.json Stock News MCP URL mismatch: ${stockNewsServer.url} !== ${expectedStockNewsUrl}`);
  }
  console.log(`OK plugin Stock News MCP URL: ${stockNewsServer.url}`);
  process.exit(0);
}
const configuredRoot = server.env && (
  server.env.KRW_ONTOLOGY_RELEASE_ROOT || server.env.KRW_ONTOLOGY_ROOT
);
const actualRoot = configuredRoot
  ? path.resolve(configuredRoot)
  : null;
if (actualRoot && actualRoot !== expectedRoot) {
  throw new Error(`Plugin .mcp.json ontology root mismatch: ${actualRoot} !== ${expectedRoot}`);
}
console.log(`OK plugin MCP root: ${actualRoot || expectedRoot}`);

function isStockNewsEnabled() {
  if (truthyEnv(process.env.STOCK_NEWS_FORCE_DISABLED)) return false;
  if (!truthyEnv(process.env.STOCK_NEWS_ENABLED)) return false;
  if (!process.env.FINNHUB_API_KEY) {
    throw new Error("STOCK_NEWS_ENABLED=1 but FINNHUB_API_KEY is missing");
  }
  return true;
}

function truthyEnv(value) {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function falseyEnv(value) {
  if (!value) return false;
  return ["0", "false", "no", "off"].includes(value.trim().toLowerCase());
}
NODE

if [ "$DEEP_CHECK" = "1" ]; then
  echo "Deep check requested; KRW Ontology v3 deep checks are release-publish offline gates."
fi

echo "Building worker bundle..."
(cd "$FRONT_DIR" && npm run build:worker >/dev/null)
require_path "$FRONT_DIR/.worker/agent-worker.mjs"
echo "OK worker bundle"

echo "Checking Claude executable..."
claude_version=$("$CLAUDE_CODE_EXECUTABLE" --version 2>&1)
echo "$claude_version"
case "$claude_version" in
  *"$EXPECTED_CLAUDE_CODE_VERSION"*) ;;
  *)
    echo "Claude Code version mismatch: expected $EXPECTED_CLAUDE_CODE_VERSION, got $claude_version" >&2
    exit 1
    ;;
esac

echo "Checking MCP health..."
if [ -n "${KRW_ONTOLOGY_MCP_URL:-}" ]; then
node <<'NODE'
const fs = require("fs");
function healthUrlFromMcpUrl(mcpUrl) {
  const parsed = new URL(mcpUrl);
  parsed.pathname = "/health";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

const mcpUrl = process.env.KRW_ONTOLOGY_MCP_URL;
const healthUrl = process.env.KRW_ONTOLOGY_MCP_HEALTH_URL || healthUrlFromMcpUrl(mcpUrl);
const expectedRoot = process.env.KRW_ONTOLOGY_RELEASE_ROOT;
const healthTimeoutMs = Number(process.env.MCP_HEALTH_TIMEOUT_MS || 30000);
const attemptTimeoutMs = Math.min(5000, Math.max(1000, healthTimeoutMs));

function samePath(left, right) {
  if (!left || !right) return false;
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return left === right;
  }
}

async function readHealth() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
  try {
    const response = await fetch(healthUrl, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    return { response, payload: await response.json() };
  } finally {
    clearTimeout(timeout);
  }
}

function printHealth(response, payload) {
  console.log(JSON.stringify({
    status: response.status,
    ok: payload.ok,
    env: payload.env,
    release_id: payload.release_id,
    manifest_valid: payload.manifest_valid,
    index_layout: payload.index_layout,
    global_spine_present: payload.global_spine_present,
    company_shard_count: payload.company_shard_count,
    root: payload.root,
    global_spine_path: payload.global_spine_path,
    documents: payload.documents,
    objects: payload.objects,
    tools: Array.isArray(payload.tools) ? payload.tools.length : null,
  }));
}

function assertHealth(response, payload) {
  if (response.status !== 200 || payload.ok !== true) throw new Error("MCP HTTP health is not ok");
  if (payload.env !== "prod") throw new Error("MCP health env is not prod");
  if (!payload.release_id) throw new Error("MCP health is missing release_id");
  if (payload.manifest_valid !== true) throw new Error("MCP health manifest_valid is not true");
  if (payload.index_layout !== "global-spine-and-company-shards") {
    throw new Error(`MCP health index_layout is not v3: ${payload.index_layout}`);
  }
  if (payload.global_spine_present !== true) {
    throw new Error("MCP health global_spine_present is not true");
  }
  if (expectedRoot && !samePath(payload.root, expectedRoot)) {
    throw new Error(`MCP root mismatch: ${payload.root} !== ${expectedRoot}`);
  }
}

(async () => {
  const deadline = Date.now() + healthTimeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const { response, payload } = await readHealth();
      assertHealth(response, payload);
      printHealth(response, payload);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw lastError || new Error("MCP HTTP health did not become ready");
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
NODE
else
  uv --directory "$KRW_ONTOLOGY_SOURCE_DIR" run python - <<'PY'
import json
import os
from krw_ontology.mcp_server.server import health_payload

payload, status = health_payload()
print(json.dumps({
    "status": status,
    "ok": payload.get("ok"),
    "env": payload.get("env"),
    "release_id": payload.get("release_id"),
    "manifest_valid": payload.get("manifest_valid"),
    "index_layout": payload.get("index_layout"),
    "global_spine_present": payload.get("global_spine_present"),
    "company_shard_count": payload.get("company_shard_count"),
    "root": payload.get("root"),
    "global_spine_path": payload.get("global_spine_path"),
    "documents": payload.get("documents"),
    "objects": payload.get("objects"),
    "tools": len(payload.get("tools") or []),
}, ensure_ascii=False))
if status != 200 or not payload.get("ok"):
    raise SystemExit(1)
if payload.get("env") != "prod":
    raise SystemExit("MCP health env is not prod")
if not payload.get("release_id"):
    raise SystemExit("MCP health is missing release_id")
if payload.get("manifest_valid") is not True:
    raise SystemExit("MCP health manifest_valid is not true")
if payload.get("index_layout") != "global-spine-and-company-shards":
    raise SystemExit(f"MCP health index_layout is not v3: {payload.get('index_layout')}")
if payload.get("global_spine_present") is not True:
    raise SystemExit("MCP health global_spine_present is not true")
PY
fi

echo "Checking Supabase service-role read access..."
(cd "$FRONT_DIR" && node <<'NODE')
const { createClient } = require("@supabase/supabase-js");
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing Supabase URL or service role key");
const client = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
(async () => {
  let lastError = null;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const { error } = await client
        .from("agent_runs")
        .select("id", { head: true, count: "exact" })
        .limit(0);
      if (error) throw error;
      console.log("OK Supabase agent_runs read");
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 500));
      }
    }
  }
  throw lastError || new Error("Supabase agent_runs read failed");
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
NODE

echo "Checking Postgres LISTEN config..."
node <<'NODE'
const { Client } = require("pg");

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const enabled = process.env.AGENT_QUEUE_LISTEN_ENABLED !== "0";
  const channel = process.env.AGENT_QUEUE_LISTEN_CHANNEL || "agent_run_queued";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(channel)) {
    throw new Error(`Invalid AGENT_QUEUE_LISTEN_CHANNEL: ${channel}`);
  }
  if (!enabled) {
    console.log("Postgres LISTEN disabled; supervisor will use slow reconcile only");
    return;
  }

  const explicit =
    process.env.AGENT_QUEUE_LISTEN_DATABASE_URL ||
    process.env.SUPABASE_LISTEN_DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL;
  if (explicit) {
    await smokeListen(explicit, channel, "explicit");
  } else {
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) throw new Error("Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL");
    const parsed = new URL(supabaseUrl);
    let connectionString;
    let connectionKind;
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") {
      const port = process.env.SUPABASE_DB_PORT || "54322";
      connectionString = `postgresql://postgres:${encodeURIComponent(
        process.env.SUPABASE_DB_PASSWORD || "postgres",
      )}@${parsed.hostname}:${port}/postgres`;
      connectionKind = "local";
    } else {
      if (!process.env.SUPABASE_DB_PASSWORD) {
        throw new Error(
          "Missing SUPABASE_DB_PASSWORD or explicit AGENT_QUEUE_LISTEN_DATABASE_URL for Postgres LISTEN",
        );
      }
      const match = parsed.hostname.match(/^([a-z0-9-]+)\.supabase\.co$/i);
      if (!match) throw new Error(`Cannot derive Supabase database host from ${parsed.hostname}`);
      connectionString = `postgresql://postgres:${encodeURIComponent(
        process.env.SUPABASE_DB_PASSWORD,
      )}@db.${match[1]}.supabase.co:5432/postgres?sslmode=require`;
      connectionKind = "derived";
    }
    await smokeListen(connectionString, channel, connectionKind);
  }
}

function shouldUseSsl(connectionString) {
  try {
    const parsed = new URL(connectionString);
    if (parsed.searchParams.get("sslmode") === "disable") return false;
    return parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1";
  } catch {
    return true;
  }
}

async function smokeListen(connectionString, listenChannel, connectionKind) {
  const client = new Client({
    connectionString,
    application_name: "krw-ontology-agent-supervisor-preflight",
    connectionTimeoutMillis: Number(process.env.AGENT_QUEUE_LISTEN_CONNECT_TIMEOUT_MS || 10_000),
    ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : undefined,
  });

  try {
    await client.connect();
    await client.query(`LISTEN ${listenChannel}`);
    await client.query(`UNLISTEN ${listenChannel}`);
    console.log(
      `OK Postgres LISTEN smoke: channel=${listenChannel} connection=${connectionKind}`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
NODE

echo "Mac worker preflight passed."
