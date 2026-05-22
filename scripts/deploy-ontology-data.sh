#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)

echo "scripts/deploy-ontology-data.sh is deprecated; forwarding to scripts/deploy-data-production.sh" >&2
exec "$SCRIPT_DIR/deploy-data-production.sh" "$@"
