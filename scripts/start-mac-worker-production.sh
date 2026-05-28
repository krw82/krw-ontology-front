#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/start-mac-worker-production.sh [--env-file FILE] [--worker-id ID] [--log-file FILE] [--no-build] [--skip-preflight]

Run one production agent worker process on this Mac. Use launchd for long-lived
operation.
EOF
}

ENV_FILE=.env.mac-worker.production
WORKER_ID_OVERRIDE=
LOG_FILE=
BUILD=1
SKIP_PREFLIGHT=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE=${2:?Missing value for --env-file}
      shift
      ;;
    --worker-id)
      WORKER_ID_OVERRIDE=${2:?Missing value for --worker-id}
      shift
      ;;
    --log-file)
      LOG_FILE=${2:?Missing value for --log-file}
      shift
      ;;
    --no-build)
      BUILD=0
      ;;
    --skip-preflight)
      SKIP_PREFLIGHT=1
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

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)

if [ "$SKIP_PREFLIGHT" != "1" ]; then
  if [ -n "$WORKER_ID_OVERRIDE" ]; then
    "$SCRIPT_DIR/mac-worker-preflight.sh" --env-file "$ENV_FILE" --worker-id "$WORKER_ID_OVERRIDE"
  else
    "$SCRIPT_DIR/mac-worker-preflight.sh" --env-file "$ENV_FILE"
  fi
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

if [ -n "$WORKER_ID_OVERRIDE" ]; then
  AGENT_WORKER_ID=$WORKER_ID_OVERRIDE
  export AGENT_WORKER_ID
fi

if [ -n "${CLAUDE_CONFIG_DIR:-}" ] && [ -f "$CLAUDE_CONFIG_DIR/deepseek.env" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$CLAUDE_CONFIG_DIR/deepseek.env"
  set +a
fi

case "${ANTHROPIC_API_KEY:-}" in
  ""|"sk-placeholder"|"sk-ant-..."|"sk-ant-…"|"<anthropic-api-key>")
    unset ANTHROPIC_API_KEY
    ;;
esac

case "${ANTHROPIC_AUTH_TOKEN:-}" in
  ""|"sk-placeholder"|"sk-ant-..."|"sk-ant-…"|"<anthropic-auth-token>")
    unset ANTHROPIC_AUTH_TOKEN
    ;;
esac

if [ -n "${DEEPSEEK_API_KEY:-}" ] && [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  ANTHROPIC_AUTH_TOKEN=$DEEPSEEK_API_KEY
  export ANTHROPIC_AUTH_TOKEN
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ] && [ -z "${ANTHROPIC_AUTH_TOKEN:-}" ]; then
  echo "Missing Claude auth after placeholder cleanup: set ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN." >&2
  exit 1
fi

require_worker_id=${AGENT_WORKER_ID:-}
if [ -z "$require_worker_id" ]; then
  echo "Missing AGENT_WORKER_ID." >&2
  exit 1
fi

safe_worker_id=$(printf '%s' "$AGENT_WORKER_ID" | tr -cs 'A-Za-z0-9_.-' '-' | sed 's/^-//; s/-$//')
LOCK_DIR=${MAC_WORKER_LOCK_DIR:-/tmp/krw-ontology-agent-worker-$safe_worker_id.lock}
if [ -z "$LOG_FILE" ]; then
  LOG_FILE="$FRONT_DIR/logs/mac-agent-worker-$safe_worker_id.log"
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  existing_worker=$(
    ps eww -axo pid,command \
      | awk -v id="AGENT_WORKER_ID=$AGENT_WORKER_ID" '/[.]worker\/agent-worker[.]mjs/ && index($0, id) > 0 && !/awk/ { print $1 }'
  )
  if [ -n "$existing_worker" ]; then
    echo "Mac worker lock already exists: $LOCK_DIR" >&2
    echo "Refusing to start duplicate worker id $AGENT_WORKER_ID. Existing PID(s):" >&2
    echo "$existing_worker" >&2
    exit 1
  fi

  echo "Removing stale Mac worker lock: $LOCK_DIR" >&2
  rmdir "$LOCK_DIR" 2>/dev/null || {
    echo "Could not remove stale lock: $LOCK_DIR" >&2
    exit 1
  }
  mkdir "$LOCK_DIR"
fi

cleanup() {
  status=$?
  if [ "${child_pid:-}" ]; then
    kill "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  rmdir "$LOCK_DIR" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT INT TERM

mkdir -p "$CLAUDE_AGENT_CWD" "$CLAUDE_CONFIG_DIR" "$FRONT_DIR/logs"

if [ "$BUILD" = "1" ]; then
  (cd "$FRONT_DIR" && npm run build:worker)
fi

echo "Starting Mac production agent worker..."
echo "Worker id: $AGENT_WORKER_ID"
echo "Ontology env: ${KRW_ONTOLOGY_ENV:-unset}"
echo "Release root: ${KRW_ONTOLOGY_RELEASE_ROOT:-${KRW_ONTOLOGY_ROOT:-unset}}"
echo "Index path: ${KRW_ONTOLOGY_INDEX_PATH:-unset}"
echo "Plugin path: ${KRW_ONTOLOGY_PLUGIN_PATH:-unset}"
echo "Log file: $LOG_FILE"

(
  cd "$FRONT_DIR"
  exec node .worker/agent-worker.mjs
) >> "$LOG_FILE" 2>&1 &
child_pid=$!

wait "$child_pid"
