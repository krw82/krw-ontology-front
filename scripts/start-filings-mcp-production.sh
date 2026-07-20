#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/start-filings-mcp-production.sh [--env-file FILE]

Run the internal, on-demand SEC filings MCP for the Mac production agent
worker. It keeps fetched document text in process memory only and never
persists document bodies.
EOF
}

ENV_FILE=.env.mac-worker.production
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE=${2:?Missing value for --env-file}; shift ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
  shift
done

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
case "$ENV_FILE" in
  /*) ENV_PATH=$ENV_FILE ;;
  *) ENV_PATH="$FRONT_DIR/$ENV_FILE" ;;
esac

if [ ! -f "$ENV_PATH" ]; then
  echo "Missing Mac worker env file: $ENV_PATH" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_PATH"
set +a

"$SCRIPT_DIR/verify-mac-runtime-target.sh" "$ENV_PATH"

case "$(printf '%s' "${FILINGS_MCP_ENABLED:-}" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on) ;;
  *)
    echo "On-demand filings MCP is disabled."
    exit 0
    ;;
esac

require_env() {
  key=$1
  eval "value=\${$key:-}"
  if [ -z "$value" ]; then
    echo "Missing required env value: $key" >&2
    exit 1
  fi
}

for key in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SEC_USER_AGENT FILINGS_MCP_AUTH_TOKEN FILINGS_MCP_PERSONAL_SIGNING_SECRET; do
  require_env "$key"
done
if [ "$FILINGS_MCP_PERSONAL_SIGNING_SECRET" = "$FILINGS_MCP_AUTH_TOKEN" ]; then
  echo "FILINGS_MCP_PERSONAL_SIGNING_SECRET must be distinct from FILINGS_MCP_AUTH_TOKEN" >&2
  exit 1
fi

FILINGS_MCP_PORT=${FILINGS_MCP_PORT:-8785}
FILINGS_MCP_HOST=${FILINGS_MCP_HOST:-127.0.0.1}
case "$FILINGS_MCP_PORT" in
  ''|*[!0-9]*) echo "FILINGS_MCP_PORT must be a port number" >&2; exit 1 ;;
esac
if [ "$FILINGS_MCP_PORT" -lt 1 ] || [ "$FILINGS_MCP_PORT" -gt 65535 ]; then
  echo "FILINGS_MCP_PORT must be between 1 and 65535" >&2
  exit 1
fi

if [ ! -r "$FRONT_DIR/.worker/filings-mcp-server.mjs" ]; then
  echo "Missing filings MCP worker bundle. Run npm run build:worker first." >&2
  exit 1
fi

KRW_LOG_DIR=${KRW_LOG_DIR:-"$HOME/krw-ontology-log"}
FILINGS_MCP_LOG_DIR=${FILINGS_MCP_LOG_DIR:-"$KRW_LOG_DIR/filings-mcp/prod"}
mkdir -p "$FILINGS_MCP_LOG_DIR"

if [ "$FILINGS_MCP_HOST" != "127.0.0.1" ] && [ "$FILINGS_MCP_HOST" != "::1" ]; then
  echo "Mac filings MCP must bind to a loopback FILINGS_MCP_HOST" >&2
  exit 1
fi
export FILINGS_MCP_PORT FILINGS_MCP_HOST
export FILINGS_MCP_ENV="${FILINGS_MCP_ENV:-${FILING_WORKER_ENV:-prod}}"

echo "Starting internal on-demand filings MCP on $FILINGS_MCP_HOST:$FILINGS_MCP_PORT"
echo "Document persistence: disabled (short-lived process memory cache only)"

cd "$FRONT_DIR"
if [ "${KRW_MAC_IMMUTABLE_RUNTIME:-0}" = "1" ]; then
  test -x "${KRW_RUNTIME_NODE_EXECUTABLE:-}" || {
    echo "Missing prepared Node executable for immutable filings MCP." >&2
    exit 1
  }
  exec "$KRW_RUNTIME_NODE_EXECUTABLE" .worker/filings-mcp-server.mjs
fi
exec node .worker/filings-mcp-server.mjs
