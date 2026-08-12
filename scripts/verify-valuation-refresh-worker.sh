#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/verify-valuation-refresh-worker.sh [options]

Options:
  --env-file FILE       Environment file (default: .env.mac-worker.production)
  --worker-id ID        Override VALUATION_REFRESH_WORKER_ID
  --timeout-ms MS       Maximum wait for launchd/process readiness (default: 30000)
EOF
}

ENV_FILE=.env.mac-worker.production
WORKER_ID_OVERRIDE=
TIMEOUT_MS=30000

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
    --timeout-ms)
      TIMEOUT_MS=${2:?Missing value for --timeout-ms}
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

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
case "$ENV_FILE" in
  /*) ENV_PATH=$ENV_FILE ;;
  *) ENV_PATH="$FRONT_DIR/$ENV_FILE" ;;
esac

if [ ! -f "$ENV_PATH" ]; then
  echo "Missing valuation worker env file: $ENV_PATH" >&2
  exit 1
fi
case "$TIMEOUT_MS" in
  ''|*[!0-9]*) echo "--timeout-ms must be an integer." >&2; exit 1 ;;
esac

WORKER_ID=${WORKER_ID_OVERRIDE:-}
if [ -z "$WORKER_ID" ]; then
  WORKER_ID=$(node --env-file="$ENV_PATH" -e \
    'process.stdout.write(process.env.VALUATION_REFRESH_WORKER_ID ?? "");')
fi
WORKER_ID=${WORKER_ID:-valuation-refresh-local}
LABEL=com.krwontology.valuation-refresh-worker
DOMAIN="gui/$(id -u)"

if ! command -v launchctl >/dev/null 2>&1; then
  echo "launchctl is required to verify the valuation refresh worker (run on macOS)." >&2
  exit 1
fi

deadline=$(( $(date +%s) * 1000 + TIMEOUT_MS ))
while :; do
  launchd_loaded=0
  if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
    launchd_loaded=1
  fi
  running_pids=$(
    ps eww -axo pid,command 2>/dev/null \
      | awk -v id="VALUATION_REFRESH_WORKER_ID=$WORKER_ID" '/[.]worker\/valuation-refresh-worker[.]mjs/ && index($0, id) > 0 && !/awk/ { print $1 }'
  ) || true
  if [ "$launchd_loaded" = "1" ] && [ -n "$running_pids" ]; then
    echo "OK valuation refresh worker loaded and running"
    echo "  worker_id=$WORKER_ID"
    echo "  pid(s)=$running_pids"
    exit 0
  fi
  now=$(( $(date +%s) * 1000 ))
  if [ "$now" -ge "$deadline" ]; then
    echo "Valuation refresh worker did not become ready." >&2
    echo "  worker_id=$WORKER_ID" >&2
    echo "  launchd_loaded=$launchd_loaded" >&2
    echo "  running_pids=${running_pids:-none}" >&2
    launchctl print "$DOMAIN/$LABEL" 2>&1 | sed -n '1,80p' >&2 || true
    exit 1
  fi
  sleep 1
done
