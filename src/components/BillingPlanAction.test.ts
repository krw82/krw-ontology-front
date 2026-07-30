import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/BillingPlanAction.tsx"),
  "utf8",
);

describe("BillingPlanAction V2", () => {
  it("requires a server quote before confirmation and has no legacy direct routes", () => {
    expect(source).toContain('"/api/billing/toss/quote"');
    expect(source).toContain('"/api/billing/toss/confirm"');
    expect(source).toContain("오늘 청구");
    expect(source).toContain("결제 내용을 확인해 주세요.");
    expect(source).toContain("해지 예약 취소 · 업그레이드");
    expect(source).toContain("해지 예약 취소 · 변경 예약");
    expect(source).toContain("billingActionInFlight");
    expect(source).not.toContain('"/api/billing/toss/checkout"');
    expect(source).not.toContain('"/api/billing/toss/change-plan"');
    expect(source).not.toContain('"/api/billing/toss/cancel"');
    expect(source).not.toContain("결제창 준비 중");
  });
});
