#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/install-stock-news-zai-mcp-launchd.sh [--env-file FILE] [--load] [--dry-run]

Install the launchd plist for the long-running local Stock News Z.ai MCP
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
TEMPLATE="$FRONT_DIR/ops/launchd/com.krwontology.stock-news-zai-mcp.plist.template"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST="$PLIST_DIR/com.krwontology.stock-news-zai-mcp.plist"
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

STOCK_NEWS_MCP_NICE=${STOCK_NEWS_MCP_NICE:-${MCP_SERVER_NICE:-${MAC_WORKER_NICE:--5}}}
MCP_SERVER_MAXFILES=${MCP_SERVER_MAXFILES:-4096}
MCP_LOG_DIR=${MCP_LOG_DIR:-"$HOME/Library/Logs/krw-ontology"}

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

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would install $PLIST and load com.krwontology.stock-news-zai-mcp=$LOAD"
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
  echo "  launchctl kickstart -k $DOMAIN/com.krwontology.stock-news-zai-mcp"
  exit 0
fi

launchctl bootout "$DOMAIN/com.krwontology.stock-news-zai-mcp" >/dev/null 2>&1 || true
BOOTSTRAP_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/stock-news-zai-mcp-bootstrap.XXXXXX")
trap 'rm -f "$BOOTSTRAP_OUTPUT"' EXIT INT TERM

BOOTSTRAPPED=0
for _ in 1 2 3 4 5; do
  if launchctl bootstrap "$DOMAIN" "$PLIST" >"$BOOTSTRAP_OUTPUT" 2>&1; then
    BOOTSTRAPPED=1
    break
  fi
  if launchctl print "$DOMAIN/com.krwontology.stock-news-zai-mcp" >/dev/null 2>&1; then
    BOOTSTRAPPED=1
    break
  fi
  sleep 1
done
if [ "$BOOTSTRAPPED" != "1" ]; then
  cat "$BOOTSTRAP_OUTPUT" >&2
  exit 1
fi

launchctl enable "$DOMAIN/com.krwontology.stock-news-zai-mcp"

VERIFY_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/stock-news-zai-mcp-verify.XXXXXX")
trap 'rm -f "$BOOTSTRAP_OUTPUT" "$VERIFY_OUTPUT"' EXIT INT TERM
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if "$SCRIPT_DIR/verify-stock-news-zai-mcp-production.sh" --env-file "$ENV_PATH" >"$VERIFY_OUTPUT" 2>&1; then
    cat "$VERIFY_OUTPUT"
    echo "OK Stock News Z.ai MCP launchd service loaded"
    exit 0
  fi
  sleep 1
done

cat "$VERIFY_OUTPUT" >&2
launchctl print "$DOMAIN/com.krwontology.stock-news-zai-mcp" | sed -n '1,50p'
exit 1
