#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/deploy-worker-production.sh [--env-file FILE] [--release-id ID] [--dry-run]

Rebuild and restart only the Mac production agent workers. The long-running MCP
HTTP server must already be healthy. Use deploy:mcp when plugin/MCP code
changes too.

This does not deploy or restart the GCP web container.
EOF
}

ENV_FILE=.env.mac-worker.production
EXPECTED_RELEASE_ID=""
DRY_RUN=0

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

require_command npm
require_command node
require_path "$ENV_PATH"
require_path "$FRONT_DIR/scripts/mac-worker-preflight.sh"
require_path "$FRONT_DIR/scripts/install-mac-worker-launchd.sh"
require_path "$FRONT_DIR/scripts/verify-mac-worker-heartbeats.mjs"

echo "Mac worker env: $ENV_PATH"
echo "Frontend worker source: $FRONT_DIR"
if [ -n "$EXPECTED_RELEASE_ID" ]; then
  echo "Expected ontology release: $EXPECTED_RELEASE_ID"
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would run Mac worker preflight, install launchd workers, and verify heartbeats."
  exit 0
fi

"$SCRIPT_DIR/mac-worker-preflight.sh" \
  --env-file "$ENV_PATH" \
  --skip-worker-duplicate-check

"$SCRIPT_DIR/install-mac-worker-launchd.sh" \
  --env-file "$ENV_PATH" \
  --load

if [ -n "$EXPECTED_RELEASE_ID" ]; then
  node "$SCRIPT_DIR/verify-mac-worker-heartbeats.mjs" \
    --env-file "$ENV_PATH" \
    --release-id "$EXPECTED_RELEASE_ID" \
    --timeout-ms 120000
else
  node "$SCRIPT_DIR/verify-mac-worker-heartbeats.mjs" \
    --env-file "$ENV_PATH" \
    --timeout-ms 120000
fi

"$SCRIPT_DIR/status-production-workers.sh" \
  --env-file "$ENV_PATH" \
  --skip-gcp

echo "Mac worker deployment complete."
