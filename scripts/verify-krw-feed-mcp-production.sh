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

# The Rust agent reaches its local gateways over HTTPS with the operator CA.
# Node's fetch does not inherit that CA automatically, so give the verifier
# the same already-pinned file when an HTTPS endpoint is configured.  This is
# a verifier-only TLS setting; it never disables certificate validation.
case "$KRW_FEED_MCP_URL" in
  https://*)
    if [ -n "${KRW_AGENT_MCP_CA_FILE:-}" ]; then
      if [ ! -f "$KRW_AGENT_MCP_CA_FILE" ] || [ -L "$KRW_AGENT_MCP_CA_FILE" ]; then
        echo "KRW_AGENT_MCP_CA_FILE must be a regular file for HTTPS Feed verification" >&2
        exit 1
      fi
      export NODE_EXTRA_CA_CERTS=$KRW_AGENT_MCP_CA_FILE
    fi
    ;;
esac

node - <<'NODE'
const mcpUrl = new URL(process.env.KRW_FEED_MCP_URL);
mcpUrl.pathname = "/readyz";
const response = await fetch(mcpUrl, {
  headers: { authorization: `Bearer ${process.env.KRW_FEED_MCP_TOKEN}` },
});
const payload = await response.json();
// `database_ready` exists on some Feed versions but is not part of the
// current authenticated readiness contract.  When a server provides it it
// must be true; when absent, `ok: true` is the contract-complete readiness
// signal.  Treating an absent optional field as false made healthy endpoints
// look unauthenticated during release preflight.
if (
  !response.ok ||
  payload.ok !== true ||
  (Object.hasOwn(payload, "database_ready") && payload.database_ready !== true)
) {
  throw new Error("KRW Feed MCP is not ready");
}
NODE
