#!/bin/sh
set -eu

ENV_PATH=${1:?Usage: scripts/verify-mac-runtime-target.sh ENV_FILE}
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
RUNTIME_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
TARGET_FILE="$RUNTIME_ROOT/ops/production-target.json"

test -f "$ENV_PATH" || {
  echo "Missing Mac runtime env: $ENV_PATH" >&2
  exit 1
}
test -f "$TARGET_FILE" || {
  echo "Missing canonical production target in Mac runtime: $TARGET_FILE" >&2
  exit 1
}
test -f "$SCRIPT_DIR/verify-supabase-production-target.mjs" || {
  echo "Missing production target verifier in Mac runtime." >&2
  exit 1
}

set -a
# shellcheck disable=SC1090
. "$ENV_PATH"
set +a

if [ "${KRW_MAC_IMMUTABLE_RUNTIME:-0}" = "1" ]; then
  test "${KRW_MAC_RUNTIME_ROOT:-}" = "$RUNTIME_ROOT" || {
    echo "Mac runtime root does not match its sealed environment." >&2
    exit 1
  }
  IDENTITY_FILE="$RUNTIME_ROOT/runtime-identity.json"
  SEAL_FILE="$RUNTIME_ROOT/.artifact-seal.json"
  test -f "$IDENTITY_FILE" || {
    echo "Missing Mac runtime identity: $IDENTITY_FILE" >&2
    exit 1
  }
  test -n "${KRW_RUNTIME_IDENTITY_SHA256:-}" || {
    echo "Missing KRW_RUNTIME_IDENTITY_SHA256 in the immutable runtime." >&2
    exit 1
  }
  actual_identity_sha=$(shasum -a 256 "$IDENTITY_FILE" | awk '{print $1}')
  test "$actual_identity_sha" = "$KRW_RUNTIME_IDENTITY_SHA256" || {
    echo "Mac runtime identity digest mismatch." >&2
    exit 1
  }

  # The runtime owns Python and all JS dependencies. Node and Claude Code are
  # host executables, so their exact prepared bytes are identity-pinned and
  # rechecked at every launch. A package-manager upgrade therefore fails
  # closed instead of silently changing a sealed production runtime.
  #
  # Older sealed runtimes did not materialize this value. Their identity file
  # remains a safe compatibility source: the ambient Node only reads a JSON
  # path, while the identity-pinned Node performs every actual verification.
  RUNTIME_NODE_EXECUTABLE=${KRW_RUNTIME_NODE_EXECUTABLE:-}
  if [ -z "$RUNTIME_NODE_EXECUTABLE" ]; then
    RUNTIME_NODE_EXECUTABLE=$(node - "$IDENTITY_FILE" <<'NODE'
const fs = require("node:fs");
const identity = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (typeof identity?.node?.path !== "string" || !identity.node.path.startsWith("/")) {
  throw new Error("Invalid Node executable path in Mac runtime identity");
}
process.stdout.write(identity.node.path);
NODE
)
  fi
  test -x "$RUNTIME_NODE_EXECUTABLE" || {
    echo "Missing prepared Node executable: $RUNTIME_NODE_EXECUTABLE" >&2
    exit 1
  }

  "$RUNTIME_NODE_EXECUTABLE" - "$IDENTITY_FILE" <<'NODE'
const crypto = require("node:crypto");
const fs = require("node:fs");

const identity = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (identity?.format !== "krw-mac-runtime-identity/v1") {
  throw new Error("Invalid Mac runtime identity format");
}
const hash = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
for (const [name, executable] of Object.entries({
  node: identity.node,
  python: identity.python,
  claude: identity.claude,
})) {
  if (!executable?.path || !/^[a-f0-9]{64}$/.test(executable.sha256 ?? "")) {
    throw new Error(`Invalid ${name} executable identity`);
  }
  if (hash(executable.path) !== executable.sha256) {
    throw new Error(`${name} executable changed after runtime preparation`);
  }
}
if (hash(process.execPath) !== identity.node.sha256) {
  throw new Error("The Node executable launching this runtime is not the prepared executable");
}
if (process.version !== identity.node.version) {
  throw new Error("The Node version launching this runtime is not the prepared version");
}
NODE

  if [ -f "$SEAL_FILE" ]; then
    test -f "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs" || {
      echo "Missing immutable Mac artifact verifier." >&2
      exit 1
    }
    "$RUNTIME_NODE_EXECUTABLE" "$SCRIPT_DIR/verify-prepared-runtime-artifacts.mjs" \
      verify --marker "$SEAL_FILE" >/dev/null
  else
    case "$ENV_PATH" in
      /*) resolved_env_path=$ENV_PATH ;;
      *) resolved_env_path=$(CDPATH= cd -- "$(dirname "$ENV_PATH")" && pwd -P)/$(basename "$ENV_PATH") ;;
    esac
    if [ "${KRW_RUNTIME_CANDIDATE_VALIDATION:-0}" != "1" ] \
      || [ "$resolved_env_path" = "$RUNTIME_ROOT/runtime.env" ]; then
      echo "Missing immutable Mac runtime artifact seal." >&2
      exit 1
    fi
  fi
fi

if [ "${KRW_MAC_IMMUTABLE_RUNTIME:-0}" = "1" ]; then
  "$RUNTIME_NODE_EXECUTABLE" "$SCRIPT_DIR/verify-supabase-production-target.mjs" \
    "$ENV_PATH" \
    - \
    "$TARGET_FILE"
else
  node "$SCRIPT_DIR/verify-supabase-production-target.mjs" \
    "$ENV_PATH" \
    - \
    "$TARGET_FILE"
fi
