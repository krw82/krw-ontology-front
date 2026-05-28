#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/deploy-with-queue-pause.sh [--dry-run] [--release-id ID] [--skip-worker-restart] [--skip-data] [--skip-code] [--skip-db-check] [--apply-migrations] [--restart-all] [--no-restart-queue] [--queue-timeout SECONDS]

Gracefully pause the local KRW ontology queue, run production deployment, then
restart the queue if it was running.

This is the safest path when local data, frontend, plugin, and MCP code all
changed and the queue worker may be writing the deploy source.

Environment:
  KRW_ONTOLOGY_QUEUE_ROOT     Defaults to $HOME/krw-ontology-data-running
  KRW_ONTOLOGY_CLI            Defaults to krw-ontology
  QUEUE_STOP_TIMEOUT_SECONDS  Defaults to 7200
  QUEUE_POLL_INTERVAL         Defaults to 15.0
EOF
}

DRY_RUN=0
RESTART_QUEUE=1
QUEUE_STOP_TIMEOUT_SECONDS=${QUEUE_STOP_TIMEOUT_SECONDS:-7200}
DEPLOY_ARGS=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --dry-run)
      DRY_RUN=1
      DEPLOY_ARGS="$DEPLOY_ARGS --dry-run"
      ;;
    --release-id)
      shift
      if [ "$#" -eq 0 ]; then
        usage
        exit 1
      fi
      DEPLOY_ARGS="$DEPLOY_ARGS --release-id $1"
      ;;
    --skip-worker-restart)
      DEPLOY_ARGS="$DEPLOY_ARGS --skip-worker-restart"
      ;;
    --skip-data)
      DEPLOY_ARGS="$DEPLOY_ARGS --skip-data"
      ;;
    --skip-code)
      DEPLOY_ARGS="$DEPLOY_ARGS --skip-code"
      ;;
    --skip-db-check)
      DEPLOY_ARGS="$DEPLOY_ARGS --skip-db-check"
      ;;
    --apply-migrations)
      DEPLOY_ARGS="$DEPLOY_ARGS --apply-migrations"
      ;;
    --restart-all)
      DEPLOY_ARGS="$DEPLOY_ARGS --restart-all"
      ;;
    --no-restart-queue)
      RESTART_QUEUE=0
      ;;
    --queue-timeout)
      shift
      if [ "$#" -eq 0 ]; then
        usage
        exit 1
      fi
      QUEUE_STOP_TIMEOUT_SECONDS=$1
      ;;
    *)
      usage
      exit 1
      ;;
  esac
  shift
done

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
QUEUE_ROOT=${KRW_ONTOLOGY_QUEUE_ROOT:-"$HOME/krw-ontology-data-running"}
KRW_ONTOLOGY_CLI=${KRW_ONTOLOGY_CLI:-krw-ontology}
QUEUE_POLL_INTERVAL=${QUEUE_POLL_INTERVAL:-15.0}

QUEUE_WAS_RUNNING=0
QUEUE_STOPPED_BY_SCRIPT=0
DEPLOY_SUCCEEDED=0

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

queue_status() {
  "$KRW_ONTOLOGY_CLI" queue status --root "$QUEUE_ROOT"
}

queue_is_running() {
  queue_status | grep -q '^Worker: running'
}

assert_queue_stopped_and_idle() {
  status=$(queue_status)
  echo "$status"
  echo "$status" | grep -q '^Worker: stopped'
  echo "$status" | grep -q 'running=0'
}

start_queue() {
  if queue_is_running; then
    echo "Queue worker is already running; not starting another worker."
    return
  fi

  "$KRW_ONTOLOGY_CLI" queue start \
    --root "$QUEUE_ROOT" \
    --poll-interval "$QUEUE_POLL_INTERVAL" \
    --no-publish-prod \
    --no-rebuild-agent-index
}

restart_queue_on_exit() {
  exit_code=$?
  if [ "$RESTART_QUEUE" = "1" ] && [ "$QUEUE_WAS_RUNNING" = "1" ] && [ "$QUEUE_STOPPED_BY_SCRIPT" = "1" ]; then
    echo "Restarting queue worker..."
    if start_queue; then
      queue_status || true
    else
      echo "Failed to restart queue worker. Start it manually with:" >&2
      echo "  $KRW_ONTOLOGY_CLI queue start --root '$QUEUE_ROOT' --poll-interval '$QUEUE_POLL_INTERVAL' --no-publish-prod --no-rebuild-agent-index" >&2
    fi
  fi

  if [ "$DEPLOY_SUCCEEDED" = "1" ]; then
    exit 0
  fi
  exit "$exit_code"
}
trap restart_queue_on_exit EXIT INT TERM

require_command "$KRW_ONTOLOGY_CLI"

echo "Queue root: $QUEUE_ROOT"
echo "Stop timeout: $QUEUE_STOP_TIMEOUT_SECONDS seconds"

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would stop queue, run deploy-all-production.sh, then restart queue without prod publish/index rebuild if it was running."
  queue_status || true
  exit 0
fi

if queue_is_running; then
  QUEUE_WAS_RUNNING=1
  echo "Queue worker is running. Requesting graceful stop..."
  "$KRW_ONTOLOGY_CLI" queue stop \
    --root "$QUEUE_ROOT" \
    --wait \
    --timeout "$QUEUE_STOP_TIMEOUT_SECONDS"
  QUEUE_STOPPED_BY_SCRIPT=1
else
  echo "Queue worker is already stopped."
fi

echo "Verifying queue is stopped and idle..."
assert_queue_stopped_and_idle

# shellcheck disable=SC2086
"$SCRIPT_DIR/deploy-all-production.sh" $DEPLOY_ARGS
DEPLOY_SUCCEEDED=1
