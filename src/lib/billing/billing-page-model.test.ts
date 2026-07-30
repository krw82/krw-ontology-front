import { describe, expect, it } from "vitest";
import {
  operationResultMessage,
  resolveBillingUiState,
} from "./billing-page-model";
import type {
  BillingTossOperationRow,
  BillingTossSubscriptionRow,
} from "@/types/database";

function subscription(
  status: BillingTossSubscriptionRow["status"],
): BillingTossSubscriptionRow {
  return { status } as BillingTossSubscriptionRow;
}

function operation(
  status: BillingTossOperationRow["status"],
): BillingTossOperationRow {
  return { status } as BillingTossOperationRow;
}

describe("Billing Flow V2 page state", () => {
  it("prioritizes payment reconciliation over an otherwise active subscription", () => {
    expect(
      resolveBillingUiState({
        subscription: subscription("active"),
        activeOperation: operation("payment_uncertain"),
      }),
    ).toBe("processing");
  });

  it("does not turn an unconfirmed quote into a fake processing state", () => {
    expect(
      resolveBillingUiState({
        subscription: subscription("active"),
        activeOperation: operation("prepared"),
      }),
    ).toBe("active");
  });

  it("keeps recovery and cancellation states distinct", () => {
    expect(
      resolveBillingUiState({
        subscription: subscription("grace"),
        activeOperation: null,
      }),
    ).toBe("grace");
    expect(
      resolveBillingUiState({
        subscription: subscription("pending_cancel"),
        activeOperation: null,
      }),
    ).toBe("pending_cancel");
  });

  it("uses durable operation status for the result notice", () => {
    expect(
      operationResultMessage({
        ...operation("succeeded"),
        kind: "upgrade",
      }),
    ).toEqual({
      tone: "success",
      message: "업그레이드가 완료되었습니다. 새 플랜을 바로 이용할 수 있습니다.",
    });
  });
});
