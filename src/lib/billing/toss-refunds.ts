import "server-only";

import {
  areBillingWritesEnabled,
  BILLING_WRITES_DISABLED_MESSAGE,
} from "@/lib/billing/billing-writes";
import { TossBillingFlowError } from "@/lib/billing/toss-billing-error";
import {
  cancelTossPayment,
  getTossPaymentByPaymentKey,
  TossPaymentsError,
  type TossPaymentResponse,
} from "@/lib/billing/toss";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  BillingTossPaymentRow,
  BillingTossRefundRow,
  Json,
} from "@/types/database";

const AUTO_REFUND_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REFUND_RECONCILIATION_BATCH = 25;

export interface RefundableTossPayment {
  id: string;
  orderName: string;
  amountKrw: number;
  paymentKind: BillingTossPaymentRow["payment_kind"];
  paidAt: string;
  refundableUntil: string;
  refundStatus: BillingTossRefundRow["status"] | null;
}

export interface TossAutoRefundResult {
  refundId: string;
  status: "succeeded" | "processing";
}

interface PreparedTossAutoRefund {
  refund_id: string;
  provider_payment_key: string;
  amount_krw: number;
  idempotency_key: string;
  refund_status: BillingTossRefundRow["status"];
  should_call_provider: boolean;
}

function jsonObject(value: unknown): Json {
  if (value == null) return {};
  return JSON.parse(JSON.stringify(value)) as Json;
}

function assertBillingWritesAreEnabled() {
  if (areBillingWritesEnabled()) return;
  throw new TossBillingFlowError(
    "billing_writes_disabled",
    BILLING_WRITES_DISABLED_MESSAGE,
    503,
  );
}

function refundRpcError(
  error: { message?: string } | null,
): TossBillingFlowError {
  const message = error?.message ?? "";
  if (message.includes("refund_window_expired")) {
    return new TossBillingFlowError(
      "auto_refund_window_expired",
      "자동 환불은 결제 후 7일 이내에만 가능합니다.",
      409,
    );
  }
  if (message.includes("refund_paid_usage_exists")) {
    return new TossBillingFlowError(
      "auto_refund_paid_usage_exists",
      "이 결제 후 유료 분석을 실행해 자동 환불 대상이 아닙니다.",
      409,
    );
  }
  if (message.includes("refund_already_processing")) {
    return new TossBillingFlowError(
      "auto_refund_processing",
      "다른 환불 결과를 확인하고 있습니다. 잠시 후 다시 확인해 주세요.",
      409,
    );
  }
  if (
    message.includes("refund_not_latest_payment") ||
    message.includes("refund_subscription_state_changed")
  ) {
    return new TossBillingFlowError(
      "auto_refund_state_changed",
      "이후 결제 또는 플랜 변경이 있어 자동 환불할 수 없습니다.",
      409,
    );
  }
  if (
    message.includes("refund_payment_missing") ||
    message.includes("refund_payment_not_eligible") ||
    message.includes("refund_subscription_missing")
  ) {
    return new TossBillingFlowError(
      "auto_refund_not_eligible",
      "이 결제는 자동 환불 대상이 아닙니다.",
      409,
    );
  }
  if (message.includes("refund_pending_blocks_paid_usage")) {
    return new TossBillingFlowError(
      "auto_refund_processing",
      "환불 결과를 확인하고 있습니다. 잠시 후 다시 시도해 주세요.",
      409,
    );
  }
  return new TossBillingFlowError(
    "auto_refund_prepare_failed",
    "자동 환불 조건을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    500,
  );
}

function assertTossCancellation(
  response: TossPaymentResponse,
  prepared: PreparedTossAutoRefund,
) {
  if (response.paymentKey !== prepared.provider_payment_key) {
    throw new TossBillingFlowError(
      "auto_refund_payment_mismatch",
      "결제 취소 정보를 확인하지 못했습니다.",
      502,
    );
  }
  if (response.status !== "CANCELED") {
    throw new TossBillingFlowError(
      "auto_refund_not_cancelled",
      "결제 취소 결과를 확인하고 있습니다. 잠시 후 다시 확인해 주세요.",
      202,
    );
  }
  if (
    typeof response.balanceAmount === "number" &&
    response.balanceAmount !== 0
  ) {
    throw new TossBillingFlowError(
      "auto_refund_partial_cancellation",
      "결제가 전액 취소되지 않아 자동 환불을 완료하지 못했습니다.",
      502,
    );
  }
}

function tossErrorCode(error: unknown): string {
  return error instanceof TossPaymentsError ? error.code : "refund_provider_error";
}

function isUncertainTossFailure(error: unknown): boolean {
  if (error instanceof TossBillingFlowError) return false;
  return (
    !(error instanceof TossPaymentsError) ||
    error.status === 408 ||
    error.status === 429 ||
    error.status >= 500
  );
}

async function markTossAutoRefundRecoverable({
  userId,
  refundId,
  status,
  error,
}: {
  userId: string;
  refundId: string;
  status: "failed" | "uncertain";
  error: unknown;
}) {
  const message =
    status === "uncertain"
      ? "결제 취소 결과를 확인하고 있습니다."
      : "결제 취소를 완료하지 못했습니다.";
  const { error: rpcError } = await getSupabaseAdmin().rpc(
    "mark_toss_auto_refund_recoverable",
    {
      p_user_id: userId,
      p_refund_id: refundId,
      p_status: status,
      p_failure_code: tossErrorCode(error),
      p_failure_message: message,
    },
  );
  if (rpcError) {
    console.error("[billing] failed to record Toss refund recovery", {
      refundId,
      code: rpcError.code,
      message: rpcError.message,
    });
  }
}

async function finalizeTossAutoRefund({
  userId,
  prepared,
  response,
}: {
  userId: string;
  prepared: PreparedTossAutoRefund;
  response: TossPaymentResponse;
}): Promise<TossAutoRefundResult> {
  assertTossCancellation(response, prepared);
  const { data, error } = await getSupabaseAdmin().rpc(
    "finalize_toss_auto_refund",
    {
      p_user_id: userId,
      p_refund_id: prepared.refund_id,
      p_provider_payment_key: response.paymentKey,
      p_provider_status: response.status,
      p_provider_response: jsonObject(response),
    },
  );
  if (error || !data?.[0]?.refund_id) {
    await markTossAutoRefundRecoverable({
      userId,
      refundId: prepared.refund_id,
      status: "uncertain",
      error: error ?? new Error("refund finalizer returned no result"),
    });
    throw new TossBillingFlowError(
      "auto_refund_finalization_pending",
      "결제 취소는 확인됐고 구독 상태를 반영하고 있습니다. 잠시 후 다시 확인해 주세요.",
      202,
    );
  }
  return { refundId: data[0].refund_id, status: "succeeded" };
}

async function prepareTossAutoRefund({
  userId,
  paymentId,
}: {
  userId: string;
  paymentId: string;
}): Promise<PreparedTossAutoRefund> {
  const { data, error } = await getSupabaseAdmin().rpc(
    "prepare_toss_auto_refund",
    {
      p_user_id: userId,
      p_payment_id: paymentId,
    },
  );
  if (error || !data?.[0]) throw refundRpcError(error);
  return data[0];
}

export async function requestTossAutoRefund({
  userId,
  paymentId,
}: {
  userId: string;
  paymentId: string;
}): Promise<TossAutoRefundResult> {
  assertBillingWritesAreEnabled();
  const prepared = await prepareTossAutoRefund({ userId, paymentId });

  if (prepared.refund_status === "succeeded") {
    return { refundId: prepared.refund_id, status: "succeeded" };
  }
  if (prepared.refund_status === "uncertain") {
    return { refundId: prepared.refund_id, status: "processing" };
  }
  if (!prepared.should_call_provider) {
    return { refundId: prepared.refund_id, status: "processing" };
  }

  try {
    const response = await cancelTossPayment({
      paymentKey: prepared.provider_payment_key,
      cancelReason: "7일 이내 미사용 자동 환불",
      idempotencyKey: prepared.idempotency_key,
    });
    return await finalizeTossAutoRefund({ userId, prepared, response });
  } catch (error) {
    if (error instanceof TossBillingFlowError && error.status === 202) {
      await markTossAutoRefundRecoverable({
        userId,
        refundId: prepared.refund_id,
        status: "uncertain",
        error,
      });
      throw error;
    }
    if (isUncertainTossFailure(error)) {
      await markTossAutoRefundRecoverable({
        userId,
        refundId: prepared.refund_id,
        status: "uncertain",
        error,
      });
      throw new TossBillingFlowError(
        "auto_refund_checking",
        "결제 취소 결과를 확인하고 있습니다. 잠시 후 다시 확인해 주세요.",
        202,
      );
    }
    await markTossAutoRefundRecoverable({
      userId,
      refundId: prepared.refund_id,
      status: "failed",
      error,
    });
    throw new TossBillingFlowError(
      "auto_refund_provider_rejected",
      "결제 취소를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      502,
    );
  }
}

async function loadPaymentForRefund(
  refund: BillingTossRefundRow,
): Promise<BillingTossPaymentRow | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("billing_toss_payments")
    .select("*")
    .eq("id", refund.payment_id)
    .eq("user_id", refund.user_id)
    .maybeSingle<BillingTossPaymentRow>();
  if (error) {
    throw new TossBillingFlowError(
      "auto_refund_payment_lookup_failed",
      "환불 결제 정보를 확인하지 못했습니다.",
      500,
    );
  }
  return data ?? null;
}

/**
 * Worker-safe repair for a browser or network interruption after a refund has
 * been reserved. Every provider retry reuses the stored Toss idempotency key.
 */
export async function reconcileTossAutoRefunds(
  limit = MAX_REFUND_RECONCILIATION_BATCH,
): Promise<number> {
  if (!areBillingWritesEnabled()) return 0;
  const safeLimit = Math.max(1, Math.min(limit, MAX_REFUND_RECONCILIATION_BATCH));
  const { data, error } = await getSupabaseAdmin()
    .from("billing_toss_refunds")
    .select("*")
    .in("status", ["processing", "uncertain"])
    .order("updated_at", { ascending: true })
    .limit(safeLimit);
  if (error) {
    throw new TossBillingFlowError(
      "auto_refund_reconciliation_lookup_failed",
      "환불 처리 상태를 확인하지 못했습니다.",
      500,
    );
  }

  let reconciled = 0;
  for (const refund of (data ?? []) as BillingTossRefundRow[]) {
    try {
      const payment = await loadPaymentForRefund(refund);
      if (!payment?.provider_payment_key) continue;
      const prepared: PreparedTossAutoRefund = {
        refund_id: refund.id,
        provider_payment_key: payment.provider_payment_key,
        amount_krw: refund.amount_krw,
        idempotency_key: refund.idempotency_key,
        refund_status: refund.status,
        should_call_provider: true,
      };
      const observed = await getTossPaymentByPaymentKey(payment.provider_payment_key);
      const response =
        observed.status === "CANCELED"
          ? observed
          : await cancelTossPayment({
              paymentKey: payment.provider_payment_key,
              cancelReason: "7일 이내 미사용 자동 환불",
              idempotencyKey: refund.idempotency_key,
            });
      await finalizeTossAutoRefund({
        userId: refund.user_id,
        prepared,
        response,
      });
      reconciled += 1;
    } catch (error) {
      await markTossAutoRefundRecoverable({
        userId: refund.user_id,
        refundId: refund.id,
        status: isUncertainTossFailure(error) ? "uncertain" : "failed",
        error,
      });
    }
  }
  return reconciled;
}

export async function listRecentTossRefundablePayments(
  userId: string,
): Promise<RefundableTossPayment[]> {
  const refundableSince = new Date(Date.now() - AUTO_REFUND_WINDOW_MS).toISOString();
  const admin = getSupabaseAdmin();
  const [paymentsResult, refundsResult] = await Promise.all([
    admin
      .from("billing_toss_payments")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "paid")
      .gte("paid_at", refundableSince)
      .order("paid_at", { ascending: false })
      .limit(10),
    admin
      .from("billing_toss_refunds")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (paymentsResult.error || refundsResult.error) {
    console.error("[billing] failed to load refundable payments", {
      paymentsError: paymentsResult.error?.message,
      refundsError: refundsResult.error?.message,
    });
    return [];
  }
  const refundStatusByPayment = new Map(
    ((refundsResult.data ?? []) as BillingTossRefundRow[]).map((refund) => [
      refund.payment_id,
      refund.status,
    ]),
  );
  return ((paymentsResult.data ?? []) as BillingTossPaymentRow[])
    .filter((payment) => Boolean(payment.paid_at))
    .map((payment) => ({
      id: payment.id,
      orderName: payment.order_name,
      amountKrw: payment.amount_krw,
      paymentKind: payment.payment_kind,
      paidAt: payment.paid_at as string,
      refundableUntil: new Date(
        new Date(payment.paid_at as string).getTime() + AUTO_REFUND_WINDOW_MS,
      ).toISOString(),
      refundStatus: refundStatusByPayment.get(payment.id) ?? null,
    }));
}
