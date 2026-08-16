#!/usr/bin/env bash
set -euo pipefail

# Thin deployment adapter (doc/refetoring/05-deployment-and-front-contract.md).
#
# `npm run prod:deploy:full` delegates the ENTIRE deployment to the single
# agent-repository controller (`krw-agent-deploy`). This adapter owns no
# build, seal, migration, admission, activation, or recovery logic of its
# own. Provider selection is explicit: there is no default and no newest
# candidate selection — pass --agent-provider glm|deepseek (or point
# KRW_AGENT_DEPLOY_CONFIG at one explicit controller config).

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
deploy_bin=${KRW_AGENT_DEPLOY_BIN:-"$agent_source_root/target/release/krw-agent-deploy"}
deploy_config=${KRW_AGENT_DEPLOY_CONFIG:-}

usage() {
  cat <<'EOF'
Usage: npm run prod:deploy:full -- --agent-provider glm|deepseek

Thin adapter: runs the agent repository's single deployment controller
(krw-agent-deploy) against one explicit operator production config. The
config pins the provider, paths, and timeouts; the controller performs
the read-only preflight, exact-commit build, seal, frontend image,
forward-only migrations, admission close/open, local/remote activation,
deep readiness, and terminal receipt. Failures are fix-forward only.

Environment:
  KRW_AGENT_DEPLOY_BIN     controller binary (default:
                           <agent source>/target/release/krw-agent-deploy)
  KRW_AGENT_DEPLOY_CONFIG  explicit config path (overrides --agent-provider)
EOF
}

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

provider=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent-provider)
      [[ $# -ge 2 ]] || fail "--agent-provider requires glm or deepseek"
      provider=$2
      shift 2
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
done

if [[ -z "$deploy_config" ]]; then
  [[ -n "$provider" ]] || fail "provider must be explicit: pass --agent-provider glm|deepseek (no default selection exists)"
  case "$provider" in
    glm|deepseek) ;;
    *) fail "unknown provider: $provider (expected glm or deepseek)" ;;
  esac
  deploy_config="$agent_operator_root/config/production-config-$provider.json"
fi

[[ "$deploy_config" = /* && -f "$deploy_config" ]] \
  || fail "controller config not found (absolute path required): $deploy_config"

if [[ ! -x "$deploy_bin" ]]; then
  command -v cargo >/dev/null 2>&1 || [[ -x "$HOME/.cargo/bin/cargo" ]] || {
    # The agent repository pins its toolchain; fall back to the pinned
    # toolchain directory when cargo is not on PATH.
    pinned_cargo=$(find "$HOME/.rustup/toolchains" -maxdepth 3 -name cargo -type f 2>/dev/null | sort | tail -n 1)
    [[ -n "$pinned_cargo" ]] || fail "krw-agent-deploy binary missing and no cargo toolchain found: $deploy_bin"
    export PATH="$(dirname -- "$pinned_cargo"):$PATH"
  }
  command -v cargo >/dev/null 2>&1 || export PATH="$HOME/.cargo/bin:$PATH"
  (cd "$agent_source_root" && cargo build --release -p krw-agent-deploy) \
    || fail "unable to build the krw-agent-deploy controller"
fi

[[ -x "$deploy_bin" ]] || fail "controller binary missing: $deploy_bin"

exec "$deploy_bin" --config "$deploy_config" deploy
