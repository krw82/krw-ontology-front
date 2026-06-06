#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/start-stock-news-mcp-dev.sh

Run the local Stock News MCP HTTP server for dev workers.
Defaults to port 8776 and path /mcp.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
done

STOCK_NEWS_MCP_ROOT=${STOCK_NEWS_MCP_ROOT:-"$HOME/mcp-servers/stock-news-mcp"}
STOCK_NEWS_MCP_HOST=${STOCK_NEWS_MCP_HOST:-127.0.0.1}
STOCK_NEWS_MCP_PORT=${STOCK_NEWS_MCP_PORT:-8776}
STOCK_NEWS_MCP_PATH=${STOCK_NEWS_MCP_PATH:-/mcp}
DEFAULT_STOCK_NEWS_COVERAGE_PATH="${KRW_ONTOLOGY_PLUGIN_PATH:-}/stock-news/coverage_companies.json"

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
if [ -z "${FINNHUB_API_KEY:-}" ]; then
  echo "Warning: FINNHUB_API_KEY is unset; company-news discovery will fall back to Z.ai/web search when available." >&2
fi
if [ -z "${ZAI_API_KEY:-}" ]; then
  echo "Warning: ZAI_API_KEY is unset; Z.ai/web fallback and reader tools will return provider errors." >&2
fi

export STOCK_NEWS_MCP_HOST
export STOCK_NEWS_MCP_PORT
export STOCK_NEWS_MCP_PATH
export STOCK_NEWS_COVERAGE_PATH

echo "Starting Stock News dev MCP HTTP server..."
echo "Source: $STOCK_NEWS_MCP_ROOT"
echo "MCP URL: http://$STOCK_NEWS_MCP_HOST:$STOCK_NEWS_MCP_PORT$STOCK_NEWS_MCP_PATH"
echo "Coverage: ${STOCK_NEWS_COVERAGE_PATH:-$STOCK_NEWS_MCP_ROOT/data/coverage_companies.json}"

cd "$STOCK_NEWS_MCP_ROOT"
npm run build >/dev/null
exec node dist/server.js
