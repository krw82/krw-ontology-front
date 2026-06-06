#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/verify-stock-news-mcp-production.sh [--env-file FILE]

Check the Stock News MCP HTTP server /health endpoint.
EOF
}

ENV_FILE=.env.mac-worker.production

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE=${2:?Missing value for --env-file}
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

STOCK_NEWS_MCP_URL=${STOCK_NEWS_MCP_URL:-http://127.0.0.1:8775/mcp}
export STOCK_NEWS_MCP_URL

node <<'NODE'
function healthUrlFromMcpUrl(mcpUrl) {
  const parsed = new URL(mcpUrl);
  parsed.pathname = "/health";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString();
}

const healthUrl = healthUrlFromMcpUrl(process.env.STOCK_NEWS_MCP_URL);
const expectedTools = [
  "route_news_question",
  "resolve_news_entities",
  "search_company_news_events",
  "search_market_news_events",
  "search_news_by_domain",
  "read_news_sources",
  "build_news_timeline",
  "audit_news_sources",
];

(async () => {
  const response = await fetch(healthUrl, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(Number(process.env.MCP_HEALTH_TIMEOUT_MS || 30000)),
  });
  const payload = await response.json();
  console.log(JSON.stringify({
    status: response.status,
    ok: payload.ok,
    name: payload.name,
    coverage_count: payload.coverage_count,
    provider_enabled: payload.provider_enabled,
    primary_provider: payload.primary_provider,
    has_finnhub_api_key: payload.has_finnhub_api_key,
    has_zai_api_key: payload.has_zai_api_key,
    tools: Array.isArray(payload.tools) ? payload.tools.length : null,
  }));
  if (response.status !== 200 || payload.ok !== true) throw new Error("Stock News MCP health is not ok");
  if (payload.name !== "stock-news-mcp") throw new Error(`Unexpected MCP name: ${payload.name}`);
  if (!payload.has_finnhub_api_key) throw new Error("Stock News MCP is missing FINNHUB_API_KEY");
  if (!Array.isArray(payload.tools)) throw new Error("Stock News MCP health is missing tools");
  for (const tool of expectedTools) {
    if (!payload.tools.includes(tool)) throw new Error(`Missing stock-news tool: ${tool}`);
  }
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
NODE

echo "OK Stock News production MCP health"
