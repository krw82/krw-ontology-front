#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/deploy-all-production.sh [--dry-run] [--release-id ID] [--skip-worker-restart] [--skip-data] [--skip-code] [--skip-db-check] [--apply-migrations] [--restart-all]

Deploy data, GCP web/API, and Mac worker plugin/MCP changes to production.

Order:
  1. Supabase migration drift check and schema smoke test, unless skipped.
  2. Local prod release catalog publish and Mac worker restart, if not skipped.
  3. GCP web image rebuild, if not skipped.
  4. Mac worker/plugin validation and launchd restart, if not skipped.
  5. Optional GCP web/reverse-proxy restart with --restart-all.

By default the script refuses to deploy when local migrations are not already
applied. Pass --apply-migrations to run `supabase db push` before the smoke test.

Data deployment publishes only the compact web catalog to Supabase. Full
ontology SQLite data stays on the Mac worker release root.
EOF
}

DRY_RUN=0
DEPLOY_DATA=1
DEPLOY_CODE=1
DB_CHECK=1
APPLY_MIGRATIONS=0
RESTART_ALL=0
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
      echo "--replace-remote-data is legacy-only; use legacy:data-gcp for VM data uploads." >&2
      exit 1
      ;;
    --skip-prune)
      echo "--skip-prune is legacy-only; use legacy:data-gcp for VM data uploads." >&2
      exit 1
      ;;
    --release-id)
      DATA_ARGS="$DATA_ARGS --release-id ${2:?Missing value for --release-id}"
      shift
      ;;
    --skip-worker-restart)
      DATA_ARGS="$DATA_ARGS --skip-worker-restart"
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
    --restart-all)
      RESTART_ALL=1
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

  if [ "$APPLY_MIGRATIONS" = "1" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      echo "Dry run: would apply Supabase migrations with Supabase CLI db push."
    else
      echo "Applying Supabase migrations..."
      (cd "$FRONT_DIR" && "$SCRIPT_DIR/supabase-cli.sh" db push)
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
  "$SCRIPT_DIR/deploy-data-release-production.sh" $DATA_ARGS
else
  echo "Skipping data deployment."
fi

if [ "$DEPLOY_CODE" = "1" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    "$SCRIPT_DIR/deploy-web-production.sh" --dry-run
    "$SCRIPT_DIR/deploy-plugin-worker-production.sh" --dry-run
  else
    "$SCRIPT_DIR/deploy-web-production.sh"
    "$SCRIPT_DIR/deploy-plugin-worker-production.sh"
  fi
else
  echo "Skipping web/worker/plugin deployment."
fi

if [ "$RESTART_ALL" = "1" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    "$SCRIPT_DIR/restart-production-compose.sh" --dry-run
  else
    "$SCRIPT_DIR/restart-production-compose.sh"
  fi
fi

echo "All requested production deployment steps complete."
