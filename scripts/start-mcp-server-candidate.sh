#!/bin/sh
set -eu

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/start-mcp-server-candidate.sh --release-root DIR --runtime-root CURRENT [--env-file FILE] [--port PORT]

Run an immutable prod release on a separate local MCP port. This command never
reads or changes prod/current and deliberately omits legacy-index fallback.
EOF
}

ENV_FILE=.env.mac-worker.production
RELEASE_ROOT=
RUNTIME_ROOT=
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

if [ -z "$RELEASE_ROOT" ] || [ ! -d "$RELEASE_ROOT" ]; then
  echo "A valid --release-root is required: ${RELEASE_ROOT:-unset}" >&2
  exit 1
fi
if [ -L "$RELEASE_ROOT" ]; then
  echo "Candidate release root must be immutable, not a symlink: $RELEASE_ROOT" >&2
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
RELEASE_ID=$(basename "$RELEASE_ROOT")
DATA_ROOT=$(dirname "$(dirname "$(dirname "$RELEASE_ROOT")")")
EXPECTED_RUNTIME_ROOT="$DATA_ROOT/runtime/mcp-candidates/$RELEASE_ID/current"
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
case "$PORT" in
  ''|*[!0-9]*)
    echo "Port must be an integer: $PORT" >&2
    exit 1
    ;;
esac
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "Port must be between 1 and 65535: $PORT" >&2
  exit 1
fi
if [ ! -f "$ENV_PATH" ]; then
  echo "Missing Mac production env file: $ENV_PATH" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_PATH"
set +a

: "${KRW_ONTOLOGY_SOURCE_DIR:?Missing KRW_ONTOLOGY_SOURCE_DIR}"
if [ ! -f "$KRW_ONTOLOGY_SOURCE_DIR/pyproject.toml" ]; then
  echo "Missing KRW Ontology source: $KRW_ONTOLOGY_SOURCE_DIR" >&2
  exit 1
fi

KRW_ONTOLOGY_ENV=prod
KRW_ONTOLOGY_RELEASE_ROOT=$RUNTIME_ROOT
KRW_ONTOLOGY_ROOT=$RUNTIME_ROOT
KRW_ONTOLOGY_MANIFEST_PATH="$RUNTIME_ROOT/manifest.json"
KRW_ONTOLOGY_GLOBAL_SPINE_PATH="$RUNTIME_ROOT/indexes/global_spine.sqlite"
KRW_ONTOLOGY_SHARD_MANIFEST_PATH="$RUNTIME_ROOT/indexes/shard_manifest.json"
KRW_ONTOLOGY_MCP_HOST=127.0.0.1
KRW_ONTOLOGY_MCP_PORT=$PORT
KRW_ONTOLOGY_MCP_PATH=/mcp
KRW_ONTOLOGY_MCP_URL="http://127.0.0.1:$PORT/mcp"
KRW_ONTOLOGY_MCP_HEALTH_URL="http://127.0.0.1:$PORT/health"
KRW_ONTOLOGY_MCP_READY_URL="http://127.0.0.1:$PORT/readyz"
KRW_LOG_DIR=${KRW_LOG_DIR:-"$HOME/krw-ontology-log"}
MCP_LOG_DIR="$KRW_LOG_DIR/mcp/prod/candidates/$RELEASE_ID-$PORT"
MCP_SERVER_LOG_FILE="$MCP_LOG_DIR/mcp-candidate.log"
MCP_SERVER_LOG_LEVEL=${MCP_SERVER_LOG_LEVEL:-info}
KRW_MCP_STORE_MODE=${KRW_MCP_STORE_MODE:-persistent}
KRW_MCP_STORE_POOL_MAX=${KRW_MCP_STORE_POOL_MAX:-8}
export KRW_ONTOLOGY_ENV KRW_ONTOLOGY_RELEASE_ROOT KRW_ONTOLOGY_ROOT
export KRW_ONTOLOGY_MANIFEST_PATH KRW_ONTOLOGY_GLOBAL_SPINE_PATH
export KRW_ONTOLOGY_SHARD_MANIFEST_PATH KRW_ONTOLOGY_MCP_HOST
export KRW_ONTOLOGY_MCP_PORT KRW_ONTOLOGY_MCP_PATH KRW_ONTOLOGY_MCP_URL
export KRW_ONTOLOGY_MCP_HEALTH_URL KRW_ONTOLOGY_MCP_READY_URL
export KRW_MCP_STORE_POOL_MAX

# Values persisted for another release must never leak into this process.
unset KRW_MCP_EXPECTED_CONTRACT_VERSION
unset KRW_MCP_EXPECTED_BUILD_ID
unset KRW_MCP_EXPECTED_BACKEND_GIT_SHA
unset KRW_MCP_EXPECTED_TOOL_SCHEMA_SHA256
unset KRW_MCP_EXPECTED_BUILD_FINGERPRINT_SHA256
unset KRW_MCP_EXPECTED_RELEASE_MANIFEST_SHA256
unset KRW_MCP_EXPECTED_SERVICE_FINGERPRINT_SHA256

mkdir -p "$MCP_LOG_DIR"

echo "Checking immutable prod candidate startup contract..."
uv --directory "$KRW_ONTOLOGY_SOURCE_DIR" run krw-ontology release verify \
  --startup-check \
  --root "$RUNTIME_ROOT" \
  --env prod \
  --require-current-symlink >/dev/null
echo "OK immutable prod candidate startup contract"

# shellcheck disable=SC1091
. "$SCRIPT_DIR/mcp-runtime-fingerprint.sh"
load_expected_mcp_runtime_fingerprint
echo "OK candidate source/release fingerprint"

echo "Starting local candidate MCP: release=$RELEASE_ID port=$PORT runtime=$RUNTIME_ROOT"
exec uv --directory "$KRW_ONTOLOGY_SOURCE_DIR" run krw-ontology-mcp \
  --env prod \
  --host 127.0.0.1 \
  --port "$PORT" \
  --root "$RUNTIME_ROOT" \
  --require-current-symlink \
  --mcp-path /mcp \
  --store-mode "$KRW_MCP_STORE_MODE" \
  --log-file "$MCP_SERVER_LOG_FILE" \
  --log-level "$MCP_SERVER_LOG_LEVEL"
