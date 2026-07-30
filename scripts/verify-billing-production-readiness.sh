#!/bin/sh
set -eu

usage() {
  cat <<'EOF'
Usage: scripts/verify-billing-production-readiness.sh [--skip-gcp] [--allow-test-toss-keys] [--require-v2-zero-state]

Verify the paid billing launch gate for production without printing secrets.

Environment:
  BASE_URL              Defaults to https://krwontology.com
  GCP_INSTANCE          Defaults to krw-onto-v1
  GCP_ZONE              Defaults to asia-northeast3-a
  REMOTE_FRONT_DIR      Defaults to /home/username/krw-ontology-front
  COMPOSE_PROJECT_NAME  Defaults to krw-ontology-front
  REMOTE_ENV_FILE       Defaults to .env

Use --require-v2-zero-state only for the one-time V2 cutover after V2 is active.
It requires BILLING_WRITES_ENABLED=0 and asserts that no paid/open billing
state exists from the active release's V2 verifier.
EOF
}

SKIP_GCP=0
ALLOW_TEST_TOSS_KEYS=0
REQUIRE_V2_ZERO_STATE=0

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
    --require-v2-zero-state)
      REQUIRE_V2_ZERO_STATE=1
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

quote_status=$(
  curl -sS -o "$TMP_BODY" -w "%{http_code}" \
    -X POST \
    -H "Origin: $BASE_URL" \
    -H "Content-Type: application/json" \
    --data '{"kind":"subscribe","targetPlanKey":"standard"}' \
    "$BASE_URL/api/billing/toss/quote" || true
)
if [ "$quote_status" != "401" ]; then
  echo "Unauthenticated Toss V2 quote should return 401, got $quote_status." >&2
  sed -n '1,20p' "$TMP_BODY" >&2
  exit 1
fi

legacy_checkout_status=$(
  curl -sS -o "$TMP_BODY" -w "%{http_code}" \
    -X POST \
    -H "Origin: $BASE_URL" \
    -H "Content-Type: application/json" \
    --data '{"planKey":"standard"}' \
    "$BASE_URL/api/billing/toss/checkout" || true
)
if [ "$legacy_checkout_status" != "404" ]; then
  echo "Legacy Toss checkout route must be removed, got $legacy_checkout_status." >&2
  sed -n '1,20p' "$TMP_BODY" >&2
  exit 1
fi

pricing_html=$(curl -fsS "$BASE_URL/ko/pricing")
assert_contains_any "$pricing_html" "Standard monthly price" "7,900" "7900"
assert_contains_any "$pricing_html" "Pro monthly price" "29,000" "29000"
# Credit limits are enforced from the active plan version and are intentionally
# not a hard-coded public-price-page promise. Keep this probe coupled to the
# visible paid-plan value proposition instead of stale numeric marketing copy.
assert_contains_any "$pricing_html" "Standard feature" "와이드 리서치" "Wide research"
assert_contains_any "$pricing_html" "Pro feature" "가장 넉넉한 분석량" "Highest research capacity"

echo "OK public billing endpoints."

if [ "$SKIP_GCP" = "1" ]; then
  echo "Skipping GCP env/container checks."
  exit 0
fi

require_command gcloud

cat > "$TMP_REMOTE" <<EOF
set -eu
cd '$REMOTE_FRONT_DIR'
REMOTE_FRONT_DIR='$REMOTE_FRONT_DIR'
ENV_FILE='$REMOTE_ENV_FILE'
COMPOSE_PROJECT_NAME='$COMPOSE_PROJECT_NAME'
ALLOW_TEST_TOSS_KEYS='$ALLOW_TEST_TOSS_KEYS'
REQUIRE_V2_ZERO_STATE='$REQUIRE_V2_ZERO_STATE'

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

mode_for_toss_key() {
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
      printf '%s' live
      ;;
    "\$test_prefix"*)
      if [ "\$ALLOW_TEST_TOSS_KEYS" = "1" ]; then
        printf '%s' test
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

billing_redirect_origin=\$(value_of AUTH_REDIRECT_ORIGIN)
if [ -z "\$billing_redirect_origin" ]; then
  billing_redirect_origin=\$(value_of NEXT_PUBLIC_SITE_URL)
fi
if [ -z "\$billing_redirect_origin" ]; then
  billing_redirect_origin=\$(value_of NEXT_PUBLIC_APP_URL)
fi
case "\$billing_redirect_origin" in
  https://0.0.0.0*|https://127.0.0.1*|https://localhost*|http://*|"")
    echo "A public HTTPS billing redirect origin is required; refusing local or insecure origin: \${billing_redirect_origin:-unset}" >&2
    exit 1
    ;;
  https://*)
    ;;
  *)
    echo "Billing redirect origin must be an absolute HTTPS URL." >&2
    exit 1
    ;;
esac
echo "OK public billing redirect origin."

mode=\$(value_of ANALYSIS_CREDIT_ENFORCEMENT_MODE)
if [ "\$mode" != "enforced" ]; then
  echo "ANALYSIS_CREDIT_ENFORCEMENT_MODE must be enforced, got: \${mode:-unset}" >&2
  exit 1
fi
echo "OK ANALYSIS_CREDIT_ENFORCEMENT_MODE=enforced"

CLIENT_MODE=\$(mode_for_toss_key TOSS_PAYMENTS_CLIENT_KEY live_ck_ test_ck_)
SECRET_MODE=\$(mode_for_toss_key TOSS_PAYMENTS_SECRET_KEY live_sk_ test_sk_)
if [ "\$CLIENT_MODE" != "\$SECRET_MODE" ]; then
  echo "Toss client and secret keys must use the same mode." >&2
  exit 1
fi
if [ "\$CLIENT_MODE" = "test" ] && [ "\$ALLOW_TEST_TOSS_KEYS" != "1" ]; then
  echo "Toss Payments keys must both be live keys for production readiness." >&2
  exit 1
fi
echo "OK matching Toss Payments key mode: \$CLIENT_MODE"

docker compose --project-name "\$COMPOSE_PROJECT_NAME" --env-file "\$ENV_FILE" ps web billing-worker

require_running_key_mode() {
  service="\$1"
  docker compose --project-name "\$COMPOSE_PROJECT_NAME" --env-file "\$ENV_FILE" \
    exec -T "\$service" node -e '
      const expected = process.argv[1];
      const ck = process.env.TOSS_PAYMENTS_CLIENT_KEY || "";
      const sk = process.env.TOSS_PAYMENTS_SECRET_KEY || "";
      const mode = ck.startsWith("live_ck_") && sk.startsWith("live_sk_")
        ? "live"
        : ck.startsWith("test_ck_") && sk.startsWith("test_sk_")
          ? "test"
          : null;
      if (mode !== expected || ck.includes("...") || sk.includes("...")) {
        throw new Error("Toss Payments key mode mismatch in running container");
      }
    ' "\$CLIENT_MODE"
}

require_running_key_mode web
require_running_key_mode billing-worker
echo "OK running web and billing-worker key mode."

require_running_billing_write_mode() {
  service="\$1"
  expected="\$2"
  docker compose --project-name "\$COMPOSE_PROJECT_NAME" --env-file "\$ENV_FILE" \
    exec -T "\$service" node -e '
      const expected = process.argv[1];
      if ((process.env.BILLING_WRITES_ENABLED || "") !== expected) {
        throw new Error("Billing write mode mismatch in running container");
      }
    ' "\$expected"
}

if [ "\$REQUIRE_V2_ZERO_STATE" = "1" ]; then
  writes_enabled=\$(value_of BILLING_WRITES_ENABLED)
  if [ "\$writes_enabled" != "0" ]; then
    echo "V2 zero-state cutover requires BILLING_WRITES_ENABLED=0 before activation, got: \${writes_enabled:-unset}" >&2
    exit 1
  fi
  require_running_billing_write_mode web 0
  require_running_billing_write_mode billing-worker 0
  echo "OK running web and billing-worker are read-only."
  ACTIVE_RELEASE_DIR="\$REMOTE_FRONT_DIR"
  if [ -d "\$REMOTE_FRONT_DIR/.simple-deploy/current" ]; then
    ACTIVE_RELEASE_DIR=\$(CDPATH= cd -- "\$REMOTE_FRONT_DIR/.simple-deploy/current" && pwd -P)
  fi
  ZERO_STATE_SCRIPT="\$ACTIVE_RELEASE_DIR/scripts/verify-billing-v2-zero-state.mjs"
  if [ ! -f "\$ZERO_STATE_SCRIPT" ]; then
    echo "Active release is missing the Billing Flow V2 zero-state verifier." >&2
    exit 1
  fi
  zero_state_supabase_url=\$(value_of SUPABASE_URL)
  if [ -z "\$zero_state_supabase_url" ]; then
    zero_state_supabase_url=\$(value_of NEXT_PUBLIC_SUPABASE_URL)
  fi
  zero_state_service_role_key=\$(value_of SUPABASE_SERVICE_ROLE_KEY)
  if [ -z "\$zero_state_supabase_url" ] || [ -z "\$zero_state_service_role_key" ]; then
    echo "Billing Flow V2 zero-state gate is missing Supabase runtime configuration." >&2
    exit 1
  fi
  SUPABASE_URL="\$zero_state_supabase_url" \\
    SUPABASE_SERVICE_ROLE_KEY="\$zero_state_service_role_key" \\
    node "\$ZERO_STATE_SCRIPT"
  echo "OK Billing Flow V2 zero-state gate."
fi
EOF

echo "Checking production GCP billing environment..."
gcloud compute ssh "$GCP_INSTANCE" \
  --zone="$GCP_ZONE" \
  --command="$(cat "$TMP_REMOTE")"

echo "Billing production readiness passed."
