#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/restart-production-compose.sh [--dry-run]

Restart the production GCP web/reverse-proxy services and print their status.
The GCP agent-worker is intentionally excluded because production agent
execution is handled by Mac launchd workers.

Environment:
  GCP_INSTANCE          Defaults to krw-onto-v1
  GCP_ZONE              Defaults to asia-northeast3-a
  REMOTE_FRONT_DIR      Defaults to /home/username/krw-ontology-front
  COMPOSE_PROJECT_NAME  Defaults to krw-ontology-front
  ENV_FILE              Defaults to .env on the VM
EOF
}

DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
  shift
done

GCP_INSTANCE=${GCP_INSTANCE:-krw-onto-v1}
GCP_ZONE=${GCP_ZONE:-asia-northeast3-a}
REMOTE_FRONT_DIR=${REMOTE_FRONT_DIR:-/home/username/krw-ontology-front}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-krw-ontology-front}
ENV_FILE=${ENV_FILE:-.env}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command gcloud

REMOTE_COMMAND=$(cat <<EOF
set -eu
cd '$REMOTE_FRONT_DIR'
docker compose --project-name '$COMPOSE_PROJECT_NAME' --env-file '$ENV_FILE' restart reverse-proxy web
docker compose --project-name '$COMPOSE_PROJECT_NAME' --env-file '$ENV_FILE' ps
EOF
)

echo "Target VM: $GCP_INSTANCE ($GCP_ZONE)"
echo "Remote frontend: $REMOTE_FRONT_DIR"
echo "Compose project: $COMPOSE_PROJECT_NAME"

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would restart reverse-proxy and web on production."
  exit 0
fi

gcloud compute ssh "$GCP_INSTANCE" \
  --zone="$GCP_ZONE" \
  --command="$REMOTE_COMMAND"
