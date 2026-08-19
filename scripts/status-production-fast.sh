#!/bin/sh
set -e

usage() {
  cat <<'EOF'
Usage: scripts/status-production-fast.sh [--env-file FILE] [--skip-gcp]

Check the currently activated Mac runtime first, then print GCP Compose status.
An explicit --env-file is useful for inspecting a non-current candidate.
EOF
}

ENV_FILE=
SKIP_GCP=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      shift
      [ "$#" -gt 0 ] || { usage >&2; exit 1; }
      ENV_FILE=$1
      ;;
    --skip-gcp) SKIP_GCP=1 ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
  shift
done

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)

if [ -z "$ENV_FILE" ]; then
  for candidate in "$HOME/.local/share/krw-ontology/simple-runtimes/current/runtime.env" "$HOME/.local/share/krw-ontology/mac-runtimes/current/runtime.env" "$FRONT_DIR/.env.mac-worker.production"; do
    if [ -f "$candidate" ]; then
      ENV_FILE=$candidate
      break
    fi
  done
fi

case "$ENV_FILE" in
  /*) ENV_PATH=$ENV_FILE ;;
  *) ENV_PATH="$FRONT_DIR/$ENV_FILE" ;;
esac
test -f "$ENV_PATH" || {
  echo "No production runtime environment was found: $ENV_PATH" >&2
  exit 1
}

echo "Production runtime environment: $ENV_PATH"
"$SCRIPT_DIR/verify-mcp-server-production.sh" --env-file "$ENV_PATH"
"$SCRIPT_DIR/verify-filings-mcp-production.sh" --env-file "$ENV_PATH"

if [ "$SKIP_GCP" = "1" ]; then
  "$SCRIPT_DIR/status-production-workers.sh" --env-file "$ENV_PATH" --skip-gcp
else
  "$SCRIPT_DIR/status-production-workers.sh" --env-file "$ENV_PATH"
fi
