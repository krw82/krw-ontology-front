#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/deploy-all-production.sh [--dry-run] [--replace-remote-data] [--skip-prune] [--skip-data] [--skip-code]

Deploy data, frontend, plugin, and MCP package changes to production.

Order:
  1. Data release deployment, if not skipped.
  2. Frontend + ~/krw-ontology sync and web image rebuild, if not skipped.
  3. Public health check.

On the current small VM, data deployment normally needs --replace-remote-data
because the disk cannot hold the old 25GB data release and a new one at once.
That flag stops web and removes old data releases before streaming the new data.
EOF
}

DRY_RUN=0
DEPLOY_DATA=1
DEPLOY_CODE=1
DATA_ARGS=""

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --dry-run)
      DRY_RUN=1
      DATA_ARGS="$DATA_ARGS --dry-run"
      ;;
    --replace-remote-data)
      DATA_ARGS="$DATA_ARGS --replace-remote-data"
      ;;
    --skip-prune)
      DATA_ARGS="$DATA_ARGS --skip-prune"
      ;;
    --skip-data)
      DEPLOY_DATA=0
      ;;
    --skip-code)
      DEPLOY_CODE=0
      ;;
    *)
      usage
      exit 1
      ;;
  esac
  shift
done

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)

if [ "$DEPLOY_DATA" = "1" ]; then
  # shellcheck disable=SC2086
  "$SCRIPT_DIR/deploy-data-production.sh" $DATA_ARGS
else
  echo "Skipping data deployment."
fi

if [ "$DEPLOY_CODE" = "1" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    "$SCRIPT_DIR/deploy-production.sh" --dry-run
  else
    "$SCRIPT_DIR/deploy-production.sh"
  fi
else
  echo "Skipping web/plugin deployment."
fi

echo "All requested production deployment steps complete."
