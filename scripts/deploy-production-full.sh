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
release_id=
forward_args=()

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

case "$release_id" in
  "") release_id="$(date +%Y%m%d%H%M%S)-$$" ;;
  *[!A-Za-z0-9._-]*) fail "Invalid release id: $release_id" ;;
esac

agent_commit=$(git -C "$agent_source_root" rev-parse --short=12 HEAD) \
  || fail "Unable to resolve the krw-agnet Git commit"
release_root="$agent_operator_root/releases/${release_id}-${agent_commit}"
[[ ! -e "$release_root" ]] || fail "Fresh Rust release path already exists: $release_root"

"$agent_source_root/scripts/build_sealed_dual_provider_release.sh" \
  --output-root "$release_root" \
  --operator-root "$agent_operator_root"

exec env KRW_AGENT_OPERATOR_ROOT="$agent_operator_root" \
  "$script_dir/deploy-production-fast.sh" \
    --apply-migrations \
    --with-agent-release \
    --release-id "$release_id" \
    --agent-release-root "$release_root" \
    "${forward_args[@]}"
