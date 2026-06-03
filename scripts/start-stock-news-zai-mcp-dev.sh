#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/start-stock-news-zai-mcp-dev.sh

Run the local Stock News Z.ai MCP HTTP server for dev workers.
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

STOCK_NEWS_ZAI_MCP_ROOT=${STOCK_NEWS_ZAI_MCP_ROOT:-"$HOME/mcp-servers/stock-news-zai-mcp"}
STOCK_NEWS_ZAI_MCP_HOST=${STOCK_NEWS_ZAI_MCP_HOST:-127.0.0.1}
STOCK_NEWS_ZAI_MCP_PORT=${STOCK_NEWS_ZAI_MCP_PORT:-8776}
STOCK_NEWS_ZAI_MCP_PATH=${STOCK_NEWS_ZAI_MCP_PATH:-/mcp}

if [ ! -f "$STOCK_NEWS_ZAI_MCP_ROOT/package.json" ]; then
  echo "Missing stock-news-zai-mcp package: $STOCK_NEWS_ZAI_MCP_ROOT" >&2
  exit 1
fi
if [ -z "${ZAI_API_KEY:-}" ]; then
  echo "Warning: ZAI_API_KEY is unset; health will pass but search tools will return provider errors." >&2
fi

export STOCK_NEWS_ZAI_MCP_HOST
export STOCK_NEWS_ZAI_MCP_PORT
export STOCK_NEWS_ZAI_MCP_PATH

echo "Starting Stock News Z.ai dev MCP HTTP server..."
echo "Source: $STOCK_NEWS_ZAI_MCP_ROOT"
echo "MCP URL: http://$STOCK_NEWS_ZAI_MCP_HOST:$STOCK_NEWS_ZAI_MCP_PORT$STOCK_NEWS_ZAI_MCP_PATH"

cd "$STOCK_NEWS_ZAI_MCP_ROOT"
npm run build >/dev/null
exec node dist/server.js
