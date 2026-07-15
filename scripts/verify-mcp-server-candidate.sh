#!/bin/sh
set -eu

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/verify-mcp-server-candidate.sh --release-root DIR --runtime-root CURRENT --plugin-path DIR [--env-file FILE] [--port PORT]

Verify release identity, build/tool fingerprints, exact MCP tool parity, and
the materialized plugin contract for a local immutable candidate.
EOF
}

ENV_FILE=.env.mac-worker.production
RELEASE_ROOT=
RUNTIME_ROOT=
PLUGIN_PATH=
PORT=8865

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE=${2:?Missing value for --env-file}
      shift
      ;;
    --release-root)
      RELEASE_ROOT=${2:?Missing value for --release-root}
      shift
      ;;
    --runtime-root)
      RUNTIME_ROOT=${2:?Missing value for --runtime-root}
      shift
      ;;
    --plugin-path)
      PLUGIN_PATH=${2:?Missing value for --plugin-path}
      shift
      ;;
    --port)
      PORT=${2:?Missing value for --port}
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

if [ ! -d "$RELEASE_ROOT" ] || [ -L "$RELEASE_ROOT" ]; then
  echo "An immutable --release-root is required: ${RELEASE_ROOT:-unset}" >&2
  exit 1
fi
RELEASE_ROOT=$(CDPATH= cd -- "$RELEASE_ROOT" && pwd -P)
case "$RELEASE_ROOT" in
  */releases/prod/[0-9]*) ;;
  *)
    echo "Candidate release must be an immutable prod release: $RELEASE_ROOT" >&2
    exit 1
    ;;
esac
EXPECTED_RELEASE_ID=$(basename "$RELEASE_ROOT")
DATA_ROOT=$(dirname "$(dirname "$(dirname "$RELEASE_ROOT")")")
EXPECTED_RUNTIME_ROOT="$DATA_ROOT/runtime/mcp-candidates/$EXPECTED_RELEASE_ID/current"
if [ ! -L "$RUNTIME_ROOT" ] || [ "$(basename "$RUNTIME_ROOT")" != "current" ]; then
  echo "Candidate --runtime-root must be a current symlink: ${RUNTIME_ROOT:-unset}" >&2
  exit 1
fi
RUNTIME_TARGET=$(CDPATH= cd -- "$RUNTIME_ROOT" && pwd -P)
if [ "$RUNTIME_TARGET" != "$RELEASE_ROOT" ]; then
  echo "Candidate runtime symlink points at the wrong release: $RUNTIME_TARGET" >&2
  exit 1
fi
RUNTIME_ROOT=$(CDPATH= cd -- "$(dirname "$RUNTIME_ROOT")" && pwd -P)/current
if [ "$RUNTIME_ROOT" != "$EXPECTED_RUNTIME_ROOT" ]; then
  echo "Candidate --runtime-root must use the isolated candidate runtime path." >&2
  echo "  expected: $EXPECTED_RUNTIME_ROOT" >&2
  echo "  received: $RUNTIME_ROOT" >&2
  exit 1
fi
if [ ! -f "$PLUGIN_PATH/.krw-ontology-contract.json" ]; then
  echo "A materialized --plugin-path is required: ${PLUGIN_PATH:-unset}" >&2
  exit 1
fi
if [ ! -f "$ENV_PATH" ]; then
  echo "Missing Mac production env file: $ENV_PATH" >&2
  exit 1
fi

PLUGIN_PATH=$(CDPATH= cd -- "$PLUGIN_PATH" && pwd -P)

set -a
# shellcheck disable=SC1090
. "$ENV_PATH"
set +a

KRW_ONTOLOGY_ENV=prod
KRW_ONTOLOGY_EXPECTED_ENV=prod
KRW_ONTOLOGY_RELEASE_ROOT=$RUNTIME_ROOT
KRW_ONTOLOGY_ROOT=$RUNTIME_ROOT
KRW_ONTOLOGY_MANIFEST_PATH="$RUNTIME_ROOT/manifest.json"
KRW_ONTOLOGY_GLOBAL_SPINE_PATH="$RUNTIME_ROOT/indexes/global_spine.sqlite"
KRW_ONTOLOGY_SHARD_MANIFEST_PATH="$RUNTIME_ROOT/indexes/shard_manifest.json"
KRW_ONTOLOGY_PLUGIN_PATH=$PLUGIN_PATH
KRW_ONTOLOGY_MCP_URL="http://127.0.0.1:$PORT/mcp"
KRW_ONTOLOGY_MCP_HEALTH_URL="http://127.0.0.1:$PORT/health"
KRW_ONTOLOGY_MCP_READY_URL="http://127.0.0.1:$PORT/readyz"
MCP_HEALTH_TIMEOUT_MS=${MCP_CANDIDATE_HEALTH_TIMEOUT_MS:-5000}
export KRW_ONTOLOGY_ENV KRW_ONTOLOGY_EXPECTED_ENV
export KRW_ONTOLOGY_RELEASE_ROOT KRW_ONTOLOGY_ROOT KRW_ONTOLOGY_PLUGIN_PATH
export KRW_ONTOLOGY_MANIFEST_PATH KRW_ONTOLOGY_GLOBAL_SPINE_PATH
export KRW_ONTOLOGY_SHARD_MANIFEST_PATH
export KRW_ONTOLOGY_MCP_URL KRW_ONTOLOGY_MCP_HEALTH_URL
export KRW_ONTOLOGY_MCP_READY_URL EXPECTED_RELEASE_ID
export MCP_HEALTH_TIMEOUT_MS

unset KRW_MCP_EXPECTED_CONTRACT_VERSION
unset KRW_MCP_EXPECTED_BUILD_ID
unset KRW_MCP_EXPECTED_BACKEND_GIT_SHA
unset KRW_MCP_EXPECTED_TOOL_SCHEMA_SHA256
unset KRW_MCP_EXPECTED_BUILD_FINGERPRINT_SHA256
unset KRW_MCP_EXPECTED_RELEASE_MANIFEST_SHA256
unset KRW_MCP_EXPECTED_SERVICE_FINGERPRINT_SHA256

# shellcheck disable=SC1091
. "$SCRIPT_DIR/mcp-runtime-fingerprint.sh"
load_expected_mcp_runtime_fingerprint

node "$SCRIPT_DIR/verify-mcp-runtime.mjs"
echo "OK immutable local candidate MCP readiness, parity, and fingerprints"
