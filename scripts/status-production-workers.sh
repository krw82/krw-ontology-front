#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/status-production-workers.sh [--env-file FILE] [--skip-gcp]

Print local Mac supervisor process status and remote GCP Docker Compose status.
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

GCP_INSTANCE=${GCP_INSTANCE:-krw-onto-v1}
GCP_ZONE=${GCP_ZONE:-asia-northeast3-a}
REMOTE_FRONT_DIR=${REMOTE_FRONT_DIR:-/home/username/krw-ontology-front}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-krw-ontology-front}
REMOTE_ENV_FILE=${REMOTE_ENV_FILE:-.env}

echo "Local Mac worker/supervisor processes:"
ps eww -axo pid,etime,nice,command \
  | awk '
    /[.]worker\/agent-worker[.]mjs/ && !/awk/ {
      worker_id = "unknown";
      if (match($0, /AGENT_WORKER_ID=[^ ]+/)) {
        worker_id = substr($0, RSTART + 16, RLENGTH - 16);
      }
      printf "  pid=%s etime=%s nice=%s worker_id=%s\n", $1, $2, $3, worker_id;
    }
  ' \
  || true

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
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
  echo "  NEWS_CARD_TRANSLATION_PROVIDER=${NEWS_CARD_TRANSLATION_PROVIDER:-unset}"
  echo "  NEWS_TRANSLATION_PYTHON=${NEWS_TRANSLATION_PYTHON:-unset}"
  echo "  NEWS_TRANSLATION_TIMEOUT_MS=${NEWS_TRANSLATION_TIMEOUT_MS:-unset}"
  echo "  KRW_ONTOLOGY_ROOT=${KRW_ONTOLOGY_ROOT:-unset}"
  echo "  KRW_ONTOLOGY_PLUGIN_PATH=${KRW_ONTOLOGY_PLUGIN_PATH:-unset}"

  echo
  echo "News translation readiness:"
  (cd "$FRONT_DIR" && node scripts/verify-news-translation.mjs)
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
  --zone="$GCP_ZONE" \
  --command="cd '$REMOTE_FRONT_DIR' && docker compose --project-name '$COMPOSE_PROJECT_NAME' --env-file '$REMOTE_ENV_FILE' ps"
