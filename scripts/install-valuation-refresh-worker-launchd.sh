#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/install-valuation-refresh-worker-launchd.sh [options]

Options:
  --env-file FILE       Environment file (default: .env.mac-worker.production)
  --worker-id ID        Override VALUATION_REFRESH_WORKER_ID
  --load                Bootstrap and kickstart the launchd service
  --dry-run             Validate inputs without writing the plist
  --skip-preflight      Skip the environment and worker-bundle checks
EOF
}

ENV_FILE=.env.mac-worker.production
WORKER_ID_OVERRIDE=
LOAD=0
DRY_RUN=0
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
    --load)
      LOAD=1
      ;;
    --dry-run)
      DRY_RUN=1
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
TEMPLATE="$FRONT_DIR/ops/launchd/com.krwontology.valuation-refresh-worker.plist.template"
PLIST_DIR="$HOME/Library/LaunchAgents"
LAUNCHD_DOMAIN="gui/$(id -u)"
LABEL="com.krwontology.valuation-refresh-worker"
PLIST="$PLIST_DIR/$LABEL.plist"

case "$ENV_FILE" in
  /*) ENV_PATH=$ENV_FILE ;;
  *) ENV_PATH="$FRONT_DIR/$ENV_FILE" ;;
esac

if [ ! -f "$TEMPLATE" ]; then
  echo "Missing launchd template: $TEMPLATE" >&2
  exit 1
fi
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
WORKER_ID=${WORKER_ID_OVERRIDE:-${VALUATION_REFRESH_WORKER_ID:-valuation-refresh-local}}
case "$WORKER_ID" in
  ''|*[!A-Za-z0-9._-]*)
    echo "Invalid valuation worker id: $WORKER_ID" >&2
    exit 1
    ;;
esac

KRW_LOG_DIR=${KRW_LOG_DIR:-$(env_value KRW_LOG_DIR)}
KRW_LOG_DIR=${KRW_LOG_DIR:-"$HOME/krw-ontology-log"}
VALUATION_REFRESH_LOG_DIR=${VALUATION_REFRESH_LOG_DIR:-$(env_value VALUATION_REFRESH_LOG_DIR)}
WORKER_LOG_DIR=${VALUATION_REFRESH_LOG_DIR:-"$KRW_LOG_DIR/valuation-refresh"}
VALUATION_REFRESH_NICE=${VALUATION_REFRESH_NICE:-$(env_value VALUATION_REFRESH_NICE)}
VALUATION_REFRESH_NICE=${VALUATION_REFRESH_NICE:-10}
VALUATION_REFRESH_MAXFILES=${VALUATION_REFRESH_MAXFILES:-$(env_value VALUATION_REFRESH_MAXFILES)}
VALUATION_REFRESH_MAXFILES=${VALUATION_REFRESH_MAXFILES:-4096}

case "$VALUATION_REFRESH_NICE" in
  -[0-9]*|[0-9]*) ;;
  *)
    echo "VALUATION_REFRESH_NICE must be an integer between -20 and 20: $VALUATION_REFRESH_NICE" >&2
    exit 1
    ;;
esac
if [ "$VALUATION_REFRESH_NICE" -lt -20 ] || [ "$VALUATION_REFRESH_NICE" -gt 20 ]; then
  echo "VALUATION_REFRESH_NICE must be between -20 and 20: $VALUATION_REFRESH_NICE" >&2
  exit 1
fi
case "$VALUATION_REFRESH_MAXFILES" in
  [0-9]*) ;;
  *)
    echo "VALUATION_REFRESH_MAXFILES must be a positive integer: $VALUATION_REFRESH_MAXFILES" >&2
    exit 1
    ;;
esac
if [ "$VALUATION_REFRESH_MAXFILES" -lt 256 ]; then
  echo "VALUATION_REFRESH_MAXFILES must be at least 256: $VALUATION_REFRESH_MAXFILES" >&2
  exit 1
fi

if [ "$SKIP_PREFLIGHT" != "1" ]; then
  if [ -n "$WORKER_ID_OVERRIDE" ]; then
    "$SCRIPT_DIR/valuation-refresh-preflight.sh" --env-file "$ENV_FILE" --worker-id "$WORKER_ID_OVERRIDE"
  else
    "$SCRIPT_DIR/valuation-refresh-preflight.sh" --env-file "$ENV_FILE"
  fi
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would install $PLIST"
  echo "  label=$LABEL"
  echo "  worker_id=$WORKER_ID"
  echo "  env_file=$ENV_PATH"
  echo "  log_dir=$WORKER_LOG_DIR"
  echo "  load=$LOAD"
  exit 0
fi

mkdir -p "$PLIST_DIR" "$WORKER_LOG_DIR"
sed \
  -e "s#__LABEL__#$LABEL#g" \
  -e "s#__WORKER_ID__#$WORKER_ID#g" \
  -e "s#__NICE__#$VALUATION_REFRESH_NICE#g" \
  -e "s#__MAXFILES__#$VALUATION_REFRESH_MAXFILES#g" \
  -e "s#__ENV_FILE__#$ENV_PATH#g" \
  -e "s#__FRONT_DIR__#$FRONT_DIR#g" \
  -e "s#__WORKER_LOG_DIR__#$WORKER_LOG_DIR#g" \
  "$TEMPLATE" > "$PLIST"
echo "Installed $PLIST"

if [ "$LOAD" != "1" ]; then
  echo "Not loaded. Start later with:"
  echo "  launchctl bootstrap $LAUNCHD_DOMAIN $PLIST"
  echo "  launchctl kickstart -k $LAUNCHD_DOMAIN/$LABEL"
  exit 0
fi

if ! command -v launchctl >/dev/null 2>&1; then
  echo "launchctl is required for --load (run this command on macOS)." >&2
  exit 1
fi

launchctl bootout "$LAUNCHD_DOMAIN" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "$LAUNCHD_DOMAIN" "$PLIST"
launchctl enable "$LAUNCHD_DOMAIN/$LABEL"
launchctl kickstart -k "$LAUNCHD_DOMAIN/$LABEL"
launchctl print "$LAUNCHD_DOMAIN/$LABEL" | sed -n '1,60p'
echo "OK valuation refresh worker launchd service loaded: $WORKER_ID"
