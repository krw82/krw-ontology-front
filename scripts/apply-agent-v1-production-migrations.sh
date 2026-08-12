#!/usr/bin/env bash
set -euo pipefail

# One forward-only gate for the Rust agent store and the product-owned
# compatibility migrations. It never starts web/daemon processes and emits no
# request, answer, database URL, or secret material.

front_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
agent_release=
psql_url=${AGENT_V1_PSQL_URL:-}
dry_run=false
skip_front_migrations=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent-release) [[ $# -ge 2 ]] || { echo '--agent-release requires a bundle' >&2; exit 2; }; agent_release=$2; shift 2 ;;
    --psql-url) [[ $# -ge 2 ]] || { echo '--psql-url requires a connection string' >&2; exit 2; }; psql_url=$2; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    --skip-front-migrations) skip_front_migrations=true; shift ;;
    --help|-h)
      printf 'usage: %s --agent-release /absolute/provider-bundle [--psql-url postgres-url] [--skip-front-migrations] [--dry-run]\n' "$0"
      exit 0
      ;;
    *) echo "unexpected argument: $1" >&2; exit 2 ;;
  esac
done

[[ "$agent_release" = /* && -d "$agent_release" && ! -L "$agent_release" ]] || { echo 'agent release must be an absolute real directory' >&2; exit 2; }
[[ -x "$agent_release/apply_migrations.sh" ]] || { echo 'agent release migration runner is missing' >&2; exit 1; }
[[ -d "$agent_release/migrations" ]] || { echo 'agent release migrations are missing' >&2; exit 1; }

configure_postgres_tls() {
  if [[ -n "${AGENT_V1_DATABASE_CA_FILE:-}" ]]; then
    [[ -f "$AGENT_V1_DATABASE_CA_FILE" && ! -L "$AGENT_V1_DATABASE_CA_FILE" ]] \
      || { echo 'agent-v1 database CA file is missing or unsafe' >&2; exit 1; }
    export PGSSLMODE=${PGSSLMODE:-verify-full}
    export PGSSLROOTCERT="$AGENT_V1_DATABASE_CA_FILE"
  fi
}

run_psql() {
  psql "$psql_url" -X -v ON_ERROR_STOP=1 "$@"
}

legacy_front_v7_state() {
  run_psql -Atc "
    SELECT CASE
      WHEN to_regclass('agent_store.schema_migrations') IS NOT NULL THEN 'tracked'
      WHEN to_regclass('agent_store.runs') IS NOT NULL
       AND to_regclass('agent_store.actions') IS NOT NULL
       AND to_regclass('agent_store.session_memory_frontiers') IS NOT NULL
       AND to_regclass('agent_store.session_memory_deltas') IS NOT NULL
       AND to_regclass('agent_store.child_executions') IS NULL
       AND to_regclass('agent_store.session_memory_snapshots') IS NULL
       AND to_regprocedure('agent_v1.enqueue_run(jsonb)') IS NOT NULL
       AND to_regprocedure('agent_v1.claim_outbox(jsonb)') IS NOT NULL
       AND to_regprocedure('agent_v1.ack_outbox(jsonb)') IS NOT NULL
       AND to_regprocedure('agent_v1.commit_final(jsonb)') IS NOT NULL
       AND to_regprocedure('agent_v1.read_final_projection(jsonb)') IS NOT NULL
       AND to_regprocedure('agent_v1.finalize_action(jsonb)') IS NULL
      THEN 'legacy-front-v7'
      ELSE 'unknown'
    END;
  "
}

append_legacy_upgrade_migration() {
  source_path=$1
  case "$(basename "$source_path")" in
    0008_row_retention.sql|0016_session_memory_source_retention.sql)
      sed \
        -e '/^BEGIN;[[:space:]]*$/d' \
        -e '/^COMMIT;[[:space:]]*$/d' \
        -e '/^GRANT EXECUTE ON FUNCTION agent_v1\.reap_retained_runs(jsonb) TO krw_agent_daemon;[[:space:]]*$/d' \
        -e '/^GRANT EXECUTE ON FUNCTION agent_v1\.retire_session_memory(jsonb) TO krw_agent_daemon;[[:space:]]*$/d' \
        "$source_path"
      ;;
    *)
      sed -e '/^BEGIN;[[:space:]]*$/d' -e '/^COMMIT;[[:space:]]*$/d' "$source_path"
      ;;
  esac
}

adopt_legacy_front_v7_schema() {
  migration_dir="$agent_release/migrations"
  upgrade_sql=$(mktemp "${TMPDIR:-/tmp}/krw-agent-v7-adoption.XXXXXX")
  chmod 600 "$upgrade_sql"

  printf '%s\n' 'BEGIN;' > "$upgrade_sql"
  for migration_name in \
    0002_action_finalization.sql \
    0003_bounded_child.sql \
    0005_session_memory_snapshot.sql \
    0007_deferred_attempts_cap.sql \
    0008_row_retention.sql \
    0010_claim_resets_deferred_attempts.sql \
    0012_read_terminal_trace.sql \
    0013_failure_usage_projection.sql \
    0014_bounded_child_optional_expected_hash.sql \
    0015_typed_answer_projection.sql \
    0016_session_memory_source_retention.sql \
    0017_session_memory_snapshot_source_trigger.sql \
    0018_daemon_heartbeat.sql; do
    migration_path="$migration_dir/$migration_name"
    [[ -f "$migration_path" && ! -L "$migration_path" ]] \
      || { echo "agent release migration is missing or unsafe: $migration_name" >&2; return 1; }
    append_legacy_upgrade_migration "$migration_path" >> "$upgrade_sql"
  done
  cat >> "$upgrade_sql" <<'SQL'
DO $grant$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'krw_agent_daemon') THEN
    GRANT EXECUTE ON FUNCTION agent_v1.reap_retained_runs(jsonb) TO krw_agent_daemon;
    GRANT EXECUTE ON FUNCTION agent_v1.retire_session_memory(jsonb) TO krw_agent_daemon;
  END IF;
END;
$grant$;
CREATE TABLE IF NOT EXISTS agent_store.schema_migrations (
    version integer PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    checksum text NOT NULL
);
INSERT INTO agent_store.schema_migrations (version, checksum) VALUES
    (1, 'backfill'), (2, 'backfill'), (3, 'backfill'),
    (4, 'backfill'), (5, 'backfill'), (6, 'backfill'),
    (7, 'backfill'), (8, 'backfill'), (9, 'backfill'),
    (10, 'backfill'), (11, 'backfill'), (12, 'backfill'),
    (13, 'backfill'), (14, 'backfill'), (15, 'backfill'),
    (16, 'backfill'), (17, 'backfill'), (18, 'backfill')
ON CONFLICT (version) DO NOTHING;
COMMIT;
SQL
  if ! run_psql -f "$upgrade_sql"; then
    rm -f -- "$upgrade_sql"
    return 1
  fi
  rm -f -- "$upgrade_sql"
  echo 'Adopted verified legacy front Agent V1 schema into the sealed Rust migration ledger.'
}

if [[ "$dry_run" == true ]]; then
  printf '%s\n' \
    'would adopt only the verified legacy front v7 baseline, when present' \
    'would apply agent_store migrations from the selected immutable bundle' \
    'would apply front product compatibility migrations with supabase db push' \
    'would run scripts/verify-agent-v1-compatibility.mjs'
  exit 0
fi

[[ -n "$psql_url" ]] || { echo 'agent-v1 PostgreSQL URL is missing' >&2; exit 1; }
configure_postgres_tls
case "$(legacy_front_v7_state)" in
  tracked) ;;
  legacy-front-v7) adopt_legacy_front_v7_schema ;;
  *)
    echo 'agent-v1 schema is untracked but does not match the verified legacy front v7 baseline' >&2
    exit 1
    ;;
esac

"$agent_release/apply_migrations.sh" "$psql_url"

if [[ "$skip_front_migrations" == false ]]; then
  "$front_root/scripts/supabase-cli.sh" db push
fi
node "$front_root/scripts/verify-agent-v1-compatibility.mjs"
printf 'agent-v1 production migration gate passed\n'
