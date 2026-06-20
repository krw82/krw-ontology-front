#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/verify-billing-production-readiness.sh [--skip-gcp] [--allow-test-toss-keys]

Verify the paid billing launch gate for production without printing secrets.

Environment:
  BASE_URL              Defaults to https://krwontology.com
  GCP_INSTANCE          Defaults to krw-onto-v1
  GCP_ZONE              Defaults to asia-northeast3-a
  REMOTE_FRONT_DIR      Defaults to /home/username/krw-ontology-front
  COMPOSE_PROJECT_NAME  Defaults to krw-ontology-front
  REMOTE_ENV_FILE       Defaults to .env
EOF
}

SKIP_GCP=0
ALLOW_TEST_TOSS_KEYS=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --skip-gcp)
      SKIP_GCP=1
      ;;
    --allow-test-toss-keys)
      ALLOW_TEST_TOSS_KEYS=1
      ;;
    *)
      usage >&2
      exit 1
      ;;
  esac
  shift
done

BASE_URL=${BASE_URL:-https://krwontology.com}
GCP_INSTANCE=${GCP_INSTANCE:-krw-onto-v1}
GCP_ZONE=${GCP_ZONE:-asia-northeast3-a}
REMOTE_FRONT_DIR=${REMOTE_FRONT_DIR:-/home/username/krw-ontology-front}
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-krw-ontology-front}
REMOTE_ENV_FILE=${REMOTE_ENV_FILE:-.env}
TMP_BODY=$(mktemp "${TMPDIR:-/tmp}/krw-billing-readiness.XXXXXX")
TMP_REMOTE=$(mktemp "${TMPDIR:-/tmp}/krw-billing-readiness-remote.XXXXXX")

cleanup() {
  rm -f "$TMP_BODY" "$TMP_REMOTE"
}
trap cleanup EXIT INT TERM

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

assert_contains_any() {
  haystack="$1"
  label="$2"
  shift 2
  for needle in "$@"; do
    case "$haystack" in
      *"$needle"*) return 0 ;;
    esac
  done
  echo "Production pricing page is missing expected text: $label" >&2
  exit 1
}

require_command curl

echo "Checking production billing endpoints at $BASE_URL..."
curl -fsS "$BASE_URL/api/healthz" >/dev/null

checkout_status=$(
  curl -sS -o "$TMP_BODY" -w "%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    --data '{"planKey":"standard"}' \
    "$BASE_URL/api/billing/toss/checkout" || true
)
if [ "$checkout_status" != "401" ]; then
  echo "Unauthenticated Toss checkout should return 401, got $checkout_status." >&2
  sed -n '1,20p' "$TMP_BODY" >&2
  exit 1
fi

pricing_html=$(curl -fsS "$BASE_URL/ko/pricing")
assert_contains_any "$pricing_html" "Standard monthly price" "7,900" "7900"
assert_contains_any "$pricing_html" "Pro monthly price" "29,000" "29000"
assert_contains_any "$pricing_html" "Standard weekly credits" "2,000" "2000"
assert_contains_any "$pricing_html" "Pro weekly credits" "6,000" "6000"

echo "OK public billing endpoints."

if [ "$SKIP_GCP" = "1" ]; then
  echo "Skipping GCP env/container checks."
  exit 0
fi

require_command gcloud

cat > "$TMP_REMOTE" <<EOF
set -eu
cd '$REMOTE_FRONT_DIR'
ENV_FILE='$REMOTE_ENV_FILE'
COMPOSE_PROJECT_NAME='$COMPOSE_PROJECT_NAME'
ALLOW_TEST_TOSS_KEYS='$ALLOW_TEST_TOSS_KEYS'

value_of() {
  key="\$1"
  awk -F= -v key="\$key" '
    \$0 !~ /^[[:space:]]*#/ && \$1 == key {
      sub(/^[^=]*=/, "")
      gsub(/^[[:space:]]+|[[:space:]]+$/, "")
      gsub(/^"|"$/, "")
      gsub(/^'\''|'\''$/, "")
      print
    }
  ' "\$ENV_FILE" | tail -n 1
}

require_live_or_allowed_test_key() {
  key="\$1"
  live_prefix="\$2"
  test_prefix="\$3"
  value=\$(value_of "\$key")
  if [ -z "\$value" ]; then
    echo "Missing \$key in \$ENV_FILE" >&2
    exit 1
  fi
  case "\$value" in
    *"..."*)
      echo "Placeholder value for \$key in \$ENV_FILE" >&2
      exit 1
      ;;
  esac
  case "\$value" in
    "\$live_prefix"*)
      echo "OK \$key=live key present"
      ;;
    "\$test_prefix"*)
      if [ "\$ALLOW_TEST_TOSS_KEYS" = "1" ]; then
        echo "Warning: \$key is a Toss test key because --allow-test-toss-keys was supplied." >&2
      else
        echo "\$key must be a Toss live key for production readiness." >&2
        exit 1
      fi
      ;;
    *)
      echo "\$key has an unexpected Toss Payments prefix." >&2
      exit 1
      ;;
  esac
}

test -f "\$ENV_FILE"

mode=\$(value_of ANALYSIS_CREDIT_ENFORCEMENT_MODE)
if [ "\$mode" != "enforced" ]; then
  echo "ANALYSIS_CREDIT_ENFORCEMENT_MODE must be enforced, got: \${mode:-unset}" >&2
  exit 1
fi
echo "OK ANALYSIS_CREDIT_ENFORCEMENT_MODE=enforced"

require_live_or_allowed_test_key TOSS_PAYMENTS_CLIENT_KEY live_ck_ test_ck_
require_live_or_allowed_test_key TOSS_PAYMENTS_SECRET_KEY live_sk_ test_sk_

docker compose --project-name "\$COMPOSE_PROJECT_NAME" --env-file "\$ENV_FILE" ps web billing-worker
EOF

echo "Checking production GCP billing environment..."
gcloud compute ssh "$GCP_INSTANCE" \
  --zone="$GCP_ZONE" \
  --command="$(cat "$TMP_REMOTE")"

echo "Billing production readiness passed."
