#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

KRW_ONTOLOGY_MCP_URL=${KRW_ONTOLOGY_MCP_URL:-http://127.0.0.1:8766/mcp}
KRW_ONTOLOGY_MCP_HEALTH_URL=${KRW_ONTOLOGY_MCP_HEALTH_URL:-http://127.0.0.1:8766/health}
EXPECTED_RELEASE_ID=${EXPECTED_RELEASE_ID:-}
export KRW_ONTOLOGY_MCP_URL
export KRW_ONTOLOGY_MCP_HEALTH_URL
export EXPECTED_RELEASE_ID

node <<'NODE'
const expectedReleaseId = process.env.EXPECTED_RELEASE_ID;
const healthUrl = process.env.KRW_ONTOLOGY_MCP_HEALTH_URL;

(async () => {
  const response = await fetch(healthUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
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
  if (response.status !== 200 || payload.ok !== true) throw new Error("MCP dev health is not ok");
  if (payload.env !== "dev") throw new Error(`MCP dev health env is not dev: ${payload.env}`);
  if (!payload.release_id) throw new Error("MCP dev health is missing release_id");
  if (expectedReleaseId && payload.release_id !== expectedReleaseId) {
    throw new Error(`MCP dev release mismatch: ${payload.release_id} !== ${expectedReleaseId}`);
  }
  if (payload.manifest_valid !== true) throw new Error("MCP dev health manifest_valid is not true");
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
NODE

echo "OK dev MCP HTTP server health"
