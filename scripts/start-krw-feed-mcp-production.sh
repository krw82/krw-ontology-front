#!/bin/sh
set -eu

ENV_FILE=""
if [ "${1:-}" = "--env-file" ]; then
  ENV_FILE=${2:-}
  shift 2
fi
if [ "$#" -ne 0 ] || [ -n "$ENV_FILE" ] && [ ! -f "$ENV_FILE" ]; then
  echo "Usage: $0 [--env-file FILE]" >&2
  exit 1
fi
if [ -n "$ENV_FILE" ]; then
  set -a
  . "$ENV_FILE"
  set +a
fi

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$ROOT_DIR"

export KRW_FEED_MCP_ENABLED=${KRW_FEED_MCP_ENABLED:-1}
export KRW_FEED_MCP_HOST=${KRW_FEED_MCP_HOST:-127.0.0.1}
export KRW_FEED_MCP_PORT=${KRW_FEED_MCP_PORT:-8795}
export KRW_FEED_MCP_URL=${KRW_FEED_MCP_URL:-"http://$KRW_FEED_MCP_HOST:$KRW_FEED_MCP_PORT/mcp"}

if [ -z "${KRW_FEED_MCP_TOKEN:-${FEED_MCP_AUTH_TOKEN:-}}" ]; then
  echo "KRW_FEED_MCP_TOKEN or FEED_MCP_AUTH_TOKEN is required" >&2
  exit 1
fi

npm run build:worker >/dev/null
exec node --env-file-if-exists=.env .worker/krw-feed-mcp-server.mjs
