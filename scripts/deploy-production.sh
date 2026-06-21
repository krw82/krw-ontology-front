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
  MIGRATION_DRY_RUN_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/krw-supabase-dry-run.XXXXXX")
  if (cd "$FRONT_DIR" && "$SCRIPT_DIR/supabase-cli.sh" db push --dry-run) >"$MIGRATION_DRY_RUN_OUTPUT" 2>&1; then
    cat "$MIGRATION_DRY_RUN_OUTPUT"
  else
    if grep -q -- "--include-all" "$MIGRATION_DRY_RUN_OUTPUT"; then
      cat "$MIGRATION_DRY_RUN_OUTPUT"
      echo "Retrying Supabase migration dry run with --include-all for out-of-order local migrations..."
      : >"$MIGRATION_DRY_RUN_OUTPUT"
      if (cd "$FRONT_DIR" && "$SCRIPT_DIR/supabase-cli.sh" db push --include-all --dry-run) >"$MIGRATION_DRY_RUN_OUTPUT" 2>&1; then
        cat "$MIGRATION_DRY_RUN_OUTPUT"
      else
        cat "$MIGRATION_DRY_RUN_OUTPUT" >&2
        rm -f "$MIGRATION_DRY_RUN_OUTPUT"
        exit 1
      fi
    else
      cat "$MIGRATION_DRY_RUN_OUTPUT" >&2
      rm -f "$MIGRATION_DRY_RUN_OUTPUT"
      exit 1
    fi
  fi

  if grep -q "Would push these migrations" "$MIGRATION_DRY_RUN_OUTPUT"; then
    if [ "$DRY_RUN" = "1" ]; then
      echo "Dry run: pending Supabase migrations detected; production code deploy would stop before schema smoke."
    else
      echo "Pending Supabase migrations detected. prod:deploy:code does not apply migrations, so the remote schema cannot pass the new code smoke test yet." >&2
      echo "Run npm run prod:deploy:full to apply migrations and deploy, or apply migrations first with scripts/deploy-all-production.sh --apply-migrations." >&2
      rm -f "$MIGRATION_DRY_RUN_OUTPUT"
      exit 1
    fi
  fi
  rm -f "$MIGRATION_DRY_RUN_OUTPUT"

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
