#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

KRW_ONTOLOGY_MCP_URL=${KRW_ONTOLOGY_MCP_URL:-http://127.0.0.1:8766/mcp}
KRW_ONTOLOGY_SOURCE_DIR=${KRW_ONTOLOGY_SOURCE_DIR:-"$HOME/krw-ontology"}
KRW_ONTOLOGY_RELEASE_ROOT=${KRW_ONTOLOGY_RELEASE_ROOT:-"$HOME/krw-ontology-data/releases/dev/current"}
EXPECTED_RELEASE_ID=${EXPECTED_RELEASE_ID:-}
export KRW_ONTOLOGY_MCP_URL
export KRW_ONTOLOGY_SOURCE_DIR
export KRW_ONTOLOGY_RELEASE_ROOT
export EXPECTED_RELEASE_ID
export KRW_ONTOLOGY_EXPECTED_ENV=dev

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
# shellcheck disable=SC1091
. "$SCRIPT_DIR/mcp-runtime-fingerprint.sh"
load_expected_mcp_runtime_fingerprint
node "$SCRIPT_DIR/verify-mcp-runtime.mjs"

echo "OK dev MCP HTTP server v2 readiness and fingerprint"
