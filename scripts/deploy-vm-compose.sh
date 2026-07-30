#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/deploy-vm-compose.sh [--dry-run] [--build-only|--activate-only] [compose args...]

Build and restart the VM-local Docker Compose deployment using ~/krw-ontology
as the canonical ontology source. The script materializes a temporary Docker
build context so the ignored/symlinked ontology directory is copied explicitly.

Environment:
  KRW_ONTOLOGY_SOURCE_DIR  Defaults to $HOME/krw-ontology
  ENV_FILE                 Defaults to <front repo>/.env
  COMPOSE_PROJECT_NAME     Defaults to krw-ontology-front
  ALLOW_MISSING_TOSS_PAYMENTS
                           Defaults to 1 temporarily. Set to 0 when Toss
                           live keys are configured and paid checkout is ready.
  ALLOW_TOSS_TEST_KEYS     Defaults to 0. Set to 1 only for staging-like
                           deploys that intentionally use Toss test keys.
  TRUSTED_CLIENT_IP_HEADER Must be x-krw-client-ip. Caddy overwrites this
                           ingress-owned header before it reaches Next.js.
EOF
}

DRY_RUN=0
DEPLOY_MODE=build-and-activate
while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --build-only)
      if [ "$DEPLOY_MODE" != "build-and-activate" ]; then
        echo "Choose only one of --build-only or --activate-only." >&2
        exit 1
      fi
      DEPLOY_MODE=build-only
      shift
      ;;
    --activate-only)
      if [ "$DEPLOY_MODE" != "build-and-activate" ]; then
        echo "Choose only one of --build-only or --activate-only." >&2
        exit 1
      fi
      DEPLOY_MODE=activate-only
      shift
      ;;
    *)
      break
      ;;
  esac
done

VALIDATE_BILLING_WORKER=1
VALIDATE_DOCUMENT_WORKER=1
VALIDATE_DOCUMENT_OUTBOX_DISPATCHER=1
VALIDATE_FILINGS_MCP=1
VALIDATE_FILING_NOTIFICATION_WORKER=1
VALIDATE_FILING_BRIEF_WORKER=1
if [ "$#" -gt 0 ]; then
  VALIDATE_BILLING_WORKER=0
  VALIDATE_DOCUMENT_WORKER=0
  VALIDATE_DOCUMENT_OUTBOX_DISPATCHER=0
  VALIDATE_FILINGS_MCP=0
  VALIDATE_FILING_NOTIFICATION_WORKER=0
  VALIDATE_FILING_BRIEF_WORKER=0
  for compose_arg in "$@"; do
    if [ "$compose_arg" = "billing-worker" ]; then
      VALIDATE_BILLING_WORKER=1
    fi
    if [ "$compose_arg" = "document-worker" ]; then
      VALIDATE_DOCUMENT_WORKER=1
    fi
    if [ "$compose_arg" = "document-outbox-dispatcher" ]; then
      VALIDATE_DOCUMENT_OUTBOX_DISPATCHER=1
    fi
    if [ "$compose_arg" = "filings-mcp" ]; then
      VALIDATE_FILINGS_MCP=1
    fi
    if [ "$compose_arg" = "filing-notification-worker" ]; then
      VALIDATE_FILING_NOTIFICATION_WORKER=1
    fi
    if [ "$compose_arg" = "filing-brief-worker" ]; then
      VALIDATE_FILING_BRIEF_WORKER=1
    fi
  done
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
ONTOLOGY_SOURCE_DIR=${KRW_ONTOLOGY_SOURCE_DIR:-"$HOME/krw-ontology"}
ENV_FILE=${ENV_FILE:-"$FRONT_DIR/.env"}
CANONICAL_TARGET_FILE="$FRONT_DIR/ops/production-target.json"
test -f "$CANONICAL_TARGET_FILE" || {
  echo "Missing canonical production target: $CANONICAL_TARGET_FILE" >&2
  exit 1
}
command -v node >/dev/null 2>&1 || { echo "Missing required command: node" >&2; exit 1; }
CANONICAL_COMPOSE_PROJECT=$(node -e '
  const target=require(process.argv[1]);
  if (typeof target.composeProject !== "string" || !target.composeProject) process.exit(1);
  process.stdout.write(target.composeProject);
' "$CANONICAL_TARGET_FILE")
if [ -n "${COMPOSE_PROJECT_NAME:-}" ] && [ "$COMPOSE_PROJECT_NAME" != "$CANONICAL_COMPOSE_PROJECT" ]; then
  echo "COMPOSE_PROJECT_NAME conflicts with ops/production-target.json." >&2
  exit 1
fi
COMPOSE_PROJECT_NAME=$CANONICAL_COMPOSE_PROJECT
# Every deployed frontend build needs a distinct public version so the service
# worker script URL and cache namespace rotate even when deploying a dirty tree
# or rebuilding the same commit. Callers can still provide a release identifier.
NEXT_PUBLIC_APP_VERSION=${NEXT_PUBLIC_APP_VERSION:-$(date -u +%Y%m%d%H%M%S)}
export NEXT_PUBLIC_APP_VERSION
if [ "$DEPLOY_MODE" = "build-and-activate" ]; then
  echo "Combined VM build-and-activate is disabled; use the top-level prepared cutover orchestrator." >&2
  exit 1
fi
EXPECTED_VM_ATTESTATION="$NEXT_PUBLIC_APP_VERSION:$COMPOSE_PROJECT_NAME"
if [ "${VM_DEPLOY_ATTESTATION:-}" != "$EXPECTED_VM_ATTESTATION" ]; then
  echo "Missing or invalid VM deployment attestation." >&2
  exit 1
fi
ALLOW_MISSING_TOSS_PAYMENTS=${ALLOW_MISSING_TOSS_PAYMENTS:-1}
EXPECTED_CLAUDE_CODE_VERSION=${EXPECTED_CLAUDE_CODE_VERSION:-2.1.204}
EXPECTED_NODE_CLAUDE_AGENT_SDK_VERSION=${EXPECTED_NODE_CLAUDE_AGENT_SDK_VERSION:-0.3.204}
EXPECTED_PY_CLAUDE_AGENT_SDK_VERSION=${EXPECTED_PY_CLAUDE_AGENT_SDK_VERSION:-0.2.85}

require_path() {
  if [ ! -e "$1" ]; then
    echo "Missing required path: $1" >&2
    exit 1
  fi
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

# Prepared activation is intentionally a minimal, sealed cutover path. All
# source, ontology, environment, build, SDK, and artifact checks ran during
# --build-only. Repeating them after the schema/runtime pause would lengthen the
# outage and reintroduce mutable preflight dependencies.
if [ "$DEPLOY_MODE" = "activate-only" ]; then
  require_command docker
  require_path "$ENV_FILE"
  require_path "$FRONT_DIR/docker-compose.yml"
  EXPECTED_PREPARED_IMAGE_ID=${EXPECTED_PREPARED_IMAGE_ID:-}
  EXPECTED_PREPARED_CADDY_IMAGE_ID=${EXPECTED_PREPARED_CADDY_IMAGE_ID:-}
  case "$EXPECTED_PREPARED_IMAGE_ID" in
    sha256:*) ;;
    *)
      if [ "$DRY_RUN" != "1" ]; then
        echo "EXPECTED_PREPARED_IMAGE_ID is required for prepared activation." >&2
        exit 1
      fi
      ;;
  esac

  echo "Front source: $FRONT_DIR"
  echo "Frontend app version: $NEXT_PUBLIC_APP_VERSION"
  echo "Compose deploy mode: activate-only"
  if [ "$DRY_RUN" = "1" ]; then
    echo "Dry run complete. Prepared Docker Compose services were not activated."
    exit 0
  fi

  export FRONT_DIR
  docker compose \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$FRONT_DIR/docker-compose.yml" \
    up -d --no-build --no-deps --force-recreate --remove-orphans "$@"

  for service in "$@"; do
    container_id=$(
      docker compose \
        --project-name "$COMPOSE_PROJECT_NAME" \
        --env-file "$ENV_FILE" \
        -f "$FRONT_DIR/docker-compose.yml" \
        ps -q "$service"
    )
    if [ -z "$container_id" ]; then
      echo "Prepared service did not create a container: $service" >&2
      exit 1
    fi
    case "$service" in
      reverse-proxy)
        actual_image_id=$(docker inspect --format '{{.Image}}' "$container_id")
        if [ -z "$EXPECTED_PREPARED_CADDY_IMAGE_ID" ] \
          || [ "$actual_image_id" != "$EXPECTED_PREPARED_CADDY_IMAGE_ID" ]; then
          echo "Prepared reverse-proxy image mismatch." >&2
          exit 1
        fi
        ;;
      redis) ;;
      *)
        actual_image_id=$(docker inspect --format '{{.Image}}' "$container_id")
        if [ "$actual_image_id" != "$EXPECTED_PREPARED_IMAGE_ID" ]; then
          echo "Prepared service image mismatch: $service" >&2
          echo "  expected: $EXPECTED_PREPARED_IMAGE_ID" >&2
          echo "  actual:   $actual_image_id" >&2
          exit 1
        fi
        ;;
    esac

    for attempt in $(seq 1 20); do
      state=$(docker inspect --format '{{.State.Status}}' "$container_id")
      health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id")
      if [ "$state" = "running" ] && [ "$health" = "healthy" ]; then
        break
      fi
      if [ "$attempt" -eq 20 ]; then
        echo "Prepared service did not become healthy: $service (state=$state health=$health)" >&2
        exit 1
      fi
      sleep 2
    done
    echo "OK prepared service: $service image=$(docker inspect --format '{{.Image}}' "$container_id")"
  done
  exit 0
fi

require_command rsync
require_command docker
require_command node
require_command uv
require_path "$ENV_FILE"
require_path "$ONTOLOGY_SOURCE_DIR/pyproject.toml"
require_path "$ONTOLOGY_SOURCE_DIR/src/krw_ontology"
require_path "$ONTOLOGY_SOURCE_DIR/ontology"
require_path "$ONTOLOGY_SOURCE_DIR/plugins/krw-ontology"

env_value() {
  key="$1"
  awk -F= -v key="$key" '
    $0 !~ /^[[:space:]]*#/ && $1 == key {
      sub(/^[^=]*=/, "")
      gsub(/^[[:space:]]+|[[:space:]]+$/, "")
      gsub(/^"|"$/, "")
      gsub(/^'\''|'\''$/, "")
      print
    }
  ' "$ENV_FILE" | tail -n 1
}

require_env_value() {
  key="$1"
  value=$(env_value "$key")
  if [ -z "$value" ]; then
    echo "Missing required environment value in $ENV_FILE: $key" >&2
    exit 1
  fi
}

require_env_exact() {
  key="$1"
  expected="$2"
  value=$(env_value "$key")
  if [ "$value" != "$expected" ]; then
    echo "Invalid environment value in $ENV_FILE: $key must be $expected, got ${value:-unset}" >&2
    exit 1
  fi
}

require_toss_payments_key() {
  key="$1"
  live_prefix="$2"
  test_prefix="$3"
  value=$(env_value "$key")

  if [ -z "$value" ]; then
    echo "Missing required Toss Payments environment value in $ENV_FILE: $key" >&2
    exit 1
  fi
  case "$value" in
    *"..."*)
      echo "Placeholder Toss Payments environment value in $ENV_FILE: $key" >&2
      exit 1
      ;;
  esac
  case "$value" in
    "$live_prefix"*)
      ;;
    "$test_prefix"*)
      if [ "${ALLOW_TOSS_TEST_KEYS:-0}" = "1" ]; then
        echo "Warning: $key uses a Toss test key because ALLOW_TOSS_TEST_KEYS=1." >&2
      else
        echo "$key must use a Toss live key for production deploys." >&2
        echo "Set ALLOW_TOSS_TEST_KEYS=1 only for staging-like deploys." >&2
        exit 1
      fi
      ;;
    *)
      echo "$key has an unexpected Toss Payments key prefix." >&2
      exit 1
      ;;
  esac
}

for key in \
  ANTHROPIC_API_KEY \
  NEXT_PUBLIC_SUPABASE_URL \
  NEXT_PUBLIC_SUPABASE_ANON_KEY \
  NEXT_PUBLIC_SITE_URL \
  NEXT_PUBLIC_APP_URL \
  AUTH_REDIRECT_ORIGIN \
  SUPABASE_URL \
  SUPABASE_ANON_KEY \
  SUPABASE_SERVICE_ROLE_KEY \
  KRW_LLM_JOB_TOKEN_SECRET \
  DESKTOP_LLM_GATEWAY_BASE_URL \
  DEEPSEEK_API_KEY \
  INTERNAL_API_KEY
do
  require_env_value "$key"
done

require_env_exact ANALYSIS_CREDIT_ENFORCEMENT_MODE enforced
require_env_exact TRUSTED_CLIENT_IP_HEADER x-krw-client-ip

FILING_BRIEF_ENABLED_VALUE=$(env_value FILING_BRIEF_ENABLED)
if [ -n "$FILING_BRIEF_ENABLED_VALUE" ] && [ "$FILING_BRIEF_ENABLED_VALUE" != "0" ] && [ "$FILING_BRIEF_ENABLED_VALUE" != "1" ]; then
  echo "Invalid environment value in $ENV_FILE: FILING_BRIEF_ENABLED must be 0 or 1" >&2
  exit 1
fi
if [ "$FILING_BRIEF_ENABLED_VALUE" = "1" ]; then
  require_env_value FILING_BRIEF_GATEWAY_TOKEN
  require_env_value SEC_USER_AGENT
fi

if [ "${ALLOW_MISSING_TOSS_PAYMENTS:-0}" = "1" ]; then
  echo "Warning: skipping Toss Payments key validation because ALLOW_MISSING_TOSS_PAYMENTS=1." >&2
  echo "Paid checkout will not be launch-ready until live Toss keys are configured." >&2
  export BILLING_WORKER_REQUIRE_TOSS_PAYMENTS=0
else
  require_toss_payments_key TOSS_PAYMENTS_CLIENT_KEY live_ck_ test_ck_
  require_toss_payments_key TOSS_PAYMENTS_SECRET_KEY live_sk_ test_sk_
fi
if [ "${ALLOW_TOSS_TEST_KEYS:-0}" = "1" ]; then
  export BILLING_WORKER_ALLOW_TOSS_TEST_KEYS=1
fi

EXPECTED_ONTOLOGY_SOURCE_SHA256=${EXPECTED_ONTOLOGY_SOURCE_SHA256:-}
printf '%s' "$EXPECTED_ONTOLOGY_SOURCE_SHA256" | grep -Eq '^[a-f0-9]{64}$' || {
  echo "EXPECTED_ONTOLOGY_SOURCE_SHA256 must be the orchestrator-pinned ontology digest." >&2
  exit 1
}
BUILD_CONTEXT=$(mktemp -d "${TMPDIR:-/tmp}/krw-ontology-front-build.XXXXXX")
ONTOLOGY_BUILD_SOURCE=$(mktemp -d "${TMPDIR:-/tmp}/krw-ontology-source-build.XXXXXX")
cleanup() {
  rm -rf "$BUILD_CONTEXT" "$ONTOLOGY_BUILD_SOURCE"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

rsync -a --delete \
  --exclude '/.git/' --exclude '/.venv*/' --exclude '/__pycache__/' \
  --exclude '/.pytest_cache/' --exclude '/.ruff_cache/' \
  --exclude '/.env' --exclude '/.env.*' \
  "$ONTOLOGY_SOURCE_DIR/" "$ONTOLOGY_BUILD_SOURCE/"
COPIED_ONTOLOGY_SOURCE_SHA256=$(node \
  "$SCRIPT_DIR/compute-production-source-sha256.mjs" \
  "$ONTOLOGY_BUILD_SOURCE")
[ "$COPIED_ONTOLOGY_SOURCE_SHA256" = "$EXPECTED_ONTOLOGY_SOURCE_SHA256" ] || {
  echo "Docker ontology snapshot does not match the gated source identity." >&2
  exit 1
}
SKILL_COUNT=$(
  find "$ONTOLOGY_BUILD_SOURCE/plugins/krw-ontology/skills" \
    -mindepth 2 -maxdepth 2 -name SKILL.md 2>/dev/null | wc -l | tr -d ' '
)
if [ "$SKILL_COUNT" -lt 1 ]; then
  echo "No plugin skill files found in the sealed ontology build snapshot." >&2
  exit 1
fi

rsync -a --delete \
  --exclude '/.git/' \
  --exclude '/.next/' \
  --exclude '/node_modules/' \
  --exclude '/out/' \
  --exclude '/output/' \
  --exclude '/.claude/' \
  --exclude '/.codex/' \
  --exclude '/.deploy/' \
  --exclude '/.playwright-mcp/' \
  --exclude '/_workspace/' \
  --exclude '/krw-ontology' \
  --exclude '/krw-ontology/' \
  --exclude '/.env' \
  --exclude '/.env.*' \
  --exclude '/supabase/.temp/' \
  --exclude '/.supabase-prod-db-password' \
  --exclude '/*.png' \
  --exclude '/*.tsbuildinfo' \
  "$FRONT_DIR/" "$BUILD_CONTEXT/"

rm -rf "$BUILD_CONTEXT/krw-ontology"
mkdir -p "$BUILD_CONTEXT/krw-ontology/plugins"
rsync -a "$ONTOLOGY_BUILD_SOURCE/pyproject.toml" "$BUILD_CONTEXT/krw-ontology/pyproject.toml"
rsync -a \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  "$ONTOLOGY_BUILD_SOURCE/src" "$BUILD_CONTEXT/krw-ontology/"
rsync -a \
  --exclude '.DS_Store' \
  "$ONTOLOGY_BUILD_SOURCE/ontology" "$BUILD_CONTEXT/krw-ontology/"
rsync -a \
  --exclude '.DS_Store' \
  "$ONTOLOGY_BUILD_SOURCE/plugins/krw-ontology" "$BUILD_CONTEXT/krw-ontology/plugins/"

echo "Front source: $FRONT_DIR"
echo "Ontology source: $ONTOLOGY_SOURCE_DIR"
echo "Build context: $BUILD_CONTEXT"
echo "Frontend app version: $NEXT_PUBLIC_APP_VERSION"
echo "Compose deploy mode: $DEPLOY_MODE"
echo "Skill files: $SKILL_COUNT"
echo "Ontology files included:"
find "$BUILD_CONTEXT/krw-ontology" -maxdepth 6 -type f | sed "s#^$BUILD_CONTEXT/##" | sort | sed -n '1,100p'

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run complete. Docker Compose mode '$DEPLOY_MODE' was not executed."
  exit 0
fi

export FRONT_DIR
if [ "$DEPLOY_MODE" = "build-only" ]; then
  # Every Node service in this compose stack uses this one immutable image.
  # Build it before a destructive schema migration, then verify the exact
  # runtime artifacts without starting or replacing any production container.
  docker compose \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$BUILD_CONTEXT/docker-compose.yml" \
    build web

  docker run --rm --entrypoint node krw-ontology-front-web:local -e '
    const { execFileSync } = require("child_process");
    const fs = require("fs");
    for (const path of [
      "server.js",
      ".worker/document-worker.mjs",
      ".worker/document-outbox-dispatcher.mjs",
      ".worker/filing-notification-worker.mjs",
      ".worker/filing-brief-worker.mjs",
      ".worker/filings-mcp-server.mjs",
      ".worker/billing-worker.mjs",
      ".services/llm-gateway.mjs",
      "public/sw.js",
      "public/offline.html"
    ]) {
      fs.accessSync(path, fs.constants.R_OK);
      if (path.endsWith(".mjs") || path === "server.js") {
        execFileSync(process.execPath, ["--check", path], { stdio: "inherit" });
      }
    }
    console.log("OK prebuilt web/worker image artifacts");
  '
  docker run --rm --entrypoint sh krw-ontology-front-web:local -lc '
    set -eu
    claude_version=$(/usr/local/bin/claude-prod --version 2>&1)
    node_sdk_version=$(node -e '\''
      const fs = require("fs");
      const sdkPath = require.resolve("@anthropic-ai/claude-agent-sdk");
      const marker = "/node_modules/@anthropic-ai/claude-agent-sdk/";
      const index = sdkPath.indexOf(marker);
      if (index < 0) throw new Error(`unexpected sdk path: ${sdkPath}`);
      const packagePath = sdkPath.slice(0, index + marker.length) + "package.json";
      process.stdout.write(JSON.parse(fs.readFileSync(packagePath, "utf8")).version);
    '\'')
    py_sdk_version=$(/opt/krw-ontology-venv/bin/python -c '\''import importlib.metadata as m; print(m.version("claude-agent-sdk"))'\'')
    case "$claude_version" in
      *"'"$EXPECTED_CLAUDE_CODE_VERSION"'"*) ;;
      *) echo "Claude Code version mismatch in prepared image: $claude_version" >&2; exit 1 ;;
    esac
    test "$node_sdk_version" = "'"$EXPECTED_NODE_CLAUDE_AGENT_SDK_VERSION"'"
    test "$py_sdk_version" = "'"$EXPECTED_PY_CLAUDE_AGENT_SDK_VERSION"'"
    echo "OK prepared image runtime versions"
  '
  docker image inspect --format '{{.Id}}' krw-ontology-front-web:local
  echo "Docker image preparation complete; no production container was restarted."
  exit 0
fi

if [ "$DEPLOY_MODE" = "activate-only" ]; then
  docker compose \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$BUILD_CONTEXT/docker-compose.yml" \
    up -d --no-build --no-deps --force-recreate --remove-orphans "$@"
else
  docker compose \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$BUILD_CONTEXT/docker-compose.yml" \
    up -d --build --remove-orphans "$@"
fi

docker compose \
  --project-name "$COMPOSE_PROJECT_NAME" \
  --env-file "$ENV_FILE" \
  -f "$BUILD_CONTEXT/docker-compose.yml" \
  exec -T web /usr/local/bin/claude-prod --version

docker compose \
  --project-name "$COMPOSE_PROJECT_NAME" \
  --env-file "$ENV_FILE" \
  -f "$BUILD_CONTEXT/docker-compose.yml" \
  exec -T web sh -lc '
    set -eu
    claude_version=$(/usr/local/bin/claude-prod --version 2>&1)
    node_sdk_version=$(
      node <<NODE
const fs = require("fs");
const path = require.resolve("@anthropic-ai/claude-agent-sdk");
const marker = "/node_modules/@anthropic-ai/claude-agent-sdk/";
const index = path.indexOf(marker);
if (index < 0) throw new Error("unexpected sdk path: " + path);
const packagePath = path.slice(0, index + marker.length) + "package.json";
process.stdout.write(JSON.parse(fs.readFileSync(packagePath, "utf8")).version);
NODE
    )
    py_sdk_version=$(/opt/krw-ontology-venv/bin/python -c "import importlib.metadata as m; print(m.version(\"claude-agent-sdk\"))")

    case "$claude_version" in
      *"'"$EXPECTED_CLAUDE_CODE_VERSION"'"*) ;;
      *) echo "Claude Code version mismatch: expected '"$EXPECTED_CLAUDE_CODE_VERSION"', got $claude_version" >&2; exit 1 ;;
    esac
    test "$node_sdk_version" = "'"$EXPECTED_NODE_CLAUDE_AGENT_SDK_VERSION"'" || {
      echo "Node Claude Agent SDK mismatch: expected '"$EXPECTED_NODE_CLAUDE_AGENT_SDK_VERSION"', got $node_sdk_version" >&2
      exit 1
    }
    test "$py_sdk_version" = "'"$EXPECTED_PY_CLAUDE_AGENT_SDK_VERSION"'" || {
      echo "Python Claude Agent SDK mismatch: expected '"$EXPECTED_PY_CLAUDE_AGENT_SDK_VERSION"', got $py_sdk_version" >&2
      exit 1
    }

    echo "OK Claude Code: $claude_version"
    echo "OK Node Claude Agent SDK: $node_sdk_version"
    echo "OK Python Claude Agent SDK: $py_sdk_version"
  '

docker compose \
  --project-name "$COMPOSE_PROJECT_NAME" \
  --env-file "$ENV_FILE" \
  -f "$BUILD_CONTEXT/docker-compose.yml" \
  exec -T web python3 - <<'PY'
import os
from pathlib import Path

agent_cwd = Path(os.environ["CLAUDE_AGENT_CWD"])

if not agent_cwd.is_absolute():
    raise SystemExit(f"CLAUDE_AGENT_CWD must be absolute: {agent_cwd}")
if not agent_cwd.exists() or not os.access(agent_cwd, os.W_OK | os.X_OK):
    raise SystemExit(f"CLAUDE_AGENT_CWD is not writable: {agent_cwd}")
for key in (
    "KRW_ONTOLOGY_PLUGIN_PATH",
    "KRW_ONTOLOGY_MCP_URL",
    "KRW_ONTOLOGY_MCP_HEALTH_URL",
    "KRW_ONTOLOGY_MCP_READY_URL",
    "KRW_ONTOLOGY_RELEASE_ROOT",
    "KRW_ONTOLOGY_ROOT",
    "KRW_ONTOLOGY_GLOBAL_SPINE_PATH",
    "KRW_ONTOLOGY_SHARD_MANIFEST_PATH",
):
    if os.environ.get(key):
        raise SystemExit(f"GCP web must not be configured with local ontology/MCP state: {key}")

print(f"OK Claude agent cwd: {agent_cwd}")
print("OK web ontology data boundary: Supabase catalog only")
PY

if [ "$VALIDATE_DOCUMENT_WORKER" = "1" ]; then
  for i in $(seq 1 30); do
    document_container=$(
      docker compose \
        --project-name "$COMPOSE_PROJECT_NAME" \
        --env-file "$ENV_FILE" \
        -f "$BUILD_CONTEXT/docker-compose.yml" \
        ps -q document-worker
    )
    if [ -n "$document_container" ] && [ "$(docker inspect --format '{{.State.Status}}' "$document_container")" = "running" ]; then
      health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$document_container")
      if [ "$health" = "healthy" ] || [ "$health" = "none" ]; then
        break
      fi
    fi
    if [ "$i" -eq 30 ]; then
      echo "document-worker did not become healthy" >&2
      docker compose \
        --project-name "$COMPOSE_PROJECT_NAME" \
        --env-file "$ENV_FILE" \
        -f "$BUILD_CONTEXT/docker-compose.yml" \
        ps >&2
      exit 1
    fi
    sleep 2
  done

  docker compose \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$BUILD_CONTEXT/docker-compose.yml" \
    exec -T document-worker node - <<'NODE'
const fs = require("fs");
fs.accessSync(".worker/document-worker.mjs", fs.constants.R_OK);
const backend = process.env.DOCUMENT_INGESTION_BACKEND || "legacy_db";
const redisUrl = process.env.REDIS_QUEUE_URL || process.env.DOCUMENT_QUEUE_REDIS_URL;
if (backend !== "bullmq") {
  throw new Error(`document-worker must run BullMQ backend in production, got ${backend}`);
}
if (!redisUrl) {
  throw new Error("document-worker missing Redis queue URL");
}
console.log(JSON.stringify({
  worker: "document-worker",
  backend,
  queueRedisConfigured: true,
}));
NODE
else
  echo "Skipping document-worker validation; compose target excludes document-worker."
fi

if [ "$VALIDATE_DOCUMENT_OUTBOX_DISPATCHER" = "1" ]; then
  for i in $(seq 1 30); do
    document_outbox_container=$(
      docker compose \
        --project-name "$COMPOSE_PROJECT_NAME" \
        --env-file "$ENV_FILE" \
        -f "$BUILD_CONTEXT/docker-compose.yml" \
        ps -q document-outbox-dispatcher
    )
    if [ -n "$document_outbox_container" ] && [ "$(docker inspect --format '{{.State.Status}}' "$document_outbox_container")" = "running" ]; then
      health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$document_outbox_container")
      if [ "$health" = "healthy" ] || [ "$health" = "none" ]; then
        break
      fi
    fi
    if [ "$i" -eq 30 ]; then
      echo "document-outbox-dispatcher did not become healthy" >&2
      docker compose \
        --project-name "$COMPOSE_PROJECT_NAME" \
        --env-file "$ENV_FILE" \
        -f "$BUILD_CONTEXT/docker-compose.yml" \
        ps >&2
      exit 1
    fi
    sleep 2
  done

  docker compose \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$BUILD_CONTEXT/docker-compose.yml" \
    exec -T document-outbox-dispatcher node - <<'NODE'
const fs = require("fs");
fs.accessSync(".worker/document-outbox-dispatcher.mjs", fs.constants.R_OK);
const redisUrl = process.env.REDIS_QUEUE_URL || process.env.DOCUMENT_QUEUE_REDIS_URL;
if (!redisUrl) {
  throw new Error("document-outbox-dispatcher missing Redis queue URL");
}
console.log(JSON.stringify({
  worker: "document-outbox-dispatcher",
  queueRedisConfigured: true,
}));
NODE
else
  echo "Skipping document-outbox-dispatcher validation; compose target excludes document-outbox-dispatcher."
fi

if [ "$VALIDATE_FILINGS_MCP" = "1" ]; then
  for i in $(seq 1 30); do
    filings_mcp_container=$(
      docker compose \
        --project-name "$COMPOSE_PROJECT_NAME" \
        --env-file "$ENV_FILE" \
        -f "$BUILD_CONTEXT/docker-compose.yml" \
        ps -q filings-mcp
    )
    if [ -n "$filings_mcp_container" ] && [ "$(docker inspect --format '{{.State.Status}}' "$filings_mcp_container")" = "running" ]; then
      health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$filings_mcp_container")
      if [ "$health" = "healthy" ] || [ "$health" = "none" ]; then
        break
      fi
    fi
    if [ "$i" -eq 30 ]; then
      echo "filings-mcp did not become healthy" >&2
      docker compose \
        --project-name "$COMPOSE_PROJECT_NAME" \
        --env-file "$ENV_FILE" \
        -f "$BUILD_CONTEXT/docker-compose.yml" \
        ps >&2
      exit 1
    fi
    sleep 2
  done

  docker compose \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$BUILD_CONTEXT/docker-compose.yml" \
    exec -T filings-mcp node - <<'NODE'
const fs = require("fs");
fs.accessSync(".worker/filings-mcp-server.mjs", fs.constants.R_OK);
const enabled = ["1", "true", "yes", "on"].includes(
  (process.env.FILINGS_MCP_ENABLED || "").trim().toLowerCase(),
);
async function verify() {
  if (enabled) {
    for (const key of ["FILINGS_MCP_AUTH_TOKEN", "FILINGS_MCP_PERSONAL_SIGNING_SECRET", "SEC_USER_AGENT"]) {
      if (!process.env[key]) throw new Error(`filings-mcp missing ${key} while enabled`);
    }
    if (process.env.FILINGS_MCP_PERSONAL_SIGNING_SECRET === process.env.FILINGS_MCP_AUTH_TOKEN) {
      throw new Error("filings MCP personal signing secret must be distinct from the service token");
    }
    const response = await fetch("http://127.0.0.1:8785/readyz");
    const payload = await response.json();
    if (!response.ok || payload?.ok !== true) throw new Error("filings-mcp readiness is not ok");
  }
  console.log(JSON.stringify({ worker: "filings-mcp", enabled }));
}
verify().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
NODE
else
  echo "Skipping filings-mcp validation; compose target excludes filings-mcp."
fi

if [ "$VALIDATE_FILING_NOTIFICATION_WORKER" = "1" ]; then
  for i in $(seq 1 30); do
    filing_container=$(
      docker compose \
        --project-name "$COMPOSE_PROJECT_NAME" \
        --env-file "$ENV_FILE" \
        -f "$BUILD_CONTEXT/docker-compose.yml" \
        ps -q filing-notification-worker
    )
    if [ -n "$filing_container" ] && [ "$(docker inspect --format '{{.State.Status}}' "$filing_container")" = "running" ]; then
      health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$filing_container")
      if [ "$health" = "healthy" ] || [ "$health" = "none" ]; then
        break
      fi
    fi
    if [ "$i" -eq 30 ]; then
      echo "filing-notification-worker did not become healthy" >&2
      docker compose \
        --project-name "$COMPOSE_PROJECT_NAME" \
        --env-file "$ENV_FILE" \
        -f "$BUILD_CONTEXT/docker-compose.yml" \
        ps >&2
      exit 1
    fi
    sleep 2
  done

  docker compose \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$BUILD_CONTEXT/docker-compose.yml" \
    exec -T filing-notification-worker node - <<'NODE'
const fs = require("fs");
fs.accessSync(".worker/filing-notification-worker.mjs", fs.constants.R_OK);
const detection = process.env.FILING_DETECTION_ENABLED !== "0";
if (detection && !process.env.SEC_USER_AGENT) {
  throw new Error("filing-notification-worker missing SEC_USER_AGENT while detection is enabled");
}
console.log(JSON.stringify({
  worker: "filing-notification-worker",
  detectionEnabled: detection,
  deploymentId: process.env.FILING_WORKER_DEPLOYMENT_ID || "unset",
}));
NODE
else
  echo "Skipping filing-notification-worker validation; compose target excludes filing-notification-worker."
fi

if [ "$VALIDATE_FILING_BRIEF_WORKER" = "1" ]; then
  for i in $(seq 1 30); do
    filing_brief_container=$(
      docker compose \
        --project-name "$COMPOSE_PROJECT_NAME" \
        --env-file "$ENV_FILE" \
        -f "$BUILD_CONTEXT/docker-compose.yml" \
        ps -q filing-brief-worker
    )
    if [ -n "$filing_brief_container" ] && [ "$(docker inspect --format '{{.State.Status}}' "$filing_brief_container")" = "running" ]; then
      health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$filing_brief_container")
      if [ "$health" = "healthy" ] || [ "$health" = "none" ]; then
        break
      fi
    fi
    if [ "$i" -eq 30 ]; then
      echo "filing-brief-worker did not become healthy" >&2
      docker compose \
        --project-name "$COMPOSE_PROJECT_NAME" \
        --env-file "$ENV_FILE" \
        -f "$BUILD_CONTEXT/docker-compose.yml" \
        ps >&2
      exit 1
    fi
    sleep 2
  done

  docker compose \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$BUILD_CONTEXT/docker-compose.yml" \
    exec -T filing-brief-worker node - <<'NODE'
const fs = require("fs");
fs.accessSync(".worker/filing-brief-worker.mjs", fs.constants.R_OK);
const enabled = process.env.FILING_BRIEF_ENABLED === "1";
if (enabled) {
  for (const key of ["FILING_BRIEF_GATEWAY_TOKEN", "SEC_USER_AGENT"]) {
    if (!process.env[key]) throw new Error(`filing-brief-worker missing ${key} while enabled`);
  }
}
console.log(JSON.stringify({
  worker: "filing-brief-worker",
  enabled,
  model: process.env.FILING_BRIEF_MODEL || "deepseek-v4-flash",
}));
NODE
else
  echo "Skipping filing-brief-worker validation; compose target excludes filing-brief-worker."
fi

if [ "$VALIDATE_BILLING_WORKER" = "1" ]; then
  for i in $(seq 1 30); do
    billing_container=$(
      docker compose \
        --project-name "$COMPOSE_PROJECT_NAME" \
        --env-file "$ENV_FILE" \
        -f "$BUILD_CONTEXT/docker-compose.yml" \
        ps -q billing-worker
    )
    if [ -n "$billing_container" ] && [ "$(docker inspect --format '{{.State.Status}}' "$billing_container")" = "running" ]; then
      break
    fi
    if [ "$i" -eq 30 ]; then
      echo "billing-worker did not become ready" >&2
      docker compose \
        --project-name "$COMPOSE_PROJECT_NAME" \
        --env-file "$ENV_FILE" \
        -f "$BUILD_CONTEXT/docker-compose.yml" \
        ps >&2
      exit 1
    fi
    sleep 2
  done
else
  echo "Skipping billing-worker validation; compose target excludes billing-worker."
fi
