#!/bin/sh
set -eu

# Let the kernel own the outer lock lifetime. Unlike a mkdir lock, this is
# released automatically after SIGKILL or a reboot. The inner compatibility
# directory remains only as an attestation consumed by child lane scripts.
if [ "${PRODUCTION_OS_LOCK_HELD:-0}" != "1" ]; then
  EARLY_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
  EARLY_FRONT_DIR=$(CDPATH= cd -- "$EARLY_SCRIPT_DIR/.." && pwd -P)
  mkdir -p "$EARLY_FRONT_DIR/.deploy"
  command -v lockf >/dev/null 2>&1 || {
    echo "Missing required macOS lockf command." >&2
    exit 1
  }
  exec env PRODUCTION_OS_LOCK_HELD=1 \
    lockf -t 0 -k "$EARLY_FRONT_DIR/.deploy/production-deploy.os-lock" \
    /bin/sh "$0" "$@"
fi

usage() {
  cat <<'EOF'
Usage: scripts/deploy-with-queue-pause.sh [--dry-run] [--release-id ID] [--skip-worker-restart] [--skip-data] [--skip-code] [--skip-db-check] [--apply-migrations] [--bootstrap-unsealed-mac-runtime] [--bootstrap-unsealed-gcp-runtime] [--recovery-only --recover-cutover ID --recovery-action resume|resume-remote|activate-prepared|abandon-prepared --previous-lock-owner OWNER] [--no-restart-queue] [--queue-timeout SECONDS]

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

Interrupted pre-migration recovery:
  --recovery-only             Refuse to fall through to a normal deployment.
  --recover-cutover ID        Adopt this durable interrupted cutover.
  --recovery-action ACTION    Exact old-runtime resume, GCP-only resume-remote,
                              sealed candidate activate-prepared, or safe
                              pre-pause abandon-prepared.
  --previous-lock-owner OWNER Owner recorded in the durable phase journal.

Bootstrap:
  --bootstrap-unsealed-mac-runtime  One-time immutable Mac transition.
  --bootstrap-unsealed-gcp-runtime  One-time registryless GCP capture.
EOF
}

DRY_RUN=0
RESTART_QUEUE=1
BOOTSTRAP_UNSEALED_MAC_RUNTIME=0
BOOTSTRAP_UNSEALED_GCP_RUNTIME=0
REQUEST_SKIP_DATA=0
REQUEST_SKIP_CODE=0
REQUEST_SKIP_DB_CHECK=0
REQUEST_APPLY_MIGRATIONS=0
RECOVER_CUTOVER_ID=
RECOVERY_ACTION=
PREVIOUS_LOCK_OWNER=
RECOVERY_ONLY=0
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
      REQUEST_SKIP_DATA=1
      DEPLOY_ARGS="$DEPLOY_ARGS --skip-data"
      ;;
    --skip-code)
      REQUEST_SKIP_CODE=1
      DEPLOY_ARGS="$DEPLOY_ARGS --skip-code"
      ;;
    --skip-db-check)
      REQUEST_SKIP_DB_CHECK=1
      DEPLOY_ARGS="$DEPLOY_ARGS --skip-db-check"
      ;;
    --apply-migrations)
      REQUEST_APPLY_MIGRATIONS=1
      DEPLOY_ARGS="$DEPLOY_ARGS --apply-migrations"
      ;;
    --bootstrap-unsealed-mac-runtime)
      BOOTSTRAP_UNSEALED_MAC_RUNTIME=1
      DEPLOY_ARGS="$DEPLOY_ARGS --bootstrap-unsealed-mac-runtime"
      ;;
    --bootstrap-unsealed-gcp-runtime)
      BOOTSTRAP_UNSEALED_GCP_RUNTIME=1
      DEPLOY_ARGS="$DEPLOY_ARGS --bootstrap-unsealed-gcp-runtime"
      ;;
    --recover-cutover)
      RECOVER_CUTOVER_ID=${2:?Missing value for --recover-cutover}
      shift
      ;;
    --recovery-only)
      RECOVERY_ONLY=1
      ;;
    --recovery-action)
      RECOVERY_ACTION=${2:?Missing value for --recovery-action}
      shift
      ;;
    --previous-lock-owner)
      PREVIOUS_LOCK_OWNER=${2:?Missing value for --previous-lock-owner}
      shift
      ;;
    --restart-all)
      echo "--restart-all was removed because prepared activation already recreates and verifies every production application service." >&2
      exit 1
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

if [ "$BOOTSTRAP_UNSEALED_MAC_RUNTIME" = "1" ]; then
  if [ "$REQUEST_SKIP_DATA" = "1" ] || [ "$REQUEST_SKIP_CODE" = "1" ] \
    || [ "$REQUEST_SKIP_DB_CHECK" = "1" ] || [ "$REQUEST_APPLY_MIGRATIONS" != "1" ]; then
    echo "--bootstrap-unsealed-mac-runtime requires the complete code/data/schema cutover." >&2
    exit 1
  fi
fi
if [ "$BOOTSTRAP_UNSEALED_GCP_RUNTIME" = "1" ]; then
  if [ "$REQUEST_SKIP_DATA" = "1" ] || [ "$REQUEST_SKIP_CODE" = "1" ] \
    || [ "$REQUEST_SKIP_DB_CHECK" = "1" ] || [ "$REQUEST_APPLY_MIGRATIONS" != "1" ]; then
    echo "--bootstrap-unsealed-gcp-runtime requires the complete code/data/schema cutover." >&2
    exit 1
  fi
fi
if [ "$RECOVERY_ONLY" = "1" ] || [ -n "$RECOVER_CUTOVER_ID" ] \
  || [ -n "$RECOVERY_ACTION" ] || [ -n "$PREVIOUS_LOCK_OWNER" ]; then
  [ "$RECOVERY_ONLY" = "1" ] || {
    echo "Interrupted recovery is available only through the recovery-only entrypoint." >&2
    exit 1
  }
  [ -n "$RECOVER_CUTOVER_ID" ] && [ -n "$RECOVERY_ACTION" ] && [ -n "$PREVIOUS_LOCK_OWNER" ] || {
    echo "Interrupted recovery requires --recover-cutover, --recovery-action, and --previous-lock-owner together." >&2
    exit 1
  }
  case "$RECOVER_CUTOVER_ID" in ''|*[!A-Za-z0-9._-]*) echo "Invalid recovery cutover id." >&2; exit 1 ;; esac
  case "$RECOVERY_ACTION" in resume|resume-remote|activate-prepared|abandon-prepared) ;; *) echo "Invalid --recovery-action." >&2; exit 1 ;; esac
  [ -z "$DEPLOY_ARGS" ] || {
    echo "Interrupted cutover recovery cannot be combined with normal deploy options." >&2
    exit 1
  }
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
QUEUE_ROOT=${KRW_ONTOLOGY_QUEUE_ROOT:-"$HOME/krw-ontology-data-running"}
ONTOLOGY_SOURCE_DIR=${KRW_ONTOLOGY_SOURCE_DIR:-"$HOME/krw-ontology"}
RELEASES_ROOT=${KRW_ONTOLOGY_RELEASES_ROOT:-"$HOME/krw-ontology-data/releases"}
PROD_CURRENT_ROOT="$RELEASES_ROOT/prod/current"
KRW_ONTOLOGY_CLI=${KRW_ONTOLOGY_CLI:-krw-ontology}
QUEUE_POLL_INTERVAL=${QUEUE_POLL_INTERVAL:-15.0}

QUEUE_WAS_RUNNING=0
QUEUE_STOPPED_BY_SCRIPT=0
DEPLOY_SUCCEEDED=0
WRAPPER_OWNS_DEPLOY_LOCK=0
DEPLOY_LOCK_DIR="$FRONT_DIR/.deploy/production-deploy.lock"
QUEUE_PAUSE_RECEIPT_PATH="$FRONT_DIR/.deploy/queue-pause-receipt.env"
QUEUE_PAUSE_RECEIPT_ACTIVE=0
QUEUE_PAUSE_RECEIPT_CUTOVER_ID=
QUEUE_PAUSE_RECEIPT_LOCK_OWNER=
QUEUE_PAUSE_RECEIPT_RESTART_REQUESTED=
QUEUE_ROOT_CANONICAL=

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

cutover_phase_details() {
  cutover_id=$1
  node - "$FRONT_DIR/.deploy/cutover-phase-$cutover_id.env" "$cutover_id" <<'NODE'
const fs = require("node:fs");
const [phasePath, deploymentId] = process.argv.slice(2);
let stats;
try {
  stats = fs.lstatSync(phasePath);
} catch (error) {
  if (error?.code === "ENOENT") {
    process.stdout.write("absent\n\n\n\n");
    process.exit(0);
  }
  throw error;
}
if (!stats.isFile() || stats.isSymbolicLink()) {
  throw new Error(`Cutover phase must be a regular non-symlink file: ${phasePath}`);
}
const fields = new Map();
for (const raw of fs.readFileSync(phasePath, "utf8").split(/\r?\n/)) {
  if (!raw) continue;
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(raw);
  if (!match || fields.has(match[1]) || /[\r\n\0]/.test(match[2])) {
    throw new Error(`Invalid or duplicate cutover phase field: ${phasePath}`);
  }
  fields.set(match[1], match[2]);
}
if (fields.get("FORMAT") !== "krw-production-cutover-phase/v1" ||
    fields.get("DEPLOYMENT_ID") !== deploymentId ||
    !fields.get("LOCK_OWNER") || !fields.get("ORIGINAL_LOCK_OWNER") ||
    !fields.get("PHASE") || !fields.get("UPDATED_AT")) {
  throw new Error(`Invalid cutover phase provenance: ${phasePath}`);
}
const terminalPhases = new Set([
  "complete",
  "rolled_back",
  "gcp_restored_mac_fail_closed",
  "abandoned_pre_pause",
]);
process.stdout.write([
  terminalPhases.has(fields.get("PHASE")) ? "terminal" : "nonterminal",
  fields.get("PHASE"),
  fields.get("LOCK_OWNER"),
  fields.get("ORIGINAL_LOCK_OWNER"),
  "",
].join("\n"));
NODE
}

read_queue_pause_receipt() {
  node - \
    "$QUEUE_PAUSE_RECEIPT_PATH" \
    "$FRONT_DIR" \
    "$QUEUE_ROOT_CANONICAL" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [receiptPath, expectedFrontRoot, expectedQueueRoot] = process.argv.slice(2);
const stats = fs.lstatSync(receiptPath);
if (!stats.isFile() || stats.isSymbolicLink()) {
  throw new Error(`Queue-pause receipt must be a regular non-symlink file: ${receiptPath}`);
}
const fields = new Map();
for (const raw of fs.readFileSync(receiptPath, "utf8").split(/\r?\n/)) {
  if (!raw) continue;
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(raw);
  if (!match || fields.has(match[1]) || /[\r\n\0]/.test(match[2])) {
    throw new Error("Invalid or duplicate queue-pause receipt field");
  }
  fields.set(match[1], match[2]);
}
const expectedKeys = new Set([
  "FORMAT",
  "FRONT_ROOT",
  "QUEUE_ROOT",
  "CUTOVER_ID",
  "LOCK_OWNER",
  "QUEUE_WAS_RUNNING",
  "RESTART_REQUESTED",
  "CREATED_AT",
]);
if (fields.size !== expectedKeys.size ||
    [...fields.keys()].some((key) => !expectedKeys.has(key))) {
  throw new Error("Queue-pause receipt has unknown or missing fields");
}
if (fields.get("FORMAT") !== "krw-production-queue-pause/v1" ||
    fields.get("FRONT_ROOT") !== expectedFrontRoot ||
    fields.get("QUEUE_ROOT") !== expectedQueueRoot ||
    !/^[A-Za-z0-9._-]+$/.test(fields.get("CUTOVER_ID") ?? "") ||
    !fields.get("LOCK_OWNER") ||
    fields.get("QUEUE_WAS_RUNNING") !== "1" ||
    !/^[01]$/.test(fields.get("RESTART_REQUESTED") ?? "") ||
    Number.isNaN(Date.parse(fields.get("CREATED_AT") ?? ""))) {
  throw new Error("Queue-pause receipt identity or provenance mismatch");
}
for (const key of ["FRONT_ROOT", "QUEUE_ROOT"]) {
  if (!path.isAbsolute(fields.get(key))) {
    throw new Error(`Queue-pause receipt ${key} must be absolute`);
  }
}
process.stdout.write([
  fields.get("CUTOVER_ID"),
  fields.get("LOCK_OWNER"),
  fields.get("RESTART_REQUESTED"),
  "",
].join("\n"));
NODE
}

write_queue_pause_receipt() {
  receipt_cutover_id=$1
  receipt_lock_owner=$2
  receipt_restart_requested=$3
  QUEUE_PAUSE_RECEIPT_DESTINATION="$QUEUE_PAUSE_RECEIPT_PATH" \
  QUEUE_PAUSE_FRONT_ROOT="$FRONT_DIR" \
  QUEUE_PAUSE_QUEUE_ROOT="$QUEUE_ROOT_CANONICAL" \
  QUEUE_PAUSE_CUTOVER_ID="$receipt_cutover_id" \
  QUEUE_PAUSE_LOCK_OWNER="$receipt_lock_owner" \
  QUEUE_PAUSE_RESTART_REQUESTED="$receipt_restart_requested" \
  node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const destination = process.env.QUEUE_PAUSE_RECEIPT_DESTINATION;
const temporary = `${destination}.tmp.${process.pid}`;
for (const [key, value] of Object.entries({
  FRONT_ROOT: process.env.QUEUE_PAUSE_FRONT_ROOT,
  QUEUE_ROOT: process.env.QUEUE_PAUSE_QUEUE_ROOT,
  CUTOVER_ID: process.env.QUEUE_PAUSE_CUTOVER_ID,
  LOCK_OWNER: process.env.QUEUE_PAUSE_LOCK_OWNER,
})) {
  if (!value || /[\r\n\0]/.test(value)) throw new Error(`Invalid queue-pause ${key}`);
}
if (!/^[A-Za-z0-9._-]+$/.test(process.env.QUEUE_PAUSE_CUTOVER_ID ?? "") ||
    !/^[01]$/.test(process.env.QUEUE_PAUSE_RESTART_REQUESTED ?? "")) {
  throw new Error("Invalid queue-pause receipt controls");
}
try {
  fs.lstatSync(destination);
  throw new Error(`Refusing to replace an existing queue-pause receipt: ${destination}`);
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const payload = [
  "FORMAT=krw-production-queue-pause/v1",
  `FRONT_ROOT=${process.env.QUEUE_PAUSE_FRONT_ROOT}`,
  `QUEUE_ROOT=${process.env.QUEUE_PAUSE_QUEUE_ROOT}`,
  `CUTOVER_ID=${process.env.QUEUE_PAUSE_CUTOVER_ID}`,
  `LOCK_OWNER=${process.env.QUEUE_PAUSE_LOCK_OWNER}`,
  "QUEUE_WAS_RUNNING=1",
  `RESTART_REQUESTED=${process.env.QUEUE_PAUSE_RESTART_REQUESTED}`,
  `CREATED_AT=${new Date().toISOString()}`,
  "",
].join("\n");
const fd = fs.openSync(temporary, "wx", 0o400);
try {
  fs.writeFileSync(fd, payload);
  fs.fsyncSync(fd);
} finally {
  fs.closeSync(fd);
}
try {
  // link(2) gives this publication no-replace semantics. The directory fsync
  // makes the receipt durable before the caller is allowed to stop the queue.
  fs.linkSync(temporary, destination);
  const directory = fs.openSync(path.dirname(destination), "r");
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
} finally {
  fs.unlinkSync(temporary);
  const directory = fs.openSync(path.dirname(destination), "r");
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}
NODE
  QUEUE_PAUSE_RECEIPT_ACTIVE=1
  QUEUE_PAUSE_RECEIPT_CUTOVER_ID=$receipt_cutover_id
  QUEUE_PAUSE_RECEIPT_LOCK_OWNER=$receipt_lock_owner
  QUEUE_PAUSE_RECEIPT_RESTART_REQUESTED=$receipt_restart_requested
  QUEUE_WAS_RUNNING=1
  QUEUE_STOPPED_BY_SCRIPT=1
}

consume_queue_pause_receipt() {
  QUEUE_PAUSE_RECEIPT_DESTINATION="$QUEUE_PAUSE_RECEIPT_PATH" \
  QUEUE_PAUSE_FRONT_ROOT="$FRONT_DIR" \
  QUEUE_PAUSE_QUEUE_ROOT="$QUEUE_ROOT_CANONICAL" \
  QUEUE_PAUSE_CUTOVER_ID="$QUEUE_PAUSE_RECEIPT_CUTOVER_ID" \
  QUEUE_PAUSE_LOCK_OWNER="$QUEUE_PAUSE_RECEIPT_LOCK_OWNER" \
  QUEUE_PAUSE_RESTART_REQUESTED="$QUEUE_PAUSE_RECEIPT_RESTART_REQUESTED" \
  node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const destination = process.env.QUEUE_PAUSE_RECEIPT_DESTINATION;
const stats = fs.lstatSync(destination);
if (!stats.isFile() || stats.isSymbolicLink()) {
  throw new Error("Queue-pause receipt changed before consumption");
}
const fields = new Map();
for (const raw of fs.readFileSync(destination, "utf8").split(/\r?\n/)) {
  if (!raw) continue;
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(raw);
  if (!match || fields.has(match[1])) throw new Error("Invalid queue-pause receipt");
  fields.set(match[1], match[2]);
}
const exact = {
  FORMAT: "krw-production-queue-pause/v1",
  FRONT_ROOT: process.env.QUEUE_PAUSE_FRONT_ROOT,
  QUEUE_ROOT: process.env.QUEUE_PAUSE_QUEUE_ROOT,
  CUTOVER_ID: process.env.QUEUE_PAUSE_CUTOVER_ID,
  LOCK_OWNER: process.env.QUEUE_PAUSE_LOCK_OWNER,
  QUEUE_WAS_RUNNING: "1",
  RESTART_REQUESTED: process.env.QUEUE_PAUSE_RESTART_REQUESTED,
};
const expectedKeys = new Set([...Object.keys(exact), "CREATED_AT"]);
if (fields.size !== expectedKeys.size ||
    [...fields.keys()].some((key) => !expectedKeys.has(key)) ||
    Number.isNaN(Date.parse(fields.get("CREATED_AT") ?? ""))) {
  throw new Error("Queue-pause receipt fields changed before consumption");
}
for (const [key, value] of Object.entries(exact)) {
  if (fields.get(key) !== value) throw new Error(`Queue-pause receipt changed: ${key}`);
}
fs.unlinkSync(destination);
const directory = fs.openSync(path.dirname(destination), "r");
try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
NODE
  QUEUE_PAUSE_RECEIPT_ACTIVE=0
  QUEUE_WAS_RUNNING=0
  QUEUE_STOPPED_BY_SCRIPT=0
}

finalize_queue_pause_receipt() {
  [ "$QUEUE_PAUSE_RECEIPT_ACTIVE" = "1" ] || return 0
  phase_details=$(cutover_phase_details "$QUEUE_PAUSE_RECEIPT_CUTOVER_ID") || return 1
  phase_state=$(printf '%s\n' "$phase_details" | sed -n '1p')
  phase_original_lock_owner=$(printf '%s\n' "$phase_details" | sed -n '4p')
  if [ "$phase_state" != "absent" ] \
    && [ "$phase_original_lock_owner" != "$QUEUE_PAUSE_RECEIPT_LOCK_OWNER" ]; then
    echo "Queue-pause receipt lock owner does not match its cutover journal; receipt retained." >&2
    return 1
  fi
  case "$phase_state" in
    absent|terminal) ;;
    nonterminal)
      echo "Queue remains stopped because cutover $QUEUE_PAUSE_RECEIPT_CUTOVER_ID is nonterminal; durable queue-pause receipt retained." >&2
      return 2
      ;;
    *)
      echo "Could not prove queue-pause receipt terminal state; receipt retained." >&2
      return 1
      ;;
  esac
  if [ "$QUEUE_PAUSE_RECEIPT_RESTART_REQUESTED" = "1" ]; then
    if queue_is_running; then
      echo "Queue worker is already running while reconciling the durable pause receipt."
    else
      echo "Restarting queue worker from durable pause receipt..."
      start_queue || return 1
    fi
    queue_is_running || {
      echo "Queue restart was not observable; durable pause receipt retained." >&2
      return 1
    }
    queue_status || true
  fi
  consume_queue_pause_receipt
}

restart_queue_on_exit() {
  exit_code=$?
  queue_restart_failed=0
  trap - EXIT INT TERM

  if [ "$QUEUE_PAUSE_RECEIPT_ACTIVE" = "1" ]; then
    if finalize_queue_pause_receipt; then
      :
    else
      receipt_finalize_status=$?
      if [ "$receipt_finalize_status" -ne 2 ]; then
        queue_restart_failed=1
      elif [ "$exit_code" -eq 0 ]; then
        queue_restart_failed=1
      fi
      if [ "$receipt_finalize_status" -ne 2 ]; then
        queue_restart_failed=1
        echo "Failed to safely finalize the durable queue pause. Receipt retained at:" >&2
        echo "  $QUEUE_PAUSE_RECEIPT_PATH" >&2
      fi
    fi
  elif [ "$RESTART_QUEUE" = "1" ] \
    && [ "$QUEUE_WAS_RUNNING" = "1" ] \
    && [ "$QUEUE_STOPPED_BY_SCRIPT" = "1" ]; then
    # Compatibility fallback for an already-running wrapper process that
    # entered before durable receipt publication was available. New pauses
    # always take the receipt-backed branch above.
    echo "Restarting queue worker..."
    if start_queue; then
      queue_status || true
    else
      queue_restart_failed=1
      echo "Failed to restart queue worker. Start it manually with:" >&2
      echo "  cd '$ONTOLOGY_SOURCE_DIR' && uv run krw-ontology queue start --root '$QUEUE_ROOT' --poll-interval '$QUEUE_POLL_INTERVAL' --no-publish-prod --no-refresh-index" >&2
    fi
  fi

  if [ "$WRAPPER_OWNS_DEPLOY_LOCK" = "1" ]; then
    rm -f "$DEPLOY_LOCK_DIR/owner"
    rmdir "$DEPLOY_LOCK_DIR" 2>/dev/null || true
    WRAPPER_OWNS_DEPLOY_LOCK=0
  fi

  if [ "$exit_code" -ne 0 ]; then
    exit "$exit_code"
  elif [ "$queue_restart_failed" = "1" ]; then
    exit 1
  elif [ "$DEPLOY_SUCCEEDED" = "1" ]; then
    exit 0
  fi
  exit "$exit_code"
}
trap restart_queue_on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

require_command node

# Serialize the entire stop -> deploy -> restart interval. Without this outer
# lock, a losing concurrent wrapper could restart the queue while the winning
# deployment still relies on prod/current remaining fixed.
mkdir -p "$FRONT_DIR/.deploy"
if ! mkdir "$DEPLOY_LOCK_DIR" 2>/dev/null; then
  # Holding production-deploy.os-lock proves no supported mutating entrypoint
  # is live. A remaining mkdir is therefore a crash artifact, not a live lock.
  stale_owner=$(sed -n '1p' "$DEPLOY_LOCK_DIR/owner" 2>/dev/null || echo unknown)
  printf '%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$stale_owner" \
    >>"$FRONT_DIR/.deploy/stale-lock-recovery.log"
  rm -f "$DEPLOY_LOCK_DIR/owner"
  rmdir "$DEPLOY_LOCK_DIR" 2>/dev/null || {
    echo "Stale production lock directory contains unexpected files; manual review required: $DEPLOY_LOCK_DIR" >&2
    exit 1
  }
  mkdir "$DEPLOY_LOCK_DIR"
fi
PRODUCTION_DEPLOY_LOCK_OWNER="queue-wrapper-$$-$(date -u +%Y%m%d%H%M%S)"
printf '%s\n' \
  "$PRODUCTION_DEPLOY_LOCK_OWNER" \
  "host=$(hostname)" \
  "pid=$$" \
  "started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  >"$DEPLOY_LOCK_DIR/owner"
export PRODUCTION_DEPLOY_LOCK_OWNER
WRAPPER_OWNS_DEPLOY_LOCK=1

echo "Queue root: $QUEUE_ROOT"
echo "Ontology source: $ONTOLOGY_SOURCE_DIR"
echo "Stop timeout: $QUEUE_STOP_TIMEOUT_SECONDS seconds"

if ! queue_status_json >/dev/null 2>&1; then
  echo "KRW ontology CLI with 'queue status --json' is required for safe deploy." >&2
  echo "Set KRW_ONTOLOGY_SOURCE_DIR to the current krw-ontology checkout, or update KRW_ONTOLOGY_CLI." >&2
  exit 1
fi

QUEUE_ROOT_CANONICAL=$(node -e '
  const fs = require("node:fs");
  process.stdout.write(fs.realpathSync(process.argv[1]));
' "$QUEUE_ROOT")

if [ -n "$RECOVER_CUTOVER_ID" ]; then
  QUEUE_CUTOVER_ID=$RECOVER_CUTOVER_ID
else
  NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION:-$(date -u +%Y%m%d%H%M%S)-$$}
  case "$NEXT_PUBLIC_APP_VERSION" in
    ''|*[!A-Za-z0-9._-]*)
      echo "NEXT_PUBLIC_APP_VERSION must contain only letters, numbers, dot, underscore, or dash." >&2
      exit 1
      ;;
  esac
  export NEXT_PUBLIC_APP_VERSION
  QUEUE_CUTOVER_ID=$NEXT_PUBLIC_APP_VERSION
fi

QUEUE_RECEIPT_LOCK_OWNER=$PRODUCTION_DEPLOY_LOCK_OWNER
if [ -e "$QUEUE_PAUSE_RECEIPT_PATH" ] || [ -L "$QUEUE_PAUSE_RECEIPT_PATH" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    echo "A durable queue-pause receipt exists; a dry run will not consume or mutate it:" >&2
    echo "  $QUEUE_PAUSE_RECEIPT_PATH" >&2
    exit 1
  fi
  receipt_details=$(read_queue_pause_receipt)
  receipt_cutover_id=$(printf '%s\n' "$receipt_details" | sed -n '1p')
  receipt_lock_owner=$(printf '%s\n' "$receipt_details" | sed -n '2p')
  receipt_restart_requested=$(printf '%s\n' "$receipt_details" | sed -n '3p')
  receipt_phase_details=$(cutover_phase_details "$receipt_cutover_id")
  receipt_phase_state=$(printf '%s\n' "$receipt_phase_details" | sed -n '1p')
  receipt_phase_name=$(printf '%s\n' "$receipt_phase_details" | sed -n '2p')
  receipt_phase_lock_owner=$(printf '%s\n' "$receipt_phase_details" | sed -n '3p')
  receipt_original_lock_owner=$(printf '%s\n' "$receipt_phase_details" | sed -n '4p')
  case "$receipt_phase_state" in
    absent|terminal)
      if [ "$receipt_phase_state" = "terminal" ] \
        && [ "$receipt_lock_owner" != "$receipt_original_lock_owner" ]; then
        echo "Terminal queue-pause receipt is not bound to the cutover's original lock owner." >&2
        exit 1
      fi
      QUEUE_PAUSE_RECEIPT_ACTIVE=1
      QUEUE_PAUSE_RECEIPT_CUTOVER_ID=$receipt_cutover_id
      QUEUE_PAUSE_RECEIPT_LOCK_OWNER=$receipt_lock_owner
      QUEUE_PAUSE_RECEIPT_RESTART_REQUESTED=$receipt_restart_requested
      QUEUE_WAS_RUNNING=1
      QUEUE_STOPPED_BY_SCRIPT=1
      echo "Reconciling durable queue pause for $receipt_cutover_id (${receipt_phase_name:-pre-cutover})."
      if ! finalize_queue_pause_receipt; then
        echo "Could not reconcile the durable queue pause; refusing another deployment." >&2
        exit 1
      fi
      if [ -n "$RECOVER_CUTOVER_ID" ] && [ "$RECOVER_CUTOVER_ID" = "$receipt_cutover_id" ]; then
        echo "Cutover $RECOVER_CUTOVER_ID was already terminal before queue-pause reconciliation."
        DEPLOY_SUCCEEDED=1
        exit 0
      fi
      ;;
    nonterminal)
      [ -n "$RECOVER_CUTOVER_ID" ] || {
        echo "Queue-pause receipt belongs to nonterminal cutover $receipt_cutover_id ($receipt_phase_name)." >&2
        echo "Run the exact recovery-only command before starting a new deployment." >&2
        exit 1
      }
      [ "$RECOVER_CUTOVER_ID" = "$receipt_cutover_id" ] || {
        echo "Recovery cutover does not match durable queue-pause receipt." >&2
        exit 1
      }
      [ "$PREVIOUS_LOCK_OWNER" = "$receipt_phase_lock_owner" ] || {
        echo "Recovery lock owner does not match the durable phase journal." >&2
        exit 1
      }
      [ "$receipt_lock_owner" = "$receipt_original_lock_owner" ] || {
        echo "Queue-pause receipt is not bound to the cutover's original lock owner." >&2
        exit 1
      }
      QUEUE_PAUSE_RECEIPT_ACTIVE=1
      QUEUE_PAUSE_RECEIPT_CUTOVER_ID=$receipt_cutover_id
      QUEUE_PAUSE_RECEIPT_LOCK_OWNER=$receipt_lock_owner
      QUEUE_PAUSE_RECEIPT_RESTART_REQUESTED=$receipt_restart_requested
      QUEUE_WAS_RUNNING=1
      QUEUE_STOPPED_BY_SCRIPT=1
      QUEUE_RECEIPT_LOCK_OWNER=$receipt_original_lock_owner
      echo "Adopting durable queue pause for recovery of $receipt_cutover_id ($receipt_phase_name)."
      ;;
    *)
      echo "Invalid durable queue-pause phase state; refusing deployment." >&2
      exit 1
      ;;
  esac
fi
if [ "$QUEUE_PAUSE_RECEIPT_ACTIVE" != "1" ] && [ -n "$RECOVER_CUTOVER_ID" ]; then
  recovery_phase_details=$(cutover_phase_details "$RECOVER_CUTOVER_ID")
  recovery_phase_state=$(printf '%s\n' "$recovery_phase_details" | sed -n '1p')
  recovery_phase_name=$(printf '%s\n' "$recovery_phase_details" | sed -n '2p')
  recovery_phase_lock_owner=$(printf '%s\n' "$recovery_phase_details" | sed -n '3p')
  recovery_original_lock_owner=$(printf '%s\n' "$recovery_phase_details" | sed -n '4p')
  case "$recovery_phase_state" in
    terminal)
      echo "Cutover $RECOVER_CUTOVER_ID is already terminal ($recovery_phase_name)."
      DEPLOY_SUCCEEDED=1
      exit 0
      ;;
    nonterminal)
      [ "$PREVIOUS_LOCK_OWNER" = "$recovery_phase_lock_owner" ] || {
        echo "Recovery lock owner does not match the durable phase journal." >&2
        exit 1
      }
      QUEUE_RECEIPT_LOCK_OWNER=$recovery_original_lock_owner
      ;;
    absent)
      echo "No durable phase journal exists for recovery cutover $RECOVER_CUTOVER_ID." >&2
      exit 1
      ;;
    *)
      echo "Invalid durable recovery phase state." >&2
      exit 1
      ;;
  esac
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would stop queue, run deploy-all-production.sh, then restart queue without prod publish/index rebuild if it was running."
  queue_status || true
  exit 0
fi

if queue_is_running; then
  if [ "$QUEUE_PAUSE_RECEIPT_ACTIVE" != "1" ]; then
    # This receipt is persisted and fsynced before queue stop. If the wrapper
    # is killed or the host reboots, the next exact recovery can prove whether
    # it should keep the queue paused or restart it after a terminal cutover.
    write_queue_pause_receipt \
      "$QUEUE_CUTOVER_ID" \
      "$QUEUE_RECEIPT_LOCK_OWNER" \
      "$RESTART_QUEUE"
  fi
  echo "Queue worker is running. Requesting graceful stop..."
  if run_krw_ontology queue stop \
    --root "$QUEUE_ROOT" \
    --wait \
    --timeout "$QUEUE_STOP_TIMEOUT_SECONDS"; then
    :
  else
    stop_status=$?
    # Some queue runners can finish the stop operation but return a non-zero
    # status while flushing their own supervisor. The durable receipt is
    # already written; let the authoritative JSON status decide whether it is
    # safe to continue, instead of leaving a stopped worker behind.
    if queue_is_running; then
      echo "Queue stop failed and the worker is still running; refusing deployment." >&2
      exit "$stop_status"
    fi
    echo "Queue stop returned $stop_status after the worker stopped; continuing with verified queue state." >&2
  fi
  QUEUE_STOPPED_BY_SCRIPT=1
else
  if [ "$QUEUE_PAUSE_RECEIPT_ACTIVE" = "1" ]; then
    echo "Queue worker is already stopped under the durable pause receipt."
  else
    echo "Queue worker is already stopped."
  fi
fi

echo "Verifying queue is stopped and safe..."
assert_queue_stopped_and_safe

if [ -n "$RECOVER_CUTOVER_ID" ]; then
  RECOVERY_SNAPSHOT="$FRONT_DIR/.deploy/cutover-$RECOVER_CUTOVER_ID"
  RECOVERY_DRIVER="$RECOVERY_SNAPSHOT/scripts/recover-production-cutover.sh"
  RECOVERY_VERIFIER="$RECOVERY_SNAPSHOT/scripts/verify-prepared-runtime-artifacts.mjs"
  RECOVERY_PAUSE_CONTROLLER="$RECOVERY_SNAPSHOT/scripts/pause-production-cutover.sh"
  RECOVERY_PHASE_FILE="$FRONT_DIR/.deploy/cutover-phase-$RECOVER_CUTOVER_ID.env"
  RECOVERY_SEAL="$RECOVERY_SNAPSHOT/recovery-seal.json"
  # Break the recovery trust-chain cycle with the system Node bootstrap: bind
  # the exact driver, its first verifier, and the pause controller it will exec
  # to the seal digest in the durable phase journal before running snapshot
  # code. This deliberately does not read production-env.path or source env.
  node - \
    "$RECOVERY_PHASE_FILE" \
    "$RECOVERY_SEAL" \
    "$RECOVERY_DRIVER" \
    "$RECOVERY_VERIFIER" \
    "$RECOVERY_PAUSE_CONTROLLER" \
    "$RECOVER_CUTOVER_ID" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const [
  phasePath,
  sealPath,
  driverPath,
  verifierPath,
  pauseControllerPath,
  deploymentId,
] = process.argv.slice(2);
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
for (const file of [
  phasePath,
  sealPath,
  driverPath,
  verifierPath,
  pauseControllerPath,
]) {
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Recovery bootstrap requires a regular non-symlink file: ${file}`);
  }
}
const fields = new Map();
for (const line of fs.readFileSync(phasePath, "utf8").split(/\r?\n/)) {
  if (!line) continue;
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (!match || fields.has(match[1]) || /[\r\n\0]/.test(match[2])) {
    throw new Error("Invalid or duplicate recovery phase field");
  }
  fields.set(match[1], match[2]);
}
if (fields.get("FORMAT") !== "krw-production-cutover-phase/v1" ||
    fields.get("DEPLOYMENT_ID") !== deploymentId) {
  throw new Error("Recovery phase identity mismatch");
}
if (fields.get("RECOVERY_SEAL_PATH") !== sealPath ||
    !/^[a-f0-9]{64}$/.test(fields.get("RECOVERY_SEAL_SHA256") ?? "") ||
    hash(sealPath) !== fields.get("RECOVERY_SEAL_SHA256")) {
  throw new Error("Recovery phase seal binding mismatch");
}
const seal = JSON.parse(fs.readFileSync(sealPath, "utf8"));
if (seal?.format !== "krw-prepared-runtime-artifacts/v1" ||
    !Array.isArray(seal.roots) || !Array.isArray(seal.entries)) {
  throw new Error("Invalid recovery artifact seal");
}
const verifySealedBootstrapFile = (file, label, mustBeExecutable) => {
  const canonicalFile = fs.realpathSync(file);
  if (canonicalFile !== file) throw new Error(`${label} path is not canonical`);
  const matchingRootIndexes = seal.roots
    .map((root, index) => path.resolve(root) === canonicalFile ? index : -1)
    .filter((index) => index >= 0);
  if (matchingRootIndexes.length !== 1) {
    throw new Error(`Recovery seal does not name exactly one ${label} root`);
  }
  const logicalPath = `root-${matchingRootIndexes[0]}`;
  const entries = seal.entries.filter((entry) => entry?.path === logicalPath);
  const actualMode = fs.lstatSync(file).mode & 0o777;
  if (entries.length !== 1 || entries[0].kind !== "file" ||
      !Number.isInteger(entries[0].mode) || entries[0].mode !== actualMode ||
      !/^[a-f0-9]{64}$/.test(entries[0].sha256 ?? "") ||
      (mustBeExecutable && (actualMode & 0o111) === 0) ||
      hash(file) !== entries[0].sha256) {
    throw new Error(`${label} is not exactly bound to the phase-bound seal`);
  }
};
verifySealedBootstrapFile(driverPath, "recovery driver", true);
verifySealedBootstrapFile(verifierPath, "recovery verifier", false);
verifySealedBootstrapFile(pauseControllerPath, "pause controller", true);
NODE
  # Do not read production-env.path here. The phase-bound sealed driver parses
  # and verifies the recovery transaction before any env file can be sourced.
  /bin/sh "$RECOVERY_DRIVER" \
    --front-root "$FRONT_DIR" \
    --cutover-id "$RECOVER_CUTOVER_ID" \
    --action "$RECOVERY_ACTION" \
    --previous-lock-owner "$PREVIOUS_LOCK_OWNER"
  DEPLOY_SUCCEEDED=1
  exit 0
fi

# shellcheck disable=SC2086
/bin/sh "$SCRIPT_DIR/deploy-all-production.sh" $DEPLOY_ARGS
DEPLOY_SUCCEEDED=1
