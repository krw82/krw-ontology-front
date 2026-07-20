#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/deploy-data-release-production.sh [--release-id ID] [--releases-root DIR] [--env-file FILE] [--dry-run] [--skip-runtime-restart] [--skip-worker-restart] [--catalog-file FILE]

Publish the active local prod ontology release to the web control plane without
restarting any production runtime.

Flow:
  1. Verify that the requested release is already prod/current. Cross-release
     promotion is intentionally rejected until a sealed candidate cutover can
     update data, plugin, MCP, and worker state atomically.
  2. Verify /releases/prod/current and its manifest/index.
  3. Export a compact web_catalog.json from the release.
  4. Publish the catalog to Supabase and mark it active.
This script does not upload full ontology data to GCP. The full SQLite index
stays on the Mac worker release root.
EOF
}

ENV_FILE=.env.mac-worker.production
RELEASES_ROOT=${KRW_ONTOLOGY_RELEASES_ROOT:-"$HOME/krw-ontology-data/releases"}
ONTOLOGY_SOURCE_DIR=${KRW_ONTOLOGY_SOURCE_DIR:-"$HOME/krw-ontology"}
RELEASE_ID=""
CATALOG_FILE=""
DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --release-id)
      RELEASE_ID=${2:?Missing value for --release-id}
      shift
      ;;
    --releases-root)
      RELEASES_ROOT=${2:?Missing value for --releases-root}
      shift
      ;;
    --env-file)
      ENV_FILE=${2:?Missing value for --env-file}
      shift
      ;;
    --catalog-file)
      CATALOG_FILE=${2:?Missing value for --catalog-file}
      shift
      ;;
    --skip-runtime-restart|--skip-worker-restart)
      : # Retained as a compatibility no-op; publication never restarts runtime.
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
case "$RELEASES_ROOT" in
  /*) ;;
  *) RELEASES_ROOT="$FRONT_DIR/$RELEASES_ROOT" ;;
esac
case "$ONTOLOGY_SOURCE_DIR" in
  /*) ;;
  *) ONTOLOGY_SOURCE_DIR="$FRONT_DIR/$ONTOLOGY_SOURCE_DIR" ;;
esac

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_path() {
  if [ ! -e "$1" ]; then
    echo "Missing required path: $1" >&2
    exit 1
  fi
}

run_krw_ontology() {
  if command -v uv >/dev/null 2>&1; then
    (cd "$ONTOLOGY_SOURCE_DIR" && uv run krw-ontology "$@")
  elif [ -x "$ONTOLOGY_SOURCE_DIR/.venv/bin/krw-ontology" ]; then
    "$ONTOLOGY_SOURCE_DIR/.venv/bin/krw-ontology" "$@"
  else
    krw-ontology "$@"
  fi
}

read_manifest_release_id() {
  node -e 'const fs=require("fs"); const manifest=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (!manifest.release_id) process.exit(1); process.stdout.write(manifest.release_id);' "$1"
}

require_command node
require_path "$ENV_PATH"
require_path "$ONTOLOGY_SOURCE_DIR/pyproject.toml"
require_path "$ONTOLOGY_SOURCE_DIR/src/krw_ontology"
require_path "$RELEASES_ROOT/prod"
require_path "$SCRIPT_DIR/publish-web-catalog.mjs"
require_path "$SCRIPT_DIR/verify-web-catalog-release.mjs"

RELEASE_ROOT="$RELEASES_ROOT/prod/current"
TARGET_ROOT=""
if [ -n "$RELEASE_ID" ]; then
  TARGET_ROOT="$RELEASES_ROOT/prod/$RELEASE_ID"
  require_path "$TARGET_ROOT"
fi

if [ -z "$CATALOG_FILE" ]; then
  CATALOG_FILE="$(mktemp "${TMPDIR:-/tmp}/krw-web-catalog.XXXXXX")"
  CATALOG_FILE="${CATALOG_FILE}.json"
  CLEAN_CATALOG=1
else
  case "$CATALOG_FILE" in
    /*) ;;
    *) CATALOG_FILE="$FRONT_DIR/$CATALOG_FILE" ;;
  esac
  CLEAN_CATALOG=0
fi

cleanup() {
  if [ "${CLEAN_CATALOG:-0}" = "1" ]; then
    rm -f "$CATALOG_FILE"
  fi
  if [ "${CHILD_OWNS_DEPLOY_LOCK:-0}" = "1" ]; then
    rm -f "$DEPLOY_LOCK_DIR/owner"
    rmdir "$DEPLOY_LOCK_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$FRONT_DIR/.deploy"
DEPLOY_LOCK_DIR="$FRONT_DIR/.deploy/production-deploy.lock"
CHILD_OWNS_DEPLOY_LOCK=0
if [ "$DRY_RUN" = "1" ]; then
  : # No production mutation and no child-lane lock requirement.
elif [ -n "${PRODUCTION_DEPLOY_LOCK_OWNER:-}" ]; then
  test -f "$DEPLOY_LOCK_DIR/owner" || {
    echo "Production deploy lock owner file is missing." >&2
    exit 1
  }
  lock_owner=$(sed -n '1p' "$DEPLOY_LOCK_DIR/owner")
  if [ "$lock_owner" != "$PRODUCTION_DEPLOY_LOCK_OWNER" ]; then
    echo "Production deploy lock ownership mismatch." >&2
    exit 1
  fi
  [ "${PRODUCTION_OS_LOCK_HELD:-0}" = "1" ] || {
    echo "Missing kernel-held production deploy lock." >&2
    exit 1
  }
  expected_attestation="${NEXT_PUBLIC_APP_VERSION:-}:$PRODUCTION_DEPLOY_LOCK_OWNER"
  [ "${PRODUCTION_ORCHESTRATOR_ATTESTATION:-}" = "$expected_attestation" ] || {
    echo "Missing or invalid production orchestrator attestation." >&2
    exit 1
  }
else
  echo "The production data lane is internal; invoke the queue-safe production orchestrator." >&2
  exit 1
fi

# This entry point is callable without the full orchestrator, so it must prove
# the same canonical production target on its own before publishing anything.
require_path "$FRONT_DIR/ops/production-target.json"
require_path "$SCRIPT_DIR/verify-supabase-production-target.mjs"
node "$SCRIPT_DIR/verify-supabase-production-target.mjs" \
  "$ENV_PATH" \
  "$FRONT_DIR/supabase/.temp/project-ref" \
  "$FRONT_DIR/ops/production-target.json"
PINNED_ENV_SHA256=$(node -e '
  const fs = require("fs");
  const crypto = require("crypto");
  process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));
' "$ENV_PATH")
assert_env_unchanged() {
  phase=$1
  current_sha256=$(node -e '
    const fs = require("fs");
    const crypto = require("crypto");
    process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));
  ' "$ENV_PATH")
  if [ "$current_sha256" != "$PINNED_ENV_SHA256" ]; then
    echo "Production environment changed before $phase; refusing to publish." >&2
    exit 1
  fi
  node "$SCRIPT_DIR/verify-supabase-production-target.mjs" \
    "$ENV_PATH" \
    "$FRONT_DIR/supabase/.temp/project-ref" \
    "$FRONT_DIR/ops/production-target.json" >/dev/null
}

echo "Ontology source: $ONTOLOGY_SOURCE_DIR"
echo "Releases root: $RELEASES_ROOT"
echo "Mac worker env: $ENV_PATH"
if [ -n "$RELEASE_ID" ]; then
  echo "Requested prod release: $RELEASE_ID"
else
  echo "Requested prod release: current"
fi

if [ -n "$RELEASE_ID" ]; then
  echo "Verifying target release before promote..."
  run_krw_ontology release verify \
    --root "$TARGET_ROOT" \
    --env prod
fi

CURRENT_RELEASE_ID=""
if [ -f "$RELEASE_ROOT/manifest.json" ]; then
  CURRENT_RELEASE_ID=$(read_manifest_release_id "$RELEASE_ROOT/manifest.json")
fi

if [ -n "$RELEASE_ID" ] && [ "$CURRENT_RELEASE_ID" != "$RELEASE_ID" ]; then
  echo "Refusing to promote prod/current from the data-only deployment path." >&2
  echo "  active:    ${CURRENT_RELEASE_ID:-unknown}" >&2
  echo "  requested: $RELEASE_ID" >&2
  echo "Use a sealed candidate-release cutover that prepares the matching plugin and worker before promotion." >&2
  exit 1
fi

if [ "$DRY_RUN" = "1" ]; then
  if [ -z "$RELEASE_ID" ]; then
    echo "Dry run: would keep the existing prod/current release."
  else
    echo "Dry run: release is already prod/current; would not promote."
  fi
  echo "Dry run: would export the web catalog and publish it to Supabase without restarting prod MCP or Mac workers."
  echo "Dry run target current: $RELEASE_ROOT"
  exit 0
fi

if [ -n "$RELEASE_ID" ]; then
  echo "Release is already prod/current; no promotion required."
fi

echo "Verifying prod/current release..."
run_krw_ontology release verify \
  --root "$RELEASE_ROOT" \
  --env prod \
  --require-current-symlink

MANIFEST_PATH="$RELEASE_ROOT/manifest.json"
require_path "$MANIFEST_PATH"
ACTIVE_RELEASE_ID=$(read_manifest_release_id "$MANIFEST_PATH")

echo "Exporting web catalog from prod/current..."
run_krw_ontology release export-web-catalog \
  --root "$RELEASE_ROOT" \
  --env prod \
  --out "$CATALOG_FILE"

echo "Publishing web catalog to Supabase..."
assert_env_unchanged "web catalog publication"
node "$SCRIPT_DIR/publish-web-catalog.mjs" \
  --file "$CATALOG_FILE" \
  --env-file "$ENV_PATH"

echo "Catalog publication does not restart prod MCP or Mac workers."

echo "Verifying active front web catalog release..."
assert_env_unchanged "web catalog verification"
node "$SCRIPT_DIR/verify-web-catalog-release.mjs" \
  --env prod \
  --release-id "$ACTIVE_RELEASE_ID" \
  --env-file "$ENV_PATH"

echo "Prod data release deployment complete: release_id=$ACTIVE_RELEASE_ID"
