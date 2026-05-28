#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/deploy-data-release-production.sh [--release-id ID] [--releases-root DIR] [--env-file FILE] [--dry-run] [--skip-worker-restart] [--catalog-file FILE]

Publish the active local prod ontology release to the GCP web control plane and
restart Mac production workers onto the same release.

Flow:
  1. Optionally promote a local immutable release to prod/current.
  2. Verify /releases/prod/current and its manifest/index.
  3. Export a compact web_catalog.json from the release.
  4. Publish the catalog to Supabase and mark it active.
  5. Restart Mac workers and verify heartbeats report the same release_id.

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
SKIP_WORKER_RESTART=0

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
    --skip-worker-restart)
      SKIP_WORKER_RESTART=1
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
  CATALOG_FILE=$(mktemp "${TMPDIR:-/tmp}/krw-web-catalog.XXXXXX.json")
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
}
trap cleanup EXIT INT TERM

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

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would promote release, export web catalog, publish to Supabase, and restart Mac workers."
  echo "Dry run target current: $RELEASE_ROOT"
  exit 0
fi

if [ -n "$RELEASE_ID" ]; then
  echo "Promoting prod release..."
  run_krw_ontology release promote "$RELEASE_ID" \
    --releases-root "$RELEASES_ROOT" \
    --env prod
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
node "$SCRIPT_DIR/publish-web-catalog.mjs" \
  --file "$CATALOG_FILE" \
  --env-file "$ENV_PATH"

if [ "$SKIP_WORKER_RESTART" = "1" ]; then
  echo "Skipping Mac worker restart by request."
else
  echo "Restarting Mac workers and verifying release heartbeat..."
  "$SCRIPT_DIR/deploy-worker-production.sh" \
    --env-file "$ENV_PATH" \
    --release-id "$ACTIVE_RELEASE_ID"
fi

echo "Verifying active front web catalog release..."
node "$SCRIPT_DIR/verify-web-catalog-release.mjs" \
  --env prod \
  --release-id "$ACTIVE_RELEASE_ID" \
  --env-file "$ENV_PATH"

echo "Prod data release deployment complete: release_id=$ACTIVE_RELEASE_ID"
