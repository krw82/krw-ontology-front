#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/verify-filings-mcp-production.sh [--env-file FILE]

Verify the authenticated local on-demand SEC filings MCP /readyz endpoint and
its exact six-tool contract.
EOF
}

ENV_FILE=.env.mac-worker.production
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE=${2:?Missing value for --env-file}; shift ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
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

case "$(printf '%s' "${FILINGS_MCP_ENABLED:-}" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on) ;;
  *) echo "On-demand filings MCP is disabled."; exit 0 ;;
esac

KRW_FILINGS_MCP_URL=${KRW_FILINGS_MCP_URL:-"http://127.0.0.1:${FILINGS_MCP_PORT:-8785}/mcp"}
FILINGS_MCP_AUTH_TOKEN=${FILINGS_MCP_AUTH_TOKEN:-}
export KRW_FILINGS_MCP_URL FILINGS_MCP_AUTH_TOKEN

cd "$FRONT_DIR"
node --input-type=module <<'NODE'
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const expected = [
  "get_filing",
  "get_filing_brief",
  "search_catalog_filings",
  "list_filing_sections",
  "read_filing_section",
  "get_form4_insider_transactions",
];
const token = process.env.FILINGS_MCP_AUTH_TOKEN;
if (!token) throw new Error("FILINGS_MCP_AUTH_TOKEN is required");
const mcpUrl = process.env.KRW_FILINGS_MCP_URL;
const readyUrl = new URL(mcpUrl);
readyUrl.pathname = "/readyz";
readyUrl.search = "";
readyUrl.hash = "";
const timeout = Number(process.env.MCP_HEALTH_TIMEOUT_MS || 30000);
const headers = { Authorization: `Bearer ${token}`, accept: "application/json" };
const response = await fetch(readyUrl, { headers, signal: AbortSignal.timeout(timeout) });
const payload = await response.json().catch(() => null);
if (!response.ok || payload?.ok !== true) throw new Error("On-demand filings MCP readiness is not ok");
const client = new Client({ name: "krw-filings-production-verify", version: "1.0.0" });
const transport = new StreamableHTTPClientTransport(new URL(mcpUrl), { requestInit: { headers } });
try {
  await client.connect(transport, { timeout });
  const result = await client.listTools(undefined, { timeout, maxTotalTimeout: timeout });
  const names = result.tools.map((tool) => tool.name).sort();
  if (names.length !== expected.length || expected.some((name) => !names.includes(name))) {
    throw new Error(`On-demand filings MCP tool parity mismatch: ${names.join(", ")}`);
  }
} finally {
  await client.close().catch(() => undefined);
}
console.log("OK on-demand filings MCP readiness and tool parity");
NODE
