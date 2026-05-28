#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/uninstall-mcp-server-launchd.sh [--keep-plist]

Stop the Mac production MCP HTTP server launchd service. By default the plist
is removed after stopping.
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

PLIST="$HOME/Library/LaunchAgents/com.krwontology.mcp-server.plist"
DOMAIN="gui/$(id -u)"

if [ ! -e "$PLIST" ]; then
  echo "No MCP server launchd plist found."
  exit 0
fi

launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
if [ "$KEEP_PLIST" != "1" ]; then
  rm -f "$PLIST"
fi

echo "OK MCP server launchd service stopped."
