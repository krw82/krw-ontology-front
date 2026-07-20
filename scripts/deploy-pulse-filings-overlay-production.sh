#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
echo "The partial production overlay was retired: it bypassed sealed source, schema, Mac, and rollback invariants." >&2
echo "Forwarding to the atomic queue-safe code cutover." >&2
exec "$SCRIPT_DIR/deploy-production-simple.sh" --skip-data --apply-migrations "$@"
