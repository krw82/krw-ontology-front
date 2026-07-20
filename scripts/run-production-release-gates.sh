#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/run-production-release-gates.sh [--dry-run]

Run every local, non-mutating release gate before a production database
migration or runtime cutover is allowed to begin.

The production deploy deliberately runs these gates before it pauses workers or
changes Supabase. A failed typecheck, test, optimized build, Desktop contract,
or production-mode browser test therefore leaves production untouched.
EOF
}

DRY_RUN=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1 ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
  shift
done

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run: would run npm run check."
  echo "Dry run: would run npm run contracts:desktop:verify."
  echo "Dry run: would run npm run test:e2e against the optimized standalone build."
  exit 0
fi

for required_command in node npm rsync; do
  command -v "$required_command" >/dev/null 2>&1 || {
    echo "Missing required command: $required_command" >&2
    exit 1
  }
done
for dependency_manifest in package.json package-lock.json; do
  test -f "$FRONT_DIR/$dependency_manifest" || {
    echo "Missing dependency manifest: $dependency_manifest" >&2
    exit 1
  }
done
test -f "$SCRIPT_DIR/verify-contained-symlinks.mjs" || {
  echo "Missing contained-symlink verifier for the isolated release gate." >&2
  exit 1
}
test -f "$SCRIPT_DIR/compute-production-source-sha256.mjs" || {
  echo "Missing production source identity helper for the isolated release gate." >&2
  exit 1
}

# These commands run only against the private source mirror below. If the
# execution host transiently terminates one child process, retrying it cannot
# alter a live worker, GCP container, or database. A TERM aimed at this parent
# shell still follows the normal fail-closed trap path.
run_isolated_gate_with_sigterm_retry() {
  gate_label=$1
  shift
  gate_attempt=1
  while :; do
    if "$@"; then
      return 0
    else
      gate_status=$?
    fi
    if [ "$gate_status" -ne 143 ] || [ "$gate_attempt" -ge 3 ]; then
      return "$gate_status"
    fi
    echo "Retrying $gate_label after a transient SIGTERM (attempt $((gate_attempt + 1))/3)..." >&2
    gate_attempt=$((gate_attempt + 1))
    sleep 1
  done
}

# Playwright reports a web-server child killed during startup as exit 1 rather
# than 143. Retest once: a real browser failure still fails the second run, but
# a one-off local server termination does not force a whole production cutover
# to be restarted from the beginning.
run_isolated_browser_gate_with_single_retry() {
  browser_attempt=1
  while :; do
    if npm run test:e2e; then
      return 0
    else
      browser_status=$?
    fi
    if [ "$browser_attempt" -ge 2 ]; then
      return "$browser_status"
    fi
    echo "Retrying production-mode browser/PWA gate once after a failed local test-server run..." >&2
    browser_attempt=$((browser_attempt + 1))
    sleep 1
  done
}

# `npm run check` also builds worker bundles. The production launchd supervisor
# executes `$FRONT_DIR/.worker` with --no-build, so running the gate in-place
# could expose new code if the live worker restarts before the schema cutover.
# A private source mirror keeps every generated artifact away from production.
EXPECTED_SOURCE_SHA256=$(node \
  "$SCRIPT_DIR/compute-production-source-sha256.mjs" "$FRONT_DIR")
GATE_DIR=$(mktemp -d "${TMPDIR:-/tmp}/krw-production-gates.XXXXXX")
cleanup() {
  rm -rf "$GATE_DIR"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

rsync -a --delete \
  --exclude '/.git/' \
  --exclude '/.next/' \
  --exclude '/.next-*/' \
  --exclude '/.worker/' \
  --exclude '/.services/' \
  --exclude '/.deploy/' \
  --exclude '/node_modules/' \
  --exclude '/output/' \
  --exclude '/.codex/' \
  --exclude '/.lazyweb/' \
  --exclude '/.playwright-mcp/' \
  --exclude '/krw-ontology' \
  --exclude '/krw-ontology/' \
  "$FRONT_DIR/" "$GATE_DIR/"
GATE_SOURCE_SHA256=$(node \
  "$GATE_DIR/scripts/compute-production-source-sha256.mjs" "$GATE_DIR")
CURRENT_SOURCE_SHA256=$(node \
  "$SCRIPT_DIR/compute-production-source-sha256.mjs" "$FRONT_DIR")
[ "$GATE_SOURCE_SHA256" = "$EXPECTED_SOURCE_SHA256" ] || {
  echo "Isolated release-gate source differs from the requested production source." >&2
  exit 1
}
[ "$CURRENT_SOURCE_SHA256" = "$EXPECTED_SOURCE_SHA256" ] || {
  echo "Production source changed while the isolated release gate was copied." >&2
  exit 1
}
# Turbopack 16 rejects a node_modules symlink outside its lockfile-selected
# filesystem root. Install the copied package-lock inside the gate instead of
# widening turbopack.root to the mutable checkout or reusing a potentially
# drifted host dependency tree. This matches Dockerfile.web's dependency stage
# while --include=dev keeps the typecheck/lint/test toolchain available even if
# the operator shell happens to export NODE_ENV=production.
(cd "$GATE_DIR" && npm ci --include=dev --no-audit --no-fund)
node "$GATE_DIR/scripts/verify-contained-symlinks.mjs" \
  "$GATE_DIR/node_modules"
if [ -e "$FRONT_DIR/krw-ontology" ]; then
  ln -s "$(CDPATH= cd -- "$FRONT_DIR/krw-ontology" && pwd -P)" "$GATE_DIR/krw-ontology"
fi

cd "$GATE_DIR"
echo "Isolated production release gate: $GATE_DIR"

echo "Running local production release gate: typecheck, lint, unit tests, optimized app/worker/gateway build..."
# The package-lock-pinned Vitest fork pool can otherwise saturate every local
# core while Next and other release processes are active. A fixed bounded pool
# keeps the gate deterministic without reducing its file or assertion scope.
run_isolated_gate_with_sigterm_retry \
  "local production release gate" \
  env VITEST_MAX_WORKERS=4 npm run check

echo "Running Desktop v2 contract gate..."
run_isolated_gate_with_sigterm_retry \
  "Desktop v2 contract gate" \
  npm run contracts:desktop:verify

echo "Running production-mode browser/PWA gate..."
run_isolated_browser_gate_with_single_retry

FINAL_GATE_SOURCE_SHA256=$(node \
  "$GATE_DIR/scripts/compute-production-source-sha256.mjs" "$GATE_DIR")
FINAL_SOURCE_SHA256=$(node \
  "$SCRIPT_DIR/compute-production-source-sha256.mjs" "$FRONT_DIR")
[ "$FINAL_GATE_SOURCE_SHA256" = "$EXPECTED_SOURCE_SHA256" ] || {
  echo "Isolated release-gate source changed while its checks were running." >&2
  exit 1
}
[ "$FINAL_SOURCE_SHA256" = "$EXPECTED_SOURCE_SHA256" ] || {
  echo "Production source changed while its isolated release gate was running." >&2
  exit 1
}

echo "All local production release gates passed."
