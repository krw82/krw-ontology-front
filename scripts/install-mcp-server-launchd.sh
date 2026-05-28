#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/install-mcp-server-launchd.sh [--env-file FILE] [--load] [--dry-run]

Install the launchd plist for the long-running local KRW Ontology MCP HTTP
server. Pass --load to restart it immediately.
EOF
}

LOAD=0
DRY_RUN=0
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
TEMPLATE="$FRONT_DIR/ops/launchd/com.krwontology.mcp-server.plist.template"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST="$PLIST_DIR/com.krwontology.mcp-server.plist"
DOMAIN="gui/$(id -u)"
case "$ENV_FILE" in
  /*) ENV_PATH=$ENV_FILE ;;
  *) ENV_PATH="$FRONT_DIR/$ENV_FILE" ;;
esac

if [ ! -f "$ENV_PATH" ]; then
  echo "Missing Mac worker env file: $ENV_PATH. Run scripts/init-mac-worker-env.sh first." >&2
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

MCP_SERVER_NICE=${MCP_SERVER_NICE:-${MAC_WORKER_NICE:--5}}
MCP_LOG_DIR=${MCP_LOG_DIR:-"$HOME/Library/Logs/krw-ontology"}
MCP_SERVER_MAXFILES=${MCP_SERVER_MAXFILES:-4096}
case "$MCP_SERVER_NICE" in
  -[0-9]*|[0-9]*) ;;
  *)
    echo "MCP_SERVER_NICE must be an integer between -20 and 20: $MCP_SERVER_NICE" >&2
    exit 1
    ;;
esac
if [ "$MCP_SERVER_NICE" -lt -20 ] || [ "$MCP_SERVER_NICE" -gt 20 ]; then
  echo "MCP_SERVER_NICE must be between -20 and 20: $MCP_SERVER_NICE" >&2
  exit 1
fi
case "$MCP_SERVER_MAXFILES" in
  [0-9]*) ;;
  *)
    echo "MCP_SERVER_MAXFILES must be a positive integer: $MCP_SERVER_MAXFILES" >&2
    exit 1
    ;;
esac
if [ "$MCP_SERVER_MAXFILES" -lt 256 ]; then
  echo "MCP_SERVER_MAXFILES must be at least 256: $MCP_SERVER_MAXFILES" >&2
  exit 1
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would install $PLIST and load com.krwontology.mcp-server=$LOAD"
  exit 0
fi

mkdir -p "$PLIST_DIR" "$FRONT_DIR/logs" "$MCP_LOG_DIR"
sed \
  -e "s#__NICE__#$MCP_SERVER_NICE#g" \
  -e "s#__MAXFILES__#$MCP_SERVER_MAXFILES#g" \
  -e "s#__ENV_FILE__#$ENV_PATH#g" \
  -e "s#__LOG_DIR__#$MCP_LOG_DIR#g" \
  -e "s#__FRONT_DIR__#$FRONT_DIR#g" \
  "$TEMPLATE" > "$PLIST"
echo "Installed $PLIST"

if [ "$LOAD" != "1" ]; then
  echo "Not loaded. Start later with:"
  echo "  launchctl bootstrap $DOMAIN $PLIST"
  echo "  launchctl kickstart -k $DOMAIN/com.krwontology.mcp-server"
  exit 0
fi

launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl enable "$DOMAIN/com.krwontology.mcp-server"
launchctl kickstart -k "$DOMAIN/com.krwontology.mcp-server"

VERIFY_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/krw-mcp-prod-verify.XXXXXX")
verified=0
for _ in $(seq 1 30); do
  if "$SCRIPT_DIR/verify-mcp-server-production.sh" --env-file "$ENV_PATH" >"$VERIFY_OUTPUT" 2>&1; then
    verified=1
    break
  fi
  sleep 1
done
if [ "$verified" != "1" ]; then
  cat "$VERIFY_OUTPUT" >&2
  rm -f "$VERIFY_OUTPUT"
  echo "MCP server did not become healthy." >&2
  exit 1
fi
cat "$VERIFY_OUTPUT"
rm -f "$VERIFY_OUTPUT"
launchctl print "$DOMAIN/com.krwontology.mcp-server" | sed -n '1,50p'
echo "OK MCP server launchd service loaded"
