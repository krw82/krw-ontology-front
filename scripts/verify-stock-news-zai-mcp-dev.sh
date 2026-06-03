#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

STOCK_NEWS_ZAI_MCP_URL=${STOCK_NEWS_ZAI_MCP_URL:-http://127.0.0.1:8776/mcp}
export STOCK_NEWS_ZAI_MCP_URL

node <<'NODE'
function healthUrlFromMcpUrl(mcpUrl) {
  const parsed = new URL(mcpUrl);
  parsed.pathname = "/health";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

const healthUrl = healthUrlFromMcpUrl(process.env.STOCK_NEWS_ZAI_MCP_URL);

(async () => {
  const response = await fetch(healthUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  const payload = await response.json();
  console.log(JSON.stringify({
    status: response.status,
    ok: payload.ok,
    name: payload.name,
    coverage_count: payload.coverage_count,
    provider_enabled: payload.provider_enabled,
    has_zai_api_key: payload.has_zai_api_key,
    tools: Array.isArray(payload.tools) ? payload.tools.length : null,
  }));
  if (response.status !== 200 || payload.ok !== true) throw new Error("Stock News Z.ai dev MCP health is not ok");
  if (payload.name !== "stock-news-zai-mcp") throw new Error(`Unexpected MCP name: ${payload.name}`);
  if (!Array.isArray(payload.tools) || payload.tools.length < 8) {
    throw new Error("Stock News Z.ai dev MCP health is missing tools");
  }
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
NODE

echo "OK Stock News Z.ai dev MCP health"
