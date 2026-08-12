#!/bin/sh
set -eu

# Open a previously closed Rust research release only after its local Mac
# daemon, GCP descriptor, and final evidence all prove they describe the same
# provider release. `--release-id` identifies the local Mac agent install;
# the active frontend deployment has its own independent deployment id. The
# complete Rust bundle and every credential remain on this Mac; GCP owns only
# the public descriptor and queue-facing web services.

usage() {
  cat <<'EOF'
Usage:
  scripts/open-krw-agent-production-admission.sh \
    --release-root /absolute/sealed-dual-release \
    --release-id MAC_AGENT_ID --provider glm|deepseek \
    --evidence-index /absolute/production-evidence-index.json

Optional environment:
  KRW_AGENT_LOCAL_INSTALL_ROOT  (default: ~/.local/share/krw-agent)
  KRW_AGENT_METRICS_PORT        (default: 15520)
EOF
}

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

require_file() {
  [ -f "$1" ] && [ ! -L "$1" ] || fail "Missing or unsafe file: $1"
}

valid_release_id() {
  case "$1" in
    ''|*[!A-Za-z0-9._-]*) return 1 ;;
    *) return 0 ;;
  esac
}

valid_metrics_port() {
  case "$1" in
    ''|*[!0-9]*) return 1 ;;
    *) [ "$1" -ge 1024 ] && [ "$1" -le 65535 ] ;;
  esac
}

RELEASE_ROOT=
RELEASE_ID=
PROVIDER=
EVIDENCE_INDEX=
METRICS_PORT=${KRW_AGENT_METRICS_PORT:-15520}
LOCAL_INSTALL_ROOT=${KRW_AGENT_LOCAL_INSTALL_ROOT:-"$HOME/.local/share/krw-agent"}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --release-root|--release-id|--provider|--evidence-index|--metrics-port)
      option=$1
      shift
      [ "$#" -gt 0 ] || fail "$option requires a value"
      case "$option" in
        --release-root) RELEASE_ROOT=$1 ;;
        --release-id) RELEASE_ID=$1 ;;
        --provider) PROVIDER=$1 ;;
        --evidence-index) EVIDENCE_INDEX=$1 ;;
        --metrics-port) METRICS_PORT=$1 ;;
      esac
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 2
      ;;
  esac
  shift
done

[ -n "$RELEASE_ROOT" ] || fail "--release-root is required"
[ -n "$RELEASE_ID" ] || fail "--release-id is required"
[ -n "$PROVIDER" ] || fail "--provider is required"
[ -n "$EVIDENCE_INDEX" ] || fail "--evidence-index is required"
case "$PROVIDER" in glm|deepseek) ;; *) fail "--provider must be glm or deepseek" ;; esac
valid_release_id "$RELEASE_ID" || fail "Invalid release id"
valid_metrics_port "$METRICS_PORT" || fail "Invalid metrics port"
case "$RELEASE_ROOT" in /*) ;; *) fail "--release-root must be absolute" ;; esac
case "$EVIDENCE_INDEX" in /*) ;; *) fail "--evidence-index must be absolute" ;; esac
case "$LOCAL_INSTALL_ROOT" in /*) ;; *) fail "KRW_AGENT_LOCAL_INSTALL_ROOT must be absolute" ;; esac

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
TARGET_FILE="$FRONT_DIR/ops/production-target.json"
require_command node
require_command python3
require_command shasum
require_command curl
require_command gcloud
require_file "$SCRIPT_DIR/verify-krw-agent-production-release.mjs"
require_file "$TARGET_FILE"
require_file "$EVIDENCE_INDEX"

target_value() {
  node -e 'const target=require(process.argv[1]); const value=target[process.argv[2]]; if(typeof value!=="string"||!value) process.exit(1); process.stdout.write(value);' "$TARGET_FILE" "$1"
}

FRONT_COMMIT=$(node -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(value.front_commit || "")) process.exit(1);
  process.stdout.write(value.front_commit);
' "$EVIDENCE_INDEX") || fail "Final evidence has no valid front commit"
RELEASE_REPORT=$(node "$SCRIPT_DIR/verify-krw-agent-production-release.mjs" \
  --release-root "$RELEASE_ROOT" \
  --provider "$PROVIDER" \
  --evidence-index "$EVIDENCE_INDEX" \
  --front-commit "$FRONT_COMMIT")
DESCRIPTOR_HASH=$(node -e 'const value=JSON.parse(process.argv[1]); if(!value.final_evidence_verified) process.exit(1); process.stdout.write(value.selected_descriptor_artifact_hash);' "$RELEASE_REPORT")
RELEASE_SET_HASH=$(node -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(value.selected_release_set_hash);' "$RELEASE_REPORT")

EXPECTED_LOCAL_BUNDLE="$LOCAL_INSTALL_ROOT/releases/$RELEASE_ID/$PROVIDER"
CURRENT_LOCAL_BUNDLE="$LOCAL_INSTALL_ROOT/current"
[ -d "$EXPECTED_LOCAL_BUNDLE" ] && [ ! -L "$EXPECTED_LOCAL_BUNDLE" ] || fail "Expected local sealed bundle is unavailable"
[ -L "$CURRENT_LOCAL_BUNDLE" ] || fail "Local krw-agent current symlink is unavailable"
CURRENT_RESOLVED=$(python3 - "$CURRENT_LOCAL_BUNDLE" <<'PY'
import pathlib
import sys
print(pathlib.Path(sys.argv[1]).resolve())
PY
)
EXPECTED_RESOLVED=$(python3 - "$EXPECTED_LOCAL_BUNDLE" <<'PY'
import pathlib
import sys
print(pathlib.Path(sys.argv[1]).resolve())
PY
)
[ "$CURRENT_RESOLVED" = "$EXPECTED_RESOLVED" ] || fail "Local current symlink does not point to the requested release"
LOCAL_DESCRIPTOR="$CURRENT_LOCAL_BUNDLE/public-release.json"
require_file "$LOCAL_DESCRIPTOR"
LOCAL_DESCRIPTOR_HASH="sha256:$(shasum -a 256 "$LOCAL_DESCRIPTOR" | awk '{print $1}')"
[ "$LOCAL_DESCRIPTOR_HASH" = "$DESCRIPTOR_HASH" ] || fail "Local public descriptor does not match the sealed release"
curl -fsS --connect-timeout 1 --max-time 3 "http://127.0.0.1:$METRICS_PORT/metrics" \
  | grep -q '^krw_active_runs' \
  || fail "Local krw-agentd metrics endpoint is not ready"

GCP_PROJECT=$(target_value gcpProject)
GCP_INSTANCE=$(target_value gcpInstance)
GCP_ZONE=$(target_value gcpZone)
GCP_INSTANCE_ID=$(target_value gcpInstanceId)
REMOTE_FRONT_DIR=$(target_value remoteFrontDir)
COMPOSE_PROJECT=$(target_value composeProject)
actual_instance_id=$(gcloud compute instances describe "$GCP_INSTANCE" --project="$GCP_PROJECT" --zone="$GCP_ZONE" --format='value(id)')
[ "$actual_instance_id" = "$GCP_INSTANCE_ID" ] || fail "GCP instance identity does not match ops/production-target.json"

cat <<'REMOTE_SCRIPT' | gcloud compute ssh "$GCP_INSTANCE" --project="$GCP_PROJECT" --zone="$GCP_ZONE" --command="RELEASE_ID='$RELEASE_ID' FRONT_COMMIT='$FRONT_COMMIT' REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR' COMPOSE_PROJECT='$COMPOSE_PROJECT' PROVIDER='$PROVIDER' DESCRIPTOR_HASH='$DESCRIPTOR_HASH' RELEASE_SET_HASH='$RELEASE_SET_HASH' /bin/sh -s"
set -eu

ACTIVE_ROOT=$(cd "$REMOTE_FRONT_DIR/.simple-deploy/current" && pwd -P)
ACTIVE_ENV="$ACTIVE_ROOT/runtime.env"
test -f "$ACTIVE_ENV"
test -f "$ACTIVE_ROOT/docker-compose.yml"

value_of() {
  key=$1
  awk -F= -v key="$key" '
    $0 !~ /^[[:space:]]*#/ && $1 == key {
      sub(/^[^=]*=/, "")
      gsub(/^[[:space:]]+|[[:space:]]+$/, "")
      gsub(/^"|"$/, "")
      gsub(/^'\''|'\''$/, "")
      print
    }
  ' "$ACTIVE_ENV" | tail -n 1
}
upsert_env_value() {
  env_file=$1
  env_key=$2
  env_value=$3
  temporary=$(mktemp "${env_file}.XXXXXX")
  awk -v key="$env_key" -v value="$env_value" '
    $0 !~ /^[[:space:]]*#/ && $0 ~ ("^" key "=") {
      if (!seen++) print key "=" value
      next
    }
    { print }
    END { if (!seen) print key "=" value }
  ' "$env_file" > "$temporary"
  chmod 600 "$temporary"
  mv "$temporary" "$env_file"
}
compose_active() {
  FRONT_DIR="$ACTIVE_ROOT" docker compose \
    --project-name "$COMPOSE_PROJECT" --project-directory "$ACTIVE_ROOT" \
    --env-file "$ACTIVE_ENV" -f "$ACTIVE_ROOT/docker-compose.yml" "$@"
}
verify_deep_admission() {
  expected_admission=$1
  compose_active exec -T web node -e '
    const expected=process.argv[1];
    const headers={"x-internal-key":process.env.INTERNAL_API_KEY||"","x-krw-client-ip":"127.0.0.1"};
    fetch("http://127.0.0.1:3000/api/healthz/deep", {headers})
      .then(async response => {
        const value = await response.json().catch(() => null);
        if (!response.ok || value?.status !== "ok" || value?.checks?.agent_v1?.admission !== expected) process.exit(1);
      })
      .catch(() => process.exit(1));
  ' "$expected_admission"
}

test "$(value_of KRW_AGENT_BACKEND_MODE)" = rust
test "$(value_of KRW_AGENT_PROVIDER)" = "$PROVIDER"
test "$(value_of KRW_AGENT_RELEASE_ARTIFACT_HASH)" = "$DESCRIPTOR_HASH"
test "$(value_of KRW_AGENT_RELEASE_SET_HASH)" = "$RELEASE_SET_HASH"
test "$(value_of KRW_AGENT_FRONT_COMMIT)" = "$FRONT_COMMIT"
test "$(value_of KRW_AGENT_ADMISSION_MODE)" = closed
descriptor_path="$ACTIVE_ROOT/agent-release/public-release.json"
test -f "$descriptor_path"
test "sha256:$(sha256sum "$descriptor_path" | awk '{print $1}')" = "$DESCRIPTOR_HASH"

changed=0
restore_closed() {
  status=$?
  if [ "$changed" = "1" ]; then
    set +e
    upsert_env_value "$ACTIVE_ENV" KRW_AGENT_ADMISSION_MODE closed
    compose_active up -d --no-deps --force-recreate --wait web agent-v1-outbox
  fi
  exit "$status"
}
trap restore_closed EXIT INT TERM
# Check the Mac daemon heartbeat and current descriptor pins before changing
# admission. The first check uses the still-closed web process deliberately.
verify_deep_admission closed
upsert_env_value "$ACTIVE_ENV" KRW_AGENT_ADMISSION_MODE open
changed=1
compose_active up -d --no-deps --force-recreate --wait web agent-v1-outbox
verify_deep_admission open
changed=0
trap - EXIT INT TERM
echo "Research admission opened for the verified local Mac release."
REMOTE_SCRIPT
