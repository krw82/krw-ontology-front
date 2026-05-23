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

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
ONTOLOGY_SOURCE_DIR=${KRW_ONTOLOGY_SOURCE_DIR:-"$HOME/krw-ontology"}
ENV_FILE=${ENV_FILE:-"$FRONT_DIR/.env"}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-krw-ontology-front}
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

require_env_value() {
  key="$1"
  value=$(
    awk -F= -v key="$key" '
      $0 !~ /^[[:space:]]*#/ && $1 == key {
        sub(/^[^=]*=/, "")
        gsub(/^[[:space:]]+|[[:space:]]+$/, "")
        gsub(/^"|"$/, "")
        gsub(/^'\''|'\''$/, "")
        print
      }
    ' "$ENV_FILE" | tail -n 1
  )
  if [ -z "$value" ]; then
    echo "Missing required environment value in $ENV_FILE: $key" >&2
    exit 1
  fi
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
  INTERNAL_API_KEY
do
  require_env_value "$key"
done

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
      node -e "
        const fs = require('fs');
        const path = require.resolve('@anthropic-ai/claude-agent-sdk');
        const marker = '/node_modules/@anthropic-ai/claude-agent-sdk/';
        const index = path.indexOf(marker);
        if (index < 0) throw new Error('unexpected sdk path: ' + path);
        const packagePath = path.slice(0, index + marker.length) + 'package.json';
        process.stdout.write(JSON.parse(fs.readFileSync(packagePath, 'utf8')).version);
      "
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
root = Path(os.environ.get("KRW_ONTOLOGY_ROOT") or server_config["env"]["KRW_ONTOLOGY_ROOT"])
index_path = root / "indexes" / "agent_index.sqlite"

if not agent_cwd.is_absolute():
    raise SystemExit(f"CLAUDE_AGENT_CWD must be absolute: {agent_cwd}")
if not agent_cwd.exists() or not os.access(agent_cwd, os.W_OK | os.X_OK):
    raise SystemExit(f"CLAUDE_AGENT_CWD is not writable: {agent_cwd}")
if not command.exists() or not os.access(command, os.X_OK):
    raise SystemExit(f"MCP stdio command is not executable: {command}")
if not index_path.exists():
    raise SystemExit(f"Ontology agent index not found: {index_path}")

from krw_ontology.mcp_server.server import health_payload

payload, status = health_payload(root=str(root))
if status != 200 or not payload.get("ok"):
    raise SystemExit(f"MCP live health failed: status={status} payload={payload}")
if payload.get("documents", 0) < 1 or payload.get("objects", 0) < 1:
    raise SystemExit(f"MCP live health returned empty index counts: {payload}")
if "krw_ontology_query" not in payload.get("tools", []):
    raise SystemExit(f"MCP live health did not expose krw_ontology_query: {payload}")

print(f"OK Claude agent cwd: {agent_cwd}")
print(f"OK plugin MCP command: {command}")
print(f"OK ontology index: {index_path}")
print(f"OK MCP live health: documents={payload.get('documents')} objects={payload.get('objects')} tools={len(payload.get('tools', []))}")
PY
