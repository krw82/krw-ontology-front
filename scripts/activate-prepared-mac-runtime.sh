#!/bin/sh
set -eu

usage() {
  echo "Usage: activate-prepared-mac-runtime.sh --front-root ABSOLUTE_PATH --runtime-root ABSOLUTE_PATH --deployment-id ID --expected-seal-sha256 HEX" >&2
}

FRONT_ROOT=
RUNTIME_ROOT=
DEPLOYMENT_ID=
EXPECTED_SEAL_SHA256=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --front-root) FRONT_ROOT=${2:?Missing --front-root value}; shift ;;
    --runtime-root) RUNTIME_ROOT=${2:?Missing --runtime-root value}; shift ;;
    --deployment-id) DEPLOYMENT_ID=${2:?Missing --deployment-id value}; shift ;;
    --expected-seal-sha256) EXPECTED_SEAL_SHA256=${2:?Missing --expected-seal-sha256 value}; shift ;;
    --help|-h) usage; exit 0 ;;
    *) usage; exit 1 ;;
  esac
  shift
done

case "$FRONT_ROOT" in /*) ;; *) usage; exit 1 ;; esac
case "$RUNTIME_ROOT" in /*) ;; *) usage; exit 1 ;; esac
case "$DEPLOYMENT_ID" in ''|*[!A-Za-z0-9._-]*) usage; exit 1 ;; esac
printf '%s' "$EXPECTED_SEAL_SHA256" | grep -Eq '^[a-f0-9]{64}$' || {
  echo "Expected Mac runtime seal digest must be a lowercase SHA-256 value." >&2
  exit 1
}
FRONT_ROOT=$(CDPATH= cd -- "$FRONT_ROOT" && pwd -P)
RUNTIME_ROOT=$(CDPATH= cd -- "$RUNTIME_ROOT" && pwd -P)
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
[ "$SCRIPT_DIR" = "$RUNTIME_ROOT/scripts" ] || {
  echo "Mac activation must execute from the immutable runtime scripts directory." >&2
  exit 1
}

for command_name in node shasum; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "Missing command for Mac activation: $command_name" >&2
    exit 1
  }
done
[ "${PRODUCTION_OS_LOCK_HELD:-0}" = 1 ] || {
  echo "Missing kernel-held production deploy lock." >&2
  exit 1
}
case "${PRODUCTION_DEPLOY_LOCK_OWNER:-}" in
  ''|*[!A-Za-z0-9._:-]*) echo "Invalid production deploy lock owner." >&2; exit 1 ;;
esac
LOCK_OWNER_FILE="$FRONT_ROOT/.deploy/production-deploy.lock/owner"
test -f "$LOCK_OWNER_FILE" && [ ! -L "$LOCK_OWNER_FILE" ] || {
  echo "Production deploy lock owner file is missing or unsafe." >&2
  exit 1
}
[ "$(sed -n '1p' "$LOCK_OWNER_FILE")" = "$PRODUCTION_DEPLOY_LOCK_OWNER" ] || {
  echo "Production deploy lock ownership mismatch." >&2
  exit 1
}
[ "${PRODUCTION_ORCHESTRATOR_ATTESTATION:-}" = "$DEPLOYMENT_ID:$PRODUCTION_DEPLOY_LOCK_OWNER" ] || {
  echo "Missing or invalid production orchestrator attestation." >&2
  exit 1
}

RUNTIME_ENV="$RUNTIME_ROOT/runtime.env"
RUNTIME_SEAL="$RUNTIME_ROOT/.artifact-seal.json"
RUNTIME_IDENTITY="$RUNTIME_ROOT/runtime-identity.json"
RUNTIME_WORKER="$RUNTIME_ROOT/.worker"
for required in \
  "$RUNTIME_ENV" "$RUNTIME_SEAL" "$RUNTIME_IDENTITY" \
  "$RUNTIME_ROOT/deployment-id" \
  "$RUNTIME_ROOT/scripts/verify-prepared-runtime-artifacts.mjs" \
  "$RUNTIME_ROOT/scripts/verify-mac-runtime-target.sh"
do
  test -f "$required" && [ ! -L "$required" ] || {
    echo "Missing regular sealed Mac runtime artifact: $required" >&2
    exit 1
  }
done
[ "$(sed -n '1p' "$RUNTIME_ROOT/deployment-id")" = "$DEPLOYMENT_ID" ] || {
  echo "Prepared Mac runtime belongs to another deployment." >&2
  exit 1
}
[ "$(shasum -a 256 "$RUNTIME_SEAL" | awk '{print $1}')" = "$EXPECTED_SEAL_SHA256" ] || {
  echo "Prepared Mac runtime seal differs from the phase-bound identity." >&2
  exit 1
}
node "$RUNTIME_ROOT/scripts/verify-prepared-runtime-artifacts.mjs" verify \
  --marker "$RUNTIME_SEAL" >/dev/null

WORKER_SHA=$(node "$RUNTIME_ROOT/scripts/compute-production-source-sha256.mjs" "$RUNTIME_WORKER")
IDENTITY_SHA=$(shasum -a 256 "$RUNTIME_IDENTITY" | awk '{print $1}')
CONTROL_PATH=$PATH
CONTROL_HOME=$HOME
CONTROL_LOCK_OWNER=$PRODUCTION_DEPLOY_LOCK_OWNER
CONTROL_OS_LOCK=$PRODUCTION_OS_LOCK_HELD
CONTROL_ATTESTATION=$PRODUCTION_ORCHESTRATOR_ATTESTATION
set -a
# shellcheck disable=SC1090
. "$RUNTIME_ENV"
set +a
PATH=$CONTROL_PATH
HOME=$CONTROL_HOME
PRODUCTION_DEPLOY_LOCK_OWNER=$CONTROL_LOCK_OWNER
PRODUCTION_OS_LOCK_HELD=$CONTROL_OS_LOCK
PRODUCTION_ORCHESTRATOR_ATTESTATION=$CONTROL_ATTESTATION
export PATH HOME PRODUCTION_DEPLOY_LOCK_OWNER PRODUCTION_OS_LOCK_HELD
export PRODUCTION_ORCHESTRATOR_ATTESTATION

[ "${KRW_MAC_IMMUTABLE_RUNTIME:-0}" = 1 ] || {
  echo "Prepared runtime env is not immutable." >&2
  exit 1
}
[ "${KRW_MAC_RUNTIME_ROOT:-}" = "$RUNTIME_ROOT" ] || {
  echo "Prepared runtime root identity mismatch." >&2
  exit 1
}
[ "${KRW_DEPLOYMENT_ID:-}" = "$DEPLOYMENT_ID" ] \
  && [ "${NEXT_PUBLIC_APP_VERSION:-}" = "$DEPLOYMENT_ID" ] || {
  echo "Prepared runtime deployment identity mismatch." >&2
  exit 1
}
[ "${KRW_WORKER_BUNDLE_SHA256:-}" = "$WORKER_SHA" ] || {
  echo "Prepared runtime worker identity mismatch." >&2
  exit 1
}
[ "${KRW_RUNTIME_IDENTITY_SHA256:-}" = "$IDENTITY_SHA" ] || {
  echo "Prepared runtime identity digest mismatch." >&2
  exit 1
}
node - "$RUNTIME_IDENTITY" "$DEPLOYMENT_ID" "$WORKER_SHA" "${KRW_ONTOLOGY_RELEASE_ROOT:-}" "${KRW_GURU_RELEASE_ROOT:-}" <<'NODE'
const fs = require("fs");
const [file, deploymentId, workerSha, releaseRoot, guruReleaseRoot] = process.argv.slice(2);
const identity = JSON.parse(fs.readFileSync(file, "utf8"));
if (
  identity?.format !== "krw-mac-runtime-identity/v1" ||
  identity.deploymentId !== deploymentId ||
  identity.workerBundleSha256 !== workerSha ||
  identity.releaseRoot !== releaseRoot ||
  identity.guruReleaseRoot !== guruReleaseRoot
) throw new Error("Prepared Mac runtime identity contract mismatch");
NODE
"$RUNTIME_ROOT/scripts/verify-mac-runtime-target.sh" "$RUNTIME_ENV"

"$RUNTIME_ROOT/scripts/install-mcp-server-launchd.sh" --env-file "$RUNTIME_ENV" --load
"$RUNTIME_ROOT/scripts/install-stock-news-mcp-launchd.sh" --env-file "$RUNTIME_ENV" --load
"$RUNTIME_ROOT/scripts/install-filings-mcp-launchd.sh" --env-file "$RUNTIME_ENV" --load
case "$(printf '%s' "${FILINGS_MCP_ENABLED:-}" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on)
    "$RUNTIME_ROOT/scripts/verify-filings-mcp-production.sh" --env-file "$RUNTIME_ENV"
    ;;
esac

ACTIVE_RELEASE_ID=$(basename "${KRW_ONTOLOGY_RELEASE_ROOT:?Missing sealed ontology release root}")
"$RUNTIME_ROOT/scripts/deploy-worker-production.sh" \
  --env-file "$RUNTIME_ENV" \
  --release-id "$ACTIVE_RELEASE_ID" \
  --deployment-id "$DEPLOYMENT_ID" \
  --worker-bundle-sha256 "$WORKER_SHA" \
  --runtime-identity-sha256 "$IDENTITY_SHA" \
  --use-prebuilt

MAC_RUNTIME_BASE=$(dirname "$RUNTIME_ROOT")
CURRENT_LINK="$MAC_RUNTIME_BASE/current"
CURRENT_TMP="$MAC_RUNTIME_BASE/.current.$DEPLOYMENT_ID.$$"
rm -f "$CURRENT_TMP"
ln -s "$DEPLOYMENT_ID" "$CURRENT_TMP"
node - "$CURRENT_TMP" "$CURRENT_LINK" "$MAC_RUNTIME_BASE" \
  "$DEPLOYMENT_ID" "$RUNTIME_ROOT" <<'NODE'
const fs = require("fs");
const path = require("path");
const [temporary, destination, runtimeBase, expectedTarget, expectedRoot] =
  process.argv.slice(2);
fs.renameSync(temporary, destination);
const directory = fs.openSync(runtimeBase, "r");
try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
const stats = fs.lstatSync(destination);
if (!stats.isSymbolicLink()) throw new Error("Mac current pointer is not a symlink after activation");
if (fs.readlinkSync(destination) !== expectedTarget) {
  throw new Error("Mac current pointer target differs after activation");
}
if (fs.realpathSync(destination) !== fs.realpathSync(expectedRoot)) {
  throw new Error("Mac current pointer resolves to the wrong immutable runtime");
}
if (path.dirname(destination) !== runtimeBase) {
  throw new Error("Mac current pointer escaped its runtime base");
}
NODE
echo "Immutable Mac runtime activated: $RUNTIME_ROOT"
