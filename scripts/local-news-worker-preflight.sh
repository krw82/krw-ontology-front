#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/local-news-worker-preflight.sh [--env-file FILE]

Validate the Mac-local Finnhub + Z.ai news worker without making provider or AI calls.
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

[ -f "$ENV_PATH" ] || { echo "Missing local news worker env file: $ENV_PATH" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "Node.js is required." >&2; exit 1; }
cd "$FRONT_DIR"

env_value() {
  node --env-file="$ENV_PATH" -e \
    'const key = process.argv[1]; process.stdout.write(process.env[key] ?? "");' \
    "$1"
}

require_value() {
  key=$1
  value=$(env_value "$key")
  [ -n "$value" ] || { echo "Missing $key in $ENV_PATH" >&2; exit 1; }
}

ENABLED=$(env_value LOCAL_NEWS_ENABLED)
case "$(printf '%s' "$ENABLED" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on) ;;
  *) echo "LOCAL_NEWS_ENABLED must be true in $ENV_PATH" >&2; exit 1 ;;
esac

require_value FINNHUB_API_KEY
if [ -z "$(env_value LOCAL_NEWS_ZAI_API_KEY)" ] && [ -z "$(env_value MARKET_ISSUE_ZAI_API_KEY)" ] && [ -z "$(env_value ZAI_API_KEY)" ]; then
  echo "Set LOCAL_NEWS_ZAI_API_KEY, MARKET_ISSUE_ZAI_API_KEY, or ZAI_API_KEY in $ENV_PATH" >&2
  exit 1
fi
require_value LOCAL_NEWS_VAULT_KEY
if [ -z "$(env_value SUPABASE_URL)" ] && [ -z "$(env_value NEXT_PUBLIC_SUPABASE_URL)" ]; then
  echo "Set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL in $ENV_PATH" >&2
  exit 1
fi
require_value SUPABASE_SERVICE_ROLE_KEY

echo "Checking active catalog ticker-universe RPC..."
node --env-file="$ENV_PATH" <<'NODE'
const { createClient } = require("@supabase/supabase-js");

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing Supabase service credentials");
const rawEnvironment = process.env.MARKET_ISSUE_ENV || process.env.FILING_WORKER_ENV || process.env.NODE_ENV || "production";
const environment = ["dev", "development"].includes(rawEnvironment.trim().toLowerCase())
  ? "dev"
  : ["staging", "stage"].includes(rawEnvironment.trim().toLowerCase())
    ? "staging"
    : "prod";

const client = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

(async () => {
  const { data, error } = await client.rpc("list_market_news_coverage_tickers", {
    p_environment: environment,
  });
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Coverage-universe RPC returned an invalid response");
  if (data.length === 0) throw new Error(`No active catalog tickers for ${environment}`);
  console.log(`OK active catalog ticker-universe RPC (${data.length} tickers, env=${environment})`);
})().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
NODE

BUNDLE="$FRONT_DIR/.worker/local-news-worker.mjs"
[ -f "$BUNDLE" ] || { echo "Missing worker bundle: $BUNDLE. Run npm run build:local-news-worker first." >&2; exit 1; }

MODE=$(env_value LOCAL_NEWS_PUBLISH_MODE)
MODE=${MODE:-review}
case "$MODE" in
  review|publish) ;;
  *) echo "LOCAL_NEWS_PUBLISH_MODE must be review or publish." >&2; exit 1 ;;
esac
echo "OK local news worker preflight"
echo "  env_file=$ENV_PATH"
echo "  ticker_source=active ontology catalog"
echo "  publish_mode=$MODE"
echo "  ai_provider=z.ai"
echo "  bundle=$BUNDLE"
