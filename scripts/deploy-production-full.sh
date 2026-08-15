#!/usr/bin/env bash
set -euo pipefail

# The normal full path owns the complete agent release lifecycle: a clean
# committed source tree is built into a new sealed GLM+DeepSeek release and
# that exact release is passed to the existing transactional deployer.

if [[ "${SIMPLE_PRODUCTION_LOCK_HELD:-0}" != "1" ]]; then
  early_script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
  early_front_dir=$(CDPATH= cd -- "$early_script_dir/.." && pwd -P)
  mkdir -p "$early_front_dir/.deploy"
  command -v lockf >/dev/null 2>&1 || {
    printf '%s\n' "Missing required macOS lockf command." >&2
    exit 1
  }
  exec env SIMPLE_PRODUCTION_LOCK_HELD=1 PRODUCTION_OS_LOCK_HELD=1 \
    lockf -t 0 -k "$early_front_dir/.deploy/production-deploy.os-lock" \
      /usr/bin/env bash "$0" "$@"
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
front_dir=$(CDPATH= cd -- "$script_dir/.." && pwd -P)
agent_source_root=${KRW_AGENT_SOURCE_ROOT:-"$HOME/krw-agnet"}
agent_operator_root=${KRW_AGENT_OPERATOR_ROOT:-"$HOME/krw-agnet-prod"}
agent_runtime_env_source=${KRW_AGENT_RUNTIME_ENV_FILE:-"$agent_operator_root/runtime/krw-agent-deploy.env"}
agent_runtime_env_candidate=
agent_runtime_env_backup=
agent_runtime_env_activated=0
release_id=
agent_mcp_origin=
agent_endpoint_registry=
forward_args=()
has_forward_args=0

usage() {
  cat <<'EOF'
Usage: npm run prod:deploy:full -- [deploy-production-fast options]

Builds a new sealed GLM+DeepSeek Rust release from KRW_AGENT_SOURCE_ROOT
(default: ~/krw-agnet), then deploys that exact release. The selected runtime
provider remains DeepSeek unless --agent-provider glm is supplied.

Use npm run prod:deploy:safe -- --agent-release-root DIR for a prebuilt
rollback/recovery release. Automatic fresh-release deployment does not accept
--agent-release-root or --dry-run.
EOF
}

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

reconcile_current_local_mcp_gateway_contract() {
  local reconciler="$script_dir/reconcile-local-mcp-gateway-contract.mjs"
  [[ -f "$reconciler" && ! -L "$reconciler" ]] \
    || fail "Local MCP gateway reconciler is missing or unsafe: $reconciler"
  node "$reconciler" \
    --mode repair \
    --restart \
    --operator-root "$agent_operator_root"
}

cleanup_runtime_env_update() {
  local exit_status=$?
  set +e

  # A candidate becomes the persistent launchd env only after its exact Feed
  # bearer request succeeds.  Any later build/deploy failure restores the
  # original file before this process exits, so a standalone daemon restart
  # can never point at the deleted temporary overlay used by the old path.
  if [[ "$agent_runtime_env_activated" = "1" && "$exit_status" -ne 0 && -n "$agent_runtime_env_backup" && -f "$agent_runtime_env_backup" ]]; then
    if mv -f -- "$agent_runtime_env_backup" "$agent_runtime_env_source"; then
      printf '%s\n' "Restored the previous Rust runtime env after failed deployment." >&2
    else
      printf '%s\n' "CRITICAL: unable to restore the previous Rust runtime env." >&2
    fi
    agent_runtime_env_backup=
    agent_runtime_env_activated=0
  fi
  if [[ -n "$agent_runtime_env_candidate" && -f "$agent_runtime_env_candidate" ]]; then
    rm -f -- "$agent_runtime_env_candidate"
    agent_runtime_env_candidate=
  fi
  if [[ "$exit_status" -eq 0 && -n "$agent_runtime_env_backup" && -f "$agent_runtime_env_backup" ]]; then
    rm -f -- "$agent_runtime_env_backup"
    agent_runtime_env_backup=
  fi

  trap - EXIT
  exit "$exit_status"
}

trap cleanup_runtime_env_update EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

read_env_value() {
  local env_file=$1
  local wanted_key=$2
  awk -F= -v wanted_key="$wanted_key" '
    function normalized_key(raw) {
      sub(/^[[:space:]]*export[[:space:]]+/, "", raw)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", raw)
      return raw
    }
    $0 !~ /^[[:space:]]*#/ && normalized_key($1) == wanted_key {
      value = $0
      sub(/^[^=]*=/, "", value)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
      if (length(value) >= 2 && substr(value, 1, 1) == substr(value, length(value), 1) && (substr(value, 1, 1) == "\"" || substr(value, 1, 1) == "\047")) {
        value = substr(value, 2, length(value) - 2)
      }
      print value
      found = 1
    }
    END { exit(found ? 0 : 1) }
  ' "$env_file" | tail -n 1
}

write_canonical_feed_token() {
  local env_file=$1
  local token=$2
  local temporary
  temporary=$(mktemp "${env_file}.rewrite.XXXXXX")
  awk -F= '
    function normalized_key(raw) {
      sub(/^[[:space:]]*export[[:space:]]+/, "", raw)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", raw)
      return raw
    }
    $0 ~ /^[[:space:]]*#/ ||
      (normalized_key($1) != "KRW_FEED_MCP_TOKEN" && normalized_key($1) != "FEED_MCP_AUTH_TOKEN") {
      print
    }
  ' "$env_file" > "$temporary"
  printf "export KRW_FEED_MCP_TOKEN='%s'\n" \
    "$(printf '%s' "$token" | sed "s/'/'\\\\''/g")" >> "$temporary"
  chmod 600 "$temporary"
  mv -f -- "$temporary" "$env_file"
}

write_canonical_mcp_origin() {
  local env_file=$1
  local origin=$2
  write_canonical_env_value "$env_file" KRW_AGENT_MCP_ORIGIN "$origin"
}

write_canonical_env_value() {
  local env_file=$1
  local key=$2
  local value=$3
  local temporary
  temporary=$(mktemp "${env_file}.rewrite.XXXXXX")
  awk -F= -v wanted_key="$key" '
    function normalized_key(raw) {
      sub(/^[[:space:]]*export[[:space:]]+/, "", raw)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", raw)
      return raw
    }
    $0 ~ /^[[:space:]]*#/ || normalized_key($1) != wanted_key { print }
  ' "$env_file" > "$temporary"
  printf "export %s='%s'\n" "$key" \
    "$(printf '%s' "$value" | sed "s/'/'\\\\''/g")" >> "$temporary"
  chmod 600 "$temporary"
  mv -f -- "$temporary" "$env_file"
}

remove_env_keys() {
  local env_file=$1
  shift
  local temporary
  temporary=$(mktemp "${env_file}.rewrite.XXXXXX")
  awk -F= -v keys="$*" '
    function normalized_key(raw) {
      sub(/^[[:space:]]*export[[:space:]]+/, "", raw)
      gsub(/^[[:space:]]+|[[:space:]]+$/, "", raw)
      return raw
    }
    $0 ~ /^[[:space:]]*#/ { print; next }
    {
      split(keys, wanted, " ")
      for (i in wanted) if (normalized_key($1) == wanted[i]) next
      print
    }
  ' "$env_file" > "$temporary"
  chmod 600 "$temporary"
  mv -f -- "$temporary" "$env_file"
}

canonicalize_runtime_mcp_environment() {
  local env_file=$1
  local origin=$2
  local key value
  local required_keys=(
    KRW_ONTOLOGY_MCP_URL KRW_ONTOLOGY_READY_URL
    KRW_FEED_MCP_URL KRW_FEED_MCP_READY_URL
    KRW_FILINGS_MCP_URL KRW_FILINGS_MCP_READY_URL
    KRW_GURU_MCP_URL KRW_GURU_MCP_READY_URL
  )
  for key in "${required_keys[@]}"; do
    value=$(read_env_value "$env_file" "$key" 2>/dev/null || true)
    [[ -n "$value" ]] || fail "Rust runtime env has no $key"
    [[ "$value" = https://* ]] || fail "$key must use HTTPS in the production Rust runtime envelope"
    write_canonical_env_value "$env_file" "$key" "$value"
  done
  write_canonical_mcp_origin "$env_file" "$origin"
  # These names belonged to the retired HTTP worker and are not read by the
  # sealed Rust launcher. Keeping them creates two apparent endpoint contracts
  # for operators and tools that source this file outside the wrapper.
  remove_env_keys "$env_file" KRW_ONTOLOGY_MCP_HEALTH_URL KRW_ONTOLOGY_MCP_READY_URL KRW_AGENT_ENDPOINTS_PATH
}

resolve_canonical_mcp_origin() {
  local registry=$1
  [[ -f "$registry" && ! -L "$registry" ]] \
    || fail "sealed MCP endpoint registry is missing or unsafe: $registry"
  node "$front_dir/scripts/krw-agent-mcp-contract.mjs" --registry "$registry"
}

resolve_active_feed_gateway_origin() {
  # A fresh release's sealed Origin can differ from the currently running
  # gateway during a cutover.  The early liveness probe must therefore use the
  # Origin that the *current* gateway actually allows.  The sealed Origin is
  # checked again after the gateway contract has been materialized; using it
  # here would create a bootstrap deadlock (old gateway rejects new Origin,
  # so the installer is never reached).
  local config="$agent_operator_root/config/runtime/feed-tls.json"
  [[ -f "$config" && ! -L "$config" ]] \
    || fail "active Feed gateway config is missing or unsafe: $config"
  node - "$config" <<'NODE'
const fs = require("node:fs");
const configPath = process.argv[2];
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const origins = config?.allowedOrigins;
if (
  !Array.isArray(origins) ||
  origins.length !== 1 ||
  typeof origins[0] !== "string" ||
  !/^https:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(origins[0])
) {
  throw new Error("active Feed gateway has no exact HTTPS Origin allowlist");
}
process.stdout.write(origins[0]);
NODE
}

ensure_local_feed_gateway_ready() {
  local feed_token=$1
  local origin=$2
  local feed_url ready_url ca_file probe_dir probe_body deadline
  feed_url=$(read_env_value "$agent_runtime_env_source" KRW_FEED_MCP_URL 2>/dev/null || true)
  [[ -n "$feed_url" ]] || fail "Rust runtime env has no KRW_FEED_MCP_URL"
  case "$feed_url" in
    */mcp) ready_url="${feed_url%/mcp}/readyz" ;;
    *) fail "KRW_FEED_MCP_URL must end with /mcp" ;;
  esac

  ca_file=$(read_env_value "$agent_runtime_env_source" KRW_AGENT_MCP_CA_FILE 2>/dev/null || true)
  case "$feed_url" in
    https://*)
      [[ -n "$ca_file" && -f "$ca_file" && ! -L "$ca_file" ]] \
        || fail "HTTPS Feed gateway requires a regular KRW_AGENT_MCP_CA_FILE"
      ;;
    http://*) ;;
    *) fail "KRW_FEED_MCP_URL must use http or https" ;;
  esac

  command -v launchctl >/dev/null 2>&1 \
    || fail "launchctl is required to prepare the local Feed MCP gateway"
  # The gateway supervisor is intentionally long-lived, but a previous crash
  # can leave its loopback ports unavailable while launchd is still restarting
  # it. Kick it once before the credential probe and wait for the authenticated
  # readiness contract instead of treating that short startup window as a
  # permanent deployment failure.
  launchctl kickstart -k "gui/$(id -u)/com.krw.agent.local-mcp-gateways" >/dev/null 2>&1 || true

  probe_dir=$(mktemp -d "${TMPDIR:-/tmp}/krw-feed-gateway.XXXXXX")
  chmod 700 "$probe_dir"
  probe_body="$probe_dir/ready.json"
  deadline=$((SECONDS + 45))
  while (( SECONDS < deadline )); do
    if [[ "$feed_url" == https://* ]]; then
      curl_args=(--cacert "$ca_file")
    else
      curl_args=()
    fi
    if curl -fsS --connect-timeout 1 --max-time 3 "${curl_args[@]}" \
      -H "Authorization: Bearer $feed_token" \
      -H 'Accept: application/json' \
      -H "Origin: $origin" \
      "$ready_url" -o "$probe_body" 2>/dev/null \
      && python3 - "$probe_body" <<'PY'
import json
import pathlib
import sys

payload = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
if payload.get("ok") is not True or payload.get("service") not in (None, "krw-feed-mcp"):
    raise SystemExit(1)
if "database_ready" in payload and payload["database_ready"] is not True:
    raise SystemExit(1)
PY
    then
      rm -rf -- "$probe_dir"
      printf '%s\n' "Local Feed MCP gateway is ready for the sealed release."
      return 0
    fi
    sleep 1
  done
  rm -rf -- "$probe_dir"
  fail "Local Feed MCP gateway did not become ready at $ready_url"
}

prepare_agent_runtime_env_candidate() {
  [[ -f "$agent_runtime_env_source" && ! -L "$agent_runtime_env_source" ]] \
    || fail "Rust Agent V1 runtime env is missing or unsafe: $agent_runtime_env_source"

  local canonical_feed_token legacy_feed_token feed_token active_feed_origin
  canonical_feed_token=$(read_env_value "$front_dir/.env" KRW_FEED_MCP_TOKEN 2>/dev/null || true)
  legacy_feed_token=$(read_env_value "$front_dir/.env" FEED_MCP_AUTH_TOKEN 2>/dev/null || true)
  if [[ -n "$canonical_feed_token" && -n "$legacy_feed_token" && "$canonical_feed_token" != "$legacy_feed_token" ]]; then
    fail "Feed MCP token aliases conflict in $front_dir/.env"
  fi
  feed_token=$canonical_feed_token
  if [[ -z "$feed_token" ]]; then
    feed_token=$legacy_feed_token
  fi
  [[ -n "$feed_token" ]] || fail "Feed MCP token is required for a fresh Rust release"
  [[ "$feed_token" != *$'\n'* && "$feed_token" != *$'\r'* ]] \
    || fail "Feed MCP token contains a newline and cannot be propagated safely"

  agent_endpoint_registry="$agent_operator_root/config/deepseek/endpoint-registry.yaml"
  agent_mcp_origin=$(resolve_canonical_mcp_origin "$agent_endpoint_registry")
  if [[ -f "$agent_operator_root/config/glm/endpoint-registry.yaml" && ! -L "$agent_operator_root/config/glm/endpoint-registry.yaml" ]]; then
    local glm_origin
    glm_origin=$(resolve_canonical_mcp_origin "$agent_operator_root/config/glm/endpoint-registry.yaml")
    [[ "$glm_origin" = "$agent_mcp_origin" ]] \
      || fail "GLM and DeepSeek MCP endpoint Origins differ"
  fi

  active_feed_origin=$(resolve_active_feed_gateway_origin)
  printf '%s\n' "Checking the existing Feed MCP gateway before applying the new sealed Origin ($active_feed_origin)..."
  ensure_local_feed_gateway_ready "$feed_token" "$active_feed_origin"

  # Keep the candidate in the same directory so its later activation is an
  # atomic rename.  The launchd plist will receive only the stable source
  # path, never this candidate name.
  agent_runtime_env_candidate=$(mktemp "${agent_runtime_env_source}.candidate.XXXXXX")
  cp -p -- "$agent_runtime_env_source" "$agent_runtime_env_candidate"
  write_canonical_feed_token "$agent_runtime_env_candidate" "$feed_token"
  canonicalize_runtime_mcp_environment "$agent_runtime_env_candidate" "$agent_mcp_origin"

  agent_runtime_env_backup=$(mktemp "${agent_runtime_env_source}.previous.XXXXXX")
  cp -p -- "$agent_runtime_env_source" "$agent_runtime_env_backup"
  chmod 600 "$agent_runtime_env_backup"
  mv -f -- "$agent_runtime_env_candidate" "$agent_runtime_env_source"
  agent_runtime_env_candidate=
  agent_runtime_env_activated=1
  printf '%s\n' "Verified Feed MCP credential and updated the persistent Rust runtime env."
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --release-id)
      [[ $# -ge 2 ]] || fail "--release-id requires a value"
      release_id=$2
      shift 2
      ;;
    --agent-release-root)
      fail "prod:deploy:full always creates a fresh Rust release; use prod:deploy:safe for a prebuilt release"
      ;;
    --dry-run)
      fail "prod:deploy:full creates a signed release; use npm run prod:deploy:dry for a non-mutating preflight"
      ;;
    *)
      forward_args+=("$1")
      has_forward_args=1
      shift
      ;;
  esac
done

[[ -z "${KRW_AGENT_RELEASE_ROOT:-}" ]] \
  || fail "unset KRW_AGENT_RELEASE_ROOT: prod:deploy:full always creates a fresh Rust release"
[[ "$agent_source_root" = /* && -d "$agent_source_root" && ! -L "$agent_source_root" ]] \
  || fail "KRW_AGENT_SOURCE_ROOT must be an existing absolute real directory"
[[ "$agent_operator_root" = /* && -d "$agent_operator_root" && ! -L "$agent_operator_root" ]] \
  || fail "KRW_AGENT_OPERATOR_ROOT must be an existing absolute real directory"
[[ -z "$(git -C "$front_dir" status --porcelain=v1 --untracked-files=normal)" ]] \
  || fail "Production web release requires a clean committed frontend tree"
[[ -z "$(git -C "$agent_source_root" status --porcelain=v1 --untracked-files=normal)" ]] \
  || fail "Fresh Rust release requires a clean committed krw-agnet tree"
node "$script_dir/verify-supabase-schema-smoke-rpc-contract.mjs" \
  || fail "Schema-smoke RPC contract does not match the generated database types"
# Operator gateway JSON predates the sealed release and can survive an older
# rollback. Reconcile it before the Feed readiness probe and before compiling
# or uploading anything, so a stale gateway cannot waste a full deployment.
reconcile_current_local_mcp_gateway_contract
prepare_agent_runtime_env_candidate

case "$release_id" in
  "") release_id="$(date +%Y%m%d%H%M%S)-$$" ;;
  *[!A-Za-z0-9._-]*) fail "Invalid release id: $release_id" ;;
esac

agent_commit=$(git -C "$agent_source_root" rev-parse --short=12 HEAD) \
  || fail "Unable to resolve the krw-agnet Git commit"
release_root="$agent_operator_root/releases/${release_id}-${agent_commit}"
[[ ! -e "$release_root" ]] || fail "Fresh Rust release path already exists: $release_root"

build_args=(
  --output-root "$release_root"
  --front-root "$front_dir"
  --operator-root "$agent_operator_root"
  --runtime-env "$agent_runtime_env_source"
)
"$agent_source_root/scripts/build_sealed_dual_provider_release.sh" "${build_args[@]}"

deploy_exact_release() {
  env KRW_AGENT_OPERATOR_ROOT="$agent_operator_root" \
    KRW_AGENT_RUNTIME_ENV_FILE="$agent_runtime_env_source" \
    "$script_dir/deploy-production-fast.sh" \
      --apply-migrations \
      --with-agent-release \
      --release-id "$release_id" \
      --agent-release-root "$release_root" \
      "$@"
}

# Bash with `set -u` treats an empty array expansion as an unset variable on
# some macOS Bash versions. Keep the common no-argument deploy path explicit.
if [[ "$has_forward_args" = "1" ]]; then
  deploy_exact_release "${forward_args[@]}"
else
  deploy_exact_release
fi
