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
  KRW_ONTOLOGY_SOURCE_DIR     Defaults to $HOME/krw-ontology
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
ONTOLOGY_SOURCE_DIR=${KRW_ONTOLOGY_SOURCE_DIR:-"$HOME/krw-ontology"}
RELEASES_ROOT=${KRW_ONTOLOGY_RELEASES_ROOT:-"$HOME/krw-ontology-data/releases"}
PROD_CURRENT_ROOT="$RELEASES_ROOT/prod/current"
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

run_krw_ontology() {
  if command -v uv >/dev/null 2>&1 && [ -f "$ONTOLOGY_SOURCE_DIR/pyproject.toml" ]; then
    (cd "$ONTOLOGY_SOURCE_DIR" && uv run krw-ontology "$@")
  elif [ -x "$ONTOLOGY_SOURCE_DIR/.venv/bin/krw-ontology" ]; then
    "$ONTOLOGY_SOURCE_DIR/.venv/bin/krw-ontology" "$@"
  else
    "$KRW_ONTOLOGY_CLI" "$@"
  fi
}

queue_status() {
  run_krw_ontology queue status --root "$QUEUE_ROOT"
}

queue_status_json() {
  run_krw_ontology queue status --root "$QUEUE_ROOT" --json
}

queue_is_running() {
  status_json=$(queue_status_json)
  QUEUE_STATUS_JSON="$status_json" node <<'NODE'
const status = JSON.parse(process.env.QUEUE_STATUS_JSON || "{}");
process.exit(status.worker && status.worker.state === "running" ? 0 : 1);
NODE
}

assert_queue_stopped_and_safe() {
  queue_status
  status_json=$(queue_status_json)
  QUEUE_STATUS_JSON="$status_json" \
  PROD_CURRENT_ROOT="$PROD_CURRENT_ROOT" \
  node <<'NODE'
const fs = require("fs");
const path = require("path");

const status = JSON.parse(process.env.QUEUE_STATUS_JSON || "{}");
const workerState = status.worker && status.worker.state ? status.worker.state : "unknown";
if (workerState !== "stopped") {
  console.error(`Queue worker must be stopped before deployment. Current state: ${workerState}`);
  process.exit(1);
}

const runningCount = Number(status.counts && status.counts.running ? status.counts.running : 0);
if (runningCount > 0) {
  console.error(
    `Warning: queue has ${runningCount} stale running job(s), but no queue worker process is active. ` +
      "Deployment can continue because no writer is running."
  );
}

function existingRealPath(candidate) {
  try {
    return fs.realpathSync(candidate);
  } catch {
    const parent = path.dirname(candidate);
    try {
      return path.join(fs.realpathSync(parent), path.basename(candidate));
    } catch {
      return path.resolve(candidate);
    }
  }
}

const prodCurrent = path.resolve(process.env.PROD_CURRENT_ROOT || "");
const prodReal = existingRealPath(prodCurrent);
function pointsAtProdCurrent(candidate) {
  if (!candidate) return false;
  const resolved = path.resolve(candidate);
  if (resolved === prodCurrent || resolved.startsWith(prodCurrent + path.sep)) {
    return true;
  }
  const real = existingRealPath(resolved);
  return real === prodReal || real.startsWith(prodReal + path.sep);
}

const risks = [];
for (const root of status.active_publish_roots || []) {
  if (pointsAtProdCurrent(root)) risks.push(`active publish root=${root}`);
}
for (const indexPath of status.active_publish_index_paths || []) {
  if (pointsAtProdCurrent(indexPath)) risks.push(`active publish index path=${indexPath}`);
}
const workerMode = status.worker && status.worker.mode;
if (workerMode && workerMode.publish_prod === true) {
  risks.push("worker mode publish_prod=true");
}

if (risks.length > 0) {
  console.error("Local ontology queue can mutate prod/current. Refusing safe deploy:");
  for (const risk of risks) console.error(`- ${risk}`);
  process.exit(1);
}
NODE
}

start_queue() {
  if queue_is_running; then
    echo "Queue worker is already running; not starting another worker."
    return
  fi

  run_krw_ontology queue start \
    --root "$QUEUE_ROOT" \
    --poll-interval "$QUEUE_POLL_INTERVAL" \
    --no-publish-prod \
    --no-refresh-index
}

restart_queue_on_exit() {
  exit_code=$?
  queue_restart_failed=0
  trap - EXIT INT TERM

  if [ "$RESTART_QUEUE" = "1" ] && [ "$QUEUE_WAS_RUNNING" = "1" ] && [ "$QUEUE_STOPPED_BY_SCRIPT" = "1" ]; then
    echo "Restarting queue worker..."
    if start_queue; then
      queue_status || true
    else
      queue_restart_failed=1
      echo "Failed to restart queue worker. Start it manually with:" >&2
      echo "  cd '$ONTOLOGY_SOURCE_DIR' && uv run krw-ontology queue start --root '$QUEUE_ROOT' --poll-interval '$QUEUE_POLL_INTERVAL' --no-publish-prod --no-refresh-index" >&2
    fi
  fi

  if [ "$exit_code" -ne 0 ]; then
    exit "$exit_code"
  fi
  if [ "$queue_restart_failed" = "1" ]; then
    exit 1
  fi
  if [ "$DEPLOY_SUCCEEDED" = "1" ]; then
    exit 0
  fi
  exit "$exit_code"
}
trap restart_queue_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

require_command node

echo "Queue root: $QUEUE_ROOT"
echo "Ontology source: $ONTOLOGY_SOURCE_DIR"
echo "Stop timeout: $QUEUE_STOP_TIMEOUT_SECONDS seconds"

if ! queue_status_json >/dev/null 2>&1; then
  echo "KRW ontology CLI with 'queue status --json' is required for safe deploy." >&2
  echo "Set KRW_ONTOLOGY_SOURCE_DIR to the current krw-ontology checkout, or update KRW_ONTOLOGY_CLI." >&2
  exit 1
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would stop queue, run deploy-all-production.sh, then restart queue without prod publish/index rebuild if it was running."
  queue_status || true
  exit 0
fi

if queue_is_running; then
  QUEUE_WAS_RUNNING=1
  echo "Queue worker is running. Requesting graceful stop..."
  run_krw_ontology queue stop \
    --root "$QUEUE_ROOT" \
    --wait \
    --timeout "$QUEUE_STOP_TIMEOUT_SECONDS"
  QUEUE_STOPPED_BY_SCRIPT=1
else
  echo "Queue worker is already stopped."
fi

echo "Verifying queue is stopped and safe..."
assert_queue_stopped_and_safe

# shellcheck disable=SC2086
"$SCRIPT_DIR/deploy-all-production.sh" $DEPLOY_ARGS
DEPLOY_SUCCEEDED=1
