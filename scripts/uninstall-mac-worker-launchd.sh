#!/bin/sh
set -eu
PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$HOME/.local/bin:${PATH:-}"
export PATH

usage() {
  cat <<'EOF'
Usage: scripts/uninstall-mac-worker-launchd.sh [--keep-plist]

Stop all Mac production worker launchd services. By default installed plists
are removed after stopping.
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

PLIST_DIR="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"

found=0
for plist in "$PLIST_DIR"/com.krwontology.agent-worker*.plist; do
  if [ ! -e "$plist" ]; then
    continue
  fi
  found=1
  launchctl bootout "$DOMAIN" "$plist" >/dev/null 2>&1 || true
  if [ "$KEEP_PLIST" != "1" ]; then
    rm -f "$plist"
  fi
done

if [ "$found" = "0" ]; then
  echo "No Mac worker launchd plists found."
  exit 0
fi

echo "OK Mac worker launchd services stopped."
