#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/install-filings-mcp-launchd.sh [--env-file FILE] [--load] [--dry-run]

Install the local launchd service for the internal, on-demand SEC filings MCP.
When disabled, it removes/stops any previously installed service instead.
EOF
}

LOAD=0
DRY_RUN=0
ENV_FILE=.env.mac-worker.production
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE=${2:?Missing value for --env-file}; shift ;;
    --load) LOAD=1 ;;
    --dry-run) DRY_RUN=1 ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
  shift
done

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
TEMPLATE="$FRONT_DIR/ops/launchd/com.krwontology.filings-mcp.plist.template"
PLIST_DIR="$HOME/Library/LaunchAgents"
LABEL=com.krwontology.filings-mcp
PLIST="$PLIST_DIR/$LABEL.plist"
DOMAIN="gui/$(id -u)"
case "$ENV_FILE" in
  /*) ENV_PATH=$ENV_FILE ;;
  *) ENV_PATH="$FRONT_DIR/$ENV_FILE" ;;
esac

if [ ! -f "$ENV_PATH" ]; then
  echo "Missing Mac worker env file: $ENV_PATH" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "$ENV_PATH"
set +a

MAC_RUNTIME_ROOT=${KRW_MAC_RUNTIME_ROOT:-$FRONT_DIR}
if [ ! -f "$MAC_RUNTIME_ROOT/scripts/start-filings-mcp-production.sh" ]; then
  echo "Missing Mac runtime filings MCP start script: $MAC_RUNTIME_ROOT" >&2
  exit 1
fi

is_enabled=0
case "$(printf '%s' "${FILINGS_MCP_ENABLED:-}" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on) is_enabled=1 ;;
esac

if [ "$is_enabled" = "0" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    echo "Dry run: would stop/remove $LABEL because FILINGS_MCP_ENABLED is false."
    exit 0
  fi
  launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
  rm -f "$PLIST"
  echo "On-demand filings MCP is disabled; no launchd service is installed."
  exit 0
fi

require_env() {
  key=$1
  eval "value=\${$key:-}"
  if [ -z "$value" ]; then
    echo "Missing required env value: $key" >&2
    exit 1
  fi
}
for key in SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SEC_USER_AGENT FILINGS_MCP_AUTH_TOKEN FILINGS_MCP_PERSONAL_SIGNING_SECRET; do
  require_env "$key"
done
if [ "$FILINGS_MCP_PERSONAL_SIGNING_SECRET" = "$FILINGS_MCP_AUTH_TOKEN" ]; then
  echo "FILINGS_MCP_PERSONAL_SIGNING_SECRET must be distinct from FILINGS_MCP_AUTH_TOKEN" >&2
  exit 1
fi
if [ ! -f "$TEMPLATE" ]; then
  echo "Missing launchd template: $TEMPLATE" >&2
  exit 1
fi

FILINGS_MCP_PORT=${FILINGS_MCP_PORT:-8785}
FILINGS_MCP_HOST=${FILINGS_MCP_HOST:-127.0.0.1}
FILINGS_MCP_NICE=${FILINGS_MCP_NICE:-${MAC_WORKER_NICE:--5}}
KRW_LOG_DIR=${KRW_LOG_DIR:-"$HOME/krw-ontology-log"}
FILINGS_MCP_LOG_DIR=${FILINGS_MCP_LOG_DIR:-"$KRW_LOG_DIR/filings-mcp/prod"}
case "$FILINGS_MCP_PORT" in
  ''|*[!0-9]*) echo "FILINGS_MCP_PORT must be a port number" >&2; exit 1 ;;
esac
if [ "$FILINGS_MCP_PORT" -lt 1 ] || [ "$FILINGS_MCP_PORT" -gt 65535 ]; then
  echo "FILINGS_MCP_PORT must be between 1 and 65535" >&2
  exit 1
fi
KRW_FILINGS_MCP_URL=${KRW_FILINGS_MCP_URL:-"http://127.0.0.1:$FILINGS_MCP_PORT/mcp"}
export KRW_FILINGS_MCP_URL FILINGS_MCP_PORT FILINGS_MCP_HOST
node <<'NODE'
const url = new URL(process.env.KRW_FILINGS_MCP_URL);
const expectedPort = String(process.env.FILINGS_MCP_PORT);
if (!["127.0.0.1", "::1"].includes(process.env.FILINGS_MCP_HOST)) {
  throw new Error("Mac FILINGS_MCP_HOST must be a loopback address");
}
if (!["http:", "https:"].includes(url.protocol) || !["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) {
  throw new Error("KRW_FILINGS_MCP_URL must be a local HTTP(S) URL");
}
if (url.port !== expectedPort || url.pathname.replace(/\/+$/, "") !== "/mcp") {
  throw new Error("KRW_FILINGS_MCP_URL must match FILINGS_MCP_PORT and end at /mcp");
}
NODE

listener_pids() {
  command -v lsof >/dev/null 2>&1 || return 0
  lsof -nP -tiTCP:"$FILINGS_MCP_PORT" -sTCP:LISTEN 2>/dev/null || true
}
is_managed_listener() {
  command=$(ps -p "$1" -o command= 2>/dev/null || true)
  case "$command" in *".worker/filings-mcp-server.mjs"*) return 0 ;; *) return 1 ;; esac
}
stop_managed_listeners() {
  pids=$(listener_pids)
  for pid in $pids; do
    if ! is_managed_listener "$pid"; then
      echo "Port $FILINGS_MCP_PORT is occupied by an unmanaged process: pid=$pid" >&2
      ps -p "$pid" -o pid,command= >&2 || true
      exit 1
    fi
    kill "$pid" >/dev/null 2>&1 || true
  done
  for _ in $(seq 1 10); do
    [ -z "$(listener_pids)" ] && return 0
    sleep 1
  done
  echo "Unable to release filings MCP port $FILINGS_MCP_PORT" >&2
  exit 1
}

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would install $PLIST and load $LABEL=$LOAD"
  exit 0
fi

mkdir -p "$PLIST_DIR" "$FILINGS_MCP_LOG_DIR"
sed \
  -e "s#__NICE__#$FILINGS_MCP_NICE#g" \
  -e "s#__ENV_FILE__#$ENV_PATH#g" \
  -e "s#__FRONT_DIR__#$MAC_RUNTIME_ROOT#g" \
  -e "s#__LOG_DIR__#$FILINGS_MCP_LOG_DIR#g" \
  "$TEMPLATE" > "$PLIST"
echo "Installed $PLIST"

if [ "$LOAD" != "1" ]; then
  exit 0
fi

launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
stop_managed_listeners
launchctl bootstrap "$DOMAIN" "$PLIST"
launchctl enable "$DOMAIN/$LABEL"
launchctl kickstart -k "$DOMAIN/$LABEL"

verified=0
VERIFY_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/krw-filings-mcp-verify.XXXXXX")
for _ in $(seq 1 30); do
  if "$SCRIPT_DIR/verify-filings-mcp-production.sh" --env-file "$ENV_PATH" >"$VERIFY_OUTPUT" 2>&1; then
    verified=1
    break
  fi
  sleep 1
done
if [ "$verified" != "1" ]; then
  cat "$VERIFY_OUTPUT" >&2
  rm -f "$VERIFY_OUTPUT"
  echo "On-demand filings MCP did not become healthy." >&2
  exit 1
fi
cat "$VERIFY_OUTPUT"
rm -f "$VERIFY_OUTPUT"
launchctl print "$DOMAIN/$LABEL" | sed -n '1,40p'
echo "OK on-demand filings MCP launchd service loaded"
