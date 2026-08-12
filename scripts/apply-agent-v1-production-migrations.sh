#!/usr/bin/env bash
set -euo pipefail

# One forward-only gate for the Rust agent store and the product-owned
# compatibility migrations. It never starts web/daemon processes and emits no
# request, answer, database URL, or secret material.

front_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
agent_release=
psql_url=${AGENT_V1_PSQL_URL:-}
dry_run=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agent-release) [[ $# -ge 2 ]] || { echo '--agent-release requires a bundle' >&2; exit 2; }; agent_release=$2; shift 2 ;;
    --psql-url) [[ $# -ge 2 ]] || { echo '--psql-url requires a connection string' >&2; exit 2; }; psql_url=$2; shift 2 ;;
    --dry-run) dry_run=true; shift ;;
    --help|-h)
      printf 'usage: %s --agent-release /absolute/provider-bundle [--psql-url postgres-url] [--dry-run]\n' "$0"
      exit 0
      ;;
    *) echo "unexpected argument: $1" >&2; exit 2 ;;
  esac
done

[[ "$agent_release" = /* && -d "$agent_release" && ! -L "$agent_release" ]] || { echo 'agent release must be an absolute real directory' >&2; exit 2; }
[[ -x "$agent_release/apply_migrations.sh" ]] || { echo 'agent release migration runner is missing' >&2; exit 1; }
[[ -d "$agent_release/migrations" ]] || { echo 'agent release migrations are missing' >&2; exit 1; }

if [[ "$dry_run" == true ]]; then
  printf '%s\n' \
    'would apply agent_store migrations from the selected immutable bundle' \
    'would apply front product compatibility migrations with supabase db push' \
    'would run scripts/verify-agent-v1-compatibility.mjs'
  exit 0
fi

if [[ -n "$psql_url" ]]; then
  "$agent_release/apply_migrations.sh" "$psql_url"
else
  "$agent_release/apply_migrations.sh"
fi

"$front_root/scripts/supabase-cli.sh" db push
node "$front_root/scripts/verify-agent-v1-compatibility.mjs"
printf 'agent-v1 production migration gate passed\n'
