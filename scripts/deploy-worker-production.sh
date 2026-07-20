#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/deploy-worker-production.sh [--env-file FILE] [--release-id ID] [--deployment-id ID] [--worker-bundle-sha256 SHA256] [--runtime-identity-sha256 SHA256] [--use-prebuilt] [--dry-run]

Rebuild and restart only the Mac production agent supervisor. The long-running
MCP HTTP server must already be healthy. Use prod:deploy:runtime when
plugin/MCP code changes too.

This does not deploy or restart the GCP web container.
EOF
}

ENV_FILE=.env.mac-worker.production
EXPECTED_RELEASE_ID=""
DRY_RUN=0
USE_PREBUILT=0
EXPECTED_DEPLOYMENT_ID=""
EXPECTED_WORKER_BUNDLE_SHA256=""
EXPECTED_RUNTIME_IDENTITY_SHA256=""

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
    --deployment-id)
      EXPECTED_DEPLOYMENT_ID=${2:?Missing value for --deployment-id}
      shift
      ;;
    --worker-bundle-sha256)
      EXPECTED_WORKER_BUNDLE_SHA256=${2:?Missing value for --worker-bundle-sha256}
      shift
      ;;
    --runtime-identity-sha256)
      EXPECTED_RUNTIME_IDENTITY_SHA256=${2:?Missing value for --runtime-identity-sha256}
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --use-prebuilt)
      USE_PREBUILT=1
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
require_path "$FRONT_DIR/scripts/compute-production-source-sha256.mjs"

set -a
# shellcheck disable=SC1090
. "$ENV_PATH"
set +a
WORKER_RUNTIME_ROOT=${KRW_MAC_RUNTIME_ROOT:-$FRONT_DIR}
require_path "$WORKER_RUNTIME_ROOT/.worker"
require_path "$WORKER_RUNTIME_ROOT/node_modules"

echo "Mac worker env: $ENV_PATH"
echo "Frontend worker source: $FRONT_DIR"
if [ -n "$EXPECTED_RELEASE_ID" ]; then
  echo "Expected ontology release: $EXPECTED_RELEASE_ID"
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would run Mac supervisor preflight, verify the exact worker bundle, install launchd supervisor, and verify a deployment-bound post-activation heartbeat (use_prebuilt=$USE_PREBUILT)."
  exit 0
fi

if [ "$USE_PREBUILT" = "1" ]; then
  (cd "$WORKER_RUNTIME_ROOT" && \
    "$SCRIPT_DIR/mac-worker-preflight.sh" \
      --env-file "$ENV_PATH" \
      --skip-worker-duplicate-check \
      --skip-worker-build)
else
  (cd "$WORKER_RUNTIME_ROOT" && \
    "$SCRIPT_DIR/mac-worker-preflight.sh" \
      --env-file "$ENV_PATH" \
      --skip-worker-duplicate-check)
fi

# Recompute the live bundle digest immediately before launchd bootstrap. A
# fresh heartbeat alone proves only that a process restarted; these values bind
# that heartbeat to the sealed bytes and deployment that passed preparation.
LIVE_WORKER_BUNDLE_SHA256=$(node \
  "$SCRIPT_DIR/compute-production-source-sha256.mjs" \
  "$WORKER_RUNTIME_ROOT/.worker")
if [ -z "$EXPECTED_WORKER_BUNDLE_SHA256" ]; then
  EXPECTED_WORKER_BUNDLE_SHA256=$LIVE_WORKER_BUNDLE_SHA256
elif [ "$LIVE_WORKER_BUNDLE_SHA256" != "$EXPECTED_WORKER_BUNDLE_SHA256" ]; then
  echo "Mac worker bundle changed before launchd bootstrap." >&2
  echo "  expected: $EXPECTED_WORKER_BUNDLE_SHA256" >&2
  echo "  actual:   $LIVE_WORKER_BUNDLE_SHA256" >&2
  exit 1
fi
if [ -z "$EXPECTED_DEPLOYMENT_ID" ]; then
  EXPECTED_DEPLOYMENT_ID=${NEXT_PUBLIC_APP_VERSION:-$(date -u +%Y%m%d%H%M%S)-$$}
fi
case "$EXPECTED_DEPLOYMENT_ID" in
  ''|*[!A-Za-z0-9._-]*)
    echo "Invalid Mac deployment id: $EXPECTED_DEPLOYMENT_ID" >&2
    exit 1
    ;;
esac
export KRW_DEPLOYMENT_ID=$EXPECTED_DEPLOYMENT_ID
export KRW_WORKER_BUNDLE_SHA256=$EXPECTED_WORKER_BUNDLE_SHA256
if [ -z "$EXPECTED_RUNTIME_IDENTITY_SHA256" ]; then
  EXPECTED_RUNTIME_IDENTITY_SHA256=${KRW_RUNTIME_IDENTITY_SHA256:-}
fi
printf '%s' "$EXPECTED_RUNTIME_IDENTITY_SHA256" | grep -Eq '^[a-f0-9]{64}$' || {
  echo "A valid runtime identity SHA-256 is required for Mac activation." >&2
  exit 1
}
export KRW_RUNTIME_IDENTITY_SHA256=$EXPECTED_RUNTIME_IDENTITY_SHA256

ACTIVATION_STARTED_AT=$(node -e 'process.stdout.write(new Date().toISOString())')
"$SCRIPT_DIR/install-mac-worker-launchd.sh" \
  --env-file "$ENV_PATH" \
  --skip-preflight \
  --load

if [ -n "$EXPECTED_RELEASE_ID" ]; then
  node "$SCRIPT_DIR/verify-mac-worker-heartbeats.mjs" \
    --env-file "$ENV_PATH" \
    --release-id "$EXPECTED_RELEASE_ID" \
    --seen-after "$ACTIVATION_STARTED_AT" \
    --deployment-id "$EXPECTED_DEPLOYMENT_ID" \
    --worker-bundle-sha256 "$EXPECTED_WORKER_BUNDLE_SHA256" \
    --runtime-identity-sha256 "$EXPECTED_RUNTIME_IDENTITY_SHA256" \
    --timeout-ms 120000
else
  node "$SCRIPT_DIR/verify-mac-worker-heartbeats.mjs" \
    --env-file "$ENV_PATH" \
    --seen-after "$ACTIVATION_STARTED_AT" \
    --deployment-id "$EXPECTED_DEPLOYMENT_ID" \
    --worker-bundle-sha256 "$EXPECTED_WORKER_BUNDLE_SHA256" \
    --runtime-identity-sha256 "$EXPECTED_RUNTIME_IDENTITY_SHA256" \
    --timeout-ms 120000
fi

"$SCRIPT_DIR/status-production-workers.sh" \
  --env-file "$ENV_PATH" \
  --skip-gcp

echo "Mac supervisor deployment complete."
