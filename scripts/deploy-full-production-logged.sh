#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/deploy-full-production-logged.sh [OPTIONS] [DEPLOY_ALL_ARGS...]

Run the full production deployment with a persistent local log file.

Default behavior:
  - build/promote a local release through ~/krw-ontology/scripts/deploy-with-local-release.sh
  - publish the compact web catalog to Supabase
  - deploy frontend, plugin, and MCP code
  - write all output to ~/krw-deploy-logs/deploy-full-<timestamp>.log

Options:
  --help, -h                 Show this help.
  --queue-timeout SECONDS    Queue stop wait timeout. Default: 7200.

Examples:
  scripts/deploy-full-production-logged.sh
  scripts/deploy-full-production-logged.sh --apply-migrations
  scripts/deploy-full-production-logged.sh --queue-timeout 7200 --apply-migrations

Environment:
  KRW_DEPLOY_LOG_DIR                 Defaults to $HOME/krw-deploy-logs
  KRW_ONTOLOGY_DEPLOY_WITH_RELEASE   Defaults to $HOME/krw-ontology/scripts/deploy-with-local-release.sh
  KRW_FRONT_DEPLOY_ALL               Defaults to this repo's scripts/deploy-all-production.sh
EOF
}

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)

QUEUE_TIMEOUT=7200
DEPLOY_ALL_ARGS=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --queue-timeout)
      shift
      if [ "$#" -eq 0 ]; then
        usage >&2
        exit 1
      fi
      QUEUE_TIMEOUT=$1
      ;;
    *)
      DEPLOY_ALL_ARGS+=("$1")
      ;;
  esac
  shift
done

DEPLOY_WITH_RELEASE=${KRW_ONTOLOGY_DEPLOY_WITH_RELEASE:-"$HOME/krw-ontology/scripts/deploy-with-local-release.sh"}
DEPLOY_ALL=${KRW_FRONT_DEPLOY_ALL:-"$FRONT_DIR/scripts/deploy-all-production.sh"}
LOG_DIR=${KRW_DEPLOY_LOG_DIR:-"$HOME/krw-deploy-logs"}
LOG_FILE="$LOG_DIR/deploy-full-$(date +%Y%m%d-%H%M%S).log"

mkdir -p "$LOG_DIR"

run_deploy() {
  echo "Deployment started: $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "Log file: $LOG_FILE"
  echo "Frontend repo: $FRONT_DIR"
  echo "Deploy release script: $DEPLOY_WITH_RELEASE"
  echo "Deploy all script: $DEPLOY_ALL"
  echo "Queue timeout: $QUEUE_TIMEOUT"
  echo "Deploy all args: ${DEPLOY_ALL_ARGS[*]:-(none)}"
  echo

  "$DEPLOY_WITH_RELEASE" \
    --queue-timeout "$QUEUE_TIMEOUT" \
    -- \
    "$DEPLOY_ALL" \
    "${DEPLOY_ALL_ARGS[@]}"
}

set +e
run_deploy 2>&1 | tee "$LOG_FILE"
status=${PIPESTATUS[0]}
set -e

{
  echo
  echo "Deployment finished: $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "Exit status: $status"
  echo "Log file: $LOG_FILE"
} | tee -a "$LOG_FILE"

exit "$status"
