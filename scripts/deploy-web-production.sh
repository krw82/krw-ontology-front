#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/deploy-web-production.sh [--dry-run]

Sync only the frontend repository to the production VM and rebuild/restart the
web container. The build uses the existing remote ~/krw-ontology source for the
plugin/MCP package.

Environment:
  GCP_INSTANCE          Defaults to krw-onto-v1
  GCP_ZONE              Defaults to asia-northeast3-a
  REMOTE_FRONT_DIR      Defaults to /home/username/krw-ontology-front
  REMOTE_ONTOLOGY_DIR   Defaults to /home/username/krw-ontology
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
GCP_INSTANCE=${GCP_INSTANCE:-krw-onto-v1}
GCP_ZONE=${GCP_ZONE:-asia-northeast3-a}
REMOTE_FRONT_DIR=${REMOTE_FRONT_DIR:-/home/username/krw-ontology-front}
REMOTE_ONTOLOGY_DIR=${REMOTE_ONTOLOGY_DIR:-/home/username/krw-ontology}
DEPLOY_ID=$(date +%Y%m%d%H%M%S)-$$
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/krw-web-deploy.XXXXXX")
FRONT_ARCHIVE="$TMP_DIR/front-$DEPLOY_ID.tar.gz"
REMOTE_FRONT_ARCHIVE="/tmp/front-$DEPLOY_ID.tar.gz"

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

require_command gcloud
require_command tar
require_command curl

test -f "$FRONT_DIR/package.json"
test -f "$FRONT_DIR/scripts/deploy-vm-compose.sh"

echo "Front source: $FRONT_DIR"
echo "Target VM: $GCP_INSTANCE ($GCP_ZONE)"
echo "Remote frontend: $REMOTE_FRONT_DIR"
echo "Remote ontology used for build: $REMOTE_ONTOLOGY_DIR"

(
  cd "$FRONT_DIR"
  COPYFILE_DISABLE=1 tar -czf "$FRONT_ARCHIVE" \
    --exclude './.git' \
    --exclude './.next' \
    --exclude './.next-*' \
    --exclude './.next-e2e' \
    --exclude './node_modules' \
    --exclude './out' \
    --exclude './output' \
    --exclude './.claude' \
    --exclude './.codex' \
    --exclude './.lazyweb' \
    --exclude './.playwright-mcp' \
    --exclude './_workspace' \
    --exclude './.vendor' \
    --exclude './marketing-video' \
    --exclude './krw-ontology' \
    --exclude './.env' \
    --exclude './.env.*' \
    --exclude './.supabase-prod-db-password' \
    --exclude './supabase/.branches' \
    --exclude './supabase/.temp' \
    --exclude './*.tsbuildinfo' \
    --exclude './.DS_Store' \
    --exclude './*/.DS_Store' \
    --exclude './._*' \
    --exclude './*/._*' \
    .
)

echo "Front archive: $(du -h "$FRONT_ARCHIVE" | awk '{print $1}')"

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run complete. No files were uploaded and Docker Compose was not executed."
  exit 0
fi

gcloud compute scp "$FRONT_ARCHIVE" "$GCP_INSTANCE:$REMOTE_FRONT_ARCHIVE" --zone="$GCP_ZONE"

REMOTE_COMMAND=$(cat <<EOF
set -eu
REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR'
REMOTE_ONTOLOGY_DIR='$REMOTE_ONTOLOGY_DIR'
FRONT_ARCHIVE='$REMOTE_FRONT_ARCHIVE'

command -v tar >/dev/null
command -v rsync >/dev/null
command -v docker >/dev/null
test -d "\$REMOTE_ONTOLOGY_DIR"

FRONT_STAGE=\$(mktemp -d /tmp/krw-front-sync.XXXXXX)
cleanup() {
  rm -rf "\$FRONT_STAGE" "\$FRONT_ARCHIVE"
}
trap cleanup EXIT INT TERM

mkdir -p "\$REMOTE_FRONT_DIR"
tar --warning=no-unknown-keyword -xzf "\$FRONT_ARCHIVE" -C "\$FRONT_STAGE"
rsync -a --delete \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.next/' \
  --exclude 'node_modules/' \
  --exclude 'krw-ontology' \
  --exclude 'krw-ontology/' \
  "\$FRONT_STAGE/" "\$REMOTE_FRONT_DIR/"

if [ -L "\$REMOTE_FRONT_DIR/krw-ontology" ]; then
  rm "\$REMOTE_FRONT_DIR/krw-ontology"
elif [ -e "\$REMOTE_FRONT_DIR/krw-ontology" ]; then
  mv "\$REMOTE_FRONT_DIR/krw-ontology" "\$REMOTE_FRONT_DIR/krw-ontology.legacy.\$(date +%Y%m%d%H%M%S)"
fi
ln -s ../krw-ontology "\$REMOTE_FRONT_DIR/krw-ontology"

chmod +x "\$REMOTE_FRONT_DIR/scripts/deploy-vm-compose.sh"
cd "\$REMOTE_FRONT_DIR"
KRW_ONTOLOGY_SOURCE_DIR="\$REMOTE_ONTOLOGY_DIR" scripts/deploy-vm-compose.sh reverse-proxy web llm-gateway redis document-worker document-outbox-dispatcher filings-mcp filing-notification-worker filing-brief-worker billing-worker
docker compose --project-name krw-ontology-front --env-file .env ps
EOF
)

gcloud compute ssh "$GCP_INSTANCE" --zone="$GCP_ZONE" --command="$REMOTE_COMMAND"

echo "Checking production health..."
curl -fsS https://krwontology.com/api/healthz >/dev/null
curl -fsS https://www.krwontology.com/api/healthz >/dev/null
echo "Web deployment complete."
