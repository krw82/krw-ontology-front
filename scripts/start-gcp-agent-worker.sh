#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/start-gcp-agent-worker.sh [--dry-run]

Rollback path: start the production GCP agent-worker container again.

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

REMOTE_COMMAND=$(cat <<'EOF'
set -eu
cd "$REMOTE_FRONT_DIR"
docker compose --project-name "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" up -d agent-worker
container=$(docker compose --project-name "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" ps -q agent-worker)
if [ -z "$container" ]; then
  echo "agent-worker container was not created" >&2
  exit 1
fi

attempt=0
while [ "$attempt" -lt 60 ]; do
  health=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container")
  if [ "$health" = "healthy" ] || [ "$health" = "none" ]; then
    break
  fi
  attempt=$((attempt + 1))
  sleep 2
done

docker compose --project-name "$COMPOSE_PROJECT_NAME" --env-file "$ENV_FILE" ps
if [ "$health" != "healthy" ] && [ "$health" != "none" ]; then
  echo "agent-worker did not become healthy: $health" >&2
  exit 1
fi
echo "OK GCP agent-worker running."
EOF
)

echo "Target VM: $GCP_INSTANCE ($GCP_ZONE)"
if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would start GCP agent-worker."
  exit 0
fi

gcloud compute ssh "$GCP_INSTANCE" \
  --zone="$GCP_ZONE" \
  --command="REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR' COMPOSE_PROJECT_NAME='$COMPOSE_PROJECT_NAME' ENV_FILE='$ENV_FILE' sh -s" <<EOF
$REMOTE_COMMAND
EOF
