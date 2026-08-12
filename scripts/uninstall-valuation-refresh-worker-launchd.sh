#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/uninstall-valuation-refresh-worker-launchd.sh [--keep-plist]

Stop the local valuation refresh launchd service. By default the plist is
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

PLIST="$HOME/Library/LaunchAgents/com.krwontology.valuation-refresh-worker.plist"
DOMAIN="gui/$(id -u)"

if [ ! -f "$PLIST" ]; then
  echo "No valuation refresh launchd plist found."
  exit 0
fi

if command -v launchctl >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
fi
if [ "$KEEP_PLIST" != "1" ]; then
  rm -f "$PLIST"
fi
echo "OK valuation refresh launchd service stopped."
