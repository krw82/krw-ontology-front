#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/drain-document-workers-for-migration.sh [--dry-run]

Gracefully stop the remote document-worker and document-outbox-dispatcher before
applying a document-ingestion database migration. The following compose deploy
starts the v2 worker binaries again.

Environment:
  GCP_INSTANCE                 Defaults to krw-onto-v3
  GCP_ZONE                     Defaults to asia-northeast3-a
  REMOTE_FRONT_DIR             Defaults to /home/username/krw-ontology-front
  COMPOSE_PROJECT_NAME         Defaults to krw-ontology-front
  ENV_FILE                     Defaults to .env on the VM
  DOCUMENT_WORKER_DRAIN_TIMEOUT_SECONDS
                               Defaults to 120
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

GCP_INSTANCE=${GCP_INSTANCE:-krw-onto-v3}
GCP_ZONE=${GCP_ZONE:-asia-northeast3-a}
REMOTE_FRONT_DIR=${REMOTE_FRONT_DIR:-/home/username/krw-ontology-front}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-krw-ontology-front}
ENV_FILE=${ENV_FILE:-.env}
DOCUMENT_WORKER_DRAIN_TIMEOUT_SECONDS=${DOCUMENT_WORKER_DRAIN_TIMEOUT_SECONDS:-120}

case "$DOCUMENT_WORKER_DRAIN_TIMEOUT_SECONDS" in
  ''|*[!0-9]*)
    echo "DOCUMENT_WORKER_DRAIN_TIMEOUT_SECONDS must be a positive integer" >&2
    exit 1
    ;;
esac
if [ "$DOCUMENT_WORKER_DRAIN_TIMEOUT_SECONDS" -lt 1 ]; then
  echo "DOCUMENT_WORKER_DRAIN_TIMEOUT_SECONDS must be at least 1" >&2
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "Missing required command: gcloud" >&2
  exit 1
fi

echo "Document-worker migration drain target: $GCP_INSTANCE ($GCP_ZONE)"
echo "Remote frontend: $REMOTE_FRONT_DIR"

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would stop and verify document-worker and document-outbox-dispatcher before DB migration."
  exit 0
fi

REMOTE_COMMAND=$(cat <<EOF
set -eu
cd '$REMOTE_FRONT_DIR'
docker compose --project-name '$COMPOSE_PROJECT_NAME' --env-file '$ENV_FILE' stop --timeout '$DOCUMENT_WORKER_DRAIN_TIMEOUT_SECONDS' document-worker document-outbox-dispatcher

for service in document-worker document-outbox-dispatcher; do
  container=\$(docker compose --project-name '$COMPOSE_PROJECT_NAME' --env-file '$ENV_FILE' ps -q "\$service")
  if [ -n "\$container" ]; then
    state=\$(docker inspect --format '{{.State.Status}}' "\$container")
    if [ "\$state" = "running" ] || [ "\$state" = "restarting" ]; then
      echo "\$service is still active after graceful drain (state=\$state)" >&2
      exit 1
    fi
  fi
done

docker compose --project-name '$COMPOSE_PROJECT_NAME' --env-file '$ENV_FILE' ps document-worker document-outbox-dispatcher
echo "OK document workers are stopped; apply migration before starting the new compose deployment."
EOF
)

gcloud compute ssh "$GCP_INSTANCE" \
  --zone="$GCP_ZONE" \
  --command="$REMOTE_COMMAND"
