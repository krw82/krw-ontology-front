#!/bin/sh
set -eu

# Compatibility entrypoint for the regular, reversible production path.
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
exec "$SCRIPT_DIR/deploy-production-fast.sh" --apply-migrations "$@"
