#!/bin/sh
set -eu

# A direct dry run still publishes a short-lived owner attestation for its
# child lanes. Hold the same kernel lock as a mutating orchestrator so another
# wrapper cannot replace that attestation while the dry-run process is using
# it. The lock is released by the kernel after any exit, including SIGKILL.
if [ "${PRODUCTION_OS_LOCK_HELD:-0}" != "1" ]; then
  REQUESTS_DRY_RUN_LOCK=0
  for argument in "$@"; do
    if [ "$argument" = "--dry-run" ]; then
      REQUESTS_DRY_RUN_LOCK=1
      break
    fi
  done
  if [ "$REQUESTS_DRY_RUN_LOCK" = "1" ]; then
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
fi

usage() {
  cat <<'EOF'
Usage: scripts/deploy-all-production.sh [--dry-run] [--release-id ID] [--skip-worker-restart] [--skip-data] [--skip-code] [--skip-db-check] [--apply-migrations] [--skip-release-gates] [--bootstrap-unsealed-mac-runtime] [--bootstrap-unsealed-gcp-runtime]

Deploy data, GCP web/API, and Mac worker plugin/MCP changes to production.

Order:
  1. Supabase migration drift check, unless skipped.
  2. Run every local release gate.
  3. Local prod release catalog publish. When code is also deployed, defer the
     Mac runtime restart to the final plugin/worker step so its plugin and MCP
     fingerprints are updated atomically.
  4. Prebuild and seal the exact GCP and Mac runtime artifacts against the
     active data release. No production process is restarted in this phase.
  5. If migrations are pending, pause old web/workers, apply migrations, and
     run the schema smoke test while old code remains stopped.
  6. Ensure old application runtimes are paused, activate the already prepared
     GCP image and Mac artifacts, then verify production health.

By default the script refuses to deploy when local migrations are not already
applied. Pass --apply-migrations to run `supabase db push` before the smoke test.

`--skip-release-gates` keeps the production cutover focused on deployment.
Run `npm run prod:preflight` separately for the slow local typecheck, build,
and browser/PWA checks.

Data deployment publishes only the compact web catalog to Supabase. Full
ontology SQLite data stays on the Mac worker release root.

--bootstrap-unsealed-mac-runtime is an explicit one-time full-cutover bridge
for the legacy mutable Mac launchd runtime. It has no exact Mac rollback: after
the old Mac services stop, any failure leaves Mac stopped and restores only the
sealed pre-cutover GCP runtime when the schema boundary has not been crossed.

--bootstrap-unsealed-gcp-runtime explicitly authorizes one registryless GCP
capture. It still seals the exact running source, env, images, and service
topology for rollback; an incomplete prior registry is never accepted.
EOF
}

DRY_RUN=0
DEPLOY_DATA=1
DEPLOY_CODE=1
DB_CHECK=1
APPLY_MIGRATIONS=0
SKIP_DATA_RUNTIME_RESTART=0
DATA_ARGS=""
REQUESTED_RELEASE_ID=""
UNSEALED_MAC_BOOTSTRAP=0
UNSEALED_GCP_BOOTSTRAP=0
SKIP_RELEASE_GATES=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --dry-run)
      DRY_RUN=1
      DATA_ARGS="$DATA_ARGS --dry-run"
      ;;
    --replace-remote-data)
      echo "--replace-remote-data was removed. Full ontology SQLite data stays on the Mac worker v3 release root." >&2
      exit 1
      ;;
    --skip-prune)
      echo "--skip-prune was removed with the GCP ontology data upload path." >&2
      exit 1
      ;;
    --release-id)
      REQUESTED_RELEASE_ID=${2:?Missing value for --release-id}
      DATA_ARGS="$DATA_ARGS --release-id $REQUESTED_RELEASE_ID"
      shift
      ;;
    --skip-worker-restart)
      DATA_ARGS="$DATA_ARGS --skip-worker-restart"
      SKIP_DATA_RUNTIME_RESTART=1
      ;;
    --skip-data)
      DEPLOY_DATA=0
      ;;
    --skip-code)
      DEPLOY_CODE=0
      ;;
    --skip-db-check)
      DB_CHECK=0
      ;;
    --apply-migrations)
      APPLY_MIGRATIONS=1
      ;;
    --skip-release-gates)
      SKIP_RELEASE_GATES=1
      ;;
    --bootstrap-unsealed-mac-runtime)
      UNSEALED_MAC_BOOTSTRAP=1
      ;;
    --bootstrap-unsealed-gcp-runtime)
      UNSEALED_GCP_BOOTSTRAP=1
      ;;
    --restart-all)
      echo "--restart-all was removed: prepared activation already recreates and health-checks every production application service." >&2
      exit 1
      ;;
    *)
      usage
      exit 1
      ;;
  esac
  shift
done

if [ "$UNSEALED_MAC_BOOTSTRAP" = "1" ]; then
  if [ "$DEPLOY_CODE" != "1" ] || [ "$DEPLOY_DATA" != "1" ] \
    || [ "$DB_CHECK" != "1" ] || [ "$APPLY_MIGRATIONS" != "1" ]; then
    echo "--bootstrap-unsealed-mac-runtime is valid only for the complete code/data/schema cutover." >&2
    exit 1
  fi
fi
if [ "$UNSEALED_GCP_BOOTSTRAP" = "1" ]; then
  if [ "$DEPLOY_CODE" != "1" ] || [ "$DEPLOY_DATA" != "1" ] \
    || [ "$DB_CHECK" != "1" ] || [ "$APPLY_MIGRATIONS" != "1" ]; then
    echo "--bootstrap-unsealed-gcp-runtime is valid only for the complete code/data/schema cutover." >&2
    exit 1
  fi
fi

# A catalog publish can safely precede the frontend/plugin deployment, but a
# Mac worker restart cannot: it would boot the current worker against a stale
# plugin while the MCP/runtime fingerprints have already changed. The plugin
# lane below materializes the plugin, restarts both MCPs, and then starts the
# worker, so it is the one authoritative restart point for a combined deploy.
if [ "$DEPLOY_DATA" = "1" ] && [ "$DEPLOY_CODE" = "1" ] && [ "$SKIP_DATA_RUNTIME_RESTART" = "0" ]; then
  DATA_ARGS="$DATA_ARGS --skip-worker-restart"
  SKIP_DATA_RUNTIME_RESTART=1
  echo "Deferring Mac runtime restart until the final plugin/worker deployment step."
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
PRODUCTION_ENV_PATH=${PRODUCTION_ENV_PATH:-"$FRONT_DIR/.env.mac-worker.production"}

mkdir -p "$FRONT_DIR/.deploy"
DEPLOY_LOCK_DIR="$FRONT_DIR/.deploy/production-deploy.lock"
ORCHESTRATOR_OWNS_DEPLOY_LOCK=0
release_deploy_lock() {
  if [ "$ORCHESTRATOR_OWNS_DEPLOY_LOCK" = "1" ]; then
    recorded_owner=$(sed -n '1p' "$DEPLOY_LOCK_DIR/owner" 2>/dev/null || true)
    if [ -z "$recorded_owner" ] \
      || [ "$recorded_owner" = "${PRODUCTION_DEPLOY_LOCK_OWNER:-}" ]; then
      rm -f "$DEPLOY_LOCK_DIR/owner"
      rmdir "$DEPLOY_LOCK_DIR" 2>/dev/null || true
    fi
    ORCHESTRATOR_OWNS_DEPLOY_LOCK=0
  fi
}
trap release_deploy_lock EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ -n "${PRODUCTION_DEPLOY_LOCK_OWNER:-}" ]; then
  test -f "$DEPLOY_LOCK_DIR/owner" || {
    echo "Inherited production deploy lock owner file is missing." >&2
    exit 1
  }
  inherited_owner=$(sed -n '1p' "$DEPLOY_LOCK_DIR/owner")
  if [ "$inherited_owner" != "$PRODUCTION_DEPLOY_LOCK_OWNER" ]; then
    echo "Inherited production deploy lock ownership mismatch." >&2
    exit 1
  fi
elif [ "$DRY_RUN" = "1" ]; then
  PRODUCTION_DEPLOY_LOCK_OWNER="dry-run-$$-$(date -u +%Y%m%d%H%M%S)"
  umask 077
  mkdir "$DEPLOY_LOCK_DIR" || {
    echo "A production deployment lock already exists; refusing a concurrent dry run." >&2
    exit 1
  }
  ORCHESTRATOR_OWNS_DEPLOY_LOCK=1
  printf '%s\n' \
    "$PRODUCTION_DEPLOY_LOCK_OWNER" \
    "host=$(hostname)" \
    "pid=$$" \
    "started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    >"$DEPLOY_LOCK_DIR/owner"
  export PRODUCTION_DEPLOY_LOCK_OWNER
else
  echo "Mutating production deploys must use the queue-safe production wrapper." >&2
  exit 1
fi
if [ "$DRY_RUN" != "1" ] && [ "${PRODUCTION_OS_LOCK_HELD:-0}" != "1" ]; then
  echo "Missing kernel-held production deploy lock." >&2
  exit 1
fi

# A new transaction must never layer over an interrupted cutover. Recovery is
# the only path allowed to advance a nonterminal journal. Parse every journal
# strictly (including terminal ones) so a malformed or symlinked record cannot
# be silently treated as harmless history.
node - "$FRONT_DIR/.deploy" <<'NODE'
const fs = require("fs");
const path = require("path");
const root = process.argv[2];
const terminals = new Set([
  "complete",
  "rolled_back",
  "gcp_restored_mac_fail_closed",
  "abandoned_pre_pause",
]);
for (const name of fs.readdirSync(root).sort()) {
  if (!name.startsWith("cutover-phase-") || !name.endsWith(".env")) continue;
  const match = /^cutover-phase-([A-Za-z0-9._-]+)\.env$/.exec(name);
  if (!match) throw new Error(`Invalid cutover phase record name: ${name}`);
  const file = path.join(root, name);
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Cutover phase record must be a regular non-symlink file: ${file}`);
  }
  const fields = new Map();
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!raw) continue;
    const index = raw.indexOf("=");
    if (index <= 0) throw new Error(`Malformed cutover phase field: ${file}`);
    const key = raw.slice(0, index);
    const value = raw.slice(index + 1);
    if (fields.has(key)) throw new Error(`Duplicate cutover phase field ${key}: ${file}`);
    fields.set(key, value);
  }
  if (fields.get("FORMAT") !== "krw-production-cutover-phase/v1" ||
      fields.get("DEPLOYMENT_ID") !== match[1] ||
      !fields.get("LOCK_OWNER") || !fields.get("UPDATED_AT")) {
    throw new Error(`Invalid cutover phase provenance: ${file}`);
  }
  const phase = fields.get("PHASE");
  if (!terminals.has(phase)) {
    throw new Error(`Unfinished production cutover requires recovery before a new deploy: ${match[1]} (${String(phase || "missing")})`);
  }
}
NODE

NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION:-$(date -u +%Y%m%d%H%M%S)-$$}
case "$NEXT_PUBLIC_APP_VERSION" in
  ''|*[!A-Za-z0-9._-]*)
    echo "NEXT_PUBLIC_APP_VERSION must contain only letters, numbers, dot, underscore, or dash." >&2
    exit 1
    ;;
esac
EXPECTED_PREPARED_APP_VERSION=$NEXT_PUBLIC_APP_VERSION
PRODUCTION_ORCHESTRATOR_ATTESTATION="$NEXT_PUBLIC_APP_VERSION:$PRODUCTION_DEPLOY_LOCK_OWNER"
PRODUCTION_UNSEALED_BOOTSTRAP_ATTESTATION=
if [ "$UNSEALED_MAC_BOOTSTRAP" = "1" ]; then
  PRODUCTION_UNSEALED_BOOTSTRAP_ATTESTATION=$PRODUCTION_ORCHESTRATOR_ATTESTATION
fi
PRODUCTION_GCP_BOOTSTRAP_ATTESTATION=
if [ "$UNSEALED_GCP_BOOTSTRAP" = "1" ]; then
  PRODUCTION_GCP_BOOTSTRAP_ATTESTATION=$PRODUCTION_ORCHESTRATOR_ATTESTATION
fi
export NEXT_PUBLIC_APP_VERSION EXPECTED_PREPARED_APP_VERSION PRODUCTION_ORCHESTRATOR_ATTESTATION
export PRODUCTION_UNSEALED_BOOTSTRAP_ATTESTATION
export PRODUCTION_GCP_BOOTSTRAP_ATTESTATION
echo "Production deployment id: $NEXT_PUBLIC_APP_VERSION"

CANONICAL_PRODUCTION_TARGET="$FRONT_DIR/ops/production-target.json"
node "$SCRIPT_DIR/verify-supabase-production-target.mjs" \
  "$PRODUCTION_ENV_PATH" \
  "$FRONT_DIR/supabase/.temp/project-ref" \
  "$CANONICAL_PRODUCTION_TARGET"
SUPABASE_EXPECTED_PRODUCTION_PROJECT_REF=$(node -e '
  const target = require(process.argv[1]);
  process.stdout.write(target.supabaseProjectRef);
' "$CANONICAL_PRODUCTION_TARGET")
CANONICAL_REMOTE_FRONT_DIR=$(node -e '
  const target = require(process.argv[1]);
  process.stdout.write(target.remoteFrontDir);
' "$CANONICAL_PRODUCTION_TARGET")
export SUPABASE_EXPECTED_PRODUCTION_PROJECT_REF

# Capture the gated frontend identity before any cutover input is copied. The
# production hash excludes `.deploy`, so constructing the private transaction
# below cannot perturb this identity. A second comparison after the copy
# rejects a normal edit during rsync/cp instead of mixing old migrations with
# newer gated application code.
INITIAL_FRONT_SOURCE_SHA256=$(node \
  "$SCRIPT_DIR/compute-production-source-sha256.mjs" "$FRONT_DIR")

# Pin every mutable deployment input before running gates. The runtime env is
# versioned because launchd keeps using it after this cutover; migration files
# and the linked project metadata live in a private cutover snapshot. A later
# edit to the operator env, `supabase link`, or a migration cannot redirect one
# half of the deployment after the initial target check.
CUTOVER_SNAPSHOT="$FRONT_DIR/.deploy/cutover-$NEXT_PUBLIC_APP_VERSION"
rm -rf "$CUTOVER_SNAPSHOT"
umask 077
mkdir -p "$CUTOVER_SNAPSHOT/scripts" "$CUTOVER_SNAPSHOT/ops" "$CUTOVER_SNAPSHOT/tools"
rsync -a --delete "$FRONT_DIR/supabase/" "$CUTOVER_SNAPSHOT/supabase/"
cp "$FRONT_DIR/scripts/supabase-schema-smoke.mjs" \
  "$CUTOVER_SNAPSHOT/scripts/supabase-schema-smoke.mjs"
cp "$FRONT_DIR/scripts/compute-admin-email-set-sha256.mjs" \
  "$CUTOVER_SNAPSHOT/scripts/compute-admin-email-set-sha256.mjs"
cp "$FRONT_DIR/scripts/provision-production-admin-entitlements.mjs" \
  "$CUTOVER_SNAPSHOT/scripts/provision-production-admin-entitlements.mjs"
cp "$FRONT_DIR/scripts/supabase-cli.sh" \
  "$CUTOVER_SNAPSHOT/scripts/supabase-cli.sh"
cp "$FRONT_DIR/scripts/pause-production-cutover.sh" \
  "$CUTOVER_SNAPSHOT/scripts/pause-production-cutover.sh"
cp "$FRONT_DIR/scripts/recover-production-cutover.sh" \
  "$CUTOVER_SNAPSHOT/scripts/recover-production-cutover.sh"
cp "$FRONT_DIR/scripts/deploy-web-production.sh" \
  "$CUTOVER_SNAPSHOT/scripts/deploy-web-production.sh"
cp "$FRONT_DIR/scripts/verify-prepared-runtime-artifacts.mjs" \
  "$CUTOVER_SNAPSHOT/scripts/verify-prepared-runtime-artifacts.mjs"
cp "$FRONT_DIR/scripts/uninstall-mac-worker-launchd.sh" \
  "$CUTOVER_SNAPSHOT/scripts/uninstall-mac-worker-launchd.sh"
cp "$FRONT_DIR/scripts/uninstall-mcp-server-launchd.sh" \
  "$CUTOVER_SNAPSHOT/scripts/uninstall-mcp-server-launchd.sh"
cp "$FRONT_DIR/scripts/uninstall-stock-news-mcp-launchd.sh" \
  "$CUTOVER_SNAPSHOT/scripts/uninstall-stock-news-mcp-launchd.sh"
cp "$CANONICAL_PRODUCTION_TARGET" \
  "$CUTOVER_SNAPSHOT/ops/production-target.json"
chmod 500 \
  "$CUTOVER_SNAPSHOT/scripts/pause-production-cutover.sh" \
  "$CUTOVER_SNAPSHOT/scripts/recover-production-cutover.sh" \
  "$CUTOVER_SNAPSHOT/scripts/deploy-web-production.sh" \
  "$CUTOVER_SNAPSHOT/scripts/uninstall-mac-worker-launchd.sh" \
  "$CUTOVER_SNAPSHOT/scripts/uninstall-mcp-server-launchd.sh" \
  "$CUTOVER_SNAPSHOT/scripts/uninstall-stock-news-mcp-launchd.sh"

current_front_after_cutover_copy=$(node \
  "$SCRIPT_DIR/compute-production-source-sha256.mjs" "$FRONT_DIR")
[ "$current_front_after_cutover_copy" = "$INITIAL_FRONT_SOURCE_SHA256" ] || {
  echo "Production frontend source changed while the migration cutover snapshot was copied." >&2
  exit 1
}
diff -qr "$FRONT_DIR/supabase" "$CUTOVER_SNAPSHOT/supabase" >/dev/null || {
  echo "Sealed Supabase cutover tree does not exactly match the gated source." >&2
  exit 1
}
for relative_input in \
  scripts/supabase-schema-smoke.mjs \
  scripts/compute-admin-email-set-sha256.mjs \
  scripts/provision-production-admin-entitlements.mjs \
  scripts/supabase-cli.sh \
  scripts/pause-production-cutover.sh \
  scripts/recover-production-cutover.sh \
  scripts/deploy-web-production.sh \
  scripts/verify-prepared-runtime-artifacts.mjs \
  scripts/uninstall-mac-worker-launchd.sh \
  scripts/uninstall-mcp-server-launchd.sh \
  scripts/uninstall-stock-news-mcp-launchd.sh \
  ops/production-target.json
do
  cmp -s "$FRONT_DIR/$relative_input" "$CUTOVER_SNAPSHOT/$relative_input" || {
    echo "Sealed cutover input differs from the gated source: $relative_input" >&2
    exit 1
  }
done

CUTOVER_INPUT_SEAL="$CUTOVER_SNAPSHOT/cutover-input-seal.json"
node "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs" prepare \
  --marker "$CUTOVER_INPUT_SEAL" \
  --symlink-boundary "$CUTOVER_SNAPSHOT" \
  --path "$CUTOVER_SNAPSHOT/supabase" \
  --path "$CUTOVER_SNAPSHOT/scripts/supabase-schema-smoke.mjs" \
  --path "$CUTOVER_SNAPSHOT/scripts/compute-admin-email-set-sha256.mjs" \
  --path "$CUTOVER_SNAPSHOT/scripts/provision-production-admin-entitlements.mjs" \
  --path "$CUTOVER_SNAPSHOT/scripts/supabase-cli.sh" \
  --path "$CUTOVER_SNAPSHOT/scripts/pause-production-cutover.sh" \
  --path "$CUTOVER_SNAPSHOT/scripts/recover-production-cutover.sh" \
  --path "$CUTOVER_SNAPSHOT/scripts/deploy-web-production.sh" \
  --path "$CUTOVER_SNAPSHOT/scripts/verify-prepared-runtime-artifacts.mjs" \
  --path "$CUTOVER_SNAPSHOT/scripts/uninstall-mac-worker-launchd.sh" \
  --path "$CUTOVER_SNAPSHOT/scripts/uninstall-mcp-server-launchd.sh" \
  --path "$CUTOVER_SNAPSHOT/scripts/uninstall-stock-news-mcp-launchd.sh" \
  --path "$CUTOVER_SNAPSHOT/ops/production-target.json"
chmod 400 "$CUTOVER_INPUT_SEAL"
CUTOVER_HELPER_SEAL="$CUTOVER_SNAPSHOT/cutover-helper-seal.json"
node "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs" prepare \
  --marker "$CUTOVER_HELPER_SEAL" \
  --symlink-boundary "$CUTOVER_SNAPSHOT" \
  --path "$CUTOVER_SNAPSHOT/scripts/supabase-schema-smoke.mjs" \
  --path "$CUTOVER_SNAPSHOT/scripts/compute-admin-email-set-sha256.mjs" \
  --path "$CUTOVER_SNAPSHOT/scripts/provision-production-admin-entitlements.mjs" \
  --path "$CUTOVER_SNAPSHOT/scripts/supabase-cli.sh" \
  --path "$CUTOVER_SNAPSHOT/ops/production-target.json"
chmod 400 "$CUTOVER_HELPER_SEAL"
verify_cutover_inputs_unchanged() {
  node "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs" verify \
    --marker "$CUTOVER_INPUT_SEAL" \
    --symlink-boundary "$CUTOVER_SNAPSHOT" \
    --path "$CUTOVER_SNAPSHOT/supabase" \
    --path "$CUTOVER_SNAPSHOT/scripts/supabase-schema-smoke.mjs" \
    --path "$CUTOVER_SNAPSHOT/scripts/compute-admin-email-set-sha256.mjs" \
    --path "$CUTOVER_SNAPSHOT/scripts/provision-production-admin-entitlements.mjs" \
    --path "$CUTOVER_SNAPSHOT/scripts/supabase-cli.sh" \
    --path "$CUTOVER_SNAPSHOT/scripts/pause-production-cutover.sh" \
    --path "$CUTOVER_SNAPSHOT/scripts/recover-production-cutover.sh" \
    --path "$CUTOVER_SNAPSHOT/scripts/deploy-web-production.sh" \
    --path "$CUTOVER_SNAPSHOT/scripts/verify-prepared-runtime-artifacts.mjs" \
    --path "$CUTOVER_SNAPSHOT/scripts/uninstall-mac-worker-launchd.sh" \
    --path "$CUTOVER_SNAPSHOT/scripts/uninstall-mcp-server-launchd.sh" \
    --path "$CUTOVER_SNAPSHOT/scripts/uninstall-stock-news-mcp-launchd.sh" \
    --path "$CUTOVER_SNAPSHOT/ops/production-target.json" >/dev/null
}
verify_cutover_helpers_unchanged() {
  node "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs" verify \
    --marker "$CUTOVER_HELPER_SEAL" \
    --symlink-boundary "$CUTOVER_SNAPSHOT" \
    --path "$CUTOVER_SNAPSHOT/scripts/supabase-schema-smoke.mjs" \
    --path "$CUTOVER_SNAPSHOT/scripts/compute-admin-email-set-sha256.mjs" \
    --path "$CUTOVER_SNAPSHOT/scripts/provision-production-admin-entitlements.mjs" \
    --path "$CUTOVER_SNAPSHOT/scripts/supabase-cli.sh" \
    --path "$CUTOVER_SNAPSHOT/ops/production-target.json" >/dev/null
}

# Resolve the Supabase CLI exactly once, copy its executable bytes into the
# private cutover snapshot, and use only that copy for both dry-run and apply.
# This prevents a PATH/Homebrew/node_modules update from changing the migration
# engine after the plan passed but before the destructive operation begins.
resolve_supabase_cli() {
  if [ -n "${SUPABASE_CLI:-}" ] && [ -x "$SUPABASE_CLI" ]; then
    printf '%s\n' "$SUPABASE_CLI"
    return
  fi
  if [ -x "$FRONT_DIR/node_modules/.bin/supabase" ]; then
    printf '%s\n' "$FRONT_DIR/node_modules/.bin/supabase"
    return
  fi
  if command -v supabase >/dev/null 2>&1; then
    command -v supabase
    return
  fi
  for candidate in "$HOME/.local/bin/supabase" /opt/homebrew/bin/supabase /usr/local/bin/supabase; do
    if [ -x "$candidate" ]; then printf '%s\n' "$candidate"; return; fi
  done
  return 1
}
RESOLVED_SUPABASE_CLI=$(resolve_supabase_cli) || {
  echo "Missing Supabase CLI for the sealed production migration snapshot." >&2
  exit 1
}
RESOLVED_SUPABASE_CLI=$(node -e 'process.stdout.write(require("fs").realpathSync(process.argv[1]))' "$RESOLVED_SUPABASE_CLI")
PINNED_SUPABASE_CLI="$CUTOVER_SNAPSHOT/tools/supabase"
PINNED_SUPABASE_GO_CLI="$CUTOVER_SNAPSHOT/tools/supabase-go"
node "$SCRIPT_DIR/pin-supabase-cli.mjs" \
  "$RESOLVED_SUPABASE_CLI" \
  "$PINNED_SUPABASE_CLI" \
  "$PINNED_SUPABASE_GO_CLI" \
  "$CUTOVER_SNAPSHOT/tools/supabase.version"
PINNED_SUPABASE_CLI_SHA256=$(shasum -a 256 "$PINNED_SUPABASE_CLI" | awk '{print $1}')
PINNED_SUPABASE_GO_CLI_SHA256=$(shasum -a 256 "$PINNED_SUPABASE_GO_CLI" | awk '{print $1}')
printf '%s\n' "$PINNED_SUPABASE_CLI_SHA256" >"$CUTOVER_SNAPSHOT/tools/supabase.sha256"
printf '%s\n' "$PINNED_SUPABASE_GO_CLI_SHA256" >"$CUTOVER_SNAPSHOT/tools/supabase-go.sha256"
chmod 400 \
  "$CUTOVER_SNAPSHOT/tools/supabase.sha256" \
  "$CUTOVER_SNAPSHOT/tools/supabase-go.sha256"

if [ "$DRY_RUN" = "1" ] || [ "$DEPLOY_CODE" = "0" ]; then
  PINNED_PRODUCTION_ENV_PATH="$CUTOVER_SNAPSHOT/production.env"
else
  RUNTIME_ENV_DIR=${KRW_PRODUCTION_RUNTIME_ENV_DIR:-"$HOME/.local/share/krw-ontology/runtime-env"}
  case "$RUNTIME_ENV_DIR" in
    /*) ;;
    *) echo "KRW_PRODUCTION_RUNTIME_ENV_DIR must be absolute." >&2; exit 1 ;;
  esac
  mkdir -p "$RUNTIME_ENV_DIR"
  chmod 700 "$RUNTIME_ENV_DIR"
  RUNTIME_ENV_DIR=$(CDPATH= cd -- "$RUNTIME_ENV_DIR" && pwd -P)
  PINNED_PRODUCTION_ENV_PATH="$RUNTIME_ENV_DIR/$NEXT_PUBLIC_APP_VERSION.env"
  if [ -e "$PINNED_PRODUCTION_ENV_PATH" ]; then
    echo "Refusing to overwrite a versioned production runtime env: $PINNED_PRODUCTION_ENV_PATH" >&2
    exit 1
  fi
fi
PINNED_ENV_TMP="$PINNED_PRODUCTION_ENV_PATH.tmp.$$"
cp "$PRODUCTION_ENV_PATH" "$PINNED_ENV_TMP"
chmod 400 "$PINNED_ENV_TMP"
mv "$PINNED_ENV_TMP" "$PINNED_PRODUCTION_ENV_PATH"
shasum -a 256 "$PINNED_PRODUCTION_ENV_PATH" | awk '{print $1}' \
  >"$CUTOVER_SNAPSHOT/production-env.sha256"
printf '%s\n' "$PINNED_PRODUCTION_ENV_PATH" \
  >"$CUTOVER_SNAPSHOT/production-env.path"
chmod 400 "$CUTOVER_SNAPSHOT/production-env.sha256" \
  "$CUTOVER_SNAPSHOT/production-env.path"

node "$SCRIPT_DIR/verify-supabase-production-target.mjs" \
  "$PINNED_PRODUCTION_ENV_PATH" \
  "$CUTOVER_SNAPSHOT/supabase/.temp/project-ref" \
  "$CUTOVER_SNAPSHOT/ops/production-target.json"

# Bind every byte needed by crash recovery into one master transaction. The
# phase journal stores this seal's digest plus the external immutable env
# path/digest; the recovery bootstrap verifies all of it before sourcing env.
CUTOVER_RECOVERY_SEAL="$CUTOVER_SNAPSHOT/recovery-seal.json"
node "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs" prepare \
  --marker "$CUTOVER_RECOVERY_SEAL" \
  --symlink-boundary "$CUTOVER_SNAPSHOT" \
  --path "$CUTOVER_SNAPSHOT/cutover-input-seal.json" \
  --path "$CUTOVER_SNAPSHOT/cutover-helper-seal.json" \
  --path "$CUTOVER_SNAPSHOT/scripts/pause-production-cutover.sh" \
  --path "$CUTOVER_SNAPSHOT/scripts/recover-production-cutover.sh" \
  --path "$CUTOVER_SNAPSHOT/scripts/deploy-web-production.sh" \
  --path "$CUTOVER_SNAPSHOT/scripts/compute-admin-email-set-sha256.mjs" \
  --path "$CUTOVER_SNAPSHOT/scripts/verify-prepared-runtime-artifacts.mjs" \
  --path "$CUTOVER_SNAPSHOT/scripts/uninstall-mac-worker-launchd.sh" \
  --path "$CUTOVER_SNAPSHOT/scripts/uninstall-mcp-server-launchd.sh" \
  --path "$CUTOVER_SNAPSHOT/scripts/uninstall-stock-news-mcp-launchd.sh" \
  --path "$CUTOVER_SNAPSHOT/ops/production-target.json" \
  --path "$CUTOVER_SNAPSHOT/production-env.path" \
  --path "$CUTOVER_SNAPSHOT/production-env.sha256" \
  --path "$PINNED_PRODUCTION_ENV_PATH" \
  --path "$CUTOVER_SNAPSHOT/tools/supabase" \
  --path "$CUTOVER_SNAPSHOT/tools/supabase.sha256" \
  --path "$CUTOVER_SNAPSHOT/tools/supabase-go" \
  --path "$CUTOVER_SNAPSHOT/tools/supabase-go.sha256"
chmod 400 "$CUTOVER_RECOVERY_SEAL"
CUTOVER_RECOVERY_SEAL_SHA256=$(shasum -a 256 "$CUTOVER_RECOVERY_SEAL" | awk '{print $1}')
CUTOVER_PRODUCTION_ENV_SHA256=$(sed -n '1p' "$CUTOVER_SNAPSHOT/production-env.sha256")
printf '%s' "$CUTOVER_RECOVERY_SEAL_SHA256" | grep -Eq '^[a-f0-9]{64}$'
printf '%s' "$CUTOVER_PRODUCTION_ENV_SHA256" | grep -Eq '^[a-f0-9]{64}$'
verify_cutover_recovery_unchanged() {
  [ "$(shasum -a 256 "$CUTOVER_RECOVERY_SEAL" | awk '{print $1}')" \
    = "$CUTOVER_RECOVERY_SEAL_SHA256" ] || {
    echo "Durable cutover recovery seal changed." >&2
    return 1
  }
  [ "$(shasum -a 256 "$PINNED_PRODUCTION_ENV_PATH" | awk '{print $1}')" \
    = "$CUTOVER_PRODUCTION_ENV_SHA256" ] || {
    echo "Pinned production env changed after recovery sealing." >&2
    return 1
  }
  node "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs" verify \
    --marker "$CUTOVER_RECOVERY_SEAL" \
    --symlink-boundary "$CUTOVER_SNAPSHOT" \
    --path "$CUTOVER_SNAPSHOT/cutover-input-seal.json" \
    --path "$CUTOVER_SNAPSHOT/cutover-helper-seal.json" \
    --path "$CUTOVER_SNAPSHOT/scripts/pause-production-cutover.sh" \
    --path "$CUTOVER_SNAPSHOT/scripts/recover-production-cutover.sh" \
    --path "$CUTOVER_SNAPSHOT/scripts/deploy-web-production.sh" \
    --path "$CUTOVER_SNAPSHOT/scripts/compute-admin-email-set-sha256.mjs" \
    --path "$CUTOVER_SNAPSHOT/scripts/verify-prepared-runtime-artifacts.mjs" \
    --path "$CUTOVER_SNAPSHOT/scripts/uninstall-mac-worker-launchd.sh" \
    --path "$CUTOVER_SNAPSHOT/scripts/uninstall-mcp-server-launchd.sh" \
    --path "$CUTOVER_SNAPSHOT/scripts/uninstall-stock-news-mcp-launchd.sh" \
    --path "$CUTOVER_SNAPSHOT/ops/production-target.json" \
    --path "$CUTOVER_SNAPSHOT/production-env.path" \
    --path "$CUTOVER_SNAPSHOT/production-env.sha256" \
    --path "$PINNED_PRODUCTION_ENV_PATH" \
    --path "$CUTOVER_SNAPSHOT/tools/supabase" \
    --path "$CUTOVER_SNAPSHOT/tools/supabase.sha256" \
    --path "$CUTOVER_SNAPSHOT/tools/supabase-go" \
    --path "$CUTOVER_SNAPSHOT/tools/supabase-go.sha256" >/dev/null
}
SEALED_PAUSE_CONTROLLER="$CUTOVER_SNAPSHOT/scripts/pause-production-cutover.sh"
run_sealed_pause_controller() {
  verify_cutover_recovery_unchanged
  "$SEALED_PAUSE_CONTROLLER" "$@" \
    --front-root "$FRONT_DIR" \
    --canonical-target-file "$CUTOVER_SNAPSHOT/ops/production-target.json" \
    --expected-env-sha256 "$CUTOVER_PRODUCTION_ENV_SHA256"
}
PRODUCTION_ENV_PATH=$PINNED_PRODUCTION_ENV_PATH
export PRODUCTION_ENV_PATH
echo "Pinned production runtime env: $PRODUCTION_ENV_PATH"
echo "Sealed migration/schema-smoke snapshot: $CUTOVER_SNAPSHOT"

file_sha256() {
  node -e '
    const fs = require("fs");
    const crypto = require("crypto");
    process.stdout.write(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));
  ' "$1"
}
CUTOVER_PHASE_FILE="$FRONT_DIR/.deploy/cutover-phase-$NEXT_PUBLIC_APP_VERSION.env"
write_cutover_phase() {
  next_phase=$1
  verify_cutover_recovery_unchanged
  CUTOVER_PHASE_PATH="$CUTOVER_PHASE_FILE" \
  CUTOVER_PHASE_NAME="$next_phase" \
  CUTOVER_DEPLOYMENT_ID="$NEXT_PUBLIC_APP_VERSION" \
  CUTOVER_LOCK_OWNER="$PRODUCTION_DEPLOY_LOCK_OWNER" \
  CUTOVER_RECOVERY_SEAL_PATH="$CUTOVER_RECOVERY_SEAL" \
  CUTOVER_RECOVERY_SEAL_SHA256="$CUTOVER_RECOVERY_SEAL_SHA256" \
  CUTOVER_PRODUCTION_ENV_PATH="$PRODUCTION_ENV_PATH" \
  CUTOVER_PRODUCTION_ENV_SHA256="$CUTOVER_PRODUCTION_ENV_SHA256" \
  CUTOVER_MIGRATION_INCLUDE_ALL="${SUPABASE_DB_PUSH_INCLUDE_ALL:-0}" \
  CUTOVER_CANDIDATE_MAC_SEAL_PATH="${CANDIDATE_MAC_RUNTIME_SEAL_PATH:-}" \
  CUTOVER_CANDIDATE_MAC_SEAL_SHA256="${CANDIDATE_MAC_RUNTIME_SEAL_SHA256:-}" \
  node <<'NODE'
const fs = require("fs");
const path = require("path");
const destination = process.env.CUTOVER_PHASE_PATH;
const temporary = `${destination}.tmp.${process.pid}`;
let existing = new Map();
try {
  const lines = fs.readFileSync(destination, "utf8").split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || existing.has(match[1]) || /[\r\n\0]/.test(match[2])) {
      throw new Error("Invalid or duplicate existing cutover phase field");
    }
    existing.set(match[1], match[2]);
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
const core = new Set(["FORMAT", "DEPLOYMENT_ID", "LOCK_OWNER", "PHASE", "UPDATED_AT"]);
const provenance = new Map([...existing].filter(([key]) => !core.has(key)));
if (!provenance.has("ORIGINAL_LOCK_OWNER")) {
  provenance.set("ORIGINAL_LOCK_OWNER", process.env.CUTOVER_LOCK_OWNER);
}
const bindings = {
  RECOVERY_SEAL_PATH: process.env.CUTOVER_RECOVERY_SEAL_PATH,
  RECOVERY_SEAL_SHA256: process.env.CUTOVER_RECOVERY_SEAL_SHA256,
  PRODUCTION_ENV_PATH: process.env.CUTOVER_PRODUCTION_ENV_PATH,
  PRODUCTION_ENV_SHA256: process.env.CUTOVER_PRODUCTION_ENV_SHA256,
  MIGRATION_INCLUDE_ALL: process.env.CUTOVER_MIGRATION_INCLUDE_ALL,
};
if (process.env.CUTOVER_CANDIDATE_MAC_SEAL_PATH ||
    process.env.CUTOVER_CANDIDATE_MAC_SEAL_SHA256) {
  bindings.CANDIDATE_MAC_RUNTIME_SEAL_PATH = process.env.CUTOVER_CANDIDATE_MAC_SEAL_PATH;
  bindings.CANDIDATE_MAC_RUNTIME_SEAL_SHA256 = process.env.CUTOVER_CANDIDATE_MAC_SEAL_SHA256;
}
if (!path.isAbsolute(bindings.RECOVERY_SEAL_PATH) ||
    !path.isAbsolute(bindings.PRODUCTION_ENV_PATH)) {
  throw new Error("Cutover recovery paths must be absolute");
}
if (!/^[01]$/.test(bindings.MIGRATION_INCLUDE_ALL)) {
  throw new Error("MIGRATION_INCLUDE_ALL must be exactly 0 or 1");
}
for (const key of Object.keys(bindings).filter((key) => key.endsWith("SHA256"))) {
  if (!/^[a-f0-9]{64}$/.test(bindings[key])) {
    throw new Error(`Invalid cutover recovery digest: ${key}`);
  }
}
for (const [key, value] of Object.entries(bindings)) {
  if (provenance.has(key) && provenance.get(key) !== value) {
    throw new Error(`Cutover recovery binding changed: ${key}`);
  }
  provenance.set(key, value);
}
for (const [pathKey, digestKey] of [
  ["RECOVERY_SEAL_PATH", "RECOVERY_SEAL_SHA256"],
  ["PRODUCTION_ENV_PATH", "PRODUCTION_ENV_SHA256"],
  ["MAC_SNAPSHOT_SEAL_PATH", "MAC_SNAPSHOT_SEAL_SHA256"],
  ["CANDIDATE_MAC_RUNTIME_SEAL_PATH", "CANDIDATE_MAC_RUNTIME_SEAL_SHA256"],
]) {
  const hasPath = provenance.has(pathKey);
  const hasDigest = provenance.has(digestKey);
  if (hasPath !== hasDigest) throw new Error(`Incomplete cutover provenance pair: ${pathKey}`);
  if (!hasPath) continue;
  if (!path.isAbsolute(provenance.get(pathKey)) ||
      !/^[a-f0-9]{64}$/.test(provenance.get(digestKey))) {
    throw new Error(`Invalid cutover provenance pair: ${pathKey}`);
  }
}
const payload = [
  "FORMAT=krw-production-cutover-phase/v1",
  `DEPLOYMENT_ID=${process.env.CUTOVER_DEPLOYMENT_ID}`,
  `LOCK_OWNER=${process.env.CUTOVER_LOCK_OWNER}`,
  `PHASE=${process.env.CUTOVER_PHASE_NAME}`,
  `UPDATED_AT=${new Date().toISOString()}`,
  ...[...provenance].map(([key, value]) => `${key}=${value}`),
  "",
].join("\n");
const fd = fs.openSync(temporary, "wx", 0o600);
try { fs.writeFileSync(fd, payload); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
fs.renameSync(temporary, destination);
fs.chmodSync(destination, 0o400);
const directory = fs.openSync(path.dirname(destination), "r");
try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
NODE
}
write_migration_started_marker() {
  marker="$FRONT_DIR/.deploy/paused-plists-$NEXT_PUBLIC_APP_VERSION/migration-started"
  test -d "$(dirname "$marker")"
  MIGRATION_MARKER_PATH="$marker" \
  MIGRATION_DEPLOYMENT_ID="$NEXT_PUBLIC_APP_VERSION" \
  MIGRATION_LOCK_OWNER="$PRODUCTION_DEPLOY_LOCK_OWNER" \
  node <<'NODE'
const fs = require("fs");
const path = require("path");
const destination = process.env.MIGRATION_MARKER_PATH;
const temporary = `${destination}.tmp.${process.pid}`;
const payload = [
  "FORMAT=krw-migration-started/v1",
  `DEPLOYMENT_ID=${process.env.MIGRATION_DEPLOYMENT_ID}`,
  `LOCK_OWNER=${process.env.MIGRATION_LOCK_OWNER}`,
  `STARTED_AT=${new Date().toISOString()}`,
  "",
].join("\n");
const fd = fs.openSync(temporary, "wx", 0o600);
try { fs.writeFileSync(fd, payload); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
fs.renameSync(temporary, destination);
fs.chmodSync(destination, 0o400);
const directory = fs.openSync(path.dirname(destination), "r");
try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
NODE
}
read_pinned_env_value() {
  node -e '
    const fs = require("fs");
    const key = process.argv[2];
    let result = "";
    for (const raw of fs.readFileSync(process.argv[1], "utf8").split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("=");
      if (index <= 0 || line.slice(0, index).trim() !== key) continue;
      let value = line.slice(index + 1).trim();
      if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("\x27") && value.endsWith("\x27"))) value = value.slice(1, -1);
      result = value;
    }
    process.stdout.write(result);
  ' "$PRODUCTION_ENV_PATH" "$1"
}
truthy_value() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}
PINNED_PRODUCTION_ENV_SHA256=$(file_sha256 "$PRODUCTION_ENV_PATH")
EXPECTED_PRODUCTION_ENV_SHA256=$PINNED_PRODUCTION_ENV_SHA256
export EXPECTED_PRODUCTION_ENV_SHA256
node -e '
  const fs = require("fs");
  const keys = new Set(process.argv.slice(2));
  const counts = new Map([...keys].map((key) => [key, 0]));
  for (const raw of fs.readFileSync(process.argv[1], "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (counts.has(key)) counts.set(key, counts.get(key) + 1);
  }
  for (const [key, count] of counts) {
    if (count !== 1) throw new Error(`Pinned production env must define ${key} exactly once (found ${count})`);
  }
' "$PRODUCTION_ENV_PATH" \
  SUPABASE_URL NEXT_PUBLIC_SUPABASE_URL \
  SUPABASE_DB_PASSWORD ADMIN_EMAILS \
  KRW_ONTOLOGY_SOURCE_DIR KRW_ONTOLOGY_RELEASE_ROOT
assert_production_env_unchanged() {
  phase=$1
  current_env_sha256=$(file_sha256 "$PRODUCTION_ENV_PATH")
  if [ "$current_env_sha256" != "$PINNED_PRODUCTION_ENV_SHA256" ]; then
    echo "Pinned production runtime env changed after the $phase phase; refusing to continue." >&2
    exit 1
  fi
  node "$SCRIPT_DIR/verify-supabase-production-target.mjs" \
    "$PRODUCTION_ENV_PATH" \
    "$CUTOVER_SNAPSHOT/supabase/.temp/project-ref" \
    "$CUTOVER_SNAPSHOT/ops/production-target.json" >/dev/null
}
# The sealed launcher is retained and verified as part of the upstream
# distribution pair, but `db push` belongs to the Go companion itself. Calling
# that companion directly avoids the standalone launcher update-check path,
# which can block indefinitely on macOS before it reaches the migration code.
# Both bytes are hash-verified immediately before every invocation.
# The production web env intentionally contains `SUPABASE_URL` and public app
# keys. The CLI interprets those names as its own control inputs, so clear them
# only for this child process and pass the migration password explicitly.
run_pinned_supabase_go_cli() {
  verify_cutover_inputs_unchanged
  current_cli_sha=$(file_sha256 "$PINNED_SUPABASE_CLI")
  if [ "$current_cli_sha" != "$PINNED_SUPABASE_CLI_SHA256" ]; then
    echo "Pinned Supabase CLI changed during the production cutover." >&2
    return 1
  fi
  current_go_cli_sha=$(file_sha256 "$PINNED_SUPABASE_GO_CLI")
  if [ "$current_go_cli_sha" != "$PINNED_SUPABASE_GO_CLI_SHA256" ]; then
    echo "Pinned Supabase CLI companion changed during the production cutover." >&2
    return 1
  fi
  cli_workdir=$(mktemp -d "${TMPDIR:-/tmp}/krw-supabase-cutover.XXXXXX")
  mkdir "$cli_workdir/supabase"
  rsync -a --delete "$CUTOVER_SNAPSHOT/supabase/" "$cli_workdir/supabase/"
  diff -qr "$CUTOVER_SNAPSHOT/supabase" "$cli_workdir/supabase" >/dev/null || {
    rm -rf "$cli_workdir"
    echo "Disposable Supabase CLI worktree differs from the sealed migration master." >&2
    return 1
  }
  # Execute a byte-for-byte checked copy inside the disposable worktree. On
  # macOS, launching the same ad-hoc signed binary directly from the protected
  # cutover directory can stall in the execution-assessment path; a fresh
  # private worktree copy avoids that OS behavior without weakening the seal.
  cli_executable="$cli_workdir/supabase-go"
  /bin/cp -X "$PINNED_SUPABASE_GO_CLI" "$cli_executable"
  chmod 500 "$cli_executable"
  [ "$(file_sha256 "$cli_executable")" = "$PINNED_SUPABASE_GO_CLI_SHA256" ] || {
    rm -rf "$cli_workdir"
    echo "Disposable Supabase Go CLI copy differs from the sealed companion." >&2
    return 1
  }
  cli_status=0
  (cd "$cli_workdir" && \
    SUPABASE_URL= \
    SUPABASE_ANON_KEY= \
    SUPABASE_SERVICE_ROLE_KEY= \
    SUPABASE_DB_PASSWORD="$PINNED_SUPABASE_DB_PASSWORD" \
    SUPABASE_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1 \
      "$cli_executable" "$@") || cli_status=$?
  rm -rf "$cli_workdir"
  return "$cli_status"
}

PINNED_SUPABASE_DB_PASSWORD=$(read_pinned_env_value SUPABASE_DB_PASSWORD)
if [ -z "$PINNED_SUPABASE_DB_PASSWORD" ]; then
  echo "Pinned production env must define a nonempty SUPABASE_DB_PASSWORD." >&2
  exit 1
fi
EXPECTED_ADMIN_EMAILS_SHA256=$(node \
  "$CUTOVER_SNAPSHOT/scripts/compute-admin-email-set-sha256.mjs" \
  "$PRODUCTION_ENV_PATH")
export EXPECTED_ADMIN_EMAILS_SHA256

PINNED_MAC_RUNTIME_BASE=$(read_pinned_env_value KRW_MAC_RUNTIME_BASE)
if [ -z "$PINNED_MAC_RUNTIME_BASE" ]; then
  PINNED_MAC_RUNTIME_BASE="$HOME/.local/share/krw-ontology/mac-runtimes"
fi
UNSEALED_MAC_BOOTSTRAP_MARKER="$PINNED_MAC_RUNTIME_BASE/.immutable-bootstrap-complete"
UNSEALED_MAC_CURRENT_LINK="$PINNED_MAC_RUNTIME_BASE/current"
CANDIDATE_MAC_RUNTIME_SEAL_PATH=
CANDIDATE_MAC_RUNTIME_SEAL_SHA256=
if [ "$UNSEALED_MAC_BOOTSTRAP" = "1" ]; then
  [ ! -e "$UNSEALED_MAC_BOOTSTRAP_MARKER" ] || {
    echo "The one-time unsealed Mac runtime bootstrap was already completed." >&2
    exit 1
  }
  [ ! -L "$UNSEALED_MAC_CURRENT_LINK" ] && [ ! -e "$UNSEALED_MAC_CURRENT_LINK" ] || {
    echo "An immutable Mac current pointer already exists; use the normal full deploy." >&2
    exit 1
  }
fi

PINNED_ONTOLOGY_SOURCE_DIR=$(read_pinned_env_value KRW_ONTOLOGY_SOURCE_DIR)
PINNED_ONTOLOGY_RELEASE_ROOT=$(read_pinned_env_value KRW_ONTOLOGY_RELEASE_ROOT)
if [ -z "$PINNED_ONTOLOGY_SOURCE_DIR" ] || [ -z "$PINNED_ONTOLOGY_RELEASE_ROOT" ]; then
  echo "Pinned production env must define KRW_ONTOLOGY_SOURCE_DIR and KRW_ONTOLOGY_RELEASE_ROOT." >&2
  exit 1
fi
if [ -n "${KRW_ONTOLOGY_SOURCE_DIR:-}" ] \
  && [ "$KRW_ONTOLOGY_SOURCE_DIR" != "$PINNED_ONTOLOGY_SOURCE_DIR" ]; then
  echo "Ambient KRW_ONTOLOGY_SOURCE_DIR conflicts with the pinned production env." >&2
  exit 1
fi
KRW_ONTOLOGY_SOURCE_DIR=$PINNED_ONTOLOGY_SOURCE_DIR
KRW_ONTOLOGY_RELEASE_ROOT=$PINNED_ONTOLOGY_RELEASE_ROOT
KRW_ONTOLOGY_ROOT=$PINNED_ONTOLOGY_RELEASE_ROOT
KRW_ONTOLOGY_RELEASES_ROOT=$(dirname "$(dirname "$PINNED_ONTOLOGY_RELEASE_ROOT")")
PINNED_GURU_RELEASE_ROOT=$(read_pinned_env_value KRW_GURU_RELEASE_ROOT)
if [ -z "$PINNED_GURU_RELEASE_ROOT" ]; then
  PINNED_GURU_RELEASE_ROOT="$HOME/krw-ontology-guru-data/releases/prod/current"
fi
KRW_GURU_RELEASE_ROOT=$PINNED_GURU_RELEASE_ROOT
export KRW_ONTOLOGY_SOURCE_DIR KRW_ONTOLOGY_RELEASE_ROOT KRW_ONTOLOGY_ROOT
export KRW_ONTOLOGY_RELEASES_ROOT KRW_GURU_RELEASE_ROOT

# Stock News is a separate mutable checkout, so it needs the same provenance
# boundary as the frontend and ontology trees. Pin its exact source digest in
# the orchestrator and require the copied Mac build tree to match it.
EXPECTED_STOCK_NEWS_SOURCE_SHA256=
PINNED_STOCK_NEWS_ENABLED=$(read_pinned_env_value STOCK_NEWS_ENABLED)
PINNED_STOCK_NEWS_FORCE_DISABLED=$(read_pinned_env_value STOCK_NEWS_FORCE_DISABLED)
if truthy_value "$PINNED_STOCK_NEWS_ENABLED" \
  && ! truthy_value "$PINNED_STOCK_NEWS_FORCE_DISABLED"; then
  PINNED_STOCK_NEWS_SOURCE_ROOT=$(read_pinned_env_value STOCK_NEWS_MCP_ROOT)
  if [ -z "$PINNED_STOCK_NEWS_SOURCE_ROOT" ]; then
    PINNED_STOCK_NEWS_SOURCE_ROOT="$HOME/mcp-servers/stock-news-mcp"
  fi
  test -f "$PINNED_STOCK_NEWS_SOURCE_ROOT/package.json" || {
    echo "Enabled Stock News source is missing package.json: $PINNED_STOCK_NEWS_SOURCE_ROOT" >&2
    exit 1
  }
  test -f "$PINNED_STOCK_NEWS_SOURCE_ROOT/package-lock.json" || {
    echo "Enabled Stock News source is missing package-lock.json: $PINNED_STOCK_NEWS_SOURCE_ROOT" >&2
    exit 1
  }
  STOCK_NEWS_MCP_ROOT=$PINNED_STOCK_NEWS_SOURCE_ROOT
  EXPECTED_STOCK_NEWS_SOURCE_SHA256=$(node \
    "$SCRIPT_DIR/compute-production-source-sha256.mjs" \
    "$PINNED_STOCK_NEWS_SOURCE_ROOT")
  export STOCK_NEWS_MCP_ROOT EXPECTED_STOCK_NEWS_SOURCE_SHA256
  echo "Stock News source identity: $EXPECTED_STOCK_NEWS_SOURCE_SHA256"
fi

ONTOLOGY_SOURCE_DIR=$KRW_ONTOLOGY_SOURCE_DIR
capture_deploy_source_identity() {
  front_sha=$(node "$SCRIPT_DIR/compute-production-source-sha256.mjs" "$FRONT_DIR")
  ontology_sha=$(node "$SCRIPT_DIR/compute-production-source-sha256.mjs" "$ONTOLOGY_SOURCE_DIR")
  stock_news_sha=disabled
  if [ -n "$EXPECTED_STOCK_NEWS_SOURCE_SHA256" ]; then
    stock_news_sha=$(node "$SCRIPT_DIR/compute-production-source-sha256.mjs" \
      "$STOCK_NEWS_MCP_ROOT")
  fi
  printf '%s:%s:%s' "$front_sha" "$ontology_sha" "$stock_news_sha"
}
assert_deploy_source_unchanged() {
  phase=$1
  assert_production_env_unchanged "$phase"
  current_source_identity=$(capture_deploy_source_identity)
  if [ "$current_source_identity" != "$DEPLOY_SOURCE_IDENTITY" ]; then
    echo "Production source changed after the $phase phase; refusing to deploy artifacts that did not pass one coherent gate." >&2
    exit 1
  fi
  current_release_identity=$(capture_release_identity)
  if [ "$current_release_identity" != "$DEPLOY_RELEASE_IDENTITY" ]; then
    echo "Active ontology or Guru release changed after the $phase phase; refusing a split-release deployment." >&2
    echo "  expected: $DEPLOY_RELEASE_IDENTITY" >&2
    echo "  current:  $current_release_identity" >&2
    exit 1
  fi
}
DEPLOY_FRONT_SOURCE_SHA256=$INITIAL_FRONT_SOURCE_SHA256
EXPECTED_FRONT_SOURCE_SHA256=$DEPLOY_FRONT_SOURCE_SHA256
EXPECTED_ONTOLOGY_SOURCE_SHA256=$(node "$SCRIPT_DIR/compute-production-source-sha256.mjs" "$ONTOLOGY_SOURCE_DIR")
export EXPECTED_FRONT_SOURCE_SHA256 EXPECTED_ONTOLOGY_SOURCE_SHA256
DEPLOY_SOURCE_IDENTITY="$DEPLOY_FRONT_SOURCE_SHA256:$EXPECTED_ONTOLOGY_SOURCE_SHA256:${EXPECTED_STOCK_NEWS_SOURCE_SHA256:-disabled}"
echo "Production source identity: $DEPLOY_SOURCE_IDENTITY"

capture_release_identity() {
  ontology_root=$(CDPATH= cd -- "$KRW_ONTOLOGY_RELEASE_ROOT" && pwd -P)
  guru_root=$(CDPATH= cd -- "$KRW_GURU_RELEASE_ROOT" && pwd -P)
  ontology_manifest_sha=$(file_sha256 "$ontology_root/manifest.json")
  guru_manifest_sha=$(file_sha256 "$guru_root/manifest.json")
  printf '%s:%s:%s:%s' \
    "$ontology_root" "$ontology_manifest_sha" "$guru_root" "$guru_manifest_sha"
}
DEPLOY_RELEASE_IDENTITY=$(capture_release_identity)
echo "Production release identity: $DEPLOY_RELEASE_IDENTITY"

# Preparing the Mac plugin against one immutable ontology release and then
# promoting another would violate the artifact seal. Until the combined
# orchestrator has a candidate-release env transaction, it accepts only the
# release resolved from the pinned production env.
if [ -n "$REQUESTED_RELEASE_ID" ]; then
  CURRENT_RELEASE_MANIFEST="$KRW_ONTOLOGY_RELEASE_ROOT/manifest.json"
  CURRENT_RELEASE_ID=$(node -e '
    const fs = require("fs");
    const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    if (typeof manifest.release_id !== "string" || !manifest.release_id) process.exit(1);
    process.stdout.write(manifest.release_id);
  ' "$CURRENT_RELEASE_MANIFEST")
  if [ "$REQUESTED_RELEASE_ID" != "$CURRENT_RELEASE_ID" ]; then
    echo "Refusing an unsealed cross-release promotion in the combined deploy." >&2
    echo "  active:    $CURRENT_RELEASE_ID" >&2
    echo "  requested: $REQUESTED_RELEASE_ID" >&2
    echo "Prepare and validate a dedicated candidate-release cutover before changing prod/current." >&2
    exit 1
  fi
fi

if [ "$APPLY_MIGRATIONS" = "1" ] && [ "$DB_CHECK" = "0" ]; then
  echo "--apply-migrations cannot be combined with --skip-db-check." >&2
  exit 1
fi

MIGRATIONS_PENDING=0
SUPABASE_DB_PUSH_INCLUDE_ALL=0

if [ "$DB_CHECK" = "1" ]; then
  echo "Checking Supabase migration drift..."
  MIGRATION_DRY_RUN_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/krw-supabase-dry-run.XXXXXX")
  if (cd "$CUTOVER_SNAPSHOT" && run_pinned_supabase_go_cli db push --dry-run) >"$MIGRATION_DRY_RUN_OUTPUT" 2>&1; then
    cat "$MIGRATION_DRY_RUN_OUTPUT"
  else
    if grep -q -- "--include-all" "$MIGRATION_DRY_RUN_OUTPUT"; then
      cat "$MIGRATION_DRY_RUN_OUTPUT"
      echo "Retrying Supabase migration dry run with --include-all for out-of-order local migrations..."
      SUPABASE_DB_PUSH_INCLUDE_ALL=1
      : >"$MIGRATION_DRY_RUN_OUTPUT"
      if (cd "$CUTOVER_SNAPSHOT" && run_pinned_supabase_go_cli db push --include-all --dry-run) >"$MIGRATION_DRY_RUN_OUTPUT" 2>&1; then
        cat "$MIGRATION_DRY_RUN_OUTPUT"
      else
        cat "$MIGRATION_DRY_RUN_OUTPUT" >&2
        rm -f "$MIGRATION_DRY_RUN_OUTPUT"
        exit 1
      fi
    else
      # The plan is read-only. On macOS, a freshly staged companion binary can
      # occasionally be terminated while its provenance assessment completes.
      # Retry this exact sealed command once; semantic migration errors still
      # fail closed on the second result and no database mutation has occurred.
      echo "Retrying the sealed Supabase migration dry run once after a transient CLI failure..." >&2
      sleep 1
      : >"$MIGRATION_DRY_RUN_OUTPUT"
      if (cd "$CUTOVER_SNAPSHOT" && run_pinned_supabase_go_cli db push --dry-run) >"$MIGRATION_DRY_RUN_OUTPUT" 2>&1; then
        cat "$MIGRATION_DRY_RUN_OUTPUT"
      else
        cat "$MIGRATION_DRY_RUN_OUTPUT" >&2
        rm -f "$MIGRATION_DRY_RUN_OUTPUT"
        exit 1
      fi
    fi
  fi

  if grep -q "Would push these migrations" "$MIGRATION_DRY_RUN_OUTPUT"; then
    MIGRATIONS_PENDING=1
    if [ "$APPLY_MIGRATIONS" = "0" ]; then
      if [ "$DRY_RUN" = "1" ]; then
        echo "Dry run: pending Supabase migrations detected; non-dry deployment would require --apply-migrations before schema smoke."
      else
        echo "Pending Supabase migrations detected. Re-run with --apply-migrations, or apply migrations before deploying code." >&2
        rm -f "$MIGRATION_DRY_RUN_OUTPUT"
        exit 1
      fi
    fi
  fi

  if [ "$APPLY_MIGRATIONS" = "1" ] \
    && [ "$MIGRATIONS_PENDING" = "1" ] \
    && [ "$DEPLOY_CODE" = "0" ]; then
    echo "Pending schema migrations require a prepared code cutover; do not use --skip-code." >&2
    rm -f "$MIGRATION_DRY_RUN_OUTPUT"
    exit 1
  fi

  rm -f "$MIGRATION_DRY_RUN_OUTPUT"
else
  echo "Skipping Supabase migration/schema checks."
fi

if [ "$DEPLOY_CODE" = "1" ]; then
  if [ "$SKIP_RELEASE_GATES" = "1" ]; then
    echo "Skipping slow local release gates. Run npm run prod:preflight separately."
  else
    echo "Running pre-migration release gates..."
    if [ "$DRY_RUN" = "1" ]; then
      /bin/sh "$SCRIPT_DIR/run-production-release-gates.sh" --dry-run
    else
      /bin/sh "$SCRIPT_DIR/run-production-release-gates.sh"
    fi
  fi
else
  echo "Skipping code release gates."
fi
if [ "$DEPLOY_CODE" = "1" ]; then
  assert_deploy_source_unchanged "release-gate"
fi

if [ "$DEPLOY_CODE" = "1" ]; then
  echo "Preparing immutable GCP and Mac runtime artifacts..."
  if [ "$DRY_RUN" = "1" ]; then
    /bin/sh "$SCRIPT_DIR/deploy-web-production.sh" --dry-run --prepare-only
    assert_deploy_source_unchanged "GCP artifact preparation"
    KRW_FILINGS_MCP_DEFER_PERSONAL_DATA_SMOKE="$MIGRATIONS_PENDING" \
      /bin/sh "$SCRIPT_DIR/deploy-plugin-worker-production.sh" \
      --env-file "$PRODUCTION_ENV_PATH" \
      --dry-run \
      --prepare-only
  else
    /bin/sh "$SCRIPT_DIR/deploy-web-production.sh" --prepare-only
    assert_deploy_source_unchanged "GCP artifact preparation"
    KRW_FILINGS_MCP_DEFER_PERSONAL_DATA_SMOKE="$MIGRATIONS_PENDING" \
      /bin/sh "$SCRIPT_DIR/deploy-plugin-worker-production.sh" \
      --env-file "$PRODUCTION_ENV_PATH" \
      --prepare-only
    CANDIDATE_MAC_RUNTIME_SEAL_PATH="$PINNED_MAC_RUNTIME_BASE/$NEXT_PUBLIC_APP_VERSION/.artifact-seal.json"
    test -f "$CANDIDATE_MAC_RUNTIME_SEAL_PATH" && [ ! -L "$CANDIDATE_MAC_RUNTIME_SEAL_PATH" ] || {
      echo "Prepared Mac runtime is missing its immutable artifact seal." >&2
      exit 1
    }
    CANDIDATE_MAC_RUNTIME_SEAL_SHA256=$(file_sha256 "$CANDIDATE_MAC_RUNTIME_SEAL_PATH")
    node - "$PINNED_MAC_RUNTIME_BASE/$NEXT_PUBLIC_APP_VERSION" "$PINNED_MAC_RUNTIME_BASE" <<'NODE'
const fs = require("fs");
for (const directory of process.argv.slice(2)) {
  const stats = fs.lstatSync(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`Mac prepared-runtime durability path must be a regular directory: ${directory}`);
  }
  const fd = fs.openSync(directory, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
NODE
  fi
  assert_deploy_source_unchanged "Mac artifact preparation"
else
  echo "Skipping code artifact preparation."
fi

# Cross-release promotion is rejected above. The artifact seal therefore binds
# the already-active immutable release before the catalog for that same release
# is republished. No live plugin/current-release mismatch is introduced.
if [ "$DEPLOY_DATA" = "1" ]; then
  assert_deploy_source_unchanged "catalog publication"
  DATA_ARGS="$DATA_ARGS --env-file $PRODUCTION_ENV_PATH --releases-root $KRW_ONTOLOGY_RELEASES_ROOT"
  # shellcheck disable=SC2086
  /bin/sh "$SCRIPT_DIR/deploy-data-release-production.sh" $DATA_ARGS
else
  echo "Skipping data deployment."
fi

# ADMIN_EMAILS is runtime authorization only after the same users have a
# durable internal entitlement. Provision before pausing any runtime, and fail
# closed if a configured admin still owns an open paid subscription that could
# later overwrite the internal entitlement.
if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would provision and verify configured internal admin entitlements, with zero open Toss subscriptions."
else
  assert_production_env_unchanged "admin-entitlement-provisioning"
  verify_cutover_helpers_unchanged
  echo "Provisioning and verifying configured internal admin entitlements..."
  node "$CUTOVER_SNAPSHOT/scripts/provision-production-admin-entitlements.mjs" \
    "$PRODUCTION_ENV_PATH" \
    "$CUTOVER_SNAPSHOT/admin-entitlement-preflight-proof.json"
fi

CUTOVER_PAUSED=0
ROLLBACK_UNSAFE=0
ADMIN_PAUSED_BOUNDARY_VERIFIED=0
UNSEALED_MAC_BOUNDARY_CROSSED=0
recover_pre_migration_runtime() {
  status=$?
  trap - EXIT INT TERM
  durable_phase=
  if [ -f "$CUTOVER_PHASE_FILE" ] && [ ! -L "$CUTOVER_PHASE_FILE" ] \
    && [ "$(grep -c '^PHASE=' "$CUTOVER_PHASE_FILE" || true)" = 1 ]; then
    durable_phase=$(sed -n 's/^PHASE=//p' "$CUTOVER_PHASE_FILE")
  fi
  if [ "$durable_phase" = complete ]; then
    release_deploy_lock
    exit "$status"
  fi
  if [ "$CUTOVER_PAUSED" = "1" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      echo "Dry-run cutover validation failed; production was not changed." >&2
    elif [ "$UNSEALED_MAC_BOOTSTRAP" = "1" ] \
      && [ "$UNSEALED_MAC_BOUNDARY_CROSSED" = "1" ]; then
      echo "One-time Mac bootstrap failed after the inexact legacy boundary; the legacy mutable Mac runtime will not be restarted." >&2
      if run_sealed_pause_controller pause \
        --env-file "$PRODUCTION_ENV_PATH" \
        --fail-closed-repause; then
        if [ "$ROLLBACK_UNSAFE" = "0" ]; then
          echo "Mac is fail-closed; restoring only the exact sealed pre-cutover GCP runtime..." >&2
          if ! run_sealed_pause_controller resume-remote \
            --env-file "$PRODUCTION_ENV_PATH"; then
            echo "CRITICAL: exact GCP-only recovery failed; production remains fail-closed." >&2
          fi
        else
          echo "The schema boundary was crossed; GCP and Mac application runtimes remain fail-closed." >&2
        fi
      else
        echo "CRITICAL: could not prove the partially activated Mac runtime is stopped; GCP will not be restored automatically." >&2
      fi
      echo "Mac launchd remains intentionally stopped; do not restart the legacy mutable scripts." >&2
    elif [ "$ROLLBACK_UNSAFE" = "0" ]; then
      echo "Cutover failed before any irreversible change; resuming the previous runtime..." >&2
      if ! run_sealed_pause_controller resume --env-file "$PRODUCTION_ENV_PATH"; then
        echo "CRITICAL: exact pre-migration runtime recovery failed; production remains fail-closed and requires operator recovery." >&2
        if ! run_sealed_pause_controller pause \
          --env-file "$PRODUCTION_ENV_PATH" \
          --fail-closed-repause; then
          echo "CRITICAL: failed to prove every partially restored runtime is stopped." >&2
        fi
      fi
    else
      echo "Cutover failed after crossing an irreversible schema/runtime boundary; stopping any partially activated runtime..." >&2
      if ! run_sealed_pause_controller pause \
        --env-file "$PRODUCTION_ENV_PATH" \
        --fail-closed-repause; then
        echo "CRITICAL: failed to re-pause a partially activated runtime." >&2
      fi
      echo "Old application code will not be restarted automatically." >&2
      echo "Prepared artifacts remain available for diagnosis and a safe activation retry." >&2
    fi
  elif [ "$DRY_RUN" != "1" ] && [ "$DEPLOY_CODE" = "1" ] \
    && [ -f "$CUTOVER_PHASE_FILE" ] && [ ! -L "$CUTOVER_PHASE_FILE" ]; then
    phase_count=$(grep -c '^PHASE=' "$CUTOVER_PHASE_FILE" || true)
    current_phase=$(sed -n 's/^PHASE=//p' "$CUTOVER_PHASE_FILE")
    if [ "$phase_count" = 1 ] \
      && { [ "$current_phase" = prepared_local ] || [ "$current_phase" = prepared_published ]; }; then
      echo "Pre-pause cutover failed; atomically abandoning the prepared web candidate..." >&2
      if ! run_sealed_pause_controller abandon-prepared \
        --env-file "$PRODUCTION_ENV_PATH"; then
        echo "CRITICAL: prepared candidate abandonment failed; recovery is required before any new deploy." >&2
      fi
    fi
  fi
  release_deploy_lock
  exit "$status"
}
trap recover_pre_migration_runtime EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$DEPLOY_CODE" = "1" ]; then
  assert_deploy_source_unchanged "prepared marker publication"
  if [ "$DRY_RUN" = "1" ]; then
    /bin/sh "$SCRIPT_DIR/deploy-web-production.sh" --dry-run --publish-prepared
    echo "Dry run: would journal prepared_local before publication and prepared_published after its atomic acknowledgement."
  else
    [ ! -e "$CUTOVER_PHASE_FILE" ] || {
      echo "Refusing to overwrite a durable cutover phase record: $CUTOVER_PHASE_FILE" >&2
      exit 1
    }
    write_cutover_phase prepared_local
    /bin/sh "$SCRIPT_DIR/deploy-web-production.sh" --publish-prepared
    write_cutover_phase prepared_published
  fi
fi

pause_application_runtimes() {
  if [ "$DRY_RUN" = "1" ]; then
    if [ "$UNSEALED_MAC_BOOTSTRAP" = "1" ]; then
      run_sealed_pause_controller pause \
        --env-file "$PRODUCTION_ENV_PATH" \
        --allow-unsealed-first-cutover \
        --dry-run
      UNSEALED_MAC_BOUNDARY_CROSSED=1
    else
      run_sealed_pause_controller pause \
        --env-file "$PRODUCTION_ENV_PATH" --dry-run
    fi
    CUTOVER_PAUSED=1
    return 0
  fi
  if [ "$UNSEALED_MAC_BOOTSTRAP" = "1" ]; then
    if run_sealed_pause_controller pause \
      --env-file "$PRODUCTION_ENV_PATH" \
      --allow-unsealed-first-cutover; then
      CUTOVER_PAUSED=1
      UNSEALED_MAC_BOUNDARY_CROSSED=1
      return 0
    fi
  elif run_sealed_pause_controller pause \
    --env-file "$PRODUCTION_ENV_PATH"; then
    CUTOVER_PAUSED=1
    return 0
  fi
  # The pause script publishes this state only after every read-only rollback
  # validation succeeds and immediately before stopping services. Its presence
  # therefore distinguishes a partial pause requiring recovery from a safe
  # preflight refusal where nothing was changed.
  if [ -f "$FRONT_DIR/.deploy/paused-runtime-$NEXT_PUBLIC_APP_VERSION.tsv" ]; then
    CUTOVER_PAUSED=1
    if [ "$UNSEALED_MAC_BOOTSTRAP" = "1" ]; then
      UNSEALED_MAC_BOUNDARY_CROSSED=1
    fi
  fi
  return 1
}

run_supabase_schema_smoke() {
  assert_production_env_unchanged "schema-smoke"
  verify_cutover_helpers_unchanged
  for attempt in 1 2 3 4 5; do
    if SUPABASE_SMOKE_ENV_FILE="$PRODUCTION_ENV_PATH" \
      SUPABASE_PROJECT_REF_FILE="$CUTOVER_SNAPSHOT/supabase/.temp/project-ref" \
      node "$CUTOVER_SNAPSHOT/scripts/supabase-schema-smoke.mjs"; then
      return 0
    fi
    if [ "$attempt" -eq 5 ]; then
      return 1
    fi
    echo "Supabase schema smoke attempt $attempt failed; waiting for PostgREST schema-cache convergence..." >&2
    sleep 3
  done
}

complete_unsealed_mac_bootstrap() {
  [ "$UNSEALED_MAC_BOOTSTRAP" = "1" ] || return 0
  runtime_root="$PINNED_MAC_RUNTIME_BASE/$NEXT_PUBLIC_APP_VERSION"
  current_link="$PINNED_MAC_RUNTIME_BASE/current"
  proof_path="$FRONT_DIR/.deploy/paused-plists-$NEXT_PUBLIC_APP_VERSION/unsealed-bootstrap-boundary.json"
  proof_sha_path="$FRONT_DIR/.deploy/paused-plists-$NEXT_PUBLIC_APP_VERSION/unsealed-bootstrap-boundary.sha256"
  test -L "$current_link" || {
    echo "Immutable Mac activation did not publish the current runtime pointer." >&2
    return 1
  }
  test -d "$runtime_root" || return 1
  resolved_current=$(CDPATH= cd -- "$current_link" && pwd -P)
  resolved_runtime=$(CDPATH= cd -- "$runtime_root" && pwd -P)
  [ "$resolved_current" = "$resolved_runtime" ] || {
    echo "Activated Mac current pointer does not resolve to the prepared bootstrap runtime." >&2
    return 1
  }
  test -f "$proof_path" || {
    echo "Missing one-time Mac bootstrap boundary proof." >&2
    return 1
  }
  test -f "$proof_sha_path" || return 1
  proof_sha=$(sed -n '1p' "$proof_sha_path")
  [ "$(file_sha256 "$proof_path")" = "$proof_sha" ] || {
    echo "One-time Mac bootstrap boundary proof changed before completion." >&2
    return 1
  }
  runtime_identity_sha=$(file_sha256 "$runtime_root/runtime-identity.json")
  if [ -e "$UNSEALED_MAC_BOOTSTRAP_MARKER" ]; then
    test -f "$UNSEALED_MAC_BOOTSTRAP_MARKER" && [ ! -L "$UNSEALED_MAC_BOOTSTRAP_MARKER" ] || return 1
    node - "$UNSEALED_MAC_BOOTSTRAP_MARKER" "$PINNED_MAC_RUNTIME_BASE" \
      "$NEXT_PUBLIC_APP_VERSION" "$resolved_runtime" "$runtime_identity_sha" \
      "$proof_sha" <<'NODE'
const fs = require("fs");
const path = require("path");
const [file, parent, deploymentId, runtimeRoot, runtimeIdentitySha256, proofSha256] = process.argv.slice(2);
function validateMarker(markerPath) {
  const stats = fs.lstatSync(markerPath);
  if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o400) {
    throw new Error("Immutable Mac bootstrap marker must be a mode-400 regular non-symlink file");
  }
  const raw = fs.readFileSync(markerPath, "utf8");
  const marker = JSON.parse(raw);
  const expectedKeys = [
    "completedAt", "deploymentId", "format", "legacyMutableRuntimeRestartAllowed",
    "runtimeIdentitySha256", "runtimeRoot", "unsealedBoundaryProofSha256",
  ];
  if (Object.keys(marker).sort().join("\n") !== expectedKeys.join("\n") ||
      marker.format !== "krw-immutable-mac-bootstrap-complete/v1" ||
      marker.deploymentId !== deploymentId || marker.runtimeRoot !== runtimeRoot ||
      marker.runtimeIdentitySha256 !== runtimeIdentitySha256 ||
      marker.unsealedBoundaryProofSha256 !== proofSha256 ||
      marker.legacyMutableRuntimeRestartAllowed !== false ||
      typeof marker.completedAt !== "string" || !Number.isFinite(Date.parse(marker.completedAt))) {
    throw new Error("Existing immutable Mac bootstrap marker does not match the activated runtime");
  }
  return raw;
}
const parentStats = fs.lstatSync(parent);
if (!parentStats.isDirectory() || parentStats.isSymbolicLink() ||
    path.resolve(path.dirname(file)) !== path.resolve(parent)) {
  throw new Error("Immutable Mac bootstrap marker parent must be its regular runtime directory");
}
const before = validateMarker(file);
let fd = fs.openSync(file, "r");
try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
fd = fs.openSync(parent, "r");
try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
if (validateMarker(file) !== before) {
  throw new Error("Immutable Mac bootstrap marker changed during durable readback");
}
NODE
    echo "Permanent one-time Mac bootstrap marker already complete: $UNSEALED_MAC_BOOTSTRAP_MARKER"
    return 0
  fi
  marker_tmp="$UNSEALED_MAC_BOOTSTRAP_MARKER.tmp.$$"
  export NEXT_PUBLIC_APP_VERSION resolved_runtime runtime_identity_sha proof_sha
  node <<'NODE' >"$marker_tmp"
const marker = {
  format: "krw-immutable-mac-bootstrap-complete/v1",
  deploymentId: process.env.NEXT_PUBLIC_APP_VERSION,
  completedAt: new Date().toISOString(),
  runtimeRoot: process.env.resolved_runtime,
  runtimeIdentitySha256: process.env.runtime_identity_sha,
  unsealedBoundaryProofSha256: process.env.proof_sha,
  legacyMutableRuntimeRestartAllowed: false,
};
process.stdout.write(`${JSON.stringify(marker, null, 2)}\n`);
NODE
  chmod 400 "$marker_tmp"
  node - "$marker_tmp" "$UNSEALED_MAC_BOOTSTRAP_MARKER" \
    "$PINNED_MAC_RUNTIME_BASE" "$NEXT_PUBLIC_APP_VERSION" \
    "$resolved_runtime" "$runtime_identity_sha" "$proof_sha" <<'NODE'
const fs = require("fs");
const path = require("path");
const [source, destination, parent, deploymentId, runtimeRoot, runtimeIdentitySha256, proofSha256] = process.argv.slice(2);
function validateMarker(markerPath) {
  const stats = fs.lstatSync(markerPath);
  if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o400) {
    throw new Error("Immutable Mac bootstrap marker must be a mode-400 regular non-symlink file");
  }
  const raw = fs.readFileSync(markerPath, "utf8");
  const marker = JSON.parse(raw);
  const expectedKeys = [
    "completedAt", "deploymentId", "format", "legacyMutableRuntimeRestartAllowed",
    "runtimeIdentitySha256", "runtimeRoot", "unsealedBoundaryProofSha256",
  ];
  if (Object.keys(marker).sort().join("\n") !== expectedKeys.join("\n") ||
      marker.format !== "krw-immutable-mac-bootstrap-complete/v1" ||
      marker.deploymentId !== deploymentId || marker.runtimeRoot !== runtimeRoot ||
      marker.runtimeIdentitySha256 !== runtimeIdentitySha256 ||
      marker.unsealedBoundaryProofSha256 !== proofSha256 ||
      marker.legacyMutableRuntimeRestartAllowed !== false ||
      typeof marker.completedAt !== "string" || !Number.isFinite(Date.parse(marker.completedAt))) {
    throw new Error("Immutable Mac bootstrap marker does not match the activated runtime");
  }
  return raw;
}
const parentStats = fs.lstatSync(parent);
if (!parentStats.isDirectory() || parentStats.isSymbolicLink() ||
    path.resolve(path.dirname(source)) !== path.resolve(parent) ||
    path.resolve(path.dirname(destination)) !== path.resolve(parent)) {
  throw new Error("Immutable Mac bootstrap marker paths must stay in the regular runtime directory");
}
const expectedBytes = validateMarker(source);
let fd = fs.openSync(source, "r");
try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
if (fs.existsSync(destination)) {
  throw new Error("Immutable Mac bootstrap marker appeared before its atomic publication");
}
fs.renameSync(source, destination);
fd = fs.openSync(destination, "r");
try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
fd = fs.openSync(parent, "r");
try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
if (validateMarker(destination) !== expectedBytes) {
  throw new Error("Immutable Mac bootstrap marker differs after durable publication readback");
}
NODE
  echo "Permanent one-time Mac bootstrap marker: $UNSEALED_MAC_BOOTSTRAP_MARKER"
}

if [ "$DB_CHECK" = "1" ] \
  && [ "$APPLY_MIGRATIONS" = "1" ] \
  && [ "$MIGRATIONS_PENDING" = "1" ]; then
  if [ "$DEPLOY_CODE" = "1" ]; then
    assert_deploy_source_unchanged "pre-cutover"
  else
    assert_production_env_unchanged "pre-cutover"
  fi
  if [ "$DRY_RUN" = "1" ]; then
    pause_application_runtimes
    if [ "$SUPABASE_DB_PUSH_INCLUDE_ALL" = "1" ]; then
      echo "Dry run: would apply Supabase migrations with Supabase CLI db push --include-all."
    else
      echo "Dry run: would apply Supabase migrations with Supabase CLI db push."
    fi
    ROLLBACK_UNSAFE=1
  else
    echo "Pausing old application runtimes for the schema cutover..."
    pause_application_runtimes
    assert_deploy_source_unchanged "runtime-pause"
    echo "Re-verifying prepared artifacts immediately before the migration boundary..."
    /bin/sh "$SCRIPT_DIR/deploy-plugin-worker-production.sh" \
      --env-file "$PRODUCTION_ENV_PATH" \
      --verify-prepared-only
    /bin/sh "$SCRIPT_DIR/deploy-web-production.sh" --verify-prepared-only
    assert_deploy_source_unchanged "prepared pre-migration verification"
    echo "Re-provisioning internal admin entitlements at the paused migration boundary..."
    verify_cutover_helpers_unchanged
    node "$CUTOVER_SNAPSHOT/scripts/provision-production-admin-entitlements.mjs" \
      "$PRODUCTION_ENV_PATH" \
      "$CUTOVER_SNAPSHOT/admin-entitlement-cutover-proof.json"
    ADMIN_PAUSED_BOUNDARY_VERIFIED=1
    echo "Applying Supabase migrations..."
    # db push can apply one migration and fail on a later migration. From the
    # instant it starts, automatic rollback to old code is no longer safe.
    assert_deploy_source_unchanged "migration-apply-final"
    verify_cutover_inputs_unchanged
    [ "$(file_sha256 "$PINNED_SUPABASE_CLI")" = "$PINNED_SUPABASE_CLI_SHA256" ] || {
      echo "Pinned Supabase CLI changed immediately before migration apply." >&2
      exit 1
    }
    [ "$(file_sha256 "$PINNED_SUPABASE_GO_CLI")" = "$PINNED_SUPABASE_GO_CLI_SHA256" ] || {
      echo "Pinned Supabase CLI companion changed immediately before migration apply." >&2
      exit 1
    }
    MIGRATION_APPLY_WORKDIR=$(mktemp -d "${TMPDIR:-/tmp}/krw-supabase-apply.XXXXXX")
    mkdir "$MIGRATION_APPLY_WORKDIR/supabase"
    rsync -a --delete \
      "$CUTOVER_SNAPSHOT/supabase/" \
      "$MIGRATION_APPLY_WORKDIR/supabase/"
    diff -qr \
      "$CUTOVER_SNAPSHOT/supabase" \
      "$MIGRATION_APPLY_WORKDIR/supabase" >/dev/null || {
      rm -rf "$MIGRATION_APPLY_WORKDIR"
      echo "Migration apply worktree differs from the sealed migration master." >&2
      exit 1
    }
    MIGRATION_EXECUTABLE="$MIGRATION_APPLY_WORKDIR/supabase-go"
    /bin/cp -X "$PINNED_SUPABASE_GO_CLI" "$MIGRATION_EXECUTABLE"
    chmod 500 "$MIGRATION_EXECUTABLE"
    [ "$(file_sha256 "$MIGRATION_EXECUTABLE")" = "$PINNED_SUPABASE_GO_CLI_SHA256" ] || {
      rm -rf "$MIGRATION_APPLY_WORKDIR"
      echo "Migration apply executable differs from the sealed Supabase Go companion." >&2
      exit 1
    }
    write_cutover_phase migration_started
    write_migration_started_marker
    # No read-only assertion belongs between this durable boundary and process
    # spawn: a failure there would falsely make a migration that never started
    # permanently rollback-unsafe.
    ROLLBACK_UNSAFE=1
    if [ "$SUPABASE_DB_PUSH_INCLUDE_ALL" = "1" ]; then
      (cd "$MIGRATION_APPLY_WORKDIR" && \
        SUPABASE_URL= \
        SUPABASE_ANON_KEY= \
        SUPABASE_SERVICE_ROLE_KEY= \
        SUPABASE_DB_PASSWORD="$PINNED_SUPABASE_DB_PASSWORD" \
        SUPABASE_TELEMETRY_DISABLED=1 \
        DO_NOT_TRACK=1 \
          "$MIGRATION_EXECUTABLE" db push --include-all)
    else
      (cd "$MIGRATION_APPLY_WORKDIR" && \
        SUPABASE_URL= \
        SUPABASE_ANON_KEY= \
        SUPABASE_SERVICE_ROLE_KEY= \
        SUPABASE_DB_PASSWORD="$PINNED_SUPABASE_DB_PASSWORD" \
        SUPABASE_TELEMETRY_DISABLED=1 \
        DO_NOT_TRACK=1 \
          "$MIGRATION_EXECUTABLE" db push)
    fi
    rm -rf "$MIGRATION_APPLY_WORKDIR"
  fi
fi

if [ "$DB_CHECK" = "1" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    echo "Dry run: would run the Supabase schema smoke test after migration and before activation."
  else
    echo "Running Supabase schema smoke test..."
    run_supabase_schema_smoke
    if [ "$MIGRATIONS_PENDING" = "1" ] && [ "$APPLY_MIGRATIONS" = "1" ]; then
      write_cutover_phase migration_verified
    fi
  fi
fi

if [ "$DEPLOY_CODE" = "1" ]; then
  assert_deploy_source_unchanged "prepared activation"
  if [ "$CUTOVER_PAUSED" = "0" ]; then
    echo "Pausing application runtimes for an atomic code cutover..."
    pause_application_runtimes
  fi
  if [ "$ADMIN_PAUSED_BOUNDARY_VERIFIED" = "0" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      echo "Dry run: would re-provision internal admin entitlements at the paused activation boundary."
    else
      echo "Re-provisioning internal admin entitlements at the paused activation boundary..."
      verify_cutover_helpers_unchanged
      node "$CUTOVER_SNAPSHOT/scripts/provision-production-admin-entitlements.mjs" \
        "$PRODUCTION_ENV_PATH" \
        "$CUTOVER_SNAPSHOT/admin-entitlement-activation-proof.json"
    fi
    ADMIN_PAUSED_BOUNDARY_VERIFIED=1
  fi
  # For a schema-compatible code-only cutover, both lanes have exact versioned
  # rollback artifacts: immutable prior launchd plists/runtime paths and the
  # prior resolved Compose config/image IDs/running set. Keep automatic
  # rollback enabled. A started migration is the only boundary that disables
  # it because db push may have partially changed the schema.
  echo "Activating prepared Mac artifacts first, then restoring public traffic with the prepared GCP image..."
  if [ "$DRY_RUN" = "1" ]; then
    /bin/sh "$SCRIPT_DIR/deploy-plugin-worker-production.sh" \
      --env-file "$PRODUCTION_ENV_PATH" \
      --dry-run \
      --activate-prepared
    if [ "$UNSEALED_MAC_BOOTSTRAP" = "1" ]; then
      echo "Dry run: would atomically publish the permanent one-time Mac bootstrap marker after immutable activation."
    fi
    /bin/sh "$SCRIPT_DIR/deploy-web-production.sh" --dry-run --activate-prepared
    echo "Dry run: would verify production compose, Mac worker, and web health."
  else
    if [ "$ROLLBACK_UNSAFE" = "1" ]; then
      write_cutover_phase activating_migrated
    else
      write_cutover_phase activating_code_only
    fi
    assert_deploy_source_unchanged "Mac prepared activation"
    /bin/sh "$SCRIPT_DIR/deploy-plugin-worker-production.sh" \
      --env-file "$PRODUCTION_ENV_PATH" \
      --activate-prepared
    complete_unsealed_mac_bootstrap
    assert_deploy_source_unchanged "GCP prepared activation"
    if ! /bin/sh "$SCRIPT_DIR/deploy-web-production.sh" --activate-prepared; then
      echo "First prepared web activation attempt failed; retrying once to recover a lost SSH acknowledgement..." >&2
      /bin/sh "$SCRIPT_DIR/deploy-web-production.sh" --activate-prepared
    fi
    # Both required activation/health gates passed. Ignore process signals only
    # across the tiny durable-commit handoff so a TERM cannot land after the
    # fsynced complete journal but before the rollback trap is disarmed.
    trap '' INT TERM
    write_cutover_phase complete
    CUTOVER_PAUSED=0
    trap release_deploy_lock EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    echo "Mac runtime retained as a versioned rollback/audit artifact."
    if ! /bin/sh "$SCRIPT_DIR/status-production-workers.sh" --env-file "$PRODUCTION_ENV_PATH"; then
      echo "Warning: post-activation status reporting failed after the required health gates passed." >&2
    fi
  fi
else
  echo "Skipping web/worker/plugin activation."
fi

CUTOVER_PAUSED=0
trap release_deploy_lock EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ "$DRY_RUN" = "1" ]; then
  rm -rf "$CUTOVER_SNAPSHOT"
  release_deploy_lock
  trap - EXIT INT TERM
  echo "Production deployment dry run complete."
  exit 0
fi

DEPLOY_AUDIT_ROOT=${KRW_PRODUCTION_DEPLOYMENT_AUDIT_ROOT:-"$HOME/.local/share/krw-ontology/deployments"}
DEPLOY_AUDIT_DIR="$DEPLOY_AUDIT_ROOT/$NEXT_PUBLIC_APP_VERSION"
if [ -e "$DEPLOY_AUDIT_DIR" ]; then
  echo "CRITICAL: durable deployment audit entry already exists: $DEPLOY_AUDIT_DIR" >&2
  exit 1
fi
mkdir -p "$DEPLOY_AUDIT_ROOT" "$DEPLOY_AUDIT_DIR"
chmod 700 "$DEPLOY_AUDIT_ROOT" "$DEPLOY_AUDIT_DIR"
mv "$CUTOVER_SNAPSHOT" "$DEPLOY_AUDIT_DIR/cutover-snapshot"
MAC_RUNTIME_BASE=${KRW_MAC_RUNTIME_BASE:-"$HOME/.local/share/krw-ontology/mac-runtimes"}
MAC_RUNTIME_ROOT="$MAC_RUNTIME_BASE/$NEXT_PUBLIC_APP_VERSION"
RUNTIME_IDENTITY_SHA256=
if [ -f "$MAC_RUNTIME_ROOT/runtime-identity.json" ]; then
  RUNTIME_IDENTITY_SHA256=$(file_sha256 "$MAC_RUNTIME_ROOT/runtime-identity.json")
fi
export DEPLOY_AUDIT_DIR NEXT_PUBLIC_APP_VERSION DEPLOY_FRONT_SOURCE_SHA256
export EXPECTED_ONTOLOGY_SOURCE_SHA256 MAC_RUNTIME_ROOT RUNTIME_IDENTITY_SHA256
export GCP_RELEASE_REGISTRY_PATH="$CANONICAL_REMOTE_FRONT_DIR/.deploy/releases/$NEXT_PUBLIC_APP_VERSION"
export GCP_ROLLBACK_REGISTRY_PATH="$CANONICAL_REMOTE_FRONT_DIR/.deploy/code-rollback-$NEXT_PUBLIC_APP_VERSION"
export MIGRATIONS_PENDING APPLY_MIGRATIONS DEPLOY_CODE DEPLOY_DATA
export PINNED_SUPABASE_CLI_SHA256 PINNED_SUPABASE_GO_CLI_SHA256
node <<'NODE'
const fs = require("fs");
const path = require("path");
const payload = {
  format: "krw-production-deployment-audit/v1",
  deploymentId: process.env.NEXT_PUBLIC_APP_VERSION,
  completedAt: new Date().toISOString(),
  frontSourceSha256: process.env.DEPLOY_FRONT_SOURCE_SHA256,
  ontologySourceSha256: process.env.EXPECTED_ONTOLOGY_SOURCE_SHA256,
  macRuntimeRoot: process.env.MAC_RUNTIME_ROOT,
  macRuntimeIdentitySha256: process.env.RUNTIME_IDENTITY_SHA256 || null,
  gcpReleaseRegistryPath: process.env.GCP_RELEASE_REGISTRY_PATH,
  gcpRollbackRegistryPath: process.env.GCP_ROLLBACK_REGISTRY_PATH,
  migrationSnapshot: path.join(process.env.DEPLOY_AUDIT_DIR, "cutover-snapshot", "supabase"),
  supabaseCliSha256: process.env.PINNED_SUPABASE_CLI_SHA256,
  supabaseGoCliSha256: process.env.PINNED_SUPABASE_GO_CLI_SHA256,
  supabaseCliVersion: fs.readFileSync(path.join(process.env.DEPLOY_AUDIT_DIR, "cutover-snapshot", "tools", "supabase.version"), "utf8").trim(),
  migrationsWerePending: process.env.MIGRATIONS_PENDING === "1",
  migrationsApplied: process.env.MIGRATIONS_PENDING === "1" && process.env.APPLY_MIGRATIONS === "1",
  codeDeployed: process.env.DEPLOY_CODE === "1",
  dataPublished: process.env.DEPLOY_DATA === "1",
};
fs.writeFileSync(path.join(process.env.DEPLOY_AUDIT_DIR, "manifest.json"), `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o400 });
NODE
file_sha256 "$DEPLOY_AUDIT_DIR/manifest.json" >"$DEPLOY_AUDIT_DIR/manifest.sha256"
chmod 400 "$DEPLOY_AUDIT_DIR/manifest.sha256"
if [ -n "${KRW_DEPLOY_MANIFEST_SIGNING_KEY:-}" ]; then
  test -f "$KRW_DEPLOY_MANIFEST_SIGNING_KEY" || {
    echo "Configured deployment manifest signing key is missing." >&2
    exit 1
  }
  openssl dgst -sha256 -sign "$KRW_DEPLOY_MANIFEST_SIGNING_KEY" \
    -out "$DEPLOY_AUDIT_DIR/manifest.sig" "$DEPLOY_AUDIT_DIR/manifest.json"
  chmod 400 "$DEPLOY_AUDIT_DIR/manifest.sig"
fi
echo "Durable deployment audit entry: $DEPLOY_AUDIT_DIR"
release_deploy_lock
trap - EXIT INT TERM
echo "All requested production deployment steps complete."
