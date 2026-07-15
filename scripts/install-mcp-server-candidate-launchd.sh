#!/bin/sh
set -eu

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/install-mcp-server-candidate-launchd.sh --release-root DIR --plugin-path DIR [options]

Options:
  --env-file FILE   Base local production env (default: .env.mac-worker.production)
  --port PORT       Separate local candidate port (default: 8865)
  --label LABEL     Separate launchd label (default: com.krwontology.mcp-server-candidate)
  --load            Start and verify the service now
  --dry-run         Validate and show the intended service without writing it

This installer never stops or rewrites com.krwontology.mcp-server on port 8765.
EOF
}

ENV_FILE=.env.mac-worker.production
RELEASE_ROOT=
PLUGIN_PATH=
PORT=8865
LABEL=com.krwontology.mcp-server-candidate
LOAD=0
DRY_RUN=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE=${2:?Missing value for --env-file}
      shift
      ;;
    --release-root)
      RELEASE_ROOT=${2:?Missing value for --release-root}
      shift
      ;;
    --plugin-path)
      PLUGIN_PATH=${2:?Missing value for --plugin-path}
      shift
      ;;
    --port)
      PORT=${2:?Missing value for --port}
      shift
      ;;
    --label)
      LABEL=${2:?Missing value for --label}
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
TEMPLATE="$FRONT_DIR/ops/launchd/com.krwontology.mcp-server-candidate.plist.template"
PLIST_DIR="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"
PLIST="$PLIST_DIR/$LABEL.plist"
case "$ENV_FILE" in
  /*) ENV_PATH=$ENV_FILE ;;
  *) ENV_PATH="$FRONT_DIR/$ENV_FILE" ;;
esac

if [ "$LABEL" = "com.krwontology.mcp-server" ]; then
  echo "Refusing to reuse the canonical MCP launchd label." >&2
  exit 1
fi
case "$LABEL" in
  com.krwontology.mcp-server-[A-Za-z0-9._-]*) ;;
  *)
    echo "Candidate label must start with com.krwontology.mcp-server-: $LABEL" >&2
    exit 1
    ;;
esac
case "$PORT" in
  ''|*[!0-9]*)
    echo "Port must be an integer: $PORT" >&2
    exit 1
    ;;
esac
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ] || [ "$PORT" -eq 8765 ]; then
  echo "Candidate port must be 1-65535 and must not be canonical port 8765: $PORT" >&2
  exit 1
fi
if [ ! -d "$RELEASE_ROOT" ] || [ -L "$RELEASE_ROOT" ]; then
  echo "An immutable --release-root is required: ${RELEASE_ROOT:-unset}" >&2
  exit 1
fi
if [ ! -f "$PLUGIN_PATH/.krw-ontology-contract.json" ]; then
  echo "A materialized --plugin-path is required: ${PLUGIN_PATH:-unset}" >&2
  exit 1
fi
if [ ! -f "$ENV_PATH" ] || [ ! -f "$TEMPLATE" ]; then
  echo "Missing env file or launchd template." >&2
  exit 1
fi

RELEASE_ROOT=$(CDPATH= cd -- "$RELEASE_ROOT" && pwd -P)
PLUGIN_PATH=$(CDPATH= cd -- "$PLUGIN_PATH" && pwd -P)
case "$RELEASE_ROOT" in
  */releases/prod/[0-9]*) ;;
  *)
    echo "Candidate release must be an immutable prod release: $RELEASE_ROOT" >&2
    exit 1
    ;;
esac

set -a
# shellcheck disable=SC1090
. "$ENV_PATH"
set +a

: "${KRW_ONTOLOGY_SOURCE_DIR:?Missing KRW_ONTOLOGY_SOURCE_DIR}"
KRW_ONTOLOGY_UV_BIN=${KRW_ONTOLOGY_UV_BIN:-uv}
KRW_LAUNCHCTL_BIN=${KRW_LAUNCHCTL_BIN:-launchctl}
KRW_PLUTIL_BIN=${KRW_PLUTIL_BIN:-plutil}
KRW_LSOF_BIN=${KRW_LSOF_BIN:-lsof}
if [ ! -x "$KRW_ONTOLOGY_UV_BIN" ] && ! command -v "$KRW_ONTOLOGY_UV_BIN" >/dev/null 2>&1; then
  echo "Missing uv command: $KRW_ONTOLOGY_UV_BIN" >&2
  exit 1
fi
for command_path in "$KRW_LAUNCHCTL_BIN" "$KRW_PLUTIL_BIN" "$KRW_LSOF_BIN"; do
  if [ ! -x "$command_path" ] && ! command -v "$command_path" >/dev/null 2>&1; then
    echo "Missing candidate installer command: $command_path" >&2
    exit 1
  fi
done
KRW_ONTOLOGY_ENV=prod
KRW_ONTOLOGY_RELEASE_ROOT=$RELEASE_ROOT
KRW_ONTOLOGY_ROOT=$RELEASE_ROOT
KRW_ONTOLOGY_MANIFEST_PATH="$RELEASE_ROOT/manifest.json"
KRW_ONTOLOGY_GLOBAL_SPINE_PATH="$RELEASE_ROOT/indexes/global_spine.sqlite"
KRW_ONTOLOGY_SHARD_MANIFEST_PATH="$RELEASE_ROOT/indexes/shard_manifest.json"
export KRW_ONTOLOGY_ENV KRW_ONTOLOGY_RELEASE_ROOT KRW_ONTOLOGY_ROOT
export KRW_ONTOLOGY_MANIFEST_PATH KRW_ONTOLOGY_GLOBAL_SPINE_PATH
export KRW_ONTOLOGY_SHARD_MANIFEST_PATH
unset KRW_MCP_EXPECTED_CONTRACT_VERSION
unset KRW_MCP_EXPECTED_BUILD_ID
unset KRW_MCP_EXPECTED_BACKEND_GIT_SHA
unset KRW_MCP_EXPECTED_TOOL_SCHEMA_SHA256
unset KRW_MCP_EXPECTED_BUILD_FINGERPRINT_SHA256
unset KRW_MCP_EXPECTED_RELEASE_MANIFEST_SHA256
unset KRW_MCP_EXPECTED_SERVICE_FINGERPRINT_SHA256
KRW_LOG_DIR=${KRW_LOG_DIR:-"$HOME/krw-ontology-log"}
RELEASE_ID=$(basename "$RELEASE_ROOT")
DATA_ROOT=$(dirname "$(dirname "$(dirname "$RELEASE_ROOT")")")
RUNTIME_ROOT="$DATA_ROOT/runtime/mcp-candidates/$RELEASE_ID/current"
LOG_DIR="$KRW_LOG_DIR/mcp/prod/candidates/$RELEASE_ID-$PORT"
MCP_SERVER_NICE=${MCP_SERVER_NICE:-${MAC_WORKER_NICE:--5}}
MCP_SERVER_MAXFILES=${MCP_SERVER_MAXFILES:-4096}
VERIFY_ATTEMPTS=${MCP_CANDIDATE_VERIFY_ATTEMPTS:-45}
VERIFY_INTERVAL_SECONDS=${MCP_CANDIDATE_VERIFY_INTERVAL_SECONDS:-1}

case "$VERIFY_ATTEMPTS" in
  ''|*[!0-9]*|0)
    echo "MCP_CANDIDATE_VERIFY_ATTEMPTS must be a positive integer: $VERIFY_ATTEMPTS" >&2
    exit 1
    ;;
esac
case "$VERIFY_INTERVAL_SECONDS" in
  ''|*[!0-9]*)
    echo "MCP_CANDIDATE_VERIFY_INTERVAL_SECONDS must be a non-negative integer: $VERIFY_INTERVAL_SECONDS" >&2
    exit 1
    ;;
esac

for value in "$LABEL" "$ENV_PATH" "$RELEASE_ROOT" "$RUNTIME_ROOT" "$FRONT_DIR" "$LOG_DIR"; do
  case "$value" in
    *'#'*|*'&'*)
      echo "Unsupported character in launchd template value: $value" >&2
      exit 1
      ;;
  esac
done

"$KRW_ONTOLOGY_UV_BIN" --directory "$KRW_ONTOLOGY_SOURCE_DIR" run krw-ontology release verify \
  --startup-check \
  --root "$RELEASE_ROOT" \
  --env prod >/dev/null

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: label=$LABEL release=$RELEASE_ID port=$PORT runtime=$RUNTIME_ROOT plugin=$PLUGIN_PATH"
  exit 0
fi

mkdir -p "$PLIST_DIR" "$LOG_DIR" "$(dirname "$RUNTIME_ROOT")"
runtime_created=0
plist_created=0
service_started=0
install_complete=0
VERIFY_OUTPUT=
PLIST_CANDIDATE=$(mktemp "${TMPDIR:-/tmp}/krw-mcp-candidate-plist.XXXXXX")

cleanup_failed_install() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$status" -ne 0 ] && [ "$install_complete" != "1" ]; then
    if [ "$service_started" = "1" ]; then
      "$KRW_LAUNCHCTL_BIN" bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
    fi
    if [ "$plist_created" = "1" ]; then
      rm -f "$PLIST"
    fi
    if [ "$runtime_created" = "1" ]; then
      rm -f "$RUNTIME_ROOT"
    fi
    echo "Rolled back failed candidate install: label=$LABEL runtime=$RUNTIME_ROOT" >&2
  fi
  rm -f "$PLIST_CANDIDATE"
  if [ -n "$VERIFY_OUTPUT" ]; then
    rm -f "$VERIFY_OUTPUT"
  fi
  exit "$status"
}
trap cleanup_failed_install EXIT HUP INT TERM

if [ -L "$RUNTIME_ROOT" ]; then
  EXISTING_TARGET=$(CDPATH= cd -- "$RUNTIME_ROOT" && pwd -P)
  if [ "$EXISTING_TARGET" != "$RELEASE_ROOT" ]; then
    echo "Refusing to replace candidate runtime symlink: $RUNTIME_ROOT -> $EXISTING_TARGET" >&2
    exit 1
  fi
elif [ -e "$RUNTIME_ROOT" ]; then
  echo "Candidate runtime path exists and is not a symlink: $RUNTIME_ROOT" >&2
  exit 1
else
  ln -s "$RELEASE_ROOT" "$RUNTIME_ROOT"
  runtime_created=1
fi
sed \
  -e "s#__LABEL__#$LABEL#g" \
  -e "s#__ENV_FILE__#$ENV_PATH#g" \
  -e "s#__RELEASE_ROOT__#$RELEASE_ROOT#g" \
  -e "s#__RUNTIME_ROOT__#$RUNTIME_ROOT#g" \
  -e "s#__PORT__#$PORT#g" \
  -e "s#__NICE__#$MCP_SERVER_NICE#g" \
  -e "s#__MAXFILES__#$MCP_SERVER_MAXFILES#g" \
  -e "s#__FRONT_DIR__#$FRONT_DIR#g" \
  -e "s#__LOG_DIR__#$LOG_DIR#g" \
  "$TEMPLATE" > "$PLIST_CANDIDATE"
"$KRW_PLUTIL_BIN" -lint "$PLIST_CANDIDATE" >/dev/null
if [ -e "$PLIST" ]; then
  if ! cmp -s "$PLIST_CANDIDATE" "$PLIST"; then
    echo "Refusing to overwrite a different candidate launchd plist: $PLIST" >&2
    exit 1
  fi
else
  mv "$PLIST_CANDIDATE" "$PLIST"
  PLIST_CANDIDATE=
  plist_created=1
fi
echo "Installed $PLIST"

if [ "$LOAD" != "1" ]; then
  echo "Not loaded. Start later with: launchctl bootstrap $DOMAIN $PLIST"
  exit 0
fi

"$KRW_LAUNCHCTL_BIN" bootout "$DOMAIN/$LABEL" >/dev/null 2>&1 || true
if "$KRW_LSOF_BIN" -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Refusing to start: candidate port $PORT is already occupied." >&2
  "$KRW_LSOF_BIN" -nP -iTCP:"$PORT" -sTCP:LISTEN >&2 || true
  exit 1
fi

service_started=1
"$KRW_LAUNCHCTL_BIN" bootstrap "$DOMAIN" "$PLIST"
"$KRW_LAUNCHCTL_BIN" enable "$DOMAIN/$LABEL"
"$KRW_LAUNCHCTL_BIN" kickstart -k "$DOMAIN/$LABEL"

VERIFY_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/krw-mcp-candidate-verify.XXXXXX")
verified=0
for _ in $(seq 1 "$VERIFY_ATTEMPTS"); do
  if "$SCRIPT_DIR/verify-mcp-server-candidate.sh" \
    --env-file "$ENV_PATH" \
    --release-root "$RELEASE_ROOT" \
    --runtime-root "$RUNTIME_ROOT" \
    --plugin-path "$PLUGIN_PATH" \
    --port "$PORT" >"$VERIFY_OUTPUT" 2>&1; then
    verified=1
    break
  fi
  sleep "$VERIFY_INTERVAL_SECONDS"
done
if [ "$verified" != "1" ]; then
  cat "$VERIFY_OUTPUT" >&2
  echo "Candidate MCP did not become healthy; canonical MCP was not touched." >&2
  exit 1
fi
cat "$VERIFY_OUTPUT"
"$KRW_LAUNCHCTL_BIN" print "$DOMAIN/$LABEL" | sed -n '1,45p'
install_complete=1
echo "OK local candidate MCP launchd service loaded"
