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

export KRW_FEED_MCP_URL=${KRW_FEED_MCP_URL:-http://127.0.0.1:8795/mcp}
export KRW_FEED_MCP_TOKEN=${KRW_FEED_MCP_TOKEN:-${FEED_MCP_AUTH_TOKEN:-}}

if [ -z "$KRW_FEED_MCP_TOKEN" ]; then
  echo "KRW_FEED_MCP_TOKEN or FEED_MCP_AUTH_TOKEN is required" >&2
  exit 1
fi

node - <<'NODE'
const mcpUrl = new URL(process.env.KRW_FEED_MCP_URL);
mcpUrl.pathname = "/readyz";
const response = await fetch(mcpUrl, {
  headers: { authorization: `Bearer ${process.env.KRW_FEED_MCP_TOKEN}` },
});
const payload = await response.json();
if (!response.ok || payload.ok !== true || payload.database_ready !== true) {
  throw new Error("KRW Feed MCP is not ready");
}
NODE
