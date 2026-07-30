#!/bin/sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

export KRW_FEED_MCP_ENABLED=${KRW_FEED_MCP_ENABLED:-1}
export KRW_FEED_MCP_HOST=${KRW_FEED_MCP_HOST:-127.0.0.1}
export KRW_FEED_MCP_PORT=${KRW_FEED_MCP_PORT:-8796}
export KRW_FEED_MCP_URL=${KRW_FEED_MCP_URL:-"http://$KRW_FEED_MCP_HOST:$KRW_FEED_MCP_PORT/mcp"}

if [ -z "${KRW_FEED_MCP_TOKEN:-${FEED_MCP_AUTH_TOKEN:-}}" ]; then
  echo "KRW_FEED_MCP_TOKEN or FEED_MCP_AUTH_TOKEN is required" >&2
  exit 1
fi

npm run build:worker >/dev/null
exec node --env-file-if-exists=.env .worker/krw-feed-mcp-server.mjs
