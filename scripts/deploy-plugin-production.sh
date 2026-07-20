#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
echo "The independent GCP plugin lane was retired: production code is one sealed GCP+Mac cutover." >&2
echo "Forwarding to the atomic queue-safe code cutover." >&2
exec "$SCRIPT_DIR/deploy-production-simple.sh" --skip-data --apply-migrations "$@"
