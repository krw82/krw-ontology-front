#!/bin/sh
set -eu

cat >&2 <<'EOF'
The Mac legacy agent supervisor deployment path has been retired.
The frontend now uses the Rust krw-agent release and the Supabase queue.
For full production deploys, use: npm run prod:deploy:full
To remove an installed worker, run: scripts/uninstall-mac-worker-launchd.sh
EOF
exit 2
