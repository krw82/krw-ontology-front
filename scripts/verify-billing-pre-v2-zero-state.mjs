#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";

const supabaseUrl =
  process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    "Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function countRows(label, query) {
  const { count, error } = await query;
  if (error) {
    throw new Error(`${label} count failed: ${error.message}`);
  }
  return Number(count ?? 0);
}

const now = new Date().toISOString();
const [
  openSubscriptions,
  paymentRows,
  openUnexpiredCheckoutSessions,
  processingCheckoutSessions,
  paidEntitlements,
] = await Promise.all([
    countRows(
      "open subscriptions",
      supabase
        .from("billing_toss_subscriptions")
        .select("id", { count: "exact", head: true })
        .in("status", ["active", "past_due", "grace", "pending_cancel"]),
    ),
    countRows(
      "payment rows",
      supabase
        .from("billing_toss_payments")
        .select("id", { count: "exact", head: true }),
    ),
    countRows(
      "open unexpired checkout sessions",
      supabase
        .from("billing_toss_checkout_sessions")
        .select("id", { count: "exact", head: true })
        .in("status", ["created", "auth_succeeded"])
        .gt("expires_at", now),
    ),
    countRows(
      "processing checkout sessions",
      supabase
        .from("billing_toss_checkout_sessions")
        .select("id", { count: "exact", head: true })
        .eq("status", "processing"),
    ),
    countRows(
      "paid entitlements",
      supabase
        .from("user_entitlements")
        .select("user_id", { count: "exact", head: true })
        .in("plan_key", ["standard", "pro"])
        .in("status", ["active", "past_due", "grace"]),
    ),
]);

const counts = {
  openSubscriptions,
  paymentRows,
  openCheckoutSessions:
    openUnexpiredCheckoutSessions + processingCheckoutSessions,
  paidEntitlements,
};

if (Object.values(counts).some((count) => count !== 0)) {
  console.error("Billing pre-V2 zero-state gate failed:", counts);
  process.exit(1);
}

console.log("Billing pre-V2 zero-state gate passed:", counts);
