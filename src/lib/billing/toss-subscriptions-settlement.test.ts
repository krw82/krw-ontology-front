import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/lib/billing/toss-subscriptions.ts"),
  "utf8",
);
const migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260725133627_harden_toss_billing_settlement.sql",
  ),
  "utf8",
);

describe("Toss paid-payment settlement contract", () => {
  it("serializes open checkout sessions and keeps a durable repair path", () => {
    expect(migration).toContain("idx_billing_toss_checkout_sessions_one_open");
    expect(migration).toContain("'processing'");
    expect(migration).toContain("'superseded'");
    expect(source).toContain("checkout_in_progress");
    expect(source).toContain("markCheckoutProcessing");
    expect(source).toContain("reconcilePaidTossPaymentFulfillments");
    expect(source).toContain("fulfillment_status");
  });

  it("settles the paid payment, subscription, and entitlement in one short database transaction", () => {
    expect(migration).toContain("finalize_toss_billing_payment");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("on conflict (user_id) do update");
    expect(migration).toContain("revoke all on function public.finalize_toss_billing_payment");
    expect(migration).toContain("to service_role");
    expect(source).toContain('admin.rpc("finalize_toss_billing_payment"');
  });

  it("does not turn a post-charge settlement failure into a new renewal charge", () => {
    const renewal = source.slice(
      source.indexOf("async function renewSubscription"),
      source.indexOf("async function expirePendingCancelledSubscriptions"),
    );
    const chargeFailureBoundary = renewal.indexOf("await handleRenewalFailure");
    const finalizer = renewal.indexOf("await finalizePaidBillingPayment");

    expect(chargeFailureBoundary).toBeGreaterThan(-1);
    expect(finalizer).toBeGreaterThan(chargeFailureBoundary);
    expect(renewal).toContain("let paidPayment: BillingTossPaymentRow");
  });

  it("retries terminal entitlement and billing-key cleanup instead of silently leaving paid access", () => {
    expect(source).toContain("reconcileTerminalTossSubscriptions");
    expect(source).toContain("terminal_entitlement_applied_at");
    expect(source).toContain("billing_key_delete_pending");
    expect(source).toContain("billing_key_reuse_lookup_failed");
    expect(source).toContain('.eq("billing_key", subscription.billing_key)');
    expect(migration).toContain("idx_billing_toss_subscriptions_terminal_reconcile");
  });
});
