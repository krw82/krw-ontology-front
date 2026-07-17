#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/deploy-pulse-filings-overlay-production.sh [--dry-run]

Deploy only the Pulse, SEC filings, filing-brief, and internal filings-MCP
runtime paths. Unlike the full web deploy, this is a non-destructive overlay:
it never uses rsync --delete and does not copy unrelated dirty-worktree files.

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
  usage >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
GCP_INSTANCE=${GCP_INSTANCE:-krw-onto-v1}
GCP_ZONE=${GCP_ZONE:-asia-northeast3-a}
REMOTE_FRONT_DIR=${REMOTE_FRONT_DIR:-/home/username/krw-ontology-front}
REMOTE_ONTOLOGY_DIR=${REMOTE_ONTOLOGY_DIR:-/home/username/krw-ontology}
DEPLOY_ID=$(date +%Y%m%d%H%M%S)-$$
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/krw-pulse-filings-deploy.XXXXXX")
OVERLAY_ARCHIVE="$TMP_DIR/pulse-filings-$DEPLOY_ID.tar.gz"
REMOTE_OVERLAY_ARCHIVE="/tmp/pulse-filings-$DEPLOY_ID.tar.gz"

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
  if [ ! -e "$FRONT_DIR/$1" ]; then
    echo "Missing overlay path: $1" >&2
    exit 1
  fi
}

require_command gcloud
require_command tar
require_command curl

set -- \
  .dockerignore \
  Dockerfile.mcp \
  Dockerfile.web \
  docker-compose.yml \
  package.json \
  package-lock.json \
  scripts/deploy-vm-compose.sh \
  scripts/mac-worker-preflight.sh \
  scripts/materialize-ontology-plugin.mjs \
  scripts/restart-production-compose.sh \
  scripts/verify-filings-mcp-production.sh \
  services/llm-gateway/src/server.ts \
  src/app/api/filing-notifications \
  src/app/api/filings \
  src/app/api/healthz/deep \
  src/app/api/out/filings \
  src/app/api/pulse \
  src/app/api/sessions \
  src/app/chat/ChatPageClient.tsx \
  src/app/filings \
  src/app/pulse \
  src/components/TopNav.tsx \
  src/components/filings \
  src/components/pulse \
  src/filings-mcp \
  src/lib/agent/job-runner.ts \
  src/lib/agent/mcp-client.ts \
  src/lib/agent/runner.ts \
  src/lib/agent/system-prompt.ts \
  src/lib/api/chat/resolve-session.ts \
  src/lib/api/chat/run-agent.ts \
  src/lib/chat/research-status.ts \
  src/lib/filing-briefs \
  src/lib/filing-notifications \
  src/lib/navigation/workspace-routes.ts \
  src/lib/ontology/catalog.ts \
  src/lib/pulse \
  src/types/api-contracts.ts \
  src/types/database.ts \
  src/types/fast-xml-parser.d.ts \
  src/worker/filing-brief-worker.ts \
  src/worker/filing-notification-worker.ts \
  src/worker/filings \
  src/worker/filings-mcp-server.ts

for overlay_path in "$@"; do
  require_path "$overlay_path"
done

echo "Overlay source: $FRONT_DIR"
echo "Target VM: $GCP_INSTANCE ($GCP_ZONE)"
echo "Remote frontend: $REMOTE_FRONT_DIR"
echo "Runtime paths: $#"

tar -czf "$OVERLAY_ARCHIVE" -C "$FRONT_DIR" "$@"
echo "Overlay archive: $(du -h "$OVERLAY_ARCHIVE" | awk '{print $1}')"

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run complete. No files were uploaded and Docker Compose was not executed."
  exit 0
fi

gcloud compute scp "$OVERLAY_ARCHIVE" "$GCP_INSTANCE:$REMOTE_OVERLAY_ARCHIVE" --zone="$GCP_ZONE"

REMOTE_COMMAND=$(cat <<EOF
set -eu
REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR'
REMOTE_ONTOLOGY_DIR='$REMOTE_ONTOLOGY_DIR'
OVERLAY_ARCHIVE='$REMOTE_OVERLAY_ARCHIVE'

command -v tar >/dev/null
command -v rsync >/dev/null
command -v docker >/dev/null
test -d "\$REMOTE_FRONT_DIR"
test -d "\$REMOTE_ONTOLOGY_DIR"

OVERLAY_STAGE=\$(mktemp -d /tmp/krw-pulse-filings-overlay.XXXXXX)
cleanup() {
  rm -rf "\$OVERLAY_STAGE" "\$OVERLAY_ARCHIVE"
}
trap cleanup EXIT INT TERM

tar --warning=no-unknown-keyword -xzf "\$OVERLAY_ARCHIVE" -C "\$OVERLAY_STAGE"
rsync -a "\$OVERLAY_STAGE/" "\$REMOTE_FRONT_DIR/"

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

echo "Checking production web health..."
curl -fsS https://krwontology.com/api/healthz >/dev/null
curl -fsS https://www.krwontology.com/api/healthz >/dev/null
echo "Pulse/filings overlay deployment complete."
