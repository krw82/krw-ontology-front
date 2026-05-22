#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/deploy-all-production.sh [--dry-run] [--replace-remote-data] [--skip-prune] [--skip-data] [--skip-code] [--skip-db-check] [--apply-migrations]

Deploy data, frontend, plugin, and MCP package changes to production.

Order:
  1. Supabase migration drift check and schema smoke test, unless skipped.
  2. Data release deployment, if not skipped.
  3. Frontend + ~/krw-ontology sync and web image rebuild, if not skipped.
  4. Public health check.

By default the script refuses to deploy when local migrations are not already
applied. Pass --apply-migrations to run `supabase db push` before the smoke test.

On the current small VM, data deployment normally needs --replace-remote-data
because the disk cannot hold the old 25GB data release and a new one at once.
That flag stops web and removes old data releases before streaming the new data.
EOF
}

DRY_RUN=0
DEPLOY_DATA=1
DEPLOY_CODE=1
DB_CHECK=1
APPLY_MIGRATIONS=0
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
    --skip-db-check)
      DB_CHECK=0
      ;;
    --apply-migrations)
      APPLY_MIGRATIONS=1
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
  (cd "$FRONT_DIR" && npx supabase db push --dry-run)

  if [ "$APPLY_MIGRATIONS" = "1" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      echo "Dry run: would apply Supabase migrations with npx supabase db push."
    else
      echo "Applying Supabase migrations..."
      (cd "$FRONT_DIR" && npx supabase db push)
    fi
  fi

  if [ "$DRY_RUN" = "1" ]; then
    echo "Dry run: skipping Supabase schema smoke test."
  else
    echo "Running Supabase schema smoke test..."
    (cd "$FRONT_DIR" && npm run supabase:schema:smoke)
  fi
else
  echo "Skipping Supabase migration/schema checks."
fi

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
