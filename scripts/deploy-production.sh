#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/deploy-production.sh [--dry-run] [--skip-db-check]

Deploy production code in the split Mac-worker architecture:
  1. Supabase migration dry-run and schema smoke test.
  2. GCP web/API container only.
  3. Local Mac worker/plugin runtime only.

This intentionally does not start the GCP agent-worker.
EOF
}

DRY_RUN=0
DB_CHECK=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --skip-db-check)
      DB_CHECK=0
      ;;
    *)
      usage
      exit 1
      ;;
  esac
  shift
done

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)

if [ "$DB_CHECK" = "1" ]; then
  echo "Checking Supabase migration drift..."
  (cd "$FRONT_DIR" && "$SCRIPT_DIR/supabase-cli.sh" db push --dry-run)

  if [ "$DRY_RUN" = "1" ]; then
    echo "Dry run: skipping Supabase schema smoke test."
  else
    echo "Running Supabase schema smoke test..."
    (cd "$FRONT_DIR" && npm run supabase:schema:smoke)
  fi
else
  echo "Skipping Supabase migration/schema checks."
fi

if [ "$DRY_RUN" = "1" ]; then
  "$SCRIPT_DIR/deploy-web-production.sh" --dry-run
  "$SCRIPT_DIR/deploy-plugin-worker-production.sh" --dry-run
else
  "$SCRIPT_DIR/deploy-web-production.sh"
  "$SCRIPT_DIR/deploy-plugin-worker-production.sh"
fi

echo "Production code deployment complete."
