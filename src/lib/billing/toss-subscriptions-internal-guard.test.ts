import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/lib/billing/toss-subscriptions.ts"),
  "utf8",
);

describe("internal entitlement billing guard", () => {
  it("blocks every paid activation path and preserves internal access on free transitions", () => {
    expect(source).toContain("internal_entitlement_billing_forbidden");
    expect(source).toContain("internal_entitlement_preservation_failed");
    expect(source).toMatch(
      /async function activatePaidEntitlement[\s\S]*?await assertBillingEntitlementIsMutable\(userId\)/,
    );
    expect(source).toMatch(
      /export async function startTossBillingCheckout[\s\S]*?await assertBillingEntitlementIsMutable\(userId\)[\s\S]*?loadOpenSubscription/,
    );
    expect(source).toMatch(
      /export async function completeTossBillingCheckout[\s\S]*?session\.status === "paid"[\s\S]*?await assertBillingEntitlementIsMutable\(userId\)[\s\S]*?issueOrLoadBillingKey/,
    );
    expect(source).toMatch(
      /async function renewSubscription[\s\S]*?await assertBillingEntitlementIsMutable\(subscription\.user_id\)[\s\S]*?chargeStoredPayment/,
    );
    expect(source).toMatch(
      /async function activateFreeEntitlement[\s\S]*?loadBillingEntitlementPlanKey\(userId\)[\s\S]*?\.eq\("plan_key", "internal"\)/,
    );
  });
});
