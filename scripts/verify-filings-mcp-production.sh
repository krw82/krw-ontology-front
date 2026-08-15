#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/verify-filings-mcp-production.sh [--env-file FILE]

Verify the authenticated local on-demand SEC filings MCP /readyz endpoint and
its exact public eight-tool and authenticated personal four-tool contracts.
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
FILINGS_MCP_PERSONAL_SIGNING_SECRET=${FILINGS_MCP_PERSONAL_SIGNING_SECRET:-}
export KRW_FILINGS_MCP_URL FILINGS_MCP_AUTH_TOKEN FILINGS_MCP_PERSONAL_SIGNING_SECRET

cd "$FRONT_DIR"
node --input-type=module <<'NODE'
import { createHmac } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const expected = [
  "get_filing",
  "get_filing_brief",
  "search_catalog_filings",
  "list_filing_sections",
  "read_filing_section",
  "list_filing_documents",
  "read_filing_document",
  "get_form4_insider_transactions",
];
const expectedPersonal = [
  "get_coverage_state",
  "list_filing_judgments",
  "get_decision_timeline",
  "list_open_questions",
];
const deferPersonalDataSmoke = ["1", "true", "yes", "on"].includes(
  process.env.KRW_FILINGS_MCP_DEFER_PERSONAL_DATA_SMOKE?.trim().toLowerCase() ?? "",
);
const token = process.env.FILINGS_MCP_AUTH_TOKEN;
if (!token) throw new Error("FILINGS_MCP_AUTH_TOKEN is required");
const personalSigningSecret = process.env.FILINGS_MCP_PERSONAL_SIGNING_SECRET;
if (!personalSigningSecret) throw new Error("FILINGS_MCP_PERSONAL_SIGNING_SECRET is required");
if (personalSigningSecret === token) {
  throw new Error("FILINGS_MCP_PERSONAL_SIGNING_SECRET must be distinct from FILINGS_MCP_AUTH_TOKEN");
}
const mcpUrl = process.env.KRW_FILINGS_MCP_URL;
const readyUrl = new URL(mcpUrl);
readyUrl.pathname = "/readyz";
readyUrl.search = "";
readyUrl.hash = "";
const timeout = Number(process.env.MCP_HEALTH_TIMEOUT_MS || 30000);
const origin = process.env.KRW_AGENT_MCP_ORIGIN?.trim() || "";
if (readyUrl.protocol === "https:" && !origin) {
  throw new Error("KRW_AGENT_MCP_ORIGIN is required for HTTPS filings verification");
}
if (origin) {
  const parsedOrigin = new URL(origin);
  if (
    parsedOrigin.protocol !== "https:" ||
    parsedOrigin.pathname !== "/" ||
    parsedOrigin.search ||
    parsedOrigin.hash ||
    parsedOrigin.username ||
    parsedOrigin.password
  ) {
    throw new Error("KRW_AGENT_MCP_ORIGIN must be a bare HTTPS origin");
  }
}
const headers = {
  Authorization: `Bearer ${token}`,
  accept: "application/json",
  ...(origin ? { origin } : {}),
};
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

const issuedAt = Math.floor(Date.now() / 1000);
const delegationPayload = Buffer.from(JSON.stringify({
  sub: "00000000-0000-4000-8000-000000000000",
  iat: issuedAt,
  exp: issuedAt + 12 * 60,
  aud: "krw-filings-personal",
  iss: "krw-web-agent",
  ver: 1,
}), "utf8").toString("base64url");
const signature = createHmac("sha256", personalSigningSecret).update(delegationPayload).digest("base64url");
const personalHeaders = {
  ...headers,
  "x-krw-user-authorization": `Internal ${delegationPayload}.${signature}`,
};
const tamperedSignature = `${signature.slice(0, -1)}${signature.endsWith("A") ? "B" : "A"}`;
const tamperedResponse = await fetch(mcpUrl, {
  method: "POST",
  headers: {
    ...headers,
    "content-type": "application/json",
    "x-krw-user-authorization": `Internal ${delegationPayload}.${tamperedSignature}`,
  },
  body: "{}",
  signal: AbortSignal.timeout(timeout),
});
if (tamperedResponse.status !== 401) {
  throw new Error(`Tampered personal MCP credential was not rejected: ${tamperedResponse.status}`);
}
const personalClient = new Client({ name: "krw-filings-personal-production-verify", version: "1.0.0" });
const personalTransport = new StreamableHTTPClientTransport(new URL(mcpUrl), {
  requestInit: { headers: personalHeaders },
});
try {
  await personalClient.connect(personalTransport, { timeout });
  const result = await personalClient.listTools(undefined, { timeout, maxTotalTimeout: timeout });
  const names = result.tools.map((tool) => tool.name).sort();
  const allExpected = [...expected, ...expectedPersonal];
  if (names.length !== allExpected.length || allExpected.some((name) => !names.includes(name))) {
    throw new Error(`Personal filings MCP tool parity mismatch: ${names.join(", ")}`);
  }
  if (deferPersonalDataSmoke) {
    console.log("Deferred personal filing data smoke until the post-migration production verification.");
  } else {
    const coverage = await personalClient.callTool(
      { name: "get_coverage_state", arguments: { ticker: "AAPL" } },
      undefined,
      { timeout, maxTotalTimeout: timeout },
    );
    if (coverage.isError) throw new Error("Personal coverage-state smoke returned an MCP error");
  }
} finally {
  await personalClient.close().catch(() => undefined);
}
console.log("OK on-demand filings MCP readiness, public tools, and personal-memory tools");
NODE
