#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/start-stock-news-mcp-production.sh [--env-file FILE]

Run the long-lived local Stock News MCP HTTP server for Mac production
workers. Defaults to port 8775 and path /mcp.
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

if [ ! -f "$ENV_PATH" ]; then
  echo "Missing Mac worker env file: $ENV_PATH" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_PATH"
set +a

"$SCRIPT_DIR/verify-mac-runtime-target.sh" "$ENV_PATH"

truthy_env() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

falsey_env() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    0|false|no|off) return 0 ;;
    *) return 1 ;;
  esac
}

STOCK_NEWS_MCP_ROOT=${STOCK_NEWS_MCP_ROOT:-"$HOME/mcp-servers/stock-news-mcp"}
STOCK_NEWS_MCP_HOST=${STOCK_NEWS_MCP_HOST:-127.0.0.1}
STOCK_NEWS_MCP_PORT=${STOCK_NEWS_MCP_PORT:-8775}
STOCK_NEWS_MCP_PATH=${STOCK_NEWS_MCP_PATH:-/mcp}
KRW_LOG_DIR=${KRW_LOG_DIR:-"$HOME/krw-ontology-log"}
MCP_LOG_DIR=${MCP_LOG_DIR:-"$KRW_LOG_DIR/mcp/prod"}
DEFAULT_STOCK_NEWS_COVERAGE_PATH="${KRW_ONTOLOGY_PLUGIN_PATH:-}/stock-news/coverage_companies.json"

if truthy_env "${STOCK_NEWS_FORCE_DISABLED:-}" || ! truthy_env "${STOCK_NEWS_ENABLED:-}"; then
  echo "Stock News MCP disabled by environment."
  exit 0
fi
if [ -z "${FINNHUB_API_KEY:-}" ]; then
  echo "STOCK_NEWS_ENABLED=1 but FINNHUB_API_KEY is missing in $ENV_PATH" >&2
  exit 1
fi
if [ ! -f "$STOCK_NEWS_MCP_ROOT/package.json" ]; then
  echo "Missing stock-news-mcp package: $STOCK_NEWS_MCP_ROOT" >&2
  exit 1
fi
if [ -z "${STOCK_NEWS_COVERAGE_PATH:-}" ] && [ -f "$DEFAULT_STOCK_NEWS_COVERAGE_PATH" ]; then
  STOCK_NEWS_COVERAGE_PATH=$DEFAULT_STOCK_NEWS_COVERAGE_PATH
fi
if [ -n "${STOCK_NEWS_COVERAGE_PATH:-}" ] && [ ! -f "$STOCK_NEWS_COVERAGE_PATH" ]; then
  echo "Missing stock-news coverage file: $STOCK_NEWS_COVERAGE_PATH" >&2
  exit 1
fi

mkdir -p "$MCP_LOG_DIR"

export STOCK_NEWS_MCP_HOST
export STOCK_NEWS_MCP_PORT
export STOCK_NEWS_MCP_PATH
export STOCK_NEWS_COVERAGE_PATH

echo "Starting Stock News MCP HTTP server..."
echo "Source: $STOCK_NEWS_MCP_ROOT"
echo "MCP URL: http://$STOCK_NEWS_MCP_HOST:$STOCK_NEWS_MCP_PORT$STOCK_NEWS_MCP_PATH"
echo "Coverage: ${STOCK_NEWS_COVERAGE_PATH:-$STOCK_NEWS_MCP_ROOT/data/coverage_companies.json}"

cd "$STOCK_NEWS_MCP_ROOT"
if [ "${KRW_MAC_IMMUTABLE_RUNTIME:-0}" != "1" ]; then
  npm run build >/dev/null
fi
if [ "${KRW_MAC_IMMUTABLE_RUNTIME:-0}" = "1" ]; then
  test -x "${KRW_RUNTIME_NODE_EXECUTABLE:-}" || {
    echo "Missing prepared Node executable for immutable Stock News MCP." >&2
    exit 1
  }
  exec "$KRW_RUNTIME_NODE_EXECUTABLE" dist/server.js
fi
exec node dist/server.js
