#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/verify-mcp-server-production.sh [--env-file FILE] [--release-id ID]

Check the long-running local KRW Ontology MCP HTTP server /readyz endpoint,
including exact v2 tool parity and build/schema fingerprints.
EOF
}

ENV_FILE=.env.mac-worker.production
EXPECTED_RELEASE_ID=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE=${2:?Missing value for --env-file}
      shift
      ;;
    --release-id)
      EXPECTED_RELEASE_ID=${2:?Missing value for --release-id}
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

if [ -n "$EXPECTED_RELEASE_ID" ]; then
  export EXPECTED_RELEASE_ID
fi
export KRW_ONTOLOGY_EXPECTED_ENV=prod

# Compute the desired fingerprint from the current source and immutable release.
# This catches a stale already-running process even when it reports internally
# consistent hashes for its older build.
# shellcheck disable=SC1091
. "$SCRIPT_DIR/mcp-runtime-fingerprint.sh"
load_expected_mcp_runtime_fingerprint

node "$SCRIPT_DIR/verify-mcp-runtime.mjs"

echo "OK MCP HTTP server v2 readiness and fingerprint"
