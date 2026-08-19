#!/bin/sh
set -eu

cat >&2 <<'EOF'
The Mac legacy agent supervisor preflight path has been retired.
The frontend now uses the Rust krw-agent release and the Supabase queue.
To remove an installed worker, run: scripts/uninstall-mac-worker-launchd.sh
EOF
exit 2
