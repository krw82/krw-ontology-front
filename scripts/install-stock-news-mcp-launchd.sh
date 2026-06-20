#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/install-stock-news-mcp-launchd.sh [--env-file FILE] [--load] [--dry-run]

Install the launchd plist for the long-running local Stock News MCP
HTTP server. Without --load, this writes the plist only.
EOF
}

ENV_FILE=.env.mac-worker.production
LOAD=0
DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE=${2:?Missing value for --env-file}
      shift
      ;;
    --load)
      LOAD=1
      ;;
    --dry-run)
      DRY_RUN=1
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
TEMPLATE="$FRONT_DIR/ops/launchd/com.krwontology.stock-news-mcp.plist.template"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST="$PLIST_DIR/com.krwontology.stock-news-mcp.plist"
DOMAIN="gui/$(id -u)"

case "$ENV_FILE" in
  /*) ENV_PATH=$ENV_FILE ;;
  *) ENV_PATH="$FRONT_DIR/$ENV_FILE" ;;
esac

if [ ! -f "$ENV_PATH" ]; then
  echo "Missing Mac worker env file: $ENV_PATH" >&2
  exit 1
fi
if [ ! -f "$TEMPLATE" ]; then
  echo "Missing launchd template: $TEMPLATE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
. "$ENV_PATH"
set +a

truthy_env() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

falsey_env() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    0|false|no|off) return 0 ;;
    *) return 1 ;;
  esac
}

# Keep this service at normal priority unless explicitly configured. A user
# launchd service cannot raise priority with a negative nice value, and reusing
# MAC_WORKER_NICE=-5 here makes bootstrap look successful while the process
# immediately fails with "nice: setpriority: Permission denied".
STOCK_NEWS_MCP_NICE=${STOCK_NEWS_MCP_NICE:-0}
MCP_SERVER_MAXFILES=${MCP_SERVER_MAXFILES:-4096}
MCP_LOG_DIR=${MCP_LOG_DIR:-"$HOME/Library/Logs/krw-ontology"}
STOCK_NEWS_MCP_PORT=${STOCK_NEWS_MCP_PORT:-8775}

STOCK_NEWS_RUNTIME_ENABLED=1
if truthy_env "${STOCK_NEWS_FORCE_DISABLED:-}" || falsey_env "${STOCK_NEWS_ENABLED:-}"; then
  STOCK_NEWS_RUNTIME_ENABLED=0
elif [ -z "${FINNHUB_API_KEY:-}" ]; then
  if truthy_env "${STOCK_NEWS_ENABLED:-}"; then
    echo "STOCK_NEWS_ENABLED=1 but FINNHUB_API_KEY is missing in $ENV_PATH" >&2
    exit 1
  fi
  STOCK_NEWS_RUNTIME_ENABLED=0
fi

if [ "$STOCK_NEWS_RUNTIME_ENABLED" != "1" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    echo "Dry run: would disable Stock News MCP launchd service"
    exit 0
  fi

  echo "Stock News MCP disabled; unloading launchd service if present."
  launchctl bootout "$DOMAIN/com.krwontology.stock-news-mcp" >/dev/null 2>&1 || true
  launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  exit 0
fi

case "$STOCK_NEWS_MCP_NICE" in
  -[0-9]*|[0-9]*) ;;
  *) echo "STOCK_NEWS_MCP_NICE must be an integer between -20 and 20: $STOCK_NEWS_MCP_NICE" >&2; exit 1 ;;
esac
if [ "$STOCK_NEWS_MCP_NICE" -lt -20 ] || [ "$STOCK_NEWS_MCP_NICE" -gt 20 ]; then
  echo "STOCK_NEWS_MCP_NICE must be between -20 and 20: $STOCK_NEWS_MCP_NICE" >&2
  exit 1
fi
case "$MCP_SERVER_MAXFILES" in
  [0-9]*) ;;
  *) echo "MCP_SERVER_MAXFILES must be a positive integer: $MCP_SERVER_MAXFILES" >&2; exit 1 ;;
esac
if [ "$MCP_SERVER_MAXFILES" -lt 256 ]; then
  echo "MCP_SERVER_MAXFILES must be at least 256: $MCP_SERVER_MAXFILES" >&2
  exit 1
fi
case "$STOCK_NEWS_MCP_PORT" in
  [0-9]*) ;;
  *) echo "STOCK_NEWS_MCP_PORT must be a positive integer: $STOCK_NEWS_MCP_PORT" >&2; exit 1 ;;
esac
if [ "$STOCK_NEWS_MCP_PORT" -lt 1 ] || [ "$STOCK_NEWS_MCP_PORT" -gt 65535 ]; then
  echo "STOCK_NEWS_MCP_PORT must be between 1 and 65535: $STOCK_NEWS_MCP_PORT" >&2
  exit 1
fi

stock_news_listener_pids() {
  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi
  lsof -nP -tiTCP:"$STOCK_NEWS_MCP_PORT" -sTCP:LISTEN 2>/dev/null || true
}

is_managed_stock_news_listener() {
  pid=$1
  command=$(ps -p "$pid" -o command= 2>/dev/null || true)
  case "$command" in
    *"stock-news-mcp"*|*"node"*"dist/server.js"*) return 0 ;;
    *) return 1 ;;
  esac
}

wait_for_stock_news_port_release() {
  attempts=${1:-10}
  for _ in $(seq 1 "$attempts"); do
    if [ -z "$(stock_news_listener_pids)" ]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

stop_lingering_stock_news_listeners() {
  pids=$(stock_news_listener_pids)
  if [ -z "$pids" ]; then
    return 0
  fi

  for pid in $pids; do
    if ! is_managed_stock_news_listener "$pid"; then
      echo "Port $STOCK_NEWS_MCP_PORT is occupied by an unmanaged process: pid=$pid" >&2
      ps -p "$pid" -o pid,command= >&2 || true
      return 1
    fi
    echo "Stopping lingering Stock News MCP listener pid=$pid on port $STOCK_NEWS_MCP_PORT"
    kill "$pid" >/dev/null 2>&1 || true
  done

  if wait_for_stock_news_port_release 5; then
    return 0
  fi

  pids=$(stock_news_listener_pids)
  for pid in $pids; do
    if ! is_managed_stock_news_listener "$pid"; then
      echo "Port $STOCK_NEWS_MCP_PORT is still occupied by an unmanaged process: pid=$pid" >&2
      ps -p "$pid" -o pid,command= >&2 || true
      return 1
    fi
    echo "Force stopping lingering Stock News MCP listener pid=$pid on port $STOCK_NEWS_MCP_PORT"
    kill -KILL "$pid" >/dev/null 2>&1 || true
  done

  wait_for_stock_news_port_release 5
}

print_recent_stock_news_logs() {
  echo "Recent Stock News MCP stdout:" >&2
  tail -40 "$MCP_LOG_DIR/stock-news-mcp-prod.out.log" >&2 2>/dev/null || true
  echo "Recent Stock News MCP stderr:" >&2
  tail -40 "$MCP_LOG_DIR/stock-news-mcp-prod.err.log" >&2 2>/dev/null || true
}

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would install $PLIST and load com.krwontology.stock-news-mcp=$LOAD"
  echo "  nice=$STOCK_NEWS_MCP_NICE port=$STOCK_NEWS_MCP_PORT logs=$MCP_LOG_DIR"
  exit 0
fi

mkdir -p "$PLIST_DIR" "$MCP_LOG_DIR"

sed \
  -e "s#__FRONT_DIR__#$FRONT_DIR#g" \
  -e "s#__LOG_DIR__#$MCP_LOG_DIR#g" \
  -e "s#__NICE__#$STOCK_NEWS_MCP_NICE#g" \
  -e "s#__MAXFILES__#$MCP_SERVER_MAXFILES#g" \
  "$TEMPLATE" > "$PLIST"

echo "Installed $PLIST"

if [ "$LOAD" != "1" ]; then
  echo "To load now:"
  echo "  launchctl bootstrap $DOMAIN $PLIST 2>/dev/null || true"
  echo "  launchctl kickstart -k $DOMAIN/com.krwontology.stock-news-mcp"
  exit 0
fi

launchctl bootout "$DOMAIN/com.krwontology.stock-news-mcp" >/dev/null 2>&1 || true
launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
if ! wait_for_stock_news_port_release 10; then
  stop_lingering_stock_news_listeners
fi

BOOTSTRAP_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/stock-news-mcp-bootstrap.XXXXXX")
VERIFY_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/stock-news-mcp-verify.XXXXXX")
trap 'rm -f "$BOOTSTRAP_OUTPUT" "$VERIFY_OUTPUT"' EXIT INT TERM

if ! launchctl bootstrap "$DOMAIN" "$PLIST" >"$BOOTSTRAP_OUTPUT" 2>&1; then
  cat "$BOOTSTRAP_OUTPUT" >&2
  print_recent_stock_news_logs
  exit 1
fi

launchctl enable "$DOMAIN/com.krwontology.stock-news-mcp"
launchctl kickstart -k "$DOMAIN/com.krwontology.stock-news-mcp"

verified=0
for _ in $(seq 1 30); do
  if "$SCRIPT_DIR/verify-stock-news-mcp-production.sh" --env-file "$ENV_PATH" >"$VERIFY_OUTPUT" 2>&1; then
    verified=1
    break
  fi
  sleep 1
done

if [ "$verified" != "1" ]; then
  cat "$VERIFY_OUTPUT" >&2
  if ! launchctl print "$DOMAIN/com.krwontology.stock-news-mcp" | sed -n '1,80p'; then
    echo "Stock News MCP launchd service is not registered after bootstrap." >&2
  fi
  print_recent_stock_news_logs
  echo "Stock News MCP server did not become healthy." >&2
  exit 1
fi

cat "$VERIFY_OUTPUT"
launchctl print "$DOMAIN/com.krwontology.stock-news-mcp" | sed -n '1,50p'
echo "OK Stock News MCP launchd service loaded"
