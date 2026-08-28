#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/deploy-web-production.sh [--dry-run] [--prepare-only|--publish-prepared|--verify-prepared-only|--activate-prepared|--abandon-prepared]

Sync only the frontend repository to the production VM and rebuild/restart the
web container. The build uses a locally sealed ontology archive uploaded for
this release; the existing remote checkout is never used as build input.

  --prepare-only       Sync source and build/verify the shared Docker image,
                       seal its release-local registry, and stop before
                       publishing a global prepared marker.
  --publish-prepared   Recheck the sealed release-local registry and artifacts,
                       then atomically publish the byte-identical global marker.
  --verify-prepared-only
                       Recheck marker, image IDs, target, source, env, and
                       resolved Compose without restarting containers.
  --activate-prepared  Activate the previously prepared image without syncing
                       source or rebuilding it.
  --abandon-prepared   Recheck the sealed release-local registry and artifacts,
                       then atomically retire (or locally receipt) the candidate.

Environment:
  GCP_PROJECT/GCP_INSTANCE/GCP_ZONE must match ops/production-target.json.
  REMOTE_FRONT_DIR      Defaults to /home/username/krw-ontology-front
  REMOTE_ONTOLOGY_DIR   Defaults to /home/username/krw-ontology
EOF
}

DRY_RUN=0
DEPLOY_MODE=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run)
      DRY_RUN=1
      ;;
    --prepare-only)
      if [ -n "$DEPLOY_MODE" ]; then
        echo "Choose only one deployment mode." >&2
        exit 1
      fi
      DEPLOY_MODE=prepare-only
      ;;
    --publish-prepared)
      if [ -n "$DEPLOY_MODE" ]; then
        echo "Choose only one deployment mode." >&2
        exit 1
      fi
      DEPLOY_MODE=publish-prepared
      ;;
    --verify-prepared-only)
      if [ -n "$DEPLOY_MODE" ]; then
        echo "Choose only one deployment mode." >&2
        exit 1
      fi
      DEPLOY_MODE=verify-prepared-only
      ;;
    --activate-prepared)
      if [ -n "$DEPLOY_MODE" ]; then
        echo "Choose only one deployment mode." >&2
        exit 1
      fi
      DEPLOY_MODE=activate-prepared
      ;;
    --abandon-prepared)
      if [ -n "$DEPLOY_MODE" ]; then
        echo "Choose only one deployment mode." >&2
        exit 1
      fi
      DEPLOY_MODE=abandon-prepared
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
if [ -z "$DEPLOY_MODE" ]; then
  echo "Choose one explicit sealed prepared-release deployment mode." >&2
  usage >&2
  exit 1
fi

# The four prepared-release lifecycle modes share one recovery flow; every
# other mode (currently only prepare-only) runs the full staged pipeline.
is_prepared_lifecycle_mode() {
  case "$DEPLOY_MODE" in
    activate-prepared|verify-prepared-only|publish-prepared|abandon-prepared) return 0 ;;
    *) return 1 ;;
  esac
}

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
LOCK_FRONT_DIR=${PRODUCTION_DEPLOY_LOCK_FRONT_DIR:-$FRONT_DIR}
case "$LOCK_FRONT_DIR" in
  /*) ;;
  *) echo "PRODUCTION_DEPLOY_LOCK_FRONT_DIR must be absolute." >&2; exit 1 ;;
esac
LOCK_FRONT_DIR=$(CDPATH= cd -- "$LOCK_FRONT_DIR" && pwd -P)
if [ "$LOCK_FRONT_DIR" != "$FRONT_DIR" ] && ! is_prepared_lifecycle_mode; then
  echo "A separate production lock root is allowed only for sealed prepared-release recovery." >&2
  exit 1
fi
CANONICAL_TARGET_FILE="$FRONT_DIR/ops/production-target.json"
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
if [ -n "${GCP_PROJECT:-}" ] && [ "$GCP_PROJECT" != "$CANONICAL_GCP_PROJECT" ]; then
  echo "GCP_PROJECT conflicts with ops/production-target.json." >&2
  exit 1
fi
if [ -n "${GCP_INSTANCE:-}" ] && [ "$GCP_INSTANCE" != "$CANONICAL_GCP_INSTANCE" ]; then
  echo "GCP_INSTANCE conflicts with ops/production-target.json." >&2
  exit 1
fi
if [ -n "${GCP_ZONE:-}" ] && [ "$GCP_ZONE" != "$CANONICAL_GCP_ZONE" ]; then
  echo "GCP_ZONE conflicts with ops/production-target.json." >&2
  exit 1
fi
GCP_PROJECT=$CANONICAL_GCP_PROJECT
GCP_INSTANCE=$CANONICAL_GCP_INSTANCE
GCP_ZONE=$CANONICAL_GCP_ZONE
if [ -n "${REMOTE_FRONT_DIR:-}" ] && [ "$REMOTE_FRONT_DIR" != "$CANONICAL_REMOTE_FRONT_DIR" ]; then
  echo "REMOTE_FRONT_DIR conflicts with ops/production-target.json." >&2
  exit 1
fi
if [ -n "${REMOTE_ONTOLOGY_DIR:-}" ] && [ "$REMOTE_ONTOLOGY_DIR" != "$CANONICAL_REMOTE_ONTOLOGY_DIR" ]; then
  echo "REMOTE_ONTOLOGY_DIR conflicts with ops/production-target.json." >&2
  exit 1
fi
REMOTE_FRONT_DIR=$CANONICAL_REMOTE_FRONT_DIR
REMOTE_ONTOLOGY_DIR=$CANONICAL_REMOTE_ONTOLOGY_DIR
DEPLOY_ID=$(date +%Y%m%d%H%M%S)-$$
APP_VERSION=${NEXT_PUBLIC_APP_VERSION:-$DEPLOY_ID}
EXPECTED_APP_VERSION=${EXPECTED_PREPARED_APP_VERSION:-}
EXPECTED_FRONT_SOURCE_SHA256=${EXPECTED_FRONT_SOURCE_SHA256:-}
EXPECTED_ONTOLOGY_SOURCE_SHA256=${EXPECTED_ONTOLOGY_SOURCE_SHA256:-}
EXPECTED_ADMIN_EMAILS_SHA256=${EXPECTED_ADMIN_EMAILS_SHA256:-}
EXPECTED_PRODUCTION_ENV_SHA256=${EXPECTED_PRODUCTION_ENV_SHA256:-}
GCP_BOOTSTRAP_ATTESTATION=${PRODUCTION_GCP_BOOTSTRAP_ATTESTATION:-}
case "$APP_VERSION" in
  ''|*[!A-Za-z0-9._-]*)
    echo "NEXT_PUBLIC_APP_VERSION must contain only letters, numbers, dot, underscore, or dash." >&2
    exit 1
    ;;
esac
case "$EXPECTED_APP_VERSION" in
  ''|*[!A-Za-z0-9._-]*)
    if [ -n "$EXPECTED_APP_VERSION" ]; then
      echo "EXPECTED_PREPARED_APP_VERSION must contain only letters, numbers, dot, underscore, or dash." >&2
      exit 1
    fi
    ;;
esac
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/krw-web-deploy.XXXXXX")
FRONT_ARCHIVE="$TMP_DIR/front-$DEPLOY_ID.tar.gz"
FRONT_FILE_LIST="$TMP_DIR/front-$DEPLOY_ID.list0"
FRONT_ARCHIVE_VERIFY_DIR="$TMP_DIR/front-archive-verify"
ONTOLOGY_ARCHIVE="$TMP_DIR/ontology-$DEPLOY_ID.tar.gz"
ONTOLOGY_FILE_LIST="$TMP_DIR/ontology-$DEPLOY_ID.list0"
ONTOLOGY_ARCHIVE_VERIFY_DIR="$TMP_DIR/ontology-archive-verify"
REMOTE_FRONT_ARCHIVE="/tmp/front-$DEPLOY_ID.tar.gz"
REMOTE_ONTOLOGY_ARCHIVE="/tmp/ontology-$DEPLOY_ID.tar.gz"
LOCAL_RUNTIME_ENV="$TMP_DIR/runtime-$DEPLOY_ID.env"
REMOTE_RUNTIME_ENV_DIR="$REMOTE_FRONT_DIR/.deploy/incoming-$APP_VERSION"
REMOTE_RUNTIME_ENV="$REMOTE_RUNTIME_ENV_DIR/runtime.env"

cleanup() {
  rm -rf "$TMP_DIR"
  if [ "${CHILD_OWNS_DEPLOY_LOCK:-0}" = "1" ]; then
    rm -f "$DEPLOY_LOCK_DIR/owner"
    rmdir "$DEPLOY_LOCK_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$LOCK_FRONT_DIR/.deploy"
DEPLOY_LOCK_DIR="$LOCK_FRONT_DIR/.deploy/production-deploy.lock"
CHILD_OWNS_DEPLOY_LOCK=0
if [ -n "${PRODUCTION_DEPLOY_LOCK_OWNER:-}" ]; then
  test -f "$DEPLOY_LOCK_DIR/owner" || {
    echo "Production deploy lock owner file is missing." >&2
    exit 1
  }
  lock_owner=$(sed -n '1p' "$DEPLOY_LOCK_DIR/owner")
  if [ "$lock_owner" != "$PRODUCTION_DEPLOY_LOCK_OWNER" ]; then
    echo "Production deploy lock ownership mismatch." >&2
    exit 1
  fi
elif [ "$DRY_RUN" = "1" ]; then
  : # Read-only planning is safe without an orchestrator lock.
else
  echo "The GCP production lane is internal; invoke the queue-safe production orchestrator." >&2
  exit 1
fi
if [ "$DRY_RUN" != "1" ]; then
  if [ "${PRODUCTION_OS_LOCK_HELD:-0}" != "1" ]; then
    echo "Missing kernel-held production deploy lock." >&2
    exit 1
  fi
  expected_attestation="$APP_VERSION:$PRODUCTION_DEPLOY_LOCK_OWNER"
  if [ "${PRODUCTION_ORCHESTRATOR_ATTESTATION:-}" != "$expected_attestation" ]; then
    echo "Missing or invalid production orchestrator attestation." >&2
    exit 1
  fi
  if [ -n "$GCP_BOOTSTRAP_ATTESTATION" ] \
    && [ "$GCP_BOOTSTRAP_ATTESTATION" != "$expected_attestation" ]; then
    echo "Invalid GCP bootstrap attestation." >&2
    exit 1
  fi
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_command gcloud
require_command curl
require_command node
require_command shasum

# A short SSH reset during an archive copy is safe to retry: the remote archive
# is an immutable, release-specific temporary file and no runtime is active yet.
gcloud_scp_with_retry() {
  scp_label=$1
  scp_source=$2
  scp_destination=$3
  scp_attempt=1
  while [ "$scp_attempt" -le 3 ]; do
    if gcloud compute scp "$scp_source" "$scp_destination" \
      --project="$GCP_PROJECT" \
      --zone="$GCP_ZONE"; then
      return 0
    fi
    if [ "$scp_attempt" -ge 3 ]; then
      return 1
    fi
    echo "Retrying $scp_label upload after a transient GCP SSH copy failure (attempt $((scp_attempt + 1))/3)..." >&2
    scp_attempt=$((scp_attempt + 1))
    sleep 2
  done
}

# A target-identity lookup is read-only, but an unattended gcloud credential
# refresh can occasionally leave its Python process blocked indefinitely. Keep
# this pre-cutover guard bounded and retry it before any archive upload or
# runtime mutation starts.
resolve_gcp_instance_id() {
  gcp_probe_attempt=1
  while [ "$gcp_probe_attempt" -le 3 ]; do
    gcp_probe_output=$(mktemp "$TMP_DIR/gcp-instance-id.XXXXXX")
    gcloud compute instances describe "$GCP_INSTANCE" \
      --project="$GCP_PROJECT" \
      --zone="$GCP_ZONE" \
      --format='value(id)' \
      --quiet >"$gcp_probe_output" 2>&1 &
    gcp_probe_pid=$!
    gcp_probe_seconds=0
    gcp_probe_timed_out=0
    # A completed child remains visible as a zombie until this shell reaps it
    # with `wait`. `kill -0` alone therefore treats a successful gcloud probe
    # as still running for the full timeout. Detect that terminal state before
    # sleeping so the bounded guard is both safe and responsive.
    while kill -0 "$gcp_probe_pid" 2>/dev/null; do
      gcp_probe_state=$(ps -o state= -p "$gcp_probe_pid" 2>/dev/null | tr -d '[:space:]' || true)
      case "$gcp_probe_state" in
        Z*|*Z*) break ;;
      esac
      if [ "$gcp_probe_seconds" -ge 30 ]; then
        gcp_probe_timed_out=1
        kill -TERM "$gcp_probe_pid" 2>/dev/null || true
        wait "$gcp_probe_pid" 2>/dev/null || true
        break
      fi
      sleep 1
      gcp_probe_seconds=$((gcp_probe_seconds + 1))
    done

    if [ "$gcp_probe_timed_out" = "0" ] && wait "$gcp_probe_pid"; then
      gcp_probe_value=$(tr -d '\r\n' <"$gcp_probe_output")
      rm -f "$gcp_probe_output"
      if [ -n "$gcp_probe_value" ]; then
        printf '%s\n' "$gcp_probe_value"
        return 0
      fi
    else
      gcp_probe_status=$?
      cat "$gcp_probe_output" >&2
      rm -f "$gcp_probe_output"
      if [ "$gcp_probe_timed_out" = "1" ]; then
        echo "GCP instance identity probe timed out after 30 seconds (attempt $gcp_probe_attempt/3)." >&2
      fi
      if [ "$gcp_probe_attempt" -eq 3 ]; then
        return "${gcp_probe_status:-1}"
      fi
      echo "Retrying GCP instance identity probe (attempt $((gcp_probe_attempt + 1))/3)..." >&2
      sleep 2
      gcp_probe_attempt=$((gcp_probe_attempt + 1))
      continue
    fi

    echo "GCP instance identity probe returned an empty value (attempt $gcp_probe_attempt/3)." >&2
    if [ "$gcp_probe_attempt" -eq 3 ]; then
      return 1
    fi
    sleep 2
    gcp_probe_attempt=$((gcp_probe_attempt + 1))
  done
  return 1
}

ACTUAL_GCP_INSTANCE_ID=$(resolve_gcp_instance_id) || {
  echo "Could not resolve the canonical GCP instance identity." >&2
  exit 1
}
if [ "$ACTUAL_GCP_INSTANCE_ID" != "$CANONICAL_GCP_INSTANCE_ID" ]; then
  echo "Canonical production VM identity mismatch." >&2
  echo "  expected: $CANONICAL_GCP_INSTANCE_ID" >&2
  echo "  actual:   ${ACTUAL_GCP_INSTANCE_ID:-missing}" >&2
  exit 1
fi

if ! is_prepared_lifecycle_mode; then
  require_command tar
  test -f "$FRONT_DIR/scripts/compute-production-source-sha256.mjs"
  ONTOLOGY_SOURCE_DIR=${KRW_ONTOLOGY_SOURCE_DIR:-$HOME/krw-ontology}
  ONTOLOGY_SOURCE_DIR=$(CDPATH= cd -- "$ONTOLOGY_SOURCE_DIR" && pwd -P)
  LOCAL_ONTOLOGY_SOURCE_SHA256=$(node \
    "$FRONT_DIR/scripts/compute-production-source-sha256.mjs" \
    "$ONTOLOGY_SOURCE_DIR")
  if [ -z "$EXPECTED_ONTOLOGY_SOURCE_SHA256" ]; then
    EXPECTED_ONTOLOGY_SOURCE_SHA256=$LOCAL_ONTOLOGY_SOURCE_SHA256
  elif [ "$EXPECTED_ONTOLOGY_SOURCE_SHA256" != "$LOCAL_ONTOLOGY_SOURCE_SHA256" ]; then
    echo "Local ontology source changed before GCP preparation." >&2
    exit 1
  fi
fi
case "$EXPECTED_ONTOLOGY_SOURCE_SHA256" in
  ''|*[!a-f0-9]*)
    if ! is_prepared_lifecycle_mode \
      || [ -n "$EXPECTED_ONTOLOGY_SOURCE_SHA256" ]; then
      echo "EXPECTED_ONTOLOGY_SOURCE_SHA256 must be a lowercase SHA-256 digest." >&2
      exit 1
    fi
    ;;
esac
if [ -n "$EXPECTED_ONTOLOGY_SOURCE_SHA256" ] \
  && [ "${#EXPECTED_ONTOLOGY_SOURCE_SHA256}" -ne 64 ]; then
  echo "EXPECTED_ONTOLOGY_SOURCE_SHA256 must contain 64 hexadecimal characters." >&2
  exit 1
fi
if ! is_prepared_lifecycle_mode; then
  LOCAL_FRONT_SOURCE_SHA256=$(node \
    "$FRONT_DIR/scripts/compute-production-source-sha256.mjs" \
    "$FRONT_DIR")
  if [ -z "$EXPECTED_FRONT_SOURCE_SHA256" ]; then
    EXPECTED_FRONT_SOURCE_SHA256=$LOCAL_FRONT_SOURCE_SHA256
  elif [ "$EXPECTED_FRONT_SOURCE_SHA256" != "$LOCAL_FRONT_SOURCE_SHA256" ]; then
    echo "Frontend source changed before GCP preparation." >&2
    exit 1
  fi
fi
if [ -n "$EXPECTED_FRONT_SOURCE_SHA256" ] \
  && ! printf '%s' "$EXPECTED_FRONT_SOURCE_SHA256" | grep -Eq '^[a-f0-9]{64}$'; then
  echo "EXPECTED_FRONT_SOURCE_SHA256 must be a lowercase SHA-256 digest." >&2
  exit 1
fi
if [ -n "$EXPECTED_ADMIN_EMAILS_SHA256" ] \
  && ! printf '%s' "$EXPECTED_ADMIN_EMAILS_SHA256" | grep -Eq '^[a-f0-9]{64}$'; then
  echo "EXPECTED_ADMIN_EMAILS_SHA256 must be a lowercase SHA-256 digest." >&2
  exit 1
fi
if [ "$DRY_RUN" != "1" ] && [ -z "$EXPECTED_ADMIN_EMAILS_SHA256" ]; then
  echo "Missing orchestrator-pinned ADMIN_EMAILS identity." >&2
  exit 1
fi
if [ -n "$EXPECTED_PRODUCTION_ENV_SHA256" ] \
  && ! printf '%s' "$EXPECTED_PRODUCTION_ENV_SHA256" | grep -Eq '^[a-f0-9]{64}$'; then
  echo "EXPECTED_PRODUCTION_ENV_SHA256 must be a lowercase SHA-256 digest." >&2
  exit 1
fi
if [ "$DRY_RUN" != "1" ] && [ -z "$EXPECTED_PRODUCTION_ENV_SHA256" ]; then
  echo "Missing orchestrator-pinned production runtime environment identity." >&2
  exit 1
fi
if [ "$DEPLOY_MODE" = "prepare-only" ] && [ "$DRY_RUN" != "1" ]; then
  case "${PRODUCTION_ENV_PATH:-}" in
    /*) ;;
    *)
      echo "PRODUCTION_ENV_PATH must be an absolute path for GCP preparation." >&2
      exit 1
      ;;
  esac
  test -f "$PRODUCTION_ENV_PATH" && [ ! -L "$PRODUCTION_ENV_PATH" ] || {
    echo "PRODUCTION_ENV_PATH must be a regular non-symlink file." >&2
    exit 1
  }
  cp "$PRODUCTION_ENV_PATH" "$LOCAL_RUNTIME_ENV"
  chmod 400 "$LOCAL_RUNTIME_ENV"
  LOCAL_RUNTIME_ENV_SHA256=$(shasum -a 256 "$LOCAL_RUNTIME_ENV" | awk '{print $1}')
  if [ "$LOCAL_RUNTIME_ENV_SHA256" != "$EXPECTED_PRODUCTION_ENV_SHA256" ]; then
    echo "Pinned production runtime environment changed before GCP preparation." >&2
    exit 1
  fi
  node "$FRONT_DIR/scripts/verify-supabase-production-target.mjs" \
    "$LOCAL_RUNTIME_ENV" \
    - \
    "$CANONICAL_TARGET_FILE" \
    --require-origins >/dev/null
  LOCAL_ADMIN_EMAILS_SHA256=$(node \
    "$FRONT_DIR/scripts/compute-admin-email-set-sha256.mjs" \
    "$LOCAL_RUNTIME_ENV")
  if [ "$LOCAL_ADMIN_EMAILS_SHA256" != "$EXPECTED_ADMIN_EMAILS_SHA256" ]; then
    echo "Pinned production runtime ADMIN_EMAILS identity changed before GCP preparation." >&2
    exit 1
  fi
fi

verify_production_health() {
  for attempt in $(seq 1 20); do
    primary_health=$(curl --connect-timeout 3 --max-time 10 -fsS "$CANONICAL_SITE_ORIGIN/api/healthz" 2>/dev/null || true)
    www_health=$(curl --connect-timeout 3 --max-time 10 -fsS "$CANONICAL_WWW_ORIGIN/api/healthz" 2>/dev/null || true)
    if printf '%s\n%s\n' "$primary_health" "$www_health" | \
      node -e '
        const fs = require("fs");
        const expected = process.argv[1];
        const lines = fs.readFileSync(0, "utf8").trim().split(/\n/);
        if (lines.length !== 2) process.exit(1);
        for (const line of lines) {
          const payload = JSON.parse(line);
          if (payload.status !== "ok" || payload.deployment_id !== expected) process.exit(1);
        }
      ' "$APP_VERSION" >/dev/null 2>&1; then
      echo "OK production health endpoints"
      return 0
    fi
    if [ "$attempt" -eq 20 ]; then
      echo "Production health endpoints did not recover after deployment." >&2
      return 1
    fi
    sleep 2
  done
}

if ! is_prepared_lifecycle_mode; then
  test -f "$FRONT_DIR/package.json"
  test -f "$FRONT_DIR/scripts/deploy-vm-compose.sh"
fi

echo "Front source: $FRONT_DIR"
echo "Target VM: $GCP_PROJECT/$GCP_ZONE/$GCP_INSTANCE id=$ACTUAL_GCP_INSTANCE_ID"
echo "Remote frontend: $REMOTE_FRONT_DIR"
echo "Remote ontology compatibility path: $REMOTE_ONTOLOGY_DIR"
echo "Deploy mode: $DEPLOY_MODE"
echo "Frontend app version: $APP_VERSION"

# market-issue-stream-worker is intentionally NOT deployed: X ingestion was
# stopped 2026-08-17 (MARKET_ISSUE_X_SOURCES=[] + sources deactivated). The
# compose definition and worker code remain for a future re-enable; add the
# service back to both lists if X streaming returns.
COMPOSE_SERVICES="reverse-proxy web agent-v1-outbox llm-gateway redis document-worker document-outbox-dispatcher filings-mcp filing-notification-worker filing-brief-worker market-issue-worker market-web-source-worker market-issue-enrichment-worker billing-worker"
COMPOSE_APPLICATION_SERVICES="web agent-v1-outbox llm-gateway document-worker document-outbox-dispatcher filings-mcp filing-notification-worker filing-brief-worker market-issue-worker market-web-source-worker market-issue-enrichment-worker billing-worker"
ROLLBACK_TRACKED_SERVICES="$COMPOSE_SERVICES"

if is_prepared_lifecycle_mode; then
  if [ "$DRY_RUN" = "1" ]; then
    case "$DEPLOY_MODE" in
      verify-prepared-only)
        echo "Dry run: would re-verify the published prepared VM image/config without restarting containers."
        ;;
      publish-prepared)
        echo "Dry run: would fully re-verify the release-local VM registry/artifacts and atomically publish its global prepared marker."
        ;;
      abandon-prepared)
        echo "Dry run: would fully re-verify the release-local VM registry/artifacts and atomically receipt the abandoned candidate."
        ;;
      activate-prepared)
        echo "Dry run: would verify and activate the published prepared VM image without syncing or rebuilding source."
        echo "Dry run: would verify both production health endpoints."
        ;;
    esac
    exit 0
  fi
  if [ -z "$EXPECTED_APP_VERSION" ]; then
    echo "EXPECTED_PREPARED_APP_VERSION is required for prepared-release lifecycle operations." >&2
    exit 1
  fi
  # The remote marker check compares the PREPARED release id, but health
  # verification and receipt paths below use the local APP_VERSION. Refuse a
  # mismatched invocation up front: activating containers and only then failing
  # health checks would strand the lifecycle between states.
  if [ "$APP_VERSION" != "$EXPECTED_APP_VERSION" ]; then
    echo "NEXT_PUBLIC_APP_VERSION must equal EXPECTED_PREPARED_APP_VERSION for lifecycle operations." >&2
    echo "  expected: $EXPECTED_APP_VERSION" >&2
    echo "  current:  $APP_VERSION" >&2
    exit 1
  fi

  REMOTE_COMMAND=$(cat <<EOF
set -eu
umask 022
REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR'
REMOTE_ONTOLOGY_DIR='$REMOTE_ONTOLOGY_DIR'
EXPECTED_APP_VERSION='$EXPECTED_APP_VERSION'
EXPECTED_FRONT_SOURCE_SHA256='$EXPECTED_FRONT_SOURCE_SHA256'
EXPECTED_ONTOLOGY_SOURCE_SHA256='$EXPECTED_ONTOLOGY_SOURCE_SHA256'
EXPECTED_ADMIN_EMAILS_SHA256='$EXPECTED_ADMIN_EMAILS_SHA256'
EXPECTED_PRODUCTION_ENV_SHA256='$EXPECTED_PRODUCTION_ENV_SHA256'
EXPECTED_SUPABASE_PROJECT_REF='$CANONICAL_SUPABASE_PROJECT_REF'
PREPARED_MARKER="\$REMOTE_FRONT_DIR/.deploy/prepared-web-release.env"
RELEASE_DIR="\$REMOTE_FRONT_DIR/.deploy/releases/\$EXPECTED_APP_VERSION"
RELEASE_PREPARED_MARKER="\$RELEASE_DIR/prepared-web-release.env"
RELEASE_ACTIVATED_MARKER="\$RELEASE_DIR/activated-web-release.env"
RELEASE_ABANDONED_MARKER="\$RELEASE_DIR/abandoned-web-release.env"
CANDIDATE_STAGE=\$(mktemp -d /tmp/krw-front-activate.XXXXXX)
ONTOLOGY_STAGE=\$(mktemp -d /tmp/krw-ontology-verify.XXXXXX)
ROLLBACK_SOURCE_STAGE=\$(mktemp -d /tmp/krw-front-rollback-verify.XXXXXX)
LIVE_ENV_TMP=
cleanup_candidate() {
  rm -rf "\$CANDIDATE_STAGE" "\$ONTOLOGY_STAGE" "\$ROLLBACK_SOURCE_STAGE"
  [ -z "\$LIVE_ENV_TMP" ] || rm -f "\$LIVE_ENV_TMP"
}
require_file_modes() {
  node -e '
    const fs = require("fs");
    const values = process.argv.slice(1);
    if (values.length === 0 || values.length % 2 !== 0) process.exit(1);
    for (let index = 0; index < values.length; index += 2) {
      const actual = fs.lstatSync(values[index]).mode & 0o777;
      const expected = Number.parseInt(values[index + 1], 8);
      if (actual !== expected) process.exit(1);
    }
  ' "\$@"
}
trap cleanup_candidate EXIT INT TERM
test -f "\$RELEASE_DIR/front-source.tar.gz"
test -f "\$RELEASE_DIR/runtime.env"
test -f "\$RELEASE_PREPARED_MARKER" && [ ! -L "\$RELEASE_PREPARED_MARKER" ] || {
  echo "Missing regular release-local prepared marker." >&2
  exit 1
}
for lifecycle_marker in \
  "\$PREPARED_MARKER" \
  "\$RELEASE_ACTIVATED_MARKER" \
  "\$RELEASE_ABANDONED_MARKER"
do
  [ ! -e "\$lifecycle_marker" ] || {
    test -f "\$lifecycle_marker" && [ ! -L "\$lifecycle_marker" ] || {
      echo "Prepared-release lifecycle markers must be regular non-symlink files." >&2
      exit 1
    }
    require_file_modes "\$lifecycle_marker" 400 || {
      echo "Prepared-release lifecycle markers must have mode 400." >&2
      exit 1
    }
    cmp -s "\$RELEASE_PREPARED_MARKER" "\$lifecycle_marker" || {
      echo "Prepared-release lifecycle marker differs from the release-local marker." >&2
      exit 1
    }
  }
done
if [ -e "\$RELEASE_ACTIVATED_MARKER" ] && [ -e "\$RELEASE_ABANDONED_MARKER" ]; then
  echo "Activated and abandoned web receipts coexist; refusing an ambiguous lifecycle state." >&2
  exit 1
fi
if [ -e "\$PREPARED_MARKER" ] \
  && { [ -e "\$RELEASE_ACTIVATED_MARKER" ] || [ -e "\$RELEASE_ABANDONED_MARKER" ]; }; then
  echo "A global prepared marker cannot coexist with a terminal release receipt." >&2
  exit 1
fi
if [ '$DEPLOY_MODE' = publish-prepared ]; then
  [ ! -e "\$RELEASE_ACTIVATED_MARKER" ] || {
    echo "An activated release cannot be republished as prepared." >&2
    exit 1
  }
  [ ! -e "\$RELEASE_ABANDONED_MARKER" ] || {
    echo "An abandoned release cannot be republished as prepared." >&2
    exit 1
  }
  if [ -e "\$PREPARED_MARKER" ]; then MARKER_STATE=prepared; else MARKER_STATE=local; fi
elif [ '$DEPLOY_MODE' = abandon-prepared ]; then
  [ ! -e "\$RELEASE_ACTIVATED_MARKER" ] || {
    echo "An activated release cannot be abandoned." >&2
    exit 1
  }
  if [ -e "\$RELEASE_ABANDONED_MARKER" ]; then
    MARKER_STATE=abandoned
  elif [ -e "\$PREPARED_MARKER" ]; then
    MARKER_STATE=prepared
  else
    MARKER_STATE=local
  fi
else
  [ ! -e "\$RELEASE_ABANDONED_MARKER" ] || {
    echo "An abandoned release is not activation-ready." >&2
    exit 1
  }
  if [ -e "\$PREPARED_MARKER" ]; then
    MARKER_STATE=prepared
  elif [ -e "\$RELEASE_ACTIVATED_MARKER" ]; then
    MARKER_STATE=activated
  else
    echo "No published prepared or activated marker exists for this deployment." >&2
    exit 1
  fi
fi
MARKER="\$RELEASE_PREPARED_MARKER"
for marker_key in \
  FORMAT APP_VERSION IMAGE_ID CADDY_IMAGE_ID DEPLOY_CONFIG_SHA256 \
  RUNTIME_ENV_SHA256 RESOLVED_COMPOSE_SHA256 FRONT_SOURCE_SHA256 \
  ONTOLOGY_SOURCE_SHA256 RELEASE_MANIFEST_SHA256
do
  test "\$(grep -c "^\$marker_key=" "\$MARKER")" = 1 || {
    echo "Prepared marker must contain exactly one \$marker_key field." >&2
    exit 1
  }
done
test "\$(sed -n 's/^FORMAT=//p' "\$MARKER")" = 'krw-prepared-web-release/v2'
EXPECTED_RELEASE_MANIFEST_SHA=\$(sed -n 's/^RELEASE_MANIFEST_SHA256=//p' "\$MARKER")
printf '%s' "\$EXPECTED_RELEASE_MANIFEST_SHA" | grep -Eq '^[a-f0-9]{64}\$' || {
  echo "Prepared marker has an invalid release manifest identity." >&2
  exit 1
}
test -f "\$RELEASE_DIR/release-manifest.env" && [ ! -L "\$RELEASE_DIR/release-manifest.env" ] || {
  echo "Missing regular release manifest." >&2
  exit 1
}
test "\$(sha256sum "\$RELEASE_DIR/release-manifest.env" | awk '{print \$1}')" = "\$EXPECTED_RELEASE_MANIFEST_SHA" || {
  echo "Prepared marker does not seal the release manifest." >&2
  exit 1
}
for manifest_key in \
  FORMAT APP_VERSION IMAGE_ID CADDY_IMAGE_ID FRONT_SOURCE_SHA256 \
  ONTOLOGY_SOURCE_SHA256 RUNTIME_ENV_SHA256 FRONT_ARCHIVE_SHA256 \
  ONTOLOGY_ARCHIVE_SHA256 CANDIDATE_COMPOSE_SHA256 ROLLBACK_MANIFEST_SHA256
do
  test "\$(grep -c "^\$manifest_key=" "\$RELEASE_DIR/release-manifest.env")" = 1 || {
    echo "Release manifest must contain exactly one \$manifest_key field." >&2
    exit 1
  }
done
test "\$(sed -n 's/^FORMAT=//p' "\$RELEASE_DIR/release-manifest.env")" = 'krw-production-release-registry/v1'
test "\$(sed -n 's/^APP_VERSION=//p' "\$RELEASE_DIR/release-manifest.env")" = "\$EXPECTED_APP_VERSION"
EXPECTED_FRONT_ARCHIVE_SHA=\$(sed -n 's/^FRONT_ARCHIVE_SHA256=//p' "\$RELEASE_DIR/release-manifest.env")
EXPECTED_ONTOLOGY_ARCHIVE_SHA=\$(sed -n 's/^ONTOLOGY_ARCHIVE_SHA256=//p' "\$RELEASE_DIR/release-manifest.env")
EXPECTED_RUNTIME_ENV_SHA=\$(sed -n 's/^RUNTIME_ENV_SHA256=//p' "\$RELEASE_DIR/release-manifest.env")
REGISTRY_IMAGE_ID=\$(sed -n 's/^IMAGE_ID=//p' "\$RELEASE_DIR/release-manifest.env")
REGISTRY_CADDY_IMAGE_ID=\$(sed -n 's/^CADDY_IMAGE_ID=//p' "\$RELEASE_DIR/release-manifest.env")
REGISTRY_FRONT_SOURCE_SHA=\$(sed -n 's/^FRONT_SOURCE_SHA256=//p' "\$RELEASE_DIR/release-manifest.env")
REGISTRY_ONTOLOGY_SOURCE_SHA=\$(sed -n 's/^ONTOLOGY_SOURCE_SHA256=//p' "\$RELEASE_DIR/release-manifest.env")
REGISTRY_COMPOSE_SHA=\$(sed -n 's/^CANDIDATE_COMPOSE_SHA256=//p' "\$RELEASE_DIR/release-manifest.env")
EXPECTED_ROLLBACK_MANIFEST_SHA=\$(sed -n 's/^ROLLBACK_MANIFEST_SHA256=//p' "\$RELEASE_DIR/release-manifest.env")
ROLLBACK_DIR="\$REMOTE_FRONT_DIR/.deploy/code-rollback-\$EXPECTED_APP_VERSION"
ROLLBACK_MANIFEST="\$REMOTE_FRONT_DIR/.deploy/code-rollback-\$EXPECTED_APP_VERSION/manifest.env"
test -f "\$ROLLBACK_MANIFEST" && [ ! -L "\$ROLLBACK_MANIFEST" ] || {
  echo "Missing regular rollback manifest." >&2
  exit 1
}
test "\$(sha256sum "\$ROLLBACK_MANIFEST" | awk '{print \$1}')" = "\$EXPECTED_ROLLBACK_MANIFEST_SHA" || {
  echo "Release registry and rollback manifest cross-seal disagree." >&2
  exit 1
}
for rollback_key in \
  FORMAT CUTOVER_APP_VERSION PREVIOUS_APP_VERSION PREVIOUS_WEB_IMAGE_ID \
  PREVIOUS_CADDY_IMAGE_ID ROLLBACK_PROVENANCE RUNTIME_ENV_SHA256 \
  TARGET_VERIFIER_SHA256 ATOMIC_INSTALLER_SHA256 PRODUCTION_TARGET_SHA256 \
  PREVIOUS_FRONT_SOURCE_SHA256 FRONT_ARCHIVE_SHA256 RESOLVED_COMPOSE_SHA256 SERVICE_STATE_SHA256 \
  CADDYFILE_SHA256
do
  test "\$(grep -c "^\$rollback_key=" "\$ROLLBACK_MANIFEST")" = 1 || {
    echo "Rollback manifest must contain exactly one \$rollback_key field." >&2
    exit 1
  }
done
test "\$(sed -n 's/^FORMAT=//p' "\$ROLLBACK_MANIFEST")" = 'krw-code-rollback/v2'
test "\$(sed -n 's/^CUTOVER_APP_VERSION=//p' "\$ROLLBACK_MANIFEST")" = "\$EXPECTED_APP_VERSION"
EXPECTED_ROLLBACK_CADDYFILE_SHA=\$(sed -n 's/^CADDYFILE_SHA256=//p' "\$ROLLBACK_MANIFEST")
printf '%s' "\$EXPECTED_ROLLBACK_CADDYFILE_SHA" | grep -Eq '^[a-f0-9]{64}\$' || {
  echo "Rollback manifest has an invalid Caddyfile identity." >&2
  exit 1
}
EXPECTED_ROLLBACK_FRONT_SOURCE_SHA=\$(sed -n 's/^PREVIOUS_FRONT_SOURCE_SHA256=//p' "\$ROLLBACK_MANIFEST")
printf '%s' "\$EXPECTED_ROLLBACK_FRONT_SOURCE_SHA" | grep -Eq '^[a-f0-9]{64}\$' || {
  echo "Rollback manifest has an invalid prior frontend source identity." >&2
  exit 1
}
for rollback_pair in \
  "runtime.env:RUNTIME_ENV_SHA256" \
  "verify-supabase-production-target.mjs:TARGET_VERIFIER_SHA256" \
  "atomic-install-sealed-file.mjs:ATOMIC_INSTALLER_SHA256" \
  "production-target.json:PRODUCTION_TARGET_SHA256" \
  "front-source.tar.gz:FRONT_ARCHIVE_SHA256" \
  "compose.resolved.yml:RESOLVED_COMPOSE_SHA256" \
  "services.tsv:SERVICE_STATE_SHA256"
do
  rollback_name=\${rollback_pair%%:*}
  rollback_digest_key=\${rollback_pair#*:}
  rollback_path="\$ROLLBACK_DIR/\$rollback_name"
  test -f "\$rollback_path" && [ ! -L "\$rollback_path" ] || {
    echo "Rollback artifacts must be regular non-symlink files." >&2
    exit 1
  }
  rollback_expected_sha=\$(sed -n "s/^\$rollback_digest_key=//p" "\$ROLLBACK_MANIFEST")
  printf '%s' "\$rollback_expected_sha" | grep -Eq '^[a-f0-9]{64}\$' || {
    echo "Rollback manifest contains an invalid \$rollback_digest_key digest." >&2
    exit 1
  }
  test "\$(sha256sum "\$rollback_path" | awk '{print \$1}')" = "\$rollback_expected_sha" || {
    echo "Rollback artifact no longer matches \$rollback_digest_key." >&2
    exit 1
  }
done
for release_artifact in \
  "\$RELEASE_DIR/front-source.tar.gz" \
  "\$RELEASE_DIR/ontology-source.tar.gz" \
  "\$RELEASE_DIR/runtime.env" \
  "\$RELEASE_DIR/candidate-compose.resolved.yml"
do
  test -f "\$release_artifact" && [ ! -L "\$release_artifact" ] || {
    echo "Release artifacts must be regular non-symlink files." >&2
    exit 1
  }
done
require_file_modes \
  "\$RELEASE_PREPARED_MARKER" 400 \
  "\$RELEASE_DIR/release-manifest.env" 400 \
  "\$RELEASE_DIR/front-source.tar.gz" 400 \
  "\$RELEASE_DIR/ontology-source.tar.gz" 400 \
  "\$RELEASE_DIR/runtime.env" 400 \
  "\$RELEASE_DIR/candidate-compose.resolved.yml" 400 \
  "\$ROLLBACK_MANIFEST" 600 \
  "\$ROLLBACK_DIR/runtime.env" 600 \
  "\$ROLLBACK_DIR/verify-supabase-production-target.mjs" 600 \
  "\$ROLLBACK_DIR/atomic-install-sealed-file.mjs" 600 \
  "\$ROLLBACK_DIR/production-target.json" 600 \
  "\$ROLLBACK_DIR/front-source.tar.gz" 600 \
  "\$ROLLBACK_DIR/compose.resolved.yml" 600 \
  "\$ROLLBACK_DIR/services.tsv" 600 || {
    echo "Sealed release or rollback artifacts have an invalid file mode." >&2
    exit 1
  }
test "\$(sha256sum "\$RELEASE_DIR/front-source.tar.gz" | awk '{print \$1}')" = "\$EXPECTED_FRONT_ARCHIVE_SHA"
test "\$(sha256sum "\$RELEASE_DIR/ontology-source.tar.gz" | awk '{print \$1}')" = "\$EXPECTED_ONTOLOGY_ARCHIVE_SHA"
test "\$(sha256sum "\$RELEASE_DIR/runtime.env" | awk '{print \$1}')" = "\$EXPECTED_RUNTIME_ENV_SHA"
test "\$(sha256sum "\$RELEASE_DIR/candidate-compose.resolved.yml" | awk '{print \$1}')" = "\$REGISTRY_COMPOSE_SHA"
test "\$EXPECTED_RUNTIME_ENV_SHA" = "\$EXPECTED_PRODUCTION_ENV_SHA256" || {
  echo "Sealed candidate runtime environment differs from the orchestrator identity." >&2
  exit 1
}
EXPECTED_PREVIOUS_RUNTIME_ENV_SHA=\$(sed -n 's/^RUNTIME_ENV_SHA256=//p' "\$ROLLBACK_MANIFEST")
printf '%s' "\$EXPECTED_PREVIOUS_RUNTIME_ENV_SHA" | grep -Eq '^[a-f0-9]{64}\$' || {
  echo "Rollback manifest has an invalid prior runtime environment identity." >&2
  exit 1
}
test -f "\$REMOTE_FRONT_DIR/.env" && [ ! -L "\$REMOTE_FRONT_DIR/.env" ] || {
  echo "Live web environment must be a regular non-symlink file." >&2
  exit 1
}
LIVE_RUNTIME_ENV_SHA=\$(sha256sum "\$REMOTE_FRONT_DIR/.env" | awk '{print \$1}')
if [ "\$MARKER_STATE" = activated ] \
  && [ "\$LIVE_RUNTIME_ENV_SHA" = "\$EXPECTED_RUNTIME_ENV_SHA" ]; then
  # A code-only release can legitimately reuse the exact previous environment
  # digest.  On an activated-marker retry, the marker disambiguates that
  # shared digest as the already-promoted candidate state.
  LIVE_RUNTIME_ENV_STATE=candidate
elif [ "\$LIVE_RUNTIME_ENV_SHA" = "\$EXPECTED_PREVIOUS_RUNTIME_ENV_SHA" ]; then
  LIVE_RUNTIME_ENV_STATE=previous
elif [ "\$LIVE_RUNTIME_ENV_SHA" = "\$EXPECTED_RUNTIME_ENV_SHA" ]; then
  LIVE_RUNTIME_ENV_STATE=candidate
else
  echo "Live web environment is neither the sealed previous nor candidate state." >&2
  exit 1
fi
if [ "\$MARKER_STATE" = activated ] && [ "\$LIVE_RUNTIME_ENV_STATE" != candidate ]; then
  echo "An activated marker requires the sealed candidate live environment." >&2
  exit 1
fi
if { [ '$DEPLOY_MODE' = publish-prepared ] || [ '$DEPLOY_MODE' = abandon-prepared ]; } \
  && [ "\$LIVE_RUNTIME_ENV_STATE" != previous ]; then
  echo "Pre-pause prepared-release publication/abandonment requires the sealed previous live environment." >&2
  exit 1
fi
tar --warning=no-unknown-keyword -xzf "\$RELEASE_DIR/front-source.tar.gz" -C "\$CANDIDATE_STAGE"
tar --warning=no-unknown-keyword -xzf "\$RELEASE_DIR/ontology-source.tar.gz" -C "\$ONTOLOGY_STAGE"
tar --warning=no-unknown-keyword -xzf "\$ROLLBACK_DIR/front-source.tar.gz" -C "\$ROLLBACK_SOURCE_STAGE"
ACTUAL_ROLLBACK_FRONT_SOURCE_SHA=\$(node \
  "\$CANDIDATE_STAGE/scripts/compute-production-source-sha256.mjs" \
  "\$ROLLBACK_SOURCE_STAGE")
test "\$ACTUAL_ROLLBACK_FRONT_SOURCE_SHA" = "\$EXPECTED_ROLLBACK_FRONT_SOURCE_SHA" || {
  echo "Archived rollback frontend source differs from its canonical identity." >&2
  exit 1
}
ROLLBACK_CADDYFILE="\$ROLLBACK_SOURCE_STAGE/Caddyfile"
test -f "\$ROLLBACK_CADDYFILE" && [ ! -L "\$ROLLBACK_CADDYFILE" ] || {
  echo "Archived rollback Caddyfile must be a regular non-symlink file." >&2
  exit 1
}
test "\$(sha256sum "\$ROLLBACK_CADDYFILE" | awk '{print \$1}')" = "\$EXPECTED_ROLLBACK_CADDYFILE_SHA" || {
  echo "Archived rollback Caddyfile no longer matches its sealed identity." >&2
  exit 1
}
PREVIOUS_CADDY_IMAGE_ID=\$(sed -n 's/^PREVIOUS_CADDY_IMAGE_ID=//p' "\$ROLLBACK_MANIFEST")
test -n "\$PREVIOUS_CADDY_IMAGE_ID" \
  && test "\${PREVIOUS_CADDY_IMAGE_ID#sha256:}" != "\$PREVIOUS_CADDY_IMAGE_ID" || {
  echo "Rollback manifest has an invalid prior Caddy image identity." >&2
  exit 1
}
test "\$(docker image inspect --format '{{.Id}}' "\$PREVIOUS_CADDY_IMAGE_ID")" = "\$PREVIOUS_CADDY_IMAGE_ID" || {
  echo "Sealed prior Caddy image is unavailable for rollback." >&2
  exit 1
}
docker run --rm --network none --read-only \
  --tmpfs /tmp:rw,noexec,nosuid,size=16m \
  --tmpfs /data:rw,noexec,nosuid,size=16m \
  --tmpfs /config:rw,noexec,nosuid,size=16m \
  --mount "type=bind,src=\$ROLLBACK_CADDYFILE,dst=/etc/caddy/Caddyfile,readonly" \
  --entrypoint caddy "\$PREVIOUS_CADDY_IMAGE_ID" \
  adapt --config /etc/caddy/Caddyfile --adapter caddyfile --validate >/dev/null
if [ "\$MARKER_STATE" = prepared ]; then
  test -f "\$REMOTE_FRONT_DIR/Caddyfile" && [ ! -L "\$REMOTE_FRONT_DIR/Caddyfile" ] || {
    echo "Live production Caddyfile must be a regular non-symlink file before activation." >&2
    exit 1
  }
  test "\$(sha256sum "\$REMOTE_FRONT_DIR/Caddyfile" | awk '{print \$1}')" = "\$EXPECTED_ROLLBACK_CADDYFILE_SHA" || {
    echo "Live production Caddyfile differs from the sealed rollback source before activation." >&2
    exit 1
  }
fi
rm -rf "\$CANDIDATE_STAGE/krw-ontology"
ln -s "\$ONTOLOGY_STAGE" "\$CANDIDATE_STAGE/krw-ontology"

node "\$CANDIDATE_STAGE/scripts/verify-supabase-production-target.mjs" \
  "\$RELEASE_DIR/runtime.env" \
  - \
  "\$CANDIDATE_STAGE/ops/production-target.json" \
  --require-origins
ACTUAL_ADMIN_EMAILS_SHA256=\$(node \
  "\$CANDIDATE_STAGE/scripts/compute-admin-email-set-sha256.mjs" \
  "\$RELEASE_DIR/runtime.env")
test "\$ACTUAL_ADMIN_EMAILS_SHA256" = "\$EXPECTED_ADMIN_EMAILS_SHA256" || {
  echo "Remote web ADMIN_EMAILS set differs from the pinned entitlement set." >&2
  exit 1
}
ACTUAL_SUPABASE_PROJECT_REF=\$(node -e 'const target=require(process.argv[1]);process.stdout.write(target.supabaseProjectRef)' "\$CANDIDATE_STAGE/ops/production-target.json")
test "\$ACTUAL_SUPABASE_PROJECT_REF" = "\$EXPECTED_SUPABASE_PROJECT_REF" || {
  echo "Remote canonical Supabase target does not match this deployment." >&2
  exit 1
}
APP_VERSION=\$(sed -n 's/^APP_VERSION=//p' "\$MARKER" | tail -n 1)
IMAGE_ID=\$(sed -n 's/^IMAGE_ID=//p' "\$MARKER" | tail -n 1)
CADDY_IMAGE_ID=\$(sed -n 's/^CADDY_IMAGE_ID=//p' "\$MARKER" | tail -n 1)
DEPLOY_CONFIG_SHA256=\$(sed -n 's/^DEPLOY_CONFIG_SHA256=//p' "\$MARKER" | tail -n 1)
RUNTIME_ENV_SHA256=\$(sed -n 's/^RUNTIME_ENV_SHA256=//p' "\$MARKER" | tail -n 1)
RESOLVED_COMPOSE_SHA256=\$(sed -n 's/^RESOLVED_COMPOSE_SHA256=//p' "\$MARKER" | tail -n 1)
FRONT_SOURCE_SHA256=\$(sed -n 's/^FRONT_SOURCE_SHA256=//p' "\$MARKER" | tail -n 1)
ONTOLOGY_SOURCE_SHA256=\$(sed -n 's/^ONTOLOGY_SOURCE_SHA256=//p' "\$MARKER" | tail -n 1)
test "\$IMAGE_ID" = "\$REGISTRY_IMAGE_ID" || { echo "Prepared image and release registry disagree." >&2; exit 1; }
test "\$CADDY_IMAGE_ID" = "\$REGISTRY_CADDY_IMAGE_ID" || { echo "Prepared Caddy image and release registry disagree." >&2; exit 1; }
test "\$FRONT_SOURCE_SHA256" = "\$REGISTRY_FRONT_SOURCE_SHA" || { echo "Prepared frontend source and release registry disagree." >&2; exit 1; }
test "\$ONTOLOGY_SOURCE_SHA256" = "\$REGISTRY_ONTOLOGY_SOURCE_SHA" || { echo "Prepared ontology source and release registry disagree." >&2; exit 1; }
test "\$RESOLVED_COMPOSE_SHA256" = "\$REGISTRY_COMPOSE_SHA" || { echo "Prepared Compose and release registry disagree." >&2; exit 1; }
if [ -n "\$EXPECTED_APP_VERSION" ] && [ "\$APP_VERSION" != "\$EXPECTED_APP_VERSION" ]; then
  echo "Prepared app version does not match this deployment." >&2
  echo "  expected: \$EXPECTED_APP_VERSION" >&2
  echo "  prepared: \$APP_VERSION" >&2
  exit 1
fi
printf '%s' "\${APP_VERSION:-}" | grep -Eq '^[A-Za-z0-9._-]+\$' || {
  echo "Invalid prepared app version" >&2
  exit 1
}
test -n "\${IMAGE_ID:-}" && test "\${IMAGE_ID#sha256:}" != "\$IMAGE_ID" || {
  echo "Invalid prepared image id" >&2
  exit 1
}
test -n "\${CADDY_IMAGE_ID:-}" && test "\${CADDY_IMAGE_ID#sha256:}" != "\$CADDY_IMAGE_ID" || {
  echo "Invalid prepared Caddy image id" >&2
  exit 1
}
printf '%s' "\${DEPLOY_CONFIG_SHA256:-}" | grep -Eq '^[a-f0-9]{64}\$' || {
  echo "Invalid prepared deploy config sha256" >&2
  exit 1
}
test "\$RUNTIME_ENV_SHA256" = "\$EXPECTED_RUNTIME_ENV_SHA" || {
  echo "Prepared runtime environment identity does not match the release registry." >&2
  exit 1
}
printf '%s' "\${RESOLVED_COMPOSE_SHA256:-}" | grep -Eq '^[a-f0-9]{64}\$' || {
  echo "Invalid prepared resolved Compose sha256" >&2
  exit 1
}
printf '%s' "\${FRONT_SOURCE_SHA256:-}" | grep -Eq '^[a-f0-9]{64}\$' || {
  echo "Invalid prepared front source sha256" >&2
  exit 1
}
if [ -n "\$EXPECTED_FRONT_SOURCE_SHA256" ] \
  && [ "\$FRONT_SOURCE_SHA256" != "\$EXPECTED_FRONT_SOURCE_SHA256" ]; then
  echo "Prepared frontend source does not match this deployment." >&2
  exit 1
fi
printf '%s' "\${ONTOLOGY_SOURCE_SHA256:-}" | grep -Eq '^[a-f0-9]{64}\$' || {
  echo "Invalid prepared ontology source sha256" >&2
  exit 1
}
if [ -n "\$EXPECTED_ONTOLOGY_SOURCE_SHA256" ] \
  && [ "\$ONTOLOGY_SOURCE_SHA256" != "\$EXPECTED_ONTOLOGY_SOURCE_SHA256" ]; then
  echo "Prepared ontology source does not match this deployment." >&2
  exit 1
fi

CURRENT_IMAGE_ID=\$(docker image inspect --format '{{.Id}}' krw-ontology-front-web:local)
if [ "\$CURRENT_IMAGE_ID" != "\$IMAGE_ID" ]; then
  echo "Prepared image changed after verification." >&2
  echo "  expected: \$IMAGE_ID" >&2
  echo "  current:  \$CURRENT_IMAGE_ID" >&2
  exit 1
fi
CURRENT_CADDY_IMAGE_ID=\$(docker image inspect --format '{{.Id}}' caddy:2)
if [ "\$CURRENT_CADDY_IMAGE_ID" != "\$CADDY_IMAGE_ID" ]; then
  echo "Prepared Caddy image changed after verification." >&2
  exit 1
fi

CURRENT_FRONT_SOURCE_SHA256=\$(node "\$CANDIDATE_STAGE/scripts/compute-production-source-sha256.mjs" "\$CANDIDATE_STAGE")
if [ "\$CURRENT_FRONT_SOURCE_SHA256" != "\$FRONT_SOURCE_SHA256" ]; then
  echo "Prepared source archive does not match its source identity." >&2
  exit 1
fi
ARCHIVED_ONTOLOGY_SOURCE_SHA256=\$(node "\$CANDIDATE_STAGE/scripts/compute-production-source-sha256.mjs" "\$ONTOLOGY_STAGE")
if [ "\$ARCHIVED_ONTOLOGY_SOURCE_SHA256" != "\$ONTOLOGY_SOURCE_SHA256" ]; then
  echo "Prepared ontology archive does not match its source identity." >&2
  exit 1
fi
cd "\$CANDIDATE_STAGE"
CURRENT_DEPLOY_CONFIG_SHA256=\$(
  sha256sum docker-compose.yml Caddyfile scripts/deploy-vm-compose.sh \
    scripts/verify-supabase-production-target.mjs ops/production-target.json \
    "\$RELEASE_DIR/runtime.env" \
    | sha256sum \
    | awk '{print \$1}'
)
if [ "\$CURRENT_DEPLOY_CONFIG_SHA256" != "\$DEPLOY_CONFIG_SHA256" ]; then
  echo "Remote compose, Caddy, deploy script, or environment changed after image preparation." >&2
  exit 1
fi
CURRENT_RESOLVED_COMPOSE_SHA256=\$(
  FRONT_DIR="\$REMOTE_FRONT_DIR" \
  NEXT_PUBLIC_APP_VERSION="\$APP_VERSION" \
  KRW_ONTOLOGY_SOURCE_DIR="\$REMOTE_ONTOLOGY_DIR" \
  BILLING_WORKER_REQUIRE_TOSS_PAYMENTS=0 \
    docker compose --project-name '$CANONICAL_COMPOSE_PROJECT' \
      --project-directory "\$REMOTE_FRONT_DIR" \
      --env-file "\$RELEASE_DIR/runtime.env" \
      -f "\$CANDIDATE_STAGE/docker-compose.yml" config \
    | sha256sum \
    | awk '{print \$1}'
)
if [ '$DEPLOY_MODE' != 'abandon-prepared' ] \
  && [ "\$CURRENT_RESOLVED_COMPOSE_SHA256" != "\$RESOLVED_COMPOSE_SHA256" ]; then
  echo "Resolved production Compose configuration changed after preparation." >&2
  exit 1
fi

if [ '$DEPLOY_MODE' = 'verify-prepared-only' ]; then
  echo "OK prepared VM image and configuration remain activation-ready."
  exit 0
fi
if [ '$DEPLOY_MODE' = 'publish-prepared' ] || [ '$DEPLOY_MODE' = 'abandon-prepared' ]; then
  MARKER_SHA256=\$(sha256sum "\$RELEASE_PREPARED_MARKER" | awk '{print \$1}')
  # The global marker and terminal abandoned receipt both assert a durable
  # lifecycle boundary. Flush every release/rollback byte they transitively
  # seal, plus the complete ancestor chain through .deploy, before publishing
  # either assertion.
  node -e '
    const fs = require("fs");
    const path = require("path");
    const boundary = path.resolve(process.argv[1]);
    const files = process.argv.slice(2);
    const directories = new Set();
    for (const file of files) {
      const stats = fs.lstatSync(file);
      if (!stats.isFile() || stats.isSymbolicLink()) throw new Error("sealed durability input must be a regular file");
      const fd = fs.openSync(file, "r");
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      let directory = path.resolve(path.dirname(file));
      while (directory === boundary || directory.startsWith(boundary + path.sep)) {
        directories.add(directory);
        if (directory === boundary) break;
        directory = path.dirname(directory);
      }
    }
    if (!directories.has(boundary)) throw new Error("sealed durability inputs escape the deployment registry boundary");
    const bottomUp = [...directories].sort((left, right) => right.split(path.sep).length - left.split(path.sep).length);
    for (const directory of bottomUp) {
      const stats = fs.lstatSync(directory);
      if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error("sealed durability ancestor must be a regular directory");
      const fd = fs.openSync(directory, "r");
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
  ' \
    "\$REMOTE_FRONT_DIR/.deploy" \
    "\$RELEASE_PREPARED_MARKER" \
    "\$RELEASE_DIR/release-manifest.env" \
    "\$RELEASE_DIR/front-source.tar.gz" \
    "\$RELEASE_DIR/ontology-source.tar.gz" \
    "\$RELEASE_DIR/runtime.env" \
    "\$RELEASE_DIR/candidate-compose.resolved.yml" \
    "\$ROLLBACK_MANIFEST" \
    "\$ROLLBACK_DIR/runtime.env" \
    "\$ROLLBACK_DIR/verify-supabase-production-target.mjs" \
    "\$ROLLBACK_DIR/atomic-install-sealed-file.mjs" \
    "\$ROLLBACK_DIR/production-target.json" \
    "\$ROLLBACK_DIR/front-source.tar.gz" \
    "\$ROLLBACK_DIR/compose.resolved.yml" \
    "\$ROLLBACK_DIR/services.tsv"
fi
if [ '$DEPLOY_MODE' = 'publish-prepared' ]; then
  if [ "\$MARKER_STATE" = prepared ]; then
    # A lost SSH acknowledgement after the atomic publication is a successful
    # idempotent retry only when the global bytes remain exact.
    test "\$(sha256sum "\$PREPARED_MARKER" | awk '{print \$1}')" = "\$MARKER_SHA256"
  else
    GLOBAL_MARKER_TMP="\$REMOTE_FRONT_DIR/.deploy/prepared-web-release.env.next.\$\$"
    cp "\$RELEASE_PREPARED_MARKER" "\$GLOBAL_MARKER_TMP"
    chmod 400 "\$GLOBAL_MARKER_TMP"
    test "\$(sha256sum "\$GLOBAL_MARKER_TMP" | awk '{print \$1}')" = "\$MARKER_SHA256"
    node "\$CANDIDATE_STAGE/scripts/atomic-transition-sealed-file.mjs" \
      "\$GLOBAL_MARKER_TMP" "\$PREPARED_MARKER" "\$MARKER_SHA256" 400
  fi
  echo "OK release-local VM registry published as the global prepared marker."
  exit 0
fi
if [ '$DEPLOY_MODE' = 'abandon-prepared' ]; then
  if [ "\$MARKER_STATE" = abandoned ]; then
    test "\$(sha256sum "\$RELEASE_ABANDONED_MARKER" | awk '{print \$1}')" = "\$MARKER_SHA256"
  elif [ "\$MARKER_STATE" = prepared ]; then
    node "\$CANDIDATE_STAGE/scripts/atomic-transition-sealed-file.mjs" \
      "\$PREPARED_MARKER" "\$RELEASE_ABANDONED_MARKER" "\$MARKER_SHA256" 400
  else
    ABANDONED_MARKER_TMP="\$RELEASE_DIR/abandoned-web-release.env.next.\$\$"
    cp "\$RELEASE_PREPARED_MARKER" "\$ABANDONED_MARKER_TMP"
    chmod 400 "\$ABANDONED_MARKER_TMP"
    test "\$(sha256sum "\$ABANDONED_MARKER_TMP" | awk '{print \$1}')" = "\$MARKER_SHA256"
    node "\$CANDIDATE_STAGE/scripts/atomic-transition-sealed-file.mjs" \
      "\$ABANDONED_MARKER_TMP" "\$RELEASE_ABANDONED_MARKER" "\$MARKER_SHA256" 400
  fi
  echo "OK prepared VM release has an exact abandoned receipt."
  exit 0
fi

rsync -a --delete \
  --exclude '.deploy/' --exclude '.env' --exclude '.env.*' \
  --exclude '.next/' --exclude 'node_modules/' \
  --exclude '/krw-ontology' --exclude '/krw-ontology/' \
  "\$CANDIDATE_STAGE/" "\$REMOTE_FRONT_DIR/"
if [ -L "\$REMOTE_FRONT_DIR/krw-ontology" ]; then
  rm "\$REMOTE_FRONT_DIR/krw-ontology"
elif [ -e "\$REMOTE_FRONT_DIR/krw-ontology" ]; then
  mv "\$REMOTE_FRONT_DIR/krw-ontology" \
    "\$REMOTE_FRONT_DIR/krw-ontology.legacy.$APP_VERSION"
fi
ln -s "\$REMOTE_ONTOLOGY_DIR" "\$REMOTE_FRONT_DIR/krw-ontology"
cd "\$REMOTE_FRONT_DIR"
PROMOTED_FRONT_SOURCE_SHA256=\$(node scripts/compute-production-source-sha256.mjs "\$REMOTE_FRONT_DIR")
test "\$PROMOTED_FRONT_SOURCE_SHA256" = "\$FRONT_SOURCE_SHA256" || {
  echo "Promoted frontend source does not match the prepared archive." >&2
  exit 1
}
chmod +x scripts/deploy-vm-compose.sh
EXPECTED_PREPARED_IMAGE_ID="\$IMAGE_ID" \
EXPECTED_PREPARED_CADDY_IMAGE_ID="\$CADDY_IMAGE_ID" \
NEXT_PUBLIC_APP_VERSION="\$APP_VERSION" \
VM_DEPLOY_ATTESTATION="\$APP_VERSION:$CANONICAL_COMPOSE_PROJECT" \
KRW_ONTOLOGY_SOURCE_DIR="\$REMOTE_ONTOLOGY_DIR" \
ENV_FILE="\$RELEASE_DIR/runtime.env" \
BILLING_WORKER_REQUIRE_TOSS_PAYMENTS=0 \
  scripts/deploy-vm-compose.sh --activate-only $COMPOSE_APPLICATION_SERVICES
verified_deep=0
for attempt in \$(seq 1 60); do
  if docker compose --project-name '$CANONICAL_COMPOSE_PROJECT' --env-file "\$RELEASE_DIR/runtime.env" \
    exec -T -e EXPECTED_ADMIN_EMAILS_SHA256="\$EXPECTED_ADMIN_EMAILS_SHA256" web node -e '
    async function main() {
      const { createHash } = require("crypto");
      const expected = process.env.NEXT_PUBLIC_APP_VERSION;
      const key = process.env.INTERNAL_API_KEY;
      const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
      const adminEmails = [...new Set(
        String(process.env.ADMIN_EMAILS || "")
          .split(",")
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean),
      )].sort();
      if (adminEmails.length === 0) throw new Error("runtime ADMIN_EMAILS set is empty");
      const adminDigest = createHash("sha256")
        .update(adminEmails.join("\n"))
        .digest("hex");
      if (adminDigest !== process.env.EXPECTED_ADMIN_EMAILS_SHA256) {
        throw new Error("runtime ADMIN_EMAILS identity mismatch");
      }
      const deep = await fetch("http://127.0.0.1:3000/api/healthz/deep", {
        headers: {
          "x-internal-key": key || "",
          "x-krw-client-ip": "127.0.0.1",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      const payload = await deep.json();
      if (!deep.ok || payload.status !== "ok" || payload.deployment_id !== expected) {
        throw new Error("deep health is not ready for deployment " + expected);
      }
      const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
      function assertPublicCredential(label, anon) {
        if (!anon) throw new Error("remote public Supabase credential is missing: " + label);
        if (serviceRole && anon === serviceRole) throw new Error(label + " is wired to the service-role credential");
        if (/^(sb_secret_|sb_service_)/.test(anon)) throw new Error(label + " uses a secret/service key format");
        if (/^(sb_publishable_|sb_anon_)/.test(anon)) return;
        const parts = anon.split(".");
        if (parts.length !== 3) throw new Error(label + " has an unrecognized public key format");
        let payload;
        try { payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); }
        catch { throw new Error(label + " is not a valid legacy JWT"); }
        if (payload.role !== "anon") throw new Error(label + " JWT role must be anon, got " + String(payload.role));
      }
      for (const [label, anon] of [
        ["SUPABASE_ANON_KEY", process.env.SUPABASE_ANON_KEY],
        ["NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY],
      ]) {
        assertPublicCredential(label, anon);
        const probe = await fetch(url + "/auth/v1/settings", {
          headers: { apikey: anon },
          cache: "no-store",
          signal: AbortSignal.timeout(10000),
        });
        if (!probe.ok) throw new Error(label + " probe failed: " + probe.status);
      }
    }
    main().catch((error) => { console.error(error.message || error); process.exit(1); });
  '; then
    verified_deep=1
    break
  fi
  sleep 2
done
if [ "\$verified_deep" != "1" ]; then
  echo "Version-bound deep health and remote Supabase credential probes failed." >&2
  exit 1
fi
umask 077
LIVE_ENV_TMP=\$(mktemp "\$REMOTE_FRONT_DIR/.env.next.XXXXXX")
cp "\$RELEASE_DIR/runtime.env" "\$LIVE_ENV_TMP"
chmod 600 "\$LIVE_ENV_TMP"
test "\$(sha256sum "\$LIVE_ENV_TMP" | awk '{print \$1}')" = "\$EXPECTED_RUNTIME_ENV_SHA" || {
  echo "Candidate live environment failed its release seal before promotion." >&2
  exit 1
}
node scripts/atomic-install-sealed-file.mjs \
  "\$LIVE_ENV_TMP" "\$REMOTE_FRONT_DIR/.env" "\$EXPECTED_RUNTIME_ENV_SHA" 600
LIVE_ENV_TMP=
test "\$(sha256sum "\$REMOTE_FRONT_DIR/.env" | awk '{print \$1}')" = "\$EXPECTED_RUNTIME_ENV_SHA" || {
  echo "Live web environment promotion did not preserve the release identity." >&2
  exit 1
}
# Only expose the new web container after all private semantic checks pass.
EXPECTED_PREPARED_IMAGE_ID="\$IMAGE_ID" \
EXPECTED_PREPARED_CADDY_IMAGE_ID="\$CADDY_IMAGE_ID" \
NEXT_PUBLIC_APP_VERSION="\$APP_VERSION" \
VM_DEPLOY_ATTESTATION="\$APP_VERSION:$CANONICAL_COMPOSE_PROJECT" \
KRW_ONTOLOGY_SOURCE_DIR="\$REMOTE_ONTOLOGY_DIR" \
ENV_FILE="\$RELEASE_DIR/runtime.env" \
BILLING_WORKER_REQUIRE_TOSS_PAYMENTS=0 \
  scripts/deploy-vm-compose.sh --activate-only reverse-proxy
docker compose --project-name '$CANONICAL_COMPOSE_PROJECT' --env-file "\$RELEASE_DIR/runtime.env" ps
EOF
  )

  gcloud compute ssh "$GCP_INSTANCE" \
    --project="$GCP_PROJECT" \
    --zone="$GCP_ZONE" \
    --command="$REMOTE_COMMAND"

  if [ "$DEPLOY_MODE" = "verify-prepared-only" ]; then
    echo "OK prepared web runtime remains activation-ready."
    exit 0
  fi
  if [ "$DEPLOY_MODE" = "publish-prepared" ]; then
    echo "Prepared web release published. Production containers were not restarted."
    exit 0
  fi
  if [ "$DEPLOY_MODE" = "abandon-prepared" ]; then
    echo "Prepared web release abandoned. Production containers were not restarted."
    exit 0
  fi

  echo "Checking production health..."
  verify_production_health
  gcloud compute ssh "$GCP_INSTANCE" \
    --project="$GCP_PROJECT" \
    --zone="$GCP_ZONE" \
    --command="set -eu; release_dir='$REMOTE_FRONT_DIR/.deploy/releases/$APP_VERSION'; global_marker='$REMOTE_FRONT_DIR/.deploy/prepared-web-release.env'; local_marker=\"\$release_dir/prepared-web-release.env\"; activated_marker=\"\$release_dir/activated-web-release.env\"; manifest=\"\$release_dir/release-manifest.env\"; receipt=\"\$release_dir/activation-health-receipt.env\"; test -f \"\$local_marker\"; marker_sha=\$(sha256sum \"\$local_marker\" | awk '{print \$1}'); manifest_sha=\$(sha256sum \"\$manifest\" | awk '{print \$1}'); test \"\$(sed -n 's/^RELEASE_MANIFEST_SHA256=//p' \"\$local_marker\")\" = \"\$manifest_sha\"; test \"\$(sha256sum '$REMOTE_FRONT_DIR/.env' | awk '{print \$1}')\" = \"\$(sed -n 's/^RUNTIME_ENV_SHA256=//p' \"\$manifest\")\"; receipt_tmp=\"\$release_dir/activation-health-receipt.env.next.\$\$\"; printf '%s\\n' 'FORMAT=krw-production-activation-health/v1' 'APP_VERSION=$APP_VERSION' \"PREPARED_MARKER_SHA256=\$marker_sha\" \"RELEASE_MANIFEST_SHA256=\$manifest_sha\" >\"\$receipt_tmp\"; chmod 400 \"\$receipt_tmp\"; receipt_sha=\$(sha256sum \"\$receipt_tmp\" | awk '{print \$1}'); if [ -e \"\$receipt\" ]; then test -f \"\$receipt\" && [ ! -L \"\$receipt\" ] && cmp -s \"\$receipt_tmp\" \"\$receipt\"; rm -f \"\$receipt_tmp\"; else node '$REMOTE_FRONT_DIR/scripts/atomic-transition-sealed-file.mjs' \"\$receipt_tmp\" \"\$receipt\" \"\$receipt_sha\" 400; fi; node '$REMOTE_FRONT_DIR/scripts/atomic-transition-sealed-file.mjs' \"\$global_marker\" \"\$activated_marker\" \"\$marker_sha\" 400"
  echo "Prepared web deployment activated."
  exit 0
fi

node "$FRONT_DIR/scripts/compute-production-source-sha256.mjs" \
  "$FRONT_DIR" --list0 >"$FRONT_FILE_LIST"
test -s "$FRONT_FILE_LIST" || {
  echo "Canonical frontend archive file list is empty." >&2
  exit 1
}
(
  cd "$FRONT_DIR"
  COPYFILE_DISABLE=1 tar -czf "$FRONT_ARCHIVE" \
    --no-recursion --null -T "$FRONT_FILE_LIST"
)
mkdir "$FRONT_ARCHIVE_VERIFY_DIR"
(umask 022; tar -xzf "$FRONT_ARCHIVE" -C "$FRONT_ARCHIVE_VERIFY_DIR")
ARCHIVED_FRONT_SOURCE_SHA256=$(node \
  "$FRONT_DIR/scripts/compute-production-source-sha256.mjs" \
  "$FRONT_ARCHIVE_VERIFY_DIR")
if [ "$ARCHIVED_FRONT_SOURCE_SHA256" != "$EXPECTED_FRONT_SOURCE_SHA256" ]; then
  echo "Canonical frontend archive does not match the locally gated source." >&2
  exit 1
fi

node "$FRONT_DIR/scripts/compute-production-source-sha256.mjs" \
  "$ONTOLOGY_SOURCE_DIR" --list0 >"$ONTOLOGY_FILE_LIST"
test -s "$ONTOLOGY_FILE_LIST" || {
  echo "Canonical ontology archive file list is empty." >&2
  exit 1
}
(
  cd "$ONTOLOGY_SOURCE_DIR"
  COPYFILE_DISABLE=1 tar -czf "$ONTOLOGY_ARCHIVE" \
    --no-recursion --null -T "$ONTOLOGY_FILE_LIST"
)
mkdir "$ONTOLOGY_ARCHIVE_VERIFY_DIR"
(umask 022; tar -xzf "$ONTOLOGY_ARCHIVE" -C "$ONTOLOGY_ARCHIVE_VERIFY_DIR")
ARCHIVED_ONTOLOGY_SOURCE_SHA256=$(node \
  "$FRONT_DIR/scripts/compute-production-source-sha256.mjs" \
  "$ONTOLOGY_ARCHIVE_VERIFY_DIR")
if [ "$ARCHIVED_ONTOLOGY_SOURCE_SHA256" != "$EXPECTED_ONTOLOGY_SOURCE_SHA256" ]; then
  echo "Canonical ontology archive does not match the locally gated source." >&2
  exit 1
fi
chmod 600 "$FRONT_ARCHIVE" "$ONTOLOGY_ARCHIVE"

echo "Front archive: $(du -h "$FRONT_ARCHIVE" | awk '{print $1}')"
echo "Ontology archive: $(du -h "$ONTOLOGY_ARCHIVE" | awk '{print $1}')"

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would upload source, prebuild/verify the VM image, and write a prepared-release marker without restarting containers."
  echo "Dry run complete. No files were uploaded and Docker Compose was not executed."
  exit 0
fi

if ! gcloud_scp_with_retry \
  "frontend source archive" \
  "$FRONT_ARCHIVE" \
  "$GCP_INSTANCE:$REMOTE_FRONT_ARCHIVE"; then
  exit 1
fi
if ! gcloud_scp_with_retry \
  "ontology source archive" \
  "$ONTOLOGY_ARCHIVE" \
  "$GCP_INSTANCE:$REMOTE_ONTOLOGY_ARCHIVE"; then
  gcloud compute ssh "$GCP_INSTANCE" \
    --project="$GCP_PROJECT" \
    --zone="$GCP_ZONE" \
    --command="rm -f '$REMOTE_FRONT_ARCHIVE' '$REMOTE_ONTOLOGY_ARCHIVE'" \
    >/dev/null 2>&1 || true
  exit 1
fi
if [ "$DEPLOY_MODE" = "prepare-only" ]; then
  if ! gcloud compute ssh "$GCP_INSTANCE" \
    --project="$GCP_PROJECT" \
    --zone="$GCP_ZONE" \
    --command="set -eu; umask 077; mkdir -p '$REMOTE_FRONT_DIR/.deploy'; test ! -e '$REMOTE_RUNTIME_ENV_DIR'; mkdir '$REMOTE_RUNTIME_ENV_DIR'; chmod 700 '$REMOTE_RUNTIME_ENV_DIR'"; then
    gcloud compute ssh "$GCP_INSTANCE" \
      --project="$GCP_PROJECT" \
      --zone="$GCP_ZONE" \
      --command="rm -f '$REMOTE_FRONT_ARCHIVE' '$REMOTE_ONTOLOGY_ARCHIVE'" \
      >/dev/null 2>&1 || true
    exit 1
  fi
  if ! gcloud_scp_with_retry \
    "runtime environment" \
    "$LOCAL_RUNTIME_ENV" \
    "$GCP_INSTANCE:$REMOTE_RUNTIME_ENV"; then
    gcloud compute ssh "$GCP_INSTANCE" \
      --project="$GCP_PROJECT" \
      --zone="$GCP_ZONE" \
      --command="rm -rf '$REMOTE_RUNTIME_ENV_DIR'; rm -f '$REMOTE_FRONT_ARCHIVE' '$REMOTE_ONTOLOGY_ARCHIVE'" \
      >/dev/null 2>&1 || true
    exit 1
  fi
fi

REMOTE_COMMAND=$(cat <<EOF
set -eu
umask 022
REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR'
REMOTE_ONTOLOGY_DIR='$REMOTE_ONTOLOGY_DIR'
FRONT_ARCHIVE='$REMOTE_FRONT_ARCHIVE'
ONTOLOGY_ARCHIVE='$REMOTE_ONTOLOGY_ARCHIVE'
RUNTIME_ENV_SOURCE='$REMOTE_RUNTIME_ENV'
RUNTIME_ENV_INCOMING_DIR='$REMOTE_RUNTIME_ENV_DIR'
EXPECTED_ADMIN_EMAILS_SHA256='$EXPECTED_ADMIN_EMAILS_SHA256'
EXPECTED_PRODUCTION_ENV_SHA256='$EXPECTED_PRODUCTION_ENV_SHA256'
GCP_BOOTSTRAP_ATTESTATION='$GCP_BOOTSTRAP_ATTESTATION'
ORCHESTRATOR_ATTESTATION='$APP_VERSION:$PRODUCTION_DEPLOY_LOCK_OWNER'

command -v tar >/dev/null
command -v rsync >/dev/null
command -v docker >/dev/null
command -v node >/dev/null
test -d "\$REMOTE_ONTOLOGY_DIR" && [ ! -L "\$REMOTE_ONTOLOGY_DIR" ] || {
  echo "Remote ontology compatibility path must be a regular directory." >&2
  exit 1
}

FRONT_STAGE=\$(mktemp -d /tmp/krw-front-sync.XXXXXX)
ONTOLOGY_STAGE=\$(mktemp -d /tmp/krw-ontology-sync.XXXXXX)
ROLLBACK_CADDY_STAGE=
ROLLBACK_SOURCE_LIST=
CREATED_ROLLBACK_DIR=
CREATED_RELEASE_DIR=
PREPARE_SUCCEEDED=0
cleanup() {
  if [ "\$PREPARE_SUCCEEDED" != 1 ]; then
    [ -z "\$CREATED_RELEASE_DIR" ] || rm -rf "\$CREATED_RELEASE_DIR"
    [ -z "\$CREATED_ROLLBACK_DIR" ] || rm -rf "\$CREATED_ROLLBACK_DIR"
  fi
  rm -rf "\$FRONT_STAGE" "\$ONTOLOGY_STAGE" "\$FRONT_ARCHIVE" \
    "\$ONTOLOGY_ARCHIVE" "\$RUNTIME_ENV_INCOMING_DIR"
  [ -z "\$ROLLBACK_CADDY_STAGE" ] || rm -rf "\$ROLLBACK_CADDY_STAGE"
  [ -z "\$ROLLBACK_SOURCE_LIST" ] || rm -f "\$ROLLBACK_SOURCE_LIST"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "\$REMOTE_FRONT_DIR"
for uploaded_archive in "\$FRONT_ARCHIVE" "\$ONTOLOGY_ARCHIVE"; do
  test -f "\$uploaded_archive" && [ ! -L "\$uploaded_archive" ] || {
    echo "Uploaded source archives must be regular non-symlink files." >&2
    exit 1
  }
  chmod 400 "\$uploaded_archive"
done
tar --warning=no-unknown-keyword -xzf "\$FRONT_ARCHIVE" -C "\$FRONT_STAGE"
tar --warning=no-unknown-keyword -xzf "\$ONTOLOGY_ARCHIVE" -C "\$ONTOLOGY_STAGE"
if [ '$DEPLOY_MODE' = 'prepare-only' ]; then
  test -f "\$RUNTIME_ENV_SOURCE" && [ ! -L "\$RUNTIME_ENV_SOURCE" ] || {
    echo "Uploaded production runtime environment must be a regular non-symlink file." >&2
    exit 1
  }
  chmod 400 "\$RUNTIME_ENV_SOURCE"
  test "\$(sha256sum "\$RUNTIME_ENV_SOURCE" | awk '{print \$1}')" = "\$EXPECTED_PRODUCTION_ENV_SHA256" || {
    echo "Uploaded production runtime environment does not match the orchestrator seal." >&2
    exit 1
  }
  node "\$FRONT_STAGE/scripts/verify-supabase-production-target.mjs" \
    "\$RUNTIME_ENV_SOURCE" - \
    "\$FRONT_STAGE/ops/production-target.json" --require-origins
  PREFLIGHT_ADMIN_EMAILS_SHA256=\$(node \
    "\$FRONT_STAGE/scripts/compute-admin-email-set-sha256.mjs" \
    "\$RUNTIME_ENV_SOURCE")
  test "\$PREFLIGHT_ADMIN_EMAILS_SHA256" = "\$EXPECTED_ADMIN_EMAILS_SHA256" || {
    echo "Uploaded production runtime ADMIN_EMAILS identity differs from the orchestrator seal." >&2
    exit 1
  }
  rm -rf "\$FRONT_STAGE/krw-ontology"
  ln -s "\$ONTOLOGY_STAGE" "\$FRONT_STAGE/krw-ontology"
  PREFLIGHT_FRONT_SOURCE_SHA256=\$(node \
    "\$FRONT_STAGE/scripts/compute-production-source-sha256.mjs" \
    "\$FRONT_STAGE")
  test "\$PREFLIGHT_FRONT_SOURCE_SHA256" = '$EXPECTED_FRONT_SOURCE_SHA256' || {
    echo "Staged remote frontend source does not match the locally gated source." >&2
    exit 1
  }
  PREFLIGHT_ONTOLOGY_SOURCE_SHA256=\$(node \
    "\$FRONT_STAGE/scripts/compute-production-source-sha256.mjs" \
    "\$ONTOLOGY_STAGE")
  test "\$PREFLIGHT_ONTOLOGY_SOURCE_SHA256" = '$EXPECTED_ONTOLOGY_SOURCE_SHA256' || {
    echo "Staged ontology source does not match the locally gated source." >&2
    exit 1
  }
  if [ -e "\$REMOTE_FRONT_DIR/.deploy/prepared-web-release.env" ]; then
    echo "A prepared web marker already exists; resolve it before preparing another deployment." >&2
    exit 1
  fi
fi

# Save the exact pre-cutover runtime without mutating the live source tree.
# The resolved Compose file contains secrets and is intentionally mode 600.
if [ '$DEPLOY_MODE' = 'prepare-only' ]; then
  ROLLBACK_DIR="\$REMOTE_FRONT_DIR/.deploy/code-rollback-$APP_VERSION"
  RELEASE_DIR="\$REMOTE_FRONT_DIR/.deploy/releases/$APP_VERSION"
  if [ -e "\$ROLLBACK_DIR" ]; then
    echo "Refusing to overwrite the deployment rollback snapshot: \$ROLLBACK_DIR" >&2
    exit 1
  fi
  if [ -e "\$RELEASE_DIR" ]; then
    echo "Refusing to overwrite the durable deployment registry entry: \$RELEASE_DIR" >&2
    exit 1
  fi
  test -f "\$REMOTE_FRONT_DIR/docker-compose.yml"
  test -f "\$REMOTE_FRONT_DIR/Caddyfile" && [ ! -L "\$REMOTE_FRONT_DIR/Caddyfile" ] || {
    echo "Live production Caddyfile must be a regular non-symlink file." >&2
    exit 1
  }
  test -f "\$REMOTE_FRONT_DIR/.env"
  mkdir "\$ROLLBACK_DIR"
  CREATED_ROLLBACK_DIR="\$ROLLBACK_DIR"
  mkdir "\$RELEASE_DIR"
  CREATED_RELEASE_DIR="\$RELEASE_DIR"
  chmod 700 "\$ROLLBACK_DIR"
  chmod 700 "\$RELEASE_DIR"
  RELEASE_ENV_TMP="\$RELEASE_DIR/runtime.env.tmp.\$\$"
  cp "\$RUNTIME_ENV_SOURCE" "\$RELEASE_ENV_TMP"
  chmod 400 "\$RELEASE_ENV_TMP"
  test "\$(sha256sum "\$RELEASE_ENV_TMP" | awk '{print \$1}')" = "\$EXPECTED_PRODUCTION_ENV_SHA256" || {
    echo "Staged release runtime environment failed its orchestrator seal." >&2
    exit 1
  }
  mv "\$RELEASE_ENV_TMP" "\$RELEASE_DIR/runtime.env"
  RUNTIME_ENV_SHA256=\$(sha256sum "\$RELEASE_DIR/runtime.env" | awk '{print \$1}')
  cp "\$FRONT_ARCHIVE" "\$RELEASE_DIR/front-source.tar.gz"
  chmod 400 "\$RELEASE_DIR/front-source.tar.gz"
  # Keep transient runtime inspection data outside the canonical frontend
  # stage. The stage is re-hashed below and must remain byte-for-byte
  # identical to the locally gated archive.
  RUNNING_PROJECT_CONTAINERS="\$RUNTIME_ENV_INCOMING_DIR/running-project-containers.tsv"
  docker ps \
    --filter 'label=com.docker.compose.project=$CANONICAL_COMPOSE_PROJECT' \
    --filter status=running \
    --format '{{.ID}}\t{{.Label "com.docker.compose.service"}}\t{{.Names}}' \
    >"\$RUNNING_PROJECT_CONTAINERS"
  TAB=\$(printf '\t')
  while IFS="\$TAB" read -r running_id running_service running_name; do
    [ -n "\$running_id" ] || continue
    [ -n "\$running_service" ] || {
      echo "Running production Compose container has no service label: \$running_name" >&2
      exit 1
    }
    if ! printf '%s\n' $ROLLBACK_TRACKED_SERVICES \
      | grep -Fx "\$running_service" >/dev/null; then
      echo "Unknown running production Compose service: \$running_service (\$running_name)" >&2
      exit 1
    fi
    running_count=\$(awk -F '\t' -v wanted="\$running_service" '\$2 == wanted { count += 1 } END { print count + 0 }' "\$RUNNING_PROJECT_CONTAINERS")
    [ "\$running_count" = 1 ] || {
      echo "Scaled/duplicate production Compose service is outside the rollback contract: \$running_service" >&2
      exit 1
    }
  done <"\$RUNNING_PROJECT_CONTAINERS"
  OLD_WEB_CONTAINER=\$(docker compose \
    --project-name '$CANONICAL_COMPOSE_PROJECT' \
    --env-file "\$REMOTE_FRONT_DIR/.env" \
    -f "\$REMOTE_FRONT_DIR/docker-compose.yml" ps -q web)
  [ -n "\$OLD_WEB_CONTAINER" ] || {
    echo "Cannot establish rollback provenance without a running web container." >&2
    exit 1
  }
  OLD_CADDY_CONTAINER=\$(docker compose \
    --project-name '$CANONICAL_COMPOSE_PROJECT' \
    --env-file "\$REMOTE_FRONT_DIR/.env" \
    -f "\$REMOTE_FRONT_DIR/docker-compose.yml" ps -q reverse-proxy)
  [ -n "\$OLD_CADDY_CONTAINER" ] \
    && [ "\$(docker inspect --format '{{.State.Running}}' "\$OLD_CADDY_CONTAINER")" = true ] || {
    echo "Cannot establish rollback provenance without the running reverse proxy." >&2
    exit 1
  }
  docker inspect "\$OLD_CADDY_CONTAINER" | \
    EXPECTED_LIVE_CADDYFILE="\$REMOTE_FRONT_DIR/Caddyfile" node -e '
      const fs = require("fs");
      const payload = JSON.parse(fs.readFileSync(0, "utf8"));
      if (!Array.isArray(payload) || payload.length !== 1) process.exit(1);
      const expected = fs.realpathSync(process.env.EXPECTED_LIVE_CADDYFILE);
      const mounts = (payload[0].Mounts || []).filter((mount) => mount.Destination === "/etc/caddy/Caddyfile");
      if (mounts.length !== 1 || mounts[0].Type !== "bind" || mounts[0].RW !== false ||
          fs.realpathSync(mounts[0].Source) !== expected) process.exit(1);
    ' || {
      echo "Reverse proxy must bind the exact live Caddyfile read-only at /etc/caddy/Caddyfile." >&2
      exit 1
    }
  OLD_APP_VERSION=\$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "\$OLD_WEB_CONTAINER" \
    | sed -n 's/^NEXT_PUBLIC_APP_VERSION=//p' | tail -1)
  printf '%s' "\${OLD_APP_VERSION:-}" | grep -Eq '^[A-Za-z0-9._-]+\$' || {
    echo "Running web container is missing a valid deployment identity." >&2
    exit 1
  }
  : >"\$ROLLBACK_DIR/services.tsv"
  OLD_WEB_IMAGE_ID=
  OLD_CADDY_IMAGE_ID=
  for service in $ROLLBACK_TRACKED_SERVICES; do
    container_id=\$(docker compose \
      --project-name '$CANONICAL_COMPOSE_PROJECT' \
      --env-file "\$REMOTE_FRONT_DIR/.env" \
      -f "\$REMOTE_FRONT_DIR/docker-compose.yml" ps -q "\$service")
    running=false
    image_id=absent
    if [ -n "\$container_id" ]; then
      running=\$(docker inspect --format '{{.State.Running}}' "\$container_id")
      image_id=\$(docker inspect --format '{{.Image}}' "\$container_id")
    fi
    printf '%s\t%s\t%s\n' "\$service" "\$running" "\$image_id" >>"\$ROLLBACK_DIR/services.tsv"
    [ "\$service" != web ] || OLD_WEB_IMAGE_ID=\$image_id
    [ "\$service" != reverse-proxy ] || OLD_CADDY_IMAGE_ID=\$image_id
  done
  PREVIOUS_RELEASE_DIR="\$REMOTE_FRONT_DIR/.deploy/releases/\$OLD_APP_VERSION"
  ROLLBACK_PROVENANCE=
  ROLLBACK_FRONT_SOURCE_SHA256=
  if [ -f "\$PREVIOUS_RELEASE_DIR/activated-web-release.env" ] \
    && [ -f "\$PREVIOUS_RELEASE_DIR/candidate-compose.resolved.yml" ] \
    && [ -f "\$PREVIOUS_RELEASE_DIR/front-source.tar.gz" ] \
    && [ -f "\$PREVIOUS_RELEASE_DIR/runtime.env" ] \
    && [ -f "\$PREVIOUS_RELEASE_DIR/release-manifest.env" ]; then
    test "\$(sed -n 's/^APP_VERSION=//p' "\$PREVIOUS_RELEASE_DIR/activated-web-release.env" | head -1)" = "\$OLD_APP_VERSION"
    expected_previous_compose_sha=\$(sed -n 's/^RESOLVED_COMPOSE_SHA256=//p' "\$PREVIOUS_RELEASE_DIR/activated-web-release.env" | head -1)
    expected_previous_archive_sha=\$(sed -n 's/^FRONT_ARCHIVE_SHA256=//p' "\$PREVIOUS_RELEASE_DIR/release-manifest.env" | head -1)
    expected_previous_env_sha=\$(sed -n 's/^RUNTIME_ENV_SHA256=//p' "\$PREVIOUS_RELEASE_DIR/release-manifest.env" | head -1)
    ROLLBACK_FRONT_SOURCE_SHA256=\$(sed -n 's/^FRONT_SOURCE_SHA256=//p' "\$PREVIOUS_RELEASE_DIR/release-manifest.env" | head -1)
    printf '%s' "\$ROLLBACK_FRONT_SOURCE_SHA256" | grep -Eq '^[a-f0-9]{64}\$'
    test "\$(sha256sum "\$PREVIOUS_RELEASE_DIR/candidate-compose.resolved.yml" | awk '{print \$1}')" = "\$expected_previous_compose_sha"
    test "\$(sha256sum "\$PREVIOUS_RELEASE_DIR/front-source.tar.gz" | awk '{print \$1}')" = "\$expected_previous_archive_sha"
    test "\$(sha256sum "\$PREVIOUS_RELEASE_DIR/runtime.env" | awk '{print \$1}')" = "\$expected_previous_env_sha"
    cp "\$PREVIOUS_RELEASE_DIR/candidate-compose.resolved.yml" "\$ROLLBACK_DIR/compose.resolved.yml"
    cp "\$PREVIOUS_RELEASE_DIR/front-source.tar.gz" "\$ROLLBACK_DIR/front-source.tar.gz"
    cp "\$PREVIOUS_RELEASE_DIR/runtime.env" "\$ROLLBACK_DIR/runtime.env"
    test "\$(node "\$FRONT_STAGE/scripts/compute-production-source-sha256.mjs" "\$REMOTE_FRONT_DIR")" = "\$ROLLBACK_FRONT_SOURCE_SHA256" || {
      echo "Live frontend source differs from the activated rollback registry." >&2
      exit 1
    }
    ROLLBACK_PROVENANCE=release-registry
  elif [ ! -e "\$PREVIOUS_RELEASE_DIR" ]; then
    [ "\$GCP_BOOTSTRAP_ATTESTATION" = "\$ORCHESTRATOR_ATTESTATION" ] || {
      echo "Registryless GCP runtime capture requires an explicit bootstrap attestation." >&2
      exit 1
    }
    # One-time bootstrap is allowed only when the currently rendered config
    # hash exactly equals every running Compose container's recorded hash.
    cp "\$REMOTE_FRONT_DIR/.env" "\$ROLLBACK_DIR/runtime.env"
    FRONT_DIR="\$REMOTE_FRONT_DIR" \
    NEXT_PUBLIC_APP_VERSION="\$OLD_APP_VERSION" \
    KRW_ONTOLOGY_SOURCE_DIR="\$REMOTE_ONTOLOGY_DIR" \
    BILLING_WORKER_REQUIRE_TOSS_PAYMENTS=0 \
      docker compose --project-name '$CANONICAL_COMPOSE_PROJECT' \
        --env-file "\$ROLLBACK_DIR/runtime.env" \
        -f "\$REMOTE_FRONT_DIR/docker-compose.yml" config \
        >"\$ROLLBACK_DIR/compose.resolved.yml"
    ROLLBACK_FRONT_SOURCE_SHA256=\$(node \
      "\$FRONT_STAGE/scripts/compute-production-source-sha256.mjs" \
      "\$REMOTE_FRONT_DIR")
    ROLLBACK_SOURCE_LIST=\$(mktemp /tmp/krw-rollback-source.XXXXXX)
    node "\$FRONT_STAGE/scripts/compute-production-source-sha256.mjs" \
      "\$REMOTE_FRONT_DIR" --list0 >"\$ROLLBACK_SOURCE_LIST"
    test -s "\$ROLLBACK_SOURCE_LIST"
    (
      cd "\$REMOTE_FRONT_DIR"
      tar -czf "\$ROLLBACK_DIR/front-source.tar.gz" \
        --no-recursion --null -T "\$ROLLBACK_SOURCE_LIST"
    )
    test "\$(node "\$FRONT_STAGE/scripts/compute-production-source-sha256.mjs" "\$REMOTE_FRONT_DIR")" = "\$ROLLBACK_FRONT_SOURCE_SHA256" || {
      echo "Live frontend source changed while the bootstrap rollback archive was captured." >&2
      exit 1
    }
    rm -f "\$ROLLBACK_SOURCE_LIST"
    ROLLBACK_SOURCE_LIST=
    ROLLBACK_PROVENANCE=bootstrap
  else
    echo "Previous GCP release registry is incomplete; refusing implicit bootstrap." >&2
    exit 1
  fi

  ROLLBACK_CADDY_STAGE=\$(mktemp -d /tmp/krw-caddy-rollback.XXXXXX)
  tar --warning=no-unknown-keyword -xzf "\$ROLLBACK_DIR/front-source.tar.gz" \
    -C "\$ROLLBACK_CADDY_STAGE"
  ARCHIVED_ROLLBACK_FRONT_SOURCE_SHA256=\$(node \
    "\$FRONT_STAGE/scripts/compute-production-source-sha256.mjs" \
    "\$ROLLBACK_CADDY_STAGE")
  test "\$ARCHIVED_ROLLBACK_FRONT_SOURCE_SHA256" = "\$ROLLBACK_FRONT_SOURCE_SHA256" || {
    echo "Rollback archive does not match the canonical previous frontend source." >&2
    exit 1
  }
  ARCHIVED_CADDYFILE="\$ROLLBACK_CADDY_STAGE/Caddyfile"
  test -f "\$ARCHIVED_CADDYFILE" && [ ! -L "\$ARCHIVED_CADDYFILE" ] || {
    echo "Archived rollback Caddyfile must be a regular non-symlink file." >&2
    exit 1
  }
  cmp -s "\$ARCHIVED_CADDYFILE" "\$REMOTE_FRONT_DIR/Caddyfile" || {
    echo "Archived rollback Caddyfile differs from the exact live bind source." >&2
    exit 1
  }
  [ -n "\$OLD_CADDY_IMAGE_ID" ] && [ "\$OLD_CADDY_IMAGE_ID" != absent ] || {
    echo "Running reverse proxy is missing a rollback image identity." >&2
    exit 1
  }
  docker run --rm --network none --read-only \
    --tmpfs /tmp:rw,noexec,nosuid,size=16m \
    --tmpfs /data:rw,noexec,nosuid,size=16m \
    --tmpfs /config:rw,noexec,nosuid,size=16m \
    --mount "type=bind,src=\$ARCHIVED_CADDYFILE,dst=/etc/caddy/Caddyfile,readonly" \
    --entrypoint caddy "\$OLD_CADDY_IMAGE_ID" \
    adapt --config /etc/caddy/Caddyfile --adapter caddyfile --validate >/dev/null
  CADDYFILE_SHA256=\$(sha256sum "\$ARCHIVED_CADDYFILE" | awk '{print \$1}')

  cp "\$FRONT_STAGE/scripts/verify-supabase-production-target.mjs" \
    "\$ROLLBACK_DIR/verify-supabase-production-target.mjs"
  cp "\$FRONT_STAGE/scripts/atomic-install-sealed-file.mjs" \
    "\$ROLLBACK_DIR/atomic-install-sealed-file.mjs"
  cp "\$FRONT_STAGE/ops/production-target.json" \
    "\$ROLLBACK_DIR/production-target.json"

  for service in $ROLLBACK_TRACKED_SERVICES; do
    container_id=\$(docker compose --project-name '$CANONICAL_COMPOSE_PROJECT' \
      --env-file "\$REMOTE_FRONT_DIR/.env" -f "\$REMOTE_FRONT_DIR/docker-compose.yml" ps -q "\$service")
    [ -n "\$container_id" ] || continue
    actual_config_hash=\$(docker inspect --format '{{index .Config.Labels "com.docker.compose.config-hash"}}' "\$container_id")
    expected_config_hash=\$(docker compose --project-name '$CANONICAL_COMPOSE_PROJECT' \
      -f "\$ROLLBACK_DIR/compose.resolved.yml" config --hash "\$service" \
      | awk -v wanted="\$service" '\$1 == wanted { print \$2 }')
    if [ -z "\$actual_config_hash" ] || [ "\$actual_config_hash" != "\$expected_config_hash" ]; then
      echo "Running container config is not reproducible from rollback provenance: \$service" >&2
      exit 1
    fi
  done

  if [ -n "\$OLD_WEB_IMAGE_ID" ] && [ "\$OLD_WEB_IMAGE_ID" != absent ]; then
    docker image tag "\$OLD_WEB_IMAGE_ID" 'krw-ontology-front-web:rollback-$APP_VERSION'
  fi
  if [ -n "\$OLD_CADDY_IMAGE_ID" ] && [ "\$OLD_CADDY_IMAGE_ID" != absent ]; then
    docker image tag "\$OLD_CADDY_IMAGE_ID" 'caddy:rollback-$APP_VERSION'
  fi
  printf '%s\n' \
    'FORMAT=krw-code-rollback/v2' \
    'CUTOVER_APP_VERSION=$APP_VERSION' \
    "PREVIOUS_APP_VERSION=\$OLD_APP_VERSION" \
    "PREVIOUS_WEB_IMAGE_ID=\$OLD_WEB_IMAGE_ID" \
    "PREVIOUS_CADDY_IMAGE_ID=\$OLD_CADDY_IMAGE_ID" \
    "ROLLBACK_PROVENANCE=\$ROLLBACK_PROVENANCE" \
    "RUNTIME_ENV_SHA256=\$(sha256sum "\$ROLLBACK_DIR/runtime.env" | awk '{print \$1}')" \
    "TARGET_VERIFIER_SHA256=\$(sha256sum "\$ROLLBACK_DIR/verify-supabase-production-target.mjs" | awk '{print \$1}')" \
    "ATOMIC_INSTALLER_SHA256=\$(sha256sum "\$ROLLBACK_DIR/atomic-install-sealed-file.mjs" | awk '{print \$1}')" \
    "PRODUCTION_TARGET_SHA256=\$(sha256sum "\$ROLLBACK_DIR/production-target.json" | awk '{print \$1}')" \
    "PREVIOUS_FRONT_SOURCE_SHA256=\$ROLLBACK_FRONT_SOURCE_SHA256" \
    "FRONT_ARCHIVE_SHA256=\$(sha256sum "\$ROLLBACK_DIR/front-source.tar.gz" | awk '{print \$1}')" \
    "RESOLVED_COMPOSE_SHA256=\$(sha256sum "\$ROLLBACK_DIR/compose.resolved.yml" | awk '{print \$1}')" \
    "SERVICE_STATE_SHA256=\$(sha256sum "\$ROLLBACK_DIR/services.tsv" | awk '{print \$1}')" \
    "CADDYFILE_SHA256=\$CADDYFILE_SHA256" \
    >"\$ROLLBACK_DIR/manifest.env"
  chmod 600 "\$ROLLBACK_DIR"/*
fi

CANDIDATE_FRONT_DIR="\$FRONT_STAGE"
rm -rf "\$CANDIDATE_FRONT_DIR/krw-ontology"
ln -s "\$ONTOLOGY_STAGE" "\$CANDIDATE_FRONT_DIR/krw-ontology"
chmod +x "\$CANDIDATE_FRONT_DIR/scripts/deploy-vm-compose.sh"
cd "\$CANDIDATE_FRONT_DIR"
if [ -e "\$REMOTE_FRONT_DIR/.deploy/prepared-web-release.env" ]; then
  echo "A prepared web marker already exists; resolve it before preparing another deployment." >&2
  exit 1
fi
node scripts/verify-supabase-production-target.mjs \
  "\$RELEASE_DIR/runtime.env" \
  - \
  ops/production-target.json \
  --require-origins
ACTUAL_ADMIN_EMAILS_SHA256=\$(node \
  scripts/compute-admin-email-set-sha256.mjs \
  "\$RELEASE_DIR/runtime.env")
test "\$ACTUAL_ADMIN_EMAILS_SHA256" = "\$EXPECTED_ADMIN_EMAILS_SHA256" || {
  echo "Remote web ADMIN_EMAILS set differs from the pinned entitlement set." >&2
  exit 1
}
ACTUAL_SUPABASE_PROJECT_REF=\$(node -e 'const target=require(process.argv[1]);process.stdout.write(target.supabaseProjectRef)' ./ops/production-target.json)
test "\$ACTUAL_SUPABASE_PROJECT_REF" = '$CANONICAL_SUPABASE_PROJECT_REF' || {
  echo "Remote canonical Supabase target does not match this deployment." >&2
  exit 1
}
REMOTE_FRONT_SOURCE_SHA256=\$(
  node scripts/compute-production-source-sha256.mjs "\$CANDIDATE_FRONT_DIR"
)
if [ "\$REMOTE_FRONT_SOURCE_SHA256" != '$EXPECTED_FRONT_SOURCE_SHA256' ]; then
  echo "Staged remote frontend source does not match the locally gated source." >&2
  echo "  expected: $EXPECTED_FRONT_SOURCE_SHA256" >&2
  echo "  remote:   \$REMOTE_FRONT_SOURCE_SHA256" >&2
  exit 1
fi
STAGED_ONTOLOGY_SOURCE_SHA256=\$(
  node scripts/compute-production-source-sha256.mjs "\$ONTOLOGY_STAGE"
)
if [ "\$STAGED_ONTOLOGY_SOURCE_SHA256" != '$EXPECTED_ONTOLOGY_SOURCE_SHA256' ]; then
  echo "Staged ontology source does not match the locally gated source." >&2
  echo "  expected: $EXPECTED_ONTOLOGY_SOURCE_SHA256" >&2
  echo "  staged:   \$STAGED_ONTOLOGY_SOURCE_SHA256" >&2
  exit 1
fi
if [ '$DEPLOY_MODE' = 'prepare-only' ]; then
  NEXT_PUBLIC_APP_VERSION='$APP_VERSION' \
  VM_DEPLOY_ATTESTATION='$APP_VERSION:$CANONICAL_COMPOSE_PROJECT' \
  KRW_ONTOLOGY_SOURCE_DIR="\$ONTOLOGY_STAGE" \
  EXPECTED_ONTOLOGY_SOURCE_SHA256='$EXPECTED_ONTOLOGY_SOURCE_SHA256' \
  ENV_FILE="\$RELEASE_DIR/runtime.env" \
  BILLING_WORKER_REQUIRE_TOSS_PAYMENTS=0 \
    scripts/deploy-vm-compose.sh --build-only $COMPOSE_SERVICES
  IMAGE_ID=\$(docker image inspect --format '{{.Id}}' krw-ontology-front-web:local)
  CADDY_IMAGE_ID=\$(docker image inspect --format '{{.Id}}' caddy:2)
  test -n "\$IMAGE_ID" && test "\${IMAGE_ID#sha256:}" != "\$IMAGE_ID" || {
    echo "Invalid built image id: \$IMAGE_ID" >&2
    exit 1
  }
  test -n "\$CADDY_IMAGE_ID" && test "\${CADDY_IMAGE_ID#sha256:}" != "\$CADDY_IMAGE_ID" || {
    echo "Invalid Caddy image id: \$CADDY_IMAGE_ID" >&2
    exit 1
  }
  DEPLOY_CONFIG_SHA256=\$(
    sha256sum docker-compose.yml Caddyfile scripts/deploy-vm-compose.sh \
      scripts/verify-supabase-production-target.mjs ops/production-target.json \
      "\$RELEASE_DIR/runtime.env" \
      | sha256sum \
      | awk '{print \$1}'
  )
  FRONT_DIR="\$REMOTE_FRONT_DIR" \
  NEXT_PUBLIC_APP_VERSION='$APP_VERSION' \
  KRW_ONTOLOGY_SOURCE_DIR="\$REMOTE_ONTOLOGY_DIR" \
  BILLING_WORKER_REQUIRE_TOSS_PAYMENTS=0 \
    docker compose --project-name '$CANONICAL_COMPOSE_PROJECT' \
      --project-directory "\$REMOTE_FRONT_DIR" \
      --env-file "\$RELEASE_DIR/runtime.env" \
      -f "\$CANDIDATE_FRONT_DIR/docker-compose.yml" config \
      >"\$RELEASE_DIR/candidate-compose.resolved.yml"
  chmod 400 "\$RELEASE_DIR/candidate-compose.resolved.yml"
  RESOLVED_COMPOSE_SHA256=\$(sha256sum "\$RELEASE_DIR/candidate-compose.resolved.yml" | awk '{print \$1}')
  mkdir -p "\$REMOTE_FRONT_DIR/.deploy"
  docker image tag "\$IMAGE_ID" 'krw-ontology-front-web:release-$APP_VERSION'
  docker image tag "\$CADDY_IMAGE_ID" 'caddy:release-$APP_VERSION'
  # Persist the exact canonical ontology archive that was hashed and verified
  # on the orchestrator and again after remote extraction. Re-archiving the
  # promoted checkout here would reintroduce host-specific ignore and race
  # semantics into the durable release registry.
  cp "\$ONTOLOGY_ARCHIVE" "\$RELEASE_DIR/ontology-source.tar.gz"
  chmod 400 "\$RELEASE_DIR/ontology-source.tar.gz"
  RELEASE_MANIFEST_TMP="\$RELEASE_DIR/release-manifest.env.next.\$\$"
  printf '%s\n' \
    'FORMAT=krw-production-release-registry/v1' \
    'APP_VERSION=$APP_VERSION' \
    "IMAGE_ID=\$IMAGE_ID" \
    "CADDY_IMAGE_ID=\$CADDY_IMAGE_ID" \
    'FRONT_SOURCE_SHA256=$EXPECTED_FRONT_SOURCE_SHA256' \
    'ONTOLOGY_SOURCE_SHA256=$EXPECTED_ONTOLOGY_SOURCE_SHA256' \
    "RUNTIME_ENV_SHA256=\$RUNTIME_ENV_SHA256" \
    "FRONT_ARCHIVE_SHA256=\$(sha256sum "\$RELEASE_DIR/front-source.tar.gz" | awk '{print \$1}')" \
    "ONTOLOGY_ARCHIVE_SHA256=\$(sha256sum "\$RELEASE_DIR/ontology-source.tar.gz" | awk '{print \$1}')" \
    "CANDIDATE_COMPOSE_SHA256=\$RESOLVED_COMPOSE_SHA256" \
    "ROLLBACK_MANIFEST_SHA256=\$(sha256sum "\$REMOTE_FRONT_DIR/.deploy/code-rollback-$APP_VERSION/manifest.env" | awk '{print \$1}')" \
    >"\$RELEASE_MANIFEST_TMP"
  chmod 400 "\$RELEASE_MANIFEST_TMP"
  RELEASE_MANIFEST_SHA256=\$(sha256sum "\$RELEASE_MANIFEST_TMP" | awk '{print \$1}')
  node scripts/atomic-transition-sealed-file.mjs \
    "\$RELEASE_MANIFEST_TMP" "\$RELEASE_DIR/release-manifest.env" \
    "\$RELEASE_MANIFEST_SHA256" 400

  RELEASE_MARKER_TMP="\$RELEASE_DIR/prepared-web-release.env.next.\$\$"
  printf '%s\n' \
    'FORMAT=krw-prepared-web-release/v2' \
    'APP_VERSION=$APP_VERSION' \
    "IMAGE_ID=\$IMAGE_ID" \
    "CADDY_IMAGE_ID=\$CADDY_IMAGE_ID" \
    "DEPLOY_CONFIG_SHA256=\$DEPLOY_CONFIG_SHA256" \
    "RUNTIME_ENV_SHA256=\$RUNTIME_ENV_SHA256" \
    "RESOLVED_COMPOSE_SHA256=\$RESOLVED_COMPOSE_SHA256" \
    'FRONT_SOURCE_SHA256=$EXPECTED_FRONT_SOURCE_SHA256' \
    'ONTOLOGY_SOURCE_SHA256=$EXPECTED_ONTOLOGY_SOURCE_SHA256' \
    "RELEASE_MANIFEST_SHA256=\$RELEASE_MANIFEST_SHA256" \
    >"\$RELEASE_MARKER_TMP"
  chmod 400 "\$RELEASE_MARKER_TMP"
  RELEASE_MARKER_SHA256=\$(sha256sum "\$RELEASE_MARKER_TMP" | awk '{print \$1}')
  node scripts/atomic-transition-sealed-file.mjs \
    "\$RELEASE_MARKER_TMP" "\$RELEASE_DIR/prepared-web-release.env" \
    "\$RELEASE_MARKER_SHA256" 400

  test "\$(sha256sum "\$RELEASE_DIR/release-manifest.env" | awk '{print \$1}')" = "\$RELEASE_MANIFEST_SHA256"
  test "\$(sha256sum "\$RELEASE_DIR/front-source.tar.gz" | awk '{print \$1}')" = "\$(sed -n 's/^FRONT_ARCHIVE_SHA256=//p' "\$RELEASE_DIR/release-manifest.env")"
  test "\$(sha256sum "\$RELEASE_DIR/ontology-source.tar.gz" | awk '{print \$1}')" = "\$(sed -n 's/^ONTOLOGY_ARCHIVE_SHA256=//p' "\$RELEASE_DIR/release-manifest.env")"
  test "\$(sha256sum "\$RELEASE_DIR/candidate-compose.resolved.yml" | awk '{print \$1}')" = "\$(sed -n 's/^CANDIDATE_COMPOSE_SHA256=//p' "\$RELEASE_DIR/release-manifest.env")"
  test "\$(sha256sum "\$RELEASE_DIR/runtime.env" | awk '{print \$1}')" = "\$(sed -n 's/^RUNTIME_ENV_SHA256=//p' "\$RELEASE_DIR/release-manifest.env")"
  test "\$(sha256sum "\$REMOTE_FRONT_DIR/.deploy/code-rollback-$APP_VERSION/manifest.env" | awk '{print \$1}')" = "\$(sed -n 's/^ROLLBACK_MANIFEST_SHA256=//p' "\$RELEASE_DIR/release-manifest.env")"
  test "\$(docker image inspect --format '{{.Id}}' 'krw-ontology-front-web:release-$APP_VERSION')" = "\$IMAGE_ID"
  test "\$(docker image inspect --format '{{.Id}}' 'caddy:release-$APP_VERSION')" = "\$CADDY_IMAGE_ID"

  PREPARE_SUCCEEDED=1
  echo "Prepared release-local web image registry: \$IMAGE_ID"
  exit 0
fi

# Only prepare-only reaches the remote executor; the lifecycle modes are
# handled by the orchestrator-side command earlier in this script. Fail
# loudly if a future mode ever falls through.
echo "Unexpected remote deploy mode: '$DEPLOY_MODE'" >&2
exit 1
EOF
)

if ! gcloud compute ssh "$GCP_INSTANCE" \
  --project="$GCP_PROJECT" \
  --zone="$GCP_ZONE" \
  --command="$REMOTE_COMMAND"; then
  gcloud compute ssh "$GCP_INSTANCE" \
    --project="$GCP_PROJECT" \
    --zone="$GCP_ZONE" \
    --command="rm -rf '$REMOTE_RUNTIME_ENV_DIR'; rm -f '$REMOTE_FRONT_ARCHIVE' '$REMOTE_ONTOLOGY_ARCHIVE'" \
    >/dev/null 2>&1 || true
  exit 1
fi

echo "Web image preparation complete. Production containers were not restarted."
exit 0
