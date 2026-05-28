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
MCP_SERVER_LOG_LEVEL=${MCP_SERVER_LOG_LEVEL:-warning}

require_path "$KRW_ONTOLOGY_SOURCE_DIR/pyproject.toml"
require_path "$KRW_ONTOLOGY_RELEASE_ROOT"
require_path "$KRW_ONTOLOGY_MANIFEST_PATH"
require_path "$KRW_ONTOLOGY_INDEX_PATH"
mkdir -p "$FRONT_DIR/logs"

if [ "${KRW_ONTOLOGY_ENV:-}" != "prod" ]; then
  echo "MCP production server requires KRW_ONTOLOGY_ENV=prod, got: ${KRW_ONTOLOGY_ENV:-unset}" >&2
  exit 1
fi

echo "Starting KRW Ontology MCP HTTP server..."
echo "Source: $KRW_ONTOLOGY_SOURCE_DIR"
echo "Release root: $KRW_ONTOLOGY_RELEASE_ROOT"
echo "MCP URL: http://$KRW_ONTOLOGY_MCP_HOST:$KRW_ONTOLOGY_MCP_PORT$KRW_ONTOLOGY_MCP_PATH"

exec uv --directory "$KRW_ONTOLOGY_SOURCE_DIR" run krw-ontology-mcp-http \
  --host "$KRW_ONTOLOGY_MCP_HOST" \
  --port "$KRW_ONTOLOGY_MCP_PORT" \
  --root "$KRW_ONTOLOGY_RELEASE_ROOT" \
  --mcp-path "$KRW_ONTOLOGY_MCP_PATH" \
  --log-level "$MCP_SERVER_LOG_LEVEL"
