#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)

echo "scripts/deploy-ontology-data.sh is deprecated; forwarding to the queue-safe catalog publisher." >&2
exec "$SCRIPT_DIR/deploy-production-simple.sh" --skip-code --skip-db-check "$@"
