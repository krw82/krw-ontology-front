#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/start-mcp-server-production.sh [--env-file FILE]

Run the long-lived local KRW Ontology MCP HTTP server for Mac production
workers. The server reads prod/current and exposes streamable HTTP MCP at
KRW_ONTOLOGY_MCP_URL.
EOF
}

ENV_FILE=.env.mac-worker.production

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE=${2:?Missing value for --env-file}
      shift
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
case "$ENV_FILE" in
  /*) ENV_PATH=$ENV_FILE ;;
  *) ENV_PATH="$FRONT_DIR/$ENV_FILE" ;;
esac

require_path() {
  if [ ! -e "$1" ]; then
    echo "Missing required path: $1" >&2
    exit 1
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command uv
require_path "$ENV_PATH"

set -a
# shellcheck disable=SC1090
. "$ENV_PATH"
set +a

KRW_ONTOLOGY_MCP_HOST=${KRW_ONTOLOGY_MCP_HOST:-127.0.0.1}
KRW_ONTOLOGY_MCP_PORT=${KRW_ONTOLOGY_MCP_PORT:-8765}
KRW_ONTOLOGY_MCP_PATH=${KRW_ONTOLOGY_MCP_PATH:-/mcp}
MCP_SERVER_LOG_LEVEL=${MCP_SERVER_LOG_LEVEL:-info}
KRW_LOG_DIR=${KRW_LOG_DIR:-"$HOME/krw-ontology-log"}
MCP_LOG_DIR=${MCP_LOG_DIR:-"$KRW_LOG_DIR/mcp/prod"}
MCP_SERVER_LOG_FILE=${MCP_SERVER_LOG_FILE:-"$MCP_LOG_DIR/mcp-prod.log"}
KRW_MCP_STORE_MODE=${KRW_MCP_STORE_MODE:-persistent}
KRW_MCP_STORE_POOL_MAX=${KRW_MCP_STORE_POOL_MAX:-8}
export KRW_MCP_STORE_POOL_MAX

require_path "$KRW_ONTOLOGY_SOURCE_DIR/pyproject.toml"
require_path "$KRW_ONTOLOGY_RELEASE_ROOT"
require_path "$KRW_ONTOLOGY_MANIFEST_PATH"
mkdir -p "$FRONT_DIR/logs" "$MCP_LOG_DIR"

if [ "${KRW_ONTOLOGY_ENV:-}" != "prod" ]; then
  echo "MCP production server requires KRW_ONTOLOGY_ENV=prod, got: ${KRW_ONTOLOGY_ENV:-unset}" >&2
  exit 1
fi

echo "Checking KRW Ontology v3 startup contract..."
uv --directory "$KRW_ONTOLOGY_SOURCE_DIR" run krw-ontology release verify \
  --startup-check \
  --root "$KRW_ONTOLOGY_RELEASE_ROOT" \
  --env prod \
  --require-current-symlink >/dev/null
echo "OK KRW Ontology v3 startup contract"

# shellcheck disable=SC1091
. "$SCRIPT_DIR/mcp-runtime-fingerprint.sh"
load_expected_mcp_runtime_fingerprint
echo "OK MCP v2 source/release fingerprint"

echo "Starting KRW Ontology MCP HTTP server..."
echo "Source: $KRW_ONTOLOGY_SOURCE_DIR"
echo "Release root: $KRW_ONTOLOGY_RELEASE_ROOT"
echo "MCP URL: http://$KRW_ONTOLOGY_MCP_HOST:$KRW_ONTOLOGY_MCP_PORT$KRW_ONTOLOGY_MCP_PATH"
echo "MCP log: $MCP_SERVER_LOG_FILE"

exec uv --directory "$KRW_ONTOLOGY_SOURCE_DIR" run krw-ontology-mcp \
  --env prod \
  --host "$KRW_ONTOLOGY_MCP_HOST" \
  --port "$KRW_ONTOLOGY_MCP_PORT" \
  --root "$KRW_ONTOLOGY_RELEASE_ROOT" \
  --require-current-symlink \
  --mcp-path "$KRW_ONTOLOGY_MCP_PATH" \
  --store-mode "$KRW_MCP_STORE_MODE" \
  --log-file "$MCP_SERVER_LOG_FILE" \
  --log-level "$MCP_SERVER_LOG_LEVEL"
