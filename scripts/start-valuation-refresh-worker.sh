#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/start-valuation-refresh-worker.sh [options]

Options:
  --env-file FILE       Environment file (default: .env.mac-worker.production)
  --worker-id ID        Override VALUATION_REFRESH_WORKER_ID
  --log-file FILE       Redirect worker output to FILE
  --once                Run one refresh cycle and exit
  --tickers LIST        Run only the comma-separated ticker list
  --no-build            Do not build the worker bundle before starting
  --skip-preflight      Skip environment validation
EOF
}

ENV_FILE=.env.mac-worker.production
WORKER_ID_OVERRIDE=
LOG_FILE=
BUILD=1
SKIP_PREFLIGHT=0
ONCE=0
TICKERS=

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
    --once)
      ONCE=1
      ;;
    --tickers)
      TICKERS=${2:?Missing value for --tickers}
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
case "$ENV_FILE" in
  /*) ENV_PATH=$ENV_FILE ;;
  *) ENV_PATH="$FRONT_DIR/$ENV_FILE" ;;
esac

if [ ! -f "$ENV_PATH" ]; then
  echo "Missing valuation worker env file: $ENV_PATH" >&2
  exit 1
fi

env_value() {
  node --env-file="$ENV_PATH" -e \
    'const key = process.argv[1]; process.stdout.write(process.env[key] ?? "");' \
    "$1"
}

VALUATION_REFRESH_WORKER_ID=${VALUATION_REFRESH_WORKER_ID:-$(env_value VALUATION_REFRESH_WORKER_ID)}
VALUATION_REFRESH_LOCK_DIR=${VALUATION_REFRESH_LOCK_DIR:-$(env_value VALUATION_REFRESH_LOCK_DIR)}
KRW_LOG_DIR=${KRW_LOG_DIR:-$(env_value KRW_LOG_DIR)}
VALUATION_REFRESH_LOG_DIR=${VALUATION_REFRESH_LOG_DIR:-$(env_value VALUATION_REFRESH_LOG_DIR)}

if [ -n "$WORKER_ID_OVERRIDE" ]; then
  VALUATION_REFRESH_WORKER_ID=$WORKER_ID_OVERRIDE
  export VALUATION_REFRESH_WORKER_ID
fi

if [ "$SKIP_PREFLIGHT" != "1" ]; then
  if [ -n "$WORKER_ID_OVERRIDE" ]; then
    "$SCRIPT_DIR/valuation-refresh-preflight.sh" --env-file "$ENV_FILE" --worker-id "$WORKER_ID_OVERRIDE"
  else
    "$SCRIPT_DIR/valuation-refresh-preflight.sh" --env-file "$ENV_FILE"
  fi
fi

if [ "$BUILD" = "1" ]; then
  (cd "$FRONT_DIR" && npm run build:worker)
fi

WORKER_ID=${VALUATION_REFRESH_WORKER_ID:-valuation-refresh-local}
export VALUATION_REFRESH_WORKER_ID=$WORKER_ID
SAFE_WORKER_ID=$(printf '%s' "$WORKER_ID" | tr -cs 'A-Za-z0-9_.-' '-' | sed 's/^-//; s/-$//')
LOCK_DIR=${VALUATION_REFRESH_LOCK_DIR:-"/tmp/krw-ontology-valuation-worker-$SAFE_WORKER_ID.lock"}
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  running_pids=$(
    ps eww -axo pid,command 2>/dev/null \
      | awk -v id="VALUATION_REFRESH_WORKER_ID=$WORKER_ID" '/[.]worker\/valuation-refresh-worker[.]mjs/ && index($0, id) > 0 && !/awk/ { print $1 }'
  ) || true
  if [ -n "$running_pids" ]; then
    echo "Valuation worker lock already exists: $LOCK_DIR" >&2
    echo "Refusing to start duplicate worker id $WORKER_ID (PID(s): $running_pids)." >&2
    exit 1
  fi
  if ! rmdir "$LOCK_DIR" 2>/dev/null || ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "Valuation worker lock already exists: $LOCK_DIR" >&2
    echo "Refusing to start duplicate worker id $WORKER_ID." >&2
    exit 1
  fi
fi

cleanup() {
  status=$?
  rmdir "$LOCK_DIR" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT INT TERM

KRW_LOG_DIR=${KRW_LOG_DIR:-"$HOME/krw-ontology-log"}
VALUATION_REFRESH_LOG_DIR=${VALUATION_REFRESH_LOG_DIR:-"$KRW_LOG_DIR/valuation-refresh"}
if [ -z "$LOG_FILE" ]; then
  LOG_FILE="$VALUATION_REFRESH_LOG_DIR/valuation-refresh-$SAFE_WORKER_ID.log"
fi
mkdir -p "$(dirname "$LOG_FILE")"

echo "Starting valuation refresh worker..."
echo "Worker id: $WORKER_ID"
echo "Log file: $LOG_FILE"
echo "Working directory: $FRONT_DIR"

cd "$FRONT_DIR"
if [ "$ONCE" = "1" ] && [ -n "$TICKERS" ]; then
  exec node --env-file="$ENV_PATH" .worker/valuation-refresh-worker.mjs --once --tickers "$TICKERS" >>"$LOG_FILE" 2>&1
elif [ "$ONCE" = "1" ]; then
  exec node --env-file="$ENV_PATH" .worker/valuation-refresh-worker.mjs --once >>"$LOG_FILE" 2>&1
elif [ -n "$TICKERS" ]; then
  exec node --env-file="$ENV_PATH" .worker/valuation-refresh-worker.mjs --tickers "$TICKERS" >>"$LOG_FILE" 2>&1
else
  exec node --env-file="$ENV_PATH" .worker/valuation-refresh-worker.mjs >>"$LOG_FILE" 2>&1
fi
