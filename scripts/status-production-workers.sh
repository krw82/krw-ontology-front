#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/status-production-workers.sh [--env-file FILE] [--skip-gcp]

Print remote GCP Docker Compose status and the local Mac worker environment config.
EOF
}

ENV_FILE=.env.mac-worker.production
SKIP_GCP=0
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE=${2:?Missing value for --env-file}
      shift
      ;;
    --skip-gcp)
      SKIP_GCP=1
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

CANONICAL_TARGET_FILE="$FRONT_DIR/ops/production-target.json"
target_value() {
  node -e '
    const target = require(process.argv[1]);
    const value = target[process.argv[2]];
    if (typeof value !== "string" || !value) process.exit(1);
    process.stdout.write(value);
  ' "$CANONICAL_TARGET_FILE" "$1"
}
GCP_PROJECT=$(target_value gcpProject)
GCP_INSTANCE=$(target_value gcpInstance)
GCP_ZONE=$(target_value gcpZone)
REMOTE_FRONT_DIR=$(target_value remoteFrontDir)
COMPOSE_PROJECT_NAME=$(target_value composeProject)
REMOTE_ENV_FILE=${REMOTE_ENV_FILE:-.env}

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
  KRW_GURU_ADVISOR_PLUGIN_PATH=${KRW_GURU_ADVISOR_PLUGIN_PATH:-"$FRONT_DIR/ref/plugins/prod/krw-guru-advisor"}
  echo
  echo "Local config:"
  echo "  AGENT_SUPERVISOR_ID=${AGENT_SUPERVISOR_ID:-unset}"
  echo "  AGENT_SUPERVISOR_CONCURRENCY=${AGENT_SUPERVISOR_CONCURRENCY:-unset}"
  echo "  AGENT_WORKER_ID=${AGENT_WORKER_ID:-unset}"
  echo "  AGENT_WORKER_ID_PREFIX=${AGENT_WORKER_ID_PREFIX:-unset}"
  echo "  MAC_WORKER_COUNT=${MAC_WORKER_COUNT:-unset}"
  echo "  MAC_WORKER_NICE=${MAC_WORKER_NICE:-unset}"
  echo "  GLOBAL_CONCURRENT_RUN_LIMIT=${GLOBAL_CONCURRENT_RUN_LIMIT:-unset}"
  echo "  AGENT_QUEUE_LISTEN_ENABLED=${AGENT_QUEUE_LISTEN_ENABLED:-unset}"
  echo "  AGENT_QUEUE_RECONCILE_INTERVAL_MS=${AGENT_QUEUE_RECONCILE_INTERVAL_MS:-unset}"
  echo "  AGENT_RUN_CANCEL_LISTEN_ENABLED=${AGENT_RUN_CANCEL_LISTEN_ENABLED:-unset}"
  echo "  AGENT_RUN_CANCEL_RECONCILE_INTERVAL_MS=${AGENT_RUN_CANCEL_RECONCILE_INTERVAL_MS:-unset}"
  echo "  KRW_ONTOLOGY_ROOT=${KRW_ONTOLOGY_ROOT:-unset}"
  echo "  KRW_ONTOLOGY_PLUGIN_PATH=${KRW_ONTOLOGY_PLUGIN_PATH:-unset}"
  echo "  KRW_GURU_ADVISOR_PLUGIN_PATH=${KRW_GURU_ADVISOR_PLUGIN_PATH:-unset}"
else
  echo
  echo "Local env file not found: $ENV_FILE"
fi

if [ "$SKIP_GCP" = "1" ]; then
  exit 0
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "Missing gcloud; skipping GCP status." >&2
  exit 0
fi

echo
echo "GCP Docker Compose status:"
gcloud compute ssh "$GCP_INSTANCE" \
  --project="$GCP_PROJECT" \
  --zone="$GCP_ZONE" \
  --command="cd '$REMOTE_FRONT_DIR' && docker compose --project-name '$COMPOSE_PROJECT_NAME' --env-file '$REMOTE_ENV_FILE' ps"
