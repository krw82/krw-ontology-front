#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/start-mcp-server-dev.sh

Run the long-lived local KRW Ontology MCP HTTP server for dev workers.
Defaults to dev/current on port 8766.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)

KRW_ONTOLOGY_ENV=dev
KRW_ONTOLOGY_SOURCE_DIR=${KRW_ONTOLOGY_SOURCE_DIR:-"$HOME/krw-ontology"}
KRW_ONTOLOGY_RELEASE_ROOT=${KRW_ONTOLOGY_RELEASE_ROOT:-"$HOME/krw-ontology-data/releases/dev/current"}
KRW_ONTOLOGY_ROOT=${KRW_ONTOLOGY_ROOT:-"$KRW_ONTOLOGY_RELEASE_ROOT"}
KRW_ONTOLOGY_MANIFEST_PATH=${KRW_ONTOLOGY_MANIFEST_PATH:-"$KRW_ONTOLOGY_RELEASE_ROOT/manifest.json"}
KRW_ONTOLOGY_INDEX_PATH=${KRW_ONTOLOGY_INDEX_PATH:-"$KRW_ONTOLOGY_RELEASE_ROOT/indexes/agent_index.sqlite"}
KRW_ONTOLOGY_MCP_HOST=${KRW_ONTOLOGY_MCP_HOST:-127.0.0.1}
KRW_ONTOLOGY_MCP_PORT=${KRW_ONTOLOGY_MCP_PORT:-8766}
KRW_ONTOLOGY_MCP_PATH=${KRW_ONTOLOGY_MCP_PATH:-/mcp}
MCP_SERVER_LOG_LEVEL=${MCP_SERVER_LOG_LEVEL:-warning}

export KRW_ONTOLOGY_ENV
export KRW_ONTOLOGY_SOURCE_DIR
export KRW_ONTOLOGY_RELEASE_ROOT
export KRW_ONTOLOGY_ROOT
export KRW_ONTOLOGY_MANIFEST_PATH
export KRW_ONTOLOGY_INDEX_PATH

if [ ! -f "$KRW_ONTOLOGY_SOURCE_DIR/pyproject.toml" ]; then
  echo "Missing KRW ontology source: $KRW_ONTOLOGY_SOURCE_DIR" >&2
  exit 1
fi
if [ ! -e "$KRW_ONTOLOGY_INDEX_PATH" ]; then
  echo "Missing dev ontology index: $KRW_ONTOLOGY_INDEX_PATH" >&2
  exit 1
fi

echo "Starting KRW Ontology dev MCP HTTP server..."
echo "Source: $KRW_ONTOLOGY_SOURCE_DIR"
echo "Release root: $KRW_ONTOLOGY_RELEASE_ROOT"
echo "MCP URL: http://$KRW_ONTOLOGY_MCP_HOST:$KRW_ONTOLOGY_MCP_PORT$KRW_ONTOLOGY_MCP_PATH"

exec uv --directory "$KRW_ONTOLOGY_SOURCE_DIR" run krw-ontology-mcp-http \
  --host "$KRW_ONTOLOGY_MCP_HOST" \
  --port "$KRW_ONTOLOGY_MCP_PORT" \
  --root "$KRW_ONTOLOGY_RELEASE_ROOT" \
  --mcp-path "$KRW_ONTOLOGY_MCP_PATH" \
  --log-level "$MCP_SERVER_LOG_LEVEL"
