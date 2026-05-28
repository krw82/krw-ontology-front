#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/uninstall-mcp-server-dev-launchd.sh [--keep-plist]

Stop the local KRW Ontology dev MCP launchd service. By default the plist is
removed after stopping.
EOF
}

KEEP_PLIST=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --keep-plist)
      KEEP_PLIST=1
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

DOMAIN="gui/$(id -u)"
PLIST="$HOME/Library/LaunchAgents/com.krwontology.mcp-server-dev.plist"

if [ ! -f "$PLIST" ]; then
  echo "No dev MCP server launchd plist found."
  exit 0
fi

launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
if [ "$KEEP_PLIST" != "1" ]; then
  rm -f "$PLIST"
fi
echo "OK dev MCP server launchd service stopped."
