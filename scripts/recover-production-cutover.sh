#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/recover-production-cutover.sh --front-root ABSOLUTE_PATH --cutover-id ID --action resume|resume-remote|activate-prepared|abandon-prepared --previous-lock-owner OWNER

Verify the phase-bound recovery transaction before loading any production env,
then execute the sealed pause/resume controller from that transaction.
EOF
}

FRONT_ROOT=
CUTOVER_ID=
RECOVERY_ACTION=
PREVIOUS_LOCK_OWNER=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --front-root)
      FRONT_ROOT=${2:?Missing value for --front-root}
      shift
      ;;
    --cutover-id)
      CUTOVER_ID=${2:?Missing value for --cutover-id}
      shift
      ;;
    --action)
      RECOVERY_ACTION=${2:?Missing value for --action}
      shift
      ;;
    --previous-lock-owner)
      PREVIOUS_LOCK_OWNER=${2:?Missing value for --previous-lock-owner}
      shift
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

[ -n "$FRONT_ROOT" ] && [ -n "$CUTOVER_ID" ] \
  && [ -n "$RECOVERY_ACTION" ] && [ -n "$PREVIOUS_LOCK_OWNER" ] || {
  usage >&2
  exit 1
}
case "$FRONT_ROOT" in
  /*) ;;
  *) echo "Recovery front root must be absolute." >&2; exit 1 ;;
esac
case "$CUTOVER_ID" in
  ''|*[!A-Za-z0-9._-]*) echo "Invalid recovery cutover id." >&2; exit 1 ;;
esac
case "$RECOVERY_ACTION" in
  resume|resume-remote|activate-prepared|abandon-prepared) ;;
  *) echo "Invalid recovery action." >&2; exit 1 ;;
esac
case "$PREVIOUS_LOCK_OWNER" in
  ''|*[!A-Za-z0-9._:-]*) echo "Invalid previous lock owner." >&2; exit 1 ;;
esac

command -v node >/dev/null 2>&1 || {
  echo "Missing node for sealed cutover recovery." >&2
  exit 1
}
command -v shasum >/dev/null 2>&1 || {
  echo "Missing shasum for sealed cutover recovery." >&2
  exit 1
}

FRONT_ROOT=$(CDPATH= cd -- "$FRONT_ROOT" && pwd -P)
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
SNAPSHOT_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
EXPECTED_SNAPSHOT_ROOT="$FRONT_ROOT/.deploy/cutover-$CUTOVER_ID"
test -d "$EXPECTED_SNAPSHOT_ROOT" || {
  echo "Missing interrupted cutover snapshot: $EXPECTED_SNAPSHOT_ROOT" >&2
  exit 1
}
EXPECTED_SNAPSHOT_ROOT=$(CDPATH= cd -- "$EXPECTED_SNAPSHOT_ROOT" && pwd -P)
[ "$SNAPSHOT_ROOT" = "$EXPECTED_SNAPSHOT_ROOT" ] || {
  echo "Recovery driver is not executing from the requested cutover snapshot." >&2
  exit 1
}

PHASE_FILE="$FRONT_ROOT/.deploy/cutover-phase-$CUTOVER_ID.env"
RECOVERY_SEAL="$SNAPSHOT_ROOT/recovery-seal.json"
test -f "$PHASE_FILE" && [ ! -L "$PHASE_FILE" ] || {
  echo "Missing regular durable cutover phase record." >&2
  exit 1
}
test -f "$RECOVERY_SEAL" && [ ! -L "$RECOVERY_SEAL" ] || {
  echo "Missing regular recovery seal." >&2
  exit 1
}

# Parse the journal as data, never as shell. Unknown and duplicate fields are
# rejected so an interrupted transaction cannot smuggle executable syntax into
# the recovery bootstrap.
node - "$PHASE_FILE" "$CUTOVER_ID" "$RECOVERY_SEAL" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [phasePath, deploymentId, recoverySealPath] = process.argv.slice(2);
const allowed = new Set([
  "FORMAT", "DEPLOYMENT_ID", "LOCK_OWNER", "PHASE", "UPDATED_AT",
  "ORIGINAL_LOCK_OWNER", "PREVIOUS_LOCK_OWNER", "ADOPTED_AT",
  "RECOVERY_SEAL_PATH", "RECOVERY_SEAL_SHA256",
  "PRODUCTION_ENV_PATH", "PRODUCTION_ENV_SHA256",
  "MAC_SNAPSHOT_SEAL_PATH", "MAC_SNAPSHOT_SEAL_SHA256",
  "CANDIDATE_MAC_RUNTIME_SEAL_PATH", "CANDIDATE_MAC_RUNTIME_SEAL_SHA256",
  "MIGRATION_INCLUDE_ALL",
]);
const fields = new Map();
for (const line of fs.readFileSync(phasePath, "utf8").split(/\r?\n/)) {
  if (!line) continue;
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (!match || !allowed.has(match[1]) || fields.has(match[1])) {
    throw new Error("Invalid or duplicate cutover phase field");
  }
  if (/[\r\n\0]/.test(match[2])) throw new Error("Invalid cutover phase value");
  fields.set(match[1], match[2]);
}
for (const key of [
  "FORMAT", "DEPLOYMENT_ID", "LOCK_OWNER", "PHASE", "UPDATED_AT",
  "RECOVERY_SEAL_PATH", "RECOVERY_SEAL_SHA256",
  "PRODUCTION_ENV_PATH", "PRODUCTION_ENV_SHA256",
]) {
  if (!fields.get(key)) throw new Error(`Missing cutover phase field: ${key}`);
}
if (fields.get("FORMAT") !== "krw-production-cutover-phase/v1") {
  throw new Error("Invalid cutover phase format");
}
if (fields.get("DEPLOYMENT_ID") !== deploymentId) {
  throw new Error("Cutover phase deployment mismatch");
}
if (path.resolve(fields.get("RECOVERY_SEAL_PATH")) !== path.resolve(recoverySealPath)) {
  throw new Error("Cutover phase recovery seal path mismatch");
}
for (const key of ["RECOVERY_SEAL_SHA256", "PRODUCTION_ENV_SHA256"]) {
  if (!/^[a-f0-9]{64}$/.test(fields.get(key))) {
    throw new Error(`Invalid digest in cutover phase: ${key}`);
  }
}
const hasMacSealPath = fields.has("MAC_SNAPSHOT_SEAL_PATH");
const hasMacSealDigest = fields.has("MAC_SNAPSHOT_SEAL_SHA256");
if (hasMacSealPath !== hasMacSealDigest) {
  throw new Error("Incomplete Mac snapshot seal binding");
}
const hasCandidateSealPath = fields.has("CANDIDATE_MAC_RUNTIME_SEAL_PATH");
const hasCandidateSealDigest = fields.has("CANDIDATE_MAC_RUNTIME_SEAL_SHA256");
if (hasCandidateSealPath !== hasCandidateSealDigest) {
  throw new Error("Incomplete Mac candidate seal binding");
}
if (hasCandidateSealPath &&
    (!path.isAbsolute(fields.get("CANDIDATE_MAC_RUNTIME_SEAL_PATH")) ||
     !/^[a-f0-9]{64}$/.test(fields.get("CANDIDATE_MAC_RUNTIME_SEAL_SHA256")))) {
  throw new Error("Invalid Mac candidate seal binding");
}
if (hasMacSealPath &&
    (!path.isAbsolute(fields.get("MAC_SNAPSHOT_SEAL_PATH")) ||
     !/^[a-f0-9]{64}$/.test(fields.get("MAC_SNAPSHOT_SEAL_SHA256")))) {
  throw new Error("Invalid Mac snapshot seal binding");
}
if (!path.isAbsolute(fields.get("PRODUCTION_ENV_PATH"))) {
  throw new Error("Cutover phase production env path must be absolute");
}
if (!/^[01]$/.test(fields.get("MIGRATION_INCLUDE_ALL") ?? "")) {
  throw new Error("Invalid or missing migration include-all binding");
}
NODE

phase_value() {
  key=$1
  sed -n "s/^$key=//p" "$PHASE_FILE"
}
PHASE_RECOVERY_SEAL_PATH=$(phase_value RECOVERY_SEAL_PATH)
PHASE_RECOVERY_SEAL_SHA256=$(phase_value RECOVERY_SEAL_SHA256)
PHASE_ENV_PATH=$(phase_value PRODUCTION_ENV_PATH)
PHASE_ENV_SHA256=$(phase_value PRODUCTION_ENV_SHA256)
[ "$PHASE_RECOVERY_SEAL_PATH" = "$RECOVERY_SEAL" ] || {
  echo "Phase journal does not name this recovery seal." >&2
  exit 1
}
[ "$(shasum -a 256 "$RECOVERY_SEAL" | awk '{print $1}')" \
  = "$PHASE_RECOVERY_SEAL_SHA256" ] || {
  echo "Phase-bound recovery seal digest mismatch." >&2
  exit 1
}

SEALED_VERIFIER="$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs"
SEALED_PAUSE_CONTROLLER="$SCRIPT_DIR/pause-production-cutover.sh"
SEALED_WEB_ACTIVATOR="$SCRIPT_DIR/deploy-web-production.sh"
SEALED_TARGET="$SNAPSHOT_ROOT/ops/production-target.json"
test -f "$SEALED_VERIFIER" && test -x "$SEALED_PAUSE_CONTROLLER"
if [ "$RECOVERY_ACTION" = activate-prepared ] \
  || [ "$RECOVERY_ACTION" = abandon-prepared ]; then
  test -x "$SEALED_WEB_ACTIVATOR"
fi

if [ "$RECOVERY_ACTION" = activate-prepared ]; then
  # Candidate activation can cross or complete the migration boundary, so it
  # deliberately retains the full recovery TCB and every pinned migration
  # input. No corrupt candidate or CLI byte may be ignored on this action.
  node "$SEALED_VERIFIER" verify \
    --marker "$RECOVERY_SEAL" \
    --symlink-boundary "$SNAPSHOT_ROOT" \
    --path "$SNAPSHOT_ROOT/cutover-input-seal.json" \
    --path "$SNAPSHOT_ROOT/cutover-helper-seal.json" \
    --path "$SCRIPT_DIR/pause-production-cutover.sh" \
    --path "$SCRIPT_DIR/recover-production-cutover.sh" \
    --path "$SCRIPT_DIR/deploy-web-production.sh" \
    --path "$SCRIPT_DIR/compute-admin-email-set-sha256.mjs" \
    --path "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs" \
    --path "$SCRIPT_DIR/uninstall-mac-worker-launchd.sh" \
    --path "$SCRIPT_DIR/uninstall-mcp-server-launchd.sh" \
    --path "$SCRIPT_DIR/uninstall-stock-news-mcp-launchd.sh" \
    --path "$SEALED_TARGET" \
    --path "$SNAPSHOT_ROOT/production-env.path" \
    --path "$SNAPSHOT_ROOT/production-env.sha256" \
    --path "$PHASE_ENV_PATH" \
    --path "$SNAPSHOT_ROOT/tools/supabase" \
    --path "$SNAPSHOT_ROOT/tools/supabase.sha256" \
    --path "$SNAPSHOT_ROOT/tools/supabase-go" \
    --path "$SNAPSHOT_ROOT/tools/supabase-go.sha256" >/dev/null
else
  # Old-runtime recovery needs only the sealed recovery controller, its
  # verifier, canonical target, and env provenance. Abandonment additionally
  # needs the candidate lifecycle helpers, but never the migration CLIs.
  set -- verify \
    --marker "$RECOVERY_SEAL" \
    --symlink-boundary "$SNAPSHOT_ROOT" \
    --root-subset \
    --path "$SCRIPT_DIR/pause-production-cutover.sh" \
    --path "$SCRIPT_DIR/recover-production-cutover.sh" \
    --path "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs" \
    --path "$SEALED_TARGET" \
    --path "$SNAPSHOT_ROOT/production-env.path" \
    --path "$SNAPSHOT_ROOT/production-env.sha256" \
    --path "$PHASE_ENV_PATH"
  if [ "$RECOVERY_ACTION" = abandon-prepared ]; then
    set -- "$@" \
      --path "$SCRIPT_DIR/deploy-web-production.sh" \
      --path "$SCRIPT_DIR/compute-admin-email-set-sha256.mjs"
  fi
  node "$SEALED_VERIFIER" "$@" >/dev/null
fi

# Only after the master recovery seal passes may these provenance files be
# interpreted. The external env remains a regular immutable file and its exact
# bytes are checked before the sealed pause controller is allowed to source it.
node - \
  "$SNAPSHOT_ROOT/production-env.path" \
  "$SNAPSHOT_ROOT/production-env.sha256" \
  "$PHASE_ENV_PATH" \
  "$PHASE_ENV_SHA256" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const [pathFile, digestFile, expectedPath, expectedDigest] = process.argv.slice(2);
const parseOneLine = (file) => {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.endsWith("\n") ? text.slice(0, -1).split("\n") : [];
  if (lines.length !== 1 || !lines[0] || /[\r\n\0]/.test(lines[0])) {
    throw new Error(`Invalid one-line recovery provenance file: ${file}`);
  }
  return lines[0];
};
const recordedPath = parseOneLine(pathFile);
const recordedDigest = parseOneLine(digestFile);
if (!path.isAbsolute(recordedPath) || recordedPath !== expectedPath) {
  throw new Error("Sealed production env path differs from the phase journal");
}
if (!/^[a-f0-9]{64}$/.test(recordedDigest) || recordedDigest !== expectedDigest) {
  throw new Error("Sealed production env digest differs from the phase journal");
}
NODE
test -f "$PHASE_ENV_PATH" && [ ! -L "$PHASE_ENV_PATH" ] || {
  echo "Pinned production env must be a regular non-symlink file." >&2
  exit 1
}
RESOLVED_ENV_PATH=$(node -e 'process.stdout.write(require("fs").realpathSync(process.argv[1]))' "$PHASE_ENV_PATH")
[ "$RESOLVED_ENV_PATH" = "$PHASE_ENV_PATH" ] || {
  echo "Pinned production env path is not canonical." >&2
  exit 1
}
[ "$(shasum -a 256 "$PHASE_ENV_PATH" | awk '{print $1}')" = "$PHASE_ENV_SHA256" ] || {
  echo "Pinned production env changed before recovery." >&2
  exit 1
}
if [ "$RECOVERY_ACTION" = activate-prepared ]; then
  SEALED_CLI_SHA=$(sed -n '1p' "$SNAPSHOT_ROOT/tools/supabase.sha256")
  printf '%s' "$SEALED_CLI_SHA" | grep -Eq '^[a-f0-9]{64}$' || {
    echo "Invalid sealed Supabase CLI digest." >&2
    exit 1
  }
  [ "$(shasum -a 256 "$SNAPSHOT_ROOT/tools/supabase" | awk '{print $1}')" = "$SEALED_CLI_SHA" ] || {
    echo "Pinned Supabase CLI changed before recovery." >&2
    exit 1
  }
  SEALED_GO_CLI_SHA=$(sed -n '1p' "$SNAPSHOT_ROOT/tools/supabase-go.sha256")
  printf '%s' "$SEALED_GO_CLI_SHA" | grep -Eq '^[a-f0-9]{64}$' || {
    echo "Invalid sealed Supabase CLI companion digest." >&2
    exit 1
  }
  [ "$(shasum -a 256 "$SNAPSHOT_ROOT/tools/supabase-go" | awk '{print $1}')" = "$SEALED_GO_CLI_SHA" ] || {
    echo "Pinned Supabase CLI companion changed before recovery." >&2
    exit 1
  }
fi

[ "${PRODUCTION_OS_LOCK_HELD:-0}" = 1 ] || {
  echo "Sealed recovery requires the kernel-held production lock." >&2
  exit 1
}
case "${PRODUCTION_DEPLOY_LOCK_OWNER:-}" in
  ''|*[!A-Za-z0-9._:-]*) echo "Invalid current production lock owner." >&2; exit 1 ;;
esac
LOCK_OWNER_FILE="$FRONT_ROOT/.deploy/production-deploy.lock/owner"
test -f "$LOCK_OWNER_FILE"
[ "$(sed -n '1p' "$LOCK_OWNER_FILE")" = "$PRODUCTION_DEPLOY_LOCK_OWNER" ] || {
  echo "Sealed recovery lock owner mismatch." >&2
  exit 1
}

NEXT_PUBLIC_APP_VERSION=$CUTOVER_ID
PRODUCTION_ORCHESTRATOR_ATTESTATION="$CUTOVER_ID:$PRODUCTION_DEPLOY_LOCK_OWNER"
PRODUCTION_UNSEALED_BOOTSTRAP_ATTESTATION=
if [ "$RECOVERY_ACTION" = resume-remote ]; then
  PRODUCTION_UNSEALED_BOOTSTRAP_ATTESTATION=$PRODUCTION_ORCHESTRATOR_ATTESTATION
fi
export NEXT_PUBLIC_APP_VERSION PRODUCTION_ORCHESTRATOR_ATTESTATION
export PRODUCTION_UNSEALED_BOOTSTRAP_ATTESTATION

exec "$SEALED_PAUSE_CONTROLLER" "$RECOVERY_ACTION" \
  --front-root "$FRONT_ROOT" \
  --canonical-target-file "$SEALED_TARGET" \
  --env-file "$PHASE_ENV_PATH" \
  --expected-env-sha256 "$PHASE_ENV_SHA256" \
  --adopt-previous-lock-owner "$PREVIOUS_LOCK_OWNER"
