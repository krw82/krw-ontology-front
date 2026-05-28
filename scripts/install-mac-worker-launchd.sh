#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/install-mac-worker-launchd.sh [--env-file FILE] [--load]

Install launchd plists for the configured production Mac workers. Pass --load
to start them immediately after installing.
EOF
}

LOAD=0
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
LEGACY_PLIST="$PLIST_DIR/com.krwontology.agent-worker.plist"
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

if [ ! -f "$ENV_PATH" ]; then
  echo "Missing Mac worker env file: $ENV_PATH. Run scripts/init-mac-worker-env.sh first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_PATH"
set +a

MAC_WORKER_COUNT=${MAC_WORKER_COUNT:-1}
MAC_WORKER_NICE=${MAC_WORKER_NICE:--5}
AGENT_WORKER_ID_PREFIX=${AGENT_WORKER_ID_PREFIX:-${AGENT_WORKER_ID:-}}
AGENT_WORKER_ID_PREFIX=${AGENT_WORKER_ID_PREFIX%-1}
if [ -z "$AGENT_WORKER_ID_PREFIX" ]; then
  AGENT_WORKER_ID_PREFIX=mac-worker-jwc
fi

case "$MAC_WORKER_COUNT" in
  ''|*[!0-9]*)
    echo "MAC_WORKER_COUNT must be a positive integer: $MAC_WORKER_COUNT" >&2
    exit 1
    ;;
esac
if [ "$MAC_WORKER_COUNT" -lt 1 ]; then
  echo "MAC_WORKER_COUNT must be at least 1." >&2
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

"$SCRIPT_DIR/mac-worker-preflight.sh" \
  --env-file "$ENV_PATH" \
  --worker-id "$AGENT_WORKER_ID_PREFIX-1" \
  --skip-worker-duplicate-check

mkdir -p "$PLIST_DIR" "$FRONT_DIR/logs"

installed_labels=""
for index in $(seq 1 "$MAC_WORKER_COUNT"); do
  worker_id="$AGENT_WORKER_ID_PREFIX-$index"
  label="com.krwontology.agent-worker.$index"
  plist="$PLIST_DIR/$label.plist"
  sed \
    -e "s#__LABEL__#$label#g" \
    -e "s#__WORKER_ID__#$worker_id#g" \
    -e "s#__NICE__#$MAC_WORKER_NICE#g" \
    -e "s#__ENV_FILE__#$ENV_PATH#g" \
    -e "s#__FRONT_DIR__#$FRONT_DIR#g" \
    "$TEMPLATE" > "$plist"
  installed_labels="$installed_labels $label"
  echo "Installed $plist for $worker_id"
done

if [ "$LOAD" != "1" ]; then
  echo "Not loaded. Start later with:"
  for label in $installed_labels; do
    echo "  launchctl bootstrap $DOMAIN $PLIST_DIR/$label.plist"
    echo "  launchctl kickstart -k $DOMAIN/$label"
  done
  exit 0
fi

launchctl bootout "$DOMAIN" "$LEGACY_PLIST" >/dev/null 2>&1 || true
rm -f "$LEGACY_PLIST"

for label in $installed_labels; do
  plist="$PLIST_DIR/$label.plist"
  worker_id=${label#com.krwontology.agent-worker.}
  worker_id="$AGENT_WORKER_ID_PREFIX-$worker_id"
  launchctl bootout "$DOMAIN" "$plist" >/dev/null 2>&1 || true
  wait_for_worker_id_to_stop "$worker_id" \
    || wait_for_worker_id_to_stop "$worker_id" TERM \
    || wait_for_worker_id_to_stop "$worker_id" KILL
done

for label in $installed_labels; do
  plist="$PLIST_DIR/$label.plist"
  launchctl bootstrap "$DOMAIN" "$plist"
  launchctl enable "$DOMAIN/$label"
  launchctl kickstart -k "$DOMAIN/$label"
done

sleep 2
for label in $installed_labels; do
  echo "--- $label ---"
  launchctl print "$DOMAIN/$label" | sed -n '1,50p'
done
echo "OK Mac worker launchd services loaded: $MAC_WORKER_COUNT"
