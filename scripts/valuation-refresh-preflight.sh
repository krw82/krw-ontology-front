#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/valuation-refresh-preflight.sh [--env-file FILE] [--worker-id ID]

Validate the local valuation refresh worker environment without calling FMP.
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

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required for the valuation refresh worker." >&2
  exit 1
fi

env_value() {
  node --env-file="$ENV_PATH" -e \
    'const key = process.argv[1]; process.stdout.write(process.env[key] ?? "");' \
    "$1"
}

FMP_API_KEY=${FMP_API_KEY:-$(env_value FMP_API_KEY)}
SUPABASE_URL=${SUPABASE_URL:-$(env_value SUPABASE_URL)}
SUPABASE_SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY:-$(env_value SUPABASE_SERVICE_ROLE_KEY)}

if [ -z "${FMP_API_KEY:-}" ]; then
  echo "Missing FMP_API_KEY in $ENV_PATH" >&2
  exit 1
fi
if [ -z "${SUPABASE_URL:-}" ]; then
  echo "Missing SUPABASE_URL in $ENV_PATH" >&2
  exit 1
fi
if [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "Missing SUPABASE_SERVICE_ROLE_KEY in $ENV_PATH" >&2
  exit 1
fi

case "$FMP_API_KEY" in
  fmp-placeholder|placeholder|"<"*">")
    echo "FMP_API_KEY is still a placeholder." >&2
    exit 1
    ;;
esac

case "$SUPABASE_URL" in
  http://*|https://*) ;;
  *)
    echo "SUPABASE_URL must start with http:// or https://." >&2
    exit 1
    ;;
esac

VALUATION_REFRESH_WORKER_ID=${VALUATION_REFRESH_WORKER_ID:-$(env_value VALUATION_REFRESH_WORKER_ID)}
WORKER_ID=${WORKER_ID_OVERRIDE:-${VALUATION_REFRESH_WORKER_ID:-valuation-refresh-local}}
case "$WORKER_ID" in
  ''|*[!A-Za-z0-9._-]*)
    echo "Invalid valuation worker id: $WORKER_ID" >&2
    exit 1
    ;;
esac

VALUATION_REFRESH_INTERVAL_MS=${VALUATION_REFRESH_INTERVAL_MS:-$(env_value VALUATION_REFRESH_INTERVAL_MS)}
VALUATION_REFRESH_BATCH_SIZE=${VALUATION_REFRESH_BATCH_SIZE:-$(env_value VALUATION_REFRESH_BATCH_SIZE)}
INTERVAL_MS=${VALUATION_REFRESH_INTERVAL_MS:-3600000}
BATCH_SIZE=${VALUATION_REFRESH_BATCH_SIZE:-20}
case "$INTERVAL_MS" in
  ''|*[!0-9]*) echo "VALUATION_REFRESH_INTERVAL_MS must be an integer." >&2; exit 1 ;;
esac
case "$BATCH_SIZE" in
  ''|*[!0-9]*) echo "VALUATION_REFRESH_BATCH_SIZE must be an integer." >&2; exit 1 ;;
esac
if [ "$INTERVAL_MS" -lt 60000 ] || [ "$INTERVAL_MS" -gt 86400000 ]; then
  echo "VALUATION_REFRESH_INTERVAL_MS must be between 60000 and 86400000." >&2
  exit 1
fi
if [ "$BATCH_SIZE" -lt 1 ] || [ "$BATCH_SIZE" -gt 100 ]; then
  echo "VALUATION_REFRESH_BATCH_SIZE must be between 1 and 100." >&2
  exit 1
fi

BUNDLE="$FRONT_DIR/.worker/valuation-refresh-worker.mjs"
if [ ! -f "$BUNDLE" ]; then
  echo "Missing worker bundle: $BUNDLE. Run npm run build:worker first." >&2
  exit 1
fi

KRW_LOG_DIR=${KRW_LOG_DIR:-$(env_value KRW_LOG_DIR)}
KRW_LOG_DIR=${KRW_LOG_DIR:-"$HOME/krw-ontology-log"}
VALUATION_REFRESH_LOG_DIR=${VALUATION_REFRESH_LOG_DIR:-$(env_value VALUATION_REFRESH_LOG_DIR)}
VALUATION_REFRESH_LOG_DIR=${VALUATION_REFRESH_LOG_DIR:-"$KRW_LOG_DIR/valuation-refresh"}
mkdir -p "$VALUATION_REFRESH_LOG_DIR"
if [ ! -w "$VALUATION_REFRESH_LOG_DIR" ]; then
  echo "Valuation worker log directory is not writable: $VALUATION_REFRESH_LOG_DIR" >&2
  exit 1
fi

echo "OK valuation worker preflight"
echo "  env_file=$ENV_PATH"
echo "  worker_id=$WORKER_ID"
echo "  interval_ms=$INTERVAL_MS"
echo "  batch_size=$BATCH_SIZE"
echo "  supabase_url=$SUPABASE_URL"
echo "  log_dir=$VALUATION_REFRESH_LOG_DIR"
