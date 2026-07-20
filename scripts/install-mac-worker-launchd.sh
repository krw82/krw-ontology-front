#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/install-mac-worker-launchd.sh [--env-file FILE] [--load] [--skip-preflight]

Install one launchd plist for the production agent supervisor. Pass --load to
start it immediately after installing. The supervisor owns an internal
concurrency pool; launchd should not start one process per slot.
EOF
}

LOAD=0
SKIP_PREFLIGHT=0
ENV_FILE=.env.mac-worker.production
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE=${2:?Missing value for --env-file}
      shift
      ;;
    --load)
      LOAD=1
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
TEMPLATE="$FRONT_DIR/ops/launchd/com.krwontology.agent-worker.plist.template"
PLIST_DIR="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"
LABEL="com.krwontology.agent-worker"
PLIST="$PLIST_DIR/$LABEL.plist"
case "$ENV_FILE" in
  /*) ENV_PATH=$ENV_FILE ;;
  *) ENV_PATH="$FRONT_DIR/$ENV_FILE" ;;
esac

wait_for_worker_id_to_stop() {
  worker_id=$1
  signal=${2:-}
  for _ in $(seq 1 20); do
    pids=$(
      ps eww -axo pid,command \
        | awk -v id="AGENT_WORKER_ID=$worker_id" '/[.]worker\/agent-worker[.]mjs/ && index($0, id) > 0 && !/awk/ { print $1 }'
    )
    if [ -z "$pids" ]; then
      return 0
    fi
    sleep 0.5
  done
  if [ -n "$signal" ]; then
    echo "Worker id $worker_id is still running; sending SIG$signal to PID(s): $pids" >&2
    # shellcheck disable=SC2086
    kill -"$signal" $pids 2>/dev/null || true
    wait_for_worker_id_to_stop "$worker_id"
    return $?
  fi
  echo "Worker id $worker_id is still running after stop request." >&2
  return 1
}

bootout_existing_agent_worker_plists() {
  for plist in "$PLIST_DIR"/com.krwontology.agent-worker*.plist; do
    if [ ! -e "$plist" ]; then
      continue
    fi
    launchctl bootout "$DOMAIN" "$plist" >/dev/null 2>&1 || true
  done
}

if [ ! -f "$ENV_PATH" ]; then
  echo "Missing Mac worker env file: $ENV_PATH. Run scripts/init-mac-worker-env.sh first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_PATH"
set +a

AGENT_SUPERVISOR_ID=${AGENT_SUPERVISOR_ID:-${AGENT_WORKER_ID:-mac-supervisor-jwc}}
AGENT_WORKER_ID=$AGENT_SUPERVISOR_ID
AGENT_SUPERVISOR_CONCURRENCY=${AGENT_SUPERVISOR_CONCURRENCY:-${MAC_WORKER_COUNT:-1}}
MAC_WORKER_NICE=${MAC_WORKER_NICE:--5}
AGENT_WORKER_ID_PREFIX=${AGENT_WORKER_ID_PREFIX:-mac-worker-jwc}
AGENT_WORKER_ID_PREFIX=${AGENT_WORKER_ID_PREFIX%-1}
KRW_DEPLOYMENT_ID=${KRW_DEPLOYMENT_ID:?Missing KRW_DEPLOYMENT_ID for the Mac worker launchd service}
KRW_WORKER_BUNDLE_SHA256=${KRW_WORKER_BUNDLE_SHA256:?Missing KRW_WORKER_BUNDLE_SHA256 for the Mac worker launchd service}
KRW_RUNTIME_IDENTITY_SHA256=${KRW_RUNTIME_IDENTITY_SHA256:?Missing KRW_RUNTIME_IDENTITY_SHA256 for the Mac worker launchd service}
MAC_RUNTIME_ROOT=${KRW_MAC_RUNTIME_ROOT:-$FRONT_DIR}
test -f "$MAC_RUNTIME_ROOT/scripts/start-mac-worker-production.sh" || {
  echo "Missing Mac runtime worker start script: $MAC_RUNTIME_ROOT" >&2
  exit 1
}
case "$KRW_DEPLOYMENT_ID" in
  ''|*[!A-Za-z0-9._-]*)
    echo "Invalid KRW_DEPLOYMENT_ID: $KRW_DEPLOYMENT_ID" >&2
    exit 1
    ;;
esac
printf '%s' "$KRW_WORKER_BUNDLE_SHA256" | grep -Eq '^[a-f0-9]{64}$' || {
  echo "Invalid KRW_WORKER_BUNDLE_SHA256." >&2
  exit 1
}
printf '%s' "$KRW_RUNTIME_IDENTITY_SHA256" | grep -Eq '^[a-f0-9]{64}$' || {
  echo "Invalid KRW_RUNTIME_IDENTITY_SHA256." >&2
  exit 1
}
KRW_LOG_DIR=${KRW_LOG_DIR:-"$HOME/krw-ontology-log"}
WORKER_LOG_DIR=${AGENT_WORKER_LOG_DIR:-"$KRW_LOG_DIR/agent-worker/prod"}
export AGENT_SUPERVISOR_ID
export AGENT_WORKER_ID
export AGENT_SUPERVISOR_CONCURRENCY

case "$AGENT_SUPERVISOR_CONCURRENCY" in
  ''|*[!0-9]*)
    echo "AGENT_SUPERVISOR_CONCURRENCY must be a positive integer: $AGENT_SUPERVISOR_CONCURRENCY" >&2
    exit 1
    ;;
esac
if [ "$AGENT_SUPERVISOR_CONCURRENCY" -lt 1 ]; then
  echo "AGENT_SUPERVISOR_CONCURRENCY must be at least 1." >&2
  exit 1
fi
case "$MAC_WORKER_NICE" in
  -[0-9]*|[0-9]*) ;;
  *)
    echo "MAC_WORKER_NICE must be an integer between -20 and 20: $MAC_WORKER_NICE" >&2
    exit 1
    ;;
esac
if [ "$MAC_WORKER_NICE" -lt -20 ] || [ "$MAC_WORKER_NICE" -gt 20 ]; then
  echo "MAC_WORKER_NICE must be between -20 and 20: $MAC_WORKER_NICE" >&2
  exit 1
fi

if [ "$SKIP_PREFLIGHT" != "1" ]; then
  "$SCRIPT_DIR/mac-worker-preflight.sh" \
    --env-file "$ENV_PATH" \
    --worker-id "$AGENT_SUPERVISOR_ID" \
    --skip-worker-duplicate-check
fi

mkdir -p "$PLIST_DIR" "$WORKER_LOG_DIR"

sed \
  -e "s#__LABEL__#$LABEL#g" \
  -e "s#__WORKER_ID__#$AGENT_SUPERVISOR_ID#g" \
  -e "s#__NICE__#$MAC_WORKER_NICE#g" \
  -e "s#__ENV_FILE__#$ENV_PATH#g" \
  -e "s#__FRONT_DIR__#$MAC_RUNTIME_ROOT#g" \
  -e "s#__WORKER_LOG_DIR__#$WORKER_LOG_DIR#g" \
  -e "s#__DEPLOYMENT_ID__#$KRW_DEPLOYMENT_ID#g" \
  -e "s#__WORKER_BUNDLE_SHA256__#$KRW_WORKER_BUNDLE_SHA256#g" \
  -e "s#__RUNTIME_IDENTITY_SHA256__#$KRW_RUNTIME_IDENTITY_SHA256#g" \
  "$TEMPLATE" > "$PLIST"
echo "Installed $PLIST for supervisor $AGENT_SUPERVISOR_ID"

if [ "$LOAD" != "1" ]; then
  echo "Not loaded. Start later with:"
  echo "  launchctl bootstrap $DOMAIN $PLIST"
  echo "  launchctl kickstart -k $DOMAIN/$LABEL"
  exit 0
fi

bootout_existing_agent_worker_plists

wait_for_worker_id_to_stop "$AGENT_SUPERVISOR_ID" \
  || wait_for_worker_id_to_stop "$AGENT_SUPERVISOR_ID" TERM \
  || wait_for_worker_id_to_stop "$AGENT_SUPERVISOR_ID" KILL

legacy_count=${MAC_WORKER_COUNT:-8}
case "$legacy_count" in
  ''|*[!0-9]*) legacy_count=8 ;;
esac
if [ "$legacy_count" -lt 8 ]; then
  legacy_count=8
fi
for index in $(seq 1 "$legacy_count"); do
  legacy_worker_id="$AGENT_WORKER_ID_PREFIX-$index"
  wait_for_worker_id_to_stop "$legacy_worker_id" \
    || wait_for_worker_id_to_stop "$legacy_worker_id" TERM \
    || wait_for_worker_id_to_stop "$legacy_worker_id" KILL
done

rm -f "$PLIST_DIR"/com.krwontology.agent-worker.[0-9]*.plist

launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl enable "$DOMAIN/$LABEL"
launchctl kickstart -k "$DOMAIN/$LABEL"

sleep 2
launchctl print "$DOMAIN/$LABEL" | sed -n '1,50p'
echo "OK Mac worker supervisor launchd service loaded: $AGENT_SUPERVISOR_ID concurrency=$AGENT_SUPERVISOR_CONCURRENCY"
