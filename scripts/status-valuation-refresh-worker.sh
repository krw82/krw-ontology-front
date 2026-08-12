#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/status-valuation-refresh-worker.sh [--env-file FILE] [--worker-id ID]

Show the launchd registration and any running valuation refresh worker process.
EOF
}

ENV_FILE=.env.mac-worker.production
WORKER_ID_OVERRIDE=
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

PLIST="$HOME/Library/LaunchAgents/com.krwontology.valuation-refresh-worker.plist"
DOMAIN="gui/$(id -u)"
LABEL="com.krwontology.valuation-refresh-worker"

case "$ENV_FILE" in
  /*) ENV_PATH=$ENV_FILE ;;
  *) ENV_PATH="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)/$ENV_FILE" ;;
esac

WORKER_ID=$WORKER_ID_OVERRIDE
if [ -z "$WORKER_ID" ] && [ -f "$ENV_PATH" ] && command -v node >/dev/null 2>&1; then
  WORKER_ID=$(node --env-file="$ENV_PATH" -e \
    'process.stdout.write(process.env.VALUATION_REFRESH_WORKER_ID ?? "");')
fi
WORKER_ID=${WORKER_ID:-valuation-refresh-local}

echo "Valuation refresh worker status"
echo "  worker_id=$WORKER_ID"
echo "  plist=$PLIST"
if [ -f "$PLIST" ]; then
  echo "  plist_state=installed"
else
  echo "  plist_state=not-installed"
fi

if command -v launchctl >/dev/null 2>&1; then
  if launchctl print "$DOMAIN/$LABEL" >/tmp/krw-valuation-refresh-launchd-status.$$ 2>/dev/null; then
    echo "  launchd_state=loaded"
    sed -n '1,40p' /tmp/krw-valuation-refresh-launchd-status.$$
  else
    echo "  launchd_state=not-loaded"
  fi
  rm -f /tmp/krw-valuation-refresh-launchd-status.$$
else
  echo "  launchd_state=unavailable (run on macOS for launchd details)"
fi

running_pids=$(
  ps eww -axo pid,etime,nice,command 2>/dev/null \
    | awk -v id="VALUATION_REFRESH_WORKER_ID=$WORKER_ID" '/[.]worker\/valuation-refresh-worker[.]mjs/ && index($0, id) > 0 && !/awk/ { print }'
) || true
if [ -n "$running_pids" ]; then
  echo "  process_state=running"
  echo "$running_pids"
else
  echo "  process_state=not-running"
fi
