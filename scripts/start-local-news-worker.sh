#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/start-local-news-worker.sh [--env-file FILE] [--once] [--no-build] [--skip-preflight]

Run the Finnhub -> Z.ai -> Supabase local news worker.
EOF
}

ENV_FILE=.env.mac-worker.production
ONCE=0
BUILD=1
SKIP_PREFLIGHT=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE=${2:?Missing value for --env-file}
      shift
      ;;
    --once) ONCE=1 ;;
    --no-build) BUILD=0 ;;
    --skip-preflight) SKIP_PREFLIGHT=1 ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
  shift
done

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
case "$ENV_FILE" in
  /*) ENV_PATH=$ENV_FILE ;;
  *) ENV_PATH="$FRONT_DIR/$ENV_FILE" ;;
esac
[ -f "$ENV_PATH" ] || { echo "Missing local news worker env file: $ENV_PATH" >&2; exit 1; }

if [ "$BUILD" = "1" ]; then
  (cd "$FRONT_DIR" && npm run build:local-news-worker)
fi
if [ "$SKIP_PREFLIGHT" != "1" ]; then
  "$SCRIPT_DIR/local-news-worker-preflight.sh" --env-file "$ENV_PATH"
fi

WORKER_ID=$(node --env-file="$ENV_PATH" -e 'process.stdout.write(process.env.LOCAL_NEWS_WORKER_ID ?? "local-finnhub-news-worker");')
case "$WORKER_ID" in
  ''|*[!A-Za-z0-9._-]*) echo "Invalid LOCAL_NEWS_WORKER_ID: $WORKER_ID" >&2; exit 1 ;;
esac
SAFE_WORKER_ID=$(printf '%s' "$WORKER_ID" | tr -cs 'A-Za-z0-9_.-' '-' | sed 's/^-//; s/-$//')
LOCK_DIR="/tmp/krw-ontology-local-news-$SAFE_WORKER_ID.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Local news worker lock already exists: $LOCK_DIR" >&2
  echo "Refusing to start a duplicate worker." >&2
  exit 1
fi
cleanup() {
  status=$?
  rmdir "$LOCK_DIR" 2>/dev/null || true
  exit "$status"
}
trap cleanup EXIT INT TERM

cd "$FRONT_DIR"
if [ "$ONCE" = "1" ]; then
  node --env-file="$ENV_PATH" .worker/local-news-worker.mjs --once
  exit $?
fi
node --env-file="$ENV_PATH" .worker/local-news-worker.mjs
