#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/uninstall-stock-news-mcp-launchd.sh [--keep-plist]

Stop the local Stock News MCP launchd service. By default the plist is
removed after unloading.
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
PLIST="$HOME/Library/LaunchAgents/com.krwontology.stock-news-mcp.plist"

launchctl bootout "$DOMAIN/com.krwontology.stock-news-mcp" >/dev/null 2>&1 || true

if [ "$KEEP_PLIST" != "1" ] && [ -f "$PLIST" ]; then
  rm -f "$PLIST"
fi

echo "OK Stock News MCP launchd service stopped."
