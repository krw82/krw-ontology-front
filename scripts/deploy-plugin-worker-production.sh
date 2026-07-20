#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/deploy-plugin-worker-production.sh --env-file FILE [--dry-run] (--prepare-only|--verify-prepared-only|--activate-prepared)

Internal Mac runtime deployment lane. Production callers must hold the shared
orchestrator lock. The public entry point is `npm run prod:deploy:full` (or the
queue-safe code/data variants), never this script directly.

  --prepare-only       Build a versioned, immutable Mac runtime and exercise
                       its MCPs on isolated loopback ports. Does not touch live
                       launchd services.
  --verify-prepared-only
                       Recheck the complete artifact seal and identity without
                       changing launchd. Used immediately before migrations.
  --activate-prepared  Verify the sealed runtime, point launchd at that exact
                       directory/env, and require an identity-bound heartbeat.
EOF
}

ENV_FILE=.env.mac-worker.production
DRY_RUN=0
DEPLOY_MODE=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE=${2:?Missing value for --env-file}; shift ;;
    --dry-run) DRY_RUN=1 ;;
    --prepare-only|--verify-prepared-only|--activate-prepared)
      [ -z "$DEPLOY_MODE" ] || { echo "Choose exactly one deployment mode." >&2; exit 1; }
      DEPLOY_MODE=${1#--}
      ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
  shift
done
[ -n "$DEPLOY_MODE" ] || { usage >&2; exit 1; }

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
case "$ENV_FILE" in
  /*) ENV_PATH=$ENV_FILE ;;
  *) ENV_PATH="$FRONT_DIR/$ENV_FILE" ;;
esac

require_path() {
  [ -e "$1" ] || { echo "Missing required path: $1" >&2; exit 1; }
}
require_command() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required command: $1" >&2; exit 1; }
}
truthy_env() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}
file_sha256() {
  shasum -a 256 "$1" | awk '{print $1}'
}
resolve_existing_path() {
  path_value=$1
  path_dir=$(dirname "$path_value")
  path_name=$(basename "$path_value")
  printf '%s/%s\n' "$(CDPATH= cd -- "$path_dir" && pwd -P)" "$path_name"
}
append_env_value() {
  target_file=$1
  target_key=$2
  target_value=$3
  escaped_value=$(printf '%s' "$target_value" | sed "s/'/'\"'\"'/g")
  printf "%s='%s'\n" "$target_key" "$escaped_value" >>"$target_file"
}

# The staged ontology environment is isolated from the active runtime, so a
# transient TERM that lands on its `uv sync` child can be retried safely before
# the cutover reaches any migration or runtime-activation boundary. A TERM sent
# to this deployment shell still follows the outer orchestrator's normal abort
# path; this only covers the observed child-process interruption.
sync_locked_ontology_environment() {
  runtime_sync_dir=$1
  runtime_sync_venv=$2
  runtime_sync_attempt=1

  while :; do
    if (
      cd "$runtime_sync_dir"
      VIRTUAL_ENV="$runtime_sync_venv" \
        uv sync --active --frozen --no-dev --no-python-downloads
    ); then
      return 0
    else
      runtime_sync_status=$?
    fi

    if [ "$runtime_sync_status" -ne 143 ] || [ "$runtime_sync_attempt" -ge 3 ]; then
      return "$runtime_sync_status"
    fi

    echo "Retrying isolated ontology environment sync after a transient SIGTERM (attempt $((runtime_sync_attempt + 1))/3)..." >&2
    runtime_sync_attempt=$((runtime_sync_attempt + 1))
    sleep 1
  done
}

require_command node
require_command shasum
require_path "$ENV_PATH"
require_path "$FRONT_DIR/ops/production-target.json"
require_path "$SCRIPT_DIR/verify-supabase-production-target.mjs"

# Preserve orchestrator identity across sourcing. Operator env files may carry
# an old app version; they must never replace the identity selected by the
# current cutover.
CALLER_DEPLOY_LOCK_OWNER=${PRODUCTION_DEPLOY_LOCK_OWNER:-}
CALLER_OS_LOCK_HELD=${PRODUCTION_OS_LOCK_HELD:-}
CALLER_ATTESTATION=${PRODUCTION_ORCHESTRATOR_ATTESTATION:-}
CALLER_APP_VERSION=${NEXT_PUBLIC_APP_VERSION:-}
CALLER_EXPECTED_APP_VERSION=${EXPECTED_PREPARED_APP_VERSION:-}
CALLER_FRONT_SHA=${EXPECTED_FRONT_SOURCE_SHA256:-}
CALLER_ONTOLOGY_SHA=${EXPECTED_ONTOLOGY_SOURCE_SHA256:-}
CALLER_STOCK_NEWS_SHA=${EXPECTED_STOCK_NEWS_SOURCE_SHA256:-}
CONTROL_DEPLOY_MODE=$DEPLOY_MODE
CONTROL_DRY_RUN=$DRY_RUN
CONTROL_SCRIPT_DIR=$SCRIPT_DIR
CONTROL_FRONT_DIR=$FRONT_DIR
CONTROL_ENV_PATH=$ENV_PATH
CONTROL_PATH=$PATH
CONTROL_HOME=$HOME
readonly CALLER_DEPLOY_LOCK_OWNER CALLER_OS_LOCK_HELD CALLER_ATTESTATION
readonly CALLER_APP_VERSION CALLER_EXPECTED_APP_VERSION CALLER_FRONT_SHA CALLER_ONTOLOGY_SHA
readonly CALLER_STOCK_NEWS_SHA
readonly CONTROL_DEPLOY_MODE CONTROL_DRY_RUN CONTROL_SCRIPT_DIR CONTROL_FRONT_DIR
readonly CONTROL_ENV_PATH CONTROL_PATH CONTROL_HOME

set -a
# shellcheck disable=SC1090
. "$ENV_PATH"
set +a
[ -z "$CALLER_DEPLOY_LOCK_OWNER" ] || PRODUCTION_DEPLOY_LOCK_OWNER=$CALLER_DEPLOY_LOCK_OWNER
[ -z "$CALLER_OS_LOCK_HELD" ] || PRODUCTION_OS_LOCK_HELD=$CALLER_OS_LOCK_HELD
[ -z "$CALLER_ATTESTATION" ] || PRODUCTION_ORCHESTRATOR_ATTESTATION=$CALLER_ATTESTATION
[ -z "$CALLER_APP_VERSION" ] || NEXT_PUBLIC_APP_VERSION=$CALLER_APP_VERSION
[ -z "$CALLER_EXPECTED_APP_VERSION" ] || EXPECTED_PREPARED_APP_VERSION=$CALLER_EXPECTED_APP_VERSION
[ -z "$CALLER_FRONT_SHA" ] || EXPECTED_FRONT_SOURCE_SHA256=$CALLER_FRONT_SHA
[ -z "$CALLER_ONTOLOGY_SHA" ] || EXPECTED_ONTOLOGY_SOURCE_SHA256=$CALLER_ONTOLOGY_SHA
[ -z "$CALLER_STOCK_NEWS_SHA" ] || EXPECTED_STOCK_NEWS_SOURCE_SHA256=$CALLER_STOCK_NEWS_SHA
DEPLOY_MODE=$CONTROL_DEPLOY_MODE
DRY_RUN=$CONTROL_DRY_RUN
SCRIPT_DIR=$CONTROL_SCRIPT_DIR
FRONT_DIR=$CONTROL_FRONT_DIR
ENV_PATH=$CONTROL_ENV_PATH
PATH=$CONTROL_PATH
HOME=$CONTROL_HOME
export PRODUCTION_DEPLOY_LOCK_OWNER PRODUCTION_OS_LOCK_HELD PRODUCTION_ORCHESTRATOR_ATTESTATION
export NEXT_PUBLIC_APP_VERSION EXPECTED_PREPARED_APP_VERSION
export EXPECTED_STOCK_NEWS_SOURCE_SHA256
export PATH HOME

node "$SCRIPT_DIR/verify-supabase-production-target.mjs" \
  "$ENV_PATH" \
  "$FRONT_DIR/supabase/.temp/project-ref" \
  "$FRONT_DIR/ops/production-target.json"

if [ "$DRY_RUN" != "1" ]; then
  DEPLOY_LOCK_DIR="$FRONT_DIR/.deploy/production-deploy.lock"
  [ -n "${PRODUCTION_DEPLOY_LOCK_OWNER:-}" ] || {
    echo "Mac production lane is internal; invoke the queue-safe production orchestrator." >&2
    exit 1
  }
  require_path "$DEPLOY_LOCK_DIR/owner"
  [ "$(sed -n '1p' "$DEPLOY_LOCK_DIR/owner")" = "$PRODUCTION_DEPLOY_LOCK_OWNER" ] || {
    echo "Production orchestrator lock ownership mismatch." >&2
    exit 1
  }
  [ "${PRODUCTION_OS_LOCK_HELD:-0}" = "1" ] || {
    echo "Missing kernel-held production deploy lock." >&2
    exit 1
  }
  expected_attestation="${NEXT_PUBLIC_APP_VERSION:-}:$PRODUCTION_DEPLOY_LOCK_OWNER"
  [ "${PRODUCTION_ORCHESTRATOR_ATTESTATION:-}" = "$expected_attestation" ] || {
    echo "Missing or invalid production orchestrator attestation." >&2
    exit 1
  }
fi

MAC_DEPLOYMENT_ID=${EXPECTED_PREPARED_APP_VERSION:-${NEXT_PUBLIC_APP_VERSION:-}}
case "$MAC_DEPLOYMENT_ID" in
  ''|*[!A-Za-z0-9._-]*)
    echo "A valid orchestrator-selected deployment id is required." >&2
    exit 1
    ;;
esac
[ "${NEXT_PUBLIC_APP_VERSION:-$MAC_DEPLOYMENT_ID}" = "$MAC_DEPLOYMENT_ID" ] || {
  echo "Prepared Mac deployment id differs from the active cutover id." >&2
  exit 1
}
for digest_name in EXPECTED_FRONT_SOURCE_SHA256 EXPECTED_ONTOLOGY_SOURCE_SHA256; do
  eval "digest_value=\${$digest_name:-}"
  printf '%s' "$digest_value" | grep -Eq '^[a-f0-9]{64}$' || {
    echo "$digest_name must be the orchestrator-pinned lowercase SHA-256 digest." >&2
    exit 1
  }
done

ONTOLOGY_SOURCE_DIR=${KRW_ONTOLOGY_SOURCE_DIR:-"$HOME/krw-ontology"}
PLUGIN_SOURCE_PATH=${KRW_ONTOLOGY_PLUGIN_SOURCE_PATH:-"$ONTOLOGY_SOURCE_DIR/plugins/krw-ontology"}
GURU_PLUGIN_SOURCE_PATH=${KRW_GURU_ADVISOR_PLUGIN_SOURCE_PATH:-"$ONTOLOGY_SOURCE_DIR/plugins/krw-guru-advisor"}
GURU_DATA_ROOT=${KRW_GURU_DATA_ROOT:-"$HOME/krw-ontology-guru-data"}
GURU_RELEASE_ROOT=${KRW_GURU_RELEASE_ROOT:-"$GURU_DATA_ROOT/releases/prod/current"}
require_path "${KRW_ONTOLOGY_RELEASE_ROOT:?Missing KRW_ONTOLOGY_RELEASE_ROOT}"
require_path "$GURU_RELEASE_ROOT"
ACTIVE_RELEASE_ROOT=$(CDPATH= cd -- "$KRW_ONTOLOGY_RELEASE_ROOT" && pwd -P)
CURRENT_RELEASE_LINK=${KRW_ONTOLOGY_CURRENT_RELEASE_ROOT:-"$(dirname "$KRW_ONTOLOGY_RELEASE_ROOT")/current"}
require_path "$CURRENT_RELEASE_LINK"
if [ ! -L "$CURRENT_RELEASE_LINK" ]; then
  echo "KRW_ONTOLOGY_CURRENT_RELEASE_ROOT must be the prod/current symlink: $CURRENT_RELEASE_LINK" >&2
  exit 1
fi
CURRENT_RELEASE_ROOT=$(CDPATH= cd -- "$CURRENT_RELEASE_LINK" && pwd -P)
[ "$CURRENT_RELEASE_ROOT" = "$ACTIVE_RELEASE_ROOT" ] || {
  echo "KRW_ONTOLOGY_CURRENT_RELEASE_ROOT does not resolve to the pinned production release." >&2
  exit 1
}
ACTIVE_GURU_RELEASE_ROOT=$(CDPATH= cd -- "$GURU_RELEASE_ROOT" && pwd -P)
ACTIVE_RELEASE_ID=$(basename "$ACTIVE_RELEASE_ROOT")
require_path "$ACTIVE_RELEASE_ROOT/manifest.json"
require_path "$ACTIVE_GURU_RELEASE_ROOT/manifest.json"

ONTOLOGY_DATA_ROOT=$(dirname "$(dirname "$(dirname "$ACTIVE_RELEASE_ROOT")")")
EXPECTED_PLUGIN_PATH="$ONTOLOGY_DATA_ROOT/runtime/plugins/prod/$ACTIVE_RELEASE_ID-canonical/krw-ontology"
EXPECTED_GURU_PLUGIN_PATH="$FRONT_DIR/ref/plugins/prod/krw-guru-advisor"
[ "${KRW_ONTOLOGY_PLUGIN_PATH:-}" = "$EXPECTED_PLUGIN_PATH" ] || {
  echo "KRW_ONTOLOGY_PLUGIN_PATH is not the canonical active-release plugin path." >&2
  exit 1
}
[ "${KRW_GURU_ADVISOR_PLUGIN_PATH:-$EXPECTED_GURU_PLUGIN_PATH}" = "$EXPECTED_GURU_PLUGIN_PATH" ] || {
  echo "KRW_GURU_ADVISOR_PLUGIN_PATH is not the canonical source plugin path." >&2
  exit 1
}

STOCK_NEWS_RUNTIME_ENABLED=0
if ! truthy_env "${STOCK_NEWS_FORCE_DISABLED:-}" && truthy_env "${STOCK_NEWS_ENABLED:-}"; then
  [ -n "${FINNHUB_API_KEY:-}" ] || { echo "Stock News is enabled but FINNHUB_API_KEY is missing." >&2; exit 1; }
  printf '%s' "${EXPECTED_STOCK_NEWS_SOURCE_SHA256:-}" | grep -Eq '^[a-f0-9]{64}$' || {
    echo "Enabled Stock News requires an orchestrator-pinned source digest." >&2
    exit 1
  }
  STOCK_NEWS_RUNTIME_ENABLED=1
fi
FILINGS_MCP_RUNTIME_ENABLED=0
if truthy_env "${FILINGS_MCP_ENABLED:-}"; then
  for key in FILINGS_MCP_AUTH_TOKEN FILINGS_MCP_PERSONAL_SIGNING_SECRET SEC_USER_AGENT; do
    eval "value=\${$key:-}"
    [ -n "$value" ] || { echo "Filings MCP is enabled but $key is missing." >&2; exit 1; }
  done
  [ "$FILINGS_MCP_PERSONAL_SIGNING_SECRET" != "$FILINGS_MCP_AUTH_TOKEN" ] || {
    echo "FILINGS_MCP_PERSONAL_SIGNING_SECRET must differ from FILINGS_MCP_AUTH_TOKEN." >&2
    exit 1
  }
  FILINGS_MCP_RUNTIME_ENABLED=1
fi

MAC_RUNTIME_BASE=${KRW_MAC_RUNTIME_BASE:-"$HOME/.local/share/krw-ontology/mac-runtimes"}
RUNTIME_ROOT="$MAC_RUNTIME_BASE/$MAC_DEPLOYMENT_ID"
RUNTIME_ENV_PATH="$RUNTIME_ROOT/runtime.env"
RUNTIME_WORKER_PATH="$RUNTIME_ROOT/.worker"
RUNTIME_ONTOLOGY_SOURCE="$RUNTIME_ROOT/ontology-source"
RUNTIME_PYTHON_HOME="$RUNTIME_ROOT/python-runtime"
RUNTIME_PLUGIN_PATH="$RUNTIME_ROOT/plugins/krw-ontology"
RUNTIME_GURU_PLUGIN_PATH="$RUNTIME_ROOT/plugins/krw-guru-advisor"
RUNTIME_STOCK_NEWS_ROOT="$RUNTIME_ROOT/stock-news-mcp"
RUNTIME_DEPLOYMENT_ID_FILE="$RUNTIME_ROOT/deployment-id"
RUNTIME_IDENTITY_FILE="$RUNTIME_ROOT/runtime-identity.json"
RUNTIME_CANDIDATE_PROOF="$RUNTIME_ROOT/candidate-verification.json"
RUNTIME_SEAL="$RUNTIME_ROOT/.artifact-seal.json"

seal_runtime() {
  seal_mode=$1
  set -- "$seal_mode" \
    --marker "$RUNTIME_SEAL" \
    --symlink-boundary "$RUNTIME_ROOT" \
    --path "$RUNTIME_WORKER_PATH" \
    --path "$RUNTIME_ROOT/node_modules" \
    --path "$RUNTIME_ROOT/package.json" \
    --path "$RUNTIME_ROOT/package-lock.json" \
    --path "$RUNTIME_ROOT/scripts" \
    --path "$RUNTIME_ROOT/ops" \
    --path "$RUNTIME_ONTOLOGY_SOURCE" \
    --path "$RUNTIME_PYTHON_HOME" \
    --path "$RUNTIME_ROOT/plugins" \
    --path "$RUNTIME_ENV_PATH" \
    --path "$RUNTIME_DEPLOYMENT_ID_FILE" \
    --path "$RUNTIME_IDENTITY_FILE" \
    --path "$RUNTIME_CANDIDATE_PROOF" \
    --path "$ACTIVE_RELEASE_ROOT/manifest.json" \
    --path "$ACTIVE_GURU_RELEASE_ROOT/manifest.json"
  if [ "$STOCK_NEWS_RUNTIME_ENABLED" = "1" ]; then
    set -- "$@" --path "$RUNTIME_STOCK_NEWS_ROOT"
  fi
  artifact_verifier="$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs"
  if [ -f "$RUNTIME_ROOT/scripts/verify-prepared-runtime-artifacts.mjs" ]; then
    artifact_verifier="$RUNTIME_ROOT/scripts/verify-prepared-runtime-artifacts.mjs"
  fi
  node "$artifact_verifier" "$@"
}

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: Mac $DEPLOY_MODE deployment=$MAC_DEPLOYMENT_ID runtime=$RUNTIME_ROOT"
  if [ "$DEPLOY_MODE" = "prepare-only" ]; then
    echo "Dry run: would install exact Node dependencies and a copied Python runtime/venv, pin resolved release paths, build Stock News, boot candidate MCPs on isolated ports, and seal all bytes."
  elif [ "$DEPLOY_MODE" = "verify-prepared-only" ]; then
    echo "Dry run: would re-verify the immutable Mac runtime without changing launchd."
  else
    echo "Dry run: would verify the immutable seal, bootstrap launchd from the versioned runtime, then require exact deployment/bundle/runtime heartbeat identity."
  fi
  exit 0
fi

if [ "$DEPLOY_MODE" = "prepare-only" ]; then
  require_command npm
  require_command rsync
  require_command uv
  require_command curl
  [ ! -e "$RUNTIME_ROOT" ] || {
    echo "Refusing to overwrite versioned Mac runtime: $RUNTIME_ROOT" >&2
    exit 1
  }
  umask 077
  mkdir -p "$MAC_RUNTIME_BASE" "$RUNTIME_ROOT/scripts" "$RUNTIME_ROOT/ops" "$RUNTIME_ROOT/plugins"
  chmod 700 "$MAC_RUNTIME_BASE" "$RUNTIME_ROOT"
  printf '%s\n' "$MAC_DEPLOYMENT_ID" >"$RUNTIME_DEPLOYMENT_ID_FILE"

  # Take one frontend snapshot, verify its complete logical source identity,
  # and derive every control script/template and worker bundle from those same
  # bytes. Copying controls from the live checkout before verifying another
  # rsync tree would permit an ABA edit to cross the runtime seal.
  echo "Building worker bundles from the cutover source snapshot..."
  BUILD_DIR="$RUNTIME_ROOT/.build"
  mkdir -p "$BUILD_DIR"
  rsync -a --delete \
    --exclude '/.git/' --exclude '/.next/' --exclude '/.worker/' \
    --exclude '/.deploy/' --exclude '/node_modules/' --exclude '/output/' \
    --exclude '/krw-ontology' --exclude '.env' --exclude '.env.*' \
    --exclude '.supabase-prod-db-password' \
    "$FRONT_DIR/" "$BUILD_DIR/"
  COPIED_FRONT_SOURCE_SHA256=$(node \
    "$BUILD_DIR/scripts/compute-production-source-sha256.mjs" "$BUILD_DIR")
  [ "$COPIED_FRONT_SOURCE_SHA256" = "$EXPECTED_FRONT_SOURCE_SHA256" ] || {
    echo "Mac worker build snapshot does not match the gated frontend source." >&2
    exit 1
  }

  for script_name in \
    activate-prepared-mac-runtime.sh \
    compute-production-source-sha256.mjs \
    deploy-worker-production.sh \
    export-stock-news-coverage.mjs \
    install-filings-mcp-launchd.sh \
    install-mac-worker-launchd.sh \
    install-mcp-server-launchd.sh \
    install-stock-news-mcp-launchd.sh \
    mac-worker-preflight.sh \
    materialize-guru-advisor-plugin.mjs \
    materialize-ontology-plugin.mjs \
    start-mac-worker-production.sh \
    start-mcp-server-production.sh \
    start-stock-news-mcp-production.sh \
    start-filings-mcp-production.sh \
    status-production-workers.sh \
    mcp-runtime-fingerprint.sh \
    verify-filings-mcp-production.sh \
    verify-mac-runtime-target.sh \
    verify-mac-worker-heartbeats.mjs \
    verify-mcp-runtime.mjs \
    verify-mcp-server-production.sh \
    verify-prepared-runtime-artifacts.mjs \
    verify-stock-news-mcp-production.sh \
    verify-supabase-production-target.mjs
  do
    cp "$BUILD_DIR/scripts/$script_name" "$RUNTIME_ROOT/scripts/$script_name"
  done
  mkdir -p "$RUNTIME_ROOT/ops/launchd"
  cp "$BUILD_DIR/ops/production-target.json" "$RUNTIME_ROOT/ops/production-target.json"
  for template_name in \
    com.krwontology.agent-worker.plist.template \
    com.krwontology.filings-mcp.plist.template \
    com.krwontology.mcp-server.plist.template \
    com.krwontology.stock-news-mcp.plist.template
  do
    cp "$BUILD_DIR/ops/launchd/$template_name" "$RUNTIME_ROOT/ops/launchd/$template_name"
  done
  chmod 500 "$RUNTIME_ROOT/scripts"/*.sh

  # The runtime environment intentionally has NODE_ENV=production. Make the
  # build-time dependency set explicit nevertheless: esbuild is a dev
  # dependency, while the sealed runtime below is pruned back to production
  # dependencies after the worker bundle has been produced.
  (cd "$BUILD_DIR" && npm ci --include=dev --no-audit --no-fund && npm run build:worker)
  mv "$BUILD_DIR/.worker" "$RUNTIME_WORKER_PATH"
  cp "$BUILD_DIR/package.json" "$BUILD_DIR/package-lock.json" "$RUNTIME_ROOT/"
  rm -rf "$BUILD_DIR"
  (cd "$RUNTIME_ROOT" && npm ci --omit=dev)
  WORKER_BUNDLE_SHA256=$(node \
    "$RUNTIME_ROOT/scripts/compute-production-source-sha256.mjs" \
    "$RUNTIME_WORKER_PATH")

  echo "Copying the exact ontology Python interpreter and locked environment..."
  require_path "$ONTOLOGY_SOURCE_DIR/pyproject.toml"
  require_path "$ONTOLOGY_SOURCE_DIR/uv.lock"
  rsync -a --delete \
    --exclude '/.git/' --exclude '/.venv*/' --exclude '/__pycache__/' \
    --exclude '/.pytest_cache/' --exclude '/.ruff_cache/' \
    --exclude '/.env' --exclude '/.env.*' \
    "$ONTOLOGY_SOURCE_DIR/" "$RUNTIME_ONTOLOGY_SOURCE/"
  COPIED_ONTOLOGY_SOURCE_SHA256=$(node \
    "$RUNTIME_ROOT/scripts/compute-production-source-sha256.mjs" \
    "$RUNTIME_ONTOLOGY_SOURCE")
  [ "$COPIED_ONTOLOGY_SOURCE_SHA256" = "$EXPECTED_ONTOLOGY_SOURCE_SHA256" ] || {
    echo "Mac ontology snapshot does not match the gated ontology source." >&2
    exit 1
  }
  SOURCE_PYTHON=$(cd "$ONTOLOGY_SOURCE_DIR" && uv run --frozen python -c 'import os,sys;print(os.path.realpath(sys.executable))')
  SOURCE_PYTHON_HOME=$("$SOURCE_PYTHON" -c 'import os,sys;print(os.path.realpath(sys.base_prefix))')
  require_path "$SOURCE_PYTHON_HOME"
  rsync -a --delete "$SOURCE_PYTHON_HOME/" "$RUNTIME_PYTHON_HOME/"
  RUNTIME_PYTHON="$RUNTIME_PYTHON_HOME/bin/$(basename "$SOURCE_PYTHON")"
  require_path "$RUNTIME_PYTHON"
  uv venv --python "$RUNTIME_PYTHON" "$RUNTIME_ONTOLOGY_SOURCE/.venv"
  sync_locked_ontology_environment \
    "$RUNTIME_ONTOLOGY_SOURCE" \
    "$RUNTIME_ONTOLOGY_SOURCE/.venv"
  "$RUNTIME_ONTOLOGY_SOURCE/.venv/bin/krw-ontology" release verify \
    --startup-check --root "$ACTIVE_RELEASE_ROOT" --env prod >/dev/null

  # Derive the plugin contract inside the copied interpreter/source tree that
  # will run the candidate MCP. Git metadata and resolved package versions
  # must not differ from the sealed runtime the contract attests.
  KRW_ONTOLOGY_SOURCE_DIR="$RUNTIME_ONTOLOGY_SOURCE" \
  KRW_ONTOLOGY_RELEASE_ROOT="$ACTIVE_RELEASE_ROOT" \
  KRW_ONTOLOGY_ROOT="$ACTIVE_RELEASE_ROOT" \
  KRW_MCP_EXPECTED_TOOL_SCHEMA_SHA256= \
  KRW_MCP_EXPECTED_BUILD_FINGERPRINT_SHA256= \
  node "$RUNTIME_ROOT/scripts/materialize-ontology-plugin.mjs" \
    --env prod \
    --source "$RUNTIME_ONTOLOGY_SOURCE/plugins/krw-ontology" \
    --out "$RUNTIME_PLUGIN_PATH" \
    --mcp-url "$KRW_ONTOLOGY_MCP_URL" \
    --stock-news-url "${STOCK_NEWS_MCP_URL:-http://127.0.0.1:8775/mcp}" >/dev/null
  node "$RUNTIME_ROOT/scripts/materialize-guru-advisor-plugin.mjs" \
    --env prod \
    --source "$RUNTIME_ONTOLOGY_SOURCE/plugins/krw-guru-advisor" \
    --out "$RUNTIME_GURU_PLUGIN_PATH" \
    --ontology-source-dir "$RUNTIME_ONTOLOGY_SOURCE" \
    --guru-data-root "$GURU_DATA_ROOT" \
    --guru-release-root "$ACTIVE_GURU_RELEASE_ROOT" >/dev/null

  if [ "$STOCK_NEWS_RUNTIME_ENABLED" = "1" ]; then
    STOCK_NEWS_SOURCE_ROOT=${STOCK_NEWS_MCP_ROOT:-"$HOME/mcp-servers/stock-news-mcp"}
    require_path "$STOCK_NEWS_SOURCE_ROOT/package.json"
    require_path "$STOCK_NEWS_SOURCE_ROOT/package-lock.json"
    rsync -a --delete \
      --exclude '/.git/' --exclude '/node_modules/' --exclude '/dist/' \
      --exclude '/.env' --exclude '/.env.*' \
      "$STOCK_NEWS_SOURCE_ROOT/" "$RUNTIME_STOCK_NEWS_ROOT/"
    COPIED_STOCK_NEWS_SOURCE_SHA256=$(node \
      "$RUNTIME_ROOT/scripts/compute-production-source-sha256.mjs" \
      "$RUNTIME_STOCK_NEWS_ROOT")
    [ "$COPIED_STOCK_NEWS_SOURCE_SHA256" = "$EXPECTED_STOCK_NEWS_SOURCE_SHA256" ] || {
      echo "Mac Stock News snapshot does not match the orchestrator-pinned source." >&2
      exit 1
    }
    (cd "$RUNTIME_STOCK_NEWS_ROOT" && npm ci && npm run build && npm prune --omit=dev)
    node "$RUNTIME_ROOT/scripts/export-stock-news-coverage.mjs" \
      --env prod --env-file "$ENV_PATH" \
      --out "$RUNTIME_PLUGIN_PATH/stock-news/coverage_companies.json"
  fi

  # The canonical runtime env may itself be sealed read-only. `cp` preserves
  # that mode when creating the candidate, so explicitly make the private
  # candidate writable until every identity-bound value is materialized.
  cp "$ENV_PATH" "$RUNTIME_ENV_PATH"
  chmod 600 "$RUNTIME_ENV_PATH"
  if [ -n "${CLAUDE_CONFIG_DIR:-}" ] && [ -f "$CLAUDE_CONFIG_DIR/deepseek.env" ]; then
    # Never source a mutable provider env from the sealed runtime. Parse only
    # the explicit LLM-routing allowlist and materialize those values into the
    # versioned runtime env so subsequent launchd restarts see identical bytes.
    node - "$CLAUDE_CONFIG_DIR/deepseek.env" "$RUNTIME_ENV_PATH" <<'NODE'
const fs = require("node:fs");
const [source, destination] = process.argv.slice(2);
const allowed = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  "DEEPSEEK_API_KEY",
  "API_TIMEOUT_MS",
  "MCP_TIMEOUT",
  "MCP_TOOL_TIMEOUT",
  "MAX_THINKING_TOKENS",
  "DISABLE_TELEMETRY",
  "DISABLE_ERROR_REPORTING",
  "DISABLE_BUG_COMMAND",
]);
const output = [];
for (const [index, raw] of fs.readFileSync(source, "utf8").split(/\r?\n/).entries()) {
  let line = raw.trim();
  if (!line || line.startsWith("#")) continue;
  if (line.startsWith("export ")) line = line.slice(7).trim();
  const separator = line.indexOf("=");
  if (separator <= 0) throw new Error(`Invalid provider env line ${index + 1}`);
  const key = line.slice(0, separator).trim();
  if (!allowed.has(key)) throw new Error(`Provider env key is not allowlisted: ${key}`);
  let value = line.slice(separator + 1).trim();
  if (
    value.length >= 2 &&
    ((value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1);
  }
  output.push(`${key}='${value.replaceAll("'", "'\"'\"'")}'`);
}
if (output.length > 0) fs.appendFileSync(destination, `${output.join("\n")}\n`);
NODE
  fi
  append_env_value "$RUNTIME_ENV_PATH" KRW_SEALED_CLAUDE_ENV 1
  append_env_value "$RUNTIME_ENV_PATH" NEXT_PUBLIC_APP_VERSION "$MAC_DEPLOYMENT_ID"
  append_env_value "$RUNTIME_ENV_PATH" KRW_DEPLOYMENT_ID "$MAC_DEPLOYMENT_ID"
  append_env_value "$RUNTIME_ENV_PATH" KRW_WORKER_BUNDLE_SHA256 "$WORKER_BUNDLE_SHA256"
  append_env_value "$RUNTIME_ENV_PATH" KRW_MAC_IMMUTABLE_RUNTIME 1
  append_env_value "$RUNTIME_ENV_PATH" KRW_MAC_RUNTIME_ROOT "$RUNTIME_ROOT"
  append_env_value "$RUNTIME_ENV_PATH" KRW_ONTOLOGY_SOURCE_DIR "$RUNTIME_ONTOLOGY_SOURCE"
  append_env_value "$RUNTIME_ENV_PATH" KRW_ONTOLOGY_RELEASE_ROOT "$ACTIVE_RELEASE_ROOT"
  # Keep the resolved release root for the immutable runtime identity, but also
  # retain the actual prod/current link for the MCP server. The MCP's prod
  # readiness check deliberately rejects a resolved release directory because
  # it cannot prove that it is following the active production pointer.
  append_env_value "$RUNTIME_ENV_PATH" KRW_ONTOLOGY_CURRENT_RELEASE_ROOT "$CURRENT_RELEASE_LINK"
  append_env_value "$RUNTIME_ENV_PATH" KRW_ONTOLOGY_ROOT "$ACTIVE_RELEASE_ROOT"
  append_env_value "$RUNTIME_ENV_PATH" KRW_ONTOLOGY_MANIFEST_PATH "$ACTIVE_RELEASE_ROOT/manifest.json"
  if [ -n "${KRW_ONTOLOGY_GLOBAL_SPINE_PATH:-}" ]; then
    append_env_value "$RUNTIME_ENV_PATH" KRW_ONTOLOGY_GLOBAL_SPINE_PATH "$(resolve_existing_path "$KRW_ONTOLOGY_GLOBAL_SPINE_PATH")"
  fi
  if [ -n "${KRW_ONTOLOGY_SHARD_MANIFEST_PATH:-}" ]; then
    append_env_value "$RUNTIME_ENV_PATH" KRW_ONTOLOGY_SHARD_MANIFEST_PATH "$(resolve_existing_path "$KRW_ONTOLOGY_SHARD_MANIFEST_PATH")"
  fi
  append_env_value "$RUNTIME_ENV_PATH" KRW_ONTOLOGY_PLUGIN_PATH "$RUNTIME_PLUGIN_PATH"
  append_env_value "$RUNTIME_ENV_PATH" KRW_GURU_ADVISOR_PLUGIN_PATH "$RUNTIME_GURU_PLUGIN_PATH"
  append_env_value "$RUNTIME_ENV_PATH" KRW_GURU_RELEASE_ROOT "$ACTIVE_GURU_RELEASE_ROOT"
  append_env_value "$RUNTIME_ENV_PATH" PYTHONDONTWRITEBYTECODE 1
  if [ "$STOCK_NEWS_RUNTIME_ENABLED" = "1" ]; then
    append_env_value "$RUNTIME_ENV_PATH" STOCK_NEWS_MCP_ROOT "$RUNTIME_STOCK_NEWS_ROOT"
    append_env_value "$RUNTIME_ENV_PATH" STOCK_NEWS_COVERAGE_PATH "$RUNTIME_PLUGIN_PATH/stock-news/coverage_companies.json"
  fi
  NODE_PATH=$(command -v node)
  CLAUDE_PATH=$(command -v "${CLAUDE_CODE_EXECUTABLE:?Missing CLAUDE_CODE_EXECUTABLE}")
  export RUNTIME_IDENTITY_FILE MAC_DEPLOYMENT_ID WORKER_BUNDLE_SHA256 NODE_PATH CLAUDE_PATH
  export ACTIVE_RELEASE_ROOT ACTIVE_GURU_RELEASE_ROOT RUNTIME_PYTHON
  export EXPECTED_FRONT_SOURCE_SHA256 EXPECTED_ONTOLOGY_SOURCE_SHA256
  export EXPECTED_STOCK_NEWS_SOURCE_SHA256
  export FRONT_LOCK_SHA256="$(file_sha256 "$FRONT_DIR/package-lock.json")"
  export ONTOLOGY_LOCK_SHA256="$(file_sha256 "$ONTOLOGY_SOURCE_DIR/uv.lock")"
  export RELEASE_MANIFEST_SHA256="$(file_sha256 "$ACTIVE_RELEASE_ROOT/manifest.json")"
  export GURU_MANIFEST_SHA256="$(file_sha256 "$ACTIVE_GURU_RELEASE_ROOT/manifest.json")"
  export NODE_BINARY_SHA256="$(file_sha256 "$NODE_PATH")"
  export CLAUDE_BINARY_SHA256="$(file_sha256 "$CLAUDE_PATH")"
  export PYTHON_BINARY_SHA256="$(file_sha256 "$RUNTIME_PYTHON")"
  export NODE_VERSION="$(node --version)"
  export PYTHON_VERSION="$("$RUNTIME_PYTHON" --version 2>&1)"
  export CLAUDE_VERSION="$($CLAUDE_PATH --version 2>&1 | head -1)"
  # The launchd entrypoints prepend Homebrew's generic bin directory for
  # operational tools. Record the exact Node executable before sealing so a
  # generic `node` symlink can never replace the runtime-pinned Node at
  # verification or process launch time.
  append_env_value "$RUNTIME_ENV_PATH" KRW_RUNTIME_NODE_EXECUTABLE "$NODE_PATH"
  chmod 400 "$RUNTIME_ENV_PATH"
  node <<'NODE'
const fs = require("fs");
const payload = {
  format: "krw-mac-runtime-identity/v1",
  deploymentId: process.env.MAC_DEPLOYMENT_ID,
  workerBundleSha256: process.env.WORKER_BUNDLE_SHA256,
  frontSourceSha256: process.env.EXPECTED_FRONT_SOURCE_SHA256 || null,
  ontologySourceSha256: process.env.EXPECTED_ONTOLOGY_SOURCE_SHA256 || null,
  stockNewsSourceSha256: process.env.EXPECTED_STOCK_NEWS_SOURCE_SHA256 || null,
  frontLockSha256: process.env.FRONT_LOCK_SHA256,
  ontologyLockSha256: process.env.ONTOLOGY_LOCK_SHA256,
  releaseRoot: process.env.ACTIVE_RELEASE_ROOT,
  releaseManifestSha256: process.env.RELEASE_MANIFEST_SHA256,
  guruReleaseRoot: process.env.ACTIVE_GURU_RELEASE_ROOT,
  guruManifestSha256: process.env.GURU_MANIFEST_SHA256,
  node: { path: process.env.NODE_PATH, version: process.env.NODE_VERSION, sha256: process.env.NODE_BINARY_SHA256 },
  python: { path: process.env.RUNTIME_PYTHON, version: process.env.PYTHON_VERSION, sha256: process.env.PYTHON_BINARY_SHA256 },
  claude: { path: process.env.CLAUDE_PATH, version: process.env.CLAUDE_VERSION, sha256: process.env.CLAUDE_BINARY_SHA256 },
};
fs.writeFileSync(process.env.RUNTIME_IDENTITY_FILE, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o400 });
NODE
  RUNTIME_IDENTITY_SHA256=$(file_sha256 "$RUNTIME_IDENTITY_FILE")
  chmod 600 "$RUNTIME_ENV_PATH"
  append_env_value "$RUNTIME_ENV_PATH" KRW_RUNTIME_IDENTITY_SHA256 "$RUNTIME_IDENTITY_SHA256"
  chmod 400 "$RUNTIME_ENV_PATH"

  echo "Running candidate runtime dependency and isolated MCP health checks..."
  (cd "$RUNTIME_ROOT" && node --input-type=module -e '
    await Promise.all([
      import("@anthropic-ai/claude-agent-sdk"),
      import("@supabase/supabase-js"),
      import("bullmq"),
    ]);
  ')
  for worker_file in "$RUNTIME_WORKER_PATH"/*.mjs; do node --check "$worker_file" >/dev/null; done

  CANDIDATE_PIDS=
  cleanup_candidates() {
    for candidate_pid in $CANDIDATE_PIDS; do
      kill "$candidate_pid" >/dev/null 2>&1 || true
      wait "$candidate_pid" >/dev/null 2>&1 || true
    done
  }
  trap cleanup_candidates EXIT INT TERM
  candidate_port() {
    node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})'
  }
  wait_http() {
    target_url=$1
    target_pid=$2
    for attempt in $(seq 1 40); do
      kill -0 "$target_pid" >/dev/null 2>&1 || return 1
      curl --connect-timeout 1 --max-time 2 -fsS "$target_url" >/dev/null 2>&1 && return 0
      sleep 0.5
    done
    return 1
  }
  CANDIDATE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/krw-mac-candidate.XXXXXX")
  CANDIDATE_MCP_ENV="$CANDIDATE_DIR/mcp.env"
  cp "$RUNTIME_ENV_PATH" "$CANDIDATE_MCP_ENV"; chmod 600 "$CANDIDATE_MCP_ENV"
  CANDIDATE_MCP_PORT=$(candidate_port)
  append_env_value "$CANDIDATE_MCP_ENV" KRW_ONTOLOGY_MCP_PORT "$CANDIDATE_MCP_PORT"
  append_env_value "$CANDIDATE_MCP_ENV" KRW_ONTOLOGY_MCP_URL "http://127.0.0.1:$CANDIDATE_MCP_PORT/mcp"
  append_env_value "$CANDIDATE_MCP_ENV" KRW_ONTOLOGY_MCP_HEALTH_URL "http://127.0.0.1:$CANDIDATE_MCP_PORT/health"
  # verify-mcp-runtime.mjs prefers READY_URL when it is configured. Rewriting
  # only MCP_URL/HEALTH_URL would accidentally inspect the live 8765 service.
  append_env_value "$CANDIDATE_MCP_ENV" KRW_ONTOLOGY_MCP_READY_URL "http://127.0.0.1:$CANDIDATE_MCP_PORT/readyz"
  append_env_value "$CANDIDATE_MCP_ENV" KRW_RUNTIME_CANDIDATE_VALIDATION 1
  "$RUNTIME_ROOT/scripts/start-mcp-server-production.sh" --env-file "$CANDIDATE_MCP_ENV" >"$CANDIDATE_DIR/mcp.log" 2>&1 &
  candidate_pid=$!; CANDIDATE_PIDS="$CANDIDATE_PIDS $candidate_pid"
  wait_http "http://127.0.0.1:$CANDIDATE_MCP_PORT/readyz" "$candidate_pid" || {
    cat "$CANDIDATE_DIR/mcp.log" >&2; exit 1;
  }
  "$RUNTIME_ROOT/scripts/verify-mcp-server-production.sh" --env-file "$CANDIDATE_MCP_ENV" --release-id "$ACTIVE_RELEASE_ID"

  if [ "$STOCK_NEWS_RUNTIME_ENABLED" = "1" ]; then
    CANDIDATE_NEWS_ENV="$CANDIDATE_DIR/news.env"
    cp "$RUNTIME_ENV_PATH" "$CANDIDATE_NEWS_ENV"; chmod 600 "$CANDIDATE_NEWS_ENV"
    CANDIDATE_NEWS_PORT=$(candidate_port)
    append_env_value "$CANDIDATE_NEWS_ENV" STOCK_NEWS_MCP_PORT "$CANDIDATE_NEWS_PORT"
    append_env_value "$CANDIDATE_NEWS_ENV" STOCK_NEWS_MCP_URL "http://127.0.0.1:$CANDIDATE_NEWS_PORT/mcp"
    append_env_value "$CANDIDATE_NEWS_ENV" KRW_RUNTIME_CANDIDATE_VALIDATION 1
    "$RUNTIME_ROOT/scripts/start-stock-news-mcp-production.sh" --env-file "$CANDIDATE_NEWS_ENV" >"$CANDIDATE_DIR/news.log" 2>&1 &
    candidate_pid=$!; CANDIDATE_PIDS="$CANDIDATE_PIDS $candidate_pid"
    wait_http "http://127.0.0.1:$CANDIDATE_NEWS_PORT/health" "$candidate_pid" || {
      cat "$CANDIDATE_DIR/news.log" >&2; exit 1;
    }
    "$RUNTIME_ROOT/scripts/verify-stock-news-mcp-production.sh" --env-file "$CANDIDATE_NEWS_ENV"
  fi

  if [ "$FILINGS_MCP_RUNTIME_ENABLED" = "1" ]; then
    CANDIDATE_FILINGS_ENV="$CANDIDATE_DIR/filings.env"
    cp "$RUNTIME_ENV_PATH" "$CANDIDATE_FILINGS_ENV"; chmod 600 "$CANDIDATE_FILINGS_ENV"
    CANDIDATE_FILINGS_PORT=$(candidate_port)
    append_env_value "$CANDIDATE_FILINGS_ENV" FILINGS_MCP_PORT "$CANDIDATE_FILINGS_PORT"
    append_env_value "$CANDIDATE_FILINGS_ENV" KRW_FILINGS_MCP_URL "http://127.0.0.1:$CANDIDATE_FILINGS_PORT/mcp"
    append_env_value "$CANDIDATE_FILINGS_ENV" KRW_RUNTIME_CANDIDATE_VALIDATION 1
    # The candidate is prepared before a pending schema migration can cross
    # its durable cutover boundary. Keep transport, auth, and tool-contract
    # verification here, then run the data-backed personal smoke only after
    # the migration and production activation have completed.
    if [ "${KRW_FILINGS_MCP_DEFER_PERSONAL_DATA_SMOKE:-0}" = "1" ]; then
      append_env_value "$CANDIDATE_FILINGS_ENV" KRW_FILINGS_MCP_DEFER_PERSONAL_DATA_SMOKE 1
    fi
    "$RUNTIME_ROOT/scripts/start-filings-mcp-production.sh" --env-file "$CANDIDATE_FILINGS_ENV" >"$CANDIDATE_DIR/filings.log" 2>&1 &
    candidate_pid=$!; CANDIDATE_PIDS="$CANDIDATE_PIDS $candidate_pid"
    wait_http "http://127.0.0.1:$CANDIDATE_FILINGS_PORT/health" "$candidate_pid" || {
      cat "$CANDIDATE_DIR/filings.log" >&2; exit 1;
    }
    "$RUNTIME_ROOT/scripts/verify-filings-mcp-production.sh" --env-file "$CANDIDATE_FILINGS_ENV"
  fi
  cleanup_candidates
  CANDIDATE_PIDS=
  rm -rf "$CANDIDATE_DIR"
  trap - EXIT INT TERM
  export RUNTIME_CANDIDATE_PROOF MAC_DEPLOYMENT_ID ACTIVE_RELEASE_ID RUNTIME_IDENTITY_SHA256
  node <<'NODE'
const fs = require("fs");
fs.writeFileSync(process.env.RUNTIME_CANDIDATE_PROOF, `${JSON.stringify({
  format: "krw-mac-candidate-verification/v1",
  deploymentId: process.env.MAC_DEPLOYMENT_ID,
  releaseId: process.env.ACTIVE_RELEASE_ID,
  runtimeIdentitySha256: process.env.RUNTIME_IDENTITY_SHA256,
  verifiedAt: new Date().toISOString(),
  ontologyMcp: true,
  nodeDependencies: true,
}, null, 2)}\n`, { mode: 0o400 });
NODE

  # Prevent accidental mutation between preparation, activation, and launchd
  # restarts. The seal below also records executable modes and every symlink.
  find "$RUNTIME_ROOT" -type d -exec chmod 500 {} +
  find "$RUNTIME_ROOT" -type f -perm -u+x -exec chmod 500 {} +
  find "$RUNTIME_ROOT" -type f ! -perm -u+x -exec chmod 400 {} +
  chmod 700 "$RUNTIME_ROOT"
  seal_runtime prepare
  chmod 400 "$RUNTIME_SEAL"
  echo "Prepared immutable Mac runtime: $RUNTIME_ROOT"
  exit 0
fi

require_path "$RUNTIME_ROOT"
require_path "$RUNTIME_DEPLOYMENT_ID_FILE"
[ "$(sed -n '1p' "$RUNTIME_DEPLOYMENT_ID_FILE")" = "$MAC_DEPLOYMENT_ID" ] || {
  echo "Prepared Mac runtime belongs to another deployment." >&2
  exit 1
}
seal_runtime verify
RUNTIME_WORKER_BUNDLE_SHA256=$(node \
  "$RUNTIME_ROOT/scripts/compute-production-source-sha256.mjs" \
  "$RUNTIME_WORKER_PATH")
ACTIVATION_CONTROL_DEPLOY_MODE=$DEPLOY_MODE
ACTIVATION_CONTROL_DRY_RUN=$DRY_RUN
ACTIVATION_CONTROL_SCRIPT_DIR=$SCRIPT_DIR
ACTIVATION_CONTROL_FRONT_DIR=$FRONT_DIR
ACTIVATION_CONTROL_ENV_PATH=$ENV_PATH
ACTIVATION_CONTROL_PATH=$PATH
ACTIVATION_CONTROL_HOME=$HOME
ACTIVATION_CONTROL_MAC_DEPLOYMENT_ID=$MAC_DEPLOYMENT_ID
ACTIVATION_CONTROL_RUNTIME_ROOT=$RUNTIME_ROOT
ACTIVATION_CONTROL_RUNTIME_ENV_PATH=$RUNTIME_ENV_PATH
ACTIVATION_CONTROL_RUNTIME_WORKER_PATH=$RUNTIME_WORKER_PATH
ACTIVATION_CONTROL_ACTIVE_RELEASE_ROOT=$ACTIVE_RELEASE_ROOT
ACTIVATION_CONTROL_CURRENT_RELEASE_LINK=$CURRENT_RELEASE_LINK
ACTIVATION_CONTROL_ACTIVE_GURU_RELEASE_ROOT=$ACTIVE_GURU_RELEASE_ROOT
ACTIVATION_CONTROL_ACTIVE_RELEASE_ID=$ACTIVE_RELEASE_ID
ACTIVATION_CONTROL_STOCK_NEWS_RUNTIME_ENABLED=$STOCK_NEWS_RUNTIME_ENABLED
ACTIVATION_CONTROL_FILINGS_MCP_RUNTIME_ENABLED=$FILINGS_MCP_RUNTIME_ENABLED
readonly ACTIVATION_CONTROL_DEPLOY_MODE ACTIVATION_CONTROL_DRY_RUN
readonly ACTIVATION_CONTROL_SCRIPT_DIR ACTIVATION_CONTROL_FRONT_DIR ACTIVATION_CONTROL_ENV_PATH
readonly ACTIVATION_CONTROL_PATH ACTIVATION_CONTROL_HOME ACTIVATION_CONTROL_MAC_DEPLOYMENT_ID
readonly ACTIVATION_CONTROL_RUNTIME_ROOT ACTIVATION_CONTROL_RUNTIME_ENV_PATH
readonly ACTIVATION_CONTROL_RUNTIME_WORKER_PATH ACTIVATION_CONTROL_ACTIVE_RELEASE_ROOT
readonly ACTIVATION_CONTROL_CURRENT_RELEASE_LINK
readonly ACTIVATION_CONTROL_ACTIVE_GURU_RELEASE_ROOT ACTIVATION_CONTROL_ACTIVE_RELEASE_ID
readonly ACTIVATION_CONTROL_STOCK_NEWS_RUNTIME_ENABLED ACTIVATION_CONTROL_FILINGS_MCP_RUNTIME_ENABLED
set -a
# shellcheck disable=SC1090
. "$RUNTIME_ENV_PATH"
set +a
DEPLOY_MODE=$ACTIVATION_CONTROL_DEPLOY_MODE
DRY_RUN=$ACTIVATION_CONTROL_DRY_RUN
SCRIPT_DIR=$ACTIVATION_CONTROL_SCRIPT_DIR
FRONT_DIR=$ACTIVATION_CONTROL_FRONT_DIR
ENV_PATH=$ACTIVATION_CONTROL_ENV_PATH
PATH=$ACTIVATION_CONTROL_PATH
HOME=$ACTIVATION_CONTROL_HOME
MAC_DEPLOYMENT_ID=$ACTIVATION_CONTROL_MAC_DEPLOYMENT_ID
RUNTIME_ROOT=$ACTIVATION_CONTROL_RUNTIME_ROOT
RUNTIME_ENV_PATH=$ACTIVATION_CONTROL_RUNTIME_ENV_PATH
RUNTIME_WORKER_PATH=$ACTIVATION_CONTROL_RUNTIME_WORKER_PATH
ACTIVE_RELEASE_ROOT=$ACTIVATION_CONTROL_ACTIVE_RELEASE_ROOT
CURRENT_RELEASE_LINK=$ACTIVATION_CONTROL_CURRENT_RELEASE_LINK
ACTIVE_GURU_RELEASE_ROOT=$ACTIVATION_CONTROL_ACTIVE_GURU_RELEASE_ROOT
ACTIVE_RELEASE_ID=$ACTIVATION_CONTROL_ACTIVE_RELEASE_ID
STOCK_NEWS_RUNTIME_ENABLED=$ACTIVATION_CONTROL_STOCK_NEWS_RUNTIME_ENABLED
FILINGS_MCP_RUNTIME_ENABLED=$ACTIVATION_CONTROL_FILINGS_MCP_RUNTIME_ENABLED
export PATH HOME
[ "${KRW_MAC_IMMUTABLE_RUNTIME:-0}" = "1" ] || { echo "Prepared runtime env is not immutable." >&2; exit 1; }
[ "${KRW_MAC_RUNTIME_ROOT:-}" = "$RUNTIME_ROOT" ] || { echo "Prepared runtime root identity mismatch." >&2; exit 1; }
[ "${KRW_DEPLOYMENT_ID:-}" = "$MAC_DEPLOYMENT_ID" ] || { echo "Prepared runtime deployment identity mismatch." >&2; exit 1; }
[ "${KRW_WORKER_BUNDLE_SHA256:-}" = "$RUNTIME_WORKER_BUNDLE_SHA256" ] || { echo "Prepared runtime worker identity mismatch." >&2; exit 1; }
[ "${KRW_ONTOLOGY_RELEASE_ROOT:-}" = "$ACTIVE_RELEASE_ROOT" ] || { echo "Prepared runtime release root is not the resolved release." >&2; exit 1; }
[ "${KRW_ONTOLOGY_CURRENT_RELEASE_ROOT:-}" = "$CURRENT_RELEASE_LINK" ] || { echo "Prepared runtime current release link mismatch." >&2; exit 1; }
[ "${KRW_GURU_RELEASE_ROOT:-}" = "$ACTIVE_GURU_RELEASE_ROOT" ] || { echo "Prepared Guru release root is not resolved." >&2; exit 1; }
"$RUNTIME_ROOT/scripts/verify-mac-runtime-target.sh" "$RUNTIME_ENV_PATH"

if [ "$DEPLOY_MODE" = "verify-prepared-only" ]; then
  echo "OK immutable Mac runtime is still activation-ready: $RUNTIME_ROOT"
  exit 0
fi

"$RUNTIME_ROOT/scripts/activate-prepared-mac-runtime.sh" \
  --front-root "$FRONT_DIR" \
  --runtime-root "$RUNTIME_ROOT" \
  --deployment-id "$MAC_DEPLOYMENT_ID" \
  --expected-seal-sha256 "$(file_sha256 "$RUNTIME_SEAL")"
