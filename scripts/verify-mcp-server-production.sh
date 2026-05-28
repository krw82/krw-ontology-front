#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/verify-mcp-server-production.sh [--env-file FILE] [--release-id ID]

Check the long-running local KRW Ontology MCP HTTP server /health endpoint.
EOF
}

ENV_FILE=.env.mac-worker.production
EXPECTED_RELEASE_ID=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE=${2:?Missing value for --env-file}
      shift
      ;;
    --release-id)
      EXPECTED_RELEASE_ID=${2:?Missing value for --release-id}
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

if [ -n "$EXPECTED_RELEASE_ID" ]; then
  export EXPECTED_RELEASE_ID
fi

node <<'NODE'
const fs = require("fs");
function healthUrlFromMcpUrl(mcpUrl) {
  const parsed = new URL(mcpUrl);
  parsed.pathname = "/health";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

const mcpUrl = process.env.KRW_ONTOLOGY_MCP_URL || "http://127.0.0.1:8765/mcp";
const healthUrl = process.env.KRW_ONTOLOGY_MCP_HEALTH_URL || healthUrlFromMcpUrl(mcpUrl);
const expectedRoot = process.env.KRW_ONTOLOGY_RELEASE_ROOT;
const expectedReleaseId = process.env.EXPECTED_RELEASE_ID;

function samePath(left, right) {
  if (!left || !right) return false;
  try {
    return fs.realpathSync(left) === fs.realpathSync(right);
  } catch {
    return left === right;
  }
}

(async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.MCP_HEALTH_TIMEOUT_MS || 30000));
  try {
    const response = await fetch(healthUrl, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    const payload = await response.json();
    console.log(JSON.stringify({
      status: response.status,
      ok: payload.ok,
      env: payload.env,
      release_id: payload.release_id,
      manifest_valid: payload.manifest_valid,
      root: payload.root,
      index_path: payload.index_path,
      documents: payload.documents,
      objects: payload.objects,
      tools: Array.isArray(payload.tools) ? payload.tools.length : null,
    }));
    if (response.status !== 200 || payload.ok !== true) throw new Error("MCP health is not ok");
    if (payload.env !== "prod") throw new Error(`MCP health env is not prod: ${payload.env}`);
    if (!payload.release_id) throw new Error("MCP health is missing release_id");
    if (expectedReleaseId && payload.release_id !== expectedReleaseId) {
      throw new Error(`MCP release mismatch: ${payload.release_id} !== ${expectedReleaseId}`);
    }
    if (payload.manifest_valid !== true) throw new Error("MCP health manifest_valid is not true");
    if (expectedRoot && !samePath(payload.root, expectedRoot)) {
      throw new Error(`MCP root mismatch: ${payload.root} !== ${expectedRoot}`);
    }
  } finally {
    clearTimeout(timeout);
  }
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
NODE

echo "OK MCP HTTP server health"
