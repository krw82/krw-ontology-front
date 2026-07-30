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
const v2Migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260730071817_billing_flow_v2_operations.sql",
  ),
  "utf8",
);

describe("Toss paid-payment settlement contract", () => {
  it("serializes V2 operations and checkout sessions while keeping a durable repair path", () => {
    expect(migration).toContain("idx_billing_toss_checkout_sessions_one_open");
    expect(migration).toContain("'processing'");
    expect(migration).toContain("'superseded'");
    expect(v2Migration).toContain("idx_billing_toss_operations_one_open_user");
    expect(v2Migration).toContain("idx_billing_toss_checkout_sessions_one_open_operation");
    expect(source).toContain("billing_operation_in_progress");
    expect(source).toContain("createOrLoadTossOperationCheckout");
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
      source.indexOf("async function finalizeTossTerminalSubscriptions"),
    );
    const chargeFailureBoundary = renewal.indexOf("await handleRenewalFailure");
    const finalizer = renewal.indexOf("await finalizePaidBillingPayment");

    expect(chargeFailureBoundary).toBeGreaterThan(-1);
    expect(finalizer).toBeGreaterThan(chargeFailureBoundary);
    expect(renewal).toContain("let paidPayment: BillingTossPaymentRow");
  });

  it("atomically finalizes terminal access, then retries billing-key cleanup", () => {
    expect(source).toContain("reconcileTerminalTossSubscriptions");
    expect(source).toContain("finalizeTossTerminalSubscriptions");
    expect(source).toContain("billing_key_delete_pending");
    expect(source).toContain("billing_key_reuse_lookup_failed");
    expect(source).toContain('.eq("billing_key", subscription.billing_key)');
    expect(v2Migration).toContain("finalize_toss_terminal_subscriptions");
    expect(v2Migration).toContain("terminal_entitlement_applied_at = p_now");
    expect(v2Migration).toContain("provider_subscription_id = null");
  });

  it("keeps an ambiguous renewal charge recoverable and applies confirmed declines atomically", () => {
    expect(source).toContain("payment_result_uncertain");
    expect(source).toContain("releaseTossRenewalLease");
    expect(source).toContain('admin.rpc("apply_toss_renewal_failure"');
    expect(v2Migration).toContain("apply_toss_renewal_failure");
    expect(v2Migration).toContain("renewal_failure_parameters_missing");
  });
});
