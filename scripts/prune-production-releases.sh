#!/bin/sh
set -eu

# Garbage-collect legacy sealed-release artifacts on the production VM.
#
# Scope (deliberately conservative):
#   - `.deploy/releases/<v>` and `.deploy/code-rollback-<v>` from the retired
#     sealed prepared-release path, keeping the newest KEEP entries plus any
#     release still referenced by the global prepared marker.
#   - `.deploy/incoming-<version>` staging dirs and `/tmp/{front,ontology}-*.tar.gz`
#     uploads abandoned more than 48 hours ago (a hard-killed prepare leaves
#     these behind; anything fresher may belong to a deploy in flight).
#   - Dangling Docker images only. Tagged candidate/release/prev/rollback
#     images and the BuildKit cache are pruned by the deploy controller's own
#     stage-12 cleanup; `.simple-deploy` is entirely the controller's and is
#     never touched here.
#
# Dry-run by default; pass --apply to delete.

usage() {
  cat <<'EOF'
Usage: scripts/prune-production-releases.sh [--apply] [--keep N]

  --apply    Actually delete (default: dry-run report only)
  --keep N   Legacy releases to retain, newest first (default: 2)
EOF
}

APPLY=0
KEEP=2
while [ "$#" -gt 0 ]; do
  case "$1" in
    --apply) APPLY=1 ;;
    --keep)
      KEEP=${2:?Missing value for --keep}
      case "$KEEP" in ''|*[!0-9]*) echo "--keep must be a whole number." >&2; exit 1 ;; esac
      shift
      ;;
    --help|-h) usage; exit 0 ;;
    *) usage >&2; exit 1 ;;
  esac
  shift
done

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
FRONT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
CANONICAL_TARGET_FILE="$FRONT_DIR/ops/production-target.json"
target_value() {
  node -e '
    const target = require(process.argv[1]);
    const value = target[process.argv[2]];
    if (typeof value !== "string" || !value) process.exit(1);
    process.stdout.write(value);
  ' "$CANONICAL_TARGET_FILE" "$1"
}
GCP_PROJECT=$(target_value gcpProject)
GCP_INSTANCE=$(target_value gcpInstance)
GCP_ZONE=$(target_value gcpZone)
REMOTE_FRONT_DIR=$(target_value remoteFrontDir)

gcloud compute ssh "$GCP_INSTANCE" \
  --project="$GCP_PROJECT" \
  --zone="$GCP_ZONE" \
  --command='
set -eu
REMOTE_FRONT_DIR="'"$REMOTE_FRONT_DIR"'"
KEEP='"$KEEP"'
APPLY='"$APPLY"'
MODE=dry-run
if [ "$APPLY" = "1" ]; then MODE=apply; fi
DEPLOY_ROOT="$REMOTE_FRONT_DIR/.deploy"
RELEASES="$DEPLOY_ROOT/releases"

say() { printf "%s: %s\n" "$MODE" "$1"; }

# Any release still referenced by the global prepared marker is an in-flight
# lifecycle candidate and must survive regardless of recency.
protected_version=
if [ -f "$DEPLOY_ROOT/prepared-web-release.env" ]; then
  protected_version=$(sed -n "s/^APP_VERSION=//p" "$DEPLOY_ROOT/prepared-web-release.env" | head -n 1)
fi

du_before=$(du -sh "$DEPLOY_ROOT" 2>/dev/null | awk "{print \$1}")
say "legacy .deploy size before: $du_before"

if [ -d "$RELEASES" ]; then
  # Newest releases first by directory mtime.
  index=0
  for release in $(ls -1t "$RELEASES" 2>/dev/null); do
    [ -d "$RELEASES/$release" ] || continue
    index=$((index + 1))
    if [ "$index" -le "$KEEP" ]; then
      say "keep release $release (newest #$index)"
      continue
    fi
    if [ -n "$protected_version" ] && [ "$release" = "$protected_version" ]; then
      say "keep release $release (referenced by the global prepared marker)"
      continue
    fi
    say "delete release $release"
    if [ "$APPLY" = "1" ]; then
      rm -rf -- "$RELEASES/$release"
    fi
    if [ -d "$DEPLOY_ROOT/code-rollback-$release" ]; then
      say "delete rollback $release"
      if [ "$APPLY" = "1" ]; then
        rm -rf -- "$DEPLOY_ROOT/code-rollback-$release"
      fi
    fi
  done
else
  say "no legacy releases directory"
fi

# Stale staging dirs and abandoned uploads: only ones older than 48h, so a
# concurrent or just-failed deploy is never raced.
find "$DEPLOY_ROOT" -maxdepth 1 -name "incoming-*" -type d -mtime +2 2>/dev/null | while IFS= read -r stale; do
  say "delete staging $stale"
  if [ "$APPLY" = "1" ]; then rm -rf -- "$stale"; fi
done
find /tmp -maxdepth 1 -name "front-*.tar.gz" -type f -mtime +2 2>/dev/null | while IFS= read -r stale; do
  say "delete upload $stale"
  if [ "$APPLY" = "1" ]; then rm -f -- "$stale"; fi
done
find /tmp -maxdepth 1 -name "ontology-*.tar.gz" -type f -mtime +2 2>/dev/null | while IFS= read -r stale; do
  say "delete upload $stale"
  if [ "$APPLY" = "1" ]; then rm -f -- "$stale"; fi
done

# Dangling images only: unused AND untagged. Tagged stale deploy images and
# the BuildKit cache belong to the deploy controller stage-12 prune.
dangling_count=$(docker images --filter dangling=true --format "{{.ID}}" 2>/dev/null | awk "NF" | wc -l | tr -d " ")
say "dangling images present: $dangling_count"
if [ "$APPLY" = "1" ] && [ "$dangling_count" -gt 0 ]; then
  docker image prune -f >/dev/null
  say "dangling images pruned"
fi

du_after=$(du -sh "$DEPLOY_ROOT" 2>/dev/null | awk "{print \$1}")
say "legacy .deploy size after: $du_after"
docker system df 2>/dev/null | sed -n "1,3p"
'
