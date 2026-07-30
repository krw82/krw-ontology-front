import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/lib/billing/toss-subscriptions.ts"),
  "utf8",
);
const v2Migration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260730071817_billing_flow_v2_operations.sql",
  ),
  "utf8",
);
const testResetMigration = readFileSync(
  resolve(
    process.cwd(),
    "supabase/migrations/20260730073500_reset_test_billing_state_for_v2.sql",
  ),
  "utf8",
);

describe("internal entitlement billing guard", () => {
  it("blocks V2 paid activation paths and keeps terminal cleanup scoped to its own subscription", () => {
    expect(source).toContain("internal_entitlement_billing_forbidden");
    expect(source).toMatch(
      /async function completeInitialTossBillingOperation[\s\S]*?await assertBillingEntitlementIsMutable\(operation\.user_id\)[\s\S]*?issueOrLoadBillingKey/,
    );
    expect(source).toMatch(
      /async function renewSubscription[\s\S]*?await assertBillingEntitlementIsMutable\(subscription\.user_id\)[\s\S]*?chargeStoredPayment/,
    );
    expect(source).toContain('"finalize_toss_terminal_subscriptions"');
    expect(v2Migration).toContain("finalize_toss_terminal_subscriptions");
    expect(v2Migration).toContain(
      "v_entitlement.provider_subscription_id = v_subscription.id::text",
    );
    expect(v2Migration).toContain("provider_subscription_id = null");
    expect(v2Migration).not.toContain(".upsert(");
  });

  it("removes direct legacy mutations and never exposes raw provider messages in an operation", () => {
    expect(source).not.toContain("startTossBillingCheckout");
    expect(source).not.toContain("completeTossBillingCheckout");
    expect(source).not.toContain("changeCurrentTossPlan");
    expect(source).not.toContain("cancelCurrentTossSubscription");
    expect(source).toMatch(
      /if \(error instanceof TossPaymentsError\) \{\s*return "결제 요청이 승인되지 않았습니다\./,
    );
    expect(source).toContain("payment_recovery_pending");
  });

  it("leaves non-reviewed data untouched outside the one-time test snapshot", () => {
    expect(testResetMigration).toContain("billing_v2_test_reset_skipped");
    expect(testResetMigration).toContain("v_customer_count <> 4");
    expect(testResetMigration).toContain("v_checkout_count <> 27");
    expect(testResetMigration).toContain("v_subscription_count <> 2");
    expect(testResetMigration).toContain("v_payment_count <> 3");
    expect(testResetMigration).toContain("v_paid_entitlement_count <> 2");
    expect(testResetMigration).toContain("v_open_checkout_count <> 0");
    expect(testResetMigration).toContain("return;");
    expect(testResetMigration).toContain(
      "delete from public.billing_toss_payments",
    );
    expect(testResetMigration).toContain(
      "delete from public.billing_toss_customers",
    );
    expect(testResetMigration).toContain("plan_key = 'free'");
  });
});
