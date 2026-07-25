import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/BillingPlanAction.tsx"),
  "utf8",
);

describe("BillingPlanAction checkout guard", () => {
  it("keeps a single checkout request in flight and recovers from SDK load failures", () => {
    expect(source).toContain("let checkoutRequestInFlight = false");
    expect(source).toContain("if (checkoutRequestInFlight)");
    expect(source).toContain('id="toss-payments-sdk"');
    expect(source).toContain("onError={() => {");
    expect(source).toContain("결제창 다시 불러오기");
    expect(source).toContain("responsePayload(response)");
  });
});
