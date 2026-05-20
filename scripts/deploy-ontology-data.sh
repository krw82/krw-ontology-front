#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/deploy-ontology-data.sh [--dry-run]

Upload the local ontology data root to the GCP VM and replace the production
ontology data root. This is intended for full data replacement, not merging.

Environment:
  KRW_ONTOLOGY_DATA_DIR  Defaults to $HOME/krw-ontology-data
  GCP_INSTANCE           Defaults to krw-onto-v1
  GCP_ZONE               Defaults to asia-northeast3-a
  REMOTE_DATA_ROOT       Defaults to /srv/krw-ontology-data
  REMOTE_FRONT_DIR       Defaults to /home/username/krw-ontology-front
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
if [ "$#" -gt 0 ]; then
  usage
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
DATA_DIR=${KRW_ONTOLOGY_DATA_DIR:-"$HOME/krw-ontology-data"}
GCP_INSTANCE=${GCP_INSTANCE:-krw-onto-v1}
GCP_ZONE=${GCP_ZONE:-asia-northeast3-a}
REMOTE_DATA_ROOT=${REMOTE_DATA_ROOT:-/srv/krw-ontology-data}
REMOTE_FRONT_DIR=${REMOTE_FRONT_DIR:-/home/username/krw-ontology-front}

DEPLOY_ID=$(date +%Y%m%d%H%M%S)-$$
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/krw-ontology-data-deploy.XXXXXX")
DATA_ARCHIVE="$TMP_DIR/ontology-data-$DEPLOY_ID.tar.gz"
REMOTE_ARCHIVE="/tmp/ontology-data-$DEPLOY_ID.tar.gz"
RELEASE_ID="release-$DEPLOY_ID"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT INT TERM

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_path() {
  if [ ! -e "$1" ]; then
    echo "Missing required path: $1" >&2
    exit 1
  fi
}

require_command gcloud
require_command tar
require_command sqlite3
require_path "$DATA_DIR/companies"
require_path "$DATA_DIR/indexes/agent_index.sqlite"

DOCUMENT_COUNT=$(sqlite3 "$DATA_DIR/indexes/agent_index.sqlite" "select count(*) from documents;")
OBJECT_COUNT=$(sqlite3 "$DATA_DIR/indexes/agent_index.sqlite" "select count(*) from objects;")
if [ "$DOCUMENT_COUNT" -lt 1 ] || [ "$OBJECT_COUNT" -lt 1 ]; then
  echo "Refusing to deploy empty ontology index: documents=$DOCUMENT_COUNT objects=$OBJECT_COUNT" >&2
  exit 1
fi

COMPANY_COUNT=$(
  find "$DATA_DIR/companies" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' '
)
if [ "$COMPANY_COUNT" -lt 1 ]; then
  echo "Refusing to deploy data root without companies: $DATA_DIR/companies" >&2
  exit 1
fi

echo "Data source: $DATA_DIR"
echo "Target VM: $GCP_INSTANCE ($GCP_ZONE)"
echo "Remote data root: $REMOTE_DATA_ROOT"
echo "Release: $RELEASE_ID"
echo "Companies: $COMPANY_COUNT"
echo "Index: $DOCUMENT_COUNT documents, $OBJECT_COUNT objects"

(
  cd "$DATA_DIR"
  COPYFILE_DISABLE=1 tar -czf "$DATA_ARCHIVE" \
    --exclude './.krw_pipeline' \
    --exclude './.DS_Store' \
    --exclude './*/.DS_Store' \
    --exclude './._*' \
    --exclude './*/._*' \
    --exclude './indexes/*.sqlite-wal' \
    --exclude './indexes/*.sqlite-shm' \
    .
)

echo "Archive: $(du -h "$DATA_ARCHIVE" | awk '{print $1}')"

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run complete. No files were uploaded and production data was not changed."
  exit 0
fi

gcloud compute scp "$DATA_ARCHIVE" "$GCP_INSTANCE:$REMOTE_ARCHIVE" --zone="$GCP_ZONE"

REMOTE_COMMAND=$(cat <<EOF
set -eu

REMOTE_DATA_ROOT='$REMOTE_DATA_ROOT'
REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR'
REMOTE_ARCHIVE='$REMOTE_ARCHIVE'
RELEASE_ID='$RELEASE_ID'
DOCUMENT_COUNT='$DOCUMENT_COUNT'
OBJECT_COUNT='$OBJECT_COUNT'

require_command() {
  if ! command -v "\$1" >/dev/null 2>&1; then
    echo "Missing required command on server: \$1" >&2
    exit 1
  fi
}

require_command tar
require_command docker

STAGE=\$(mktemp -d /tmp/krw-ontology-data-stage.XXXXXX)
cleanup() {
  rm -rf "\$STAGE" "\$REMOTE_ARCHIVE"
}
trap cleanup EXIT INT TERM

mkdir -p "\$REMOTE_DATA_ROOT/releases"
tar --warning=no-unknown-keyword -xzf "\$REMOTE_ARCHIVE" -C "\$STAGE"

test -d "\$STAGE/companies"
test -f "\$STAGE/indexes/agent_index.sqlite"

RELEASE_PATH="\$REMOTE_DATA_ROOT/releases/\$RELEASE_ID"
rm -rf "\$RELEASE_PATH"
mkdir -p "\$RELEASE_PATH"
cp -a "\$STAGE/." "\$RELEASE_PATH/"

test -d "\$RELEASE_PATH/companies"
test -f "\$RELEASE_PATH/indexes/agent_index.sqlite"

OLD_CURRENT="\$REMOTE_DATA_ROOT/current"
OLD_BACKUP="\$REMOTE_DATA_ROOT/current.replaced.\$RELEASE_ID"
if [ -L "\$OLD_CURRENT" ]; then
  rm "\$OLD_CURRENT"
elif [ -e "\$OLD_CURRENT" ]; then
  rm -rf "\$OLD_BACKUP"
  mv "\$OLD_CURRENT" "\$OLD_BACKUP"
fi

ln -s "releases/\$RELEASE_ID" "\$OLD_CURRENT"

cd "\$REMOTE_FRONT_DIR"
docker compose restart mcp web
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if docker compose exec -T mcp curl -sf http://localhost:8000/health; then
    break
  fi
  if [ "\$attempt" -eq 10 ]; then
    echo "MCP health check failed after restart" >&2
    exit 1
  fi
  sleep 3
done

if [ -e "\$OLD_BACKUP" ]; then
  rm -rf "\$OLD_BACKUP"
fi

echo "Activated ontology release \$RELEASE_ID with \$DOCUMENT_COUNT documents and \$OBJECT_COUNT objects."
EOF
)

gcloud compute ssh "$GCP_INSTANCE" --zone="$GCP_ZONE" --command="$REMOTE_COMMAND"

echo "Checking public web health..."
curl -fsS https://krwontology.com/api/healthz/deep >/dev/null
echo "Ontology data deployment complete."
