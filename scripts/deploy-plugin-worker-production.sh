#!/bin/sh
set -eu

cat >&2 <<'EOF'
The Claude/plugin worker deployment path has been retired.
The frontend now uses the Rust krw-agent release and Supabase queue.
Use: npm run prod:deploy:full
For a prebuilt sealed release, use: npm run prod:deploy:safe -- --agent-release-root DIR
EOF
exit 2
