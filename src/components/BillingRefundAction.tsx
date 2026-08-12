"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import BottomSheet from "@/components/ui/BottomSheet";
import type { RefundableTossPayment } from "@/lib/billing/toss-refunds";

function formatWon(value: number): string {
  return `${Math.max(0, value).toLocaleString("ko-KR")}원`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "결제일 확인 중";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function refundStatusLabel(status: RefundableTossPayment["refundStatus"]) {
  if (status === "succeeded") return "환불 완료";
  if (status === "processing" || status === "uncertain") {
    return "환불 결과 확인 중";
  }
  if (status === "failed") return "다시 시도 가능";
  return null;
}

function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const error = (payload as Record<string, unknown>).error;
  if (!error || typeof error !== "object") return fallback;
  const message = (error as Record<string, unknown>).message;
  return typeof message === "string" && message.trim() ? message : fallback;
}

async function responsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

export default function BillingRefundAction({
  payments,
}: {
  payments: RefundableTossPayment[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<RefundableTossPayment | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function requestRefund() {
    if (!selected || pending) return;
    setPending(true);
    setMessage(null);
    try {
      const response = await fetch("/api/billing/toss/refunds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentId: selected.id }),
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(errorMessage(payload, "자동 환불을 처리하지 못했습니다."));
      }
      const status =
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>).status
          : null;
      setSelected(null);
      setMessage(
        status === "succeeded"
          ? "결제 취소와 환불이 완료되었습니다. 구독 상태를 새로고침합니다."
          : "환불 결과를 확인하고 있습니다. 잠시 후 결제 내역을 다시 확인해 주세요.",
      );
      router.refresh();
    } catch (caught) {
      setMessage(
        caught instanceof Error ? caught.message : "자동 환불을 처리하지 못했습니다.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-8 rounded-[8px] border border-hairline bg-canvas">
      <div className="p-base sm:p-lg">
        <p className="font-mono text-[12px] font-black uppercase tracking-[0.16em] text-primary">
          AUTOMATIC REFUND
        </p>
        <h2 className="mt-1 text-[16px] font-black leading-6 text-ink">
          결제 후 7일 이내 자동 환불
        </h2>
        <p className="mt-1 text-[13px] font-medium leading-5 text-muted">
          해당 결제 후 유료 분석을 실행하지 않았다면, 여기서 결제를 취소하면
          원래 결제수단으로 자동 환불됩니다.
        </p>
        {message && (
          <p className="mt-sm rounded-[8px] bg-surface-soft px-sm py-sm text-[12px] font-bold leading-5 text-body">
            {message}
          </p>
        )}
      </div>

      {payments.length === 0 ? (
        <p className="border-t border-hairline px-base py-sm text-[13px] font-medium leading-5 text-muted sm:px-lg">
          현재 자동 환불 기간 안에 있는 결제가 없습니다.
        </p>
      ) : (
        <div className="border-t border-hairline">
          {payments.map((payment) => {
            const status = refundStatusLabel(payment.refundStatus);
            const isProcessing =
              payment.refundStatus === "processing" ||
              payment.refundStatus === "uncertain";
            const isCompleted = payment.refundStatus === "succeeded";
            return (
              <div
                key={payment.id}
                className="grid gap-sm border-b border-hairline px-base py-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-lg"
              >
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-extrabold leading-5 text-ink">
                    {payment.orderName}
                  </p>
                  <p className="mt-0.5 text-[12px] font-medium leading-5 text-muted">
                    {formatDate(payment.paidAt)} 결제 · {formatWon(payment.amountKrw)}
                    {" · "}자동 환불 마감 {formatDate(payment.refundableUntil)}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-sm sm:justify-end">
                  {status ? (
                    <span className="text-[12px] font-bold leading-5 text-muted">
                      {status}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      setMessage(null);
                      setSelected(payment);
                    }}
                    disabled={isProcessing || isCompleted || pending}
                    className="inline-flex min-h-10 items-center justify-center rounded-[8px] border border-hairline px-sm text-[12px] font-black text-ink hover:bg-surface-soft disabled:cursor-not-allowed disabled:opacity-55"
                  >
                    {payment.refundStatus === "failed" ? "다시 시도" : "즉시 환불"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <BottomSheet
        open={Boolean(selected)}
        onClose={() => {
          if (!pending) setSelected(null);
        }}
        ariaLabel="자동 환불 확인"
        presentation="responsive-dialog"
        contentClassName="p-base sm:p-lg"
        closeOnBackdrop={!pending}
        dragToDismiss={!pending}
      >
        {selected && (
          <div>
            <p className="font-mono text-[11px] font-black uppercase tracking-[0.14em] text-primary">
              CONFIRM REFUND
            </p>
            <h3 className="mt-2 text-[22px] font-black leading-7 text-ink">
              {formatWon(selected.amountKrw)}을 즉시 환불할까요?
            </h3>
            <p className="mt-2 text-[13px] font-semibold leading-5 text-body">
              환불 조건을 다시 확인한 뒤 Toss 결제를 자동 취소합니다. 처리 결과가
              불확실한 경우에는 중복 취소 없이 서버가 계속 확인합니다.
            </p>
            <div className="mt-base grid gap-xs sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setSelected(null)}
                disabled={pending}
                className="inline-flex min-h-11 items-center justify-center rounded-[8px] border border-hairline px-sm text-[13px] font-black text-ink hover:bg-surface-soft disabled:cursor-not-allowed disabled:opacity-55"
              >
                돌아가기
              </button>
              <button
                type="button"
                onClick={requestRefund}
                disabled={pending}
                className="inline-flex min-h-11 items-center justify-center rounded-[8px] bg-primary px-sm text-[13px] font-black text-on-primary hover:bg-primary-active disabled:cursor-not-allowed disabled:opacity-55"
              >
                {pending ? "환불 처리 중" : "환불 실행"}
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </section>
  );
}
