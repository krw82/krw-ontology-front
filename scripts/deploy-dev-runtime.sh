#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/deploy-dev-runtime.sh [--dry-run]

Refresh the local dev KRW Ontology plugin/skills and restart the dev MCP
sidecar. This does not touch prod MCP or prod Mac workers.
EOF
}

DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
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
ONTOLOGY_SOURCE_DIR=${KRW_ONTOLOGY_SOURCE_DIR:-"$HOME/krw-ontology"}
PLUGIN_SOURCE_PATH=${KRW_ONTOLOGY_PLUGIN_SOURCE_PATH:-"$ONTOLOGY_SOURCE_DIR/plugins/krw-ontology"}
PLUGIN_PATH="$FRONT_DIR/ref/plugins/dev/krw-ontology"
GURU_PLUGIN_SOURCE_PATH=${KRW_GURU_ADVISOR_PLUGIN_SOURCE_PATH:-"$ONTOLOGY_SOURCE_DIR/plugins/krw-guru-advisor"}
GURU_PLUGIN_PATH=${KRW_GURU_ADVISOR_PLUGIN_PATH:-"$FRONT_DIR/ref/plugins/dev/krw-guru-advisor"}
GURU_DATA_ROOT=${KRW_GURU_DATA_ROOT:-"$HOME/krw-ontology-guru-data"}
GURU_RELEASE_ROOT=${KRW_GURU_RELEASE_ROOT:-"$GURU_DATA_ROOT/releases/dev/current"}
MCP_URL=${KRW_DEV_MCP_URL:-http://127.0.0.1:8766/mcp}

require_path() {
  if [ ! -e "$1" ]; then
    echo "Missing required path: $1" >&2
    exit 1
  fi
}

require_path "$ONTOLOGY_SOURCE_DIR/pyproject.toml"
require_path "$ONTOLOGY_SOURCE_DIR/src/krw_ontology"
require_path "$PLUGIN_SOURCE_PATH/.claude-plugin/plugin.json"
require_path "$GURU_PLUGIN_SOURCE_PATH/.claude-plugin/plugin.json"
require_path "$GURU_RELEASE_ROOT"

echo "Ontology source: $ONTOLOGY_SOURCE_DIR"
echo "Dev plugin path: $PLUGIN_PATH"
echo "Dev guru plugin path: $GURU_PLUGIN_PATH"
echo "Dev MCP URL: $MCP_URL"

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would materialize dev KRW Ontology and Guru Advisor plugins."
  "$SCRIPT_DIR/install-mcp-server-dev-launchd.sh" --dry-run
  exit 0
fi

node "$SCRIPT_DIR/materialize-ontology-plugin.mjs" \
  --env dev \
  --source "$PLUGIN_SOURCE_PATH" \
  --out "$PLUGIN_PATH" \
  --mcp-url "$MCP_URL" >/dev/null

node "$SCRIPT_DIR/materialize-guru-advisor-plugin.mjs" \
  --env dev \
  --source "$GURU_PLUGIN_SOURCE_PATH" \
  --out "$GURU_PLUGIN_PATH" \
  --ontology-source-dir "$ONTOLOGY_SOURCE_DIR" \
  --guru-data-root "$GURU_DATA_ROOT" \
  --guru-release-root "$GURU_RELEASE_ROOT" >/dev/null

require_path "$PLUGIN_PATH/.mcp.json"
require_path "$PLUGIN_PATH/.claude-plugin/plugin.json"
require_path "$PLUGIN_PATH/.krw-ontology-contract.json"
require_path "$GURU_PLUGIN_PATH/.mcp.json"
require_path "$GURU_PLUGIN_PATH/.claude-plugin/plugin.json"

SKILL_COUNT=$(
  find "$PLUGIN_PATH/skills" \
    -mindepth 2 -maxdepth 2 -name SKILL.md 2>/dev/null | wc -l | tr -d ' '
)
if [ "$SKILL_COUNT" -lt 1 ]; then
  echo "No plugin skill files found under $PLUGIN_PATH/skills" >&2
  exit 1
fi

echo "Skill files: $SKILL_COUNT"

"$SCRIPT_DIR/install-mcp-server-dev-launchd.sh" --load

echo "Dev runtime deployment complete."
