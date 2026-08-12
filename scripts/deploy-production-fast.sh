#!/bin/sh
set -e

# Normal production releases use this small, reversible path.  The former
# sealed cutover scripts remain available only for incident recovery and
# one-time bootstrap work.
if [ "$SIMPLE_PRODUCTION_LOCK_HELD" != "1" ]; then
  EARLY_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
  EARLY_FRONT_DIR=$(CDPATH= cd -- "$EARLY_SCRIPT_DIR/.." && pwd -P)
  mkdir -p "$EARLY_FRONT_DIR/.deploy"
  command -v lockf >/dev/null 2>&1 || {
    echo "Missing required macOS lockf command." >&2
    exit 1
  }
  exec env SIMPLE_PRODUCTION_LOCK_HELD=1 PRODUCTION_OS_LOCK_HELD=1 lockf -t 0 -k "$EARLY_FRONT_DIR/.deploy/production-deploy.os-lock" /bin/sh "$0" "$@"
fi

usage() {
  cat <<'EOF'
Usage: scripts/deploy-production-fast.sh [options]

Fast production path:
  1. Build a new VM image while the current containers keep serving traffic.
  2. Optionally apply already-reviewed Supabase migrations.
  3. Recreate the application containers and verify their public health.
  4. Activate the local Rust daemon when requested and run deep health verification.

Options:
  --apply-migrations       Apply pending Supabase migrations after the image builds.
  --with-data              Publish the active web catalog separately from code.
  --with-agent-release     Stage a sealed GLM+DeepSeek Rust release on this Mac,
                           select one provider, and bind the GCP web candidate
                           to its public descriptor only.
  --agent-release-root DIR Absolute sealed dual-provider release directory.
  --agent-evidence-index FILE
                           Optional final evidence index. When supplied and
                           verified, admission opens after the private canary;
                           without it the release deploys closed.
  --agent-provider NAME    Selected provider (glm or deepseek; default: deepseek).
  --skip-web               Do not build or switch GCP containers.
  --skip-mac               Do not restart legacy local Mac MCP/worker services.
  --require-live-toss      Require a matching live Toss key pair in the GCP runtime env.
  --billing-v2-cutover     Freeze billing behind Caddy, deploy V2 read-only, and never
                          restore legacy billing writes on an activation failure.
  --skip-worker-restart    Compatibility alias for --skip-mac.
  --release-id ID          Safe deployment identifier.
  --env-file FILE          Mac production environment file.
  --dry-run                Verify targets and migration plan without mutation.

Data publication is opt-in because it changes the active catalog independently:
  npm run prod:release:publish

For exact sealed-runtime recovery or bootstrap, use the legacy recovery commands.
EOF
}

DRY_RUN=0
APPLY_MIGRATIONS=0
WITH_DATA=0
WITH_AGENT_RELEASE=0
SKIP_WEB=0
SKIP_MAC=0
REQUIRE_LIVE_TOSS=0
BILLING_V2_CUTOVER=0
RELEASE_ID=
ENV_FILE=.env.mac-worker.production
ENV_FILE_EXPLICIT=0
TMP_DIR=
DATA_LOCK_DIR=
DATA_LOCK_OWNED=0
MIGRATION_INCLUDE_ALL=0
AGENT_RELEASE_ROOT=${KRW_AGENT_RELEASE_ROOT:-}
AGENT_EVIDENCE_INDEX=${KRW_AGENT_PRODUCTION_EVIDENCE_INDEX:-}
AGENT_PROVIDER=${KRW_AGENT_PROVIDER:-deepseek}
AGENT_RELEASE_REPORT=
AGENT_DESCRIPTOR_HASH=
AGENT_RELEASE_SET_HASH=
AGENT_DESCRIPTOR_SOURCE=
AGENT_DESCRIPTOR_COPY=
AGENT_LOCAL_INSTALLER=
AGENT_INSTALLED_INSTALLER=
AGENT_PROVIDER_BUNDLE=
AGENT_LOCAL_INSTALL_ROOT=${KRW_AGENT_LOCAL_INSTALL_ROOT:-"$HOME/.local/share/krw-agent"}
AGENT_METRICS_PORT=${KRW_AGENT_METRICS_PORT:-15520}
AGENT_FINAL_EVIDENCE_VERIFIED=0
AGENT_CUTOVER_ROLLBACK_ARMED=0
AGENT_LOCAL_RELEASE_ACTIVATED=0
AGENT_ADMISSION_CLOSED=0
FRONT_CANDIDATE_ACTIVATED=0
MAC_RUNTIME_ACTIVATED=0

fail() {
  echo "$1" >&2
  exit 1
}

cleanup() {
  exit_code=$?
  set +e
  if [ "$exit_code" -ne 0 ] && [ "$AGENT_CUTOVER_ROLLBACK_ARMED" = "1" ]; then
    if [ "$FRONT_CANDIDATE_ACTIVATED" = "1" ]; then
      run_remote_rollback_front_candidate || echo "Front candidate rollback failed after agent cutover." >&2
    fi
    if [ "$AGENT_LOCAL_RELEASE_ACTIVATED" = "1" ]; then
      rollback_local_agent_release || echo "Local krw-agent release rollback failed." >&2
    fi
    if [ "$MAC_RUNTIME_ACTIVATED" = "1" ]; then
      restore_previous_mac_runtime || echo "Previous Mac worker runtime restoration failed." >&2
    fi
    if [ "$AGENT_ADMISSION_CLOSED" = "1" ]; then
      run_remote_restore_research_admission || echo "Previous research admission could not be restored." >&2
    fi
  fi
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
  if [ "$DATA_LOCK_OWNED" = "1" ] && [ -n "$DATA_LOCK_DIR" ]; then
    rm -f "$DATA_LOCK_DIR/owner"
    rmdir "$DATA_LOCK_DIR" 2>/dev/null || true
  fi
  exit "$exit_code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply-migrations) APPLY_MIGRATIONS=1 ;;
    --with-data) WITH_DATA=1 ;;
    --with-agent-release) WITH_AGENT_RELEASE=1 ;;
    --skip-web) SKIP_WEB=1 ;;
    --skip-mac|--skip-worker-restart) SKIP_MAC=1 ;;
    --require-live-toss) REQUIRE_LIVE_TOSS=1 ;;
    --billing-v2-cutover) BILLING_V2_CUTOVER=1 ;;
    --skip-data|--skip-db-check|--no-restart-queue)
      echo "Compatibility option $1 has no effect on the fast path." >&2
      ;;
    --skip-code)
      fail "--skip-code is no longer a deployment mode. Use npm run prod:release:publish for catalog-only publication."
      ;;
    --bootstrap-unsealed-mac-runtime|--bootstrap-unsealed-gcp-runtime)
      fail "$1 requires the legacy sealed bootstrap path."
      ;;
    --release-id)
      shift
      [ "$#" -gt 0 ] || fail "--release-id requires a value."
      RELEASE_ID=$1
      ;;
    --agent-release-root)
      shift
      [ "$#" -gt 0 ] || fail "--agent-release-root requires a value."
      AGENT_RELEASE_ROOT=$1
      WITH_AGENT_RELEASE=1
      ;;
    --agent-evidence-index)
      shift
      [ "$#" -gt 0 ] || fail "--agent-evidence-index requires a value."
      AGENT_EVIDENCE_INDEX=$1
      WITH_AGENT_RELEASE=1
      ;;
    --agent-provider)
      shift
      [ "$#" -gt 0 ] || fail "--agent-provider requires glm or deepseek."
      AGENT_PROVIDER=$1
      WITH_AGENT_RELEASE=1
      ;;
    --env-file)
      shift
      [ "$#" -gt 0 ] || fail "--env-file requires a value."
      ENV_FILE=$1
      ENV_FILE_EXPLICIT=1
      ;;
    --dry-run) DRY_RUN=1 ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if [ "$BILLING_V2_CUTOVER" = "1" ]; then
  [ "$APPLY_MIGRATIONS" = "1" ] || fail "--billing-v2-cutover requires --apply-migrations."
  [ "$SKIP_WEB" = "0" ] || fail "--billing-v2-cutover cannot be combined with --skip-web."
  [ "$REQUIRE_LIVE_TOSS" = "1" ] || fail "--billing-v2-cutover requires --require-live-toss."
fi

if [ "$WITH_AGENT_RELEASE" = "1" ]; then
  [ "$SKIP_WEB" = "0" ] || fail "--with-agent-release requires the web candidate deployment."
  [ "$APPLY_MIGRATIONS" = "1" ] || fail "--with-agent-release requires --apply-migrations for the direct Rust daemon heartbeat ABI."
  case "$AGENT_PROVIDER" in
    glm|deepseek) ;;
    *) fail "--agent-provider must be glm or deepseek." ;;
  esac
  case "$AGENT_METRICS_PORT" in
    ''|*[!0-9]*) fail "KRW_AGENT_METRICS_PORT must be in 1024..65535." ;;
    *) [ "$AGENT_METRICS_PORT" -ge 1024 ] && [ "$AGENT_METRICS_PORT" -le 65535 ] || fail "KRW_AGENT_METRICS_PORT must be in 1024..65535." ;;
  esac
fi

case "$RELEASE_ID" in
  "") RELEASE_ID=$(date +%Y%m%d%H%M%S)-$$ ;;
  *[!A-Za-z0-9._-]*) fail "Invalid release id: $RELEASE_ID" ;;
esac

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
TARGET_FILE="$FRONT_DIR/ops/production-target.json"

resolve_agent_runtime_env() {
  # The normal front env owns public/product settings, while Agent V1 has a
  # second, operator-owned sourceable envelope for its local TLS MCP endpoints
  # and private database CA.  Keep the relationship as an explicit pointer in
  # the normal env instead of baking a user-specific krw-agent path into this
  # deployer. An explicit --env-file always wins for recovery and automation.
  [ "$WITH_AGENT_RELEASE" = "1" ] || return 0
  [ "$ENV_FILE_EXPLICIT" = "0" ] || return 0

  configured_runtime_env=${KRW_AGENT_RUNTIME_ENV_FILE:-}
  if [ -z "$configured_runtime_env" ] && [ -f "$FRONT_DIR/.env.mac-worker.production" ]; then
    configured_runtime_env=$(awk -F= '
      $0 !~ /^[[:space:]]*#/ && $1 == "KRW_AGENT_RUNTIME_ENV_FILE" {
        sub(/^[^=]*=/, "")
        gsub(/^[[:space:]]+|[[:space:]]+$/, "")
        gsub(/^"|"$/, "")
        gsub(/^'\''|'\''$/, "")
        print
      }
    ' "$FRONT_DIR/.env.mac-worker.production" | tail -n 1)
  fi
  case "$configured_runtime_env" in
    /*) ;;
    *) fail "Rust Agent V1 deploy requires KRW_AGENT_RUNTIME_ENV_FILE or an explicit --env-file with the local agent runtime envelope." ;;
  esac
  [ -f "$configured_runtime_env" ] && [ ! -L "$configured_runtime_env" ] \
    || fail "KRW_AGENT_RUNTIME_ENV_FILE must point to a regular local runtime env file."
  ENV_FILE=$configured_runtime_env
}

resolve_agent_runtime_env
case "$ENV_FILE" in
  /*) ENV_PATH=$ENV_FILE ;;
  *) ENV_PATH="$FRONT_DIR/$ENV_FILE" ;;
esac
require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command: $1"
}

require_file() {
  [ -f "$1" ] || fail "Missing required file: $1"
}

assert_release_tree_has_no_generated_artifacts() {
  generated_paths=$(git -C "$FRONT_DIR" ls-tree -r --name-only "$FRONT_GIT_COMMIT" | awk -F/ '
    $1 ~ /^\.next-/ || $1 == ".worker" || $1 == ".services" || $0 == "next-env.d.ts" { print }
  ')
  [ -z "$generated_paths" ] || {
    printf '%s\n' "Production commit contains generated build artifacts; remove them before deployment:" >&2
    printf '%s\n' "$generated_paths" >&2
    fail "Generated artifacts are excluded from the production release source."
  }
}

target_value() {
  node -e 'const target=require(process.argv[1]); const value=target[process.argv[2]]; if(typeof value!=="string"||!value) process.exit(1); process.stdout.write(value);' "$TARGET_FILE" "$1"
}

run_migration_dry_run() {
  TMP_BASE=$TMPDIR
  [ -n "$TMP_BASE" ] || TMP_BASE=/tmp
  migration_output=$(mktemp "$TMP_BASE/krw-fast-migration.XXXXXX")
  if "$SCRIPT_DIR/supabase-cli.sh" db push --dry-run >"$migration_output" 2>&1; then
    cat "$migration_output"
    rm -f "$migration_output"
    return 0
  fi
  if grep -q -- "--include-all" "$migration_output"; then
    cat "$migration_output"
    echo "Retrying migration plan with --include-all for out-of-order local migrations."
    if "$SCRIPT_DIR/supabase-cli.sh" db push --include-all --dry-run >"$migration_output" 2>&1; then
      cat "$migration_output"
      rm -f "$migration_output"
      MIGRATION_INCLUDE_ALL=1
      return 0
    fi
  fi
  cat "$migration_output" >&2
  rm -f "$migration_output"
  return 1
}

# The migration CLI uses the linked project metadata, but the schema smoke
# talks to the Supabase HTTP API. Keep its credentials scoped to this child
# process so a normal production runtime deploy can validate the migrated
# schema before any new web or worker process is activated.
run_schema_smoke() {
  (
    set -a
    # shellcheck disable=SC1090
    . "$ENV_PATH"
    set +a
    node "$SCRIPT_DIR/supabase-schema-smoke.mjs"
    if [ "$WITH_AGENT_RELEASE" = "1" ]; then
      node "$SCRIPT_DIR/verify-agent-v1-compatibility.mjs"
    fi
  )
}

run_agent_release_migrations() {
  (
    set -a
    # shellcheck disable=SC1090
    . "$ENV_PATH"
    set +a
    agent_database_url=${KRW_AGENT_DATABASE_URL:-${AGENT_V1_DATABASE_URL:-}}
    case "$agent_database_url" in
      postgres://*|postgresql://*) ;;
      *) fail "Rust Agent V1 migration requires the local Supabase PostgreSQL runtime URL." ;;
    esac
    AGENT_V1_PSQL_URL="$agent_database_url" \
      "$SCRIPT_DIR/apply-agent-v1-production-migrations.sh" \
        --agent-release "$AGENT_PROVIDER_BUNDLE" \
        --skip-front-migrations
  )
}

require_command node
require_file "$TARGET_FILE"
require_file "$ENV_PATH"
require_file "$SCRIPT_DIR/verify-supabase-production-target.mjs"
require_file "$SCRIPT_DIR/supabase-cli.sh"
if [ "$BILLING_V2_CUTOVER" = "1" ]; then
  require_file "$SCRIPT_DIR/verify-billing-production-readiness.sh"
fi
node "$SCRIPT_DIR/verify-supabase-production-target.mjs" "$ENV_PATH" "$FRONT_DIR/supabase/.temp/project-ref" "$TARGET_FILE" --require-origins

GCP_PROJECT=$(target_value gcpProject)
GCP_INSTANCE=$(target_value gcpInstance)
GCP_ZONE=$(target_value gcpZone)
GCP_INSTANCE_ID=$(target_value gcpInstanceId)
REMOTE_FRONT_DIR=$(target_value remoteFrontDir)
COMPOSE_PROJECT=$(target_value composeProject)
SITE_ORIGIN_ONE=$(node -e 'const target=require(process.argv[1]); if(!Array.isArray(target.siteOrigins)||target.siteOrigins.length<2) process.exit(1); process.stdout.write(target.siteOrigins[0]);' "$TARGET_FILE")
SITE_ORIGIN_TWO=$(node -e 'const target=require(process.argv[1]); if(!Array.isArray(target.siteOrigins)||target.siteOrigins.length<2) process.exit(1); process.stdout.write(target.siteOrigins[1]);' "$TARGET_FILE")
REMOTE_ARCHIVE_DIR=/tmp
REMOTE_FRONT_ARCHIVE="$REMOTE_ARCHIVE_DIR/krw-front-$RELEASE_ID.tar.gz"
REMOTE_STAGE="$REMOTE_FRONT_DIR/.simple-deploy/releases/$RELEASE_ID"
REMOTE_AGENT_DESCRIPTOR="$REMOTE_ARCHIVE_DIR/krw-agent-public-release-$RELEASE_ID.json"

if [ "$SKIP_WEB" = "0" ]; then
  require_command gcloud
  require_command tar
  require_command git
  require_command curl
  require_file "$FRONT_DIR/docker-compose.yml"
  require_file "$FRONT_DIR/Dockerfile.web"
  actual_instance_id=$(gcloud compute instances describe "$GCP_INSTANCE" --project="$GCP_PROJECT" --zone="$GCP_ZONE" --format='value(id)')
  [ "$actual_instance_id" = "$GCP_INSTANCE_ID" ] || fail "GCP instance identity does not match ops/production-target.json."
  FRONT_GIT_COMMIT=$(git -C "$FRONT_DIR" rev-parse HEAD) || fail "Unable to resolve the frontend Git commit."
  [ "$(git -C "$FRONT_DIR" rev-parse HEAD)" = "$FRONT_GIT_COMMIT" ] || fail "Frontend release commit changed during preflight."
  [ -z "$(git -C "$FRONT_DIR" status --porcelain=v1 --untracked-files=normal)" ] || fail "Production web release requires a clean committed frontend tree."
  assert_release_tree_has_no_generated_artifacts
fi

if [ "$WITH_AGENT_RELEASE" = "1" ]; then
  require_command python3
  require_command shasum
  require_file "$SCRIPT_DIR/verify-krw-agent-production-release.mjs"
  require_file "$FRONT_DIR/ops/certificates/supabase-root-2021-ca.crt"
  [ -n "$AGENT_RELEASE_ROOT" ] || fail "Set KRW_AGENT_RELEASE_ROOT or pass --agent-release-root for a sealed dual-provider release."
  case "$AGENT_LOCAL_INSTALL_ROOT" in
    /*) ;;
    *) fail "KRW_AGENT_LOCAL_INSTALL_ROOT must be an absolute local Mac path." ;;
  esac
  set -- --release-root "$AGENT_RELEASE_ROOT" --provider "$AGENT_PROVIDER"
  if [ -n "$AGENT_EVIDENCE_INDEX" ]; then
    set -- "$@" --evidence-index "$AGENT_EVIDENCE_INDEX" --front-commit "$FRONT_GIT_COMMIT"
  fi
  AGENT_RELEASE_REPORT=$(node "$SCRIPT_DIR/verify-krw-agent-production-release.mjs" "$@")
  AGENT_DESCRIPTOR_HASH=$(node -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(value.selected_descriptor_artifact_hash);' "$AGENT_RELEASE_REPORT")
  AGENT_RELEASE_SET_HASH=$(node -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(value.selected_release_set_hash);' "$AGENT_RELEASE_REPORT")
  AGENT_FINAL_EVIDENCE_VERIFIED=$(node -e 'const value=JSON.parse(process.argv[1]); process.stdout.write(value.final_evidence_verified ? "1" : "0");' "$AGENT_RELEASE_REPORT")
  AGENT_DESCRIPTOR_SOURCE="$AGENT_RELEASE_ROOT/$AGENT_PROVIDER/public-release.json"
  AGENT_PROVIDER_BUNDLE="$AGENT_RELEASE_ROOT/$AGENT_PROVIDER"
  AGENT_LOCAL_INSTALLER="$AGENT_RELEASE_ROOT/$AGENT_PROVIDER/packaging/launchd/install-local-mac-agentd-release.sh"
  AGENT_INSTALLED_INSTALLER="$AGENT_LOCAL_INSTALL_ROOT/releases/$RELEASE_ID/$AGENT_PROVIDER/packaging/launchd/install-local-mac-agentd-release.sh"
  require_file "$AGENT_DESCRIPTOR_SOURCE"
  require_file "$AGENT_PROVIDER_BUNDLE/apply_migrations.sh"
  require_file "$AGENT_LOCAL_INSTALLER"
  [ -x "$AGENT_LOCAL_INSTALLER" ] || fail "Sealed local krw-agent installer is not executable."
  require_file "$ENV_PATH"
  printf '%s\n' "Verified sealed GLM+DeepSeek release for local Mac activation; selected provider: $AGENT_PROVIDER"
fi

if [ "$WITH_AGENT_RELEASE" = "0" ] && [ "$SKIP_MAC" = "0" ]; then
  require_command npm
  require_command shasum
  require_file "$SCRIPT_DIR/install-mcp-server-launchd.sh"
  require_file "$SCRIPT_DIR/install-stock-news-mcp-launchd.sh"
  require_file "$SCRIPT_DIR/install-filings-mcp-launchd.sh"
  require_file "$SCRIPT_DIR/install-mac-worker-launchd.sh"
  require_file "$SCRIPT_DIR/install-valuation-refresh-worker-launchd.sh"
  require_file "$SCRIPT_DIR/valuation-refresh-preflight.sh"
  require_file "$SCRIPT_DIR/materialize-ontology-plugin.mjs"
  require_file "$SCRIPT_DIR/verify-mcp-server-production.sh"
  require_file "$SCRIPT_DIR/verify-valuation-refresh-worker.sh"
  require_file "$SCRIPT_DIR/verify-mac-worker-heartbeats.mjs"
fi
if [ "$APPLY_MIGRATIONS" = "1" ]; then
  require_file "$SCRIPT_DIR/supabase-schema-smoke.mjs"
  if [ "$WITH_AGENT_RELEASE" = "1" ]; then
    require_file "$SCRIPT_DIR/verify-agent-v1-compatibility.mjs"
  fi
fi

echo "Release: $RELEASE_ID"
echo "Target VM: $GCP_PROJECT/$GCP_ZONE/$GCP_INSTANCE"
echo "Web: $SKIP_WEB  Mac runtime: $SKIP_MAC  Migrations: $APPLY_MIGRATIONS  Catalog: $WITH_DATA  Agent release: $WITH_AGENT_RELEASE"

if [ "$APPLY_MIGRATIONS" = "1" ]; then
  run_migration_dry_run
fi

materialize_runtime_ontology_plugin() {
  runtime_env=$1
  output_path=$2
  (
    set -a
    # shellcheck disable=SC1090
    . "$runtime_env"
    set +a

    [ "$KRW_ONTOLOGY_ENV" = "prod" ] || {
      echo "Runtime plugin materialization requires KRW_ONTOLOGY_ENV=prod." >&2
      exit 1
    }
    [ -n "$KRW_ONTOLOGY_PLUGIN_SOURCE_PATH" ] || {
      echo "Missing KRW_ONTOLOGY_PLUGIN_SOURCE_PATH for runtime plugin materialization." >&2
      exit 1
    }
    [ -n "$KRW_ONTOLOGY_MCP_URL" ] || {
      echo "Missing KRW_ONTOLOGY_MCP_URL for runtime plugin materialization." >&2
      exit 1
    }

    # Derive both hashes from the exact source/release that this runtime will
    # launch. A previously pinned expected hash must not preserve a stale
    # plugin contract across a source upgrade.
    KRW_MCP_EXPECTED_TOOL_SCHEMA_SHA256= \
    KRW_MCP_EXPECTED_BUILD_FINGERPRINT_SHA256= \
      node "$SCRIPT_DIR/materialize-ontology-plugin.mjs" \
        --env prod \
        --source "$KRW_ONTOLOGY_PLUGIN_SOURCE_PATH" \
        --out "$output_path" \
        --mcp-url "$KRW_ONTOLOGY_MCP_URL"
  )
}

prepare_dry_run_runtime_plugin() {
  TMP_BASE=$TMPDIR
  [ -n "$TMP_BASE" ] || TMP_BASE=/tmp
  TMP_DIR=$(mktemp -d "$TMP_BASE/krw-fast-runtime-plugin.XXXXXX")
  DRY_RUNTIME_ENV="$TMP_DIR/runtime.env"
  DRY_PLUGIN_PATH="$TMP_DIR/plugins/krw-ontology"

  umask 077
  cp "$ENV_PATH" "$DRY_RUNTIME_ENV"
  printf '\nKRW_ONTOLOGY_PLUGIN_PATH=%s\n' "$DRY_PLUGIN_PATH" >> "$DRY_RUNTIME_ENV"
  chmod 600 "$DRY_RUNTIME_ENV"

  echo "Materializing and verifying a temporary runtime plugin candidate..."
  materialize_runtime_ontology_plugin "$DRY_RUNTIME_ENV" "$DRY_PLUGIN_PATH"
}

if [ "$DRY_RUN" = "1" ]; then
  if [ "$WITH_AGENT_RELEASE" = "1" ]; then
    "$SCRIPT_DIR/apply-agent-v1-production-migrations.sh" \
      --agent-release "$AGENT_PROVIDER_BUNDLE" \
      --skip-front-migrations \
      --dry-run
  fi
  if [ "$WITH_AGENT_RELEASE" = "0" ] && [ "$SKIP_MAC" = "0" ]; then
    prepare_dry_run_runtime_plugin
    (cd "$FRONT_DIR" && npm run build:worker)
    "$SCRIPT_DIR/valuation-refresh-preflight.sh" --env-file "$DRY_RUNTIME_ENV"
  fi
  if [ "$WITH_DATA" = "1" ]; then
    "$SCRIPT_DIR/deploy-data-release-production.sh" --env-file "$ENV_PATH" --dry-run
  fi
  echo "Dry run passed. No archive, container, migration, catalog, launchd, or active runtime change was made."
  exit 0
fi

prepare_mac_runtime() {
  MAC_RUNTIME_BASE="$HOME/.local/share/krw-ontology/simple-runtimes"
  MAC_RUNTIME_DIR="$MAC_RUNTIME_BASE/$RELEASE_ID"
  MAC_RUNTIME_ENV="$MAC_RUNTIME_DIR/runtime.env"
  MAC_RUNTIME_PLUGIN_PATH="$MAC_RUNTIME_DIR/plugins/krw-ontology"
  [ ! -e "$MAC_RUNTIME_DIR" ] || fail "Mac runtime directory already exists: $MAC_RUNTIME_DIR"
  mkdir -p "$MAC_RUNTIME_DIR/plugins"
  umask 077
  cp "$ENV_PATH" "$MAC_RUNTIME_ENV"
  printf '\nNEXT_PUBLIC_APP_VERSION=%s\nKRW_DEPLOYMENT_ID=%s\nKRW_ONTOLOGY_PLUGIN_PATH=%s\n' \
    "$RELEASE_ID" "$RELEASE_ID" "$MAC_RUNTIME_PLUGIN_PATH" >> "$MAC_RUNTIME_ENV"
  if [ "$SKIP_MAC" = "0" ]; then
    (cd "$FRONT_DIR" && npm run build:worker)
    WORKER_SHA=$(shasum -a 256 "$FRONT_DIR/.worker/agent-worker.mjs" | awk '{print $1}')
    RUNTIME_SHA=$( (cd "$FRONT_DIR" && { printf '%s\n' "$RELEASE_ID"; shasum -a 256 package.json package-lock.json .worker/agent-worker.mjs .worker/valuation-refresh-worker.mjs scripts/start-mac-worker-production.sh scripts/start-valuation-refresh-worker.sh scripts/install-valuation-refresh-worker-launchd.sh; }) | shasum -a 256 | awk '{print $1}')
    printf 'KRW_MAC_IMMUTABLE_RUNTIME=0\nKRW_MAC_RUNTIME_ROOT=%s\nKRW_WORKER_BUNDLE_SHA256=%s\nKRW_RUNTIME_IDENTITY_SHA256=%s\n' "$FRONT_DIR" "$WORKER_SHA" "$RUNTIME_SHA" >> "$MAC_RUNTIME_ENV"
    "$FRONT_DIR/scripts/valuation-refresh-preflight.sh" --env-file "$MAC_RUNTIME_ENV"
  fi
  chmod 600 "$MAC_RUNTIME_ENV"
  echo "Materializing versioned production runtime plugin..."
  materialize_runtime_ontology_plugin "$MAC_RUNTIME_ENV" "$MAC_RUNTIME_PLUGIN_PATH"
}

prepare_data_environment() {
  TMP_BASE=$TMPDIR
  [ -n "$TMP_BASE" ] || TMP_BASE=/tmp
  if [ -z "$TMP_DIR" ]; then
    TMP_DIR=$(mktemp -d "$TMP_BASE/krw-fast-deploy.XXXXXX")
  fi
  MAC_RUNTIME_ENV="$TMP_DIR/data-runtime.env"
  umask 077
  cp "$ENV_PATH" "$MAC_RUNTIME_ENV"
  printf '\nNEXT_PUBLIC_APP_VERSION=%s\nKRW_DEPLOYMENT_ID=%s\n' "$RELEASE_ID" "$RELEASE_ID" >> "$MAC_RUNTIME_ENV"
  chmod 600 "$MAC_RUNTIME_ENV"
}

create_archives() {
  TMP_BASE=$TMPDIR
  [ -n "$TMP_BASE" ] || TMP_BASE=/tmp
  if [ -z "$TMP_DIR" ]; then
    TMP_DIR=$(mktemp -d "$TMP_BASE/krw-fast-deploy.XXXXXX")
  fi
  FRONT_ARCHIVE="$TMP_DIR/front.tar.gz"
  # Archive the exact clean commit that passed preflight. This avoids
  # accidentally shipping ignored/untracked files (or a half-built worker)
  # from the developer's current directory. The Docker builder recreates
  # generated workers inside the immutable context.
  git -C "$FRONT_DIR" archive --format=tar "$FRONT_GIT_COMMIT" | gzip -n > "$FRONT_ARCHIVE"

}

upload_archive() {
  archive_path=$1
  remote_path=$2
  archive_label=$3
  attempt=1
  max_attempts=3

  while [ "$attempt" -le "$max_attempts" ]; do
    echo "Uploading $archive_label (attempt $attempt/$max_attempts)..."
    if gcloud compute scp "$archive_path" "$GCP_INSTANCE:$remote_path" --project="$GCP_PROJECT" --zone="$GCP_ZONE" --scp-flag=-oServerAliveInterval=15 --scp-flag=-oServerAliveCountMax=8; then
      return 0
    fi
    if [ "$attempt" -lt "$max_attempts" ]; then
      echo "Upload interrupted; retrying $archive_label." >&2
      sleep $((attempt * 3))
    fi
    attempt=$((attempt + 1))
  done

  fail "Unable to upload $archive_label after $max_attempts attempts."
}

create_agent_descriptor_upload() {
  TMP_BASE=$TMPDIR
  [ -n "$TMP_BASE" ] || TMP_BASE=/tmp
  if [ -z "$TMP_DIR" ]; then
    TMP_DIR=$(mktemp -d "$TMP_BASE/krw-fast-deploy.XXXXXX")
  fi
  AGENT_DESCRIPTOR_COPY="$TMP_DIR/public-release.json"
  # GCP needs this immutable public descriptor to validate user requests. The
  # full Rust bundle, AgentImages, provider credential, and local DB runtime
  # never leave this Mac.
  cp "$AGENT_DESCRIPTOR_SOURCE" "$AGENT_DESCRIPTOR_COPY"
  chmod 0644 "$AGENT_DESCRIPTOR_COPY"
  observed_descriptor_hash="sha256:$(shasum -a 256 "$AGENT_DESCRIPTOR_COPY" | awk '{print $1}')"
  [ "$observed_descriptor_hash" = "$AGENT_DESCRIPTOR_HASH" ] || fail "Copied public descriptor hash does not match the verified release."
}

run_remote_buffered_script() {
  remote_env=$1
  remote_command="$remote_env /bin/sh -c 'remote_script=\$(mktemp /tmp/krw-fast-remote.XXXXXX) || exit 1; cat > \"\$remote_script\" || { rm -f \"\$remote_script\"; exit 1; }; /bin/sh \"\$remote_script\"; status=\$?; rm -f \"\$remote_script\"; exit \$status'"
  gcloud compute ssh "$GCP_INSTANCE" --project="$GCP_PROJECT" --zone="$GCP_ZONE" --command="$remote_command"
}

prune_remote_stale_deployment_artifacts() {
  # A release is immutable once activated, but inactive build candidates are
  # reproducible from Git and must not consume the VM disk forever. Keep the
  # sole active stage and its running local image; remove only stale tags and
  # directories under this deployment root before a new candidate is built.
  cat <<'REMOTE_SCRIPT' | run_remote_buffered_script "REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR' COMPOSE_PROJECT='$COMPOSE_PROJECT'"
set -eu

release_base="$REMOTE_FRONT_DIR/.simple-deploy/releases"
active_release=
if [ -L "$REMOTE_FRONT_DIR/.simple-deploy/current" ]; then
  active_release=$(cd "$REMOTE_FRONT_DIR/.simple-deploy/current" && pwd -P)
fi
if [ -d "$release_base" ]; then
  release_base=$(cd "$release_base" && pwd -P)
  for candidate in "$release_base"/*; do
    [ -d "$candidate" ] && [ ! -L "$candidate" ] || continue
    candidate=$(cd "$candidate" && pwd -P)
    case "$candidate" in
      "$release_base"/*) ;;
      *)
        echo "Refusing to prune an unexpected deployment path." >&2
        exit 1
        ;;
    esac
    [ "$candidate" = "$active_release" ] && continue
    rm -rf -- "$candidate"
  done
fi

# Every active service is tagged `krw-ontology-front-web:local`. Keep at most
# the rollback image for the immediately preceding cutover; release and
# candidate tags are audit labels only and must not retain superseded images.
docker images --format '{{.Repository}}|{{.Tag}}' \
  | while IFS='|' read -r repository tag; do
      [ "$repository" = "krw-ontology-front-web" ] || continue
      case "$tag" in
        candidate-*|release-*|rollback-*) docker image rm "$repository:$tag" >/dev/null 2>&1 || true ;;
      esac
    done

# Caddy uses the stable `caddy:2` tag at runtime. Historical release labels
# otherwise keep no additional image data, but they make image inventories and
# rollback expectations misleading.
docker images --format '{{.Repository}}|{{.Tag}}' \
  | while IFS='|' read -r repository tag; do
      [ "$repository" = "caddy" ] || continue
      case "$tag" in
        candidate-*|release-*|rollback-*) docker image rm "$repository:$tag" >/dev/null 2>&1 || true ;;
      esac
    done

echo "Pruned inactive deployment stages and stale web candidate tags."
REMOTE_SCRIPT
}

stage_local_agent_release() {
  KRW_AGENT_LOCAL_INSTALL_ROOT="$AGENT_LOCAL_INSTALL_ROOT" \
    "$AGENT_LOCAL_INSTALLER" --mode stage \
      --release-root "$AGENT_RELEASE_ROOT" \
      --release-id "$RELEASE_ID" \
      --provider "$AGENT_PROVIDER"
}

verify_sealed_local_agent_database_abi() {
  # Exercise the selected immutable bundle through the same Mac launcher that
  # launchd will later use. This is intentionally after migrations and before
  # admission closure or activation, so a missing procedure/role/TLS binding
  # cannot become a production cutover failure.
  TMP_BASE=${TMPDIR:-/tmp}
  agent_check_dir=$(mktemp -d "$TMP_BASE/krw-agent-release-abi.XXXXXX")
  agent_overlay="$agent_check_dir/overlay.env"
  cleanup_agent_check() {
    rm -rf -- "$agent_check_dir"
  }
  ln -s "$AGENT_PROVIDER_BUNDLE" "$agent_check_dir/current"
  umask 077
  printf '%s\n' \
    "KRW_AGENT_CURRENT_DIR=$agent_check_dir/current" \
    "KRW_AGENT_PROVIDER=$AGENT_PROVIDER" \
    "KRW_AGENT_ARTIFACT_ROOT=$agent_check_dir/artifacts" \
    'KRW_AGENT_WORKER_ID=sealed-release-database-check' > "$agent_overlay"
  chmod 600 "$agent_overlay"
  if ! "$AGENT_PROVIDER_BUNDLE/packaging/launchd/krw-agentd-start-local" \
    --env-file "$ENV_PATH" \
    --overlay-file "$agent_overlay" \
    --database-check; then
    cleanup_agent_check
    return 1
  fi
  cleanup_agent_check
  echo 'Sealed local Rust daemon database ABI verified through the launchd entrypoint.'
}

activate_local_agent_release() {
  [ -x "$AGENT_INSTALLED_INSTALLER" ] || fail "Staged local krw-agent installer is unavailable."
  KRW_AGENT_LOCAL_INSTALL_ROOT="$AGENT_LOCAL_INSTALL_ROOT" \
    "$AGENT_INSTALLED_INSTALLER" --mode activate \
      --release-id "$RELEASE_ID" \
      --provider "$AGENT_PROVIDER" \
      --metrics-port "$AGENT_METRICS_PORT" \
      --env-file "$ENV_PATH"
}

rollback_local_agent_release() {
  [ -x "$AGENT_INSTALLED_INSTALLER" ] || return 0
  KRW_AGENT_LOCAL_INSTALL_ROOT="$AGENT_LOCAL_INSTALL_ROOT" \
    "$AGENT_INSTALLED_INSTALLER" --mode rollback --release-id "$RELEASE_ID"
}

run_remote_close_research_admission() {
  cat <<'REMOTE_SCRIPT' | run_remote_buffered_script "REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR' REMOTE_STAGE='$REMOTE_STAGE' COMPOSE_PROJECT='$COMPOSE_PROJECT'"
set -eu

active_root=$REMOTE_FRONT_DIR
active_env=$REMOTE_FRONT_DIR/.env
if [ -L "$REMOTE_FRONT_DIR/.simple-deploy/current" ] \
  && [ -f "$REMOTE_FRONT_DIR/.simple-deploy/current/runtime.env" ]; then
  active_root=$(cd "$REMOTE_FRONT_DIR/.simple-deploy/current" && pwd -P)
  active_env=$active_root/runtime.env
fi

value_of() {
  awk -F= -v key="$2" '
    $0 !~ /^[[:space:]]*#/ && $1 == key {
      sub(/^[^=]*=/, "")
      gsub(/^[[:space:]]+|[[:space:]]+$/, "")
      gsub(/^"|"$/, "")
      gsub(/^'\''|'\''$/, "")
      print
    }
  ' "$1" | tail -n 1
}
upsert_env_value() {
  env_file=$1
  env_key=$2
  env_value=$3
  temporary=$(mktemp "${env_file}.XXXXXX")
  awk -v key="$env_key" -v value="$env_value" '
    $0 !~ /^[[:space:]]*#/ && $0 ~ ("^" key "=") {
      if (!seen++) print key "=" value
      next
    }
    { print }
    END { if (!seen) print key "=" value }
  ' "$env_file" > "$temporary"
  chmod 600 "$temporary"
  mv "$temporary" "$env_file"
}
compose_active() {
  FRONT_DIR="$active_root" docker compose --project-name "$COMPOSE_PROJECT" --project-directory "$active_root" --env-file "$active_env" -f "$active_root/docker-compose.yml" "$@"
}

if [ "$(value_of "$active_env" KRW_AGENT_BACKEND_MODE)" != "rust" ]; then
  echo "Active web release does not use Rust Agent V1; no research admission change is needed."
  exit 0
fi
previous=$(value_of "$active_env" KRW_AGENT_ADMISSION_MODE)
case "$previous" in open|closed|drain) ;; *) previous=open ;; esac
printf '%s\n' "$previous" > "$REMOTE_STAGE/research-admission.previous"
chmod 600 "$REMOTE_STAGE/research-admission.previous"
changed=0
restore_previous() {
  status=$?
  if [ "$changed" = "1" ]; then
    set +e
    upsert_env_value "$active_env" KRW_AGENT_ADMISSION_MODE "$previous"
    compose_active up -d --no-deps --force-recreate --wait web agent-v1-outbox
  fi
  exit "$status"
}
trap restore_previous EXIT INT TERM
upsert_env_value "$active_env" KRW_AGENT_ADMISSION_MODE closed
changed=1
compose_active up -d --no-deps --force-recreate --wait web agent-v1-outbox
compose_active exec -T web node -e 'fetch("http://127.0.0.1:3000/api/healthz").then(async response=>{const value=await response.json().catch(()=>null); if(!response.ok||value?.status!=="ok") process.exit(1);}).catch(()=>process.exit(1));'
changed=0
trap - EXIT INT TERM
echo "Research admission closed before Rust agent release switch."
REMOTE_SCRIPT
}

run_remote_restore_research_admission() {
  cat <<'REMOTE_SCRIPT' | run_remote_buffered_script "REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR' REMOTE_STAGE='$REMOTE_STAGE' COMPOSE_PROJECT='$COMPOSE_PROJECT'"
set -eu
[ -f "$REMOTE_STAGE/research-admission.previous" ] || exit 0
previous=$(cat "$REMOTE_STAGE/research-admission.previous")
case "$previous" in open|closed|drain) ;; *) exit 1 ;; esac
active_root=$REMOTE_FRONT_DIR
active_env=$REMOTE_FRONT_DIR/.env
if [ -L "$REMOTE_FRONT_DIR/.simple-deploy/current" ] \
  && [ -f "$REMOTE_FRONT_DIR/.simple-deploy/current/runtime.env" ]; then
  active_root=$(cd "$REMOTE_FRONT_DIR/.simple-deploy/current" && pwd -P)
  active_env=$active_root/runtime.env
fi
value_of() {
  awk -F= -v key="$2" '
    $0 !~ /^[[:space:]]*#/ && $1 == key {
      sub(/^[^=]*=/, "")
      gsub(/^[[:space:]]+|[[:space:]]+$/, "")
      gsub(/^"|"$/, "")
      gsub(/^'\''|'\''$/, "")
      print
    }
  ' "$1" | tail -n 1
}
if [ "$(value_of "$active_env" KRW_AGENT_BACKEND_MODE)" != "rust" ]; then
  exit 0
fi
upsert_env_value() {
  env_file=$1
  env_key=$2
  env_value=$3
  temporary=$(mktemp "${env_file}.XXXXXX")
  awk -v key="$env_key" -v value="$env_value" '
    $0 !~ /^[[:space:]]*#/ && $0 ~ ("^" key "=") {
      if (!seen++) print key "=" value
      next
    }
    { print }
    END { if (!seen) print key "=" value }
  ' "$env_file" > "$temporary"
  chmod 600 "$temporary"
  mv "$temporary" "$env_file"
}
compose_active() {
  FRONT_DIR="$active_root" docker compose --project-name "$COMPOSE_PROJECT" --project-directory "$active_root" --env-file "$active_env" -f "$active_root/docker-compose.yml" "$@"
}
upsert_env_value "$active_env" KRW_AGENT_ADMISSION_MODE "$previous"
compose_active up -d --no-deps --force-recreate --wait web agent-v1-outbox
echo "Previous research admission restored: $previous"
REMOTE_SCRIPT
}

run_remote_rollback_front_candidate() {
  cat <<'REMOTE_SCRIPT' | run_remote_buffered_script "REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR' REMOTE_STAGE='$REMOTE_STAGE' COMPOSE_PROJECT='$COMPOSE_PROJECT'"
set -eu
test -f "$REMOTE_STAGE/rollback.env"
. "$REMOTE_STAGE/rollback.env"
test -n "$OLD_IMAGE"
services="web reverse-proxy agent-v1-outbox llm-gateway filings-mcp document-worker document-outbox-dispatcher filing-notification-worker filing-brief-worker billing-worker"
compose_stage() {
  FRONT_DIR="$REMOTE_STAGE" docker compose --project-name "$COMPOSE_PROJECT" --project-directory "$REMOTE_STAGE" --env-file "$REMOTE_STAGE/runtime.env" -f "$REMOTE_STAGE/docker-compose.yml" "$@"
}
compose_old() {
  if [ -n "$OLD_CONFIG_ROOT" ] && [ -f "$OLD_CONFIG_ROOT/runtime.env" ] && [ -f "$OLD_CONFIG_ROOT/docker-compose.yml" ]; then
    FRONT_DIR="$OLD_CONFIG_ROOT" docker compose --project-name "$COMPOSE_PROJECT" --project-directory "$OLD_CONFIG_ROOT" --env-file "$OLD_CONFIG_ROOT/runtime.env" -f "$OLD_CONFIG_ROOT/docker-compose.yml" "$@"
  else
    FRONT_DIR="$REMOTE_FRONT_DIR" NEXT_PUBLIC_APP_VERSION="$OLD_APP_VERSION" docker compose --project-name "$COMPOSE_PROJECT" --project-directory "$REMOTE_FRONT_DIR" --env-file "$REMOTE_FRONT_DIR/.env" -f "$REMOTE_FRONT_DIR/docker-compose.yml" "$@"
  fi
}
for worker in market-issue-worker market-web-source-worker market-issue-stream-worker market-issue-enrichment-worker; do
  compose_stage rm -sf "$worker" || true
done
docker tag "$OLD_IMAGE" krw-ontology-front-web:local
compose_old up -d --force-recreate --wait $services
for worker in market-issue-worker market-web-source-worker market-issue-stream-worker market-issue-enrichment-worker; do
  if compose_old config --services | grep -qx "$worker"; then
    compose_old up -d --force-recreate --wait "$worker"
  fi
done
if [ -n "$OLD_CONFIG_ROOT" ]; then
  rm -f "$REMOTE_FRONT_DIR/.simple-deploy/current"
  ln -s "$OLD_CONFIG_ROOT" "$REMOTE_FRONT_DIR/.simple-deploy/current"
else
  rm -f "$REMOTE_FRONT_DIR/.simple-deploy/current"
fi
echo "Rolled back front candidate after Rust agent release failure."
REMOTE_SCRIPT
}

run_remote_prepare() {
  cat <<'REMOTE_SCRIPT' | run_remote_buffered_script "RELEASE_ID='$RELEASE_ID' FRONT_GIT_COMMIT='$FRONT_GIT_COMMIT' REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR' REMOTE_STAGE='$REMOTE_STAGE' REMOTE_FRONT_ARCHIVE='$REMOTE_FRONT_ARCHIVE' REMOTE_AGENT_DESCRIPTOR='$REMOTE_AGENT_DESCRIPTOR' COMPOSE_PROJECT='$COMPOSE_PROJECT' REQUIRE_LIVE_TOSS='$REQUIRE_LIVE_TOSS' BILLING_V2_CUTOVER='$BILLING_V2_CUTOVER' SITE_ORIGIN_ONE='$SITE_ORIGIN_ONE' WITH_AGENT_RELEASE='$WITH_AGENT_RELEASE' AGENT_PROVIDER='$AGENT_PROVIDER' AGENT_DESCRIPTOR_HASH='$AGENT_DESCRIPTOR_HASH' AGENT_RELEASE_SET_HASH='$AGENT_RELEASE_SET_HASH'"
set -e
test -f "$REMOTE_FRONT_DIR/.env"
test ! -e "$REMOTE_STAGE"
mkdir -p "$REMOTE_STAGE"
tar -xzf "$REMOTE_FRONT_ARCHIVE" -C "$REMOTE_STAGE"
test -f "$REMOTE_STAGE/docker-compose.yml"
test -f "$REMOTE_STAGE/Dockerfile.web"

upsert_env_value() {
  env_file="$1"
  env_key="$2"
  env_value="$3"
  tmp_file=$(mktemp "${env_file}.XXXXXX")
  awk -v key="$env_key" -v value="$env_value" '
    $0 !~ /^[[:space:]]*#/ && $0 ~ ("^" key "=") {
      if (!seen++) print key "=" value
      next
    }
    { print }
    END { if (!seen) print key "=" value }
  ' "$env_file" > "$tmp_file"
  chmod 600 "$tmp_file"
  mv "$tmp_file" "$env_file"
}

if [ "$BILLING_V2_CUTOVER" = "1" ]; then
  case "$SITE_ORIGIN_ONE" in
    https://*) ;;
    *)
      echo "Billing V2 cutover requires a public HTTPS primary origin." >&2
      exit 1
      ;;
  esac
  # The active V1 container does not read this until a restart. Caddy is
  # frozen separately below; persisting the value here ensures both the V2
  # candidate and every future release start in read-only mode.
  upsert_env_value "$REMOTE_FRONT_DIR/.env" BILLING_WRITES_ENABLED 0
  upsert_env_value "$REMOTE_FRONT_DIR/.env" AUTH_REDIRECT_ORIGIN "$SITE_ORIGIN_ONE"
fi

cp "$REMOTE_FRONT_DIR/.env" "$REMOTE_STAGE/runtime.env"
chmod 600 "$REMOTE_STAGE/runtime.env"

if [ "$BILLING_V2_CUTOVER" = "1" ]; then
  readonly_caddy="$REMOTE_STAGE/Caddyfile.billing-readonly"
  awk '
    /^[[:space:]]*# BILLING_READ_ONLY_GATE_INSERTION_POINT[[:space:]]*$/ {
      print
      print "    @billing_v2_cutover path /api/billing/toss/*"
      print "    handle @billing_v2_cutover {"
      print "        respond \"Billing is temporarily read-only.\" 503"
      print "    }"
      print ""
      inserted = 1
      next
    }
    { print }
    END { if (!inserted) exit 1 }
  ' "$REMOTE_STAGE/Caddyfile" > "$readonly_caddy"
  test -s "$readonly_caddy"
fi

value_of() {
  key="$1"
  awk -F= -v key="$key" '
    $0 !~ /^[[:space:]]*#/ && $1 == key {
      sub(/^[^=]*=/, "")
      gsub(/^[[:space:]]+|[[:space:]]+$/, "")
      gsub(/^"|"$/, "")
      gsub(/^'\''|'\''$/, "")
      print
    }
  ' "$REMOTE_STAGE/runtime.env" | tail -n 1
}
require_live_toss_key() {
  key="$1"
  prefix="$2"
  value=$(value_of "$key")
  case "$value" in
    "$prefix"*) ;;
    *)
      echo "Production billing deploy requires a live Toss key for $key." >&2
      exit 1
      ;;
  esac
  case "$value" in
    *"..."*)
      echo "Production billing deploy found a placeholder Toss key for $key." >&2
      exit 1
      ;;
  esac
}
require_market_issue_x_token() {
  value=$(value_of MARKET_ISSUE_X_BEARER_TOKEN)
  case "$value" in
    ""|*"..."*)
      echo "Production market-issue worker requires MARKET_ISSUE_X_BEARER_TOKEN." >&2
      exit 1
      ;;
  esac
}
market_issue_x_ingestion_enabled() {
  value=$(value_of MARKET_ISSUE_X_INGESTION_ENABLED)
  case "$value" in
    0|false|FALSE|off|OFF|no|NO) return 1 ;;
    *) return 0 ;;
  esac
}
market_issue_stream_enabled() {
  value=$(value_of MARKET_ISSUE_STREAM_ENABLED)
  case "$value" in
    1|true|TRUE|on|ON|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}
if [ "$REQUIRE_LIVE_TOSS" = "1" ]; then
  require_live_toss_key TOSS_PAYMENTS_CLIENT_KEY live_ck_
  require_live_toss_key TOSS_PAYMENTS_SECRET_KEY live_sk_
  echo "Verified matching live Toss key prefixes in the GCP runtime env."
fi
if market_issue_x_ingestion_enabled; then
  require_market_issue_x_token
  echo "Verified market-issue X bearer token is present in the GCP runtime env."
else
  echo "Market-issue X ingestion is disabled for this deployment."
fi
if market_issue_stream_enabled; then
  require_market_issue_x_token
  echo "Verified market-issue stream worker token is present in the GCP runtime env."
else
  echo "Market-issue filtered-stream worker is disabled for this deployment."
fi
printf '\nFRONT_DIR=%s\nNEXT_PUBLIC_APP_VERSION=%s\n' "$REMOTE_STAGE" "$RELEASE_ID" >> "$REMOTE_STAGE/runtime.env"
# A Rust-engine deploy pins the staged web image to the exact sealed provider
# descriptor before it is built. The daemon and every credential remain on the
# local Mac; this VM receives exactly one public JSON descriptor plus hashes.
if [ "$WITH_AGENT_RELEASE" = "1" ]; then
  test -f "$REMOTE_AGENT_DESCRIPTOR"
  test -f "$REMOTE_STAGE/ops/certificates/supabase-root-2021-ca.crt"
  install -d -m 0755 "$REMOTE_STAGE/agent-release"
  install -m 0644 "$REMOTE_AGENT_DESCRIPTOR" "$REMOTE_STAGE/agent-release/public-release.json"
  observed_descriptor_hash="sha256:$(sha256sum "$REMOTE_STAGE/agent-release/public-release.json" | awk '{print $1}')"
  test "$observed_descriptor_hash" = "$AGENT_DESCRIPTOR_HASH"
  rm -f "$REMOTE_AGENT_DESCRIPTOR"
  upsert_env_value "$REMOTE_STAGE/runtime.env" KRW_AGENT_BACKEND_MODE rust
  upsert_env_value "$REMOTE_STAGE/runtime.env" KRW_AGENT_PROVIDER "$AGENT_PROVIDER"
  upsert_env_value "$REMOTE_STAGE/runtime.env" KRW_AGENT_PUBLIC_DESCRIPTOR_HOST_PATH "$REMOTE_STAGE/agent-release/public-release.json"
  upsert_env_value "$REMOTE_STAGE/runtime.env" KRW_AGENT_RELEASE_DESCRIPTOR_PATH /run/krw-agent/public-release.json
  upsert_env_value "$REMOTE_STAGE/runtime.env" KRW_AGENT_RELEASE_ARTIFACT_HASH "$AGENT_DESCRIPTOR_HASH"
  upsert_env_value "$REMOTE_STAGE/runtime.env" KRW_AGENT_RELEASE_SET_HASH "$AGENT_RELEASE_SET_HASH"
  upsert_env_value "$REMOTE_STAGE/runtime.env" KRW_AGENT_FRONT_COMMIT "$FRONT_GIT_COMMIT"
  upsert_env_value "$REMOTE_STAGE/runtime.env" KRW_AGENT_DAEMON_HEARTBEAT_REQUIRED 1
  upsert_env_value "$REMOTE_STAGE/runtime.env" KRW_RUNTIME_ENVIRONMENT prod

  # The GCP web and outbox must use the same Supabase database as the local
  # Rust daemon. The existing LISTEN URL is the production-owned connection
  # source; never copy a Mac secret or create a second database credential.
  agent_database_url=$(value_of AGENT_V1_DATABASE_URL)
  if [ -z "$agent_database_url" ]; then
    agent_database_url=$(value_of AGENT_V1_OUTBOX_DATABASE_URL)
  fi
  if [ -z "$agent_database_url" ]; then
    agent_database_url=$(value_of AGENT_QUEUE_LISTEN_DATABASE_URL)
  fi
  case "$agent_database_url" in
    postgres://*|postgresql://*) ;;
    *)
      echo "Rust Agent V1 candidate requires a Supabase PostgreSQL URL from the GCP runtime env." >&2
      exit 1
      ;;
  esac
  case "$agent_database_url" in
    *sslmode=disable*|*sslmode=DISABLE*)
      echo "Rust Agent V1 candidate refuses a non-TLS Supabase database URL." >&2
      exit 1
      ;;
  esac
  agent_tenant_id=$(value_of KRW_AGENT_TENANT_ID)
  if [ -z "$agent_tenant_id" ]; then
    # This is a stable product partition, not a user identity or release id;
    # changing it would break same-chat session continuity across deploys.
    agent_tenant_id=krw-ontology-prod
  fi
  case "$agent_tenant_id" in
    "")
      echo "Rust Agent V1 candidate tenant id is unsafe." >&2
      exit 1
      ;;
  esac
  upsert_env_value "$REMOTE_STAGE/runtime.env" KRW_AGENT_TENANT_ID "$agent_tenant_id"
  upsert_env_value "$REMOTE_STAGE/runtime.env" AGENT_V1_DATABASE_URL "$agent_database_url"
  upsert_env_value "$REMOTE_STAGE/runtime.env" AGENT_V1_OUTBOX_DATABASE_URL "$agent_database_url"
  upsert_env_value "$REMOTE_STAGE/runtime.env" AGENT_V1_DATABASE_CA_FILE /run/krw-agent/agent-v1-ca.pem
fi
# A Rust Agent V1 candidate is always admitted in a closed state first.  The
# admission gate is opened only after activation and deep readiness succeed;
# this prevents a web restart from creating runs against a half-started
# provider or an unverified descriptor.
if [ "$(value_of KRW_AGENT_BACKEND_MODE)" = "rust" ]; then
  upsert_env_value "$REMOTE_STAGE/runtime.env" KRW_AGENT_ADMISSION_MODE closed
fi
  OLD_WEB=$(docker compose --project-name "$COMPOSE_PROJECT" --project-directory "$REMOTE_FRONT_DIR" --env-file "$REMOTE_FRONT_DIR/.env" -f "$REMOTE_FRONT_DIR/docker-compose.yml" ps -q web 2>/dev/null || true)
  OLD_IMAGE=
  if [ -n "$OLD_WEB" ]; then
    OLD_IMAGE=$(docker inspect "$OLD_WEB" --format '{{.Image}}' 2>/dev/null || true)
  fi
  if [ -z "$OLD_IMAGE" ]; then
    OLD_IMAGE=$(docker image inspect --format '{{.Id}}' krw-ontology-front-web:local 2>/dev/null || true)
  fi
  test -n "$OLD_IMAGE"
  ROLLBACK_TAG="krw-ontology-front-web:rollback-$RELEASE_ID"
  if docker image inspect "$OLD_IMAGE" >/dev/null 2>&1; then
    docker tag "$OLD_IMAGE" "$ROLLBACK_TAG"
  else
    # This VM can have a running bootstrap container whose image metadata was
    # removed by an earlier local-tag rebuild. Rebuild the active source as a
    # rollback image before the staged candidate replaces the local image tag.
    test -n "$OLD_WEB"
    FRONT_DIR="$REMOTE_FRONT_DIR" docker compose \
      --project-name "$COMPOSE_PROJECT" \
      --project-directory "$REMOTE_FRONT_DIR" \
      --env-file "$REMOTE_FRONT_DIR/.env" \
      -f "$REMOTE_FRONT_DIR/docker-compose.yml" \
      build web
    docker tag krw-ontology-front-web:local "$ROLLBACK_TAG"
    OLD_IMAGE=$(docker image inspect --format '{{.Id}}' "$ROLLBACK_TAG")
  fi
  echo "Preserved rollback image: $ROLLBACK_TAG"
  OLD_APP_VERSION=unknown
  if [ -n "$OLD_WEB" ]; then
    OLD_APP_VERSION=$(docker inspect "$OLD_WEB" --format '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^NEXT_PUBLIC_APP_VERSION=//p' | head -1)
  fi
OLD_CONFIG_ROOT=
if [ -L "$REMOTE_FRONT_DIR/.simple-deploy/current" ] && [ -f "$REMOTE_FRONT_DIR/.simple-deploy/current/runtime.env" ]; then
  OLD_CONFIG_ROOT=$(cd "$REMOTE_FRONT_DIR/.simple-deploy/current" && pwd -P)
fi
if [ -z "$OLD_APP_VERSION" ]; then
  OLD_APP_VERSION=unknown
fi
compose_stage() {
  FRONT_DIR="$REMOTE_STAGE" NEXT_PUBLIC_APP_VERSION="$RELEASE_ID" docker compose --project-name "$COMPOSE_PROJECT" --project-directory "$REMOTE_STAGE" --env-file "$REMOTE_STAGE/runtime.env" -f "$REMOTE_STAGE/docker-compose.yml" "$@"
}
compose_stage build web
CANDIDATE_TAG="krw-ontology-front-web:candidate-$RELEASE_ID"
CANDIDATE_IMAGE=$(docker image inspect --format '{{.Id}}' krw-ontology-front-web:local)
docker tag "$CANDIDATE_IMAGE" "$CANDIDATE_TAG"
if [ "$WITH_AGENT_RELEASE" = "1" ]; then
  # Prove the exact image, descriptor mount, tenant partition, and Supabase
  # TLS route before any existing public container is replaced. This catches
  # missing/renamed runtime settings at candidate time, not after cutover.
  compose_stage run --rm --no-deps -T --entrypoint node web - <<'NODE'
const fs = require("fs");
const { Pool } = require("pg");

const providerModels = { glm: "glm-5.2", deepseek: "deepseek-v4-flash" };
const url = process.env.AGENT_V1_DATABASE_URL;
const tenant = process.env.KRW_AGENT_TENANT_ID;
const provider = process.env.KRW_AGENT_PROVIDER;
const descriptorPath = process.env.KRW_AGENT_RELEASE_DESCRIPTOR_PATH;
const caPath = process.env.AGENT_V1_DATABASE_CA_FILE;

async function main() {
  if (!(typeof url === "string" && /^postgres(?:ql)?:\/\//.test(url))) {
    throw new Error("gcp_agent_v1_database_url_missing");
  }
  if (url.includes("sslmode=disable")) {
    throw new Error("gcp_agent_v1_database_tls_disabled");
  }
  if (!(typeof tenant === "string" && tenant.length > 0 && tenant.length <= 128)) {
    throw new Error("gcp_agent_v1_tenant_missing");
  }
  if (!Object.hasOwn(providerModels, provider)) {
    throw new Error("gcp_agent_v1_provider_invalid");
  }
  if (!(typeof caPath === "string" && caPath.startsWith("/"))) {
    throw new Error("gcp_agent_v1_ca_path_missing");
  }
  const ca = fs.readFileSync(caPath, "utf8");
  if (!ca.includes("BEGIN CERTIFICATE")) {
    throw new Error("gcp_agent_v1_ca_invalid");
  }
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
  if (!Array.isArray(descriptor.entries) || descriptor.entries.length === 0 ||
      !descriptor.entries.every((entry) => entry?.execution?.resolved_model === providerModels[provider])) {
    throw new Error("gcp_agent_v1_descriptor_provider_mismatch");
  }
  const pool = new Pool({
    connectionString: url,
    application_name: "krw-gcp-agent-v1-candidate-preflight",
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 5000,
    ssl: { ca, rejectUnauthorized: true },
  });
  try {
    // A candidate is built before optional migrations run.  Prove the exact
    // GCP connection now, but defer ABI assertions until after migration so a
    // valid release never rejects its own pending schema change.
    await pool.query("select 1 as supabase_tls");
  } finally {
    await pool.end();
  }
  console.log(JSON.stringify({
    status: "ok",
    check: "gcp_agent_v1_candidate_preflight",
    provider,
    tenant_configured: true,
    descriptor_pinned: true,
    supabase_tls: "verified",
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "gcp_agent_v1_candidate_preflight_failed");
  process.exit(1);
});
NODE
fi
docker tag "$OLD_IMAGE" krw-ontology-front-web:local
printf 'OLD_IMAGE=%s\nCANDIDATE_IMAGE=%s\nOLD_CONFIG_ROOT=%s\nOLD_APP_VERSION=%s\n' "$OLD_IMAGE" "$CANDIDATE_IMAGE" "$OLD_CONFIG_ROOT" "$OLD_APP_VERSION" > "$REMOTE_STAGE/rollback.env"
chmod 600 "$REMOTE_STAGE/rollback.env"
rm -f "$REMOTE_FRONT_ARCHIVE"
echo "Prepared fast VM candidate: $RELEASE_ID"
REMOTE_SCRIPT
}

run_remote_validate_agent_candidate_abi() {
  # Candidate connection/TLS is checked during the image build.  This second
  # check intentionally runs after optional migrations and before the Mac
  # daemon or public web container is switched, so the precise GCP runtime
  # proves the queue and outbox ABI that it will use in production.
  cat <<'REMOTE_SCRIPT' | run_remote_buffered_script "REMOTE_STAGE='$REMOTE_STAGE' COMPOSE_PROJECT='$COMPOSE_PROJECT'"
set -eu

compose_stage() {
  FRONT_DIR="$REMOTE_STAGE" docker compose --project-name "$COMPOSE_PROJECT" --project-directory "$REMOTE_STAGE" --env-file "$REMOTE_STAGE/runtime.env" -f "$REMOTE_STAGE/docker-compose.yml" "$@"
}

compose_stage run --rm --no-deps -T --entrypoint node web - <<'NODE'
const fs = require("fs");
const { Pool } = require("pg");

const url = process.env.AGENT_V1_DATABASE_URL;
const caPath = process.env.AGENT_V1_DATABASE_CA_FILE;

async function main() {
  if (!(typeof url === "string" && /^postgres(?:ql)?:\/\//.test(url)) || url.includes("sslmode=disable")) {
    throw new Error("gcp_agent_v1_database_tls_configuration_invalid");
  }
  if (!(typeof caPath === "string" && caPath.startsWith("/"))) {
    throw new Error("gcp_agent_v1_database_ca_path_missing");
  }
  const ca = fs.readFileSync(caPath, "utf8");
  const pool = new Pool({
    connectionString: url,
    application_name: "krw-gcp-agent-v1-candidate-abi",
    max: 1,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 5000,
    ssl: { ca, rejectUnauthorized: true },
  });
  try {
    const { rows } = await pool.query(`
      select
        to_regprocedure('agent_v1.enqueue_run(jsonb)') is not null as enqueue_run,
        to_regprocedure('agent_v1.claim_outbox(jsonb)') is not null as claim_outbox,
        to_regprocedure('agent_v1.ack_outbox(jsonb)') is not null as ack_outbox,
        to_regprocedure('agent_v1.heartbeat_daemon(jsonb)') is not null as heartbeat_daemon,
        to_regprocedure('public.apply_agent_v1_product_outbox(jsonb)') is not null as apply_product_outbox,
        to_regclass('public.agent_v1_product_outbox_receipts') is not null as product_outbox_receipts
    `);
    const checks = rows[0] || {};
    if (!Object.values(checks).every(Boolean)) {
      throw new Error("gcp_agent_v1_database_abi_missing");
    }
  } finally {
    await pool.end();
  }
  console.log(JSON.stringify({
    status: "ok",
    check: "gcp_agent_v1_candidate_abi",
    queue_and_outbox_abi: "verified",
    supabase_tls: "verified",
  }));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "gcp_agent_v1_candidate_abi_failed");
  process.exit(1);
});
NODE
REMOTE_SCRIPT
}

run_remote_pause_billing_for_cutover() {
  cat <<'REMOTE_SCRIPT' | run_remote_buffered_script "REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR' REMOTE_STAGE='$REMOTE_STAGE' COMPOSE_PROJECT='$COMPOSE_PROJECT'"
set -eu

READONLY_CADDY="$REMOTE_STAGE/Caddyfile.billing-readonly"
test -f "$READONLY_CADDY"

ACTIVE_ROOT="$REMOTE_FRONT_DIR"
ACTIVE_ENV="$REMOTE_FRONT_DIR/.env"
if [ -L "$REMOTE_FRONT_DIR/.simple-deploy/current" ] \
  && [ -f "$REMOTE_FRONT_DIR/.simple-deploy/current/runtime.env" ]; then
  ACTIVE_ROOT=$(cd "$REMOTE_FRONT_DIR/.simple-deploy/current" && pwd -P)
  ACTIVE_ENV="$ACTIVE_ROOT/runtime.env"
fi

compose_active() {
  FRONT_DIR="$ACTIVE_ROOT" docker compose \
    --project-name "$COMPOSE_PROJECT" \
    --project-directory "$ACTIVE_ROOT" \
    --env-file "$ACTIVE_ENV" \
    -f "$ACTIVE_ROOT/docker-compose.yml" "$@"
}

proxy_id=$(compose_active ps -q reverse-proxy)
test -n "$proxy_id"
docker cp "$READONLY_CADDY" "$proxy_id:/tmp/Caddyfile.billing-readonly"
docker exec "$proxy_id" caddy adapt \
  --config /tmp/Caddyfile.billing-readonly \
  --adapter caddyfile >/dev/null
docker exec "$proxy_id" caddy reload \
  --config /tmp/Caddyfile.billing-readonly \
  --adapter caddyfile >/dev/null

# The proxy blocks browser callbacks and direct API calls. Stop the legacy
# scheduler too, so a rollback cannot make a new charge while V2 is read-only.
compose_active stop billing-worker
worker_id=$(compose_active ps -q billing-worker || true)
if [ -n "$worker_id" ]; then
  worker_running=$(docker inspect --format '{{.State.Running}}' "$worker_id")
  [ "$worker_running" = "false" ]
fi

echo "Billing V2 cutover freeze active: Caddy read-only gate loaded and legacy billing worker stopped."
REMOTE_SCRIPT
}

run_remote_activate() {
  cat <<'REMOTE_SCRIPT' | run_remote_buffered_script "RELEASE_ID='$RELEASE_ID' REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR' REMOTE_STAGE='$REMOTE_STAGE' COMPOSE_PROJECT='$COMPOSE_PROJECT' SITE_ORIGIN_ONE='$SITE_ORIGIN_ONE' SITE_ORIGIN_TWO='$SITE_ORIGIN_TWO' BILLING_V2_CUTOVER='$BILLING_V2_CUTOVER'"
set -e
. "$REMOTE_STAGE/rollback.env"
SERVICES="web reverse-proxy agent-v1-outbox llm-gateway filings-mcp document-worker document-outbox-dispatcher filing-notification-worker filing-brief-worker billing-worker"
ROLLBACK_ARMED=1
MARKET_ISSUE_STARTED=0
MARKET_WEB_SOURCE_STARTED=0
MARKET_ISSUE_STREAM_STARTED=0
MARKET_ISSUE_ENRICHMENT_STARTED=0
OLD_MARKET_ISSUE_WORKER=0
OLD_MARKET_WEB_SOURCE_WORKER=0
OLD_MARKET_ISSUE_STREAM_WORKER=0
OLD_MARKET_ISSUE_ENRICHMENT_WORKER=0
compose_stage() {
  FRONT_DIR="$REMOTE_STAGE" NEXT_PUBLIC_APP_VERSION="$RELEASE_ID" docker compose --project-name "$COMPOSE_PROJECT" --project-directory "$REMOTE_STAGE" --env-file "$REMOTE_STAGE/runtime.env" -f "$REMOTE_STAGE/docker-compose.yml" "$@"
}
compose_old() {
  if [ -n "$OLD_CONFIG_ROOT" ] && [ -f "$OLD_CONFIG_ROOT/runtime.env" ] && [ -f "$OLD_CONFIG_ROOT/docker-compose.yml" ]; then
    FRONT_DIR="$OLD_CONFIG_ROOT" docker compose --project-name "$COMPOSE_PROJECT" --project-directory "$OLD_CONFIG_ROOT" --env-file "$OLD_CONFIG_ROOT/runtime.env" -f "$OLD_CONFIG_ROOT/docker-compose.yml" "$@"
  else
    FRONT_DIR="$REMOTE_FRONT_DIR" NEXT_PUBLIC_APP_VERSION="$OLD_APP_VERSION" docker compose --project-name "$COMPOSE_PROJECT" --project-directory "$REMOTE_FRONT_DIR" --env-file "$REMOTE_FRONT_DIR/.env" -f "$REMOTE_FRONT_DIR/docker-compose.yml" "$@"
  fi
}
runtime_value() {
  key="$1"
  awk -F= -v key="$key" '
    $0 !~ /^[[:space:]]*#/ && $1 == key {
      sub(/^[^=]*=/, "")
      gsub(/^[[:space:]]+|[[:space:]]+$/, "")
      gsub(/^"|"$/, "")
      gsub(/^'\''|'\''$/, "")
      print
    }
  ' "$REMOTE_STAGE/runtime.env" | tail -n 1
}
market_issue_x_ingestion_enabled() {
  value=$(runtime_value MARKET_ISSUE_X_INGESTION_ENABLED)
  case "$value" in
    0|false|FALSE|off|OFF|no|NO) return 1 ;;
    *) return 0 ;;
  esac
}
market_issue_stream_enabled() {
  value=$(runtime_value MARKET_ISSUE_STREAM_ENABLED)
  case "$value" in
    1|true|TRUE|on|ON|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}
if compose_old config --services | grep -qx "market-issue-worker"; then
  OLD_MARKET_ISSUE_WORKER=1
fi
if compose_old config --services | grep -qx "market-web-source-worker"; then
  OLD_MARKET_WEB_SOURCE_WORKER=1
fi
if compose_old config --services | grep -qx "market-issue-stream-worker"; then
  OLD_MARKET_ISSUE_STREAM_WORKER=1
fi
if compose_old config --services | grep -qx "market-issue-enrichment-worker"; then
  OLD_MARKET_ISSUE_ENRICHMENT_WORKER=1
fi
matches_version() {
  payload=$(printf '%s' "$1" | tr -d '[:space:]')
  expected=$2
  case "$payload" in
    *'"status":"ok"'*) ;;
    *) return 1 ;;
  esac
  case "$payload" in
    *'"deployment_id":"'"$expected"'"'*) return 0 ;;
    *) return 1 ;;
  esac
}
reload_billing_readonly_proxy() {
  readonly_caddy="$REMOTE_STAGE/Caddyfile.billing-readonly"
  test -f "$readonly_caddy" || return 1
  proxy_id=$(docker ps -q \
    --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
    --filter "label=com.docker.compose.service=reverse-proxy" | head -1)
  if [ -z "$proxy_id" ]; then
    docker tag "$OLD_IMAGE" krw-ontology-front-web:local || return 1
    compose_old up -d --no-deps --force-recreate reverse-proxy || return 1
    attempt=1
    while [ "$attempt" -le 15 ]; do
      proxy_id=$(docker ps -q \
        --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
        --filter "label=com.docker.compose.service=reverse-proxy" | head -1)
      if [ -n "$proxy_id" ] \
        && docker exec "$proxy_id" caddy version >/dev/null 2>&1; then
        break
      fi
      sleep 1
      attempt=$((attempt + 1))
    done
  fi
  [ -n "$proxy_id" ] || return 1
  docker cp "$readonly_caddy" "$proxy_id:/tmp/Caddyfile.billing-readonly" \
    && docker exec "$proxy_id" caddy adapt \
      --config /tmp/Caddyfile.billing-readonly \
      --adapter caddyfile >/dev/null \
    && docker exec "$proxy_id" caddy reload \
      --config /tmp/Caddyfile.billing-readonly \
      --adapter caddyfile >/dev/null
}
rollback() {
  exit_code=$?
  set +e
  if [ "$ROLLBACK_ARMED" = "1" ]; then
    if [ "$BILLING_V2_CUTOVER" = "1" ]; then
      echo "Billing V2 activation failed; preserving billing read-only mode instead of restoring legacy payment writes." >&2
      if reload_billing_readonly_proxy; then
        docker tag "$OLD_IMAGE" krw-ontology-front-web:local
        compose_old up -d --no-deps --force-recreate --wait web
        compose_old stop billing-worker
      else
        echo "Unable to restore the Caddy billing read-only gate; leaving the application stopped rather than re-enabling legacy payment writes." >&2
      fi
    else
      echo "Fast activation failed; restoring the previous VM image." >&2
      if [ "$MARKET_ISSUE_STARTED" = "1" ]; then
        compose_stage rm -sf market-issue-worker || true
      fi
      if [ "$MARKET_WEB_SOURCE_STARTED" = "1" ]; then
        compose_stage rm -sf market-web-source-worker || true
      fi
      if [ "$MARKET_ISSUE_STREAM_STARTED" = "1" ]; then
        compose_stage rm -sf market-issue-stream-worker || true
      fi
      if [ "$MARKET_ISSUE_ENRICHMENT_STARTED" = "1" ]; then
        compose_stage rm -sf market-issue-enrichment-worker || true
      fi
      docker tag "$OLD_IMAGE" krw-ontology-front-web:local
      compose_old up -d --force-recreate --wait $SERVICES
      if [ "$OLD_MARKET_ISSUE_WORKER" = "1" ]; then
        compose_old up -d --force-recreate --wait market-issue-worker
      fi
      if [ "$OLD_MARKET_WEB_SOURCE_WORKER" = "1" ]; then
        compose_old up -d --force-recreate --wait market-web-source-worker
      fi
      if [ "$OLD_MARKET_ISSUE_STREAM_WORKER" = "1" ]; then
        compose_old up -d --force-recreate --wait market-issue-stream-worker
      fi
      if [ "$OLD_MARKET_ISSUE_ENRICHMENT_WORKER" = "1" ]; then
        compose_old up -d --force-recreate --wait market-issue-enrichment-worker
      fi
    fi
  fi
  exit "$exit_code"
}
trap rollback EXIT
legacy_sidecar_ids=$( {
  docker ps -aq --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" --filter "label=com.docker.compose.service=agent-worker"
  docker ps -aq --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" --filter "label=com.docker.compose.service=ontology-mcp"
} | awk 'NF && !seen[$0]++')
if [ -n "$legacy_sidecar_ids" ]; then
  echo "Removing retired GCP ontology sidecars."
  docker rm -f $legacy_sidecar_ids
fi
docker tag "$CANDIDATE_IMAGE" krw-ontology-front-web:local
compose_stage up -d --force-recreate --wait $SERVICES
web_ready=0
attempt=1
while [ "$attempt" -le 30 ]; do
  if compose_stage exec -T -e EXPECTED_RELEASE_ID="$RELEASE_ID" web node -e 'fetch("http://127.0.0.1:3000/api/healthz").then(async response=>{const value=await response.json(); if(!response.ok||value.status!=="ok"||value.deployment_id!==process.env.EXPECTED_RELEASE_ID) process.exit(1);}).catch(()=>process.exit(1));' >/dev/null 2>&1; then
    web_ready=1
    break
  fi
  sleep 2
  attempt=$((attempt + 1))
done
[ "$web_ready" = "1" ]
for origin in "$SITE_ORIGIN_ONE" "$SITE_ORIGIN_TWO"; do
  public_ready=0
  attempt=1
  while [ "$attempt" -le 30 ]; do
    health=$(curl --connect-timeout 3 --max-time 10 -fsS "$origin/api/healthz" 2>/dev/null || true)
    if matches_version "$health" "$RELEASE_ID"; then
      public_ready=1
      break
    fi
    sleep 2
    attempt=$((attempt + 1))
  done
  [ "$public_ready" = "1" ]
done
MARKET_WEB_SOURCE_STARTED=1
compose_stage up -d --force-recreate --wait market-web-source-worker
compose_stage exec -T market-web-source-worker node -e '
  const sources = JSON.parse(process.env.MARKET_ISSUE_WEB_SOURCES || "[]");
  console.log(JSON.stringify({ worker: "market-web-source-worker", configuredSources: Array.isArray(sources) ? sources.length : 0 }));
'
if market_issue_x_ingestion_enabled; then
  MARKET_ISSUE_STARTED=1
  compose_stage up -d --force-recreate --wait market-issue-worker
  echo "Started X market-issue worker (token verified in pre-activation step)."
else
  compose_stage stop market-issue-worker || true
  echo "Skipped X market-issue worker because MARKET_ISSUE_X_INGESTION_ENABLED is disabled."
fi
if market_issue_stream_enabled; then
  MARKET_ISSUE_STREAM_STARTED=1
  compose_stage up -d --force-recreate --wait market-issue-stream-worker
  echo "Started X market-issue stream worker (token verified in pre-activation step)."
else
  compose_stage stop market-issue-stream-worker || true
  echo "Skipped X market-issue stream worker because MARKET_ISSUE_STREAM_ENABLED is disabled."
fi
MARKET_ISSUE_ENRICHMENT_STARTED=1
compose_stage up -d --force-recreate --wait market-issue-enrichment-worker
rm -f "$REMOTE_FRONT_DIR/.simple-deploy/current"
ln -s "$REMOTE_STAGE" "$REMOTE_FRONT_DIR/.simple-deploy/current"
ROLLBACK_ARMED=0
echo "Activated fast VM candidate: $RELEASE_ID"
REMOTE_SCRIPT
}

run_remote_deep_verify() {
  cat <<'REMOTE_SCRIPT' | run_remote_buffered_script "RELEASE_ID='$RELEASE_ID' REMOTE_STAGE='$REMOTE_STAGE' COMPOSE_PROJECT='$COMPOSE_PROJECT' SITE_ORIGIN_ONE='$SITE_ORIGIN_ONE' SITE_ORIGIN_TWO='$SITE_ORIGIN_TWO'"
set -e
compose_stage() {
  FRONT_DIR="$REMOTE_STAGE" NEXT_PUBLIC_APP_VERSION="$RELEASE_ID" docker compose --project-name "$COMPOSE_PROJECT" --project-directory "$REMOTE_STAGE" --env-file "$REMOTE_STAGE/runtime.env" -f "$REMOTE_STAGE/docker-compose.yml" "$@"
}
matches_version() {
  payload=$(printf '%s' "$1" | tr -d '[:space:]')
  expected=$2
  case "$payload" in
    *'"status":"ok"'*) ;;
    *) return 1 ;;
  esac
  case "$payload" in
    *'"deployment_id":"'"$expected"'"'*) return 0 ;;
    *) return 1 ;;
  esac
}
deep_ready=0
last_deep_failure=""
attempt=1
while [ "$attempt" -le 60 ]; do
  # This probe bypasses Caddy on the loopback interface. Supply the same
  # Caddy-owned client-IP header that the production proxy supplies so the
  # application proxy can reach the internal-key-protected deep health route.
  if last_deep_failure=$(compose_stage exec -T web node -e 'const headers={"x-internal-key":process.env.INTERNAL_API_KEY||"","x-krw-client-ip":"127.0.0.1"}; fetch("http://127.0.0.1:3000/api/healthz/deep",{headers}).then(async response=>{let value; try { value=await response.json(); } catch { value=null; } if(!response.ok||value?.status!=="ok"||value.deployment_id!==process.env.NEXT_PUBLIC_APP_VERSION) { console.error(`deep health returned ${response.status}: ${value?.error?.code||value?.status||"invalid response"}`); process.exit(1); }}).catch(error=>{console.error(`deep health request failed: ${error instanceof Error ? error.message : String(error)}`); process.exit(1);});' 2>&1); then
    deep_ready=1
    break
  fi
  sleep 2
  attempt=$((attempt + 1))
done
if [ "$deep_ready" != "1" ]; then
  printf '%s\n' "ERROR: deep production health did not become ready: ${last_deep_failure:-no diagnostic returned}" >&2
  exit 1
fi
for origin in "$SITE_ORIGIN_ONE" "$SITE_ORIGIN_TWO"; do
  health=$(curl --connect-timeout 3 --max-time 10 -fsS "$origin/api/healthz")
  matches_version "$health" "$RELEASE_ID"
done
echo "OK deep production health: $RELEASE_ID"
REMOTE_SCRIPT
}

run_remote_open_research_admission() {
  cat <<'REMOTE_SCRIPT' | run_remote_buffered_script "RELEASE_ID='$RELEASE_ID' REMOTE_STAGE='$REMOTE_STAGE' COMPOSE_PROJECT='$COMPOSE_PROJECT'"
set -eu
value_of() {
  key="$1"
  awk -F= -v key="$key" '
    $0 !~ /^[[:space:]]*#/ && $1 == key {
      sub(/^[^=]*=/, "")
      gsub(/^[[:space:]]+|[[:space:]]+$/, "")
      gsub(/^"|"$/, "")
      gsub(/^'\''|'\''$/, "")
      print
    }
  ' "$REMOTE_STAGE/runtime.env" | tail -n 1
}
upsert_env_value() {
  env_file="$1"
  env_key="$2"
  env_value="$3"
  tmp_file=$(mktemp "${env_file}.XXXXXX")
  awk -v key="$env_key" -v value="$env_value" '
    $0 !~ /^[[:space:]]*#/ && $0 ~ ("^" key "=") {
      if (!seen++) print key "=" value
      next
    }
    { print }
    END { if (!seen) print key "=" value }
  ' "$env_file" > "$tmp_file"
  chmod 600 "$tmp_file"
  mv "$tmp_file" "$env_file"
}
if [ "$(value_of KRW_AGENT_BACKEND_MODE)" != "rust" ]; then
  echo "Research admission is not owned by Rust Agent V1 for this release."
  exit 0
fi
test "$(value_of KRW_AGENT_ADMISSION_MODE)" = "closed"
compose_stage() {
  FRONT_DIR="$REMOTE_STAGE" NEXT_PUBLIC_APP_VERSION="$RELEASE_ID" docker compose --project-name "$COMPOSE_PROJECT" --project-directory "$REMOTE_STAGE" --env-file "$REMOTE_STAGE/runtime.env" -f "$REMOTE_STAGE/docker-compose.yml" "$@"
}
verify_deep_admission() {
  expected_admission=$1
  compose_stage exec -T web node -e 'const expected=process.argv[1]; const headers={"x-internal-key":process.env.INTERNAL_API_KEY||"","x-krw-client-ip":"127.0.0.1"}; fetch("http://127.0.0.1:3000/api/healthz/deep",{headers}).then(async response=>{const value=await response.json().catch(()=>null); if(!response.ok||value?.status!=="ok"||value?.checks?.agent_v1?.admission!==expected) process.exit(1);}).catch(()=>process.exit(1));' "$expected_admission"
}
restore_closed() {
  upsert_env_value "$REMOTE_STAGE/runtime.env" KRW_AGENT_ADMISSION_MODE closed
  compose_stage up -d --no-deps --force-recreate --wait web agent-v1-outbox || true
}
# Prove the local Mac daemon heartbeat and descriptor pins while admission is
# still closed. This avoids even a short open window for a stale Mac worker.
verify_deep_admission closed
upsert_env_value "$REMOTE_STAGE/runtime.env" KRW_AGENT_ADMISSION_MODE open
if ! compose_stage up -d --no-deps --force-recreate --wait web agent-v1-outbox; then
  restore_closed
  exit 1
fi
if ! verify_deep_admission open; then
  restore_closed
  exit 1
fi
echo "Research admission opened after deep readiness: $RELEASE_ID"
REMOTE_SCRIPT
}

run_remote_verify_billing_callback_redaction() {
  cat <<'REMOTE_SCRIPT' | run_remote_buffered_script "RELEASE_ID='$RELEASE_ID' COMPOSE_PROJECT='$COMPOSE_PROJECT' SITE_ORIGIN_ONE='$SITE_ORIGIN_ONE'"
set -eu

probe="billing-v2-redaction-${RELEASE_ID}"
status=$(curl --connect-timeout 5 --max-time 15 -sS -o /dev/null -w '%{http_code}' \
  "${SITE_ORIGIN_ONE}/api/billing/toss/success?sessionId=${probe}-session&callbackToken=${probe}-callback&authKey=${probe}-auth&customerKey=${probe}-customer" || true)
case "$status" in
  302|303|307|308) ;;
  *)
    echo "Billing callback redaction probe expected a redirect, got HTTP $status." >&2
    exit 1
    ;;
esac

proxy_id=$(docker ps -q \
  --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
  --filter "label=com.docker.compose.service=reverse-proxy" | head -1)
test -n "$proxy_id"

probe_logs=
attempt=1
while [ "$attempt" -le 10 ]; do
  probe_logs=$(docker logs --since 2m "$proxy_id" 2>&1 | grep "$probe" || true)
  [ -n "$probe_logs" ] && break
  sleep 1
  attempt=$((attempt + 1))
done
[ -n "$probe_logs" ] || {
  echo "Billing callback redaction probe did not reach the Caddy access log." >&2
  exit 1
}

for leaked in "$probe-auth" "$probe-customer" "$probe-callback"; do
  case "$probe_logs" in
    *"$leaked"*)
      echo "Caddy access log retained a Billing callback secret value." >&2
      exit 1
      ;;
  esac
done
for redacted_key in authKey customerKey callbackToken; do
  case "$probe_logs" in
    *"${redacted_key}=REDACTED"*) ;;
    *)
      echo "Caddy access log is missing redaction for $redacted_key." >&2
      exit 1
      ;;
  esac
done

echo "OK Caddy callback access-log redaction."
REMOTE_SCRIPT
}

run_remote_enable_billing_v2_writes() {
  cat <<'REMOTE_SCRIPT' | run_remote_buffered_script "REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR' COMPOSE_PROJECT='$COMPOSE_PROJECT'"
set -eu

ACTIVE_ROOT=$(cd "$REMOTE_FRONT_DIR/.simple-deploy/current" && pwd -P)
ACTIVE_ENV="$ACTIVE_ROOT/runtime.env"
CANONICAL_ENV="$REMOTE_FRONT_DIR/.env"
test -f "$ACTIVE_ENV"
test -f "$CANONICAL_ENV"
test -f "$ACTIVE_ROOT/src/lib/billing/billing-writes.ts"

value_of() {
  env_file="$1"
  env_key="$2"
  awk -F= -v key="$env_key" '
    $0 !~ /^[[:space:]]*#/ && $1 == key {
      sub(/^[^=]*=/, "")
      gsub(/^[[:space:]]+|[[:space:]]+$/, "")
      gsub(/^"|"$/, "")
      gsub(/^'\''|'\''$/, "")
      print
    }
  ' "$env_file" | tail -n 1
}
upsert_env_value() {
  env_file="$1"
  env_key="$2"
  env_value="$3"
  tmp_file=$(mktemp "${env_file}.XXXXXX")
  awk -v key="$env_key" -v value="$env_value" '
    $0 !~ /^[[:space:]]*#/ && $0 ~ ("^" key "=") {
      if (!seen++) print key "=" value
      next
    }
    { print }
    END { if (!seen) print key "=" value }
  ' "$env_file" > "$tmp_file"
  chmod 600 "$tmp_file"
  mv "$tmp_file" "$env_file"
}
compose_active() {
  FRONT_DIR="$ACTIVE_ROOT" docker compose \
    --project-name "$COMPOSE_PROJECT" \
    --project-directory "$ACTIVE_ROOT" \
    --env-file "$ACTIVE_ENV" \
    -f "$ACTIVE_ROOT/docker-compose.yml" "$@"
}
ensure_running_write_mode() {
  service="$1"
  expected="$2"
  compose_active exec -T "$service" node -e '
    if ((process.env.BILLING_WRITES_ENABLED || "") !== process.argv[1]) {
      throw new Error("billing write mode mismatch");
    }
  ' "$expected"
}
force_read_only() {
  upsert_env_value "$ACTIVE_ENV" BILLING_WRITES_ENABLED 0
  upsert_env_value "$CANONICAL_ENV" BILLING_WRITES_ENABLED 0
  if compose_active up -d --no-deps --force-recreate --wait web billing-worker \
    && ensure_running_write_mode web 0 \
    && ensure_running_write_mode billing-worker 0; then
    return 0
  fi

  # If a container cannot be recreated, block every billing route at Caddy and
  # stop the scheduler. This retains the no-legacy-write invariant even if an
  # old web container is still responding elsewhere in the product.
  readonly_caddy="$ACTIVE_ROOT/Caddyfile.billing-readonly"
  test -f "$readonly_caddy" || return 1
  proxy_id=$(docker ps -q \
    --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
    --filter "label=com.docker.compose.service=reverse-proxy" | head -1)
  test -n "$proxy_id" || return 1
  docker cp "$readonly_caddy" "$proxy_id:/tmp/Caddyfile.billing-readonly" \
    && docker exec "$proxy_id" caddy adapt \
      --config /tmp/Caddyfile.billing-readonly \
      --adapter caddyfile >/dev/null \
    && docker exec "$proxy_id" caddy reload \
      --config /tmp/Caddyfile.billing-readonly \
      --adapter caddyfile >/dev/null \
    && compose_active stop billing-worker
}

[ "$(value_of "$ACTIVE_ENV" BILLING_WRITES_ENABLED)" = "0" ] || {
  echo "Refusing to enable billing writes: active V2 runtime is not read-only." >&2
  exit 1
}
[ "$(value_of "$CANONICAL_ENV" BILLING_WRITES_ENABLED)" = "0" ] || {
  echo "Refusing to enable billing writes: canonical runtime is not read-only." >&2
  exit 1
}

writes_changed=0
restore_read_only() {
  exit_code=$?
  set +e
  if [ "$writes_changed" = "1" ]; then
    force_read_only || echo "CRITICAL: Billing read-only fallback could not be applied." >&2
  fi
  exit "$exit_code"
}
trap restore_read_only EXIT

upsert_env_value "$ACTIVE_ENV" BILLING_WRITES_ENABLED 1
upsert_env_value "$CANONICAL_ENV" BILLING_WRITES_ENABLED 1
writes_changed=1
compose_active up -d --no-deps --force-recreate --wait web
compose_active up -d --no-deps --force-recreate --wait billing-worker
ensure_running_write_mode web 1
ensure_running_write_mode billing-worker 1

writes_changed=0
trap - EXIT
echo "Billing Flow V2 writes enabled for web and billing-worker."
REMOTE_SCRIPT
}

run_remote_disable_billing_v2_writes() {
  cat <<'REMOTE_SCRIPT' | run_remote_buffered_script "REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR' COMPOSE_PROJECT='$COMPOSE_PROJECT'"
set -eu

ACTIVE_ROOT=$(cd "$REMOTE_FRONT_DIR/.simple-deploy/current" && pwd -P)
ACTIVE_ENV="$ACTIVE_ROOT/runtime.env"
CANONICAL_ENV="$REMOTE_FRONT_DIR/.env"
test -f "$ACTIVE_ENV"
test -f "$CANONICAL_ENV"
upsert_env_value() {
  env_file="$1"
  env_key="$2"
  env_value="$3"
  tmp_file=$(mktemp "${env_file}.XXXXXX")
  awk -v key="$env_key" -v value="$env_value" '
    $0 !~ /^[[:space:]]*#/ && $0 ~ ("^" key "=") {
      if (!seen++) print key "=" value
      next
    }
    { print }
    END { if (!seen) print key "=" value }
  ' "$env_file" > "$tmp_file"
  chmod 600 "$tmp_file"
  mv "$tmp_file" "$env_file"
}
compose_active() {
  FRONT_DIR="$ACTIVE_ROOT" docker compose \
    --project-name "$COMPOSE_PROJECT" \
    --project-directory "$ACTIVE_ROOT" \
    --env-file "$ACTIVE_ENV" \
    -f "$ACTIVE_ROOT/docker-compose.yml" "$@"
}
ensure_running_write_mode() {
  service="$1"
  expected="$2"
  compose_active exec -T "$service" node -e '
    if ((process.env.BILLING_WRITES_ENABLED || "") !== process.argv[1]) {
      throw new Error("billing write mode mismatch");
    }
  ' "$expected"
}
force_read_only() {
  upsert_env_value "$ACTIVE_ENV" BILLING_WRITES_ENABLED 0
  upsert_env_value "$CANONICAL_ENV" BILLING_WRITES_ENABLED 0
  if compose_active up -d --no-deps --force-recreate --wait web billing-worker \
    && ensure_running_write_mode web 0 \
    && ensure_running_write_mode billing-worker 0; then
    return 0
  fi

  readonly_caddy="$ACTIVE_ROOT/Caddyfile.billing-readonly"
  test -f "$readonly_caddy" || return 1
  proxy_id=$(docker ps -q \
    --filter "label=com.docker.compose.project=$COMPOSE_PROJECT" \
    --filter "label=com.docker.compose.service=reverse-proxy" | head -1)
  test -n "$proxy_id" || return 1
  docker cp "$readonly_caddy" "$proxy_id:/tmp/Caddyfile.billing-readonly" \
    && docker exec "$proxy_id" caddy adapt \
      --config /tmp/Caddyfile.billing-readonly \
      --adapter caddyfile >/dev/null \
    && docker exec "$proxy_id" caddy reload \
      --config /tmp/Caddyfile.billing-readonly \
      --adapter caddyfile >/dev/null \
    && compose_active stop billing-worker
}

force_read_only
echo "Billing Flow V2 returned to read-only mode."
REMOTE_SCRIPT
}

run_data_publish() {
  DATA_LOCK_DIR="$FRONT_DIR/.deploy/production-deploy.lock"
  [ ! -e "$DATA_LOCK_DIR" ] || fail "A production deploy is already active: $DATA_LOCK_DIR"
  DATA_LOCK_OWNER="fast-$RELEASE_ID"
  mkdir "$DATA_LOCK_DIR"
  printf '%s\n' "$DATA_LOCK_OWNER" > "$DATA_LOCK_DIR/owner"
  DATA_LOCK_OWNED=1
  # deploy-data-release-production validates the caller identity before it
  # reads the runtime env file, so pass the release identity explicitly.
  NEXT_PUBLIC_APP_VERSION="$RELEASE_ID" \
  PRODUCTION_DEPLOY_LOCK_OWNER="$DATA_LOCK_OWNER" \
  PRODUCTION_ORCHESTRATOR_ATTESTATION="$RELEASE_ID:$DATA_LOCK_OWNER" \
    "$SCRIPT_DIR/deploy-data-release-production.sh" --env-file "$MAC_RUNTIME_ENV"
  rm -f "$DATA_LOCK_DIR/owner"
  rmdir "$DATA_LOCK_DIR"
  DATA_LOCK_OWNED=0
}

restart_mac_services() {
  runtime_root=$1
  runtime_env=$2
  "$runtime_root/scripts/install-mcp-server-launchd.sh" --env-file "$runtime_env" --load
  "$runtime_root/scripts/install-stock-news-mcp-launchd.sh" --env-file "$runtime_env" --load
  "$runtime_root/scripts/install-filings-mcp-launchd.sh" --env-file "$runtime_env" --load
  "$runtime_root/scripts/install-mac-worker-launchd.sh" --env-file "$runtime_env" --load --skip-preflight
  "$runtime_root/scripts/install-valuation-refresh-worker-launchd.sh" --env-file "$runtime_env" --load --skip-preflight
}

verify_new_mac_runtime() {
  runtime_root=$1
  runtime_env=$2
  activation_started_at=$3

  "$runtime_root/scripts/verify-mcp-server-production.sh" --env-file "$runtime_env"
  "$runtime_root/scripts/verify-valuation-refresh-worker.sh" --env-file "$runtime_env" --timeout-ms 120000
  node "$runtime_root/scripts/verify-mac-worker-heartbeats.mjs" \
    --env-file "$runtime_env" \
    --seen-after "$activation_started_at" \
    --deployment-id "$RELEASE_ID" \
    --worker-bundle-sha256 "$WORKER_SHA" \
    --runtime-identity-sha256 "$RUNTIME_SHA" \
    --timeout-ms 120000
}

capture_previous_mac_runtime() {
  PREVIOUS_MAC_ENV=
  PREVIOUS_MAC_ROOT=
  PREVIOUS_MAC_RUNTIME_DIR=
  PREVIOUS_MAC_RUNTIME_BASE=
  for candidate in "$HOME/.local/share/krw-ontology/simple-runtimes/current/runtime.env" "$HOME/.local/share/krw-ontology/mac-runtimes/current/runtime.env"; do
    if [ -f "$candidate" ]; then
      PREVIOUS_MAC_ENV=$candidate
      PREVIOUS_MAC_ROOT=$(/bin/sh -c '. "$1"; printf "%s" "$KRW_MAC_RUNTIME_ROOT"' sh "$candidate")
      if [ ! -x "$PREVIOUS_MAC_ROOT/scripts/install-mcp-server-launchd.sh" ]; then
        PREVIOUS_MAC_ROOT=
        continue
      fi
      PREVIOUS_MAC_RUNTIME_DIR=$(CDPATH= cd -- "$(dirname -- "$candidate")" && pwd -P)
      PREVIOUS_MAC_RUNTIME_BASE=$(dirname -- "$(dirname -- "$candidate")")
      break
    fi
  done
}

restore_previous_mac_runtime() {
  if [ -z "$PREVIOUS_MAC_ENV" ] || [ -z "$PREVIOUS_MAC_ROOT" ]; then
    echo "No prior Mac runtime was available for restoration." >&2
    return 0
  fi
  echo "Mac activation failed; restoring the previous Mac runtime." >&2
  restart_mac_services "$PREVIOUS_MAC_ROOT" "$PREVIOUS_MAC_ENV" || {
    echo "Previous Mac runtime restoration also failed." >&2
    return 1
  }
  if [ -n "$PREVIOUS_MAC_RUNTIME_DIR" ] && [ -n "$PREVIOUS_MAC_RUNTIME_BASE" ]; then
    rm -f "$PREVIOUS_MAC_RUNTIME_BASE/current"
    ln -s "$PREVIOUS_MAC_RUNTIME_DIR" "$PREVIOUS_MAC_RUNTIME_BASE/current"
  fi
  MAC_RUNTIME_ACTIVATED=0
}

activate_mac_runtime() {
  capture_previous_mac_runtime
  ACTIVATION_STARTED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  if "$SCRIPT_DIR/mac-worker-preflight.sh" --env-file "$MAC_RUNTIME_ENV" --skip-worker-build --skip-worker-duplicate-check --skip-live-mcp-fingerprint; then
    if restart_mac_services "$FRONT_DIR" "$MAC_RUNTIME_ENV" \
      && verify_new_mac_runtime "$FRONT_DIR" "$MAC_RUNTIME_ENV" "$ACTIVATION_STARTED_AT"; then
      rm -f "$MAC_RUNTIME_BASE/current"
      ln -s "$MAC_RUNTIME_DIR" "$MAC_RUNTIME_BASE/current"
      MAC_RUNTIME_ACTIVATED=1
      echo "Activated Mac runtime: $MAC_RUNTIME_DIR"
      return 0
    fi
  fi
  restore_previous_mac_runtime
  return 1
}

if [ "$WITH_AGENT_RELEASE" = "0" ] && [ "$SKIP_MAC" = "0" ]; then
  prepare_mac_runtime
elif [ "$WITH_DATA" = "1" ]; then
  prepare_data_environment
fi

if [ "$WITH_AGENT_RELEASE" = "1" ]; then
  # Copy and offline-verify the complete sealed release locally before any
  # production traffic changes. This does not start a new daemon yet.
  stage_local_agent_release
fi

if [ "$SKIP_WEB" = "0" ]; then
  prune_remote_stale_deployment_artifacts
  create_archives
  upload_archive "$FRONT_ARCHIVE" "$REMOTE_FRONT_ARCHIVE" "frontend archive"
  if [ "$WITH_AGENT_RELEASE" = "1" ]; then
    create_agent_descriptor_upload
    upload_archive "$AGENT_DESCRIPTOR_COPY" "$REMOTE_AGENT_DESCRIPTOR" "public Rust release descriptor"
  fi
  run_remote_prepare
  if [ "$BILLING_V2_CUTOVER" = "1" ]; then
    run_remote_pause_billing_for_cutover
  fi
fi

if [ "$APPLY_MIGRATIONS" = "1" ]; then
  if [ "$WITH_AGENT_RELEASE" = "1" ]; then
    run_agent_release_migrations
  fi
  if [ "$MIGRATION_INCLUDE_ALL" = "1" ]; then
    "$SCRIPT_DIR/supabase-cli.sh" db push --include-all
  else
    "$SCRIPT_DIR/supabase-cli.sh" db push
  fi
  run_schema_smoke
  if [ "$WITH_AGENT_RELEASE" = "1" ]; then
    verify_sealed_local_agent_database_abi
  fi
fi

if [ "$WITH_AGENT_RELEASE" = "1" ] && [ "$SKIP_WEB" = "0" ]; then
  run_remote_validate_agent_candidate_abi
fi

if [ "$WITH_DATA" = "1" ]; then
  run_data_publish
fi

if [ "$WITH_AGENT_RELEASE" = "1" ]; then
  run_remote_close_research_admission
  AGENT_ADMISSION_CLOSED=1
  AGENT_CUTOVER_ROLLBACK_ARMED=1
  # Arm rollback before switching the local launchd job: a terminal or SSH
  # loss after a successful switch is treated as ambiguous and restores the
  # prior Mac release before public admission can be reopened.
  AGENT_LOCAL_RELEASE_ACTIVATED=1
  activate_local_agent_release
  # `krw-agentd` has already written its own release-bound database heartbeat
  # before its loopback metrics endpoint becomes ready. No Claude/plugin
  # worker is restarted or consulted on the Rust deployment path.
fi

if [ "$SKIP_WEB" = "0" ]; then
  if [ "$WITH_AGENT_RELEASE" = "1" ]; then
    FRONT_CANDIDATE_ACTIVATED=1
  fi
  run_remote_activate
fi

if [ "$WITH_AGENT_RELEASE" = "0" ] && [ "$SKIP_MAC" = "0" ]; then
  activate_mac_runtime
fi

if [ "$SKIP_WEB" = "0" ]; then
  run_remote_deep_verify
  if [ "$WITH_AGENT_RELEASE" = "0" ]; then
    run_remote_open_research_admission
  elif [ "$AGENT_FINAL_EVIDENCE_VERIFIED" = "1" ]; then
    run_remote_open_research_admission
  else
    echo "Rust release is healthy on this Mac and the GCP web candidate is live, but research admission remains closed until the private DeepSeek canary evidence is verified."
  fi
fi

# The matching agent daemon, web/outbox candidate, and admission gate are all
# now healthy. Later billing-only checks do not roll back this completed
# research-engine cutover.
if [ "$WITH_AGENT_RELEASE" = "1" ]; then
  AGENT_CUTOVER_ROLLBACK_ARMED=0
  AGENT_LOCAL_RELEASE_ACTIVATED=0
  AGENT_ADMISSION_CLOSED=0
  FRONT_CANDIDATE_ACTIVATED=0
fi

if [ "$BILLING_V2_CUTOVER" = "1" ]; then
  "$SCRIPT_DIR/verify-billing-production-readiness.sh" --require-v2-zero-state
  run_remote_verify_billing_callback_redaction
  run_remote_enable_billing_v2_writes
  if ! "$SCRIPT_DIR/verify-billing-production-readiness.sh"; then
    run_remote_disable_billing_v2_writes
    fail "Billing Flow V2 post-activation readiness failed; writes were returned to read-only mode."
  fi
fi

echo "Production release complete: $RELEASE_ID"
