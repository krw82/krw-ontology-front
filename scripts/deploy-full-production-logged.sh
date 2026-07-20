#!/usr/bin/env bash
set -Eeuo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/deploy-full-production-logged.sh [OPTIONS] [DEPLOY_ALL_ARGS...]

Run the full production deployment with a persistent local log file.

Default behavior:
  - stop and verify the local ontology queue
  - run the one sealed data/schema/GCP/Mac cutover
  - never promote prod/current outside that sealed cutover
  - write all output to ~/krw-ontology-log/deploy/deploy-full-<timestamp>.log

Options:
  --help, -h                 Show this help.
  --queue-timeout SECONDS    Queue stop wait timeout. Default: 7200.

Examples:
  scripts/deploy-full-production-logged.sh
  scripts/deploy-full-production-logged.sh --apply-migrations
  scripts/deploy-full-production-logged.sh --bootstrap-unsealed-mac-runtime
  scripts/deploy-full-production-logged.sh --queue-timeout 7200 --apply-migrations

Environment:
  KRW_LOG_DIR                        Defaults to $HOME/krw-ontology-log
  KRW_DEPLOY_LOG_DIR                 Defaults to $KRW_LOG_DIR/deploy
  KRW_FRONT_DEPLOY_ALL               Defaults to this repo's queue-safe production wrapper
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

DEPLOY_ALL=${KRW_FRONT_DEPLOY_ALL:-"$FRONT_DIR/scripts/deploy-production-simple.sh"}
KRW_LOG_DIR=${KRW_LOG_DIR:-"$HOME/krw-ontology-log"}
LOG_DIR=${KRW_DEPLOY_LOG_DIR:-"$KRW_LOG_DIR/deploy"}
LOG_FILE="$LOG_DIR/deploy-full-$(date +%Y%m%d-%H%M%S).log"

mkdir -p "$LOG_DIR"

run_deploy() {
  echo "Deployment started: $(date '+%Y-%m-%d %H:%M:%S %Z')"
  echo "Log file: $LOG_FILE"
  echo "Frontend repo: $FRONT_DIR"
  echo "Queue-safe deploy script: $DEPLOY_ALL"
  echo "Queue timeout: $QUEUE_TIMEOUT"
  echo "Deploy all args: ${DEPLOY_ALL_ARGS[*]:-(none)}"
  echo

  "$DEPLOY_ALL" \
    --queue-timeout "$QUEUE_TIMEOUT" \
    --apply-migrations \
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
