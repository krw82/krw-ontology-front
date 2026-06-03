#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/start-stock-news-zai-mcp-production.sh [--env-file FILE]

Run the long-lived local Stock News Z.ai MCP HTTP server for Mac production
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

STOCK_NEWS_ZAI_MCP_ROOT=${STOCK_NEWS_ZAI_MCP_ROOT:-"$HOME/mcp-servers/stock-news-zai-mcp"}
STOCK_NEWS_ZAI_MCP_HOST=${STOCK_NEWS_ZAI_MCP_HOST:-127.0.0.1}
STOCK_NEWS_ZAI_MCP_PORT=${STOCK_NEWS_ZAI_MCP_PORT:-8775}
STOCK_NEWS_ZAI_MCP_PATH=${STOCK_NEWS_ZAI_MCP_PATH:-/mcp}
MCP_LOG_DIR=${MCP_LOG_DIR:-"$HOME/Library/Logs/krw-ontology"}

if [ -z "${ZAI_API_KEY:-}" ]; then
  echo "Missing ZAI_API_KEY in $ENV_PATH" >&2
  exit 1
fi
if [ ! -f "$STOCK_NEWS_ZAI_MCP_ROOT/package.json" ]; then
  echo "Missing stock-news-zai-mcp package: $STOCK_NEWS_ZAI_MCP_ROOT" >&2
  exit 1
fi

mkdir -p "$MCP_LOG_DIR"

export STOCK_NEWS_ZAI_MCP_HOST
export STOCK_NEWS_ZAI_MCP_PORT
export STOCK_NEWS_ZAI_MCP_PATH

echo "Starting Stock News Z.ai MCP HTTP server..."
echo "Source: $STOCK_NEWS_ZAI_MCP_ROOT"
echo "MCP URL: http://$STOCK_NEWS_ZAI_MCP_HOST:$STOCK_NEWS_ZAI_MCP_PORT$STOCK_NEWS_ZAI_MCP_PATH"

cd "$STOCK_NEWS_ZAI_MCP_ROOT"
npm run build >/dev/null
exec node dist/server.js
