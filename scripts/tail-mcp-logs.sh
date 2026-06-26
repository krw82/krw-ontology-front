#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/tail-mcp-logs.sh prod|dev

Tail the local long-running KRW Ontology MCP logs.
EOF
}

if [ "$#" -ne 1 ]; then
  usage >&2
  exit 1
fi

case "$1" in
  prod|dev)
    ENV_NAME=$1
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

KRW_LOG_DIR=${KRW_LOG_DIR:-"$HOME/krw-ontology-log"}
MCP_LOG_DIR=${MCP_LOG_DIR:-"$KRW_LOG_DIR/mcp/$ENV_NAME"}
APP_LOG="$MCP_LOG_DIR/mcp-$ENV_NAME.log"
OUT_LOG="$MCP_LOG_DIR/mcp-$ENV_NAME.out.log"
ERR_LOG="$MCP_LOG_DIR/mcp-$ENV_NAME.err.log"

mkdir -p "$MCP_LOG_DIR"
touch "$APP_LOG" "$OUT_LOG" "$ERR_LOG"
exec tail -f "$APP_LOG" "$OUT_LOG" "$ERR_LOG"
