#!/bin/sh
set -eu

echo "Direct production Compose restarts are disabled because they bypass version-bound health and proxy-last activation." >&2
echo "Use npm run prod:deploy:code for a verified restart/cutover, or follow the documented break-glass rollback runbook." >&2
exit 1
