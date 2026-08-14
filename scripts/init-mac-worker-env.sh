#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/init-mac-worker-env.sh [--from FILE] [--out FILE] [--overwrite]

Create a local, git-ignored production env file for running the agent worker on
this Mac. Secrets are copied from the source env without printing them.

Defaults:
  --from  .env
  --out   .env.mac-worker.production

The generated file starts with one Mac production supervisor and eight internal
concurrent run slots. Keep GLOBAL_CONCURRENT_RUN_LIMIT aligned with
AGENT_SUPERVISOR_CONCURRENCY after validating host capacity and provider
concurrency.
EOF
}

SOURCE_ENV=.env
OUT_ENV=.env.mac-worker.production
OVERWRITE=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --from)
      SOURCE_ENV=${2:?Missing value for --from}
      shift
      ;;
    --out)
      OUT_ENV=${2:?Missing value for --out}
      shift
      ;;
    --overwrite)
      OVERWRITE=1
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
DEFAULT_ONTOLOGY_SOURCE_DIR="$HOME/krw-ontology"
DEFAULT_ONTOLOGY_PLUGIN_SOURCE_PATH="$DEFAULT_ONTOLOGY_SOURCE_DIR/plugins/krw-ontology"
DEFAULT_ONTOLOGY_PLUGIN_PATH="$FRONT_DIR/ref/plugins/prod/krw-ontology"
DEFAULT_GURU_ADVISOR_PLUGIN_SOURCE_PATH="$DEFAULT_ONTOLOGY_SOURCE_DIR/plugins/krw-guru-advisor"
DEFAULT_GURU_ADVISOR_PLUGIN_PATH="$FRONT_DIR/ref/plugins/prod/krw-guru-advisor"
DEFAULT_GURU_DATA_ROOT="$HOME/krw-ontology-guru-data"
DEFAULT_GURU_RELEASE_ROOT="$DEFAULT_GURU_DATA_ROOT/releases/prod/current"

if [ ! -f "$SOURCE_ENV" ]; then
  echo "Missing source env file: $SOURCE_ENV" >&2
  exit 1
fi

if [ -e "$OUT_ENV" ] && [ "$OVERWRITE" != "1" ]; then
  echo "Refusing to overwrite existing env file: $OUT_ENV" >&2
  echo "Pass --overwrite if you intentionally want to regenerate it." >&2
  exit 1
fi

require_key() {
  key=$1
  if ! awk -F= -v key="$key" '
    function normalized_key(raw) {
      sub(/^[[:space:]]*export[[:space:]]+/, "", raw)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", raw)
      return raw
    }
    $0 !~ /^[[:space:]]*#/ && normalized_key($1) == key && length($0) > length($1) + 1 {
      found = 1
    }
    END { exit(found ? 0 : 1) }
  ' "$SOURCE_ENV"; then
    echo "Missing required key in $SOURCE_ENV: $key" >&2
    exit 1
  fi
}

copy_key() {
  key=$1
  awk -F= -v key="$key" '
    function normalized_key(raw) {
      sub(/^[[:space:]]*export[[:space:]]+/, "", raw)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", raw)
      return raw
    }
    $0 !~ /^[[:space:]]*#/ && normalized_key($1) == key {
      print
      found = 1
    }
    END { exit(found ? 0 : 1) }
  ' "$SOURCE_ENV" | tail -n 1
}

read_key_or_empty() {
  key=$1
  awk -F= -v key="$key" '
    function normalized_key(raw) {
      sub(/^[[:space:]]*export[[:space:]]+/, "", raw)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", raw)
      return raw
    }
    $0 !~ /^[[:space:]]*#/ && normalized_key($1) == key {
      sub(/^[^=]*=/, "")
      print
      found = 1
    }
    END { exit(found ? 0 : 1) }
  ' "$SOURCE_ENV" 2>/dev/null | tail -n 1 || true
}

for key in \
  NEXT_PUBLIC_SUPABASE_URL \
  NEXT_PUBLIC_SUPABASE_ANON_KEY \
  SUPABASE_URL \
  SUPABASE_ANON_KEY \
  SUPABASE_SERVICE_ROLE_KEY
do
  require_key "$key"
done

if ! awk -F= '
  $0 !~ /^[[:space:]]*#/ && ($1 == "ANTHROPIC_API_KEY" || $1 == "ANTHROPIC_AUTH_TOKEN" || $1 == "DEEPSEEK_API_KEY") {
    found = 1
  }
  END { exit(found ? 0 : 1) }
' "$SOURCE_ENV"; then
  echo "Missing Claude auth in $SOURCE_ENV: need ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or DEEPSEEK_API_KEY" >&2
  exit 1
fi

FILINGS_MCP_ENABLED_VALUE=$(read_key_or_empty FILINGS_MCP_ENABLED)
FILINGS_MCP_AUTH_TOKEN_VALUE=$(read_key_or_empty FILINGS_MCP_AUTH_TOKEN)
FILINGS_MCP_PERSONAL_SIGNING_SECRET_VALUE=$(read_key_or_empty FILINGS_MCP_PERSONAL_SIGNING_SECRET)
FILINGS_MCP_PORT_VALUE=$(read_key_or_empty FILINGS_MCP_PORT)
KRW_FILINGS_MCP_URL_VALUE=$(read_key_or_empty KRW_FILINGS_MCP_URL)
KRW_FEED_MCP_ENABLED_VALUE=$(read_key_or_empty KRW_FEED_MCP_ENABLED)
KRW_FEED_MCP_CANONICAL_TOKEN_VALUE=$(read_key_or_empty KRW_FEED_MCP_TOKEN)
KRW_FEED_MCP_LEGACY_TOKEN_VALUE=$(read_key_or_empty FEED_MCP_AUTH_TOKEN)
if [ -n "$KRW_FEED_MCP_CANONICAL_TOKEN_VALUE" ] \
  && [ -n "$KRW_FEED_MCP_LEGACY_TOKEN_VALUE" ] \
  && [ "$KRW_FEED_MCP_CANONICAL_TOKEN_VALUE" != "$KRW_FEED_MCP_LEGACY_TOKEN_VALUE" ]; then
  echo "Feed MCP token aliases conflict in $SOURCE_ENV" >&2
  exit 1
fi
KRW_FEED_MCP_TOKEN_VALUE=$KRW_FEED_MCP_CANONICAL_TOKEN_VALUE
if [ -z "$KRW_FEED_MCP_TOKEN_VALUE" ]; then
  KRW_FEED_MCP_TOKEN_VALUE=$KRW_FEED_MCP_LEGACY_TOKEN_VALUE
fi
if [ -z "$KRW_FEED_MCP_ENABLED_VALUE" ] && [ -n "$KRW_FEED_MCP_TOKEN_VALUE" ]; then
  KRW_FEED_MCP_ENABLED_VALUE=1
fi
KRW_FEED_MCP_HOST_VALUE=$(read_key_or_empty KRW_FEED_MCP_HOST)
KRW_FEED_MCP_PORT_VALUE=$(read_key_or_empty KRW_FEED_MCP_PORT)
KRW_FEED_MCP_URL_VALUE=$(read_key_or_empty KRW_FEED_MCP_URL)

QUEUE_LISTEN_URL=$(read_key_or_empty AGENT_QUEUE_LISTEN_DATABASE_URL)
CANCEL_LISTEN_URL=$(read_key_or_empty AGENT_RUN_CANCEL_LISTEN_DATABASE_URL)
SOURCE_QUEUE_LISTEN_URL=$QUEUE_LISTEN_URL
SOURCE_CANCEL_LISTEN_URL=$CANCEL_LISTEN_URL
POOLER_URL_FILE="$FRONT_DIR/supabase/.temp/pooler-url"
if [ -z "$QUEUE_LISTEN_URL" ] && [ -f "$POOLER_URL_FILE" ]; then
  POOLER_URL=$(tr -d '\r\n' < "$POOLER_URL_FILE")
  DB_PASSWORD=$(read_key_or_empty SUPABASE_DB_PASSWORD)
  if [ -n "$POOLER_URL" ] && [ -n "$DB_PASSWORD" ]; then
    QUEUE_LISTEN_URL=$(
      node - "$POOLER_URL" "$DB_PASSWORD" <<'NODE'
const url = new URL(process.argv[2]);
url.password = process.argv[3];
process.stdout.write(url.toString());
NODE
    )
  fi
fi
if [ -z "$CANCEL_LISTEN_URL" ]; then
  CANCEL_LISTEN_URL=$QUEUE_LISTEN_URL
fi

umask 077
tmp_file=$(mktemp "${TMPDIR:-/tmp}/krw-mac-worker-env.XXXXXX")
cleanup() {
  rm -f "$tmp_file"
}
trap cleanup EXIT INT TERM

{
  echo "# Generated by scripts/init-mac-worker-env.sh"
  echo "# Local production worker env. Do not commit this file."
  echo "NODE_ENV=production"
  for key in \
    NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY \
    SUPABASE_URL \
    SUPABASE_ANON_KEY \
    SUPABASE_SERVICE_ROLE_KEY \
    SUPABASE_DB_PASSWORD \
    AGENT_QUEUE_LISTEN_DATABASE_URL \
    AGENT_RUN_CANCEL_LISTEN_DATABASE_URL \
    ANTHROPIC_API_KEY \
    ANTHROPIC_AUTH_TOKEN \
    DEEPSEEK_API_KEY \
    FMP_API_KEY \
    FINNHUB_API_KEY \
    ZAI_API_KEY \
    SEC_USER_AGENT \
    ADMIN_EMAILS
  do
    copy_key "$key" 2>/dev/null || true
  done
  if [ -z "$SOURCE_QUEUE_LISTEN_URL" ] && [ -n "$QUEUE_LISTEN_URL" ]; then
    echo "AGENT_QUEUE_LISTEN_DATABASE_URL=$QUEUE_LISTEN_URL"
  fi
  if [ -z "$SOURCE_CANCEL_LISTEN_URL" ] && [ -n "$CANCEL_LISTEN_URL" ]; then
    echo "AGENT_RUN_CANCEL_LISTEN_DATABASE_URL=$CANCEL_LISTEN_URL"
  fi
  echo "KRW_ONTOLOGY_ENV=prod"
  echo "KRW_ONTOLOGY_RELEASE_ROOT=~/krw-ontology-data/releases/prod/current"
  echo "KRW_ONTOLOGY_ROOT=~/krw-ontology-data/releases/prod/current"
  echo "KRW_ONTOLOGY_MANIFEST_PATH=~/krw-ontology-data/releases/prod/current/manifest.json"
  echo "KRW_ONTOLOGY_GLOBAL_SPINE_PATH=~/krw-ontology-data/releases/prod/current/indexes/global_spine.sqlite"
  echo "KRW_ONTOLOGY_SHARD_MANIFEST_PATH=~/krw-ontology-data/releases/prod/current/indexes/shard_manifest.json"
  echo "KRW_ONTOLOGY_QUEUE_ROOT=~/krw-ontology-data-running"
  echo "KRW_ONTOLOGY_SOURCE_DIR=$DEFAULT_ONTOLOGY_SOURCE_DIR"
  echo "KRW_ONTOLOGY_PLUGIN_SOURCE_PATH=$DEFAULT_ONTOLOGY_PLUGIN_SOURCE_PATH"
  echo "KRW_ONTOLOGY_PLUGIN_PATH=$DEFAULT_ONTOLOGY_PLUGIN_PATH"
  echo "KRW_GURU_ADVISOR_PLUGIN_SOURCE_PATH=$DEFAULT_GURU_ADVISOR_PLUGIN_SOURCE_PATH"
  echo "KRW_GURU_ADVISOR_PLUGIN_PATH=$DEFAULT_GURU_ADVISOR_PLUGIN_PATH"
  echo "KRW_GURU_DATA_ROOT=$DEFAULT_GURU_DATA_ROOT"
  echo "KRW_GURU_RELEASE_ROOT=$DEFAULT_GURU_RELEASE_ROOT"
  echo "KRW_ONTOLOGY_MCP_HOST=127.0.0.1"
  echo "KRW_ONTOLOGY_MCP_PORT=8765"
  echo "KRW_ONTOLOGY_MCP_PATH=/mcp"
  echo "KRW_ONTOLOGY_MCP_URL=http://127.0.0.1:8765/mcp"
  echo "KRW_ONTOLOGY_MCP_HEALTH_URL=http://127.0.0.1:8765/health"
  echo "KRW_ONTOLOGY_MCP_READY_URL=http://127.0.0.1:8765/readyz"
  echo "DESKTOP_ONTOLOGY_EXECUTOR=mcp"
  echo "DESKTOP_ONTOLOGY_MAX_RESULT_BYTES=180000"
  echo "KRW_MCP_EXPECTED_CONTRACT_VERSION=krw-ontology-mcp/v2"
  echo "KRW_MCP_EXPECTED_BUILD_ID="
  echo "KRW_MCP_EXPECTED_BACKEND_GIT_SHA="
  echo "KRW_MCP_EXPECTED_TOOL_SCHEMA_SHA256="
  echo "KRW_MCP_EXPECTED_BUILD_FINGERPRINT_SHA256="
  echo "KRW_MCP_EXPECTED_RELEASE_MANIFEST_SHA256="
  echo "KRW_MCP_EXPECTED_SERVICE_FINGERPRINT_SHA256="
  echo "AGENT_SUPERVISOR_ID=mac-supervisor-jwc"
  echo "AGENT_SUPERVISOR_CONCURRENCY=8"
  echo "AGENT_WORKER_ID_PREFIX=mac-worker-jwc"
  echo "MAC_WORKER_COUNT=8"
  echo "MAC_WORKER_NICE=-5"
  echo "MCP_SERVER_NICE=-5"
  echo "STOCK_NEWS_MCP_NICE=0"
  echo "KRW_LOG_DIR=~/krw-ontology-log"
  copy_key VALUATION_REFRESH_WORKER_ID 2>/dev/null || echo "VALUATION_REFRESH_WORKER_ID=valuation-refresh-mac"
  copy_key VALUATION_REFRESH_INTERVAL_MS 2>/dev/null || echo "VALUATION_REFRESH_INTERVAL_MS=3600000"
  copy_key VALUATION_REFRESH_BATCH_SIZE 2>/dev/null || echo "VALUATION_REFRESH_BATCH_SIZE=20"
  copy_key VALUATION_REFRESH_TICKERS 2>/dev/null || true
  copy_key VALUATION_REFRESH_LOG_DIR 2>/dev/null || true
  copy_key VALUATION_REFRESH_NICE 2>/dev/null || echo "VALUATION_REFRESH_NICE=10"
  copy_key VALUATION_REFRESH_MAXFILES 2>/dev/null || echo "VALUATION_REFRESH_MAXFILES=4096"
  echo "MCP_SERVER_LOG_LEVEL=info"
  echo "MCP_LOG_DIR=~/krw-ontology-log/mcp/prod"
  echo "KRW_DEPLOY_LOG_DIR=~/krw-ontology-log/deploy"
  echo "MCP_SERVER_MAXFILES=4096"
  echo "KRW_MCP_STORE_MODE=persistent"
  echo "KRW_MCP_STORE_POOL_MAX=8"
  echo "AGENT_WORKER_ID=mac-supervisor-jwc"
  echo "GLOBAL_CONCURRENT_RUN_LIMIT=8"
  echo "AGENT_QUEUE_LISTEN_ENABLED=1"
  echo "AGENT_QUEUE_LISTEN_CHANNEL=agent_run_queued"
  echo "AGENT_QUEUE_RECONCILE_INTERVAL_MS=60000"
  echo "AGENT_QUEUE_LISTEN_RECONNECT_INTERVAL_MS=5000"
  echo "AGENT_RUN_CANCEL_LISTEN_ENABLED=1"
  echo "AGENT_RUN_CANCEL_LISTEN_CHANNEL=agent_run_cancel"
  echo "AGENT_RUN_CANCEL_LISTEN_RECONNECT_INTERVAL_MS=5000"
  echo "AGENT_RUN_CANCEL_RECONCILE_INTERVAL_MS=10000"
  echo "AGENT_SUPERVISOR_SHUTDOWN_GRACE_MS=120000"
  echo "AGENT_WORKER_IDLE_LOG_INTERVAL_MS=60000"
  echo "AGENT_MAX_TOOL_CALLS=32"
  echo "YAHOO_FINANCE_MAX_CALLS=4"
  echo "RESEARCH_ANSWER_ENVELOPE_ENABLED=0"
  echo "KRW_VISUALIZATIONS_MODE=off"
  echo "KRW_CHART_SERIES_ENABLED=0"
  echo "STOCK_NEWS_MCP_HOST=127.0.0.1"
  echo "STOCK_NEWS_MCP_PORT=8775"
  echo "STOCK_NEWS_MCP_PATH=/mcp"
  echo "STOCK_NEWS_MCP_URL=http://127.0.0.1:8775/mcp"
  echo "STOCK_NEWS_FORCE_DISABLED=1"
  echo "STOCK_NEWS_MAX_CALLS=12"
  echo "FILINGS_MCP_ENABLED=${FILINGS_MCP_ENABLED_VALUE:-0}"
  echo "FILINGS_MCP_AUTH_TOKEN=$FILINGS_MCP_AUTH_TOKEN_VALUE"
  echo "FILINGS_MCP_PERSONAL_SIGNING_SECRET=$FILINGS_MCP_PERSONAL_SIGNING_SECRET_VALUE"
  echo "FILINGS_MCP_HOST=127.0.0.1"
  echo "FILINGS_MCP_PORT=${FILINGS_MCP_PORT_VALUE:-8785}"
  echo "KRW_FILINGS_MCP_URL=${KRW_FILINGS_MCP_URL_VALUE:-http://127.0.0.1:8785/mcp}"
  echo "FILINGS_MCP_ENV=prod"
  echo "FILINGS_MCP_MAX_DOCUMENT_BYTES=10485760"
  echo "FILINGS_MCP_MAX_DOCUMENT_CHARS=1500000"
  echo "FILINGS_MCP_CACHE_TTL_MS=300000"
  echo "FILINGS_MCP_CACHE_MAX_ENTRIES=16"
  echo "FILINGS_MCP_NICE=-5"
  echo "KRW_FEED_MCP_ENABLED=${KRW_FEED_MCP_ENABLED_VALUE:-0}"
  echo "KRW_FEED_MCP_TOKEN=$KRW_FEED_MCP_TOKEN_VALUE"
  echo "KRW_FEED_MCP_HOST=${KRW_FEED_MCP_HOST_VALUE:-127.0.0.1}"
  echo "KRW_FEED_MCP_PORT=${KRW_FEED_MCP_PORT_VALUE:-8795}"
  echo "KRW_FEED_MCP_URL=${KRW_FEED_MCP_URL_VALUE:-http://127.0.0.1:8795/mcp}"
  echo "AGENT_RUN_HARD_TIMEOUT_MINUTES=10"
  echo "LEASE_TIMEOUT_MINUTES=10"
  echo "LEASE_HEARTBEAT_INTERVAL_MS=30000"
  echo "MCP_HEALTH_TIMEOUT_MS=30000"
  echo "KRW_SQLITE_READ_CACHE_MIB=512"
  echo "KRW_SQLITE_READ_MMAP_MIB=2048"
} > "$tmp_file"

mv "$tmp_file" "$OUT_ENV"
trap - EXIT INT TERM

echo "Created $OUT_ENV with mode 600."
echo "Review non-secret paths before starting the production Mac worker."
