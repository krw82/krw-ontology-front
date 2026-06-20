#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/deploy-vm-compose.sh [--dry-run] [compose args...]

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
EOF
}

DRY_RUN=0
if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  usage
  exit 0
fi
if [ "${1:-}" = "--dry-run" ]; then
  DRY_RUN=1
  shift
fi

VALIDATE_AGENT_WORKER=1
VALIDATE_BILLING_WORKER=1
if [ "$#" -gt 0 ]; then
  VALIDATE_AGENT_WORKER=0
  VALIDATE_BILLING_WORKER=0
  for compose_arg in "$@"; do
    if [ "$compose_arg" = "agent-worker" ]; then
      VALIDATE_AGENT_WORKER=1
    fi
    if [ "$compose_arg" = "billing-worker" ]; then
      VALIDATE_BILLING_WORKER=1
    fi
  done
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
ONTOLOGY_SOURCE_DIR=${KRW_ONTOLOGY_SOURCE_DIR:-"$HOME/krw-ontology"}
ENV_FILE=${ENV_FILE:-"$FRONT_DIR/.env"}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-krw-ontology-front}
ALLOW_MISSING_TOSS_PAYMENTS=${ALLOW_MISSING_TOSS_PAYMENTS:-1}
EXPECTED_CLAUDE_CODE_VERSION=${EXPECTED_CLAUDE_CODE_VERSION:-2.1.141}
EXPECTED_NODE_CLAUDE_AGENT_SDK_VERSION=${EXPECTED_NODE_CLAUDE_AGENT_SDK_VERSION:-0.2.141}
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

require_command rsync
require_command docker
require_path "$ENV_FILE"
require_path "$ONTOLOGY_SOURCE_DIR/pyproject.toml"
require_path "$ONTOLOGY_SOURCE_DIR/src/krw_ontology"
require_path "$ONTOLOGY_SOURCE_DIR/ontology"
require_path "$ONTOLOGY_SOURCE_DIR/plugins/krw-ontology"

SKILL_COUNT=$(
  find "$ONTOLOGY_SOURCE_DIR/plugins/krw-ontology/skills" \
    -mindepth 2 -maxdepth 2 -name SKILL.md 2>/dev/null | wc -l | tr -d ' '
)
if [ "$SKILL_COUNT" -lt 1 ]; then
  echo "No plugin skill files found under $ONTOLOGY_SOURCE_DIR/plugins/krw-ontology/skills" >&2
  exit 1
fi

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

BUILD_CONTEXT=$(mktemp -d "${TMPDIR:-/tmp}/krw-ontology-front-build.XXXXXX")
cleanup() {
  rm -rf "$BUILD_CONTEXT"
}
trap cleanup EXIT INT TERM

rsync -a --delete \
  --exclude '/.git/' \
  --exclude '/.next/' \
  --exclude '/node_modules/' \
  --exclude '/out/' \
  --exclude '/output/' \
  --exclude '/.claude/' \
  --exclude '/.codex/' \
  --exclude '/.playwright-mcp/' \
  --exclude '/_workspace/' \
  --exclude '/krw-ontology' \
  --exclude '/krw-ontology/' \
  --exclude '/.env' \
  --exclude '/.env.*' \
  --exclude '/.supabase-prod-db-password' \
  --exclude '/*.png' \
  --exclude '/*.tsbuildinfo' \
  "$FRONT_DIR/" "$BUILD_CONTEXT/"

rm -rf "$BUILD_CONTEXT/krw-ontology"
mkdir -p "$BUILD_CONTEXT/krw-ontology/plugins"
rsync -a "$ONTOLOGY_SOURCE_DIR/pyproject.toml" "$BUILD_CONTEXT/krw-ontology/pyproject.toml"
rsync -a \
  --exclude '__pycache__/' \
  --exclude '*.pyc' \
  "$ONTOLOGY_SOURCE_DIR/src" "$BUILD_CONTEXT/krw-ontology/"
rsync -a \
  --exclude '.DS_Store' \
  "$ONTOLOGY_SOURCE_DIR/ontology" "$BUILD_CONTEXT/krw-ontology/"
rsync -a \
  --exclude '.DS_Store' \
  "$ONTOLOGY_SOURCE_DIR/plugins/krw-ontology" "$BUILD_CONTEXT/krw-ontology/plugins/"

echo "Front source: $FRONT_DIR"
echo "Ontology source: $ONTOLOGY_SOURCE_DIR"
echo "Build context: $BUILD_CONTEXT"
echo "Skill files: $SKILL_COUNT"
echo "Ontology files included:"
find "$BUILD_CONTEXT/krw-ontology" -maxdepth 6 -type f | sed "s#^$BUILD_CONTEXT/##" | sort | sed -n '1,100p'

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run complete. Docker Compose was not executed."
  exit 0
fi

export FRONT_DIR
export KRW_ONTOLOGY_SOURCE_DIR="$ONTOLOGY_SOURCE_DIR"
docker compose \
  --project-name "$COMPOSE_PROJECT_NAME" \
  --env-file "$ENV_FILE" \
  -f "$BUILD_CONTEXT/docker-compose.yml" \
  up -d --build --remove-orphans "$@"

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
import json
import os
from pathlib import Path

plugin_path = Path(os.environ["KRW_ONTOLOGY_PLUGIN_PATH"])
agent_cwd = Path(os.environ["CLAUDE_AGENT_CWD"])
mcp_config_path = plugin_path / ".mcp.json"
mcp_config = json.loads(mcp_config_path.read_text())
server_config = mcp_config["mcpServers"]["krw-ontology"]
command = Path(server_config["command"])
server_env = server_config.get("env", {})

if not agent_cwd.is_absolute():
    raise SystemExit(f"CLAUDE_AGENT_CWD must be absolute: {agent_cwd}")
if not agent_cwd.exists() or not os.access(agent_cwd, os.W_OK | os.X_OK):
    raise SystemExit(f"CLAUDE_AGENT_CWD is not writable: {agent_cwd}")
if not command.exists() or not os.access(command, os.X_OK):
    raise SystemExit(f"MCP stdio command is not executable: {command}")
for key in (
    "KRW_ONTOLOGY_RELEASE_ROOT",
    "KRW_ONTOLOGY_ROOT",
    "KRW_ONTOLOGY_GLOBAL_SPINE_PATH",
    "KRW_ONTOLOGY_SHARD_MANIFEST_PATH",
):
    if os.environ.get(key) or server_env.get(key):
        raise SystemExit(f"GCP web must not be configured with local ontology data: {key}")

print(f"OK Claude agent cwd: {agent_cwd}")
print(f"OK plugin MCP command: {command}")
print("OK web ontology data boundary: Supabase catalog only")
PY

if [ "$VALIDATE_AGENT_WORKER" = "1" ]; then
  for i in $(seq 1 30); do
    worker_container=$(
      docker compose \
        --project-name "$COMPOSE_PROJECT_NAME" \
        --env-file "$ENV_FILE" \
        -f "$BUILD_CONTEXT/docker-compose.yml" \
        ps -q agent-worker
    )
    if [ -n "$worker_container" ] && [ "$(docker inspect --format '{{.State.Status}}' "$worker_container")" = "running" ]; then
      health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$worker_container")
      if [ "$health" = "healthy" ] || [ "$health" = "none" ]; then
        break
      fi
    fi
    if [ "$i" -eq 30 ]; then
      echo "agent-worker did not become healthy" >&2
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
    exec -T agent-worker node - <<'NODE'
const fs = require("fs");
const required = [
  ".worker/agent-worker.mjs",
  `${process.env.KRW_ONTOLOGY_ROOT}/indexes/global_spine.sqlite`,
  `${process.env.KRW_ONTOLOGY_ROOT}/indexes/shard_manifest.json`,
  `${process.env.KRW_ONTOLOGY_PLUGIN_PATH}/.mcp.json`,
];
for (const path of required) {
  fs.accessSync(path, fs.constants.R_OK);
}
console.log(JSON.stringify({
  worker: "ok",
  root: process.env.KRW_ONTOLOGY_ROOT,
  plugin: process.env.KRW_ONTOLOGY_PLUGIN_PATH,
}));
NODE
else
  echo "Skipping agent-worker validation; compose target excludes agent-worker."
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
