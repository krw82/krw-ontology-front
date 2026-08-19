import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/billing/billing-writes", () => ({
  areBillingWritesEnabled: vi.fn(() => true),
  BILLING_WRITES_DISABLED_MESSAGE: "결제 변경을 잠시 점검하고 있습니다.",
}));
vi.mock("@/lib/billing/toss", () => ({
  cancelTossPayment: vi.fn(),
  getTossPaymentByPaymentKey: vi.fn(),
  TossPaymentsError: class TossPaymentsError extends Error {
    readonly code: string;
    readonly status: number;

    constructor(code: string, status: number) {
      super(code);
      this.code = code;
      this.status = status;
    }
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  getSupabaseAdmin: vi.fn(),
}));

import { areBillingWritesEnabled } from "@/lib/billing/billing-writes";
import type { TossBillingFlowError } from "@/lib/billing/toss-billing-error";
import {
  cancelTossPayment,
  getTossPaymentByPaymentKey,
} from "@/lib/billing/toss";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  reconcileTossAutoRefunds,
  requestTossAutoRefund,
} from "./toss-refunds";

const preparedRefund = {
  refund_id: "11111111-1111-4111-8111-111111111111",
  provider_payment_key: "pay_123",
  amount_krw: 7900,
  idempotency_key: "22222222-2222-4222-8222-222222222222",
  refund_status: "processing" as const,
  should_call_provider: true,
};

describe("Toss automatic refunds", () => {
  const rpc = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(areBillingWritesEnabled).mockReturnValue(true);
    vi.mocked(getSupabaseAdmin).mockReturnValue({ rpc } as never);
  });

  it("cancels the exact payment once and finalizes its local refund state", async () => {
    rpc
      .mockResolvedValueOnce({ data: [preparedRefund], error: null })
      .mockResolvedValueOnce({
        data: [{ refund_id: preparedRefund.refund_id, already_applied: false }],
        error: null,
      });
    vi.mocked(cancelTossPayment).mockResolvedValue({
      paymentKey: "pay_123",
      status: "CANCELED",
      orderId: "order_123",
      orderName: "KRW Ontology Standard 월 구독",
      totalAmount: 7900,
      balanceAmount: 0,
      currency: "KRW",
    });

    await expect(
      requestTossAutoRefund({
        userId: "33333333-3333-4333-8333-333333333333",
        paymentId: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toEqual({
      refundId: preparedRefund.refund_id,
      status: "succeeded",
    });

    expect(cancelTossPayment).toHaveBeenCalledWith({
      paymentKey: "pay_123",
      cancelReason: "7일 이내 미사용 자동 환불",
      idempotencyKey: preparedRefund.idempotency_key,
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "prepare_toss_auto_refund", {
      p_user_id: "33333333-3333-4333-8333-333333333333",
      p_payment_id: "44444444-4444-4444-8444-444444444444",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "finalize_toss_auto_refund", {
      p_user_id: "33333333-3333-4333-8333-333333333333",
      p_refund_id: preparedRefund.refund_id,
      p_provider_payment_key: "pay_123",
      p_provider_status: "CANCELED",
      p_provider_response: expect.objectContaining({
        paymentKey: "pay_123",
        status: "CANCELED",
      }),
    });
  });

  it("returns an existing completed refund without calling Toss again", async () => {
    rpc.mockResolvedValueOnce({
      data: [{ ...preparedRefund, refund_status: "succeeded", should_call_provider: false }],
      error: null,
    });

    await expect(
      requestTossAutoRefund({
        userId: "33333333-3333-4333-8333-333333333333",
        paymentId: "44444444-4444-4444-8444-444444444444",
      }),
    ).resolves.toEqual({
      refundId: preparedRefund.refund_id,
      status: "succeeded",
    });

    expect(cancelTossPayment).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps an ambiguous Toss cancellation recoverable instead of treating it as failed", async () => {
    rpc
      .mockResolvedValueOnce({ data: [preparedRefund], error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    vi.mocked(cancelTossPayment).mockRejectedValue(new Error("network reset"));

    await expect(
      requestTossAutoRefund({
        userId: "33333333-3333-4333-8333-333333333333",
        paymentId: "44444444-4444-4444-8444-444444444444",
      }),
    ).rejects.toMatchObject({
      code: "auto_refund_checking",
      status: 202,
    } satisfies Partial<TossBillingFlowError>);

    expect(rpc).toHaveBeenLastCalledWith("mark_toss_auto_refund_recoverable", {
      p_user_id: "33333333-3333-4333-8333-333333333333",
      p_refund_id: preparedRefund.refund_id,
      p_status: "uncertain",
      p_failure_code: "refund_provider_error",
      p_failure_message: "결제 취소 결과를 확인하고 있습니다.",
    });
  });

  it("rejects paid usage from the database-owned eligibility check", async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "refund_paid_usage_exists" },
    });

    await expect(
      requestTossAutoRefund({
        userId: "33333333-3333-4333-8333-333333333333",
        paymentId: "44444444-4444-4444-8444-444444444444",
      }),
    ).rejects.toMatchObject({
      code: "auto_refund_paid_usage_exists",
      status: 409,
    } satisfies Partial<TossBillingFlowError>);
    expect(cancelTossPayment).not.toHaveBeenCalled();
  });

  it("repairs an interrupted cancellation from the worker without issuing a duplicate cancel", async () => {
    const refund = {
      id: preparedRefund.refund_id,
      user_id: "33333333-3333-4333-8333-333333333333",
      payment_id: "44444444-4444-4444-8444-444444444444",
      subscription_id: "55555555-5555-4555-8555-555555555555",
      amount_krw: 7900,
      status: "uncertain",
      idempotency_key: preparedRefund.idempotency_key,
      provider_cancel_transaction_key: null,
      provider_response: {},
      failure_code: "network",
      failure_message: "결제 취소 결과를 확인하고 있습니다.",
      provider_requested_at: null,
      completed_at: null,
      created_at: "2026-08-10T00:00:00.000Z",
      updated_at: "2026-08-10T00:00:00.000Z",
    };
    const refundQuery = {
      select: vi.fn(() => ({
        in: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(async () => ({ data: [refund], error: null })),
          })),
        })),
      })),
    };
    const paymentQuery = {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(async () => ({
              data: {
                id: refund.payment_id,
                user_id: refund.user_id,
                provider_payment_key: "pay_123",
              },
              error: null,
            })),
          })),
        })),
      })),
    };
    vi.mocked(getSupabaseAdmin).mockReturnValue({
      rpc,
      from: vi.fn((table: string) =>
        table === "billing_toss_refunds" ? refundQuery : paymentQuery,
      ),
    } as never);
    rpc.mockResolvedValueOnce({
      data: [{ refund_id: refund.id, already_applied: false }],
      error: null,
    });
    vi.mocked(getTossPaymentByPaymentKey).mockResolvedValue({
      paymentKey: "pay_123",
      status: "CANCELED",
      orderId: "order_123",
      orderName: "KRW Ontology Standard 월 구독",
      totalAmount: 7900,
      balanceAmount: 0,
      currency: "KRW",
    });

    await expect(reconcileTossAutoRefunds()).resolves.toBe(1);

    expect(cancelTossPayment).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("finalize_toss_auto_refund", {
      p_user_id: refund.user_id,
      p_refund_id: refund.id,
      p_provider_payment_key: "pay_123",
      p_provider_status: "CANCELED",
      p_provider_response: expect.objectContaining({ status: "CANCELED" }),
    });
  });
});
