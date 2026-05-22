#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/deploy-data-production.sh [--dry-run] [--replace-remote-data] [--skip-prune]

Deploy the local ontology data root to the production VM without rebuilding the
web image. The active app reads /srv/krw-ontology-data/current.

By default this script keeps the current remote data release while uploading the
new one. On the current small VM that usually requires more disk than available.
Use --replace-remote-data to stop web, remove old data releases first, stream the
new data, then restart web. That mode causes downtime but avoids double-storage.

Environment:
  KRW_ONTOLOGY_DATA_DIR  Defaults to $HOME/krw-ontology-data
  KRW_ONTOLOGY_RELEASE_ID Optional release id from a frozen local data snapshot
  GCP_INSTANCE           Defaults to krw-onto-v1
  GCP_ZONE               Defaults to asia-northeast3-a
  REMOTE_DATA_ROOT       Defaults to /srv/krw-ontology-data
  REMOTE_FRONT_DIR       Defaults to /home/username/krw-ontology-front
  COMPOSE_PROJECT_NAME   Defaults to krw-ontology-front
  DATA_STABILITY_WAIT    Defaults to 2 seconds
EOF
}

DRY_RUN=0
REPLACE_REMOTE_DATA=0
PRUNE_REMOTE=1

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    --replace-remote-data)
      REPLACE_REMOTE_DATA=1
      ;;
    --skip-prune)
      PRUNE_REMOTE=0
      ;;
    *)
      usage
      exit 1
      ;;
  esac
  shift
done

DATA_DIR=${KRW_ONTOLOGY_DATA_DIR:-"$HOME/krw-ontology-data"}
GCP_INSTANCE=${GCP_INSTANCE:-krw-onto-v1}
GCP_ZONE=${GCP_ZONE:-asia-northeast3-a}
REMOTE_DATA_ROOT=${REMOTE_DATA_ROOT:-/srv/krw-ontology-data}
REMOTE_FRONT_DIR=${REMOTE_FRONT_DIR:-/home/username/krw-ontology-front}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-krw-ontology-front}
DATA_STABILITY_WAIT=${DATA_STABILITY_WAIT:-2}
if [ -n "${KRW_ONTOLOGY_RELEASE_ID:-}" ]; then
  case "$KRW_ONTOLOGY_RELEASE_ID" in
    release-*)
      RELEASE_ID=$KRW_ONTOLOGY_RELEASE_ID
      ;;
    *)
      RELEASE_ID="release-$KRW_ONTOLOGY_RELEASE_ID"
      ;;
  esac
else
  RELEASE_ID="release-$(date +%Y%m%d%H%M%S)-$$"
fi
case "$RELEASE_ID" in
  ""|*[!A-Za-z0-9._-]*)
    echo "Invalid release id: $RELEASE_ID" >&2
    exit 1
    ;;
esac

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

verify_serving_indexes() {
  missing=$(
    sqlite3 "$DATA_DIR/indexes/agent_index.sqlite" <<'SQL'
WITH expected(name) AS (
  VALUES
    ('idx_object_traceability_status'),
    ('idx_company_topic_ticker'),
    ('idx_company_topic_scope'),
    ('idx_company_topic_source_object'),
    ('idx_company_topic_source_topic')
)
SELECT expected.name
FROM expected
LEFT JOIN sqlite_master
  ON sqlite_master.type = 'index'
 AND sqlite_master.name = expected.name
WHERE sqlite_master.name IS NULL
ORDER BY expected.name;
SQL
  )
  if [ -n "$missing" ]; then
    echo "Refusing to deploy; missing required serving index(es):" >&2
    echo "$missing" >&2
    echo "Rebuild/finalize the local agent index or add the serving indexes before deploying." >&2
    exit 1
  fi
}

COMPANY_COUNT=$(
  find "$DATA_DIR/companies" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' '
)
if [ "$COMPANY_COUNT" -lt 1 ]; then
  echo "Refusing to deploy data root without companies: $DATA_DIR/companies" >&2
  exit 1
fi

echo "Checking local SQLite index..."
sqlite3 "$DATA_DIR/indexes/agent_index.sqlite" "pragma busy_timeout=30000; pragma wal_checkpoint(TRUNCATE);" >/dev/null
DOCUMENT_COUNT=$(sqlite3 "$DATA_DIR/indexes/agent_index.sqlite" "select count(*) from documents;")
OBJECT_COUNT=$(sqlite3 "$DATA_DIR/indexes/agent_index.sqlite" "select count(*) from objects;")
if [ "$DOCUMENT_COUNT" -lt 1 ] || [ "$OBJECT_COUNT" -lt 1 ]; then
  echo "Refusing to deploy empty ontology index: documents=$DOCUMENT_COUNT objects=$OBJECT_COUNT" >&2
  exit 1
fi
verify_serving_indexes
sleep "$DATA_STABILITY_WAIT"
DOCUMENT_COUNT_AFTER=$(sqlite3 "$DATA_DIR/indexes/agent_index.sqlite" "select count(*) from documents;")
OBJECT_COUNT_AFTER=$(sqlite3 "$DATA_DIR/indexes/agent_index.sqlite" "select count(*) from objects;")
if [ "$DOCUMENT_COUNT" != "$DOCUMENT_COUNT_AFTER" ] || [ "$OBJECT_COUNT" != "$OBJECT_COUNT_AFTER" ]; then
  echo "Refusing to deploy while local agent index is changing." >&2
  echo "Before: documents=$DOCUMENT_COUNT objects=$OBJECT_COUNT" >&2
  echo "After:  documents=$DOCUMENT_COUNT_AFTER objects=$OBJECT_COUNT_AFTER" >&2
  echo "Stop the local queue/index writer, then rerun." >&2
  exit 1
fi
if [ -s "$DATA_DIR/indexes/agent_index.sqlite-wal" ]; then
  echo "Refusing to deploy while SQLite WAL is non-empty. Stop the local queue writer and rerun." >&2
  exit 1
fi

DATA_SIZE_KB=$(du -sk "$DATA_DIR" | awk '{print $1}')

echo "Data source: $DATA_DIR"
echo "Target VM: $GCP_INSTANCE ($GCP_ZONE)"
echo "Remote data root: $REMOTE_DATA_ROOT"
echo "Release: $RELEASE_ID"
echo "Companies: $COMPANY_COUNT"
echo "Index: $DOCUMENT_COUNT documents, $OBJECT_COUNT objects"
echo "Data size: $((DATA_SIZE_KB / 1024)) MB"
echo "Replace remote data first: $REPLACE_REMOTE_DATA"

if [ "$REPLACE_REMOTE_DATA" = "0" ]; then
  REMOTE_AVAIL_KB=$(
    gcloud compute ssh "$GCP_INSTANCE" \
      --zone="$GCP_ZONE" \
      --command="mkdir -p '$REMOTE_DATA_ROOT'; df -Pk '$REMOTE_DATA_ROOT' | awk 'NR==2 {print \$4}'"
  )
  REQUIRED_KB=$((DATA_SIZE_KB + DATA_SIZE_KB / 5))
  if [ "$REMOTE_AVAIL_KB" -lt "$REQUIRED_KB" ]; then
    echo "Remote disk is too small for safe side-by-side upload." >&2
    echo "Available: $((REMOTE_AVAIL_KB / 1024)) MB, required about: $((REQUIRED_KB / 1024)) MB" >&2
    echo "Rerun with --replace-remote-data, or resize the VM disk." >&2
    exit 1
  fi
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run complete. No remote data was changed."
  exit 0
fi

REMOTE_PREPARE=$(cat <<EOF
set -eu
REMOTE_DATA_ROOT='$REMOTE_DATA_ROOT'
REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR'
RELEASE_ID='$RELEASE_ID'
COMPOSE_PROJECT_NAME='$COMPOSE_PROJECT_NAME'
REPLACE_REMOTE_DATA='$REPLACE_REMOTE_DATA'
PRUNE_REMOTE='$PRUNE_REMOTE'

mkdir -p "\$REMOTE_DATA_ROOT/releases"
UPLOAD_PATH="\$REMOTE_DATA_ROOT/releases/\$RELEASE_ID.uploading"
rm -rf "\$UPLOAD_PATH"

if [ "\$REPLACE_REMOTE_DATA" = "1" ]; then
  if [ -d "\$REMOTE_FRONT_DIR" ]; then
    cd "\$REMOTE_FRONT_DIR"
    docker compose --project-name "\$COMPOSE_PROJECT_NAME" --env-file .env stop web || true
  fi
  if [ "\$PRUNE_REMOTE" = "1" ]; then
    docker builder prune -af || true
    docker image prune -af || true
  fi
  rm -f "\$REMOTE_DATA_ROOT/current"
  find "\$REMOTE_DATA_ROOT/releases" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
fi

mkdir -p "\$UPLOAD_PATH"
df -h "\$REMOTE_DATA_ROOT" || df -h /
EOF
)

gcloud compute ssh "$GCP_INSTANCE" --zone="$GCP_ZONE" --command="$REMOTE_PREPARE"

echo "Streaming ontology data to VM..."
(
  cd "$DATA_DIR"
  COPYFILE_DISABLE=1 tar -czf - \
    --exclude './.krw_pipeline' \
    --exclude './.DS_Store' \
    --exclude './*/.DS_Store' \
    --exclude './._*' \
    --exclude './*/._*' \
    --exclude './indexes/*.sqlite-wal' \
    --exclude './indexes/*.sqlite-shm' \
    .
) | gcloud compute ssh "$GCP_INSTANCE" \
  --zone="$GCP_ZONE" \
  --command="tar --warning=no-unknown-keyword -xzf - -C '$REMOTE_DATA_ROOT/releases/$RELEASE_ID.uploading'"

REMOTE_ACTIVATE=$(cat <<EOF
set -eu
REMOTE_DATA_ROOT='$REMOTE_DATA_ROOT'
REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR'
RELEASE_ID='$RELEASE_ID'
COMPOSE_PROJECT_NAME='$COMPOSE_PROJECT_NAME'
DOCUMENT_COUNT='$DOCUMENT_COUNT'
OBJECT_COUNT='$OBJECT_COUNT'

UPLOAD_PATH="\$REMOTE_DATA_ROOT/releases/\$RELEASE_ID.uploading"
RELEASE_PATH="\$REMOTE_DATA_ROOT/releases/\$RELEASE_ID"

test -d "\$UPLOAD_PATH/companies"
test -f "\$UPLOAD_PATH/indexes/agent_index.sqlite"
rm -rf "\$RELEASE_PATH"
mv "\$UPLOAD_PATH" "\$RELEASE_PATH"

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
docker compose --project-name "\$COMPOSE_PROJECT_NAME" --env-file .env up -d web
docker compose --project-name "\$COMPOSE_PROJECT_NAME" --env-file .env exec -T web python3 - <<'PY'
import json
import os
import sqlite3
from krw_ontology.mcp_server.server import health_payload

payload, status = health_payload()
print(json.dumps({"status": status, **payload}, ensure_ascii=False))
if status != 200:
    raise SystemExit(status)

index_path = os.path.join(os.environ["KRW_ONTOLOGY_ROOT"], "indexes", "agent_index.sqlite")
expected = {
    "idx_object_traceability_status",
    "idx_company_topic_ticker",
    "idx_company_topic_scope",
    "idx_company_topic_source_object",
    "idx_company_topic_source_topic",
}
with sqlite3.connect(index_path) as conn:
    present = {
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master WHERE type = 'index'"
        )
    }
missing = sorted(expected - present)
if missing:
    raise SystemExit(f"Missing serving indexes after deployment: {missing}")
print(json.dumps({"serving_indexes": sorted(expected)}, ensure_ascii=False))
PY

if [ -e "\$OLD_BACKUP" ]; then
  rm -rf "\$OLD_BACKUP"
fi

echo "Activated ontology release \$RELEASE_ID with \$DOCUMENT_COUNT documents and \$OBJECT_COUNT objects."
EOF
)

gcloud compute ssh "$GCP_INSTANCE" --zone="$GCP_ZONE" --command="$REMOTE_ACTIVATE"

echo "Checking public web health..."
curl -fsS https://krwontology.com/api/healthz >/dev/null
echo "Ontology data deployment complete."
