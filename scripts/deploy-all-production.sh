#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/deploy-all-production.sh [--dry-run] [--release-id ID] [--skip-worker-restart] [--skip-data] [--skip-code] [--skip-db-check] [--apply-migrations] [--restart-all]

Deploy data, GCP web/API, and Mac worker plugin/MCP changes to production.

Order:
  1. Supabase migration drift check and schema smoke test, unless skipped.
  2. Local prod release catalog publish. When code is also deployed, defer the
     Mac runtime restart to the final plugin/worker step so its plugin and MCP
     fingerprints are updated atomically.
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
SKIP_DATA_RUNTIME_RESTART=0
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
      echo "--replace-remote-data was removed. Full ontology SQLite data stays on the Mac worker v3 release root." >&2
      exit 1
      ;;
    --skip-prune)
      echo "--skip-prune was removed with the GCP ontology data upload path." >&2
      exit 1
      ;;
    --release-id)
      DATA_ARGS="$DATA_ARGS --release-id ${2:?Missing value for --release-id}"
      shift
      ;;
    --skip-worker-restart)
      DATA_ARGS="$DATA_ARGS --skip-worker-restart"
      SKIP_DATA_RUNTIME_RESTART=1
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

# A catalog publish can safely precede the frontend/plugin deployment, but a
# Mac worker restart cannot: it would boot the current worker against a stale
# plugin while the MCP/runtime fingerprints have already changed. The plugin
# lane below materializes the plugin, restarts both MCPs, and then starts the
# worker, so it is the one authoritative restart point for a combined deploy.
if [ "$DEPLOY_DATA" = "1" ] && [ "$DEPLOY_CODE" = "1" ] && [ "$SKIP_DATA_RUNTIME_RESTART" = "0" ]; then
  DATA_ARGS="$DATA_ARGS --skip-worker-restart"
  SKIP_DATA_RUNTIME_RESTART=1
  echo "Deferring Mac runtime restart until the final plugin/worker deployment step."
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)

if [ "$DB_CHECK" = "1" ]; then
  echo "Checking Supabase migration drift..."
  MIGRATION_DRY_RUN_OUTPUT=$(mktemp "${TMPDIR:-/tmp}/krw-supabase-dry-run.XXXXXX")
  SUPABASE_DB_PUSH_INCLUDE_ALL=0
  DOCUMENT_INGESTION_V2_MIGRATION_PENDING=0
  if (cd "$FRONT_DIR" && "$SCRIPT_DIR/supabase-cli.sh" db push --dry-run) >"$MIGRATION_DRY_RUN_OUTPUT" 2>&1; then
    cat "$MIGRATION_DRY_RUN_OUTPUT"
  else
    if grep -q -- "--include-all" "$MIGRATION_DRY_RUN_OUTPUT"; then
      cat "$MIGRATION_DRY_RUN_OUTPUT"
      echo "Retrying Supabase migration dry run with --include-all for out-of-order local migrations..."
      SUPABASE_DB_PUSH_INCLUDE_ALL=1
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
    if [ "$APPLY_MIGRATIONS" = "0" ]; then
      if [ "$DRY_RUN" = "1" ]; then
        echo "Dry run: pending Supabase migrations detected; non-dry deployment would require --apply-migrations before schema smoke."
      else
        echo "Pending Supabase migrations detected. Re-run with --apply-migrations, or apply migrations before deploying code." >&2
        rm -f "$MIGRATION_DRY_RUN_OUTPUT"
        exit 1
      fi
    fi
  fi

  if grep -q "20260710002000_document_ingestion_claim_tokens_cleanup" "$MIGRATION_DRY_RUN_OUTPUT"; then
    DOCUMENT_INGESTION_V2_MIGRATION_PENDING=1
  fi

  if [ "$APPLY_MIGRATIONS" = "1" ] \
    && [ "$DOCUMENT_INGESTION_V2_MIGRATION_PENDING" = "1" ] \
    && [ "$DEPLOY_CODE" = "0" ]; then
    echo "The document-ingestion claim-token migration requires the v2 compose deployment; do not use --skip-code." >&2
    rm -f "$MIGRATION_DRY_RUN_OUTPUT"
    exit 1
  fi

  rm -f "$MIGRATION_DRY_RUN_OUTPUT"

  if [ "$APPLY_MIGRATIONS" = "1" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      if [ "$DOCUMENT_INGESTION_V2_MIGRATION_PENDING" = "1" ]; then
        "$SCRIPT_DIR/drain-document-workers-for-migration.sh" --dry-run
      fi
      if [ "$SUPABASE_DB_PUSH_INCLUDE_ALL" = "1" ]; then
        echo "Dry run: would apply Supabase migrations with Supabase CLI db push --include-all."
      else
        echo "Dry run: would apply Supabase migrations with Supabase CLI db push."
      fi
    else
      if [ "$DOCUMENT_INGESTION_V2_MIGRATION_PENDING" = "1" ]; then
        echo "Draining remote document workers before applying migrations..."
        "$SCRIPT_DIR/drain-document-workers-for-migration.sh"
      fi
      echo "Applying Supabase migrations..."
      if [ "$SUPABASE_DB_PUSH_INCLUDE_ALL" = "1" ]; then
        (cd "$FRONT_DIR" && "$SCRIPT_DIR/supabase-cli.sh" db push --include-all)
      else
        (cd "$FRONT_DIR" && "$SCRIPT_DIR/supabase-cli.sh" db push)
      fi
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
