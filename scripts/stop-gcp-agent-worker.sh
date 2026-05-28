#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/stop-gcp-agent-worker.sh [--dry-run]

Stop only the production GCP agent-worker container. Web/API/reverse-proxy stay
up so krwontology.com can continue serving UI and enqueueing work for the Mac
worker.

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

GCP_INSTANCE=${GCP_INSTANCE:-krw-onto-v1}
GCP_ZONE=${GCP_ZONE:-asia-northeast3-a}
REMOTE_FRONT_DIR=${REMOTE_FRONT_DIR:-/home/username/krw-ontology-front}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-krw-ontology-front}
ENV_FILE=${ENV_FILE:-.env}

if ! command -v gcloud >/dev/null 2>&1; then
  echo "Missing required command: gcloud" >&2
  exit 1
fi

REMOTE_COMMAND=$(cat <<EOF
set -eu
cd '$REMOTE_FRONT_DIR'
docker compose --project-name '$COMPOSE_PROJECT_NAME' --env-file '$ENV_FILE' stop agent-worker
docker compose --project-name '$COMPOSE_PROJECT_NAME' --env-file '$ENV_FILE' ps
running=\$(docker compose --project-name '$COMPOSE_PROJECT_NAME' --env-file '$ENV_FILE' ps --status running --services | grep -x 'agent-worker' || true)
if [ -n "\$running" ]; then
  echo "agent-worker is still running after stop" >&2
  exit 1
fi
echo "OK GCP agent-worker stopped."
EOF
)

echo "Target VM: $GCP_INSTANCE ($GCP_ZONE)"
if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would stop GCP agent-worker only."
  exit 0
fi

gcloud compute ssh "$GCP_INSTANCE" --zone="$GCP_ZONE" --command="$REMOTE_COMMAND"
