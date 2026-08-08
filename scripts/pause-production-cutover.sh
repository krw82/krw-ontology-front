#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/pause-production-cutover.sh <pause|resume|resume-remote|activate-prepared|abandon-prepared> [--env-file FILE] [--fail-closed-repause] [--allow-unsealed-first-cutover] [--adopt-previous-lock-owner OWNER] [--front-root ABSOLUTE_PATH] [--expected-env-sha256 HEX] [--canonical-target-file ABSOLUTE_PATH] [--dry-run]

Pause every production process that can execute or expose application code
while a destructive Supabase migration is applied. Redis remains up; public
traffic stays closed until the prepared runtime passes private deep health.

The resume command is only a pre-migration failure recovery mechanism. Once a
schema-changing migration succeeds, activate the prepared artifacts instead of
restarting the old runtime.

--fail-closed-repause is an internal recovery mode used after migration has
started. It preserves and verifies the original rollback snapshot, then stops
any partially activated runtime without expecting the old runtime to still be
running.

--allow-unsealed-first-cutover is an orchestrator-attested, one-time bridge
for a legacy Mac launchd runtime whose exact running bytes cannot be restored.
It is valid only for pause. After this boundary the legacy Mac runtime is never
restarted; pre-migration recovery restores only the exact sealed GCP runtime.

resume-remote restores only the exact sealed GCP rollback transaction. It is
an internal recovery action for that one-time bridge and never starts Mac
launchd services.

--adopt-previous-lock-owner explicitly adopts an interrupted pre-migration
recovery after SIGKILL/reboot. It is accepted only by resume/resume-remote,
under a new kernel lock, after every local and remote rollback seal is checked.

--front-root, --expected-env-sha256, and --canonical-target-file are the sealed
recovery-child interface. They are accepted only by resume/resume-remote and
must be supplied together. The controller script and artifact verifier remain
the copies next to this script; only production state paths use --front-root.
EOF
}

ACTION=${1:-}
case "$ACTION" in
  pause|resume|resume-remote|activate-prepared|abandon-prepared) shift ;;
  --help|-h) usage; exit 0 ;;
  *) usage >&2; exit 1 ;;
esac

ENV_FILE=.env.mac-worker.production
DRY_RUN=0
FAIL_CLOSED_REPAUSE=0
ALLOW_UNSEALED_FIRST_CUTOVER=0
ADOPT_PREVIOUS_LOCK_OWNER=
RECOVERY_FRONT_ROOT=
EXPECTED_ENV_SHA256=
CANONICAL_TARGET_FILE_ARG=
TAB=$(printf '\t')
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE=${2:?Missing value for --env-file}
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --fail-closed-repause)
      FAIL_CLOSED_REPAUSE=1
      ;;
    --allow-unsealed-first-cutover)
      ALLOW_UNSEALED_FIRST_CUTOVER=1
      ;;
    --adopt-previous-lock-owner)
      ADOPT_PREVIOUS_LOCK_OWNER=${2:?Missing value for --adopt-previous-lock-owner}
      shift
      ;;
    --front-root)
      RECOVERY_FRONT_ROOT=${2:?Missing value for --front-root}
      shift
      ;;
    --expected-env-sha256)
      EXPECTED_ENV_SHA256=${2:?Missing value for --expected-env-sha256}
      shift
      ;;
    --canonical-target-file)
      CANONICAL_TARGET_FILE_ARG=${2:?Missing value for --canonical-target-file}
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

if [ "$FAIL_CLOSED_REPAUSE" = "1" ] && [ "$ACTION" != "pause" ]; then
  echo "--fail-closed-repause is valid only with pause." >&2
  exit 1
fi
if [ "$ALLOW_UNSEALED_FIRST_CUTOVER" = "1" ] && [ "$ACTION" != "pause" ]; then
  echo "--allow-unsealed-first-cutover is valid only with pause." >&2
  exit 1
fi
if [ "$ALLOW_UNSEALED_FIRST_CUTOVER" = "1" ] && [ "$FAIL_CLOSED_REPAUSE" = "1" ]; then
  echo "--allow-unsealed-first-cutover cannot be combined with --fail-closed-repause." >&2
  exit 1
fi
if [ -n "$ADOPT_PREVIOUS_LOCK_OWNER" ] \
  && [ "$ACTION" != resume ] && [ "$ACTION" != resume-remote ] \
  && [ "$ACTION" != activate-prepared ] && [ "$ACTION" != abandon-prepared ]; then
  echo "--adopt-previous-lock-owner is valid only with a sealed recovery action." >&2
  exit 1
fi
if [ -n "$RECOVERY_FRONT_ROOT" ] || [ -n "$EXPECTED_ENV_SHA256" ] \
  || [ -n "$CANONICAL_TARGET_FILE_ARG" ]; then
  [ -n "$RECOVERY_FRONT_ROOT" ] && [ -n "$EXPECTED_ENV_SHA256" ] \
    && [ -n "$CANONICAL_TARGET_FILE_ARG" ] || {
    echo "The sealed cutover interface requires --front-root, --expected-env-sha256, and --canonical-target-file together." >&2
    exit 1
  }
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
if [ -n "$RECOVERY_FRONT_ROOT" ]; then
  case "$RECOVERY_FRONT_ROOT" in
    /*) ;;
    *) echo "--front-root must be an absolute path." >&2; exit 1 ;;
  esac
  test -d "$RECOVERY_FRONT_ROOT" || {
    echo "--front-root does not name an existing directory." >&2
    exit 1
  }
  RESOLVED_RECOVERY_FRONT_ROOT=$(CDPATH= cd -- "$RECOVERY_FRONT_ROOT" && pwd -P)
  [ "$RECOVERY_FRONT_ROOT" = "$RESOLVED_RECOVERY_FRONT_ROOT" ] || {
    echo "--front-root must already be its strict physical realpath." >&2
    exit 1
  }
  FRONT_DIR=$RESOLVED_RECOVERY_FRONT_ROOT
else
  FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
fi
if [ -n "$CANONICAL_TARGET_FILE_ARG" ]; then
  case "$CANONICAL_TARGET_FILE_ARG" in
    /*) ;;
    *) echo "--canonical-target-file must be an absolute path." >&2; exit 1 ;;
  esac
  test -f "$CANONICAL_TARGET_FILE_ARG" || {
    echo "--canonical-target-file does not name an existing regular file." >&2
    exit 1
  }
  RESOLVED_CANONICAL_TARGET_FILE=$(node -e '
    const fs = require("fs");
    process.stdout.write(fs.realpathSync(process.argv[1]));
  ' "$CANONICAL_TARGET_FILE_ARG")
  [ "$CANONICAL_TARGET_FILE_ARG" = "$RESOLVED_CANONICAL_TARGET_FILE" ] || {
    echo "--canonical-target-file must already be its strict realpath." >&2
    exit 1
  }
  CANONICAL_TARGET_FILE=$RESOLVED_CANONICAL_TARGET_FILE
else
  CANONICAL_TARGET_FILE="$FRONT_DIR/ops/production-target.json"
fi
test -f "$CANONICAL_TARGET_FILE" || {
  echo "Missing canonical production target: $CANONICAL_TARGET_FILE" >&2
  exit 1
}
target_value() {
  node -e '
    const target = require(process.argv[1]);
    const value = target[process.argv[2]];
    if (typeof value !== "string" || !value) process.exit(1);
    process.stdout.write(value);
  ' "$CANONICAL_TARGET_FILE" "$1"
}
CANONICAL_GCP_PROJECT=$(target_value gcpProject)
CANONICAL_GCP_INSTANCE=$(target_value gcpInstance)
CANONICAL_GCP_ZONE=$(target_value gcpZone)
CANONICAL_GCP_INSTANCE_ID=$(target_value gcpInstanceId)
CANONICAL_SUPABASE_PROJECT_REF=$(target_value supabaseProjectRef)
CANONICAL_REMOTE_FRONT_DIR=$(target_value remoteFrontDir)
CANONICAL_REMOTE_ONTOLOGY_DIR=$(target_value remoteOntologyDir)
CANONICAL_COMPOSE_PROJECT=$(target_value composeProject)
CANONICAL_SITE_ORIGIN=$(node -e '
  const target = require(process.argv[1]);
  if (!Array.isArray(target.siteOrigins) || target.siteOrigins.length < 2) process.exit(1);
  process.stdout.write(target.siteOrigins[0]);
' "$CANONICAL_TARGET_FILE")
CANONICAL_WWW_ORIGIN=$(node -e '
  const target = require(process.argv[1]);
  if (!Array.isArray(target.siteOrigins) || target.siteOrigins.length < 2) process.exit(1);
  process.stdout.write(target.siteOrigins[1]);
' "$CANONICAL_TARGET_FILE")
for pair in \
  "GCP_PROJECT:${GCP_PROJECT:-}:$CANONICAL_GCP_PROJECT" \
  "GCP_INSTANCE:${GCP_INSTANCE:-}:$CANONICAL_GCP_INSTANCE" \
  "GCP_ZONE:${GCP_ZONE:-}:$CANONICAL_GCP_ZONE" \
  "REMOTE_FRONT_DIR:${REMOTE_FRONT_DIR:-}:$CANONICAL_REMOTE_FRONT_DIR" \
  "COMPOSE_PROJECT_NAME:${COMPOSE_PROJECT_NAME:-}:$CANONICAL_COMPOSE_PROJECT"
do
  key=${pair%%:*}
  remainder=${pair#*:}
  supplied=${remainder%%:*}
  expected=${remainder#*:}
  if [ -n "$supplied" ] && [ "$supplied" != "$expected" ]; then
    echo "$key conflicts with ops/production-target.json." >&2
    exit 1
  fi
done
GCP_PROJECT=$CANONICAL_GCP_PROJECT
GCP_INSTANCE=$CANONICAL_GCP_INSTANCE
GCP_ZONE=$CANONICAL_GCP_ZONE
REMOTE_FRONT_DIR=$CANONICAL_REMOTE_FRONT_DIR
REMOTE_ONTOLOGY_DIR=$CANONICAL_REMOTE_ONTOLOGY_DIR
COMPOSE_PROJECT_NAME=$CANONICAL_COMPOSE_PROJECT
REMOTE_ENV_FILE=${REMOTE_ENV_FILE:-.env}
REMOTE_PAUSE_SERVICES="reverse-proxy web llm-gateway document-worker document-outbox-dispatcher filings-mcp filing-notification-worker filing-brief-worker billing-worker"
REMOTE_PAUSE_APPLICATION_SERVICES="web llm-gateway document-worker document-outbox-dispatcher filings-mcp filing-notification-worker filing-brief-worker billing-worker"
# Production agent and ontology execution belongs exclusively to the Mac
# launchd supervisors; the GCP sidecars are no longer part of this topology.
REMOTE_RESUME_SERVICES="web llm-gateway document-worker document-outbox-dispatcher filings-mcp filing-notification-worker filing-brief-worker billing-worker reverse-proxy"
CUTOVER_STATE_FILE="$FRONT_DIR/.deploy/paused-runtime-${NEXT_PUBLIC_APP_VERSION:-manual}.tsv"
PLIST_SNAPSHOT_DIR="$FRONT_DIR/.deploy/paused-plists-${NEXT_PUBLIC_APP_VERSION:-manual}"
REMOTE_ROLLBACK_DIR="$REMOTE_FRONT_DIR/.deploy/code-rollback-${NEXT_PUBLIC_APP_VERSION:-manual}"
LAUNCHD_DOMAIN="gui/$(id -u)"

case "$ENV_FILE" in
  /*) ENV_PATH=$ENV_FILE ;;
  *) ENV_PATH="$FRONT_DIR/$ENV_FILE" ;;
esac
test -f "$ENV_PATH" || {
  echo "Missing Mac worker env file: $ENV_PATH" >&2
  exit 1
}
RESOLVED_ENV_PATH=$(node -e '
  const fs = require("fs");
  process.stdout.write(fs.realpathSync(process.argv[1]));
' "$ENV_PATH")
ENV_PATH=$RESOLVED_ENV_PATH
if [ -n "$EXPECTED_ENV_SHA256" ]; then
  printf '%s' "$EXPECTED_ENV_SHA256" | grep -Eq '^[a-f0-9]{64}$' || {
    echo "--expected-env-sha256 must be a lowercase SHA-256 digest." >&2
    exit 1
  }
  ACTUAL_ENV_SHA256=$(shasum -a 256 "$ENV_PATH" | awk '{print $1}')
  [ "$ACTUAL_ENV_SHA256" = "$EXPECTED_ENV_SHA256" ] || {
    echo "Recovery env bytes do not match --expected-env-sha256." >&2
    exit 1
  }
fi

if [ "$DRY_RUN" = "1" ]; then
  if [ "$ACTION" = "pause" ]; then
    if [ "$FAIL_CLOSED_REPAUSE" = "1" ]; then
      echo "Dry run: would verify the existing rollback snapshot and stop any partially activated Mac/GCP runtime."
    else
      echo "Dry run: would stop the Mac agent supervisor and production MCP services while preserving launchd plists."
    fi
    if [ "$ALLOW_UNSEALED_FIRST_CUTOVER" = "1" ]; then
      echo "Dry run: would verify the one-time legacy Mac boundary and permanently refuse an inexact legacy restart after pause."
    fi
    echo "Dry run: would stop remote services: $REMOTE_PAUSE_SERVICES"
    echo "Dry run: would verify that no paused process or local MCP listener remains running."
  elif [ "$ACTION" = "resume" ]; then
    echo "Dry run: would restart the pre-migration Mac MCP/agent runtime and remote services: $REMOTE_RESUME_SERVICES"
    echo "Dry run: would keep production agent and ontology execution on the Mac runtime."
  elif [ "$ACTION" = "activate-prepared" ]; then
    echo "Dry run: would fail-close partial runtimes, then idempotently activate the sealed Mac and GCP candidates."
  elif [ "$ACTION" = "abandon-prepared" ]; then
    echo "Dry run: would retire a fully sealed pre-pause candidate without stopping a production runtime."
  else
    echo "Dry run: would restore only the exact sealed GCP rollback transaction and leave every Mac launchd service stopped."
  fi
  exit 0
fi

command -v gcloud >/dev/null 2>&1 || {
  echo "Missing required command: gcloud" >&2
  exit 1
}
ACTUAL_GCP_INSTANCE_ID=$(gcloud compute instances describe "$GCP_INSTANCE" \
  --project="$GCP_PROJECT" \
  --zone="$GCP_ZONE" \
  --format='value(id)')
if [ "$ACTUAL_GCP_INSTANCE_ID" != "$CANONICAL_GCP_INSTANCE_ID" ]; then
  echo "Canonical production VM identity mismatch before cutover pause/resume." >&2
  exit 1
fi
CONTROL_ACTION=$ACTION
CONTROL_DRY_RUN=$DRY_RUN
CONTROL_FAIL_CLOSED_REPAUSE=$FAIL_CLOSED_REPAUSE
CONTROL_ALLOW_UNSEALED_FIRST_CUTOVER=$ALLOW_UNSEALED_FIRST_CUTOVER
CONTROL_ADOPT_PREVIOUS_LOCK_OWNER=$ADOPT_PREVIOUS_LOCK_OWNER
CONTROL_RECOVERY_FRONT_ROOT=$RECOVERY_FRONT_ROOT
CONTROL_EXPECTED_ENV_SHA256=$EXPECTED_ENV_SHA256
CONTROL_CANONICAL_TARGET_FILE=$CANONICAL_TARGET_FILE
CONTROL_SCRIPT_DIR=$SCRIPT_DIR
CONTROL_FRONT_DIR=$FRONT_DIR
CONTROL_ENV_PATH=$ENV_PATH
CONTROL_GCP_PROJECT=$GCP_PROJECT
CONTROL_GCP_INSTANCE=$GCP_INSTANCE
CONTROL_GCP_ZONE=$GCP_ZONE
CONTROL_REMOTE_FRONT_DIR=$REMOTE_FRONT_DIR
CONTROL_REMOTE_ONTOLOGY_DIR=$REMOTE_ONTOLOGY_DIR
CONTROL_COMPOSE_PROJECT_NAME=$COMPOSE_PROJECT_NAME
CONTROL_REMOTE_ENV_FILE=$REMOTE_ENV_FILE
CONTROL_DEPLOYMENT_VERSION=${NEXT_PUBLIC_APP_VERSION:-manual}
CONTROL_CANONICAL_GCP_INSTANCE_ID=$CANONICAL_GCP_INSTANCE_ID
CONTROL_CANONICAL_SUPABASE_PROJECT_REF=$CANONICAL_SUPABASE_PROJECT_REF
CONTROL_CANONICAL_SITE_ORIGIN=$CANONICAL_SITE_ORIGIN
CONTROL_CANONICAL_WWW_ORIGIN=$CANONICAL_WWW_ORIGIN
CONTROL_REMOTE_PAUSE_SERVICES=$REMOTE_PAUSE_SERVICES
CONTROL_REMOTE_PAUSE_APPLICATION_SERVICES=$REMOTE_PAUSE_APPLICATION_SERVICES
CONTROL_REMOTE_RESUME_SERVICES=$REMOTE_RESUME_SERVICES
CONTROL_LAUNCHD_DOMAIN=$LAUNCHD_DOMAIN
CONTROL_PATH=$PATH
CONTROL_HOME=$HOME
CONTROL_DEPLOY_LOCK_OWNER=${PRODUCTION_DEPLOY_LOCK_OWNER:-}
CONTROL_OS_LOCK_HELD=${PRODUCTION_OS_LOCK_HELD:-0}
CONTROL_UNSEALED_BOOTSTRAP_ATTESTATION=${PRODUCTION_UNSEALED_BOOTSTRAP_ATTESTATION:-}
CONTROL_ORCHESTRATOR_ATTESTATION=${PRODUCTION_ORCHESTRATOR_ATTESTATION:-}
CONTROL_EXPECTED_FRONT_SOURCE_SHA256=${EXPECTED_FRONT_SOURCE_SHA256:-}
CONTROL_EXPECTED_ONTOLOGY_SOURCE_SHA256=${EXPECTED_ONTOLOGY_SOURCE_SHA256:-}
readonly CONTROL_ACTION CONTROL_DRY_RUN CONTROL_FAIL_CLOSED_REPAUSE CONTROL_SCRIPT_DIR
readonly CONTROL_ALLOW_UNSEALED_FIRST_CUTOVER
readonly CONTROL_ADOPT_PREVIOUS_LOCK_OWNER
readonly CONTROL_RECOVERY_FRONT_ROOT CONTROL_EXPECTED_ENV_SHA256
readonly CONTROL_CANONICAL_TARGET_FILE
readonly CONTROL_FRONT_DIR CONTROL_ENV_PATH CONTROL_GCP_PROJECT CONTROL_GCP_INSTANCE
readonly CONTROL_GCP_ZONE CONTROL_REMOTE_FRONT_DIR CONTROL_REMOTE_ONTOLOGY_DIR
readonly CONTROL_COMPOSE_PROJECT_NAME CONTROL_REMOTE_ENV_FILE CONTROL_DEPLOYMENT_VERSION
readonly CONTROL_CANONICAL_GCP_INSTANCE_ID CONTROL_CANONICAL_SUPABASE_PROJECT_REF
readonly CONTROL_CANONICAL_SITE_ORIGIN CONTROL_CANONICAL_WWW_ORIGIN
readonly CONTROL_REMOTE_PAUSE_SERVICES CONTROL_REMOTE_PAUSE_APPLICATION_SERVICES
readonly CONTROL_REMOTE_RESUME_SERVICES
readonly CONTROL_LAUNCHD_DOMAIN CONTROL_PATH CONTROL_HOME
readonly CONTROL_DEPLOY_LOCK_OWNER CONTROL_OS_LOCK_HELD
readonly CONTROL_UNSEALED_BOOTSTRAP_ATTESTATION
readonly CONTROL_ORCHESTRATOR_ATTESTATION
readonly CONTROL_EXPECTED_FRONT_SOURCE_SHA256 CONTROL_EXPECTED_ONTOLOGY_SOURCE_SHA256
set -a
# shellcheck disable=SC1090
. "$ENV_PATH"
set +a
ACTION=$CONTROL_ACTION
DRY_RUN=$CONTROL_DRY_RUN
FAIL_CLOSED_REPAUSE=$CONTROL_FAIL_CLOSED_REPAUSE
ALLOW_UNSEALED_FIRST_CUTOVER=$CONTROL_ALLOW_UNSEALED_FIRST_CUTOVER
ADOPT_PREVIOUS_LOCK_OWNER=$CONTROL_ADOPT_PREVIOUS_LOCK_OWNER
RECOVERY_FRONT_ROOT=$CONTROL_RECOVERY_FRONT_ROOT
EXPECTED_ENV_SHA256=$CONTROL_EXPECTED_ENV_SHA256
CANONICAL_TARGET_FILE=$CONTROL_CANONICAL_TARGET_FILE
SCRIPT_DIR=$CONTROL_SCRIPT_DIR
FRONT_DIR=$CONTROL_FRONT_DIR
ENV_PATH=$CONTROL_ENV_PATH
GCP_PROJECT=$CONTROL_GCP_PROJECT
GCP_INSTANCE=$CONTROL_GCP_INSTANCE
GCP_ZONE=$CONTROL_GCP_ZONE
REMOTE_FRONT_DIR=$CONTROL_REMOTE_FRONT_DIR
REMOTE_ONTOLOGY_DIR=$CONTROL_REMOTE_ONTOLOGY_DIR
COMPOSE_PROJECT_NAME=$CONTROL_COMPOSE_PROJECT_NAME
REMOTE_ENV_FILE=$CONTROL_REMOTE_ENV_FILE
NEXT_PUBLIC_APP_VERSION=$CONTROL_DEPLOYMENT_VERSION
CANONICAL_GCP_INSTANCE_ID=$CONTROL_CANONICAL_GCP_INSTANCE_ID
CANONICAL_SUPABASE_PROJECT_REF=$CONTROL_CANONICAL_SUPABASE_PROJECT_REF
CANONICAL_SITE_ORIGIN=$CONTROL_CANONICAL_SITE_ORIGIN
CANONICAL_WWW_ORIGIN=$CONTROL_CANONICAL_WWW_ORIGIN
REMOTE_PAUSE_SERVICES=$CONTROL_REMOTE_PAUSE_SERVICES
REMOTE_PAUSE_APPLICATION_SERVICES=$CONTROL_REMOTE_PAUSE_APPLICATION_SERVICES
REMOTE_RESUME_SERVICES=$CONTROL_REMOTE_RESUME_SERVICES
LAUNCHD_DOMAIN=$CONTROL_LAUNCHD_DOMAIN
PATH=$CONTROL_PATH
HOME=$CONTROL_HOME
PRODUCTION_DEPLOY_LOCK_OWNER=$CONTROL_DEPLOY_LOCK_OWNER
PRODUCTION_OS_LOCK_HELD=$CONTROL_OS_LOCK_HELD
PRODUCTION_UNSEALED_BOOTSTRAP_ATTESTATION=$CONTROL_UNSEALED_BOOTSTRAP_ATTESTATION
PRODUCTION_ORCHESTRATOR_ATTESTATION=$CONTROL_ORCHESTRATOR_ATTESTATION
EXPECTED_FRONT_SOURCE_SHA256=$CONTROL_EXPECTED_FRONT_SOURCE_SHA256
EXPECTED_ONTOLOGY_SOURCE_SHA256=$CONTROL_EXPECTED_ONTOLOGY_SOURCE_SHA256
export NEXT_PUBLIC_APP_VERSION PATH HOME PRODUCTION_DEPLOY_LOCK_OWNER
export PRODUCTION_OS_LOCK_HELD PRODUCTION_UNSEALED_BOOTSTRAP_ATTESTATION
export PRODUCTION_ORCHESTRATOR_ATTESTATION
export EXPECTED_FRONT_SOURCE_SHA256 EXPECTED_ONTOLOGY_SOURCE_SHA256
# Rebuild every deployment-state path only after controller variables have
# been restored; operator env files cannot redirect the rollback transaction.
CUTOVER_STATE_FILE="$FRONT_DIR/.deploy/paused-runtime-$NEXT_PUBLIC_APP_VERSION.tsv"
PLIST_SNAPSHOT_DIR="$FRONT_DIR/.deploy/paused-plists-$NEXT_PUBLIC_APP_VERSION"
REMOTE_ROLLBACK_DIR="$REMOTE_FRONT_DIR/.deploy/code-rollback-$NEXT_PUBLIC_APP_VERSION"
MAC_RUNTIME_BASE=${KRW_MAC_RUNTIME_BASE:-"$HOME/.local/share/krw-ontology/mac-runtimes"}
MAC_RUNTIME_CURRENT_LINK="$MAC_RUNTIME_BASE/current"
MAC_RUNTIME_CURRENT_SNAPSHOT="$PLIST_SNAPSHOT_DIR/mac-runtime-current.target"
MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT="$PLIST_SNAPSHOT_DIR/mac-runtime-root.path"
MAC_SNAPSHOT_SEAL_PATH="$FRONT_DIR/.deploy/paused-runtime-$NEXT_PUBLIC_APP_VERSION.artifact-seal.json"
UNSEALED_BOOTSTRAP_PROOF="$PLIST_SNAPSHOT_DIR/unsealed-bootstrap-boundary.json"
UNSEALED_BOOTSTRAP_PROOF_SHA="$PLIST_SNAPSHOT_DIR/unsealed-bootstrap-boundary.sha256"
UNSEALED_BOOTSTRAP_MARKER="$MAC_RUNTIME_BASE/.immutable-bootstrap-complete"
MIGRATION_STARTED_MARKER="$PLIST_SNAPSHOT_DIR/migration-started"
CUTOVER_PHASE_FILE="$FRONT_DIR/.deploy/cutover-phase-$NEXT_PUBLIC_APP_VERSION.env"
KRW_ONTOLOGY_MCP_PORT=${KRW_ONTOLOGY_MCP_PORT:-8765}
STOCK_NEWS_MCP_PORT=${STOCK_NEWS_MCP_PORT:-8775}
FILINGS_MCP_PORT=${FILINGS_MCP_PORT:-8785}

expected_orchestrator_attestation="$NEXT_PUBLIC_APP_VERSION:$PRODUCTION_DEPLOY_LOCK_OWNER"
[ -n "$PRODUCTION_DEPLOY_LOCK_OWNER" ] || {
  echo "Production pause/resume is internal to the queue-safe orchestrator." >&2
  exit 1
}
[ "$PRODUCTION_OS_LOCK_HELD" = "1" ] || {
  echo "Missing kernel-held production deploy lock for pause/resume." >&2
  exit 1
}
test -f "$FRONT_DIR/.deploy/production-deploy.lock/owner"
[ "$(sed -n '1p' "$FRONT_DIR/.deploy/production-deploy.lock/owner")" = "$PRODUCTION_DEPLOY_LOCK_OWNER" ] || {
  echo "Production pause/resume lock ownership mismatch." >&2
  exit 1
}
[ "$PRODUCTION_ORCHESTRATOR_ATTESTATION" = "$expected_orchestrator_attestation" ] || {
  echo "Missing or invalid production pause/resume orchestrator attestation." >&2
  exit 1
}
if [ "$ALLOW_UNSEALED_FIRST_CUTOVER" = "1" ] || [ "$ACTION" = "resume-remote" ]; then
  [ "$PRODUCTION_UNSEALED_BOOTSTRAP_ATTESTATION" = "$expected_orchestrator_attestation" ] || {
    echo "Missing or invalid one-time Mac bootstrap attestation." >&2
    exit 1
  }
fi

validate_cutover_phase_provenance() {
  phase_file=$1
  node - "$phase_file" <<'NODE'
const fs = require("fs");
const path = require("path");
const phasePath = process.argv[2];
const fields = new Map();
for (const line of fs.readFileSync(phasePath, "utf8").split(/\r?\n/)) {
  if (!line) continue;
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (!match || fields.has(match[1]) || /[\r\n\0]/.test(match[2])) {
    throw new Error("Invalid or duplicate cutover phase provenance field");
  }
  fields.set(match[1], match[2]);
}
for (const key of ["FORMAT", "DEPLOYMENT_ID", "LOCK_OWNER", "PHASE", "UPDATED_AT"]) {
  if (!fields.get(key)) throw new Error(`Missing cutover phase field: ${key}`);
}
const validatePair = (pathKey, digestKey) => {
  const hasPath = fields.has(pathKey);
  const hasDigest = fields.has(digestKey);
  if (hasPath !== hasDigest) throw new Error(`Incomplete cutover provenance pair: ${pathKey}`);
  if (!hasPath) return;
  if (!path.isAbsolute(fields.get(pathKey))) throw new Error(`Non-absolute cutover provenance path: ${pathKey}`);
  if (!/^[a-f0-9]{64}$/.test(fields.get(digestKey))) throw new Error(`Invalid cutover provenance digest: ${digestKey}`);
};
validatePair("RECOVERY_SEAL_PATH", "RECOVERY_SEAL_SHA256");
validatePair("PRODUCTION_ENV_PATH", "PRODUCTION_ENV_SHA256");
validatePair("MAC_SNAPSHOT_SEAL_PATH", "MAC_SNAPSHOT_SEAL_SHA256");
validatePair("CANDIDATE_MAC_RUNTIME_SEAL_PATH", "CANDIDATE_MAC_RUNTIME_SEAL_SHA256");
NODE

  phase_recovery_seal_path=$(sed -n 's/^RECOVERY_SEAL_PATH=//p' "$phase_file")
  phase_recovery_seal_sha=$(sed -n 's/^RECOVERY_SEAL_SHA256=//p' "$phase_file")
  if [ -n "$phase_recovery_seal_path" ]; then
    test -f "$phase_recovery_seal_path" && [ ! -L "$phase_recovery_seal_path" ] || {
      echo "Missing regular phase-bound recovery seal." >&2
      exit 1
    }
    [ "$(shasum -a 256 "$phase_recovery_seal_path" | awk '{print $1}')" \
      = "$phase_recovery_seal_sha" ] || {
      echo "Phase-bound recovery seal digest mismatch." >&2
      exit 1
    }
    recovery_seal_root=$(CDPATH= cd -- "$(dirname -- "$phase_recovery_seal_path")" && pwd -P)
    phase_env_path_for_seal=$(sed -n 's/^PRODUCTION_ENV_PATH=//p' "$phase_file")
    case "$ACTION" in
      resume|resume-remote)
        set -- verify \
          --marker "$phase_recovery_seal_path" \
          --symlink-boundary "$recovery_seal_root" \
          --root-subset \
          --path "$recovery_seal_root/scripts/pause-production-cutover.sh" \
          --path "$recovery_seal_root/scripts/recover-production-cutover.sh" \
          --path "$recovery_seal_root/scripts/verify-prepared-runtime-artifacts.mjs" \
          --path "$recovery_seal_root/ops/production-target.json" \
          --path "$recovery_seal_root/production-env.path" \
          --path "$recovery_seal_root/production-env.sha256" \
          --path "$phase_env_path_for_seal"
        ;;
      abandon-prepared)
        set -- verify \
          --marker "$phase_recovery_seal_path" \
          --symlink-boundary "$recovery_seal_root" \
          --root-subset \
          --path "$recovery_seal_root/scripts/pause-production-cutover.sh" \
          --path "$recovery_seal_root/scripts/recover-production-cutover.sh" \
          --path "$recovery_seal_root/scripts/verify-prepared-runtime-artifacts.mjs" \
          --path "$recovery_seal_root/scripts/deploy-web-production.sh" \
          --path "$recovery_seal_root/scripts/compute-admin-email-set-sha256.mjs" \
          --path "$recovery_seal_root/ops/production-target.json" \
          --path "$recovery_seal_root/production-env.path" \
          --path "$recovery_seal_root/production-env.sha256" \
          --path "$phase_env_path_for_seal"
        ;;
      *)
        set -- verify \
          --marker "$phase_recovery_seal_path" \
          --symlink-boundary "$recovery_seal_root"
        ;;
    esac
    node "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs" "$@" >/dev/null
  fi

  phase_env_path=$(sed -n 's/^PRODUCTION_ENV_PATH=//p' "$phase_file")
  phase_env_sha=$(sed -n 's/^PRODUCTION_ENV_SHA256=//p' "$phase_file")
  if [ -n "$phase_env_path" ]; then
    test -f "$phase_env_path" && [ ! -L "$phase_env_path" ] || {
      echo "Missing regular phase-bound production env." >&2
      exit 1
    }
    resolved_phase_env=$(node -e 'process.stdout.write(require("fs").realpathSync(process.argv[1]))' "$phase_env_path")
    [ "$resolved_phase_env" = "$phase_env_path" ] || {
      echo "Phase-bound production env path is not canonical." >&2
      exit 1
    }
    [ "$(shasum -a 256 "$phase_env_path" | awk '{print $1}')" = "$phase_env_sha" ] || {
      echo "Phase-bound production env digest mismatch." >&2
      exit 1
    }
  fi

  phase_mac_seal_path=$(sed -n 's/^MAC_SNAPSHOT_SEAL_PATH=//p' "$phase_file")
  phase_mac_seal_sha=$(sed -n 's/^MAC_SNAPSHOT_SEAL_SHA256=//p' "$phase_file")
  if [ -n "$phase_mac_seal_path" ]; then
    [ "$phase_mac_seal_path" = "$MAC_SNAPSHOT_SEAL_PATH" ] || {
      echo "Phase-bound Mac snapshot seal path mismatch." >&2
      exit 1
    }
    test -f "$phase_mac_seal_path" && [ ! -L "$phase_mac_seal_path" ] || {
      echo "Missing regular phase-bound Mac snapshot seal." >&2
      exit 1
    }
    [ "$(shasum -a 256 "$phase_mac_seal_path" | awk '{print $1}')" \
      = "$phase_mac_seal_sha" ] || {
      echo "Phase-bound Mac snapshot seal digest mismatch." >&2
      exit 1
    }
    node "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs" verify \
      --marker "$phase_mac_seal_path" \
      --symlink-boundary "$FRONT_DIR" >/dev/null
  fi

  phase_candidate_mac_seal_path=$(sed -n 's/^CANDIDATE_MAC_RUNTIME_SEAL_PATH=//p' "$phase_file")
  phase_candidate_mac_seal_sha=$(sed -n 's/^CANDIDATE_MAC_RUNTIME_SEAL_SHA256=//p' "$phase_file")
  if { [ "$ACTION" = pause ] || [ "$ACTION" = activate-prepared ] \
      || [ "$ACTION" = abandon-prepared ]; } \
    && [ -n "$phase_candidate_mac_seal_path" ]; then
    expected_candidate_mac_seal="$MAC_RUNTIME_BASE/$NEXT_PUBLIC_APP_VERSION/.artifact-seal.json"
    [ "$phase_candidate_mac_seal_path" = "$expected_candidate_mac_seal" ] || {
      echo "Phase-bound Mac candidate seal path mismatch." >&2
      exit 1
    }
    test -f "$phase_candidate_mac_seal_path" && [ ! -L "$phase_candidate_mac_seal_path" ] || {
      echo "Missing regular phase-bound Mac candidate seal." >&2
      exit 1
    }
    [ "$(shasum -a 256 "$phase_candidate_mac_seal_path" | awk '{print $1}')" \
      = "$phase_candidate_mac_seal_sha" ] || {
      echo "Phase-bound Mac candidate seal digest mismatch." >&2
      exit 1
    }
    node "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs" verify \
      --marker "$phase_candidate_mac_seal_path" >/dev/null
  fi

  if [ -n "$RECOVERY_FRONT_ROOT" ]; then
    [ "$phase_env_path" = "$ENV_PATH" ] && [ "$phase_env_sha" = "$EXPECTED_ENV_SHA256" ] || {
      echo "Sealed recovery-child env binding differs from the phase journal." >&2
      exit 1
    }
    sealed_snapshot_root=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
    expected_recovery_seal="$sealed_snapshot_root/recovery-seal.json"
    [ "$phase_recovery_seal_path" = "$expected_recovery_seal" ] || {
      echo "Sealed recovery controller does not match the phase-bound recovery seal." >&2
      exit 1
    }
    [ "$CANONICAL_TARGET_FILE" = "$sealed_snapshot_root/ops/production-target.json" ] || {
      echo "Sealed recovery canonical target is not inside its controller snapshot." >&2
      exit 1
    }
  fi
}

require_phase_mac_snapshot_seal() {
  [ "$(sed -n 's/^MAC_SNAPSHOT_SEAL_PATH=//p' "$CUTOVER_PHASE_FILE")" \
    = "$MAC_SNAPSHOT_SEAL_PATH" ] || {
    echo "Recovery requires the phase-bound durable Mac snapshot seal." >&2
    exit 1
  }
  printf '%s' "$(sed -n 's/^MAC_SNAPSHOT_SEAL_SHA256=//p' "$CUTOVER_PHASE_FILE")" \
    | grep -Eq '^[a-f0-9]{64}$' || {
    echo "Recovery requires a valid phase-bound Mac snapshot seal digest." >&2
    exit 1
  }
}

require_phase_candidate_mac_seal() {
  CANDIDATE_MAC_RUNTIME_SEAL_PATH=$(sed -n 's/^CANDIDATE_MAC_RUNTIME_SEAL_PATH=//p' "$CUTOVER_PHASE_FILE")
  CANDIDATE_MAC_RUNTIME_SEAL_SHA256=$(sed -n 's/^CANDIDATE_MAC_RUNTIME_SEAL_SHA256=//p' "$CUTOVER_PHASE_FILE")
  [ "$CANDIDATE_MAC_RUNTIME_SEAL_PATH" = "$MAC_RUNTIME_BASE/$NEXT_PUBLIC_APP_VERSION/.artifact-seal.json" ] \
    && printf '%s' "$CANDIDATE_MAC_RUNTIME_SEAL_SHA256" | grep -Eq '^[a-f0-9]{64}$' || {
    echo "Candidate activation requires the phase-bound Mac runtime seal." >&2
    exit 1
  }
}

if [ "$ACTION" = resume ] || [ "$ACTION" = resume-remote ] \
  || [ "$ACTION" = activate-prepared ] || [ "$ACTION" = abandon-prepared ]; then
  test -f "$CUTOVER_PHASE_FILE" || {
    echo "Missing durable cutover phase record." >&2
    exit 1
  }
  test "$(sed -n 's/^FORMAT=//p' "$CUTOVER_PHASE_FILE")" = krw-production-cutover-phase/v1
  test "$(sed -n 's/^DEPLOYMENT_ID=//p' "$CUTOVER_PHASE_FILE")" = "$NEXT_PUBLIC_APP_VERSION"
  RECORDED_PHASE_OWNER=$(sed -n 's/^LOCK_OWNER=//p' "$CUTOVER_PHASE_FILE")
  NEEDS_OWNER_ADOPTION=0
  if [ "$RECORDED_PHASE_OWNER" != "$PRODUCTION_DEPLOY_LOCK_OWNER" ]; then
    [ -n "$ADOPT_PREVIOUS_LOCK_OWNER" ] \
      && [ "$ADOPT_PREVIOUS_LOCK_OWNER" = "$RECORDED_PHASE_OWNER" ] || {
      echo "Interrupted cutover belongs to another lock owner; explicit sealed adoption is required." >&2
      exit 1
    }
    NEEDS_OWNER_ADOPTION=1
  elif [ -n "$ADOPT_PREVIOUS_LOCK_OWNER" ]; then
    echo "Cutover phase already belongs to the current lock owner; refusing redundant adoption." >&2
    exit 1
  fi
  recovery_phase=$(sed -n 's/^PHASE=//p' "$CUTOVER_PHASE_FILE")
  if [ "$ACTION" = resume ]; then
    case "$recovery_phase" in
      pausing_pre_migration|paused_pre_migration|migration_started|fail_closed_migration_unverified|activating_code_only|mac_fail_closed_pre_migration|restoring_old) ;;
      *)
        echo "Exact full old-code recovery is forbidden in cutover phase: $recovery_phase" >&2
        exit 1
        ;;
    esac
  elif [ "$ACTION" = resume-remote ]; then
    case "$recovery_phase" in
      pausing_pre_migration|paused_pre_migration|migration_started|fail_closed_migration_unverified|activating_code_only|mac_fail_closed_pre_migration|restoring_gcp_only) ;;
      *)
        echo "Exact GCP-only recovery is forbidden in cutover phase: $recovery_phase" >&2
        exit 1
        ;;
    esac
  elif [ "$ACTION" = abandon-prepared ]; then
    case "$recovery_phase" in
      prepared_local|prepared_published) ;;
      *)
        echo "Pre-pause candidate abandonment is forbidden in cutover phase: $recovery_phase" >&2
        exit 1
        ;;
    esac
  else
    case "$recovery_phase" in
      migration_started|continuing_migration|verifying_migration|fail_closed_migration_unverified|migration_verified|activating_migrated|resuming_candidate|fail_closed_candidate_ready|activating_code_only|mac_fail_closed_pre_migration|stop_unverified_pre_migration|stop_unverified_migration_unverified|stop_unverified_candidate_ready) ;;
      *)
        echo "Sealed candidate activation is forbidden in cutover phase: $recovery_phase" >&2
        exit 1
        ;;
    esac
  fi
  if [ "$ACTION" = resume ] || [ "$ACTION" = resume-remote ] \
    || [ "$ACTION" = abandon-prepared ]; then
    [ ! -e "$MIGRATION_STARTED_MARKER" ] || {
      echo "This recovery action is forbidden after the migration boundary started." >&2
      exit 1
    }
  else
    case "$recovery_phase" in
      migration_started|continuing_migration|verifying_migration|fail_closed_migration_unverified|migration_verified|activating_migrated|resuming_candidate|fail_closed_candidate_ready)
        test -f "$MIGRATION_STARTED_MARKER" || {
          echo "Migrated candidate activation requires the durable migration boundary marker." >&2
          exit 1
        }
        ;;
      activating_code_only|mac_fail_closed_pre_migration)
        [ ! -e "$MIGRATION_STARTED_MARKER" ] || {
          echo "Code-only candidate recovery conflicts with a migration boundary marker." >&2
          exit 1
        }
        ;;
      stop_unverified_migration_unverified|stop_unverified_candidate_ready)
        test -f "$MIGRATION_STARTED_MARKER" || {
          echo "Interrupted candidate stop verification requires the durable migration boundary marker." >&2
          exit 1
        }
        ;;
      stop_unverified_pre_migration)
        [ ! -e "$MIGRATION_STARTED_MARKER" ] || {
          echo "Pre-migration stop verification conflicts with a migration boundary marker." >&2
          exit 1
        }
        ;;
    esac
  fi
  validate_cutover_phase_provenance "$CUTOVER_PHASE_FILE"
  MIGRATION_INCLUDE_ALL=$(sed -n 's/^MIGRATION_INCLUDE_ALL=//p' "$CUTOVER_PHASE_FILE")
  printf '%s' "$MIGRATION_INCLUDE_ALL" | grep -Eq '^[01]$' || {
    echo "Recovery requires an immutable migration include-all binding." >&2
    exit 1
  }
  if [ "$ACTION" != abandon-prepared ]; then
    require_phase_mac_snapshot_seal
  fi
  if [ "$ACTION" = activate-prepared ] || [ "$ACTION" = abandon-prepared ]; then
    require_phase_candidate_mac_seal
  fi
fi

write_cutover_phase() {
  next_phase=$1
  CUTOVER_PHASE_PATH="$CUTOVER_PHASE_FILE" \
  CUTOVER_PHASE_NAME="$next_phase" \
  CUTOVER_DEPLOYMENT_ID="$NEXT_PUBLIC_APP_VERSION" \
  CUTOVER_LOCK_OWNER="$PRODUCTION_DEPLOY_LOCK_OWNER" \
  CUTOVER_MAC_SNAPSHOT_SEAL_PATH="$MAC_SNAPSHOT_SEAL_PATH" \
  CUTOVER_MAC_SNAPSHOT_SEAL_SHA256="${MAC_SNAPSHOT_SEAL_SHA256:-}" \
  node <<'NODE'
const fs = require("fs");
const path = require("path");
const destination = process.env.CUTOVER_PHASE_PATH;
const temporary = `${destination}.tmp.${process.pid}`;
const core = new Set(["FORMAT", "DEPLOYMENT_ID", "LOCK_OWNER", "PHASE", "UPDATED_AT"]);
const provenance = new Map();
const seen = new Set();
try {
  for (const line of fs.readFileSync(destination, "utf8").split(/\r?\n/)) {
    if (!line) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (!match || /[\r\n\0]/.test(match[2])) throw new Error("Invalid cutover phase field");
    if (seen.has(match[1])) throw new Error("Duplicate cutover phase field");
    seen.add(match[1]);
    if (!core.has(match[1])) provenance.set(match[1], match[2]);
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}
if (!provenance.has("ORIGINAL_LOCK_OWNER")) {
  provenance.set("ORIGINAL_LOCK_OWNER", process.env.CUTOVER_LOCK_OWNER);
}
const macSealSha = process.env.CUTOVER_MAC_SNAPSHOT_SEAL_SHA256;
if (macSealSha) {
  const bindings = {
    MAC_SNAPSHOT_SEAL_PATH: process.env.CUTOVER_MAC_SNAPSHOT_SEAL_PATH,
    MAC_SNAPSHOT_SEAL_SHA256: macSealSha,
  };
  if (!path.isAbsolute(bindings.MAC_SNAPSHOT_SEAL_PATH) || !/^[a-f0-9]{64}$/.test(macSealSha)) {
    throw new Error("Invalid Mac snapshot seal binding");
  }
  for (const [key, value] of Object.entries(bindings)) {
    if (provenance.has(key) && provenance.get(key) !== value) {
      throw new Error(`Mac snapshot seal binding changed: ${key}`);
    }
    provenance.set(key, value);
  }
}
const validatePair = (pathKey, digestKey) => {
  const hasPath = provenance.has(pathKey);
  const hasDigest = provenance.has(digestKey);
  if (hasPath !== hasDigest) throw new Error(`Incomplete cutover provenance pair: ${pathKey}`);
  if (!hasPath) return;
  if (!path.isAbsolute(provenance.get(pathKey))) throw new Error(`Non-absolute cutover provenance path: ${pathKey}`);
  if (!/^[a-f0-9]{64}$/.test(provenance.get(digestKey))) throw new Error(`Invalid cutover provenance digest: ${digestKey}`);
};
for (const [pathKey, digestKey] of [
  ["RECOVERY_SEAL_PATH", "RECOVERY_SEAL_SHA256"],
  ["PRODUCTION_ENV_PATH", "PRODUCTION_ENV_SHA256"],
  ["MAC_SNAPSHOT_SEAL_PATH", "MAC_SNAPSHOT_SEAL_SHA256"],
  ["CANDIDATE_MAC_RUNTIME_SEAL_PATH", "CANDIDATE_MAC_RUNTIME_SEAL_SHA256"],
]) {
  validatePair(pathKey, digestKey);
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
const dir = fs.openSync(path.dirname(destination), "r");
try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
NODE
}

prepare_mac_snapshot_seal() {
  [ ! -e "$MAC_SNAPSHOT_SEAL_PATH" ] || {
    echo "Refusing to overwrite the durable Mac snapshot seal: $MAC_SNAPSHOT_SEAL_PATH" >&2
    exit 1
  }
  test -f "$CUTOVER_STATE_FILE"
  test -f "$MAC_RUNTIME_CURRENT_SNAPSHOT"
  test -f "$MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT"

  # Flush every rollback input before publishing the seal that names it. The
  # migration marker is deliberately excluded because it is created later.
  node - "$CUTOVER_STATE_FILE" "$PLIST_SNAPSHOT_DIR" <<'NODE'
const fs = require("fs");
const syncTree = (entry) => {
  const stats = fs.lstatSync(entry);
  if (stats.isDirectory()) {
    for (const child of fs.readdirSync(entry)) syncTree(require("path").join(entry, child));
  }
  const descriptor = fs.openSync(entry, stats.isDirectory() ? "r" : "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
};
for (const entry of process.argv.slice(2)) syncTree(entry);
NODE

  set -- prepare \
    --marker "$MAC_SNAPSHOT_SEAL_PATH" \
    --symlink-boundary "$FRONT_DIR" \
    --path "$CUTOVER_STATE_FILE" \
    --path "$MAC_RUNTIME_CURRENT_SNAPSHOT" \
    --path "$MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT"
  for sealed_plist in "$PLIST_SNAPSHOT_DIR"/*.plist; do
    [ -e "$sealed_plist" ] || continue
    set -- "$@" --path "$sealed_plist"
  done
  if [ -f "$UNSEALED_BOOTSTRAP_PROOF" ]; then
    test -f "$UNSEALED_BOOTSTRAP_PROOF_SHA"
    set -- "$@" \
      --path "$UNSEALED_BOOTSTRAP_PROOF" \
      --path "$UNSEALED_BOOTSTRAP_PROOF_SHA"
  fi
  node "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs" "$@" >/dev/null
  chmod 400 "$MAC_SNAPSHOT_SEAL_PATH"
  node - "$MAC_SNAPSHOT_SEAL_PATH" <<'NODE'
const fs = require("fs");
const path = require("path");
for (const entry of [process.argv[2], path.dirname(process.argv[2])]) {
  const descriptor = fs.openSync(entry, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}
NODE
  MAC_SNAPSHOT_SEAL_SHA256=$(shasum -a 256 "$MAC_SNAPSHOT_SEAL_PATH" | awk '{print $1}')
  printf '%s' "$MAC_SNAPSHOT_SEAL_SHA256" | grep -Eq '^[a-f0-9]{64}$'
  node "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs" verify \
    --marker "$MAC_SNAPSHOT_SEAL_PATH" \
    --symlink-boundary "$FRONT_DIR" >/dev/null
}

emergency_fail_closed_local_stop() {
  local_stop_ok=1
  for label in \
    com.krwontology.mcp-server \
    com.krwontology.stock-news-mcp \
    com.krwontology.filings-mcp \
    com.krwontology.agent-worker
  do
    launchctl bootout "$LAUNCHD_DOMAIN/$label" >/dev/null 2>&1 || true
  done
  for worker_plist in "$HOME/Library/LaunchAgents"/com.krwontology.agent-worker*.plist; do
    [ -e "$worker_plist" ] || continue
    worker_label=$(/usr/libexec/PlistBuddy -c 'Print :Label' "$worker_plist" 2>/dev/null) || {
      echo "Cannot identify a production worker plist during fail-closed stop: $worker_plist" >&2
      local_stop_ok=0
      continue
    }
    case "$worker_label" in
      com.krwontology.agent-worker|com.krwontology.agent-worker.*)
        launchctl bootout "$LAUNCHD_DOMAIN/$worker_label" >/dev/null 2>&1 || true
        ;;
      *)
        echo "Unexpected worker label during fail-closed stop: $worker_label" >&2
        local_stop_ok=0
        ;;
    esac
  done

  agent_pids=$(ps eww -axo pid=,command= | awk '
    /[.]worker\/agent-worker[.]mjs/ && !/awk/ { print $1 }
  ')
  if [ -n "$agent_pids" ]; then
    # shellcheck disable=SC2086
    kill -TERM $agent_pids >/dev/null 2>&1 || true
  fi
  command -v lsof >/dev/null 2>&1 || {
    echo "Missing lsof for emergency fail-closed listener shutdown." >&2
    local_stop_ok=0
  }
  if command -v lsof >/dev/null 2>&1; then
    for port in "$KRW_ONTOLOGY_MCP_PORT" "$STOCK_NEWS_MCP_PORT" "$FILINGS_MCP_PORT"; do
      listener_pids=$(lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
      if [ -n "$listener_pids" ]; then
        # These ports are the canonical local production MCP endpoints.
        # shellcheck disable=SC2086
        kill -TERM $listener_pids >/dev/null 2>&1 || true
      fi
    done
  fi

  for attempt in $(seq 1 20); do
    local_runtime_running=0
    if ps eww -axo pid,command | awk '
      /[.]worker\/agent-worker[.]mjs/ && !/awk/ { found = 1 }
      END { exit found ? 0 : 1 }
    '; then
      local_runtime_running=1
    fi
    if command -v lsof >/dev/null 2>&1; then
      for port in "$KRW_ONTOLOGY_MCP_PORT" "$STOCK_NEWS_MCP_PORT" "$FILINGS_MCP_PORT"; do
        if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
          local_runtime_running=1
        fi
      done
    fi
    [ "$local_runtime_running" = 1 ] || break
    if [ "$attempt" -eq 20 ]; then
      remaining_agent_pids=$(ps eww -axo pid=,command= | awk '
        /[.]worker\/agent-worker[.]mjs/ && !/awk/ { print $1 }
      ')
      if [ -n "$remaining_agent_pids" ]; then
        # shellcheck disable=SC2086
        kill -KILL $remaining_agent_pids >/dev/null 2>&1 || true
      fi
      if command -v lsof >/dev/null 2>&1; then
        for port in "$KRW_ONTOLOGY_MCP_PORT" "$STOCK_NEWS_MCP_PORT" "$FILINGS_MCP_PORT"; do
          remaining_listener_pids=$(lsof -t -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
          if [ -n "$remaining_listener_pids" ]; then
            # shellcheck disable=SC2086
            kill -KILL $remaining_listener_pids >/dev/null 2>&1 || true
          fi
        done
      fi
    else
      sleep 0.5
    fi
  done

  for label in \
    com.krwontology.mcp-server \
    com.krwontology.stock-news-mcp \
    com.krwontology.filings-mcp \
    com.krwontology.agent-worker
  do
    if launchctl print "$LAUNCHD_DOMAIN/$label" >/dev/null 2>&1; then
      echo "Canonical launchd service remains loaded after fail-closed stop: $label" >&2
      local_stop_ok=0
    fi
  done
  for worker_plist in "$HOME/Library/LaunchAgents"/com.krwontology.agent-worker*.plist; do
    [ -e "$worker_plist" ] || continue
    worker_label=$(/usr/libexec/PlistBuddy -c 'Print :Label' "$worker_plist" 2>/dev/null) || continue
    case "$worker_label" in
      com.krwontology.agent-worker|com.krwontology.agent-worker.*)
        if launchctl print "$LAUNCHD_DOMAIN/$worker_label" >/dev/null 2>&1; then
          echo "Worker launchd service remains loaded after fail-closed stop: $worker_label" >&2
          local_stop_ok=0
        fi
        ;;
    esac
  done
  if ps eww -axo pid,command | awk '
    /[.]worker\/agent-worker[.]mjs/ && !/awk/ { found = 1 }
    END { exit found ? 0 : 1 }
  '; then
    echo "A local agent process remains after emergency fail-closed stop." >&2
    local_stop_ok=0
  fi
  if command -v lsof >/dev/null 2>&1; then
    for port in "$KRW_ONTOLOGY_MCP_PORT" "$STOCK_NEWS_MCP_PORT" "$FILINGS_MCP_PORT"; do
      if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
        echo "A local MCP listener remains after emergency fail-closed stop: $port" >&2
        local_stop_ok=0
      fi
    done
  fi
  [ "$local_stop_ok" = 1 ]
}

emergency_fail_closed_remote_stop() {
  emergency_remote_command=$(cat <<EOF
set -eu
PROJECT='$COMPOSE_PROJECT_NAME'
RUNNING=\$(mktemp /tmp/krw-emergency-running.XXXXXX)
trap 'rm -f "\$RUNNING"' EXIT INT TERM
stop_failed=0
docker ps \
  --filter "label=com.docker.compose.project=\$PROJECT" \
  --filter status=running \
  --format '{{.ID}}\t{{.Label "com.docker.compose.service"}}' >"\$RUNNING"
while IFS="\$(printf '\t')" read -r container_id compose_service; do
  [ -n "\$container_id" ] || continue
  [ "\$compose_service" = redis ] \
    || docker stop --time 120 "\$container_id" \
    || stop_failed=1
done <"\$RUNNING"
docker ps \
  --filter "label=com.docker.compose.project=\$PROJECT" \
  --filter status=running \
  --format '{{.ID}}\t{{.Label "com.docker.compose.service"}}' >"\$RUNNING"
remaining_non_redis=0
while IFS="\$(printf '\t')" read -r container_id compose_service; do
  [ -n "\$container_id" ] || continue
  [ "\$compose_service" = redis ] || {
    echo "A non-Redis production container remains after emergency stop: \${compose_service:-missing}" >&2
    remaining_non_redis=1
  }
done <"\$RUNNING"
[ "\$remaining_non_redis" = 0 ] || exit 1
if [ "\$stop_failed" = 1 ]; then
  echo "One or more Docker stop requests reported failure, but final project enumeration is fail-closed." >&2
fi
EOF
  )
  gcloud compute ssh "$GCP_INSTANCE" \
    --project="$GCP_PROJECT" \
    --zone="$GCP_ZONE" \
    --command="$emergency_remote_command"
}

assert_remote_recovery_identity() {
  recovery_identity_command=$(cat <<EOF
set -eu
PROJECT='$COMPOSE_PROJECT_NAME'
EXPECTED_CANDIDATE='$NEXT_PUBLIC_APP_VERSION'
ROLLBACK_DIR='$REMOTE_ROLLBACK_DIR'
ROLLBACK_MANIFEST="\$ROLLBACK_DIR/manifest.env"
RELEASE_MANIFEST='$REMOTE_FRONT_DIR/.deploy/releases/$NEXT_PUBLIC_APP_VERSION/release-manifest.env'
test -f "\$RELEASE_MANIFEST" && [ ! -L "\$RELEASE_MANIFEST" ]
test -f "\$ROLLBACK_MANIFEST" && [ ! -L "\$ROLLBACK_MANIFEST" ]
test "\$(sed -n 's/^FORMAT=//p' "\$RELEASE_MANIFEST")" = 'krw-production-release-registry/v1'
test "\$(sed -n 's/^APP_VERSION=//p' "\$RELEASE_MANIFEST")" = "\$EXPECTED_CANDIDATE"
test "\$(sed -n 's/^FORMAT=//p' "\$ROLLBACK_MANIFEST")" = 'krw-code-rollback/v2'
test "\$(sed -n 's/^CUTOVER_APP_VERSION=//p' "\$ROLLBACK_MANIFEST")" = "\$EXPECTED_CANDIDATE"
test "\$(grep -c '^PREVIOUS_FRONT_SOURCE_SHA256=' "\$ROLLBACK_MANIFEST")" = 1 || {
  echo "Rollback manifest must define PREVIOUS_FRONT_SOURCE_SHA256 exactly once." >&2
  exit 1
}
EXPECTED_PREVIOUS_FRONT_SOURCE_SHA=\$(sed -n 's/^PREVIOUS_FRONT_SOURCE_SHA256=//p' "\$ROLLBACK_MANIFEST")
printf '%s' "\$EXPECTED_PREVIOUS_FRONT_SOURCE_SHA" | grep -Eq '^[a-f0-9]{64}\$' || {
  echo "Rollback manifest has an invalid previous frontend source identity." >&2
  exit 1
}
EXPECTED_ROLLBACK_MANIFEST_SHA=\$(sed -n 's/^ROLLBACK_MANIFEST_SHA256=//p' "\$RELEASE_MANIFEST")
test "\$(sha256sum "\$ROLLBACK_MANIFEST" | awk '{print \$1}')" = "\$EXPECTED_ROLLBACK_MANIFEST_SHA" || {
  echo "Release registry and rollback manifest cross-seal disagree." >&2
  exit 1
}
for pair in \
  "runtime.env:RUNTIME_ENV_SHA256" \
  "verify-supabase-production-target.mjs:TARGET_VERIFIER_SHA256" \
  "production-target.json:PRODUCTION_TARGET_SHA256" \
  "front-source.tar.gz:FRONT_ARCHIVE_SHA256"
do
  file_name=\${pair%%:*}
  field=\${pair#*:}
  expected=\$(sed -n "s/^\$field=//p" "\$ROLLBACK_MANIFEST")
  printf '%s' "\$expected" | grep -Eq '^[a-f0-9]{64}\$'
  test -f "\$ROLLBACK_DIR/\$file_name" && [ ! -L "\$ROLLBACK_DIR/\$file_name" ]
  test "\$(sha256sum "\$ROLLBACK_DIR/\$file_name" | awk '{print \$1}')" = "\$expected"
done
ROLLBACK_SOURCE_STAGE=\$(mktemp -d /tmp/krw-recovery-identity.XXXXXX)
trap 'rm -rf "\$ROLLBACK_SOURCE_STAGE"' EXIT INT TERM
test -z "\$(find "\$ROLLBACK_SOURCE_STAGE" -mindepth 1 -print -quit)"
tar --extract --gzip --file "\$ROLLBACK_DIR/front-source.tar.gz" \
  --directory "\$ROLLBACK_SOURCE_STAGE" \
  --no-same-owner --no-same-permissions --delay-directory-restore \
  --warning=no-unknown-keyword
node "\$ROLLBACK_DIR/verify-supabase-production-target.mjs" \
  "\$ROLLBACK_DIR/runtime.env" - \
  "\$ROLLBACK_DIR/production-target.json" \
  --require-origins \
  --rollback-proof "\$ROLLBACK_MANIFEST" "\$RELEASE_MANIFEST" \
  --rollback-source-root "\$ROLLBACK_SOURCE_STAGE"
EXPECTED_PREVIOUS=\$(sed -n 's/^PREVIOUS_APP_VERSION=//p' "\$ROLLBACK_MANIFEST")
printf '%s' "\$EXPECTED_PREVIOUS" | grep -Eq '^[A-Za-z0-9._-]+\$' || {
  echo "Recovery rollback manifest has no valid previous deployment identity." >&2
  exit 1
}
WEB_CONTAINER=\$(docker ps \
  --filter "label=com.docker.compose.project=\$PROJECT" \
  --filter 'label=com.docker.compose.service=web' \
  --filter status=running \
  --format '{{.ID}}')
[ "\$(printf '%s\n' "\$WEB_CONTAINER" | sed '/^\$/d' | wc -l | tr -d ' ')" -le 1 ] || {
  echo "Recovery found multiple running production web containers." >&2
  exit 1
}
if [ -n "\$WEB_CONTAINER" ]; then
  LIVE_VERSION=\$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "\$WEB_CONTAINER" \
    | sed -n 's/^NEXT_PUBLIC_APP_VERSION=//p' | tail -1)
  if [ "\$LIVE_VERSION" != "\$EXPECTED_PREVIOUS" ] \
    && [ "\$LIVE_VERSION" != "\$EXPECTED_CANDIDATE" ]; then
    echo "Recovery refuses to stop an unrelated deployment identity: \${LIVE_VERSION:-missing}" >&2
    exit 1
  fi
fi
trap - EXIT INT TERM
rm -rf "\$ROLLBACK_SOURCE_STAGE"
EOF
  )
  gcloud compute ssh "$GCP_INSTANCE" \
    --project="$GCP_PROJECT" \
    --zone="$GCP_ZONE" \
    --command="$recovery_identity_command"
}

assert_candidate_not_activated() {
  candidate_lifecycle_command=$(cat <<EOF
set -eu
RELEASE_DIR='$REMOTE_FRONT_DIR/.deploy/releases/$NEXT_PUBLIC_APP_VERSION'
LOCAL_MARKER="\$RELEASE_DIR/prepared-web-release.env"
GLOBAL_MARKER='$REMOTE_FRONT_DIR/.deploy/prepared-web-release.env'
ACTIVATED_MARKER="\$RELEASE_DIR/activated-web-release.env"
ABANDONED_MARKER="\$RELEASE_DIR/abandoned-web-release.env"
HEALTH_RECEIPT="\$RELEASE_DIR/activation-health-receipt.env"
MANIFEST="\$RELEASE_DIR/release-manifest.env"
RECOVERY_PHASE='$recovery_phase'
regular_file() { test -f "\$1" && [ ! -L "\$1" ]; }
regular_file "\$LOCAL_MARKER"
regular_file "\$MANIFEST"
LOCAL_SHA=\$(sha256sum "\$LOCAL_MARKER" | awk '{print \$1}')
MANIFEST_SHA=\$(sha256sum "\$MANIFEST" | awk '{print \$1}')
test "\$(sed -n 's/^RELEASE_MANIFEST_SHA256=//p' "\$LOCAL_MARKER")" = "\$MANIFEST_SHA"
if [ -e "\$ACTIVATED_MARKER" ]; then
  regular_file "\$ACTIVATED_MARKER"
  regular_file "\$HEALTH_RECEIPT"
  cmp -s "\$LOCAL_MARKER" "\$ACTIVATED_MARKER"
  test "\$(sed -n 's/^FORMAT=//p' "\$HEALTH_RECEIPT")" = 'krw-production-activation-health/v1'
  test "\$(sed -n 's/^APP_VERSION=//p' "\$HEALTH_RECEIPT")" = '$NEXT_PUBLIC_APP_VERSION'
  test "\$(sed -n 's/^PREPARED_MARKER_SHA256=//p' "\$HEALTH_RECEIPT")" = "\$LOCAL_SHA"
  test "\$(sed -n 's/^RELEASE_MANIFEST_SHA256=//p' "\$HEALTH_RECEIPT")" = "\$MANIFEST_SHA"
  echo 'Candidate activation and health receipts are already committed; old-runtime recovery is forbidden.' >&2
  exit 1
fi
[ ! -e "\$HEALTH_RECEIPT" ] || {
  echo 'Candidate activation health receipt exists without a committed activation marker.' >&2
  exit 1
}
if [ -e "\$GLOBAL_MARKER" ]; then
  regular_file "\$GLOBAL_MARKER"
  [ ! -e "\$ABANDONED_MARKER" ]
  cmp -s "\$LOCAL_MARKER" "\$GLOBAL_MARKER"
elif [ -e "\$ABANDONED_MARKER" ]; then
  regular_file "\$ABANDONED_MARKER"
  cmp -s "\$LOCAL_MARKER" "\$ABANDONED_MARKER"
  [ "\$RECOVERY_PHASE" = restoring_old ] \
    || [ "\$RECOVERY_PHASE" = restoring_gcp_only ] \
    || { echo 'An abandoned candidate is valid only for an idempotent rollback retry.' >&2; exit 1; }
else
  echo 'Candidate lifecycle marker is missing before old-runtime recovery.' >&2
  exit 1
fi
EOF
  )
  gcloud compute ssh "$GCP_INSTANCE" \
    --project="$GCP_PROJECT" \
    --zone="$GCP_ZONE" \
    --command="$candidate_lifecycle_command"
}

verify_sealed_migration_convergence() {
  if [ -n "$RECOVERY_FRONT_ROOT" ]; then
    cutover_snapshot=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
  else
    cutover_snapshot="$FRONT_DIR/.deploy/cutover-$NEXT_PUBLIC_APP_VERSION"
  fi
  test -d "$cutover_snapshot"
  test -f "$cutover_snapshot/cutover-input-seal.json"
  node "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs" verify \
    --marker "$cutover_snapshot/cutover-input-seal.json" \
    --symlink-boundary "$cutover_snapshot" \
    --path "$cutover_snapshot/supabase" \
    --path "$cutover_snapshot/scripts/supabase-schema-smoke.mjs" \
    --path "$cutover_snapshot/scripts/compute-admin-email-set-sha256.mjs" \
    --path "$cutover_snapshot/scripts/provision-production-admin-entitlements.mjs" \
    --path "$cutover_snapshot/scripts/supabase-cli.sh" \
    --path "$cutover_snapshot/scripts/pause-production-cutover.sh" \
    --path "$cutover_snapshot/scripts/recover-production-cutover.sh" \
    --path "$cutover_snapshot/scripts/deploy-web-production.sh" \
    --path "$cutover_snapshot/scripts/verify-prepared-runtime-artifacts.mjs" \
    --path "$cutover_snapshot/scripts/uninstall-mac-worker-launchd.sh" \
    --path "$cutover_snapshot/scripts/uninstall-mcp-server-launchd.sh" \
    --path "$cutover_snapshot/scripts/uninstall-stock-news-mcp-launchd.sh" \
    --path "$cutover_snapshot/ops/production-target.json" >/dev/null

  sealed_cli="$cutover_snapshot/tools/supabase"
  sealed_go_cli="$cutover_snapshot/tools/supabase-go"
  sealed_cli_sha=$(sed -n '1p' "$cutover_snapshot/tools/supabase.sha256")
  sealed_go_cli_sha=$(sed -n '1p' "$cutover_snapshot/tools/supabase-go.sha256")
  [ "$(shasum -a 256 "$sealed_cli" | awk '{print $1}')" = "$sealed_cli_sha" ]
  [ "$(shasum -a 256 "$sealed_go_cli" | awk '{print $1}')" = "$sealed_go_cli_sha" ]

  convergence_workdir=$(mktemp -d "${TMPDIR:-/tmp}/krw-supabase-recovery.XXXXXX")
  convergence_output=$(mktemp "${TMPDIR:-/tmp}/krw-supabase-recovery-output.XXXXXX")
  mkdir "$convergence_workdir/supabase"
  rsync -a --delete "$cutover_snapshot/supabase/" "$convergence_workdir/supabase/"
  diff -qr "$cutover_snapshot/supabase" "$convergence_workdir/supabase" >/dev/null || {
    rm -rf "$convergence_workdir"
    rm -f "$convergence_output"
    echo "Recovery migration worktree differs from the sealed migration master." >&2
    return 1
  }
  convergence_go_cli="$convergence_workdir/supabase-go"
  /bin/cp -X "$sealed_go_cli" "$convergence_go_cli"
  chmod 500 "$convergence_go_cli"
  if [ "$(shasum -a 256 "$convergence_go_cli" | awk '{print $1}')" != "$sealed_go_cli_sha" ]; then
    rm -rf "$convergence_workdir"
    rm -f "$convergence_output"
    echo "Recovery Supabase Go CLI copy differs from the sealed companion." >&2
    return 1
  fi
  convergence_status=0
  if [ "$MIGRATION_INCLUDE_ALL" = 1 ]; then
    (cd "$convergence_workdir" && \
      SUPABASE_URL= \
      SUPABASE_ANON_KEY= \
      SUPABASE_SERVICE_ROLE_KEY= \
      SUPABASE_DB_PASSWORD="${SUPABASE_DB_PASSWORD:?Missing SUPABASE_DB_PASSWORD}" \
      SUPABASE_TELEMETRY_DISABLED=1 \
      DO_NOT_TRACK=1 \
        "$convergence_go_cli" db push --include-all --dry-run) \
      >"$convergence_output" 2>&1 || convergence_status=$?
  else
    (cd "$convergence_workdir" && \
      SUPABASE_URL= \
      SUPABASE_ANON_KEY= \
      SUPABASE_SERVICE_ROLE_KEY= \
      SUPABASE_DB_PASSWORD="${SUPABASE_DB_PASSWORD:?Missing SUPABASE_DB_PASSWORD}" \
      SUPABASE_TELEMETRY_DISABLED=1 \
      DO_NOT_TRACK=1 \
        "$convergence_go_cli" db push --dry-run) \
      >"$convergence_output" 2>&1 || convergence_status=$?
  fi
  if [ "$convergence_status" -ne 0 ]; then
    sed -n '1,120p' "$convergence_output" >&2
    rm -rf "$convergence_workdir"
    rm -f "$convergence_output"
    echo "Pinned Supabase convergence verification failed; candidate activation remains blocked." >&2
    return 1
  fi
  if grep -q "Would push these migrations" "$convergence_output"; then
    echo "Sealed Supabase migrations remain pending; continuing the exact pinned migration transaction..."
    write_cutover_phase continuing_migration
    migration_apply_status=0
    if [ "$MIGRATION_INCLUDE_ALL" = 1 ]; then
      (cd "$convergence_workdir" && \
        SUPABASE_URL= \
        SUPABASE_ANON_KEY= \
        SUPABASE_SERVICE_ROLE_KEY= \
        SUPABASE_DB_PASSWORD="${SUPABASE_DB_PASSWORD:?Missing SUPABASE_DB_PASSWORD}" \
        SUPABASE_TELEMETRY_DISABLED=1 \
        DO_NOT_TRACK=1 \
          "$convergence_go_cli" db push --include-all) \
        >"$convergence_output" 2>&1 || migration_apply_status=$?
    else
      (cd "$convergence_workdir" && \
        SUPABASE_URL= \
        SUPABASE_ANON_KEY= \
        SUPABASE_SERVICE_ROLE_KEY= \
        SUPABASE_DB_PASSWORD="${SUPABASE_DB_PASSWORD:?Missing SUPABASE_DB_PASSWORD}" \
        SUPABASE_TELEMETRY_DISABLED=1 \
        DO_NOT_TRACK=1 \
          "$convergence_go_cli" db push) \
        >"$convergence_output" 2>&1 || migration_apply_status=$?
    fi
    if [ "$migration_apply_status" -ne 0 ]; then
      sed -n '1,120p' "$convergence_output" >&2
      rm -rf "$convergence_workdir"
      rm -f "$convergence_output"
      echo "Pinned Supabase migration continuation failed; production remains fail-closed." >&2
      return 1
    fi
    write_cutover_phase verifying_migration
    convergence_status=0
    if [ "$MIGRATION_INCLUDE_ALL" = 1 ]; then
      (cd "$convergence_workdir" && \
        SUPABASE_URL= \
        SUPABASE_ANON_KEY= \
        SUPABASE_SERVICE_ROLE_KEY= \
        SUPABASE_DB_PASSWORD="${SUPABASE_DB_PASSWORD:?Missing SUPABASE_DB_PASSWORD}" \
        SUPABASE_TELEMETRY_DISABLED=1 \
        DO_NOT_TRACK=1 \
          "$convergence_go_cli" db push --include-all --dry-run) \
        >"$convergence_output" 2>&1 || convergence_status=$?
    else
      (cd "$convergence_workdir" && \
        SUPABASE_URL= \
        SUPABASE_ANON_KEY= \
        SUPABASE_SERVICE_ROLE_KEY= \
        SUPABASE_DB_PASSWORD="${SUPABASE_DB_PASSWORD:?Missing SUPABASE_DB_PASSWORD}" \
        SUPABASE_TELEMETRY_DISABLED=1 \
        DO_NOT_TRACK=1 \
          "$convergence_go_cli" db push --dry-run) \
        >"$convergence_output" 2>&1 || convergence_status=$?
    fi
    if [ "$convergence_status" -ne 0 ] \
      || grep -q "Would push these migrations" "$convergence_output"; then
      sed -n '1,120p' "$convergence_output" >&2
      rm -rf "$convergence_workdir"
      rm -f "$convergence_output"
      echo "Pinned Supabase migrations did not converge after continuation." >&2
      return 1
    fi
  fi
  rm -rf "$convergence_workdir"
  rm -f "$convergence_output"

  smoke_ok=0
  for attempt in 1 2 3 4 5; do
    if SUPABASE_SMOKE_ENV_FILE="$ENV_PATH" \
      SUPABASE_PROJECT_REF_FILE="$cutover_snapshot/supabase/.temp/project-ref" \
      SUPABASE_PRODUCTION_TARGET_FILE="$cutover_snapshot/ops/production-target.json" \
      SUPABASE_EXPECTED_PRODUCTION_PROJECT_REF="$CANONICAL_SUPABASE_PROJECT_REF" \
        node "$cutover_snapshot/scripts/supabase-schema-smoke.mjs"; then
      smoke_ok=1
      break
    fi
    [ "$attempt" -lt 5 ] || break
    sleep 3
  done
  [ "$smoke_ok" = 1 ] || {
    echo "Sealed post-migration schema smoke did not converge; candidate activation remains blocked." >&2
    return 1
  }
}

adopt_interrupted_cutover_owner() {
  [ "${NEEDS_OWNER_ADOPTION:-0}" = 1 ] || return 0
  if [ -n "$RECOVERY_FRONT_ROOT" ]; then
    cutover_snapshot=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
  else
    cutover_snapshot="$FRONT_DIR/.deploy/cutover-$NEXT_PUBLIC_APP_VERSION"
  fi
  test -d "$cutover_snapshot" || {
    echo "Missing sealed cutover snapshot for owner adoption." >&2
    exit 1
  }
  if [ "$ACTION" = activate-prepared ]; then
    test -f "$cutover_snapshot/cutover-input-seal.json"
    node "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs" verify \
      --marker "$cutover_snapshot/cutover-input-seal.json" \
      --symlink-boundary "$cutover_snapshot" \
      --path "$cutover_snapshot/supabase" \
      --path "$cutover_snapshot/scripts/supabase-schema-smoke.mjs" \
      --path "$cutover_snapshot/scripts/compute-admin-email-set-sha256.mjs" \
      --path "$cutover_snapshot/scripts/provision-production-admin-entitlements.mjs" \
      --path "$cutover_snapshot/scripts/supabase-cli.sh" \
      --path "$cutover_snapshot/scripts/pause-production-cutover.sh" \
      --path "$cutover_snapshot/scripts/recover-production-cutover.sh" \
      --path "$cutover_snapshot/scripts/deploy-web-production.sh" \
      --path "$cutover_snapshot/scripts/verify-prepared-runtime-artifacts.mjs" \
      --path "$cutover_snapshot/scripts/uninstall-mac-worker-launchd.sh" \
      --path "$cutover_snapshot/scripts/uninstall-mcp-server-launchd.sh" \
      --path "$cutover_snapshot/scripts/uninstall-stock-news-mcp-launchd.sh" \
      --path "$cutover_snapshot/ops/production-target.json" >/dev/null
    test -f "$cutover_snapshot/tools/supabase"
    test -f "$cutover_snapshot/tools/supabase.sha256"
    sealed_cli_sha=$(sed -n '1p' "$cutover_snapshot/tools/supabase.sha256")
    printf '%s' "$sealed_cli_sha" | grep -Eq '^[a-f0-9]{64}$' || {
      echo "Pinned Supabase CLI digest is invalid during cutover owner adoption." >&2
      exit 1
    }
    [ "$(shasum -a 256 "$cutover_snapshot/tools/supabase" | awk '{print $1}')" \
      = "$sealed_cli_sha" ] || {
      echo "Pinned Supabase CLI seal failed during cutover owner adoption." >&2
      exit 1
    }
    test -f "$cutover_snapshot/tools/supabase-go"
    test -f "$cutover_snapshot/tools/supabase-go.sha256"
    sealed_go_cli_sha=$(sed -n '1p' "$cutover_snapshot/tools/supabase-go.sha256")
    printf '%s' "$sealed_go_cli_sha" | grep -Eq '^[a-f0-9]{64}$' || {
      echo "Pinned Supabase CLI companion digest is invalid during cutover owner adoption." >&2
      exit 1
    }
    [ "$(shasum -a 256 "$cutover_snapshot/tools/supabase-go" | awk '{print $1}')" \
      = "$sealed_go_cli_sha" ] || {
      echo "Pinned Supabase CLI companion seal failed during cutover owner adoption." >&2
      exit 1
    }
  fi
  test -f "$cutover_snapshot/production-env.path"
  test -f "$cutover_snapshot/production-env.sha256"
  recorded_env_path=$(sed -n '1p' "$cutover_snapshot/production-env.path")
  [ "$recorded_env_path" = "$ENV_PATH" ] || {
    echo "Recovery env path differs from the interrupted cutover." >&2
    exit 1
  }
  [ "$(shasum -a 256 "$ENV_PATH" | awk '{print $1}')" \
    = "$(sed -n '1p' "$cutover_snapshot/production-env.sha256")" ] || {
    echo "Recovery env bytes differ from the interrupted cutover." >&2
    exit 1
  }
  if [ "$ACTION" != abandon-prepared ]; then
    test -f "$CUTOVER_STATE_FILE"
    test -f "$MAC_RUNTIME_CURRENT_SNAPSHOT"
    test -f "$MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT"
    TAB=$(printf '\t')
    while IFS="$TAB" read -r label previous_state plist snapshot_plist expected_sha; do
      [ -n "$label" ] || continue
      case "$previous_state" in loaded|stopped) ;; *) echo "Invalid adopted launchd state: $label" >&2; exit 1 ;; esac
      if [ "$expected_sha" != absent ]; then
        test -f "$snapshot_plist"
        [ "$(shasum -a 256 "$snapshot_plist" | awk '{print $1}')" = "$expected_sha" ] || {
          echo "Adopted launchd snapshot seal failed: $label" >&2
          exit 1
        }
      fi
    done <"$CUTOVER_STATE_FILE"
    prior_runtime_root=$(sed -n '1p' "$MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT")
    case "$prior_runtime_root" in
      absent) ;;
      unsealed-fail-closed)
        test -f "$UNSEALED_BOOTSTRAP_PROOF"
        test -f "$UNSEALED_BOOTSTRAP_PROOF_SHA"
        [ "$(shasum -a 256 "$UNSEALED_BOOTSTRAP_PROOF" | awk '{print $1}')" \
          = "$(sed -n '1p' "$UNSEALED_BOOTSTRAP_PROOF_SHA")" ]
        ;;
      *)
        test -x "$prior_runtime_root/scripts/verify-mac-runtime-target.sh"
        "$prior_runtime_root/scripts/verify-mac-runtime-target.sh" \
          "$prior_runtime_root/runtime.env"
        ;;
    esac
  fi
  if [ "$ACTION" = activate-prepared ] || [ "$ACTION" = abandon-prepared ]; then
    candidate_runtime="$MAC_RUNTIME_BASE/$NEXT_PUBLIC_APP_VERSION"
    test -x "$candidate_runtime/scripts/verify-mac-runtime-target.sh"
    "$candidate_runtime/scripts/verify-mac-runtime-target.sh" \
      "$candidate_runtime/runtime.env"
  fi

  ADOPTION_VERIFY_CANDIDATE=0
  if [ "$ACTION" = activate-prepared ]; then
    ADOPTION_VERIFY_CANDIDATE=1
  fi
ADOPTION_REMOTE_PREFLIGHT=$(cat <<EOF
set -eu
RELEASE_DIR='$REMOTE_FRONT_DIR/.deploy/releases/$NEXT_PUBLIC_APP_VERSION'
ROLLBACK_DIR='$REMOTE_ROLLBACK_DIR'
PHASE_CANDIDATE_RUNTIME_ENV_SHA='$EXPECTED_ENV_SHA256'
VERIFY_CANDIDATE='$ADOPTION_VERIFY_CANDIDATE'
test -f "\$RELEASE_DIR/release-manifest.env"
test -f "\$ROLLBACK_DIR/manifest.env"
test "\$(sed -n 's/^FORMAT=//p' "\$RELEASE_DIR/release-manifest.env")" = 'krw-production-release-registry/v1'
test "\$(sed -n 's/^APP_VERSION=//p' "\$RELEASE_DIR/release-manifest.env")" = '$NEXT_PUBLIC_APP_VERSION'
test "\$(sed -n 's/^FORMAT=//p' "\$ROLLBACK_DIR/manifest.env")" = 'krw-code-rollback/v2'
test "\$(sed -n 's/^CUTOVER_APP_VERSION=//p' "\$ROLLBACK_DIR/manifest.env")" = '$NEXT_PUBLIC_APP_VERSION'
test "\$(grep -c '^PREVIOUS_FRONT_SOURCE_SHA256=' "\$ROLLBACK_DIR/manifest.env")" = 1 || {
  echo "Rollback manifest must define PREVIOUS_FRONT_SOURCE_SHA256 exactly once." >&2
  exit 1
}
EXPECTED_PREVIOUS_FRONT_SOURCE_SHA=\$(sed -n 's/^PREVIOUS_FRONT_SOURCE_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
printf '%s' "\$EXPECTED_PREVIOUS_FRONT_SOURCE_SHA" | grep -Eq '^[a-f0-9]{64}\$' || {
  echo "Rollback manifest has an invalid previous frontend source identity." >&2
  exit 1
}
EXPECTED_ROLLBACK_SHA=\$(sed -n 's/^ROLLBACK_MANIFEST_SHA256=//p' "\$RELEASE_DIR/release-manifest.env")
test "\$(sha256sum "\$ROLLBACK_DIR/manifest.env" | awk '{print \$1}')" = "\$EXPECTED_ROLLBACK_SHA"
for pair in \
  "runtime.env:RUNTIME_ENV_SHA256" \
  "verify-supabase-production-target.mjs:TARGET_VERIFIER_SHA256" \
  "atomic-install-sealed-file.mjs:ATOMIC_INSTALLER_SHA256" \
  "production-target.json:PRODUCTION_TARGET_SHA256" \
  "front-source.tar.gz:FRONT_ARCHIVE_SHA256" \
  "compose.resolved.yml:RESOLVED_COMPOSE_SHA256" \
  "services.tsv:SERVICE_STATE_SHA256"
do
  file_name=\${pair%%:*}
  field=\${pair#*:}
  expected=\$(sed -n "s/^\$field=//p" "\$ROLLBACK_DIR/manifest.env")
  test -f "\$ROLLBACK_DIR/\$file_name" && [ ! -L "\$ROLLBACK_DIR/\$file_name" ]
  test "\$(sha256sum "\$ROLLBACK_DIR/\$file_name" | awk '{print \$1}')" = "\$expected"
done
TAB=\$(printf '\t')
while IFS="\$TAB" read -r service previous_running previous_image; do
  [ -n "\$service" ] || continue
  [ "\$previous_running" = true ] || [ "\$previous_running" = false ]
  [ -n "\$previous_image" ]
  if [ "\$previous_image" != absent ]; then
    docker image inspect "\$previous_image" >/dev/null
  fi
done <"\$ROLLBACK_DIR/services.tsv"
for image_field in PREVIOUS_WEB_IMAGE_ID PREVIOUS_CADDY_IMAGE_ID; do
  previous_image=\$(sed -n "s/^\$image_field=//p" "\$ROLLBACK_DIR/manifest.env")
  if [ -n "\$previous_image" ] && [ "\$previous_image" != absent ]; then
    docker image inspect "\$previous_image" >/dev/null
  fi
done
if [ "\$VERIFY_CANDIDATE" = 1 ]; then
  test "\$(sha256sum "\$RELEASE_DIR/runtime.env" | awk '{print \$1}')" = "\$(sed -n 's/^RUNTIME_ENV_SHA256=//p' "\$RELEASE_DIR/release-manifest.env")"
  test "\$(sed -n 's/^RUNTIME_ENV_SHA256=//p' "\$RELEASE_DIR/release-manifest.env")" = "\$PHASE_CANDIDATE_RUNTIME_ENV_SHA"
  test "\$(sha256sum "\$RELEASE_DIR/front-source.tar.gz" | awk '{print \$1}')" = "\$(sed -n 's/^FRONT_ARCHIVE_SHA256=//p' "\$RELEASE_DIR/release-manifest.env")"
  test "\$(sha256sum "\$RELEASE_DIR/ontology-source.tar.gz" | awk '{print \$1}')" = "\$(sed -n 's/^ONTOLOGY_ARCHIVE_SHA256=//p' "\$RELEASE_DIR/release-manifest.env")"
  test "\$(sha256sum "\$RELEASE_DIR/candidate-compose.resolved.yml" | awk '{print \$1}')" = "\$(sed -n 's/^CANDIDATE_COMPOSE_SHA256=//p' "\$RELEASE_DIR/release-manifest.env")"
  docker image inspect "\$(sed -n 's/^IMAGE_ID=//p' "\$RELEASE_DIR/release-manifest.env")" >/dev/null
  docker image inspect "\$(sed -n 's/^CADDY_IMAGE_ID=//p' "\$RELEASE_DIR/release-manifest.env")" >/dev/null
fi
ROLLBACK_SOURCE_STAGE=\$(mktemp -d /tmp/krw-owner-adoption.XXXXXX)
trap 'rm -rf "\$ROLLBACK_SOURCE_STAGE"' EXIT INT TERM
test -z "\$(find "\$ROLLBACK_SOURCE_STAGE" -mindepth 1 -print -quit)"
tar --extract --gzip --file "\$ROLLBACK_DIR/front-source.tar.gz" \
  --directory "\$ROLLBACK_SOURCE_STAGE" \
  --no-same-owner --no-same-permissions --delay-directory-restore \
  --warning=no-unknown-keyword
node -e '
  const fs = require("fs");
  const file = process.argv[1];
  const expected = process.argv[2];
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("Archived rollback production target must be a regular non-symlink file");
  const target = JSON.parse(fs.readFileSync(file, "utf8"));
  if (target?.format !== "krw-production-target/v1" || target?.supabaseProjectRef !== expected) {
    throw new Error("Archived rollback production target does not match the canonical Supabase project");
  }
' "\$ROLLBACK_SOURCE_STAGE/ops/production-target.json" '$CANONICAL_SUPABASE_PROJECT_REF'
node "\$ROLLBACK_DIR/verify-supabase-production-target.mjs" \
  "\$ROLLBACK_DIR/runtime.env" - \
  "\$ROLLBACK_DIR/production-target.json" \
  --require-origins \
  --rollback-proof "\$ROLLBACK_DIR/manifest.env" "\$RELEASE_DIR/release-manifest.env" \
  --rollback-source-root "\$ROLLBACK_SOURCE_STAGE"
test "\$(node -e 'const target=require(process.argv[1]);process.stdout.write(target.supabaseProjectRef)' "\$ROLLBACK_DIR/production-target.json")" = '$CANONICAL_SUPABASE_PROJECT_REF'
EOF
  )
  if [ "$ACTION" = abandon-prepared ]; then
    assert_candidate_not_activated
  else
    gcloud compute ssh "$GCP_INSTANCE" \
      --project="$GCP_PROJECT" \
      --zone="$GCP_ZONE" \
      --command="$ADOPTION_REMOTE_PREFLIGHT"
  fi

  CUTOVER_PHASE_PATH="$CUTOVER_PHASE_FILE" \
  CUTOVER_NEW_OWNER="$PRODUCTION_DEPLOY_LOCK_OWNER" \
  CUTOVER_PREVIOUS_OWNER="$RECORDED_PHASE_OWNER" \
  node <<'NODE'
const fs = require("fs");
const path = require("path");
const destination = process.env.CUTOVER_PHASE_PATH;
const fields = new Map();
for (const line of fs.readFileSync(destination, "utf8").split(/\r?\n/)) {
  if (!line) continue;
  const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (!match || fields.has(match[1]) || /[\r\n\0]/.test(match[2])) {
    throw new Error("Invalid or duplicate cutover phase field during adoption");
  }
  fields.set(match[1], match[2]);
}
if (fields.get("LOCK_OWNER") !== process.env.CUTOVER_PREVIOUS_OWNER) {
  throw new Error("Cutover phase owner changed during adoption");
}
const core = new Set(["FORMAT", "DEPLOYMENT_ID", "LOCK_OWNER", "PHASE", "UPDATED_AT"]);
const provenance = new Map([...fields].filter(([key]) => !core.has(key)));
const validatePair = (pathKey, digestKey) => {
  const hasPath = provenance.has(pathKey);
  const hasDigest = provenance.has(digestKey);
  if (hasPath !== hasDigest) throw new Error(`Incomplete adoption provenance: ${pathKey}`);
  if (!hasPath) return;
  if (!path.isAbsolute(provenance.get(pathKey))) throw new Error(`Non-absolute adoption provenance: ${pathKey}`);
  if (!/^[a-f0-9]{64}$/.test(provenance.get(digestKey))) throw new Error(`Invalid adoption digest: ${digestKey}`);
};
for (const pair of [
  ["RECOVERY_SEAL_PATH", "RECOVERY_SEAL_SHA256"],
  ["PRODUCTION_ENV_PATH", "PRODUCTION_ENV_SHA256"],
  ["MAC_SNAPSHOT_SEAL_PATH", "MAC_SNAPSHOT_SEAL_SHA256"],
  ["CANDIDATE_MAC_RUNTIME_SEAL_PATH", "CANDIDATE_MAC_RUNTIME_SEAL_SHA256"],
]) validatePair(...pair);
provenance.set("ORIGINAL_LOCK_OWNER", provenance.get("ORIGINAL_LOCK_OWNER") || fields.get("LOCK_OWNER"));
// The generic serializer below emits the durable audit keys as
// PREVIOUS_LOCK_OWNER=<owner> and ADOPTED_AT=<timestamp>.
provenance.set("PREVIOUS_LOCK_OWNER", fields.get("LOCK_OWNER"));
provenance.set("ADOPTED_AT", new Date().toISOString());
const temporary = `${destination}.tmp.${process.pid}`;
const payload = [
  `FORMAT=${fields.get("FORMAT")}`,
  `DEPLOYMENT_ID=${fields.get("DEPLOYMENT_ID")}`,
  `LOCK_OWNER=${process.env.CUTOVER_NEW_OWNER}`,
  `PHASE=${fields.get("PHASE")}`,
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
  RECORDED_PHASE_OWNER=$PRODUCTION_DEPLOY_LOCK_OWNER
  NEEDS_OWNER_ADOPTION=0
  echo "Adopted interrupted cutover from sealed owner $ADOPT_PREVIOUS_LOCK_OWNER."
}

adopt_interrupted_cutover_owner

if [ "$ACTION" = abandon-prepared ]; then
  CANDIDATE_RUNTIME_ROOT="$MAC_RUNTIME_BASE/$NEXT_PUBLIC_APP_VERSION"
  CANDIDATE_IDENTITY="$CANDIDATE_RUNTIME_ROOT/runtime-identity.json"
  SEALED_WEB_ACTIVATOR="$SCRIPT_DIR/deploy-web-production.sh"
  test -f "$CANDIDATE_IDENTITY" && [ ! -L "$CANDIDATE_IDENTITY" ] || {
    echo "Missing regular Mac candidate identity for pre-pause abandonment." >&2
    exit 1
  }
  test -f "$SEALED_WEB_ACTIVATOR" && [ ! -L "$SEALED_WEB_ACTIVATOR" ] \
    && test -x "$SEALED_WEB_ACTIVATOR" || {
    echo "Missing sealed GCP candidate helper for pre-pause abandonment." >&2
    exit 1
  }
  read_abandoned_candidate_identity() {
    identity_key=$1
    node -e '
      const fs = require("fs");
      const identity = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const value = identity[process.argv[2]];
      if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) process.exit(1);
      process.stdout.write(value);
    ' "$CANDIDATE_IDENTITY" "$identity_key"
  }
  EXPECTED_FRONT_SOURCE_SHA256=$(read_abandoned_candidate_identity frontSourceSha256)
  EXPECTED_ONTOLOGY_SOURCE_SHA256=$(read_abandoned_candidate_identity ontologySourceSha256)
  EXPECTED_ADMIN_EMAILS_SHA256=$(node \
    "$SCRIPT_DIR/compute-admin-email-set-sha256.mjs" "$ENV_PATH")
  EXPECTED_PRODUCTION_ENV_SHA256=$EXPECTED_ENV_SHA256
  EXPECTED_PREPARED_APP_VERSION=$NEXT_PUBLIC_APP_VERSION
  PRODUCTION_DEPLOY_LOCK_FRONT_DIR=$FRONT_DIR
  export EXPECTED_FRONT_SOURCE_SHA256 EXPECTED_ONTOLOGY_SOURCE_SHA256
  export EXPECTED_ADMIN_EMAILS_SHA256 EXPECTED_PRODUCTION_ENV_SHA256
  export EXPECTED_PREPARED_APP_VERSION PRODUCTION_DEPLOY_LOCK_FRONT_DIR
  "$SEALED_WEB_ACTIVATOR" --abandon-prepared
  write_cutover_phase abandoned_pre_pause
  echo "Sealed pre-pause Mac and GCP candidates were retired without stopping production."
  exit 0
fi

if [ "$ACTION" = activate-prepared ]; then
  CANDIDATE_RUNTIME_ROOT="$MAC_RUNTIME_BASE/$NEXT_PUBLIC_APP_VERSION"
  CANDIDATE_MAC_ACTIVATOR="$CANDIDATE_RUNTIME_ROOT/scripts/activate-prepared-mac-runtime.sh"
  SEALED_WEB_ACTIVATOR="$SCRIPT_DIR/deploy-web-production.sh"
  test -f "$CANDIDATE_MAC_ACTIVATOR" && [ ! -L "$CANDIDATE_MAC_ACTIVATOR" ] || {
    echo "Missing sealed Mac candidate activation helper." >&2
    exit 1
  }
  test -x "$CANDIDATE_MAC_ACTIVATOR" || {
    echo "Sealed Mac candidate activation helper is not executable." >&2
    exit 1
  }
  test -f "$SEALED_WEB_ACTIVATOR" && [ ! -L "$SEALED_WEB_ACTIVATOR" ] \
    && test -x "$SEALED_WEB_ACTIVATOR" || {
    echo "Missing sealed GCP candidate activation helper." >&2
    exit 1
  }

  RECOVERY_REQUIRES_MIGRATION_VERIFICATION=0
  CANDIDATE_FAILURE_PHASE=mac_fail_closed_pre_migration
  CANDIDATE_STOP_UNVERIFIED_PHASE=stop_unverified_pre_migration
  case "$recovery_phase" in
    migration_started|continuing_migration|verifying_migration|fail_closed_migration_unverified|stop_unverified_migration_unverified)
      RECOVERY_REQUIRES_MIGRATION_VERIFICATION=1
      CANDIDATE_FAILURE_PHASE=fail_closed_migration_unverified
      CANDIDATE_STOP_UNVERIFIED_PHASE=stop_unverified_migration_unverified
      ;;
    migration_verified|activating_migrated|resuming_candidate|fail_closed_candidate_ready|stop_unverified_candidate_ready)
      CANDIDATE_FAILURE_PHASE=fail_closed_candidate_ready
      CANDIDATE_STOP_UNVERIFIED_PHASE=stop_unverified_candidate_ready
      ;;
  esac
  CANDIDATE_RECOVERY_COMPLETE=0
  fail_close_candidate_recovery() {
    recovery_exit=$?
    trap - EXIT INT TERM
    durable_recovery_phase=$(sed -n 's/^PHASE=//p' "$CUTOVER_PHASE_FILE" 2>/dev/null || true)
    if [ "$durable_recovery_phase" = complete ]; then
      exit 0
    fi
    if [ "$CANDIDATE_RECOVERY_COMPLETE" != 1 ]; then
      candidate_local_stopped=1
      candidate_remote_stopped=1
      emergency_fail_closed_local_stop >/dev/null 2>&1 || candidate_local_stopped=0
      emergency_fail_closed_remote_stop >/dev/null 2>&1 || candidate_remote_stopped=0
      if [ "$candidate_local_stopped" = 1 ] && [ "$candidate_remote_stopped" = 1 ]; then
        write_cutover_phase "$CANDIDATE_FAILURE_PHASE" >/dev/null 2>&1 || true
      else
        write_cutover_phase "$CANDIDATE_STOP_UNVERIFIED_PHASE" >/dev/null 2>&1 || true
      fi
    fi
    exit "$recovery_exit"
  }
  trap fail_close_candidate_recovery EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  # Refuse stale recovery before stopping anything. A newer deployment cannot
  # be interrupted by replaying an older phase journal, even when runtime env
  # bytes happen to be identical across releases.
  assert_remote_recovery_identity

  # Converge every executor to a known stopped state before interpreting any
  # partially completed activation. Both candidate activators are idempotent.
  emergency_fail_closed_local_stop
  emergency_fail_closed_remote_stop

  if [ "$RECOVERY_REQUIRES_MIGRATION_VERIFICATION" = 1 ]; then
    write_cutover_phase verifying_migration
    verify_sealed_migration_convergence
    write_cutover_phase migration_verified
    recovery_phase=migration_verified
    CANDIDATE_FAILURE_PHASE=fail_closed_candidate_ready
  fi
  write_cutover_phase resuming_candidate

  "$CANDIDATE_MAC_ACTIVATOR" \
    --front-root "$FRONT_DIR" \
    --runtime-root "$CANDIDATE_RUNTIME_ROOT" \
    --deployment-id "$NEXT_PUBLIC_APP_VERSION" \
    --expected-seal-sha256 "$CANDIDATE_MAC_RUNTIME_SEAL_SHA256"

  if [ -f "$UNSEALED_BOOTSTRAP_PROOF" ] && [ -f "$UNSEALED_BOOTSTRAP_PROOF_SHA" ]; then
    bootstrap_proof_sha=$(sed -n '1p' "$UNSEALED_BOOTSTRAP_PROOF_SHA")
    [ "$(shasum -a 256 "$UNSEALED_BOOTSTRAP_PROOF" | awk '{print $1}')" = "$bootstrap_proof_sha" ] || {
      echo "One-time Mac bootstrap proof changed before candidate recovery." >&2
      exit 1
    }
    bootstrap_runtime_identity_sha=$(shasum -a 256 "$CANDIDATE_RUNTIME_ROOT/runtime-identity.json" | awk '{print $1}')
    bootstrap_runtime_root=$(CDPATH= cd -- "$CANDIDATE_RUNTIME_ROOT" && pwd -P)
    if [ -e "$UNSEALED_BOOTSTRAP_MARKER" ]; then
      test -f "$UNSEALED_BOOTSTRAP_MARKER" && [ ! -L "$UNSEALED_BOOTSTRAP_MARKER" ]
      node - "$UNSEALED_BOOTSTRAP_MARKER" "$NEXT_PUBLIC_APP_VERSION" \
        "$bootstrap_runtime_root" "$bootstrap_runtime_identity_sha" "$bootstrap_proof_sha" <<'NODE'
const fs = require("fs");
const [file, deploymentId, runtimeRoot, identitySha, proofSha] = process.argv.slice(2);
const marker = JSON.parse(fs.readFileSync(file, "utf8"));
if (marker?.format !== "krw-immutable-mac-bootstrap-complete/v1" ||
    marker.deploymentId !== deploymentId || marker.runtimeRoot !== runtimeRoot ||
    marker.runtimeIdentitySha256 !== identitySha ||
    marker.unsealedBoundaryProofSha256 !== proofSha ||
    marker.legacyMutableRuntimeRestartAllowed !== false) {
  throw new Error("Existing immutable Mac bootstrap marker differs from the recovered runtime");
}
NODE
    else
      bootstrap_marker_tmp="$UNSEALED_BOOTSTRAP_MARKER.next.$$"
      export NEXT_PUBLIC_APP_VERSION bootstrap_runtime_root
      export bootstrap_runtime_identity_sha bootstrap_proof_sha
      node <<'NODE' >"$bootstrap_marker_tmp"
const marker = {
  format: "krw-immutable-mac-bootstrap-complete/v1",
  deploymentId: process.env.NEXT_PUBLIC_APP_VERSION,
  completedAt: new Date().toISOString(),
  runtimeRoot: process.env.bootstrap_runtime_root,
  runtimeIdentitySha256: process.env.bootstrap_runtime_identity_sha,
  unsealedBoundaryProofSha256: process.env.bootstrap_proof_sha,
  legacyMutableRuntimeRestartAllowed: false,
};
process.stdout.write(`${JSON.stringify(marker, null, 2)}\n`);
NODE
      chmod 400 "$bootstrap_marker_tmp"
      node -e '
        const fs = require("fs");
        const path = require("path");
        const [source, destination] = process.argv.slice(1);
        const fd = fs.openSync(source, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.renameSync(source, destination);
        const directory = fs.openSync(path.dirname(destination), "r");
        try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
      ' "$bootstrap_marker_tmp" "$UNSEALED_BOOTSTRAP_MARKER"
    fi
  fi

  CANDIDATE_IDENTITY="$CANDIDATE_RUNTIME_ROOT/runtime-identity.json"
  read_candidate_identity() {
    identity_key=$1
    node -e '
      const fs = require("fs");
      const identity = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      const value = identity[process.argv[2]];
      if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) process.exit(1);
      process.stdout.write(value);
    ' "$CANDIDATE_IDENTITY" "$identity_key"
  }
  EXPECTED_FRONT_SOURCE_SHA256=$(read_candidate_identity frontSourceSha256)
  EXPECTED_ONTOLOGY_SOURCE_SHA256=$(read_candidate_identity ontologySourceSha256)
  EXPECTED_ADMIN_EMAILS_SHA256=$(node \
    "$SCRIPT_DIR/compute-admin-email-set-sha256.mjs" "$ENV_PATH")
  EXPECTED_PRODUCTION_ENV_SHA256=$EXPECTED_ENV_SHA256
  EXPECTED_PREPARED_APP_VERSION=$NEXT_PUBLIC_APP_VERSION
  PRODUCTION_DEPLOY_LOCK_FRONT_DIR=$FRONT_DIR
  export EXPECTED_FRONT_SOURCE_SHA256 EXPECTED_ONTOLOGY_SOURCE_SHA256
  export EXPECTED_ADMIN_EMAILS_SHA256 EXPECTED_PRODUCTION_ENV_SHA256
  export EXPECTED_PREPARED_APP_VERSION PRODUCTION_DEPLOY_LOCK_FRONT_DIR
  "$SEALED_WEB_ACTIVATOR" --activate-prepared

  # The durable terminal phase and the in-memory trap state are one commit
  # handoff. Ignore catchable signals across these few instructions; SIGKILL
  # leaves the fsynced terminal journal for the next operator to observe.
  trap '' INT TERM
  write_cutover_phase complete
  CANDIDATE_RECOVERY_COMPLETE=1
  trap - EXIT INT TERM
  echo "Sealed Mac and GCP candidate activation recovered completely."
  exit 0
fi

if [ "$ACTION" = pause ]; then
  if [ "$FAIL_CLOSED_REPAUSE" = "1" ]; then
    # Do not parse rollback metadata here. Emergency stop must happen first so
    # corrupt audit state cannot leave partially activated code running.
    current_cutover_phase=unverified
  else
    test -f "$CUTOVER_PHASE_FILE" || {
      echo "Missing durable prepared cutover phase record." >&2
      exit 1
    }
    test "$(sed -n 's/^FORMAT=//p' "$CUTOVER_PHASE_FILE")" = krw-production-cutover-phase/v1
    test "$(sed -n 's/^DEPLOYMENT_ID=//p' "$CUTOVER_PHASE_FILE")" = "$NEXT_PUBLIC_APP_VERSION"
    test "$(sed -n 's/^LOCK_OWNER=//p' "$CUTOVER_PHASE_FILE")" = "$PRODUCTION_DEPLOY_LOCK_OWNER"
    current_cutover_phase=$(sed -n 's/^PHASE=//p' "$CUTOVER_PHASE_FILE")
    [ "$current_cutover_phase" = prepared_published ] || {
      echo "Initial production pause requires cutover phase prepared_published, got: $current_cutover_phase" >&2
      exit 1
    }
    validate_cutover_phase_provenance "$CUTOVER_PHASE_FILE"
  fi
fi

if [ "$ACTION" = "pause" ]; then
  mkdir -p "$FRONT_DIR/.deploy"
  if [ "$FAIL_CLOSED_REPAUSE" = "1" ]; then
    fail_closed_local_stopped=1
    emergency_fail_closed_local_stop || fail_closed_local_stopped=0
    # Remote shutdown is attempted even when local verification failed. The
    # fail-closed path must close every independently reachable executor.
    emergency_fail_closed_remote_stop
    [ "$fail_closed_local_stopped" = 1 ] || {
      echo "Emergency remote stop completed, but local fail-closed verification failed." >&2
      exit 1
    }

    # Only now may rollback metadata and audit seals influence control flow.
    test -f "$CUTOVER_PHASE_FILE" || {
      echo "Missing durable cutover phase record after emergency stop." >&2
      exit 1
    }
    test "$(sed -n 's/^FORMAT=//p' "$CUTOVER_PHASE_FILE")" = krw-production-cutover-phase/v1
    test "$(sed -n 's/^DEPLOYMENT_ID=//p' "$CUTOVER_PHASE_FILE")" = "$NEXT_PUBLIC_APP_VERSION"
    test "$(sed -n 's/^LOCK_OWNER=//p' "$CUTOVER_PHASE_FILE")" = "$PRODUCTION_DEPLOY_LOCK_OWNER"
    current_cutover_phase=$(sed -n 's/^PHASE=//p' "$CUTOVER_PHASE_FILE")
    case "$current_cutover_phase" in
      pausing_pre_migration|paused_pre_migration|migration_started|continuing_migration|verifying_migration|migration_verified|activating_code_only|activating_migrated|resuming_candidate|mac_fail_closed_pre_migration|restoring_old|restoring_gcp_only|fail_closed|fail_closed_candidate_ready|fail_closed_migration_unverified|stop_unverified_pre_migration|stop_unverified_migration_unverified|stop_unverified_candidate_ready) ;;
      *) echo "Fail-closed re-pause is invalid in cutover phase: $current_cutover_phase" >&2; exit 1 ;;
    esac
    validate_cutover_phase_provenance "$CUTOVER_PHASE_FILE"
    require_phase_mac_snapshot_seal
    test -f "$CUTOVER_STATE_FILE" || {
      echo "Missing preserved launchd state for fail-closed re-pause: $CUTOVER_STATE_FILE" >&2
      exit 1
    }
    test -d "$PLIST_SNAPSHOT_DIR" || {
      echo "Missing preserved launchd snapshot for fail-closed re-pause: $PLIST_SNAPSHOT_DIR" >&2
      exit 1
    }
    test -f "$MAC_RUNTIME_CURRENT_SNAPSHOT" || {
      echo "Missing preserved Mac runtime pointer snapshot: $MAC_RUNTIME_CURRENT_SNAPSHOT" >&2
      exit 1
    }
    test -f "$MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT" || {
      echo "Missing preserved Mac rollback runtime root: $MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT" >&2
      exit 1
    }
    preserved_runtime_root=$(sed -n '1p' "$MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT")
    case "$preserved_runtime_root" in
      absent)
        ;;
      unsealed-fail-closed)
        test -f "$UNSEALED_BOOTSTRAP_PROOF"
        test -f "$UNSEALED_BOOTSTRAP_PROOF_SHA"
        expected_bootstrap_proof_sha=$(sed -n '1p' "$UNSEALED_BOOTSTRAP_PROOF_SHA")
        actual_bootstrap_proof_sha=$(shasum -a 256 "$UNSEALED_BOOTSTRAP_PROOF" | awk '{print $1}')
        [ "$actual_bootstrap_proof_sha" = "$expected_bootstrap_proof_sha" ] || {
          echo "One-time Mac bootstrap boundary proof changed after pause." >&2
          exit 1
        }
        node -e '
          const proof = require(process.argv[1]);
          if (proof.format !== "krw-unsealed-mac-bootstrap-boundary/v1") process.exit(1);
          if (proof.deploymentId !== process.argv[2]) process.exit(1);
          if (proof.rollbackPolicy !== "gcp-only-mac-fail-closed") process.exit(1);
        ' "$UNSEALED_BOOTSTRAP_PROOF" "$NEXT_PUBLIC_APP_VERSION"
        ;;
      *)
        test -x "$preserved_runtime_root/scripts/verify-mac-runtime-target.sh"
        "$preserved_runtime_root/scripts/verify-mac-runtime-target.sh" \
          "$preserved_runtime_root/runtime.env"
        ;;
    esac
    TAB=$(printf '\t')
    while IFS="$TAB" read -r label previous_state plist snapshot_plist expected_sha; do
      [ -n "$label" ] || continue
      case "$previous_state" in loaded|stopped) ;; *) echo "Invalid preserved launchd state: $label" >&2; exit 1 ;; esac
      if [ "$expected_sha" != "absent" ]; then
        test -f "$snapshot_plist" || {
          echo "Preserved launchd plist disappeared: $snapshot_plist" >&2
          exit 1
        }
        actual_sha=$(shasum -a 256 "$snapshot_plist" | awk '{print $1}')
        test "$actual_sha" = "$expected_sha" || {
          echo "Preserved launchd plist changed: $snapshot_plist" >&2
          exit 1
        }
      fi
    done <"$CUTOVER_STATE_FILE"
  else
    if [ -e "$PLIST_SNAPSHOT_DIR" ]; then
      echo "Refusing to overwrite the preserved launchd snapshot: $PLIST_SNAPSHOT_DIR" >&2
      exit 1
    fi
    STATE_TMP="$CUTOVER_STATE_FILE.tmp.$$"
    cleanup_partial_launchd_snapshot() {
      # Once the fsynced phase journal binds this exact seal, the snapshot is
      # no longer scratch state. A signal between the journal commit and trap
      # removal must never delete rollback evidence referenced by that journal.
      if [ -f "$CUTOVER_PHASE_FILE" ] && [ ! -L "$CUTOVER_PHASE_FILE" ] \
        && [ -f "$MAC_SNAPSHOT_SEAL_PATH" ] && [ ! -L "$MAC_SNAPSHOT_SEAL_PATH" ]; then
        committed_seal_sha=$(sed -n 's/^MAC_SNAPSHOT_SEAL_SHA256=//p' \
          "$CUTOVER_PHASE_FILE" 2>/dev/null || true)
        actual_seal_sha=$(shasum -a 256 "$MAC_SNAPSHOT_SEAL_PATH" 2>/dev/null \
          | awk '{print $1}' || true)
        if [ "$(sed -n 's/^FORMAT=//p' "$CUTOVER_PHASE_FILE")" \
            = krw-production-cutover-phase/v1 ] \
          && [ "$(sed -n 's/^DEPLOYMENT_ID=//p' "$CUTOVER_PHASE_FILE")" \
            = "$NEXT_PUBLIC_APP_VERSION" ] \
          && [ "$(sed -n 's/^LOCK_OWNER=//p' "$CUTOVER_PHASE_FILE")" \
            = "$PRODUCTION_DEPLOY_LOCK_OWNER" ] \
          && [ "$(sed -n 's/^PHASE=//p' "$CUTOVER_PHASE_FILE")" \
            = pausing_pre_migration ] \
          && [ "$(sed -n 's/^MAC_SNAPSHOT_SEAL_PATH=//p' "$CUTOVER_PHASE_FILE")" \
            = "$MAC_SNAPSHOT_SEAL_PATH" ] \
          && printf '%s' "$committed_seal_sha" | grep -Eq '^[a-f0-9]{64}$' \
          && [ "$actual_seal_sha" = "$committed_seal_sha" ]; then
          return 0
        fi
      fi
      rm -f "$STATE_TMP" "$CUTOVER_STATE_FILE" "$MAC_SNAPSHOT_SEAL_PATH"
      rm -rf "$PLIST_SNAPSHOT_DIR"
    }
    trap cleanup_partial_launchd_snapshot EXIT
    mkdir -p "$PLIST_SNAPSHOT_DIR"
    chmod 700 "$PLIST_SNAPSHOT_DIR"
    if [ -L "$MAC_RUNTIME_CURRENT_LINK" ]; then
      current_runtime_target=$(readlink "$MAC_RUNTIME_CURRENT_LINK")
      printf 'symlink\t%s\n' "$current_runtime_target" >"$MAC_RUNTIME_CURRENT_SNAPSHOT"
    elif [ -e "$MAC_RUNTIME_CURRENT_LINK" ]; then
      echo "Mac runtime current pointer exists but is not a symlink: $MAC_RUNTIME_CURRENT_LINK" >&2
      exit 1
    else
      printf 'absent\t-\n' >"$MAC_RUNTIME_CURRENT_SNAPSHOT"
    fi
    chmod 400 "$MAC_RUNTIME_CURRENT_SNAPSHOT"
    : >"$STATE_TMP"
    chmod 600 "$STATE_TMP"
    snapshot_launchd_entry() {
      label=$1
      plist=$2
      state=stopped
      if launchctl print "$LAUNCHD_DOMAIN/$label" >/dev/null 2>&1; then
        state=loaded
        test -f "$plist" || {
          echo "Loaded launchd service is missing its rollback plist: $label" >&2
          rm -f "$STATE_TMP"
          exit 1
        }
      fi
      if [ -f "$plist" ]; then
        snapshot_plist="$PLIST_SNAPSHOT_DIR/$label.plist"
        cp -p "$plist" "$snapshot_plist"
        chmod 400 "$snapshot_plist"
        plist_sha=$(shasum -a 256 "$snapshot_plist" | awk '{print $1}')
      else
        snapshot_plist=absent
        plist_sha=absent
      fi
      printf '%s\t%s\t%s\t%s\t%s\n' "$label" "$state" "$plist" "$snapshot_plist" "$plist_sha" >>"$STATE_TMP"
    }
    for entry in \
      "com.krwontology.mcp-server:$HOME/Library/LaunchAgents/com.krwontology.mcp-server.plist" \
      "com.krwontology.stock-news-mcp:$HOME/Library/LaunchAgents/com.krwontology.stock-news-mcp.plist" \
      "com.krwontology.filings-mcp:$HOME/Library/LaunchAgents/com.krwontology.filings-mcp.plist"
    do
      snapshot_launchd_entry "${entry%%:*}" "${entry#*:}"
    done
    for plist in "$HOME/Library/LaunchAgents"/com.krwontology.agent-worker*.plist; do
      [ -e "$plist" ] || continue
      label=$(/usr/libexec/PlistBuddy -c 'Print :Label' "$plist" 2>/dev/null) || {
        echo "Cannot read launchd worker label from: $plist" >&2
        rm -f "$STATE_TMP"
        exit 1
      }
      case "$label" in
        com.krwontology.agent-worker|com.krwontology.agent-worker.*) ;;
        *)
          echo "Unexpected worker launchd label in $plist: $label" >&2
          rm -f "$STATE_TMP"
          exit 1
          ;;
      esac
      snapshot_launchd_entry "$label" "$plist"
    done
    if ! awk -F '\t' '$1 == "com.krwontology.agent-worker" { found = 1 } END { exit found ? 0 : 1 }' "$STATE_TMP"; then
      snapshot_launchd_entry \
        "com.krwontology.agent-worker" \
        "$HOME/Library/LaunchAgents/com.krwontology.agent-worker.plist"
    fi
    mv "$STATE_TMP" "$CUTOVER_STATE_FILE"

    loaded_service_count=$(awk -F '\t' '$2 == "loaded" { count += 1 } END { print count + 0 }' "$CUTOVER_STATE_FILE")
    if [ "$loaded_service_count" -gt 0 ]; then
      IFS="$TAB" read -r pointer_state pointer_target <"$MAC_RUNTIME_CURRENT_SNAPSHOT"
      if [ "$pointer_state" = symlink ]; then
        case "$pointer_target" in
          /*) prior_runtime_candidate=$pointer_target ;;
          *) prior_runtime_candidate="$MAC_RUNTIME_BASE/$pointer_target" ;;
        esac
        test -d "$prior_runtime_candidate" || {
          echo "Preserved Mac runtime target is missing: $prior_runtime_candidate" >&2
          exit 1
        }
        prior_runtime_root=$(CDPATH= cd -- "$prior_runtime_candidate" && pwd -P)
        runtime_base_root=$(CDPATH= cd -- "$MAC_RUNTIME_BASE" && pwd -P)
        case "$prior_runtime_root/" in
          "$runtime_base_root"/*/) ;;
          *)
            echo "Preserved Mac runtime escapes the immutable runtime base." >&2
            exit 1
            ;;
        esac
        test -f "$prior_runtime_root/runtime.env"
        test -x "$prior_runtime_root/scripts/verify-mac-runtime-target.sh"
        "$prior_runtime_root/scripts/verify-mac-runtime-target.sh" \
          "$prior_runtime_root/runtime.env"
        while IFS="$TAB" read -r label previous_state plist snapshot_plist expected_sha; do
          [ "$previous_state" = loaded ] || continue
          grep -F "<string>$prior_runtime_root/scripts/" "$snapshot_plist" >/dev/null || {
            echo "Loaded launchd service is not pinned to the preserved runtime: $label" >&2
            exit 1
          }
          grep -F "<string>$prior_runtime_root/runtime.env</string>" "$snapshot_plist" >/dev/null || {
            echo "Loaded launchd service is not pinned to the preserved runtime env: $label" >&2
            exit 1
          }
        done <"$CUTOVER_STATE_FILE"
        printf '%s\n' "$prior_runtime_root" >"$MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT"
      elif [ "$pointer_state" = absent ] && [ "$ALLOW_UNSEALED_FIRST_CUTOVER" = "1" ]; then
        [ "$pointer_target" = - ] || {
          echo "Invalid absent Mac runtime pointer snapshot." >&2
          exit 1
        }
        [ ! -e "$UNSEALED_BOOTSTRAP_MARKER" ] || {
          echo "The one-time unsealed Mac bootstrap was already consumed." >&2
          exit 1
        }
        [ ! -L "$MAC_RUNTIME_CURRENT_LINK" ] && [ ! -e "$MAC_RUNTIME_CURRENT_LINK" ] || {
          echo "The one-time bootstrap requires the immutable current pointer to be absent." >&2
          exit 1
        }
        candidate_runtime="$MAC_RUNTIME_BASE/$NEXT_PUBLIC_APP_VERSION"
        test -d "$candidate_runtime" || {
          echo "Prepared immutable Mac candidate is missing: $candidate_runtime" >&2
          exit 1
        }
        candidate_runtime=$(CDPATH= cd -- "$candidate_runtime" && pwd -P)
        runtime_base_root=$(CDPATH= cd -- "$MAC_RUNTIME_BASE" && pwd -P)
        case "$candidate_runtime/" in
          "$runtime_base_root"/*/) ;;
          *) echo "Prepared immutable Mac candidate escapes its runtime base." >&2; exit 1 ;;
        esac
        test -x "$candidate_runtime/scripts/verify-mac-runtime-target.sh"
        test -f "$candidate_runtime/runtime.env"
        "$candidate_runtime/scripts/verify-mac-runtime-target.sh" \
          "$candidate_runtime/runtime.env"

        printf '%s' "$EXPECTED_FRONT_SOURCE_SHA256" | grep -Eq '^[a-f0-9]{64}$' || {
          echo "Missing orchestrator-pinned frontend source digest for the one-time bootstrap." >&2
          exit 1
        }
        printf '%s' "$EXPECTED_ONTOLOGY_SOURCE_SHA256" | grep -Eq '^[a-f0-9]{64}$' || {
          echo "Missing orchestrator-pinned ontology source digest for the one-time bootstrap." >&2
          exit 1
        }
        test -f "$FRONT_DIR/scripts/compute-production-source-sha256.mjs"
        actual_front_source_sha=$(node \
          "$FRONT_DIR/scripts/compute-production-source-sha256.mjs" "$FRONT_DIR")
        [ "$actual_front_source_sha" = "$EXPECTED_FRONT_SOURCE_SHA256" ] || {
          echo "Legacy frontend source changed before the one-time Mac boundary." >&2
          exit 1
        }
        legacy_ontology_source=${KRW_ONTOLOGY_SOURCE_DIR:?Missing KRW_ONTOLOGY_SOURCE_DIR}
        actual_ontology_source_sha=$(node \
          "$FRONT_DIR/scripts/compute-production-source-sha256.mjs" \
          "$legacy_ontology_source")
        [ "$actual_ontology_source_sha" = "$EXPECTED_ONTOLOGY_SOURCE_SHA256" ] || {
          echo "Legacy ontology source changed before the one-time Mac boundary." >&2
          exit 1
        }
        legacy_env_path="$FRONT_DIR/.env.mac-worker.production"
        test -f "$legacy_env_path" || {
          echo "The canonical legacy Mac runtime env is missing: $legacy_env_path" >&2
          exit 1
        }
        test -d "$FRONT_DIR/.worker" || {
          echo "The canonical legacy Mac worker bundle is missing." >&2
          exit 1
        }
        state_was_loaded_for_bootstrap() {
          awk -F '\t' -v wanted="$1" \
            '$1 == wanted && $2 == "loaded" { found = 1 } END { exit found ? 0 : 1 }' \
            "$CUTOVER_STATE_FILE"
        }
        state_was_loaded_for_bootstrap com.krwontology.mcp-server || {
          echo "The canonical legacy ontology MCP must be loaded at the one-time boundary." >&2
          exit 1
        }
        state_was_loaded_for_bootstrap com.krwontology.agent-worker || {
          echo "The canonical legacy Mac agent worker must be loaded at the one-time boundary." >&2
          exit 1
        }
        if awk -F '\t' '$2 == "loaded" && $1 ~ /^com[.]krwontology[.]agent-worker[.]/ { found = 1 } END { exit found ? 0 : 1 }' "$CUTOVER_STATE_FILE"; then
          echo "Numbered legacy agent workers cannot cross the one-time bootstrap boundary." >&2
          exit 1
        fi
        while IFS="$TAB" read -r label previous_state plist snapshot_plist expected_sha; do
          [ "$previous_state" = loaded ] || continue
          case "$label" in
            com.krwontology.mcp-server)
              expected_legacy_script="$FRONT_DIR/scripts/start-mcp-server-production.sh"
              ;;
            com.krwontology.stock-news-mcp)
              expected_legacy_script="$FRONT_DIR/scripts/start-stock-news-mcp-production.sh"
              ;;
            com.krwontology.filings-mcp)
              expected_legacy_script="$FRONT_DIR/scripts/start-filings-mcp-production.sh"
              ;;
            com.krwontology.agent-worker)
              expected_legacy_script="$FRONT_DIR/scripts/start-mac-worker-production.sh"
              ;;
            *)
              echo "Unexpected loaded legacy launchd service at the one-time boundary: $label" >&2
              exit 1
              ;;
          esac
          [ "$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:0' "$snapshot_plist")" = /bin/sh ] || {
            echo "Legacy launchd program changed before the one-time boundary: $label" >&2
            exit 1
          }
          [ "$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:1' "$snapshot_plist")" = "$expected_legacy_script" ] || {
            echo "Legacy launchd script path is not canonical: $label" >&2
            exit 1
          }
          [ "$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:2' "$snapshot_plist")" = --env-file ] || {
            echo "Legacy launchd env argument is not canonical: $label" >&2
            exit 1
          }
          [ "$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:3' "$snapshot_plist")" = "$legacy_env_path" ] || {
            echo "Legacy launchd env path is not canonical: $label" >&2
            exit 1
          }
        done <"$CUTOVER_STATE_FILE"

        legacy_env_sha=$(shasum -a 256 "$legacy_env_path" | awk '{print $1}')
        legacy_worker_sha=$(node \
          "$FRONT_DIR/scripts/compute-production-source-sha256.mjs" \
          "$FRONT_DIR/.worker")
        candidate_identity_sha=$(shasum -a 256 \
          "$candidate_runtime/runtime-identity.json" | awk '{print $1}')
        state_sha=$(shasum -a 256 "$CUTOVER_STATE_FILE" | awk '{print $1}')
        BOOTSTRAP_PROOF_TMP="$UNSEALED_BOOTSTRAP_PROOF.tmp.$$"
        export NEXT_PUBLIC_APP_VERSION candidate_runtime candidate_identity_sha
        export actual_front_source_sha actual_ontology_source_sha legacy_env_sha
        export legacy_worker_sha state_sha CUTOVER_STATE_FILE
        node <<'NODE' >"$BOOTSTRAP_PROOF_TMP"
const fs = require("fs");
const rows = fs.readFileSync(process.env.CUTOVER_STATE_FILE, "utf8")
  .trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [label, previousState, , , plistSha256] = line.split("\t");
    return { label, previousState, plistSha256 };
  });
const proof = {
  format: "krw-unsealed-mac-bootstrap-boundary/v1",
  deploymentId: process.env.NEXT_PUBLIC_APP_VERSION,
  createdAt: new Date().toISOString(),
  rollbackPolicy: "gcp-only-mac-fail-closed",
  candidateRuntimeRoot: process.env.candidate_runtime,
  candidateRuntimeIdentitySha256: process.env.candidate_identity_sha,
  legacyDiskFrontSourceSha256: process.env.actual_front_source_sha,
  legacyDiskOntologySourceSha256: process.env.actual_ontology_source_sha,
  legacyDiskEnvSha256: process.env.legacy_env_sha,
  legacyDiskWorkerBundleSha256: process.env.legacy_worker_sha,
  launchdStateSha256: process.env.state_sha,
  launchd: rows,
  exactLegacyRuntimeRollbackAvailable: false,
};
process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
NODE
        chmod 400 "$BOOTSTRAP_PROOF_TMP"
        mv "$BOOTSTRAP_PROOF_TMP" "$UNSEALED_BOOTSTRAP_PROOF"
        shasum -a 256 "$UNSEALED_BOOTSTRAP_PROOF" | awk '{print $1}' \
          >"$UNSEALED_BOOTSTRAP_PROOF_SHA"
        chmod 400 "$UNSEALED_BOOTSTRAP_PROOF_SHA"
        printf '%s\n' unsealed-fail-closed >"$MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT"
      else
        echo "Loaded Mac production services are not backed by a sealed runtime pointer; refusing an inexact first cutover." >&2
        exit 1
      fi
    elif [ "$ALLOW_UNSEALED_FIRST_CUTOVER" = "1" ]; then
      # A retry after an earlier fail-closed bootstrap may legitimately find
      # every legacy service already stopped. It still needs an immutable
      # boundary proof so successful activation can permanently consume the
      # one-time bridge.
      IFS="$TAB" read -r pointer_state pointer_target <"$MAC_RUNTIME_CURRENT_SNAPSHOT"
      [ "$pointer_state" = absent ] && [ "$pointer_target" = - ] || {
        echo "A stopped one-time bootstrap retry requires an absent current pointer." >&2
        exit 1
      }
      [ ! -e "$UNSEALED_BOOTSTRAP_MARKER" ] || {
        echo "The one-time unsealed Mac bootstrap was already consumed." >&2
        exit 1
      }
      candidate_runtime="$MAC_RUNTIME_BASE/$NEXT_PUBLIC_APP_VERSION"
      test -d "$candidate_runtime"
      candidate_runtime=$(CDPATH= cd -- "$candidate_runtime" && pwd -P)
      test -x "$candidate_runtime/scripts/verify-mac-runtime-target.sh"
      "$candidate_runtime/scripts/verify-mac-runtime-target.sh" \
        "$candidate_runtime/runtime.env"
      actual_front_source_sha=$(node \
        "$FRONT_DIR/scripts/compute-production-source-sha256.mjs" "$FRONT_DIR")
      actual_ontology_source_sha=$(node \
        "$FRONT_DIR/scripts/compute-production-source-sha256.mjs" \
        "${KRW_ONTOLOGY_SOURCE_DIR:?Missing KRW_ONTOLOGY_SOURCE_DIR}")
      [ "$actual_front_source_sha" = "$EXPECTED_FRONT_SOURCE_SHA256" ]
      [ "$actual_ontology_source_sha" = "$EXPECTED_ONTOLOGY_SOURCE_SHA256" ]
      legacy_env_path="$FRONT_DIR/.env.mac-worker.production"
      test -f "$legacy_env_path"
      legacy_env_sha=$(shasum -a 256 "$legacy_env_path" | awk '{print $1}')
      legacy_worker_sha=absent
      if [ -d "$FRONT_DIR/.worker" ]; then
        legacy_worker_sha=$(node \
          "$FRONT_DIR/scripts/compute-production-source-sha256.mjs" \
          "$FRONT_DIR/.worker")
      fi
      candidate_identity_sha=$(shasum -a 256 \
        "$candidate_runtime/runtime-identity.json" | awk '{print $1}')
      state_sha=$(shasum -a 256 "$CUTOVER_STATE_FILE" | awk '{print $1}')
      BOOTSTRAP_PROOF_TMP="$UNSEALED_BOOTSTRAP_PROOF.tmp.$$"
      export NEXT_PUBLIC_APP_VERSION candidate_runtime candidate_identity_sha
      export actual_front_source_sha actual_ontology_source_sha legacy_env_sha
      export legacy_worker_sha state_sha CUTOVER_STATE_FILE
      node <<'NODE' >"$BOOTSTRAP_PROOF_TMP"
const fs = require("fs");
const rows = fs.readFileSync(process.env.CUTOVER_STATE_FILE, "utf8")
  .trim().split(/\r?\n/).filter(Boolean).map((line) => {
    const [label, previousState, , , plistSha256] = line.split("\t");
    return { label, previousState, plistSha256 };
  });
const proof = {
  format: "krw-unsealed-mac-bootstrap-boundary/v1",
  deploymentId: process.env.NEXT_PUBLIC_APP_VERSION,
  createdAt: new Date().toISOString(),
  rollbackPolicy: "gcp-only-mac-fail-closed",
  candidateRuntimeRoot: process.env.candidate_runtime,
  candidateRuntimeIdentitySha256: process.env.candidate_identity_sha,
  legacyDiskFrontSourceSha256: process.env.actual_front_source_sha,
  legacyDiskOntologySourceSha256: process.env.actual_ontology_source_sha,
  legacyDiskEnvSha256: process.env.legacy_env_sha,
  legacyDiskWorkerBundleSha256: process.env.legacy_worker_sha,
  launchdStateSha256: process.env.state_sha,
  launchd: rows,
  legacyRuntimeWasAlreadyStopped: true,
  exactLegacyRuntimeRollbackAvailable: false,
};
process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`);
NODE
      chmod 400 "$BOOTSTRAP_PROOF_TMP"
      mv "$BOOTSTRAP_PROOF_TMP" "$UNSEALED_BOOTSTRAP_PROOF"
      shasum -a 256 "$UNSEALED_BOOTSTRAP_PROOF" | awk '{print $1}' \
        >"$UNSEALED_BOOTSTRAP_PROOF_SHA"
      chmod 400 "$UNSEALED_BOOTSTRAP_PROOF_SHA"
      printf '%s\n' unsealed-fail-closed >"$MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT"
    else
      printf '%s\n' absent >"$MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT"
    fi
    chmod 400 "$MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT"
    prepare_mac_snapshot_seal
  fi

  if [ "$FAIL_CLOSED_REPAUSE" != "1" ]; then
    write_cutover_phase pausing_pre_migration
    validate_cutover_phase_provenance "$CUTOVER_PHASE_FILE"
    trap - EXIT
    current_cutover_phase=pausing_pre_migration
  fi

  "$SCRIPT_DIR/uninstall-mac-worker-launchd.sh" --keep-plist
  "$SCRIPT_DIR/uninstall-mcp-server-launchd.sh" --keep-plist
  "$SCRIPT_DIR/uninstall-stock-news-mcp-launchd.sh" --keep-plist
  FILINGS_MCP_PLIST="$HOME/Library/LaunchAgents/com.krwontology.filings-mcp.plist"
  if [ -f "$FILINGS_MCP_PLIST" ]; then
    launchctl bootout "$LAUNCHD_DOMAIN" "$FILINGS_MCP_PLIST" >/dev/null 2>&1 || true
  fi

  for attempt in $(seq 1 20); do
    if ! ps eww -axo pid,command | awk '
      /[.]worker\/agent-worker[.]mjs/ && !/awk/ { found = 1 }
      END { exit found ? 0 : 1 }
    '; then
      break
    fi
    if [ "$attempt" -eq 20 ]; then
      echo "Mac agent worker processes are still running after launchd pause." >&2
      exit 1
    fi
    sleep 0.5
  done

  while IFS="$TAB" read -r label previous_state plist snapshot_plist expected_sha; do
    [ -n "$label" ] || continue
    if launchctl print "$LAUNCHD_DOMAIN/$label" >/dev/null 2>&1; then
      echo "Mac launchd service is still loaded after cutover pause: $label" >&2
      exit 1
    fi
  done <"$CUTOVER_STATE_FILE"

  command -v lsof >/dev/null 2>&1 || {
    echo "Missing required command for cutover listener verification: lsof" >&2
    exit 1
  }
  for attempt in $(seq 1 20); do
    listener_found=0
    for port in "$KRW_ONTOLOGY_MCP_PORT" "$STOCK_NEWS_MCP_PORT" "$FILINGS_MCP_PORT"; do
      if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
        listener_found=1
      fi
    done
    if [ "$listener_found" = "0" ]; then
      break
    fi
    if [ "$attempt" -eq 20 ]; then
      echo "A local MCP listener is still accepting requests after the cutover pause." >&2
      for port in "$KRW_ONTOLOGY_MCP_PORT" "$STOCK_NEWS_MCP_PORT" "$FILINGS_MCP_PORT"; do
        lsof -nP -iTCP:"$port" -sTCP:LISTEN >&2 || true
      done
      exit 1
    fi
    sleep 0.5
  done

  REMOTE_COMMAND=$(cat <<EOF
set -eu
ROLLBACK_DIR='$REMOTE_ROLLBACK_DIR'
RELEASE_MANIFEST='$REMOTE_FRONT_DIR/.deploy/releases/$NEXT_PUBLIC_APP_VERSION/release-manifest.env'
PHASE_CANDIDATE_RUNTIME_ENV_SHA='$EXPECTED_ENV_SHA256'
CANDIDATE_RELEASE_DIR='$REMOTE_FRONT_DIR/.deploy/releases/$NEXT_PUBLIC_APP_VERSION'
CANDIDATE_LOCAL_MARKER="\$CANDIDATE_RELEASE_DIR/prepared-web-release.env"
CANDIDATE_ACTIVATED_MARKER="\$CANDIDATE_RELEASE_DIR/activated-web-release.env"
if [ -e "\$CANDIDATE_ACTIVATED_MARKER" ]; then
  test -f "\$CANDIDATE_ACTIVATED_MARKER" && [ ! -L "\$CANDIDATE_ACTIVATED_MARKER" ]
  test -f "\$CANDIDATE_LOCAL_MARKER" && [ ! -L "\$CANDIDATE_LOCAL_MARKER" ]
  cmp -s "\$CANDIDATE_LOCAL_MARKER" "\$CANDIDATE_ACTIVATED_MARKER"
  echo "Refusing old-runtime recovery because the candidate activation receipt is already committed." >&2
  exit 1
fi
test -f "\$RELEASE_MANIFEST"
test -f "\$ROLLBACK_DIR/manifest.env"
test "\$(sed -n 's/^FORMAT=//p' "\$RELEASE_MANIFEST")" = 'krw-production-release-registry/v1'
test "\$(sed -n 's/^APP_VERSION=//p' "\$RELEASE_MANIFEST")" = '$NEXT_PUBLIC_APP_VERSION'
test "\$(sed -n 's/^RUNTIME_ENV_SHA256=//p' "\$RELEASE_MANIFEST")" = "\$PHASE_CANDIDATE_RUNTIME_ENV_SHA"
EXPECTED_ROLLBACK_MANIFEST_SHA=\$(sed -n 's/^ROLLBACK_MANIFEST_SHA256=//p' "\$RELEASE_MANIFEST")
test "\$(sha256sum "\$ROLLBACK_DIR/manifest.env" | awk '{print \$1}')" = "\$EXPECTED_ROLLBACK_MANIFEST_SHA" || {
  echo "Release registry and rollback manifest cross-seal disagree." >&2
  exit 1
}
test -f "\$ROLLBACK_DIR/manifest.env"
test -f "\$ROLLBACK_DIR/compose.resolved.yml"
test -f "\$ROLLBACK_DIR/services.tsv"
test -f "\$ROLLBACK_DIR/front-source.tar.gz" && [ ! -L "\$ROLLBACK_DIR/front-source.tar.gz" ]
test -f "\$ROLLBACK_DIR/runtime.env"
  test -f "\$ROLLBACK_DIR/verify-supabase-production-target.mjs" \
    && [ ! -L "\$ROLLBACK_DIR/verify-supabase-production-target.mjs" ]
  test -f "\$ROLLBACK_DIR/atomic-install-sealed-file.mjs"
  test -f "\$ROLLBACK_DIR/production-target.json"
test "\$(sed -n 's/^FORMAT=//p' "\$ROLLBACK_DIR/manifest.env")" = 'krw-code-rollback/v2'
test "\$(sed -n 's/^CUTOVER_APP_VERSION=//p' "\$ROLLBACK_DIR/manifest.env")" = '${NEXT_PUBLIC_APP_VERSION:-manual}'
test "\$(grep -c '^PREVIOUS_FRONT_SOURCE_SHA256=' "\$ROLLBACK_DIR/manifest.env")" = 1 || {
  echo "Rollback manifest must define PREVIOUS_FRONT_SOURCE_SHA256 exactly once." >&2
  exit 1
}
EXPECTED_PREVIOUS_FRONT_SOURCE_SHA=\$(sed -n 's/^PREVIOUS_FRONT_SOURCE_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
printf '%s' "\$EXPECTED_PREVIOUS_FRONT_SOURCE_SHA" | grep -Eq '^[a-f0-9]{64}\$' || {
  echo "Rollback manifest has an invalid previous frontend source identity." >&2
  exit 1
}
EXPECTED_COMPOSE_SHA=\$(sed -n 's/^RESOLVED_COMPOSE_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
EXPECTED_STATE_SHA=\$(sed -n 's/^SERVICE_STATE_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
EXPECTED_FRONT_ARCHIVE_SHA=\$(sed -n 's/^FRONT_ARCHIVE_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
EXPECTED_RUNTIME_ENV_SHA=\$(sed -n 's/^RUNTIME_ENV_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
  EXPECTED_TARGET_VERIFIER_SHA=\$(sed -n 's/^TARGET_VERIFIER_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
  EXPECTED_ATOMIC_INSTALLER_SHA=\$(sed -n 's/^ATOMIC_INSTALLER_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
  EXPECTED_PRODUCTION_TARGET_SHA=\$(sed -n 's/^PRODUCTION_TARGET_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
test "\$(sha256sum "\$ROLLBACK_DIR/compose.resolved.yml" | awk '{print \$1}')" = "\$EXPECTED_COMPOSE_SHA"
test "\$(sha256sum "\$ROLLBACK_DIR/services.tsv" | awk '{print \$1}')" = "\$EXPECTED_STATE_SHA"
test "\$(sha256sum "\$ROLLBACK_DIR/front-source.tar.gz" | awk '{print \$1}')" = "\$EXPECTED_FRONT_ARCHIVE_SHA"
test "\$(sha256sum "\$ROLLBACK_DIR/runtime.env" | awk '{print \$1}')" = "\$EXPECTED_RUNTIME_ENV_SHA"
  test "\$(sha256sum "\$ROLLBACK_DIR/verify-supabase-production-target.mjs" | awk '{print \$1}')" = "\$EXPECTED_TARGET_VERIFIER_SHA"
  test "\$(sha256sum "\$ROLLBACK_DIR/atomic-install-sealed-file.mjs" | awk '{print \$1}')" = "\$EXPECTED_ATOMIC_INSTALLER_SHA"
  test "\$(sha256sum "\$ROLLBACK_DIR/production-target.json" | awk '{print \$1}')" = "\$EXPECTED_PRODUCTION_TARGET_SHA"
ROLLBACK_SOURCE_STAGE=\$(mktemp -d /tmp/krw-front-pause.XXXXXX)
cleanup_pause_source() { rm -rf "\$ROLLBACK_SOURCE_STAGE"; }
trap cleanup_pause_source EXIT INT TERM
test -z "\$(find "\$ROLLBACK_SOURCE_STAGE" -mindepth 1 -print -quit)"
tar --extract --gzip --file "\$ROLLBACK_DIR/front-source.tar.gz" \
  --directory "\$ROLLBACK_SOURCE_STAGE" \
  --no-same-owner --no-same-permissions --delay-directory-restore \
  --warning=no-unknown-keyword
node -e '
  const fs = require("fs");
  const file = process.argv[1];
  const expected = process.argv[2];
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("Archived rollback production target must be a regular non-symlink file");
  const target = JSON.parse(fs.readFileSync(file, "utf8"));
  if (target?.format !== "krw-production-target/v1" || target?.supabaseProjectRef !== expected) {
    throw new Error("Archived rollback production target does not match the canonical Supabase project");
  }
' "\$ROLLBACK_SOURCE_STAGE/ops/production-target.json" '$CANONICAL_SUPABASE_PROJECT_REF'
node "\$ROLLBACK_DIR/verify-supabase-production-target.mjs" \
  "\$ROLLBACK_DIR/runtime.env" - \
  "\$ROLLBACK_DIR/production-target.json" \
  --require-origins \
  --rollback-proof "\$ROLLBACK_DIR/manifest.env" "\$RELEASE_MANIFEST" \
  --rollback-source-root "\$ROLLBACK_SOURCE_STAGE"
test "\$(node -e 'const target=require(process.argv[1]);process.stdout.write(target.supabaseProjectRef)' "\$ROLLBACK_DIR/production-target.json")" = '$CANONICAL_SUPABASE_PROJECT_REF'
RUNNING_PROJECT_CONTAINERS="\$ROLLBACK_SOURCE_STAGE/running-project-containers.tsv"
docker ps \
  --filter 'label=com.docker.compose.project=$COMPOSE_PROJECT_NAME' \
  --filter status=running \
  --format '{{.ID}}\t{{.Label "com.docker.compose.service"}}\t{{.Names}}' \
  >"\$RUNNING_PROJECT_CONTAINERS"
TAB=\$(printf '\t')
while IFS="\$TAB" read -r running_id running_service running_name; do
  [ -n "\$running_id" ] || continue
  known_service=0
  if [ "\$running_service" = redis ] || printf '%s\n' $REMOTE_PAUSE_SERVICES | grep -Fx "\$running_service" >/dev/null; then
    known_service=1
  fi
  if [ "\$known_service" != 1 ]; then
    if [ '$FAIL_CLOSED_REPAUSE' = 1 ]; then
      docker stop --time 120 "\$running_id"
    else
      echo "Unknown running production Compose service: \${running_service:-missing} (\$running_name)" >&2
      exit 1
    fi
  fi
  if [ "\$known_service" = 1 ]; then
    running_count=\$(awk -F '\t' -v wanted="\$running_service" '\$2 == wanted { count += 1 } END { print count + 0 }' "\$RUNNING_PROJECT_CONTAINERS")
    [ "\$running_count" = 1 ] || {
      echo "Scaled/duplicate production Compose service is outside the cutover contract: \$running_service" >&2
      exit 1
    }
  fi
done <"\$RUNNING_PROJECT_CONTAINERS"
if [ '$FAIL_CLOSED_REPAUSE' != '1' ]; then
  for service in $REMOTE_PAUSE_SERVICES; do
    expected_line=\$(awk -F '\t' -v wanted="\$service" '\$1 == wanted { print \$2 "\t" \$3; found = 1 } END { if (!found) exit 1 }' "\$ROLLBACK_DIR/services.tsv")
    expected_running=\$(printf '%s' "\$expected_line" | cut -f1)
    expected_image=\$(printf '%s' "\$expected_line" | cut -f2)
    container_id=\$(docker compose --project-name '$COMPOSE_PROJECT_NAME' \
      -f "\$ROLLBACK_DIR/compose.resolved.yml" ps -q "\$service")
    actual_running=false
    actual_image=absent
    if [ -n "\$container_id" ]; then
      actual_running=\$(docker inspect --format '{{.State.Running}}' "\$container_id")
      actual_image=\$(docker inspect --format '{{.Image}}' "\$container_id")
    fi
    if [ "\$actual_running" != "\$expected_running" ] || [ "\$actual_image" != "\$expected_image" ]; then
      echo "Remote runtime changed between preparation and pause: \$service" >&2
      exit 1
    fi
  done
fi
docker compose --project-name '$COMPOSE_PROJECT_NAME' \
  -f "\$ROLLBACK_DIR/compose.resolved.yml" stop --timeout 120 reverse-proxy
docker compose --project-name '$COMPOSE_PROJECT_NAME' \
  -f "\$ROLLBACK_DIR/compose.resolved.yml" stop --timeout 120 $REMOTE_PAUSE_APPLICATION_SERVICES
for service in $REMOTE_PAUSE_SERVICES; do
  container_id=\$(docker compose --project-name '$COMPOSE_PROJECT_NAME' \
    -f "\$ROLLBACK_DIR/compose.resolved.yml" ps -q "\$service")
  if [ -n "\$container_id" ] && [ "\$(docker inspect --format '{{.State.Running}}' "\$container_id")" = 'true' ]; then
    echo "Service is still running after cutover pause: \$service" >&2
    exit 1
  fi
done
docker ps \
  --filter 'label=com.docker.compose.project=$COMPOSE_PROJECT_NAME' \
  --filter status=running \
  --format '{{.Label "com.docker.compose.service"}}' \
  | while IFS= read -r remaining_service; do
      [ "\$remaining_service" = redis ] || {
        echo "A production Compose application service remains running after pause: \${remaining_service:-missing}" >&2
        exit 1
      }
    done
EOF
  )
  gcloud compute ssh "$GCP_INSTANCE" \
    --project="$GCP_PROJECT" \
    --zone="$GCP_ZONE" \
    --command="$REMOTE_COMMAND"
  if [ "$FAIL_CLOSED_REPAUSE" = "1" ]; then
    case "$current_cutover_phase" in
      pausing_pre_migration|paused_pre_migration|activating_code_only|mac_fail_closed_pre_migration|restoring_old|restoring_gcp_only)
        write_cutover_phase mac_fail_closed_pre_migration
        ;;
      migration_started|continuing_migration|verifying_migration|fail_closed_migration_unverified)
        write_cutover_phase fail_closed_migration_unverified
        ;;
      stop_unverified_pre_migration)
        write_cutover_phase mac_fail_closed_pre_migration
        ;;
      stop_unverified_migration_unverified)
        write_cutover_phase fail_closed_migration_unverified
        ;;
      stop_unverified_candidate_ready)
        write_cutover_phase fail_closed_candidate_ready
        ;;
      migration_verified|activating_migrated|resuming_candidate|fail_closed_candidate_ready)
        write_cutover_phase fail_closed_candidate_ready
        ;;
      *)
        write_cutover_phase fail_closed
        ;;
    esac
  else
    write_cutover_phase paused_pre_migration
  fi
  echo "Production application runtimes paused for schema cutover."
  exit 0
fi

REMOTE_COMMAND=$(cat <<EOF
set -eu
ROLLBACK_DIR='$REMOTE_ROLLBACK_DIR'
RELEASE_MANIFEST='$REMOTE_FRONT_DIR/.deploy/releases/$NEXT_PUBLIC_APP_VERSION/release-manifest.env'
PHASE_CANDIDATE_RUNTIME_ENV_SHA='$EXPECTED_ENV_SHA256'
CANDIDATE_RELEASE_DIR='$REMOTE_FRONT_DIR/.deploy/releases/$NEXT_PUBLIC_APP_VERSION'
CANDIDATE_LOCAL_MARKER="\$CANDIDATE_RELEASE_DIR/prepared-web-release.env"
CANDIDATE_ACTIVATED_MARKER="\$CANDIDATE_RELEASE_DIR/activated-web-release.env"
if [ -e "\$CANDIDATE_ACTIVATED_MARKER" ]; then
  test -f "\$CANDIDATE_ACTIVATED_MARKER" && [ ! -L "\$CANDIDATE_ACTIVATED_MARKER" ]
  test -f "\$CANDIDATE_LOCAL_MARKER" && [ ! -L "\$CANDIDATE_LOCAL_MARKER" ]
  cmp -s "\$CANDIDATE_LOCAL_MARKER" "\$CANDIDATE_ACTIVATED_MARKER"
  echo "Refusing old-runtime recovery because the candidate activation receipt is already committed." >&2
  exit 1
fi
test -f "\$RELEASE_MANIFEST"
test -f "\$ROLLBACK_DIR/manifest.env"
test "\$(sed -n 's/^FORMAT=//p' "\$RELEASE_MANIFEST")" = 'krw-production-release-registry/v1'
test "\$(sed -n 's/^APP_VERSION=//p' "\$RELEASE_MANIFEST")" = '$NEXT_PUBLIC_APP_VERSION'
EXPECTED_ROLLBACK_MANIFEST_SHA=\$(sed -n 's/^ROLLBACK_MANIFEST_SHA256=//p' "\$RELEASE_MANIFEST")
EXPECTED_CANDIDATE_RUNTIME_ENV_SHA=\$(sed -n 's/^RUNTIME_ENV_SHA256=//p' "\$RELEASE_MANIFEST")
test "\$EXPECTED_CANDIDATE_RUNTIME_ENV_SHA" = "\$PHASE_CANDIDATE_RUNTIME_ENV_SHA"
test "\$(sha256sum "\$ROLLBACK_DIR/manifest.env" | awk '{print \$1}')" = "\$EXPECTED_ROLLBACK_MANIFEST_SHA" || {
  echo "Release registry and rollback manifest cross-seal disagree." >&2
  exit 1
}
test -f "\$ROLLBACK_DIR/manifest.env"
test -f "\$ROLLBACK_DIR/compose.resolved.yml"
test -f "\$ROLLBACK_DIR/services.tsv"
test -f "\$ROLLBACK_DIR/front-source.tar.gz" && [ ! -L "\$ROLLBACK_DIR/front-source.tar.gz" ]
test -f "\$ROLLBACK_DIR/runtime.env"
test -f "\$ROLLBACK_DIR/verify-supabase-production-target.mjs" \
  && [ ! -L "\$ROLLBACK_DIR/verify-supabase-production-target.mjs" ]
test -f "\$ROLLBACK_DIR/atomic-install-sealed-file.mjs"
test -f "\$ROLLBACK_DIR/production-target.json"
test "\$(sed -n 's/^FORMAT=//p' "\$ROLLBACK_DIR/manifest.env")" = 'krw-code-rollback/v2'
test "\$(sed -n 's/^CUTOVER_APP_VERSION=//p' "\$ROLLBACK_DIR/manifest.env")" = '${NEXT_PUBLIC_APP_VERSION:-manual}'
test "\$(grep -c '^PREVIOUS_FRONT_SOURCE_SHA256=' "\$ROLLBACK_DIR/manifest.env")" = 1 || {
  echo "Rollback manifest must define PREVIOUS_FRONT_SOURCE_SHA256 exactly once." >&2
  exit 1
}
EXPECTED_PREVIOUS_FRONT_SOURCE_SHA=\$(sed -n 's/^PREVIOUS_FRONT_SOURCE_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
printf '%s' "\$EXPECTED_PREVIOUS_FRONT_SOURCE_SHA" | grep -Eq '^[a-f0-9]{64}\$' || {
  echo "Rollback manifest has an invalid previous frontend source identity." >&2
  exit 1
}
EXPECTED_COMPOSE_SHA=\$(sed -n 's/^RESOLVED_COMPOSE_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
EXPECTED_STATE_SHA=\$(sed -n 's/^SERVICE_STATE_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
EXPECTED_FRONT_ARCHIVE_SHA=\$(sed -n 's/^FRONT_ARCHIVE_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
EXPECTED_RUNTIME_ENV_SHA=\$(sed -n 's/^RUNTIME_ENV_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
EXPECTED_TARGET_VERIFIER_SHA=\$(sed -n 's/^TARGET_VERIFIER_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
EXPECTED_ATOMIC_INSTALLER_SHA=\$(sed -n 's/^ATOMIC_INSTALLER_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
EXPECTED_PRODUCTION_TARGET_SHA=\$(sed -n 's/^PRODUCTION_TARGET_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
PREVIOUS_APP_VERSION=\$(sed -n 's/^PREVIOUS_APP_VERSION=//p' "\$ROLLBACK_DIR/manifest.env")
PREVIOUS_WEB_IMAGE_ID=\$(sed -n 's/^PREVIOUS_WEB_IMAGE_ID=//p' "\$ROLLBACK_DIR/manifest.env")
PREVIOUS_CADDY_IMAGE_ID=\$(sed -n 's/^PREVIOUS_CADDY_IMAGE_ID=//p' "\$ROLLBACK_DIR/manifest.env")
test "\$(sha256sum "\$ROLLBACK_DIR/compose.resolved.yml" | awk '{print \$1}')" = "\$EXPECTED_COMPOSE_SHA"
test "\$(sha256sum "\$ROLLBACK_DIR/services.tsv" | awk '{print \$1}')" = "\$EXPECTED_STATE_SHA"
test "\$(sha256sum "\$ROLLBACK_DIR/front-source.tar.gz" | awk '{print \$1}')" = "\$EXPECTED_FRONT_ARCHIVE_SHA"
test "\$(sha256sum "\$ROLLBACK_DIR/runtime.env" | awk '{print \$1}')" = "\$EXPECTED_RUNTIME_ENV_SHA"
test "\$(sha256sum "\$ROLLBACK_DIR/verify-supabase-production-target.mjs" | awk '{print \$1}')" = "\$EXPECTED_TARGET_VERIFIER_SHA"
test "\$(sha256sum "\$ROLLBACK_DIR/atomic-install-sealed-file.mjs" | awk '{print \$1}')" = "\$EXPECTED_ATOMIC_INSTALLER_SHA"
test "\$(sha256sum "\$ROLLBACK_DIR/production-target.json" | awk '{print \$1}')" = "\$EXPECTED_PRODUCTION_TARGET_SHA"
test -f '$REMOTE_FRONT_DIR/.env' && [ ! -L '$REMOTE_FRONT_DIR/.env' ] || {
  echo "Live web environment must be a regular non-symlink file before rollback." >&2
  exit 1
}
LIVE_RUNTIME_ENV_SHA=\$(sha256sum '$REMOTE_FRONT_DIR/.env' | awk '{print \$1}')
if [ "\$LIVE_RUNTIME_ENV_SHA" != "\$EXPECTED_RUNTIME_ENV_SHA" ] \
  && [ "\$LIVE_RUNTIME_ENV_SHA" != "\$EXPECTED_CANDIDATE_RUNTIME_ENV_SHA" ]; then
  echo "Live web environment is neither the sealed candidate nor rollback state." >&2
  exit 1
fi

ROLLBACK_SOURCE_STAGE=\$(mktemp -d /tmp/krw-front-rollback.XXXXXX)
LIVE_ENV_TMP=
cleanup_rollback_source() {
  rm -rf "\$ROLLBACK_SOURCE_STAGE"
  [ -z "\$LIVE_ENV_TMP" ] || rm -f "\$LIVE_ENV_TMP"
}
trap cleanup_rollback_source EXIT INT TERM
test -z "\$(find "\$ROLLBACK_SOURCE_STAGE" -mindepth 1 -print -quit)"
tar --extract --gzip --file "\$ROLLBACK_DIR/front-source.tar.gz" \
  --directory "\$ROLLBACK_SOURCE_STAGE" \
  --no-same-owner --no-same-permissions --delay-directory-restore \
  --warning=no-unknown-keyword
node -e '
  const fs = require("fs");
  const file = process.argv[1];
  const expected = process.argv[2];
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("Archived rollback production target must be a regular non-symlink file");
  const target = JSON.parse(fs.readFileSync(file, "utf8"));
  if (target?.format !== "krw-production-target/v1" || target?.supabaseProjectRef !== expected) {
    throw new Error("Archived rollback production target does not match the canonical Supabase project");
  }
' "\$ROLLBACK_SOURCE_STAGE/ops/production-target.json" '$CANONICAL_SUPABASE_PROJECT_REF'
node "\$ROLLBACK_DIR/verify-supabase-production-target.mjs" \
  "\$ROLLBACK_DIR/runtime.env" - \
  "\$ROLLBACK_DIR/production-target.json" \
  --require-origins \
  --rollback-proof "\$ROLLBACK_DIR/manifest.env" "\$RELEASE_MANIFEST" \
  --rollback-source-root "\$ROLLBACK_SOURCE_STAGE"
test "\$(node -e 'const target=require(process.argv[1]);process.stdout.write(target.supabaseProjectRef)' "\$ROLLBACK_DIR/production-target.json")" = '$CANONICAL_SUPABASE_PROJECT_REF'

# Prove the complete rollback transaction is executable before closing public
# traffic. The same checks run again after stop; this first pass makes corrupt
# state, missing images, or an invalid prior public topology a no-op failure.
proxy_was_running=false
web_was_running=false
for service in $REMOTE_PAUSE_SERVICES; do
  service_count=\$(awk -F '\t' -v wanted="\$service" '\$1 == wanted { count += 1 } END { print count + 0 }' "\$ROLLBACK_DIR/services.tsv")
  [ "\$service_count" = 1 ] || { echo "Rollback service state must contain exactly one row: \$service" >&2; exit 1; }
  expected_line=\$(awk -F '\t' -v wanted="\$service" '\$1 == wanted { print \$2 "\t" \$3 }' "\$ROLLBACK_DIR/services.tsv")
  expected_running=\$(printf '%s' "\$expected_line" | cut -f1)
  expected_image=\$(printf '%s' "\$expected_line" | cut -f2)
  if [ "\$expected_running" != true ] && [ "\$expected_running" != false ]; then
    echo "Invalid rollback running state: \$service" >&2
    exit 1
  fi
  [ -n "\$expected_image" ] || { echo "Missing rollback image state: \$service" >&2; exit 1; }
  if [ "\$expected_image" != absent ]; then
    docker image inspect "\$expected_image" >/dev/null
  fi
  if [ "\$service" = reverse-proxy ] && [ "\$expected_running" = true ]; then proxy_was_running=true; fi
  if [ "\$service" = web ] && [ "\$expected_running" = true ]; then web_was_running=true; fi
done
if [ -n "\$PREVIOUS_WEB_IMAGE_ID" ] && [ "\$PREVIOUS_WEB_IMAGE_ID" != absent ]; then
  docker image inspect "\$PREVIOUS_WEB_IMAGE_ID" >/dev/null
fi
if [ -n "\$PREVIOUS_CADDY_IMAGE_ID" ] && [ "\$PREVIOUS_CADDY_IMAGE_ID" != absent ]; then
  docker image inspect "\$PREVIOUS_CADDY_IMAGE_ID" >/dev/null
fi
if [ "\$proxy_was_running" = true ]; then
  [ "\$web_was_running" = true ] || { echo "Refusing to restore a public proxy without the prior web service." >&2; exit 1; }
  [ -n "\$PREVIOUS_APP_VERSION" ] && [ "\$PREVIOUS_APP_VERSION" != unknown ] || { echo "Missing prior deployment identity for public rollback." >&2; exit 1; }
fi

# Stop public traffic and every application container from the sealed rollback
# Compose before touching the bind-mounted live source path.
docker compose --project-name '$COMPOSE_PROJECT_NAME' \
  -f "\$ROLLBACK_DIR/compose.resolved.yml" stop --timeout 120 reverse-proxy || true
docker compose --project-name '$COMPOSE_PROJECT_NAME' \
  -f "\$ROLLBACK_DIR/compose.resolved.yml" stop --timeout 120 $REMOTE_PAUSE_APPLICATION_SERVICES || true
docker ps \
  --filter 'label=com.docker.compose.project=$COMPOSE_PROJECT_NAME' \
  --filter status=running \
  --format '{{.ID}}\t{{.Label "com.docker.compose.service"}}' \
  | while IFS="\$(printf '\t')" read -r running_id running_service; do
      [ "\$running_service" = redis ] || docker stop --time 120 "\$running_id"
    done
for service in $REMOTE_PAUSE_SERVICES; do
  container_id=\$(docker compose --project-name '$COMPOSE_PROJECT_NAME' \
    -f "\$ROLLBACK_DIR/compose.resolved.yml" ps -q "\$service")
  if [ -n "\$container_id" ] && [ "\$(docker inspect --format '{{.State.Running}}' "\$container_id")" = true ]; then
    echo "Service is still running before rollback source restoration: \$service" >&2
    exit 1
  fi
done
umask 077
LIVE_ENV_TMP=\$(mktemp '$REMOTE_FRONT_DIR/.env.rollback.XXXXXX')
cp "\$ROLLBACK_DIR/runtime.env" "\$LIVE_ENV_TMP"
chmod 600 "\$LIVE_ENV_TMP"
test "\$(sha256sum "\$LIVE_ENV_TMP" | awk '{print \$1}')" = "\$EXPECTED_RUNTIME_ENV_SHA" || {
  echo "Rollback live environment staging failed its seal." >&2
  exit 1
}
node "\$ROLLBACK_DIR/atomic-install-sealed-file.mjs" \
  "\$LIVE_ENV_TMP" '$REMOTE_FRONT_DIR/.env' "\$EXPECTED_RUNTIME_ENV_SHA" 600
LIVE_ENV_TMP=
test "\$(sha256sum '$REMOTE_FRONT_DIR/.env' | awk '{print \$1}')" = "\$EXPECTED_RUNTIME_ENV_SHA" || {
  echo "Restored live web environment does not match the rollback seal." >&2
  exit 1
}
rsync -a --delete \
  --exclude '.deploy/' --exclude '.env' --exclude '.env.*' \
  --exclude '.next/' --exclude 'node_modules/' \
  --exclude 'krw-ontology' --exclude 'krw-ontology/' \
  "\$ROLLBACK_SOURCE_STAGE/" '$REMOTE_FRONT_DIR/'
if [ -L '$REMOTE_FRONT_DIR/krw-ontology' ]; then
  rm '$REMOTE_FRONT_DIR/krw-ontology'
elif [ -e '$REMOTE_FRONT_DIR/krw-ontology' ]; then
  mv '$REMOTE_FRONT_DIR/krw-ontology' '$REMOTE_FRONT_DIR/krw-ontology.failed-${NEXT_PUBLIC_APP_VERSION:-manual}'
fi
ln -s '$REMOTE_ONTOLOGY_DIR' '$REMOTE_FRONT_DIR/krw-ontology'

if [ -n "\$PREVIOUS_WEB_IMAGE_ID" ] && [ "\$PREVIOUS_WEB_IMAGE_ID" != absent ]; then
  docker image inspect "\$PREVIOUS_WEB_IMAGE_ID" >/dev/null
  docker image tag "\$PREVIOUS_WEB_IMAGE_ID" krw-ontology-front-web:local
fi
if [ -n "\$PREVIOUS_CADDY_IMAGE_ID" ] && [ "\$PREVIOUS_CADDY_IMAGE_ID" != absent ]; then
  docker image inspect "\$PREVIOUS_CADDY_IMAGE_ID" >/dev/null
  docker image tag "\$PREVIOUS_CADDY_IMAGE_ID" caddy:2
fi

existing_services=
running_apps=
proxy_was_running=false
web_was_running=false
for service in $REMOTE_PAUSE_SERVICES; do
  expected_line=\$(awk -F '\t' -v wanted="\$service" '\$1 == wanted { print \$2 "\t" \$3; found = 1 } END { if (!found) exit 1 }' "\$ROLLBACK_DIR/services.tsv")
  expected_running=\$(printf '%s' "\$expected_line" | cut -f1)
  expected_image=\$(printf '%s' "\$expected_line" | cut -f2)
  if [ "\$expected_image" = absent ]; then
    docker compose --project-name '$COMPOSE_PROJECT_NAME' -f "\$ROLLBACK_DIR/compose.resolved.yml" rm -sf "\$service" >/dev/null 2>&1 || true
    continue
  fi
  existing_services="\$existing_services \$service"
  if [ "\$expected_running" = true ]; then
    if [ "\$service" = reverse-proxy ]; then
      proxy_was_running=true
    else
      running_apps="\$running_apps \$service"
      [ "\$service" != web ] || web_was_running=true
    fi
  fi
done
if [ -n "\$existing_services" ]; then
  docker compose --project-name '$COMPOSE_PROJECT_NAME' -f "\$ROLLBACK_DIR/compose.resolved.yml" rm -sf \$existing_services >/dev/null 2>&1 || true
  docker compose --project-name '$COMPOSE_PROJECT_NAME' -f "\$ROLLBACK_DIR/compose.resolved.yml" create --no-build \$existing_services
fi
if [ -n "\$running_apps" ]; then
  docker compose --project-name '$COMPOSE_PROJECT_NAME' -f "\$ROLLBACK_DIR/compose.resolved.yml" start \$running_apps
fi

for service in \$running_apps; do
  ready=0
  for attempt in \$(seq 1 60); do
    container_id=\$(docker compose --project-name '$COMPOSE_PROJECT_NAME' -f "\$ROLLBACK_DIR/compose.resolved.yml" ps -q "\$service")
    if [ -n "\$container_id" ] && [ "\$(docker inspect --format '{{.State.Running}}' "\$container_id")" = true ]; then
      health=\$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "\$container_id")
      if [ "\$health" = healthy ] || [ "\$health" = none ]; then ready=1; break; fi
    fi
    sleep 2
  done
  [ "\$ready" = 1 ] || { echo "Rollback service did not become healthy: \$service" >&2; exit 1; }
done

# Prove every old application container has its exact recorded image/state
# before exposing the proxy. The proxy itself is intentionally still stopped.
for service in $REMOTE_PAUSE_APPLICATION_SERVICES; do
  expected_line=\$(awk -F '\t' -v wanted="\$service" '\$1 == wanted { print \$2 "\t" \$3; found = 1 } END { if (!found) exit 1 }' "\$ROLLBACK_DIR/services.tsv")
  expected_running=\$(printf '%s' "\$expected_line" | cut -f1)
  expected_image=\$(printf '%s' "\$expected_line" | cut -f2)
  container_id=\$(docker compose --project-name '$COMPOSE_PROJECT_NAME' -f "\$ROLLBACK_DIR/compose.resolved.yml" ps -q "\$service")
  actual_running=false
  actual_image=absent
  if [ -n "\$container_id" ]; then
    actual_running=\$(docker inspect --format '{{.State.Running}}' "\$container_id")
    actual_image=\$(docker inspect --format '{{.Image}}' "\$container_id")
  fi
  [ "\$actual_running" = "\$expected_running" ] && [ "\$actual_image" = "\$expected_image" ] || {
    echo "Exact private rollback state verification failed before proxy: \$service" >&2
    exit 1
  }
done

if [ "\$proxy_was_running" = true ]; then
  [ "\$web_was_running" = true ] || { echo "Refusing to restore a public proxy without the prior web service." >&2; exit 1; }
  [ "\$PREVIOUS_APP_VERSION" != unknown ] || { echo "Missing prior deployment identity for public rollback." >&2; exit 1; }
  test "\$(sha256sum '$REMOTE_FRONT_DIR/.env' | awk '{print \$1}')" = "\$EXPECTED_RUNTIME_ENV_SHA" || {
    echo "Live web environment changed before rollback proxy exposure." >&2
    exit 1
  }
  private_verified=0
  for attempt in \$(seq 1 60); do
    if docker compose --project-name '$COMPOSE_PROJECT_NAME' \
      -f "\$ROLLBACK_DIR/compose.resolved.yml" \
      exec -T -e EXPECTED_ROLLBACK_APP_VERSION="\$PREVIOUS_APP_VERSION" web node -e '
        async function main() {
          const expected = process.env.EXPECTED_ROLLBACK_APP_VERSION;
          if (!expected || process.env.NEXT_PUBLIC_APP_VERSION !== expected) {
            throw new Error("rollback web container deployment identity mismatch");
          }
          const shallow = await fetch("http://127.0.0.1:3000/api/healthz", {
            cache: "no-store",
            signal: AbortSignal.timeout(10000),
          });
          const payload = await shallow.json();
          if (!shallow.ok || payload.status !== "ok" || payload.deployment_id !== expected) {
            throw new Error("rollback shallow health deployment identity mismatch");
          }
          const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
          const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
          for (const [label, anon] of [
            ["SUPABASE_ANON_KEY", process.env.SUPABASE_ANON_KEY],
            ["NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY],
          ]) {
            if (!anon || anon === serviceRole || /^(sb_secret_|sb_service_)/.test(anon)) {
              throw new Error(label + " is not a public Supabase credential");
            }
            const probe = await fetch(url + "/auth/v1/settings", {
              headers: { apikey: anon },
              cache: "no-store",
              signal: AbortSignal.timeout(10000),
            });
            if (!probe.ok) throw new Error(label + " rollback probe failed: " + probe.status);
          }
        }
        main().catch((error) => { console.error(error.message || error); process.exit(1); });
      '; then private_verified=1; break; fi
    sleep 2
  done
  [ "\$private_verified" = 1 ] || {
    echo "Private version-bound rollback web/Supabase health did not pass; proxy remains stopped." >&2
    exit 1
  }
  docker compose --project-name '$COMPOSE_PROJECT_NAME' -f "\$ROLLBACK_DIR/compose.resolved.yml" start reverse-proxy
fi

for service in $REMOTE_PAUSE_SERVICES; do
  expected_line=\$(awk -F '\t' -v wanted="\$service" '\$1 == wanted { print \$2 "\t" \$3; found = 1 } END { if (!found) exit 1 }' "\$ROLLBACK_DIR/services.tsv")
  expected_running=\$(printf '%s' "\$expected_line" | cut -f1)
  expected_image=\$(printf '%s' "\$expected_line" | cut -f2)
  container_id=\$(docker compose --project-name '$COMPOSE_PROJECT_NAME' -f "\$ROLLBACK_DIR/compose.resolved.yml" ps -q "\$service")
  actual_running=false
  actual_image=absent
  if [ -n "\$container_id" ]; then
    actual_running=\$(docker inspect --format '{{.State.Running}}' "\$container_id")
    actual_image=\$(docker inspect --format '{{.Image}}' "\$container_id")
  fi
  if [ "\$actual_running" != "\$expected_running" ] || [ "\$actual_image" != "\$expected_image" ]; then
    echo "Exact remote rollback verification failed: \$service" >&2
    exit 1
  fi
done

if [ "\$proxy_was_running" = true ]; then
  for origin in '$CANONICAL_SITE_ORIGIN' '$CANONICAL_WWW_ORIGIN'; do
    verified=0
    for attempt in \$(seq 1 30); do
      health=\$(curl --connect-timeout 3 --max-time 10 -fsS "\$origin/api/healthz" 2>/dev/null || true)
      if printf '%s' "\$health" | node -e '
        const fs=require("fs");
        const expected=process.argv[1];
        try { const p=JSON.parse(fs.readFileSync(0,"utf8")); if (p.status==="ok" && p.deployment_id===expected) process.exit(0); } catch {}
        process.exit(1);
      ' "\$PREVIOUS_APP_VERSION"; then verified=1; break; fi
      sleep 2
    done
    [ "\$verified" = 1 ] || { echo "Previous public deployment identity did not recover at \$origin" >&2; exit 1; }
  done
fi
# A verified pre-migration rollback retires the candidate marker so the next
# preparation cannot be permanently blocked. The transition is idempotent for
# a lost SSH acknowledgement and is never used after the migration boundary.
CANDIDATE_RELEASE_DIR='$REMOTE_FRONT_DIR/.deploy/releases/$NEXT_PUBLIC_APP_VERSION'
CANDIDATE_GLOBAL_MARKER='$REMOTE_FRONT_DIR/.deploy/prepared-web-release.env'
CANDIDATE_LOCAL_MARKER="\$CANDIDATE_RELEASE_DIR/prepared-web-release.env"
CANDIDATE_ABANDONED_MARKER="\$CANDIDATE_RELEASE_DIR/abandoned-web-release.env"
CANDIDATE_ACTIVATED_MARKER="\$CANDIDATE_RELEASE_DIR/activated-web-release.env"
test -f "\$CANDIDATE_LOCAL_MARKER" && [ ! -L "\$CANDIDATE_LOCAL_MARKER" ]
[ ! -e "\$CANDIDATE_ACTIVATED_MARKER" ] || {
  echo "Refusing old-runtime recovery for an already activated candidate marker." >&2
  exit 1
}
CANDIDATE_MARKER_SHA=\$(sha256sum "\$CANDIDATE_LOCAL_MARKER" | awk '{print \$1}')
test "\$(sha256sum "\$CANDIDATE_RELEASE_DIR/release-manifest.env" | awk '{print \$1}')" = "\$(sed -n 's/^RELEASE_MANIFEST_SHA256=//p' "\$CANDIDATE_LOCAL_MARKER")"
node -e '
  const crypto = require("crypto");
  const fs = require("fs");
  const path = require("path");
  const [source, destination, expected] = process.argv.slice(1);
  const digest = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  const regular = (file) => { const stat = fs.lstatSync(file); return stat.isFile() && !stat.isSymbolicLink(); };
  const sourceExists = fs.existsSync(source);
  const destinationExists = fs.existsSync(destination);
  if (!sourceExists) {
    if (!destinationExists || !regular(destination) || digest(destination) !== expected) throw new Error("Abandoned candidate marker is not an exact idempotent retry");
    process.exit(0);
  }
  if (destinationExists || !regular(source) || digest(source) !== expected) throw new Error("Candidate marker abandonment state is ambiguous");
  fs.chmodSync(source, 0o400);
  const sourceFd = fs.openSync(source, "r"); try { fs.fsyncSync(sourceFd); } finally { fs.closeSync(sourceFd); }
  fs.renameSync(source, destination);
  for (const directory of new Set([path.dirname(source), path.dirname(destination)])) {
    const fd = fs.openSync(directory, "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  }
  if (digest(destination) !== expected) throw new Error("Abandoned candidate marker digest mismatch");
' "\$CANDIDATE_GLOBAL_MARKER" "\$CANDIDATE_ABANDONED_MARKER" "\$CANDIDATE_MARKER_SHA"
docker compose --project-name '$COMPOSE_PROJECT_NAME' -f "\$ROLLBACK_DIR/compose.resolved.yml" ps
EOF
)

if [ "$ACTION" = "resume-remote" ]; then
  # A crash can occur after the durable pre-migration phase is published but
  # midway through the initial Mac unload. GCP-only recovery must converge that
  # partial local state to fail-closed instead of requiring the operator to
  # guess which legacy supervisors are still alive. Phase, owner, recovery
  # seal, env, target, and the Mac snapshot seal were all verified above.
  emergency_fail_closed_local_stop || {
    echo "Could not establish a local Mac fail-closed state for GCP-only recovery." >&2
    exit 1
  }
  test -f "$CUTOVER_STATE_FILE" || {
    echo "Missing preserved Mac state for GCP-only recovery." >&2
    exit 1
  }
  TAB=$(printf '\t')
  while IFS="$TAB" read -r label previous_state plist snapshot_plist expected_sha; do
    [ -n "$label" ] || continue
    if launchctl print "$LAUNCHD_DOMAIN/$label" >/dev/null 2>&1; then
      echo "Refusing GCP-only recovery while a Mac launchd service is loaded: $label" >&2
      exit 1
    fi
  done <"$CUTOVER_STATE_FILE"
  for plist in "$HOME/Library/LaunchAgents"/com.krwontology.agent-worker*.plist; do
    [ -e "$plist" ] || continue
    label=$(/usr/libexec/PlistBuddy -c 'Print :Label' "$plist" 2>/dev/null) || continue
    if launchctl print "$LAUNCHD_DOMAIN/$label" >/dev/null 2>&1; then
      echo "Refusing GCP-only recovery while a Mac worker supervisor is loaded: $label" >&2
      exit 1
    fi
  done
  if ps eww -axo pid,command | awk '/[.]worker\/agent-worker[.]mjs/ && !/awk/ { found = 1 } END { exit found ? 0 : 1 }'; then
    echo "Refusing GCP-only recovery while a Mac agent worker process is running." >&2
    exit 1
  fi
  command -v lsof >/dev/null 2>&1 || {
    echo "Missing lsof for GCP-only Mac fail-closed verification." >&2
    exit 1
  }
  for port in "$KRW_ONTOLOGY_MCP_PORT" "$STOCK_NEWS_MCP_PORT" "$FILINGS_MCP_PORT"; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "Refusing GCP-only recovery while a local MCP listener is active on port $port." >&2
      exit 1
    fi
  done
  # This read-only receipt check must precede the durable restoring phase.
  # Otherwise a lost activation acknowledgement could strand recovery in a
  # rollback-only phase even though the candidate had already committed.
  assert_candidate_not_activated
  write_cutover_phase restoring_gcp_only
  gcloud compute ssh "$GCP_INSTANCE" \
    --project="$GCP_PROJECT" \
    --zone="$GCP_ZONE" \
    --command="$REMOTE_COMMAND"
  write_cutover_phase gcp_restored_mac_fail_closed
  echo "Exact sealed GCP runtime restored; Mac launchd services remain fail-closed."
  exit 0
fi

# Copy all local rollback inputs into one private transaction and use only
# those bytes from this point forward. This prevents a mutable source snapshot
# from being reread after public GCP traffic has been closed.
ORIGINAL_CUTOVER_STATE_FILE=$CUTOVER_STATE_FILE
ORIGINAL_MAC_RUNTIME_CURRENT_SNAPSHOT=$MAC_RUNTIME_CURRENT_SNAPSHOT
ORIGINAL_MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT=$MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT
LOCAL_ROLLBACK_TRANSACTION=$(mktemp -d "$FRONT_DIR/.deploy/local-rollback-$NEXT_PUBLIC_APP_VERSION.XXXXXX")
chmod 700 "$LOCAL_ROLLBACK_TRANSACTION"
ORIGINAL_CUTOVER_STATE_SHA=$(shasum -a 256 "$ORIGINAL_CUTOVER_STATE_FILE" | awk '{print $1}')
cp "$ORIGINAL_MAC_RUNTIME_CURRENT_SNAPSHOT" "$LOCAL_ROLLBACK_TRANSACTION/mac-runtime-current.target"
cp "$ORIGINAL_MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT" "$LOCAL_ROLLBACK_TRANSACTION/mac-runtime-root.path"
cmp -s "$ORIGINAL_MAC_RUNTIME_CURRENT_SNAPSHOT" "$LOCAL_ROLLBACK_TRANSACTION/mac-runtime-current.target"
cmp -s "$ORIGINAL_MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT" "$LOCAL_ROLLBACK_TRANSACTION/mac-runtime-root.path"
mkdir "$LOCAL_ROLLBACK_TRANSACTION/plists"
chmod 700 "$LOCAL_ROLLBACK_TRANSACTION/plists"
TAB=$(printf '\t')
: >"$LOCAL_ROLLBACK_TRANSACTION/runtime.tsv"
while IFS="$TAB" read -r label previous_state plist snapshot_plist expected_sha; do
  [ -n "$label" ] || continue
  case "$label" in *[!A-Za-z0-9._-]*) echo "Invalid launchd label in rollback state: $label" >&2; exit 1 ;; esac
  copied_snapshot=absent
  if [ "$expected_sha" != absent ]; then
    copied_snapshot="$LOCAL_ROLLBACK_TRANSACTION/plists/$label.plist"
    cp "$snapshot_plist" "$copied_snapshot"
    [ "$(shasum -a 256 "$copied_snapshot" | awk '{print $1}')" = "$expected_sha" ] || {
      echo "Preserved launchd plist changed while the local rollback transaction was copied: $label" >&2
      exit 1
    }
    chmod 400 "$copied_snapshot"
  fi
  printf '%s\t%s\t%s\t%s\t%s\n' \
    "$label" "$previous_state" "$plist" "$copied_snapshot" "$expected_sha" \
    >>"$LOCAL_ROLLBACK_TRANSACTION/runtime.tsv"
done <"$ORIGINAL_CUTOVER_STATE_FILE"
[ "$(shasum -a 256 "$ORIGINAL_CUTOVER_STATE_FILE" | awk '{print $1}')" = "$ORIGINAL_CUTOVER_STATE_SHA" ] || {
  echo "Preserved launchd state changed while the local rollback transaction was copied." >&2
  exit 1
}
chmod 400 "$LOCAL_ROLLBACK_TRANSACTION/runtime.tsv" \
  "$LOCAL_ROLLBACK_TRANSACTION/mac-runtime-current.target" \
  "$LOCAL_ROLLBACK_TRANSACTION/mac-runtime-root.path"
LOCAL_ROLLBACK_SEAL="$LOCAL_ROLLBACK_TRANSACTION/artifact-seal.json"
node "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs" prepare \
  --marker "$LOCAL_ROLLBACK_SEAL" \
  --symlink-boundary "$LOCAL_ROLLBACK_TRANSACTION" \
  --path "$LOCAL_ROLLBACK_TRANSACTION/runtime.tsv" \
  --path "$LOCAL_ROLLBACK_TRANSACTION/mac-runtime-current.target" \
  --path "$LOCAL_ROLLBACK_TRANSACTION/mac-runtime-root.path" \
  --path "$LOCAL_ROLLBACK_TRANSACTION/plists" >/dev/null
chmod 400 "$LOCAL_ROLLBACK_SEAL"
node "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs" verify \
  --marker "$LOCAL_ROLLBACK_SEAL" \
  --symlink-boundary "$LOCAL_ROLLBACK_TRANSACTION" \
  --path "$LOCAL_ROLLBACK_TRANSACTION/runtime.tsv" \
  --path "$LOCAL_ROLLBACK_TRANSACTION/mac-runtime-current.target" \
  --path "$LOCAL_ROLLBACK_TRANSACTION/mac-runtime-root.path" \
  --path "$LOCAL_ROLLBACK_TRANSACTION/plists" >/dev/null
CUTOVER_STATE_FILE="$LOCAL_ROLLBACK_TRANSACTION/runtime.tsv"
MAC_RUNTIME_CURRENT_SNAPSHOT="$LOCAL_ROLLBACK_TRANSACTION/mac-runtime-current.target"
MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT="$LOCAL_ROLLBACK_TRANSACTION/mac-runtime-root.path"

# Validate every local rollback input before taking GCP traffic down. These are
# read-only checks; a missing/corrupt Mac snapshot must leave the still-running
# production runtime untouched.
test -f "$CUTOVER_STATE_FILE" || {
  echo "Missing preserved pre-cutover launchd state: $CUTOVER_STATE_FILE" >&2
  exit 1
}
test -f "$MAC_RUNTIME_CURRENT_SNAPSHOT" || {
  echo "Missing preserved Mac runtime pointer state: $MAC_RUNTIME_CURRENT_SNAPSHOT" >&2
  exit 1
}
test -f "$MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT" || {
  echo "Missing preserved Mac rollback runtime root: $MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT" >&2
  exit 1
}
TAB=$(printf '\t')
while IFS="$TAB" read -r label previous_state plist snapshot_plist expected_sha; do
  [ -n "$label" ] || continue
  case "$previous_state" in loaded|stopped) ;; *) echo "Invalid preserved launchd state: $label" >&2; exit 1 ;; esac
  if [ "$expected_sha" != absent ]; then
    test -f "$snapshot_plist" || {
      echo "Preserved launchd plist disappeared before rollback: $snapshot_plist" >&2
      exit 1
    }
    test "$(shasum -a 256 "$snapshot_plist" | awk '{print $1}')" = "$expected_sha" || {
      echo "Preserved launchd plist changed before rollback: $snapshot_plist" >&2
      exit 1
    }
  fi
done <"$CUTOVER_STATE_FILE"
PRECHECK_MAC_RUNTIME_ROOT=$(sed -n '1p' "$MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT")
precheck_loaded_count=$(awk -F '\t' '$2 == "loaded" { count += 1 } END { print count + 0 }' "$CUTOVER_STATE_FILE")
IFS="$TAB" read -r PRECHECK_POINTER_STATE PRECHECK_POINTER_TARGET <"$MAC_RUNTIME_CURRENT_SNAPSHOT"
case "$PRECHECK_POINTER_STATE" in
  absent)
    [ "$PRECHECK_POINTER_TARGET" = - ] || {
      echo "Invalid absent Mac runtime pointer snapshot." >&2
      exit 1
    }
    ;;
  symlink)
    [ -n "$PRECHECK_POINTER_TARGET" ] && [ "$PRECHECK_POINTER_TARGET" != - ] || {
      echo "Invalid preserved Mac runtime pointer target." >&2
      exit 1
    }
    case "$PRECHECK_POINTER_TARGET" in
      /*) precheck_pointer_candidate=$PRECHECK_POINTER_TARGET ;;
      *) precheck_pointer_candidate="$MAC_RUNTIME_BASE/$PRECHECK_POINTER_TARGET" ;;
    esac
    test -d "$precheck_pointer_candidate" || {
      echo "Preserved Mac runtime pointer target is missing before rollback." >&2
      exit 1
    }
    precheck_pointer_root=$(CDPATH= cd -- "$precheck_pointer_candidate" && pwd -P)
    mkdir -p "$MAC_RUNTIME_BASE"
    precheck_runtime_base=$(CDPATH= cd -- "$MAC_RUNTIME_BASE" && pwd -P)
    case "$precheck_pointer_root/" in
      "$precheck_runtime_base"/*/) ;;
      *) echo "Preserved Mac runtime pointer escapes the immutable runtime base." >&2; exit 1 ;;
    esac
    ;;
  *)
    echo "Invalid preserved Mac runtime pointer state: $PRECHECK_POINTER_STATE" >&2
    exit 1
    ;;
esac
if [ "$precheck_loaded_count" -gt 0 ]; then
  case "$PRECHECK_MAC_RUNTIME_ROOT" in absent|unsealed-fail-closed)
    echo "Loaded pre-cutover services have no sealed rollback runtime." >&2
    exit 1
    ;;
  esac
  test -x "$PRECHECK_MAC_RUNTIME_ROOT/scripts/verify-mac-runtime-target.sh"
  "$PRECHECK_MAC_RUNTIME_ROOT/scripts/verify-mac-runtime-target.sh" \
    "$PRECHECK_MAC_RUNTIME_ROOT/runtime.env"
  [ "$PRECHECK_POINTER_STATE" = symlink ] || {
    echo "Loaded pre-cutover services have no preserved immutable pointer." >&2
    exit 1
  }
  [ "$precheck_pointer_root" = "$PRECHECK_MAC_RUNTIME_ROOT" ] || {
    echo "Preserved Mac runtime pointer and rollback root disagree." >&2
    exit 1
  }
fi

# Close public traffic before spending any time restoring or health-checking
# the Mac runtime. This stop path depends only on the sealed rollback registry,
# never on a potentially partial live source promotion.
REMOTE_STOP_COMMAND=$(cat <<EOF
set -eu
ROLLBACK_DIR='$REMOTE_ROLLBACK_DIR'
RELEASE_MANIFEST='$REMOTE_FRONT_DIR/.deploy/releases/$NEXT_PUBLIC_APP_VERSION/release-manifest.env'
PHASE_CANDIDATE_RUNTIME_ENV_SHA='$EXPECTED_ENV_SHA256'
CANDIDATE_RELEASE_DIR='$REMOTE_FRONT_DIR/.deploy/releases/$NEXT_PUBLIC_APP_VERSION'
CANDIDATE_LOCAL_MARKER="\$CANDIDATE_RELEASE_DIR/prepared-web-release.env"
CANDIDATE_ACTIVATED_MARKER="\$CANDIDATE_RELEASE_DIR/activated-web-release.env"
CANDIDATE_HEALTH_RECEIPT="\$CANDIDATE_RELEASE_DIR/activation-health-receipt.env"
if [ -e "\$CANDIDATE_ACTIVATED_MARKER" ]; then
  test -f "\$CANDIDATE_ACTIVATED_MARKER" && [ ! -L "\$CANDIDATE_ACTIVATED_MARKER" ]
  test -f "\$CANDIDATE_LOCAL_MARKER" && [ ! -L "\$CANDIDATE_LOCAL_MARKER" ]
  test -f "\$CANDIDATE_HEALTH_RECEIPT" && [ ! -L "\$CANDIDATE_HEALTH_RECEIPT" ]
  cmp -s "\$CANDIDATE_LOCAL_MARKER" "\$CANDIDATE_ACTIVATED_MARKER"
  test "\$(sed -n 's/^FORMAT=//p' "\$CANDIDATE_HEALTH_RECEIPT")" = 'krw-production-activation-health/v1'
  test "\$(sed -n 's/^APP_VERSION=//p' "\$CANDIDATE_HEALTH_RECEIPT")" = '$NEXT_PUBLIC_APP_VERSION'
  test "\$(sed -n 's/^PREPARED_MARKER_SHA256=//p' "\$CANDIDATE_HEALTH_RECEIPT")" = "\$(sha256sum "\$CANDIDATE_LOCAL_MARKER" | awk '{print \$1}')"
  test "\$(sed -n 's/^RELEASE_MANIFEST_SHA256=//p' "\$CANDIDATE_HEALTH_RECEIPT")" = "\$(sha256sum "\$RELEASE_MANIFEST" | awk '{print \$1}')"
  echo "Refusing to stop a candidate whose activation and health receipts are already committed." >&2
  exit 1
fi
test -f "\$RELEASE_MANIFEST"
test -f "\$ROLLBACK_DIR/manifest.env"
test "\$(sed -n 's/^FORMAT=//p' "\$RELEASE_MANIFEST")" = 'krw-production-release-registry/v1'
test "\$(sed -n 's/^APP_VERSION=//p' "\$RELEASE_MANIFEST")" = '$NEXT_PUBLIC_APP_VERSION'
test "\$(sed -n 's/^RUNTIME_ENV_SHA256=//p' "\$RELEASE_MANIFEST")" = "\$PHASE_CANDIDATE_RUNTIME_ENV_SHA"
EXPECTED_ROLLBACK_MANIFEST_SHA=\$(sed -n 's/^ROLLBACK_MANIFEST_SHA256=//p' "\$RELEASE_MANIFEST")
test "\$(sha256sum "\$ROLLBACK_DIR/manifest.env" | awk '{print \$1}')" = "\$EXPECTED_ROLLBACK_MANIFEST_SHA" || {
  echo "Release registry and rollback manifest cross-seal disagree." >&2
  exit 1
}
test -f "\$ROLLBACK_DIR/manifest.env"
test -f "\$ROLLBACK_DIR/compose.resolved.yml"
test -f "\$ROLLBACK_DIR/services.tsv"
test -f "\$ROLLBACK_DIR/front-source.tar.gz" && [ ! -L "\$ROLLBACK_DIR/front-source.tar.gz" ]
test -f "\$ROLLBACK_DIR/runtime.env"
test -f "\$ROLLBACK_DIR/verify-supabase-production-target.mjs" \
  && [ ! -L "\$ROLLBACK_DIR/verify-supabase-production-target.mjs" ]
test -f "\$ROLLBACK_DIR/atomic-install-sealed-file.mjs"
test -f "\$ROLLBACK_DIR/production-target.json"
test "\$(sed -n 's/^FORMAT=//p' "\$ROLLBACK_DIR/manifest.env")" = 'krw-code-rollback/v2'
test "\$(sed -n 's/^CUTOVER_APP_VERSION=//p' "\$ROLLBACK_DIR/manifest.env")" = '${NEXT_PUBLIC_APP_VERSION:-manual}'
test "\$(grep -c '^PREVIOUS_FRONT_SOURCE_SHA256=' "\$ROLLBACK_DIR/manifest.env")" = 1 || {
  echo "Rollback manifest must define PREVIOUS_FRONT_SOURCE_SHA256 exactly once." >&2
  exit 1
}
EXPECTED_PREVIOUS_FRONT_SOURCE_SHA=\$(sed -n 's/^PREVIOUS_FRONT_SOURCE_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
printf '%s' "\$EXPECTED_PREVIOUS_FRONT_SOURCE_SHA" | grep -Eq '^[a-f0-9]{64}\$' || {
  echo "Rollback manifest has an invalid previous frontend source identity." >&2
  exit 1
}
EXPECTED_COMPOSE_SHA=\$(sed -n 's/^RESOLVED_COMPOSE_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
EXPECTED_STATE_SHA=\$(sed -n 's/^SERVICE_STATE_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
EXPECTED_FRONT_ARCHIVE_SHA=\$(sed -n 's/^FRONT_ARCHIVE_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
EXPECTED_RUNTIME_ENV_SHA=\$(sed -n 's/^RUNTIME_ENV_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
EXPECTED_TARGET_VERIFIER_SHA=\$(sed -n 's/^TARGET_VERIFIER_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
EXPECTED_ATOMIC_INSTALLER_SHA=\$(sed -n 's/^ATOMIC_INSTALLER_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
EXPECTED_PRODUCTION_TARGET_SHA=\$(sed -n 's/^PRODUCTION_TARGET_SHA256=//p' "\$ROLLBACK_DIR/manifest.env")
PREVIOUS_APP_VERSION=\$(sed -n 's/^PREVIOUS_APP_VERSION=//p' "\$ROLLBACK_DIR/manifest.env")
PREVIOUS_WEB_IMAGE_ID=\$(sed -n 's/^PREVIOUS_WEB_IMAGE_ID=//p' "\$ROLLBACK_DIR/manifest.env")
PREVIOUS_CADDY_IMAGE_ID=\$(sed -n 's/^PREVIOUS_CADDY_IMAGE_ID=//p' "\$ROLLBACK_DIR/manifest.env")
test "\$(sha256sum "\$ROLLBACK_DIR/compose.resolved.yml" | awk '{print \$1}')" = "\$EXPECTED_COMPOSE_SHA"
test "\$(sha256sum "\$ROLLBACK_DIR/services.tsv" | awk '{print \$1}')" = "\$EXPECTED_STATE_SHA"
test "\$(sha256sum "\$ROLLBACK_DIR/front-source.tar.gz" | awk '{print \$1}')" = "\$EXPECTED_FRONT_ARCHIVE_SHA"
test "\$(sha256sum "\$ROLLBACK_DIR/runtime.env" | awk '{print \$1}')" = "\$EXPECTED_RUNTIME_ENV_SHA"
test "\$(sha256sum "\$ROLLBACK_DIR/verify-supabase-production-target.mjs" | awk '{print \$1}')" = "\$EXPECTED_TARGET_VERIFIER_SHA"
test "\$(sha256sum "\$ROLLBACK_DIR/atomic-install-sealed-file.mjs" | awk '{print \$1}')" = "\$EXPECTED_ATOMIC_INSTALLER_SHA"
test "\$(sha256sum "\$ROLLBACK_DIR/production-target.json" | awk '{print \$1}')" = "\$EXPECTED_PRODUCTION_TARGET_SHA"
ROLLBACK_SOURCE_STAGE=\$(mktemp -d /tmp/krw-front-rollback-preflight.XXXXXX)
cleanup_rollback_preflight() { rm -rf "\$ROLLBACK_SOURCE_STAGE"; }
trap cleanup_rollback_preflight EXIT INT TERM
test -z "\$(find "\$ROLLBACK_SOURCE_STAGE" -mindepth 1 -print -quit)"
tar --extract --gzip --file "\$ROLLBACK_DIR/front-source.tar.gz" \
  --directory "\$ROLLBACK_SOURCE_STAGE" \
  --no-same-owner --no-same-permissions --delay-directory-restore \
  --warning=no-unknown-keyword
node -e '
  const fs = require("fs");
  const file = process.argv[1];
  const expected = process.argv[2];
  const stats = fs.lstatSync(file);
  if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("Archived rollback production target must be a regular non-symlink file");
  const target = JSON.parse(fs.readFileSync(file, "utf8"));
  if (target?.format !== "krw-production-target/v1" || target?.supabaseProjectRef !== expected) {
    throw new Error("Archived rollback production target does not match the canonical Supabase project");
  }
' "\$ROLLBACK_SOURCE_STAGE/ops/production-target.json" '$CANONICAL_SUPABASE_PROJECT_REF'
node "\$ROLLBACK_DIR/verify-supabase-production-target.mjs" \
  "\$ROLLBACK_DIR/runtime.env" - \
  "\$ROLLBACK_DIR/production-target.json" \
  --require-origins \
  --rollback-proof "\$ROLLBACK_DIR/manifest.env" "\$RELEASE_MANIFEST" \
  --rollback-source-root "\$ROLLBACK_SOURCE_STAGE"
test "\$(node -e 'const target=require(process.argv[1]);process.stdout.write(target.supabaseProjectRef)' "\$ROLLBACK_DIR/production-target.json")" = '$CANONICAL_SUPABASE_PROJECT_REF'
proxy_was_running=false
web_was_running=false
for service in $REMOTE_PAUSE_SERVICES; do
  service_count=\$(awk -F '\t' -v wanted="\$service" '\$1 == wanted { count += 1 } END { print count + 0 }' "\$ROLLBACK_DIR/services.tsv")
  [ "\$service_count" = 1 ] || { echo "Rollback service state must contain exactly one row: \$service" >&2; exit 1; }
  expected_line=\$(awk -F '\t' -v wanted="\$service" '\$1 == wanted { print \$2 "\t" \$3 }' "\$ROLLBACK_DIR/services.tsv")
  expected_running=\$(printf '%s' "\$expected_line" | cut -f1)
  expected_image=\$(printf '%s' "\$expected_line" | cut -f2)
  if [ "\$expected_running" != true ] && [ "\$expected_running" != false ]; then
    echo "Invalid rollback running state: \$service" >&2
    exit 1
  fi
  [ -n "\$expected_image" ] || { echo "Missing rollback image state: \$service" >&2; exit 1; }
  if [ "\$expected_image" != absent ]; then docker image inspect "\$expected_image" >/dev/null; fi
  if [ "\$service" = reverse-proxy ] && [ "\$expected_running" = true ]; then proxy_was_running=true; fi
  if [ "\$service" = web ] && [ "\$expected_running" = true ]; then web_was_running=true; fi
done
if [ -n "\$PREVIOUS_WEB_IMAGE_ID" ] && [ "\$PREVIOUS_WEB_IMAGE_ID" != absent ]; then docker image inspect "\$PREVIOUS_WEB_IMAGE_ID" >/dev/null; fi
if [ -n "\$PREVIOUS_CADDY_IMAGE_ID" ] && [ "\$PREVIOUS_CADDY_IMAGE_ID" != absent ]; then docker image inspect "\$PREVIOUS_CADDY_IMAGE_ID" >/dev/null; fi
if [ "\$proxy_was_running" = true ]; then
  [ "\$web_was_running" = true ] || { echo "Refusing to restore a public proxy without the prior web service." >&2; exit 1; }
  [ -n "\$PREVIOUS_APP_VERSION" ] && [ "\$PREVIOUS_APP_VERSION" != unknown ] || { echo "Missing prior deployment identity for public rollback." >&2; exit 1; }
fi
trap - EXIT INT TERM
rm -rf "\$ROLLBACK_SOURCE_STAGE"
docker compose --project-name '$COMPOSE_PROJECT_NAME' \
  -f "\$ROLLBACK_DIR/compose.resolved.yml" stop --timeout 120 reverse-proxy || true
docker compose --project-name '$COMPOSE_PROJECT_NAME' \
  -f "\$ROLLBACK_DIR/compose.resolved.yml" stop --timeout 120 $REMOTE_PAUSE_APPLICATION_SERVICES || true
docker ps \
  --filter 'label=com.docker.compose.project=$COMPOSE_PROJECT_NAME' \
  --filter status=running \
  --format '{{.ID}}\t{{.Label "com.docker.compose.service"}}' \
  | while IFS="\$(printf '\t')" read -r running_id running_service; do
      [ "\$running_service" = redis ] || docker stop --time 120 "\$running_id"
    done
for service in $REMOTE_PAUSE_SERVICES; do
  container_id=\$(docker compose --project-name '$COMPOSE_PROJECT_NAME' \
    -f "\$ROLLBACK_DIR/compose.resolved.yml" ps -q "\$service")
  if [ -n "\$container_id" ] && [ "\$(docker inspect --format '{{.State.Running}}' "\$container_id")" = true ]; then
    echo "Service is still running at rollback entry: \$service" >&2
    exit 1
  fi
done
EOF
)
assert_candidate_not_activated
write_cutover_phase restoring_old
gcloud compute ssh "$GCP_INSTANCE" \
  --project="$GCP_PROJECT" \
  --zone="$GCP_ZONE" \
  --command="$REMOTE_STOP_COMMAND"

node "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs" verify \
  --marker "$LOCAL_ROLLBACK_SEAL" \
  --symlink-boundary "$LOCAL_ROLLBACK_TRANSACTION" \
  --path "$LOCAL_ROLLBACK_TRANSACTION/runtime.tsv" \
  --path "$LOCAL_ROLLBACK_TRANSACTION/mac-runtime-current.target" \
  --path "$LOCAL_ROLLBACK_TRANSACTION/mac-runtime-root.path" \
  --path "$LOCAL_ROLLBACK_TRANSACTION/plists" >/dev/null
test -f "$CUTOVER_STATE_FILE" || {
  echo "Missing preserved pre-cutover launchd state: $CUTOVER_STATE_FILE" >&2
  exit 1
}
test -f "$MAC_RUNTIME_CURRENT_SNAPSHOT" || {
  echo "Missing preserved Mac runtime pointer state: $MAC_RUNTIME_CURRENT_SNAPSHOT" >&2
  exit 1
}
test -f "$MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT" || {
  echo "Missing preserved Mac rollback runtime root: $MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT" >&2
  exit 1
}
TAB=$(printf '\t')
PRIOR_MAC_RUNTIME_ROOT=$(sed -n '1p' "$MAC_RUNTIME_ROLLBACK_ROOT_SNAPSHOT")
loaded_service_count=$(awk -F '\t' '$2 == "loaded" { count += 1 } END { print count + 0 }' "$CUTOVER_STATE_FILE")
if [ "$loaded_service_count" -gt 0 ]; then
  [ "$PRIOR_MAC_RUNTIME_ROOT" != absent ] || {
    echo "Loaded pre-cutover services have no sealed rollback runtime." >&2
    exit 1
  }
  test -x "$PRIOR_MAC_RUNTIME_ROOT/scripts/verify-mac-runtime-target.sh"
  test -f "$PRIOR_MAC_RUNTIME_ROOT/runtime.env"
  "$PRIOR_MAC_RUNTIME_ROOT/scripts/verify-mac-runtime-target.sh" \
    "$PRIOR_MAC_RUNTIME_ROOT/runtime.env"
fi
while IFS="$TAB" read -r label previous_state plist snapshot_plist expected_sha; do
  [ -n "$label" ] || continue
  launchctl bootout "$LAUNCHD_DOMAIN/$label" >/dev/null 2>&1 || true
done <"$CUTOVER_STATE_FILE"
current_pointer_state=$PRECHECK_POINTER_STATE
current_pointer_target=$PRECHECK_POINTER_TARGET
case "$current_pointer_state" in
  absent)
    node - "$MAC_RUNTIME_CURRENT_LINK" "$MAC_RUNTIME_BASE" <<'NODE'
const fs = require("fs");
const [destination, runtimeBase] = process.argv.slice(2);
fs.rmSync(destination, { force: true });
const directory = fs.openSync(runtimeBase, "r");
try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
if (fs.existsSync(destination)) throw new Error("Mac current pointer still exists after rollback");
NODE
    ;;
  symlink)
    [ -n "$current_pointer_target" ] || {
      echo "Invalid preserved Mac runtime pointer target." >&2
      exit 1
    }
    mkdir -p "$MAC_RUNTIME_BASE"
    current_pointer_tmp="$MAC_RUNTIME_BASE/.current.rollback.$$"
    rm -f "$current_pointer_tmp"
    ln -s "$current_pointer_target" "$current_pointer_tmp"
    node - "$current_pointer_tmp" "$MAC_RUNTIME_CURRENT_LINK" \
      "$MAC_RUNTIME_BASE" "$current_pointer_target" "$precheck_pointer_root" <<'NODE'
const fs = require("fs");
const path = require("path");
const [temporary, destination, runtimeBase, expectedTarget, expectedRoot] =
  process.argv.slice(2);
fs.renameSync(temporary, destination);
const directory = fs.openSync(runtimeBase, "r");
try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
const stats = fs.lstatSync(destination);
if (!stats.isSymbolicLink()) throw new Error("Restored Mac current pointer is not a symlink");
if (fs.readlinkSync(destination) !== expectedTarget) {
  throw new Error("Restored Mac current pointer target differs from the snapshot");
}
if (fs.realpathSync(destination) !== fs.realpathSync(expectedRoot)) {
  throw new Error("Restored Mac current pointer resolves to the wrong runtime");
}
if (path.dirname(destination) !== runtimeBase) {
  throw new Error("Restored Mac current pointer escaped its runtime base");
}
NODE
    ;;
  *)
    echo "Invalid preserved Mac runtime pointer state: $current_pointer_state" >&2
    exit 1
    ;;
esac
ROLLBACK_MAC_STARTED_AT=$(node -e 'process.stdout.write(new Date().toISOString())')
while IFS="$TAB" read -r label previous_state plist snapshot_plist expected_sha; do
  [ -n "$label" ] || continue
  if [ "$expected_sha" != "absent" ]; then
    test -f "$snapshot_plist" || {
      echo "Preserved launchd plist disappeared before recovery: $snapshot_plist" >&2
      exit 1
    }
    actual_sha=$(shasum -a 256 "$snapshot_plist" | awk '{print $1}')
    if [ "$actual_sha" != "$expected_sha" ]; then
      echo "Preserved launchd plist changed during cutover: $snapshot_plist" >&2
      exit 1
    fi
    cp -p "$snapshot_plist" "$plist"
    chmod 600 "$plist"
  else
    rm -f "$plist"
  fi
  if [ "$previous_state" = "loaded" ]; then
    launchctl bootstrap "$LAUNCHD_DOMAIN" "$plist"
    launchctl enable "$LAUNCHD_DOMAIN/$label"
    launchctl kickstart -k "$LAUNCHD_DOMAIN/$label"
  fi
done <"$CUTOVER_STATE_FILE"

while IFS="$TAB" read -r label previous_state plist snapshot_plist expected_sha; do
  [ "$previous_state" = "loaded" ] || continue
  for attempt in $(seq 1 20); do
    if launchctl print "$LAUNCHD_DOMAIN/$label" >/dev/null 2>&1; then
      break
    fi
    if [ "$attempt" -eq 20 ]; then
      echo "Preserved launchd service did not recover: $label" >&2
      exit 1
    fi
    sleep 0.5
  done
done <"$CUTOVER_STATE_FILE"

state_was_loaded() {
  awk -F '\t' -v wanted="$1" \
    '$1 == wanted && $2 == "loaded" { found = 1 } END { exit found ? 0 : 1 }' \
    "$CUTOVER_STATE_FILE"
}
if [ "$loaded_service_count" -gt 0 ]; then
  PRIOR_RUNTIME_ENV="$PRIOR_MAC_RUNTIME_ROOT/runtime.env"
  if state_was_loaded com.krwontology.mcp-server; then
    "$PRIOR_MAC_RUNTIME_ROOT/scripts/verify-mcp-server-production.sh" \
      --env-file "$PRIOR_RUNTIME_ENV"
  fi
  if state_was_loaded com.krwontology.stock-news-mcp; then
    "$PRIOR_MAC_RUNTIME_ROOT/scripts/verify-stock-news-mcp-production.sh" \
      --env-file "$PRIOR_RUNTIME_ENV"
  fi
  if state_was_loaded com.krwontology.filings-mcp; then
    "$PRIOR_MAC_RUNTIME_ROOT/scripts/verify-filings-mcp-production.sh" \
      --env-file "$PRIOR_RUNTIME_ENV"
  fi
  if state_was_loaded com.krwontology.agent-worker; then
    PRIOR_RELEASE_ROOT=$(node -e '
      const fs = require("fs");
      const key = "KRW_ONTOLOGY_RELEASE_ROOT";
      let value = "";
      for (const raw of fs.readFileSync(process.argv[1], "utf8").split(/\r?\n/)) {
        const line = raw.trim();
        const separator = line.indexOf("=");
        if (!line || line.startsWith("#") || separator <= 0 || line.slice(0, separator).trim() !== key) continue;
        value = line.slice(separator + 1).trim();
        if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("\x27") && value.endsWith("\x27"))) value = value.slice(1, -1);
      }
      if (!value) process.exit(1);
      process.stdout.write(value);
    ' "$PRIOR_RUNTIME_ENV")
    PRIOR_RELEASE_ID=$(basename "$PRIOR_RELEASE_ROOT")
    PRIOR_DEPLOYMENT_ID=$(sed -n '1p' "$PRIOR_MAC_RUNTIME_ROOT/deployment-id")
    PRIOR_WORKER_BUNDLE_SHA256=$(node \
      "$PRIOR_MAC_RUNTIME_ROOT/scripts/compute-production-source-sha256.mjs" \
      "$PRIOR_MAC_RUNTIME_ROOT/.worker")
    PRIOR_RUNTIME_IDENTITY_SHA256=$(shasum -a 256 \
      "$PRIOR_MAC_RUNTIME_ROOT/runtime-identity.json" | awk '{print $1}')
    node "$PRIOR_MAC_RUNTIME_ROOT/scripts/verify-mac-worker-heartbeats.mjs" \
      --env-file "$PRIOR_RUNTIME_ENV" \
      --release-id "$PRIOR_RELEASE_ID" \
      --seen-after "$ROLLBACK_MAC_STARTED_AT" \
      --deployment-id "$PRIOR_DEPLOYMENT_ID" \
      --worker-bundle-sha256 "$PRIOR_WORKER_BUNDLE_SHA256" \
      --runtime-identity-sha256 "$PRIOR_RUNTIME_IDENTITY_SHA256" \
      --timeout-ms 120000
  fi
fi
gcloud compute ssh "$GCP_INSTANCE" \
  --project="$GCP_PROJECT" \
  --zone="$GCP_ZONE" \
  --command="$REMOTE_COMMAND"
write_cutover_phase rolled_back
echo "Exact pre-cutover production runtimes restored; rollback artifacts were retained."
