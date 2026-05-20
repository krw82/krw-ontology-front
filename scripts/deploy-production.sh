#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/deploy-production.sh [--dry-run]

Sync the latest local frontend and ~/krw-ontology sources to the GCP VM, then
build and restart the Docker Compose deployment on the VM.

Environment:
  GCP_INSTANCE              Defaults to krw-onto-v1
  GCP_ZONE                  Defaults to asia-northeast3-a
  REMOTE_FRONT_DIR          Defaults to /home/username/krw-ontology-front
  REMOTE_ONTOLOGY_DIR       Defaults to /home/username/krw-ontology
  KRW_ONTOLOGY_SOURCE_DIR   Defaults to $HOME/krw-ontology
EOF
}

DRY_RUN=0
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
  shift
fi
if [ "$#" -gt 0 ]; then
  usage
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
ONTOLOGY_SOURCE_DIR=${KRW_ONTOLOGY_SOURCE_DIR:-"$HOME/krw-ontology"}

GCP_INSTANCE=${GCP_INSTANCE:-krw-onto-v1}
GCP_ZONE=${GCP_ZONE:-asia-northeast3-a}
REMOTE_FRONT_DIR=${REMOTE_FRONT_DIR:-/home/username/krw-ontology-front}
REMOTE_ONTOLOGY_DIR=${REMOTE_ONTOLOGY_DIR:-/home/username/krw-ontology}

DEPLOY_ID=$(date +%Y%m%d%H%M%S)-$$
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/krw-ontology-prod-deploy.XXXXXX")
FRONT_ARCHIVE="$TMP_DIR/front-$DEPLOY_ID.tar.gz"
ONTOLOGY_ARCHIVE="$TMP_DIR/ontology-$DEPLOY_ID.tar.gz"
REMOTE_FRONT_ARCHIVE="/tmp/front-$DEPLOY_ID.tar.gz"
REMOTE_ONTOLOGY_ARCHIVE="/tmp/ontology-$DEPLOY_ID.tar.gz"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

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

require_command gcloud
require_command tar
require_command curl

require_path "$FRONT_DIR/package.json"
require_path "$FRONT_DIR/scripts/deploy-vm-compose.sh"
require_path "$ONTOLOGY_SOURCE_DIR/pyproject.toml"
require_path "$ONTOLOGY_SOURCE_DIR/src/krw_ontology"
require_path "$ONTOLOGY_SOURCE_DIR/plugins/krw-ontology"

SKILL_COUNT=$(
  find "$ONTOLOGY_SOURCE_DIR/plugins/krw-ontology/skills" \
    -mindepth 2 -maxdepth 2 -name SKILL.md 2>/dev/null | wc -l | tr -d ' '
)
if [ "$SKILL_COUNT" -lt 1 ]; then
  echo "No plugin skill files found under $ONTOLOGY_SOURCE_DIR/plugins/krw-ontology/skills" >&2
  exit 1
fi

echo "Front source: $FRONT_DIR"
echo "Ontology source: $ONTOLOGY_SOURCE_DIR"
echo "Target VM: $GCP_INSTANCE ($GCP_ZONE)"
echo "Remote frontend: $REMOTE_FRONT_DIR"
echo "Remote ontology: $REMOTE_ONTOLOGY_DIR"
echo "Skill files: $SKILL_COUNT"

(
  cd "$FRONT_DIR"
  COPYFILE_DISABLE=1 tar -czf "$FRONT_ARCHIVE" \
    --exclude './.git' \
    --exclude './.next' \
    --exclude './node_modules' \
    --exclude './out' \
    --exclude './.claude' \
    --exclude './.codex' \
    --exclude './.playwright-mcp' \
    --exclude './_workspace' \
    --exclude './krw-ontology' \
    --exclude './.env' \
    --exclude './.env.*' \
    --exclude './.supabase-prod-db-password' \
    --exclude './supabase/.branches' \
    --exclude './supabase/.temp' \
    --exclude './*.png' \
    --exclude './*.tsbuildinfo' \
    --exclude './.DS_Store' \
    --exclude './*/.DS_Store' \
    --exclude './._*' \
    --exclude './*/._*' \
    .
)

(
  cd "$ONTOLOGY_SOURCE_DIR"
  COPYFILE_DISABLE=1 tar -czf "$ONTOLOGY_ARCHIVE" \
    --exclude './.git' \
    --exclude './.venv' \
    --exclude './.venv311' \
    --exclude './.pytest_cache' \
    --exclude './.ruff_cache' \
    --exclude './__pycache__' \
    --exclude './**/__pycache__' \
    --exclude './*.pyc' \
    --exclude './**/*.pyc' \
    --exclude './.env' \
    --exclude './.env.*' \
    --exclude './html-effectiveness-artifacts' \
    --exclude './.DS_Store' \
    --exclude './*/.DS_Store' \
    --exclude './._*' \
    --exclude './*/._*' \
    .
)

echo "Front archive: $(du -h "$FRONT_ARCHIVE" | awk '{print $1}')"
echo "Ontology archive: $(du -h "$ONTOLOGY_ARCHIVE" | awk '{print $1}')"

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run complete. No files were uploaded and Docker Compose was not executed."
  exit 0
fi

gcloud compute scp "$FRONT_ARCHIVE" "$ONTOLOGY_ARCHIVE" \
  "$GCP_INSTANCE:/tmp/" \
  --zone="$GCP_ZONE"

REMOTE_COMMAND=$(cat <<EOF
set -eu

REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR'
REMOTE_ONTOLOGY_DIR='$REMOTE_ONTOLOGY_DIR'
FRONT_ARCHIVE='$REMOTE_FRONT_ARCHIVE'
ONTOLOGY_ARCHIVE='$REMOTE_ONTOLOGY_ARCHIVE'

require_command() {
  if ! command -v "\$1" >/dev/null 2>&1; then
    echo "Missing required command on server: \$1" >&2
    exit 1
  fi
}

require_command tar
require_command rsync
require_command docker

FRONT_STAGE=\$(mktemp -d /tmp/krw-front-sync.XXXXXX)
ONTOLOGY_STAGE=\$(mktemp -d /tmp/krw-ontology-sync.XXXXXX)
cleanup() {
  rm -rf "\$FRONT_STAGE" "\$ONTOLOGY_STAGE" "\$FRONT_ARCHIVE" "\$ONTOLOGY_ARCHIVE"
}
trap cleanup EXIT INT TERM

mkdir -p "\$REMOTE_FRONT_DIR" "\$REMOTE_ONTOLOGY_DIR"
tar --warning=no-unknown-keyword -xzf "\$FRONT_ARCHIVE" -C "\$FRONT_STAGE"
tar --warning=no-unknown-keyword -xzf "\$ONTOLOGY_ARCHIVE" -C "\$ONTOLOGY_STAGE"

rsync -a --delete \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.next/' \
  --exclude 'node_modules/' \
  --exclude 'krw-ontology' \
  --exclude 'krw-ontology/' \
  "\$FRONT_STAGE/" "\$REMOTE_FRONT_DIR/"

rsync -a --delete \
  --exclude '.git/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.venv/' \
  --exclude '.venv311/' \
  --exclude '.pytest_cache/' \
  --exclude '.ruff_cache/' \
  "\$ONTOLOGY_STAGE/" "\$REMOTE_ONTOLOGY_DIR/"

if [ -L "\$REMOTE_FRONT_DIR/krw-ontology" ]; then
  rm "\$REMOTE_FRONT_DIR/krw-ontology"
elif [ -e "\$REMOTE_FRONT_DIR/krw-ontology" ]; then
  mv "\$REMOTE_FRONT_DIR/krw-ontology" "\$REMOTE_FRONT_DIR/krw-ontology.legacy.\$(date +%Y%m%d%H%M%S)"
fi
ln -s ../krw-ontology "\$REMOTE_FRONT_DIR/krw-ontology"

chmod +x "\$REMOTE_FRONT_DIR/scripts/deploy-vm-compose.sh"
cd "\$REMOTE_FRONT_DIR"
scripts/deploy-vm-compose.sh

docker compose ps --format 'table {{.Name}}\t{{.Service}}\t{{.State}}\t{{.Health}}'
EOF
)

gcloud compute ssh "$GCP_INSTANCE" \
  --zone="$GCP_ZONE" \
  --command="$REMOTE_COMMAND"

echo "Checking production health..."
curl -fsS https://krwontology.com/api/healthz/deep >/dev/null
curl -fsS https://www.krwontology.com/api/healthz/deep >/dev/null
echo "Production health checks passed."
