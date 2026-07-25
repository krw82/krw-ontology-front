"use client";

import Script from "next/script";
import { useState } from "react";
import type { EntitlementPlanKey } from "@/types/entitlement";

type PaidPlanKey = "standard" | "pro";

let checkoutRequestInFlight = false;

interface TossPaymentInstance {
  requestBillingAuth(options: {
    method: "CARD";
    successUrl: string;
    failUrl: string;
    customerEmail?: string;
    customerName?: string;
    windowTarget?: "self" | "iframe";
  }): Promise<void>;
}

interface TossPaymentsSdk {
  payment(options: { customerKey: string }): TossPaymentInstance;
}

declare global {
  interface Window {
    TossPayments?: (clientKey: string) => TossPaymentsSdk;
  }
}

interface CheckoutResponse {
  clientKey: string;
  customerKey: string;
  method: "CARD";
  successUrl: string;
  failUrl: string;
}

interface BillingPlanActionProps {
  planKey: EntitlementPlanKey;
  currentPlanKey: EntitlementPlanKey;
  monthlyPriceKrw: number;
  currentMonthlyPriceKrw: number;
  billingProviderReady: boolean;
  subscriptionPlanKey: PaidPlanKey | null;
  pendingPlanKey: PaidPlanKey | null;
  cancelAtPeriodEnd: boolean;
}

function isPaidPlanKey(planKey: EntitlementPlanKey): planKey is PaidPlanKey {
  return planKey === "standard" || planKey === "pro";
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

export default function BillingPlanAction({
  planKey,
  currentPlanKey,
  monthlyPriceKrw,
  currentMonthlyPriceKrw,
  billingProviderReady,
  subscriptionPlanKey,
  pendingPlanKey,
  cancelAtPeriodEnd,
}: BillingPlanActionProps) {
  const [scriptReady, setScriptReady] = useState(
    () => typeof window !== "undefined" && Boolean(window.TossPayments),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sdkLoadFailed, setSdkLoadFailed] = useState(false);

  const isCurrent = planKey === currentPlanKey;
  const currentIsPaid = subscriptionPlanKey !== null;
  const isPaidTarget = isPaidPlanKey(planKey);
  const isSubscriptionPlan = planKey === subscriptionPlanKey;
  const isPendingPlan = planKey === pendingPlanKey;
  const isDowngrade =
    currentIsPaid &&
    isPaidTarget &&
    !isSubscriptionPlan &&
    monthlyPriceKrw > 0 &&
    monthlyPriceKrw < currentMonthlyPriceKrw;
  const checkoutUnavailable =
    isPaidTarget && !isSubscriptionPlan && !billingProviderReady;
  const canSubscribe =
    isPaidTarget &&
    !currentIsPaid &&
    !isCurrent &&
    billingProviderReady;
  const canChangePlan =
    isPaidTarget &&
    currentIsPaid &&
    !isSubscriptionPlan &&
    !isPendingPlan &&
    !cancelAtPeriodEnd &&
    billingProviderReady;
  const canCancelPlanChange =
    isSubscriptionPlan && pendingPlanKey !== null && !cancelAtPeriodEnd;
  const canCancel =
    isSubscriptionPlan &&
    currentIsPaid &&
    pendingPlanKey === null &&
    !cancelAtPeriodEnd;

  async function startCheckout() {
    if (checkoutRequestInFlight) {
      setError("이미 다른 결제 요청을 처리 중입니다. 잠시만 기다려 주세요.");
      return;
    }
    if (!window.TossPayments) {
      setError(
        sdkLoadFailed
          ? "결제창을 불러오지 못했습니다. 네트워크를 확인한 뒤 다시 불러와 주세요."
          : "결제창 SDK를 아직 불러오지 못했습니다.",
      );
      return;
    }

    checkoutRequestInFlight = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/toss/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planKey }),
      });
      const payload = (await responsePayload(response)) as CheckoutResponse | unknown;
      if (!response.ok) {
        throw new Error(errorMessage(payload, "결제를 시작하지 못했습니다."));
      }
      const checkout = payload as CheckoutResponse;
      const tossPayments = window.TossPayments(checkout.clientKey);
      await tossPayments.payment({ customerKey: checkout.customerKey }).requestBillingAuth({
        method: checkout.method,
        successUrl: checkout.successUrl,
        failUrl: checkout.failUrl,
        windowTarget: "self",
      });
      checkoutRequestInFlight = false;
      setPending(false);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "결제를 시작하지 못했습니다.",
      );
      setPending(false);
      checkoutRequestInFlight = false;
    }
  }

  async function cancelSubscription() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/toss/cancel", {
        method: "POST",
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(errorMessage(payload, "해지 예약에 실패했습니다."));
      }
      window.location.href = "/settings/billing?billing=cancel_scheduled";
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "해지 예약에 실패했습니다.",
      );
      setPending(false);
    }
  }

  async function changePlan() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/toss/change-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planKey }),
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(errorMessage(payload, "플랜을 변경하지 못했습니다."));
      }
      const status =
        payload && typeof payload === "object"
          ? (payload as Record<string, unknown>).status
          : null;
      const result =
        status === "upgraded"
          ? "upgrade_success"
          : status === "plan_change_cancelled"
            ? "plan_change_cancelled"
            : "downgrade_scheduled";
      window.location.href = `/settings/billing?billing=${result}`;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "플랜을 변경하지 못했습니다.",
      );
      setPending(false);
    }
  }

  if (planKey === "free") {
    return (
      <p className="mt-sm text-[12px] font-bold leading-5 text-muted">
        {isCurrent ? "현재 기본 플랜" : "유료 플랜 해지 후 자동 전환"}
      </p>
    );
  }

  if (isPendingPlan) {
    return (
      <p className="mt-sm text-[12px] font-bold leading-5 text-muted">
        다음 월 갱신에 변경 예약됨
      </p>
    );
  }

  return (
    <div className="mt-sm">
      {canSubscribe && (
        <Script
          id="toss-payments-sdk"
          src="https://js.tosspayments.com/v2/standard"
          strategy="afterInteractive"
          onLoad={() => {
            setScriptReady(true);
            setSdkLoadFailed(false);
          }}
          onError={() => {
            setSdkLoadFailed(true);
            setError("결제창을 불러오지 못했습니다. 다시 불러와 주세요.");
          }}
        />
      )}
      <button
        type="button"
        onClick={
          canCancelPlanChange
            ? changePlan
            : canCancel
            ? cancelSubscription
            : canChangePlan
              ? changePlan
            : checkoutUnavailable
              ? undefined
              : startCheckout
        }
        disabled={
          pending ||
          checkoutUnavailable ||
          cancelAtPeriodEnd ||
          (!scriptReady && canSubscribe)
        }
        className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[8px] px-sm text-[13px] font-black leading-5 transition ${
          isCurrent
            ? "border border-hairline bg-canvas text-ink hover:bg-surface-soft"
            : "bg-primary text-on-primary hover:bg-primary-active"
        } disabled:cursor-not-allowed disabled:opacity-55`}
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
          {canCancelPlanChange ? "undo" : canCancel ? "event_busy" : "credit_card"}
        </span>
        {pending
          ? "처리 중"
          : canCancelPlanChange
            ? "변경 예약 취소"
            : canCancel
            ? "다음 결제 해지"
            : cancelAtPeriodEnd && isSubscriptionPlan
              ? "해지 예약됨"
              : canChangePlan
                ? isDowngrade
                  ? "다음 결제일부터 변경"
                  : "남은 기간 차액으로 업그레이드"
            : checkoutUnavailable
              ? "결제 준비 중"
              : scriptReady
                ? "구독하기"
                : sdkLoadFailed
                  ? "결제창 다시 불러오기"
                  : "결제창 준비 중"}
      </button>
      {sdkLoadFailed && canSubscribe && (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-xs text-[12px] font-bold leading-5 text-primary underline underline-offset-2"
        >
          결제창 다시 불러오기
        </button>
      )}
      {checkoutUnavailable && (
        <p className="mt-xs text-[12px] font-bold leading-5 text-muted">
          결제 연동 설정 후 구독할 수 있습니다.
        </p>
      )}
      {error && (
        <p className="mt-xs text-[12px] font-bold leading-5 text-error">
          {error}
        </p>
      )}
    </div>
  );
}
