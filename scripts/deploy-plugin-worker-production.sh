#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/deploy-plugin-worker-production.sh [--env-file FILE] [--dry-run]

Validate local KRW Ontology plugin/skills, restart the long-running MCP HTTP
server, then restart only the Mac production workers.

This does not sync plugin code to the GCP VM and does not restart GCP web.
EOF
}

ENV_FILE=.env.mac-worker.production
DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE=${2:?Missing value for --env-file}
      shift
      ;;
    --dry-run)
      DRY_RUN=1
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

require_path() {
  if [ ! -e "$1" ]; then
    echo "Missing required path: $1" >&2
    exit 1
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

truthy_env() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

falsey_env() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    0|false|no|off) return 0 ;;
    *) return 1 ;;
  esac
}

require_path "$ENV_PATH"

set -a
# shellcheck disable=SC1090
. "$ENV_PATH"
set +a

STOCK_NEWS_RUNTIME_ENABLED=0
if truthy_env "${STOCK_NEWS_FORCE_DISABLED:-}"; then
  STOCK_NEWS_RUNTIME_ENABLED=0
elif truthy_env "${STOCK_NEWS_ENABLED:-}"; then
  if [ -z "${FINNHUB_API_KEY:-}" ]; then
    echo "STOCK_NEWS_ENABLED=1 but FINNHUB_API_KEY is missing in $ENV_PATH" >&2
    exit 1
  fi
  STOCK_NEWS_RUNTIME_ENABLED=1
fi

ONTOLOGY_SOURCE_DIR=${KRW_ONTOLOGY_SOURCE_DIR:-"$HOME/krw-ontology"}
require_command uv
require_path "$ONTOLOGY_SOURCE_DIR/pyproject.toml"
require_path "$ONTOLOGY_SOURCE_DIR/src/krw_ontology"
PLUGIN_SOURCE_PATH=${KRW_ONTOLOGY_PLUGIN_SOURCE_PATH:-"$ONTOLOGY_SOURCE_DIR/plugins/krw-ontology"}
require_path "$PLUGIN_SOURCE_PATH/.claude-plugin/plugin.json"
GURU_PLUGIN_SOURCE_PATH=${KRW_GURU_ADVISOR_PLUGIN_SOURCE_PATH:-"$ONTOLOGY_SOURCE_DIR/plugins/krw-guru-advisor"}
GURU_PLUGIN_PATH=${KRW_GURU_ADVISOR_PLUGIN_PATH:-"$FRONT_DIR/ref/plugins/prod/krw-guru-advisor"}
GURU_DATA_ROOT=${KRW_GURU_DATA_ROOT:-"$HOME/krw-ontology-guru-data"}
GURU_RELEASE_ROOT=${KRW_GURU_RELEASE_ROOT:-"$GURU_DATA_ROOT/releases/prod/current"}
require_path "$GURU_PLUGIN_SOURCE_PATH/.claude-plugin/plugin.json"
require_path "$GURU_RELEASE_ROOT"

echo "Checking KRW Ontology prod release startup contract..."
(cd "$ONTOLOGY_SOURCE_DIR" && uv run krw-ontology release verify \
  --startup-check \
  --root "$KRW_ONTOLOGY_RELEASE_ROOT" \
  --env prod \
  --require-current-symlink)

node "$SCRIPT_DIR/materialize-ontology-plugin.mjs" \
  --env prod \
  --source "$PLUGIN_SOURCE_PATH" \
  --out "$KRW_ONTOLOGY_PLUGIN_PATH" \
  --mcp-url "$KRW_ONTOLOGY_MCP_URL" \
  --stock-news-url "${STOCK_NEWS_MCP_URL:-http://127.0.0.1:8775/mcp}" >/dev/null

node "$SCRIPT_DIR/materialize-guru-advisor-plugin.mjs" \
  --env prod \
  --source "$GURU_PLUGIN_SOURCE_PATH" \
  --out "$GURU_PLUGIN_PATH" \
  --ontology-source-dir "$ONTOLOGY_SOURCE_DIR" \
  --guru-data-root "$GURU_DATA_ROOT" \
  --guru-release-root "$GURU_RELEASE_ROOT" \
  --company-mcp-url "$KRW_ONTOLOGY_MCP_URL" >/dev/null

export KRW_GURU_ADVISOR_PLUGIN_PATH="$GURU_PLUGIN_PATH"
export KRW_GURU_DATA_ROOT="$GURU_DATA_ROOT"
export KRW_GURU_RELEASE_ROOT="$GURU_RELEASE_ROOT"

STOCK_NEWS_COVERAGE_PATH=${STOCK_NEWS_COVERAGE_PATH:-"$KRW_ONTOLOGY_PLUGIN_PATH/stock-news/coverage_companies.json"}
if [ "$STOCK_NEWS_RUNTIME_ENABLED" = "1" ]; then
  node "$SCRIPT_DIR/export-stock-news-coverage.mjs" \
    --env prod \
    --env-file "$ENV_PATH" \
    --out "$STOCK_NEWS_COVERAGE_PATH"
  export STOCK_NEWS_COVERAGE_PATH
fi

require_path "$KRW_ONTOLOGY_PLUGIN_PATH/.mcp.json"
require_path "$KRW_ONTOLOGY_PLUGIN_PATH/.claude-plugin/plugin.json"
require_path "$GURU_PLUGIN_PATH/.mcp.json"
require_path "$GURU_PLUGIN_PATH/.claude-plugin/plugin.json"
if [ "$STOCK_NEWS_RUNTIME_ENABLED" = "1" ]; then
  require_path "$STOCK_NEWS_COVERAGE_PATH"
fi

SKILL_COUNT=$(
  find "$KRW_ONTOLOGY_PLUGIN_PATH/skills" \
    -mindepth 2 -maxdepth 2 -name SKILL.md 2>/dev/null | wc -l | tr -d ' '
)
if [ "$SKILL_COUNT" -lt 1 ]; then
  echo "No plugin skill files found under $KRW_ONTOLOGY_PLUGIN_PATH/skills" >&2
  exit 1
fi

EXPECTED_PLUGIN_PATH="$FRONT_DIR/ref/plugins/prod/krw-ontology"
if [ "${KRW_ONTOLOGY_PLUGIN_PATH:-}" != "$EXPECTED_PLUGIN_PATH" ]; then
  echo "KRW_ONTOLOGY_PLUGIN_PATH mismatch." >&2
  echo "  env:      ${KRW_ONTOLOGY_PLUGIN_PATH:-unset}" >&2
  echo "  expected: $EXPECTED_PLUGIN_PATH" >&2
  exit 1
fi

if [ "${KRW_ONTOLOGY_SOURCE_DIR:-}" != "$ONTOLOGY_SOURCE_DIR" ]; then
  echo "KRW_ONTOLOGY_SOURCE_DIR mismatch." >&2
  echo "  env:      ${KRW_ONTOLOGY_SOURCE_DIR:-unset}" >&2
  echo "  expected: $ONTOLOGY_SOURCE_DIR" >&2
  exit 1
fi

echo "Ontology source: $ONTOLOGY_SOURCE_DIR"
echo "Plugin path: $KRW_ONTOLOGY_PLUGIN_PATH"
echo "Guru plugin path: $GURU_PLUGIN_PATH"
echo "Guru release root: $GURU_RELEASE_ROOT"
echo "Skill files: $SKILL_COUNT"
echo "MCP URL: ${KRW_ONTOLOGY_MCP_URL:-unset}"
if [ "$STOCK_NEWS_RUNTIME_ENABLED" = "1" ]; then
  echo "Stock News MCP URL: ${STOCK_NEWS_MCP_URL:-http://127.0.0.1:8775/mcp}"
  echo "Stock News coverage: $STOCK_NEWS_COVERAGE_PATH"
else
  echo "Stock News MCP: disabled"
fi

if [ "$DRY_RUN" = "1" ]; then
  "$SCRIPT_DIR/install-mcp-server-launchd.sh" --env-file "$ENV_PATH" --dry-run
  "$SCRIPT_DIR/install-stock-news-mcp-launchd.sh" --env-file "$ENV_PATH" --dry-run
  "$SCRIPT_DIR/deploy-worker-production.sh" --env-file "$ENV_PATH" --dry-run
  exit 0
fi

"$SCRIPT_DIR/install-mcp-server-launchd.sh" --env-file "$ENV_PATH" --load
"$SCRIPT_DIR/install-stock-news-mcp-launchd.sh" --env-file "$ENV_PATH" --load
"$SCRIPT_DIR/deploy-worker-production.sh" --env-file "$ENV_PATH"

echo "Plugin/MCP Mac worker deployment complete."
