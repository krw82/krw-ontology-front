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

require_path "$ENV_PATH"

set -a
# shellcheck disable=SC1090
. "$ENV_PATH"
set +a

ONTOLOGY_SOURCE_DIR=${KRW_ONTOLOGY_SOURCE_DIR:-"$HOME/krw-ontology"}
require_path "$ONTOLOGY_SOURCE_DIR/pyproject.toml"
require_path "$ONTOLOGY_SOURCE_DIR/src/krw_ontology"
PLUGIN_SOURCE_PATH=${KRW_ONTOLOGY_PLUGIN_SOURCE_PATH:-"$ONTOLOGY_SOURCE_DIR/plugins/krw-ontology"}
require_path "$PLUGIN_SOURCE_PATH/.claude-plugin/plugin.json"

node "$SCRIPT_DIR/materialize-ontology-plugin.mjs" \
  --env prod \
  --source "$PLUGIN_SOURCE_PATH" \
  --out "$KRW_ONTOLOGY_PLUGIN_PATH" \
  --mcp-url "$KRW_ONTOLOGY_MCP_URL" >/dev/null

require_path "$KRW_ONTOLOGY_PLUGIN_PATH/.mcp.json"
require_path "$KRW_ONTOLOGY_PLUGIN_PATH/.claude-plugin/plugin.json"

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
echo "Skill files: $SKILL_COUNT"
echo "MCP URL: ${KRW_ONTOLOGY_MCP_URL:-unset}"
echo "Stock News MCP URL: ${STOCK_NEWS_ZAI_MCP_URL:-http://127.0.0.1:8775/mcp}"

if [ "$DRY_RUN" = "1" ]; then
  "$SCRIPT_DIR/install-mcp-server-launchd.sh" --env-file "$ENV_PATH" --dry-run
  "$SCRIPT_DIR/install-stock-news-zai-mcp-launchd.sh" --env-file "$ENV_PATH" --dry-run
  "$SCRIPT_DIR/deploy-worker-production.sh" --env-file "$ENV_PATH" --dry-run
  exit 0
fi

"$SCRIPT_DIR/install-mcp-server-launchd.sh" --env-file "$ENV_PATH" --load
"$SCRIPT_DIR/install-stock-news-zai-mcp-launchd.sh" --env-file "$ENV_PATH" --load
"$SCRIPT_DIR/deploy-worker-production.sh" --env-file "$ENV_PATH"

echo "Plugin/MCP Mac worker deployment complete."
