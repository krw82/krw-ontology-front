#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/deploy-data-production.sh [--dry-run] [--replace-remote-data] [--skip-prune]

Deploy the local ontology data root to production as an immutable release.

Standard flow:
  1. Validate the local SQLite index and serving indexes.
  2. Create a local tar.zst snapshot, excluding WAL/SHM/backups/temp files.
  3. Upload the archive and sha256 file to GCS.
  4. Have the VM download the archive from GCS.
  5. Verify sha256 and zstd integrity on the VM.
  6. Extract to /srv/krw-ontology-data/releases/<release>.uploading.
  7. Verify SQLite counts and serving indexes.
  8. Atomically switch /srv/krw-ontology-data/current.
  9. Restart web and verify MCP/public health.

Options:
  --dry-run              Validate local data and print the intended target only.
  --replace-remote-data  Stop web and remove existing releases before extracting.
  --skip-prune           Keep old remote releases and remote upload archives.

Environment:
  KRW_ONTOLOGY_DATA_DIR          Defaults to $HOME/krw-ontology-data
  KRW_ONTOLOGY_RELEASE_ID        Optional release id from a frozen local snapshot
  KRW_ONTOLOGY_ARCHIVE_DIR       Defaults to $HOME/krw-ontology-data-releases
  KRW_ONTOLOGY_DEPLOY_BUCKET     Defaults to krw-ontology-deploy-project-6c11ac2d
  KRW_ONTOLOGY_DEPLOY_LOCATION   Defaults to asia-northeast3
  KRW_ONTOLOGY_FORCE_REDEPLOY_RELEASE
                                  Set to 1 to redeploy an already-active id
  GCP_INSTANCE                   Defaults to krw-onto-v1
  GCP_ZONE                       Defaults to asia-northeast3-a
  REMOTE_DATA_ROOT               Defaults to /srv/krw-ontology-data
  REMOTE_FRONT_DIR               Defaults to /home/username/krw-ontology-front
  COMPOSE_PROJECT_NAME           Defaults to krw-ontology-front
  DATA_STABILITY_WAIT            Defaults to 2 seconds
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
ARCHIVE_DIR=${KRW_ONTOLOGY_ARCHIVE_DIR:-"$HOME/krw-ontology-data-releases"}
DEPLOY_BUCKET=${KRW_ONTOLOGY_DEPLOY_BUCKET:-krw-ontology-deploy-project-6c11ac2d}
DEPLOY_LOCATION=${KRW_ONTOLOGY_DEPLOY_LOCATION:-asia-northeast3}
GCP_INSTANCE=${GCP_INSTANCE:-krw-onto-v1}
GCP_ZONE=${GCP_ZONE:-asia-northeast3-a}
REMOTE_DATA_ROOT=${REMOTE_DATA_ROOT:-/srv/krw-ontology-data}
REMOTE_FRONT_DIR=${REMOTE_FRONT_DIR:-/home/username/krw-ontology-front}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-krw-ontology-front}
DATA_STABILITY_WAIT=${DATA_STABILITY_WAIT:-2}
FORCE_REDEPLOY_RELEASE=${KRW_ONTOLOGY_FORCE_REDEPLOY_RELEASE:-0}

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
  RELEASE_ID="release-$(date -u +%Y%m%dT%H%M%SZ)"
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
require_command sqlite3
require_command tar
require_command zstd
require_command shasum
require_command mkfifo
require_command curl

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

DATA_SIZE_KB=$(du -skL "$DATA_DIR" | awk '{print $1}')
BUCKET_URI="gs://$DEPLOY_BUCKET"
GCS_PREFIX="$BUCKET_URI/releases/$RELEASE_ID"
ARCHIVE_NAME="$RELEASE_ID.tar.zst"
ARCHIVE_PATH="$ARCHIVE_DIR/$ARCHIVE_NAME"
ARCHIVE_TMP="$ARCHIVE_PATH.tmp"
SHA_PATH="$ARCHIVE_PATH.sha256"
PIPE_PATH="$ARCHIVE_DIR/$RELEASE_ID.tar.pipe"

echo "Data source: $DATA_DIR"
echo "Target VM: $GCP_INSTANCE ($GCP_ZONE)"
echo "Remote data root: $REMOTE_DATA_ROOT"
echo "GCS target: $GCS_PREFIX/"
echo "Release: $RELEASE_ID"
echo "Companies: $COMPANY_COUNT"
echo "Index: $DOCUMENT_COUNT documents, $OBJECT_COUNT objects"
echo "Data size: $((DATA_SIZE_KB / 1024)) MB"
echo "Replace remote data first: $REPLACE_REMOTE_DATA"

if [ "$DRY_RUN" = "1" ]; then
  echo "Dry run complete. No archive was created and no remote data was changed."
  exit 0
fi

if [ "$FORCE_REDEPLOY_RELEASE" != "1" ]; then
  REMOTE_CURRENT=$(
    gcloud compute ssh "$GCP_INSTANCE" \
      --zone="$GCP_ZONE" \
      --command="readlink '$REMOTE_DATA_ROOT/current' 2>/dev/null || true"
  )
  if [ "$REMOTE_CURRENT" = "releases/$RELEASE_ID" ]; then
    echo "Release $RELEASE_ID is already active on the VM; skipping data deployment."
    echo "Set KRW_ONTOLOGY_FORCE_REDEPLOY_RELEASE=1 and use --replace-remote-data to overwrite an active release id."
    exit 0
  fi
elif [ "$REPLACE_REMOTE_DATA" != "1" ]; then
  echo "KRW_ONTOLOGY_FORCE_REDEPLOY_RELEASE=1 requires --replace-remote-data." >&2
  exit 1
fi

mkdir -p "$ARCHIVE_DIR"
rm -f "$ARCHIVE_TMP" "$SHA_PATH" "$PIPE_PATH"

TAR_METADATA_FLAGS=""
for option in --no-xattrs --no-acls --no-fflags --disable-copyfile; do
  if (cd "$DATA_DIR" && COPYFILE_DISABLE=1 tar "$option" -cf /dev/null --files-from /dev/null) >/dev/null 2>&1; then
    TAR_METADATA_FLAGS="$TAR_METADATA_FLAGS $option"
  fi
done

echo "Creating local archive: $ARCHIVE_PATH"
mkfifo "$PIPE_PATH"
(
  cd "$DATA_DIR"
  # shellcheck disable=SC2086
  COPYFILE_DISABLE=1 tar $TAR_METADATA_FLAGS -cf - \
    --exclude './.krw_pipeline' \
    --exclude './.DS_Store' \
    --exclude './*/.DS_Store' \
    --exclude './._*' \
    --exclude './*/._*' \
    --exclude './indexes/*.sqlite-wal' \
    --exclude './indexes/*.sqlite-shm' \
    --exclude './indexes/*.sqlite.bak*' \
    --exclude './indexes/*.sqlite-wal.bak*' \
    --exclude './indexes/*.sqlite-shm.bak*' \
    .
) > "$PIPE_PATH" &
TAR_PID=$!

if zstd -T0 -3 -q -o "$ARCHIVE_TMP" < "$PIPE_PATH"; then
  ZSTD_STATUS=0
else
  ZSTD_STATUS=$?
fi
if wait "$TAR_PID"; then
  TAR_STATUS=0
else
  TAR_STATUS=$?
fi
rm -f "$PIPE_PATH"

if [ "$TAR_STATUS" -ne 0 ] || [ "$ZSTD_STATUS" -ne 0 ]; then
  rm -f "$ARCHIVE_TMP"
  echo "Archive creation failed: tar=$TAR_STATUS zstd=$ZSTD_STATUS" >&2
  exit 1
fi

mv "$ARCHIVE_TMP" "$ARCHIVE_PATH"
shasum -a 256 "$ARCHIVE_PATH" | awk '{print $1}' > "$SHA_PATH"
zstd -t "$ARCHIVE_PATH" >/dev/null
ARCHIVE_SIZE_KB=$(du -sk "$ARCHIVE_PATH" | awk '{print $1}')
echo "Archive size: $((ARCHIVE_SIZE_KB / 1024)) MB"
echo "Archive sha256: $(cat "$SHA_PATH")"

if [ "$REPLACE_REMOTE_DATA" = "0" ]; then
  REMOTE_AVAIL_KB=$(
    gcloud compute ssh "$GCP_INSTANCE" \
      --zone="$GCP_ZONE" \
      --command="mkdir -p '$REMOTE_DATA_ROOT'; df -Pk '$REMOTE_DATA_ROOT' | awk 'NR==2 {print \$4}'"
  )
  REQUIRED_KB=$((DATA_SIZE_KB + ARCHIVE_SIZE_KB + DATA_SIZE_KB / 10))
  if [ "$REMOTE_AVAIL_KB" -lt "$REQUIRED_KB" ]; then
    echo "Remote disk is too small for side-by-side archive deployment." >&2
    echo "Available: $((REMOTE_AVAIL_KB / 1024)) MB, required about: $((REQUIRED_KB / 1024)) MB" >&2
    echo "Rerun with --replace-remote-data, or resize the VM disk." >&2
    exit 1
  fi
fi

if ! gcloud storage buckets describe "$BUCKET_URI" >/dev/null 2>&1; then
  echo "Creating deploy bucket: $BUCKET_URI"
  gcloud storage buckets create "$BUCKET_URI" \
    --location="$DEPLOY_LOCATION" \
    --uniform-bucket-level-access
fi

VM_SERVICE_ACCOUNT=$(
  gcloud compute instances describe "$GCP_INSTANCE" \
    --zone="$GCP_ZONE" \
    --format='value(serviceAccounts[0].email)' 2>/dev/null || true
)
if [ -n "$VM_SERVICE_ACCOUNT" ]; then
  echo "Ensuring VM can read deployment archives: $VM_SERVICE_ACCOUNT"
  gcloud storage buckets add-iam-policy-binding "$BUCKET_URI" \
    --member="serviceAccount:$VM_SERVICE_ACCOUNT" \
    --role="roles/storage.objectViewer" >/dev/null
fi

echo "Uploading archive to GCS..."
gcloud storage cp "$ARCHIVE_PATH" "$SHA_PATH" "$GCS_PREFIX/"
gcloud storage ls -l "$GCS_PREFIX/"

REMOTE_DEPLOY=$(cat <<EOF
set -eu

REMOTE_DATA_ROOT='$REMOTE_DATA_ROOT'
REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR'
RELEASE_ID='$RELEASE_ID'
COMPOSE_PROJECT_NAME='$COMPOSE_PROJECT_NAME'
REPLACE_REMOTE_DATA='$REPLACE_REMOTE_DATA'
PRUNE_REMOTE='$PRUNE_REMOTE'
DOCUMENT_COUNT='$DOCUMENT_COUNT'
OBJECT_COUNT='$OBJECT_COUNT'
ARCHIVE_NAME='$ARCHIVE_NAME'
GCS_PREFIX='$GCS_PREFIX'

UPLOAD_PATH="\$REMOTE_DATA_ROOT/releases/\$RELEASE_ID.uploading"
RELEASE_PATH="\$REMOTE_DATA_ROOT/releases/\$RELEASE_ID"
ARCHIVE_PATH="\$REMOTE_DATA_ROOT/uploads/\$ARCHIVE_NAME"
SHA_PATH="\$ARCHIVE_PATH.sha256"
export UPLOAD_PATH DOCUMENT_COUNT OBJECT_COUNT

require_command() {
  if ! command -v "\$1" >/dev/null 2>&1; then
    echo "Missing required command on server: \$1" >&2
    exit 1
  fi
}

require_command gcloud
require_command tar
require_command zstd
require_command sha256sum
require_command python3
require_command docker

mkdir -p "\$REMOTE_DATA_ROOT/uploads" "\$REMOTE_DATA_ROOT/releases"

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

rm -rf "\$UPLOAD_PATH" "\$RELEASE_PATH"
mkdir -p "\$UPLOAD_PATH"

echo "Downloading archive from GCS..."
gcloud storage cp "\$GCS_PREFIX/\$ARCHIVE_NAME" "\$ARCHIVE_PATH"
gcloud storage cp "\$GCS_PREFIX/\$ARCHIVE_NAME.sha256" "\$SHA_PATH"

echo "Verifying archive..."
printf "%s  %s\n" "\$(cat "\$SHA_PATH")" "\$ARCHIVE_PATH" | sha256sum -c -
zstd -t "\$ARCHIVE_PATH"

echo "Extracting archive..."
zstd -dc "\$ARCHIVE_PATH" | tar --warning=no-unknown-keyword -xf - -C "\$UPLOAD_PATH"

python3 - <<'PY'
import os
import sqlite3
import sys

root = os.environ.get("UPLOAD_PATH")
expected_documents = int(os.environ.get("DOCUMENT_COUNT", "0"))
expected_objects = int(os.environ.get("OBJECT_COUNT", "0"))
if not root:
    raise SystemExit("UPLOAD_PATH is not set")

db = os.path.join(root, "indexes", "agent_index.sqlite")
if not os.path.isdir(os.path.join(root, "companies")):
    raise SystemExit("missing companies directory")
if not os.path.isfile(db):
    raise SystemExit("missing agent_index.sqlite")

expected_indexes = {
    "idx_object_traceability_status",
    "idx_company_topic_ticker",
    "idx_company_topic_scope",
    "idx_company_topic_source_object",
    "idx_company_topic_source_topic",
}
with sqlite3.connect(db) as conn:
    documents = conn.execute("select count(*) from documents").fetchone()[0]
    objects = conn.execute("select count(*) from objects").fetchone()[0]
    company_topic_index = conn.execute("select count(*) from company_topic_index").fetchone()[0]
    present = {
        row[0]
        for row in conn.execute("select name from sqlite_master where type = ?", ("index",))
    }

missing = sorted(expected_indexes - present)
print(
    {
        "documents": documents,
        "objects": objects,
        "company_topic_index": company_topic_index,
        "missing_indexes": missing,
    }
)
if documents != expected_documents or objects != expected_objects or missing:
    raise SystemExit(1)
PY

if find "\$UPLOAD_PATH/indexes" -maxdepth 1 \( -name '*.sqlite-wal' -o -name '*.sqlite-shm' -o -name '*.bak*' \) | grep -q .; then
  echo "Unexpected WAL/SHM/backup files in uploaded release:" >&2
  find "\$UPLOAD_PATH/indexes" -maxdepth 1 \( -name '*.sqlite-wal' -o -name '*.sqlite-shm' -o -name '*.bak*' \) >&2
  exit 1
fi

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
docker compose --project-name "\$COMPOSE_PROJECT_NAME" --env-file .env restart web

for i in \$(seq 1 30); do
  if docker compose --project-name "\$COMPOSE_PROJECT_NAME" --env-file .env exec -T web curl -fsS http://localhost:3000/api/healthz >/dev/null 2>&1; then
    break
  fi
  if [ "\$i" -eq 30 ]; then
    echo "web health check did not pass after restart" >&2
    docker compose --project-name "\$COMPOSE_PROJECT_NAME" --env-file .env ps >&2
    exit 1
  fi
  sleep 2
done

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
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type = ?", ("index",))
    }
missing = sorted(expected - present)
if missing:
    raise SystemExit(f"Missing serving indexes after deployment: {missing}")
print(json.dumps({"serving_indexes": sorted(expected)}, ensure_ascii=False))
PY

if [ "\$PRUNE_REMOTE" = "1" ]; then
  find "\$REMOTE_DATA_ROOT/releases" -mindepth 1 -maxdepth 1 ! -name "\$RELEASE_ID" -exec rm -rf {} +
  rm -f "\$ARCHIVE_PATH" "\$SHA_PATH"
  if [ -e "\$OLD_BACKUP" ]; then
    rm -rf "\$OLD_BACKUP"
  fi
fi

echo "Activated ontology release \$RELEASE_ID with \$DOCUMENT_COUNT documents and \$OBJECT_COUNT objects."
df -h "\$REMOTE_DATA_ROOT" || df -h /
EOF
)

echo "Deploying archive on VM..."
gcloud compute ssh "$GCP_INSTANCE" --zone="$GCP_ZONE" --command="$REMOTE_DEPLOY"

echo "Checking public web health..."
curl -fsS https://krwontology.com/api/healthz >/dev/null
echo "Ontology data deployment complete."
