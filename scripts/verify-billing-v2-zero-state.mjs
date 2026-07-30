#!/usr/bin/env node
const supabaseUrl =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

const restBaseUrl = supabaseUrl.replace(/\/+$/, "");

async function countRows(label, table, filters = {}, select = "id") {
  const url = new URL(`/rest/v1/${table}`, `${restBaseUrl}/`);
  url.searchParams.set("select", select);
  url.searchParams.set("limit", "1");
  for (const [key, value] of Object.entries(filters)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Prefer: "count=exact",
      Range: "0-0",
    },
  });

  if (!response.ok) {
    throw new Error(`${label} count failed: HTTP ${response.status}`);
  }

  const contentRange = response.headers.get("content-range");
  const total = contentRange?.match(/\/(\d+)\s*$/)?.[1];
  if (total) return Number(total);

  // Supabase/PostgREST normally returns Content-Range with count=exact. This
  // fallback still fails the zero-state gate when at least one row exists.
  const rows = await response.json();
  return Array.isArray(rows) ? rows.length : 0;
}

const now = new Date().toISOString();
const [
  openSubscriptions,
  paymentRows,
  openUnexpiredCheckoutSessions,
  processingCheckoutSessions,
  openOperations,
  paidEntitlements,
] = await Promise.all([
  countRows(
    "open subscriptions",
    "billing_toss_subscriptions",
    { status: "in.(active,past_due,grace,pending_cancel)" },
  ),
  countRows(
    "payment rows",
    "billing_toss_payments",
  ),
  countRows(
    "open unexpired checkout sessions",
    "billing_toss_checkout_sessions",
    {
      status: "in.(created,auth_succeeded)",
      expires_at: `gt.${now}`,
    },
  ),
  countRows(
    "processing checkout sessions",
    "billing_toss_checkout_sessions",
    { status: "eq.processing" },
  ),
  countRows(
    "open billing operations",
    "billing_toss_operations",
    {
      status:
        "in.(prepared,awaiting_auth,processing,payment_uncertain,paid_pending_apply)",
    },
  ),
  countRows(
    "paid entitlements",
    "user_entitlements",
    {
      plan_key: "in.(standard,pro)",
      status: "in.(active,past_due,grace)",
    },
    "user_id",
  ),
]);

const counts = {
  openSubscriptions,
  paymentRows,
  openCheckoutSessions:
    openUnexpiredCheckoutSessions + processingCheckoutSessions,
  openOperations,
  paidEntitlements,
};

if (Object.values(counts).some((count) => count !== 0)) {
  console.error("Billing Flow V2 zero-state gate failed:", counts);
  process.exit(1);
}

console.log("Billing Flow V2 zero-state gate passed:", counts);
