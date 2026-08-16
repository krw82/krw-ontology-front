#!/bin/sh
set -eu

# Normal production deploys need one lock, one queue pause, and one restart.
# The legacy sealed cutover orchestrator and its interrupted-cutover recovery
# driver were removed (fix-forward only). This wrapper only retains the
# pre-pause prepared-candidate cleanup and the queue safety checks.
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
Usage: scripts/deploy-production-simple.sh [--dry-run] [--release-id ID] [--skip-worker-restart] [--skip-data] [--skip-code] [--skip-db-check] [--apply-migrations] [--bootstrap-unsealed-mac-runtime] [--bootstrap-unsealed-gcp-runtime] [--no-restart-queue] [--queue-timeout SECONDS]

Emergency pre-pause cleanup only:
  scripts/deploy-production-simple.sh --recover-prepared-local-only

Queue-safe wrapper around a production deploy:
  1. Stop the local ontology queue if it is running.
  2. Verify it cannot write prod/current.
  3. Run the production deployment.
  4. Restart the queue if this script stopped it.

The legacy sealed cutover orchestrator (deploy-all-production.sh) was removed;
production deploys are fix-forward only. Use 'npm run prod:deploy:full' (the
agent-repository controller adapter) or, until the first controller-validated
production deploy, the fast fallback 'npm run prod:deploy:code'.

Slow local browser/PWA checks are deliberately separate:
  npm run prod:preflight
EOF
}

DRY_RUN=0
RESTART_QUEUE=1
RECOVER_PREPARED_LOCAL_ONLY=0
QUEUE_STOP_TIMEOUT_SECONDS=${QUEUE_STOP_TIMEOUT_SECONDS:-7200}
DEPLOY_ARGS="--skip-release-gates"

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
      RELEASE_ID=${2:?Missing value for --release-id}
      case "$RELEASE_ID" in ''|*[!A-Za-z0-9._-]*) echo "Invalid release id." >&2; exit 1 ;; esac
      DEPLOY_ARGS="$DEPLOY_ARGS --release-id $RELEASE_ID"
      shift
      ;;
    --skip-worker-restart|--skip-data|--skip-code|--skip-db-check|--apply-migrations|--bootstrap-unsealed-mac-runtime|--bootstrap-unsealed-gcp-runtime)
      DEPLOY_ARGS="$DEPLOY_ARGS $1"
      ;;
    --no-restart-queue)
      RESTART_QUEUE=0
      ;;
    --recover-prepared-local-only)
      RECOVER_PREPARED_LOCAL_ONLY=1
      ;;
    --queue-timeout)
      QUEUE_STOP_TIMEOUT_SECONDS=${2:?Missing value for --queue-timeout}
      case "$QUEUE_STOP_TIMEOUT_SECONDS" in ''|*[!0-9]*) echo "Queue timeout must be a whole number of seconds." >&2; exit 1 ;; esac
      shift
      ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
  shift
done

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
QUEUE_ROOT=${KRW_ONTOLOGY_QUEUE_ROOT:-"$HOME/krw-ontology-data-running"}
ONTOLOGY_SOURCE_DIR=${KRW_ONTOLOGY_SOURCE_DIR:-"$HOME/krw-ontology"}
RELEASES_ROOT=${KRW_ONTOLOGY_RELEASES_ROOT:-"$HOME/krw-ontology-data/releases"}
PROD_CURRENT_ROOT="$RELEASES_ROOT/prod/current"
KRW_ONTOLOGY_CLI=${KRW_ONTOLOGY_CLI:-krw-ontology}
QUEUE_POLL_INTERVAL=${QUEUE_POLL_INTERVAL:-15.0}
DEPLOY_LOCK_DIR="$FRONT_DIR/.deploy/production-deploy.lock"
QUEUE_WAS_RUNNING=0
QUEUE_STOPPED_BY_SCRIPT=0
DEPLOY_SUCCEEDED=0
LOCK_OWNED=0

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1" >&2
    exit 1
  }
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
  QUEUE_STATUS_JSON="$status_json" PROD_CURRENT_ROOT="$PROD_CURRENT_ROOT" node <<'NODE'
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
  console.error(`Warning: queue has ${runningCount} stale running job(s), but no queue worker process is active.`);
}
function existingRealPath(candidate) {
  try { return fs.realpathSync(candidate); } catch {
    const parent = path.dirname(candidate);
    try { return path.join(fs.realpathSync(parent), path.basename(candidate)); }
    catch { return path.resolve(candidate); }
  }
}
const prodCurrent = path.resolve(process.env.PROD_CURRENT_ROOT || "");
const prodReal = existingRealPath(prodCurrent);
function pointsAtProdCurrent(candidate) {
  if (!candidate) return false;
  const resolved = path.resolve(candidate);
  if (resolved === prodCurrent || resolved.startsWith(prodCurrent + path.sep)) return true;
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
if (status.worker && status.worker.mode && status.worker.mode.publish_prod === true) {
  risks.push("worker mode publish_prod=true");
}
if (risks.length) {
  console.error("Local ontology queue can mutate prod/current. Refusing deploy:");
  for (const risk of risks) console.error(`- ${risk}`);
  process.exit(1);
}
NODE
}

start_queue() {
  if queue_is_running; then
    echo "Queue worker is already running; not starting another worker."
    return 0
  fi
  run_krw_ontology queue start \
    --root "$QUEUE_ROOT" \
    --poll-interval "$QUEUE_POLL_INTERVAL" \
    --no-publish-prod \
    --no-refresh-index
}

# A failure before the schema/runtime pause has not touched the live service.
# Retire that remote candidate automatically so the next ordinary deploy can
# continue. Later phases still require the explicit sealed recovery path.
recover_prepared_local_cutover_if_needed() {
  recovery_record=$(node - "$FRONT_DIR/.deploy" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2];
const terminals = new Set([
  "complete",
  "rolled_back",
  "gcp_restored_mac_fail_closed",
  "abandoned_pre_pause",
]);
const records = [];
for (const name of fs.readdirSync(root).sort()) {
  const match = /^cutover-phase-([A-Za-z0-9._-]+)\.env$/.exec(name);
  if (!match) continue;
  const file = path.join(root, name);
  const fields = new Map();
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line) continue;
    const index = line.indexOf("=");
    if (index <= 0) throw new Error(`Malformed cutover phase record: ${file}`);
    const key = line.slice(0, index);
    if (fields.has(key)) throw new Error(`Duplicate cutover phase field: ${file}`);
    fields.set(key, line.slice(index + 1));
  }
  if (!terminals.has(fields.get("PHASE"))) {
    records.push({
      id: match[1],
      phase: fields.get("PHASE"),
      env: fields.get("PRODUCTION_ENV_PATH"),
      sha: fields.get("PRODUCTION_ENV_SHA256"),
      file,
    });
  }
}
if (records.length === 0) process.exit(0);
if (records.length !== 1 || records[0].phase !== "prepared_local") {
  const summary = records.map(({ id, phase }) => `${id} (${phase || "missing"})`).join(", ");
  throw new Error(`A non-pre-pause cutover needs explicit recovery: ${summary}`);
}
const record = records[0];
if (!record.env || !/^[a-f0-9]{64}$/.test(record.sha || "")) {
  throw new Error("Prepared-local cutover lacks pinned environment provenance");
}
process.stdout.write([record.id, record.env, record.sha, record.file].join("\t"));
NODE
)
  [ -n "$recovery_record" ] || return 0

  if [ "$DRY_RUN" = "1" ]; then
    echo "Dry run: would clean up the unactivated prepared candidate before deployment."
    return 0
  fi

  IFS="$(printf '\t')" read -r recovery_id recovery_env recovery_env_sha recovery_phase_file <<EOF
$recovery_record
EOF
  test -f "$recovery_env" && [ ! -L "$recovery_env" ] || {
    echo "Prepared-local recovery environment is missing or unsafe." >&2
    exit 1
  }
  recovery_admin_sha=$(node "$SCRIPT_DIR/compute-admin-email-set-sha256.mjs" "$recovery_env")
  printf '%s' "$recovery_admin_sha" | grep -Eq '^[a-f0-9]{64}$' || {
    echo "Prepared-local recovery could not determine the pinned admin identity." >&2
    exit 1
  }

  echo "Cleaning up an unactivated prepared candidate ($recovery_id)..."
  PRODUCTION_OS_LOCK_HELD=1 \
  PRODUCTION_DEPLOY_LOCK_OWNER="$PRODUCTION_DEPLOY_LOCK_OWNER" \
  PRODUCTION_ORCHESTRATOR_ATTESTATION="$recovery_id:$PRODUCTION_DEPLOY_LOCK_OWNER" \
  NEXT_PUBLIC_APP_VERSION="$recovery_id" \
  EXPECTED_PREPARED_APP_VERSION="$recovery_id" \
  EXPECTED_PRODUCTION_ENV_SHA256="$recovery_env_sha" \
  EXPECTED_ADMIN_EMAILS_SHA256="$recovery_admin_sha" \
    /bin/sh "$SCRIPT_DIR/deploy-web-production.sh" --abandon-prepared

  RECOVERY_PHASE_FILE="$recovery_phase_file" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const file = process.env.RECOVERY_PHASE_FILE;
const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
const next = lines.map((line) => {
  if (line.startsWith("PHASE=")) return "PHASE=abandoned_pre_pause";
  if (line.startsWith("UPDATED_AT=")) return `UPDATED_AT=${new Date().toISOString()}`;
  return line;
});
if (!next.some((line) => line === "PHASE=abandoned_pre_pause")) {
  throw new Error("Prepared-local phase record has no phase field");
}
const temp = path.join(path.dirname(file), `.${path.basename(file)}.next.${process.pid}`);
fs.writeFileSync(temp, `${next.join("\n")}\n`, { mode: 0o600 });
fs.renameSync(temp, file);
NODE
  if [ "$RECOVER_PREPARED_LOCAL_ONLY" = "1" ]; then
    echo "Cleaned up the unactivated candidate. No deployment will be started."
  else
    echo "Cleaned up the unactivated candidate. Continuing with the normal deploy."
  fi
}

refuse_removed_sealed_cutover() {
  echo "The legacy sealed cutover orchestrator (deploy-all-production.sh) was removed." >&2
  echo "Production deploys are fix-forward only. Use 'npm run prod:deploy:full'" >&2
  echo "(agent-repo controller adapter)." >&2
  exit 1
}

cleanup() {
  exit_code=$?
  trap - EXIT INT TERM
  restart_failed=0
  if [ "$RESTART_QUEUE" = "1" ] && [ "$QUEUE_WAS_RUNNING" = "1" ] && [ "$QUEUE_STOPPED_BY_SCRIPT" = "1" ]; then
    echo "Restarting queue worker..."
    if ! start_queue; then
      restart_failed=1
      echo "Queue restart failed. Start it manually with:" >&2
      echo "  cd '$ONTOLOGY_SOURCE_DIR' && uv run krw-ontology queue start --root '$QUEUE_ROOT' --poll-interval '$QUEUE_POLL_INTERVAL' --no-publish-prod --no-refresh-index" >&2
    fi
  fi
  if [ "$LOCK_OWNED" = "1" ]; then
    rm -f "$DEPLOY_LOCK_DIR/owner"
    rmdir "$DEPLOY_LOCK_DIR" 2>/dev/null || true
  fi
  if [ "$exit_code" -ne 0 ]; then exit "$exit_code"; fi
  if [ "$restart_failed" = "1" ]; then exit 1; fi
  [ "$DEPLOY_SUCCEEDED" = "1" ] && exit 0
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

require_command node
mkdir -p "$FRONT_DIR/.deploy"
if ! mkdir "$DEPLOY_LOCK_DIR" 2>/dev/null; then
  echo "Another deployment or an interrupted cutover is recorded at: $DEPLOY_LOCK_DIR" >&2
  echo "Interrupted cutovers are fix-forward only; inspect the recorded state before redeploying." >&2
  exit 1
fi
LOCK_OWNED=1
PRODUCTION_DEPLOY_LOCK_OWNER="simple-queue-wrapper-$$-$(date -u +%Y%m%d%H%M%S)"
printf '%s\n' "$PRODUCTION_DEPLOY_LOCK_OWNER" "host=$(hostname)" "pid=$$" "started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$DEPLOY_LOCK_DIR/owner"
export PRODUCTION_DEPLOY_LOCK_OWNER

recover_prepared_local_cutover_if_needed

if [ "$RECOVER_PREPARED_LOCAL_ONLY" = "1" ]; then
  echo "Prepared-local recovery check complete. No deployment was started."
  DEPLOY_SUCCEEDED=1
  exit 0
fi

echo "Queue root: $QUEUE_ROOT"
echo "Ontology source: $ONTOLOGY_SOURCE_DIR"
echo "Slow local gates skipped. Run npm run prod:preflight separately when needed."
queue_status_json >/dev/null 2>&1 || {
  echo "KRW ontology CLI with queue status --json is required for a safe deploy." >&2
  exit 1
}

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would stop the queue, run a production deploy, and restart the queue."
  queue_status || true
  refuse_removed_sealed_cutover
fi

if queue_is_running; then
  QUEUE_WAS_RUNNING=1
  echo "Queue worker is running. Requesting graceful stop..."
  run_krw_ontology queue stop --root "$QUEUE_ROOT" --wait --timeout "$QUEUE_STOP_TIMEOUT_SECONDS"
  QUEUE_STOPPED_BY_SCRIPT=1
else
  echo "Queue worker is already stopped."
fi

echo "Verifying queue is stopped and cannot publish prod/current..."
assert_queue_stopped_and_safe

refuse_removed_sealed_cutover
