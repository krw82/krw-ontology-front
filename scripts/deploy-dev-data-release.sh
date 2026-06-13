#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/deploy-dev-data-release.sh [--release-id ID] [--releases-root DIR] [--env-file FILE] [--dry-run] [--catalog-file FILE]

Publish the active local dev ontology release to the local Supabase web catalog.

Flow:
  1. Optionally promote a local immutable release to dev/current.
  2. Verify /releases/dev/current and its manifest/index.
  3. Export a compact web_catalog.json from the release.
  4. Publish the catalog to local Supabase and mark it active for env=dev.

This does not deploy GCP web code, restart production workers, or upload the
full SQLite index. The full index stays in the local dev release root.
EOF
}

ENV_FILE=.env
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

read_env_value() {
  node - "$ENV_PATH" "$1" <<'NODE'
const fs = require("fs");
const [file, key] = process.argv.slice(2);
const text = fs.readFileSync(file, "utf8");
for (const rawLine of text.split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const equalsIndex = line.indexOf("=");
  const name = line.slice(0, equalsIndex).trim();
  if (name !== key) continue;
  let value = line.slice(equalsIndex + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  process.stdout.write(value);
  process.exit(0);
}
NODE
}

ensure_local_supabase_env() {
  supabase_url=$(read_env_value SUPABASE_URL)
  if [ -z "$supabase_url" ]; then
    supabase_url=$(read_env_value NEXT_PUBLIC_SUPABASE_URL)
  fi
  if [ -z "$supabase_url" ]; then
    echo "Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL in dev env file: $ENV_PATH" >&2
    exit 1
  fi

  case "$supabase_url" in
    http://localhost:*|http://127.0.0.1:*|http://0.0.0.0:*|http://\[::1\]:*)
      ;;
    *)
      if [ "${KRW_DEV_ALLOW_REMOTE_SUPABASE:-0}" != "1" ]; then
        echo "Refusing dev catalog publish to non-local Supabase URL from $ENV_PATH" >&2
        echo "Set KRW_DEV_ALLOW_REMOTE_SUPABASE=1 only if this is intentional." >&2
        exit 1
      fi
      ;;
  esac

  if [ -z "$(read_env_value SUPABASE_SERVICE_ROLE_KEY)" ]; then
    echo "Missing SUPABASE_SERVICE_ROLE_KEY in dev env file: $ENV_PATH" >&2
    exit 1
  fi
}

require_command node
require_path "$ENV_PATH"
require_path "$ONTOLOGY_SOURCE_DIR/pyproject.toml"
require_path "$ONTOLOGY_SOURCE_DIR/src/krw_ontology"
require_path "$RELEASES_ROOT/dev"
require_path "$SCRIPT_DIR/publish-web-catalog.mjs"
require_path "$SCRIPT_DIR/verify-web-catalog-release.mjs"
ensure_local_supabase_env

RELEASE_ROOT="$RELEASES_ROOT/dev/current"
TARGET_ROOT=""
if [ -n "$RELEASE_ID" ]; then
  TARGET_ROOT="$RELEASES_ROOT/dev/$RELEASE_ID"
  require_path "$TARGET_ROOT"
fi

if [ -z "$CATALOG_FILE" ]; then
  CATALOG_FILE="$(mktemp "${TMPDIR:-/tmp}/krw-dev-web-catalog.XXXXXX")"
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
}
trap cleanup EXIT INT TERM

echo "Ontology source: $ONTOLOGY_SOURCE_DIR"
echo "Releases root: $RELEASES_ROOT"
echo "Dev Supabase env: $ENV_PATH"
if [ -n "$RELEASE_ID" ]; then
  echo "Requested dev release: $RELEASE_ID"
else
  echo "Requested dev release: current"
fi

if [ -n "$RELEASE_ID" ]; then
  echo "Verifying target dev release before promote..."
  run_krw_ontology release verify \
    --root "$TARGET_ROOT" \
    --env dev
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would promote dev release if requested, export web catalog, and publish to local Supabase."
  echo "Dry run target current: $RELEASE_ROOT"
  exit 0
fi

if [ -n "$RELEASE_ID" ]; then
  echo "Promoting dev release..."
  run_krw_ontology release promote "$RELEASE_ID" \
    --releases-root "$RELEASES_ROOT" \
    --env dev
fi

echo "Verifying dev/current release..."
run_krw_ontology release verify \
  --root "$RELEASE_ROOT" \
  --env dev \
  --require-current-symlink

MANIFEST_PATH="$RELEASE_ROOT/manifest.json"
require_path "$MANIFEST_PATH"
ACTIVE_RELEASE_ID=$(read_manifest_release_id "$MANIFEST_PATH")

echo "Exporting web catalog from dev/current..."
run_krw_ontology release export-web-catalog \
  --root "$RELEASE_ROOT" \
  --env dev \
  --out "$CATALOG_FILE"

echo "Publishing dev web catalog to local Supabase..."
node "$SCRIPT_DIR/publish-web-catalog.mjs" \
  --file "$CATALOG_FILE" \
  --env-file "$ENV_PATH"

echo "Verifying active dev web catalog release..."
node "$SCRIPT_DIR/verify-web-catalog-release.mjs" \
  --env dev \
  --release-id "$ACTIVE_RELEASE_ID" \
  --env-file "$ENV_PATH"

echo "Dev data catalog publish complete: release_id=$ACTIVE_RELEASE_ID"
