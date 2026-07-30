"use client";

import { useState } from "react";
import BottomSheet from "@/components/ui/BottomSheet";
import type { BillingUiState } from "@/lib/billing/billing-page-model";
import type {
  BillingTossOperationKind,
  BillingTossOperationStatus,
} from "@/types/database";
import type { EntitlementPlanKey } from "@/types/entitlement";

type PaidPlanKey = "standard" | "pro";

let billingActionInFlight = false;

interface TossPaymentInstance {
  requestBillingAuth(options: {
    method: "CARD";
    successUrl: string;
    failUrl: string;
    windowTarget?: "self" | "iframe";
  }): void;
}

interface TossPaymentsSdk {
  payment(options: { customerKey: string }): TossPaymentInstance;
}

declare global {
  interface Window {
    TossPayments?: (clientKey: string) => TossPaymentsSdk;
  }
}

interface BillingOperationQuote {
  operationId: string;
  kind: BillingTossOperationKind;
  fromPlanKey: PaidPlanKey | null;
  targetPlanKey: PaidPlanKey | null;
  chargedTodayKrw: number;
  nextChargeKrw: number;
  effectiveAt: string | null;
  nextBillingAt: string | null;
  expiresAt: string;
}

interface ConfirmResponse {
  operationId: string;
  status: string;
  checkout?: {
    clientKey: string;
    customerKey: string;
    method: "CARD";
    successUrl: string;
    failUrl: string;
  };
}

interface SubscriptionSnapshot {
  planKey: PaidPlanKey | null;
  pendingPlanKey: PaidPlanKey | null;
  currentPeriodEnd: string | null;
}

interface ActiveOperationSnapshot {
  id: string;
  status: BillingTossOperationStatus;
  targetPlanKey: PaidPlanKey | null;
  fromPlanKey: PaidPlanKey | null;
}

interface BillingPlanActionProps {
  planKey: EntitlementPlanKey;
  currentPlanKey: EntitlementPlanKey;
  monthlyPriceKrw: number;
  currentMonthlyPriceKrw: number;
  billingProviderReady: boolean;
  billingState: BillingUiState;
  subscription: SubscriptionSnapshot;
  processingMessage?: string | null;
  activeOperation: ActiveOperationSnapshot | null;
}

interface BillingAction {
  kind: BillingTossOperationKind;
  targetPlanKey?: PaidPlanKey;
  label: string;
  icon: string;
  requiresProvider: boolean;
}

function isPaidPlanKey(planKey: EntitlementPlanKey): planKey is PaidPlanKey {
  return planKey === "standard" || planKey === "pro";
}

function isPaidTarget(planKey: unknown): planKey is PaidPlanKey {
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

function formatWon(value: number): string {
  return `${Math.max(0, value).toLocaleString("ko-KR")}원`;
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
  }).format(date);
}

function actionForPlan({
  planKey,
  currentPlanKey,
  monthlyPriceKrw,
  currentMonthlyPriceKrw,
  billingState,
  subscription,
}: Omit<
  BillingPlanActionProps,
  "billingProviderReady" | "processingMessage" | "activeOperation"
>): BillingAction | null {
  if (!isPaidPlanKey(planKey)) return null;
  if (billingState === "unavailable" || billingState === "processing") return null;
  if (
    currentPlanKey === "internal" ||
    currentPlanKey === "beta" ||
    subscription.planKey === null
  ) {
    return currentPlanKey === "free"
      ? {
          kind: "subscribe",
          targetPlanKey: planKey,
          label: "금액 확인 후 구독",
          icon: "credit_card",
          requiresProvider: true,
        }
      : null;
  }

  const isSubscriptionPlan = planKey === subscription.planKey;
  const isPendingPlan = planKey === subscription.pendingPlanKey;

  if (billingState === "grace" || billingState === "past_due") {
    return isSubscriptionPlan
      ? {
          kind: "replace_payment_method",
          label: "결제 수단 변경",
          icon: "credit_card",
          requiresProvider: true,
        }
      : null;
  }

  if (billingState === "pending_cancel") {
    if (isSubscriptionPlan) {
      return {
        kind: "resume_subscription",
        label: "해지 예약 취소",
        icon: "undo",
        requiresProvider: false,
      };
    }
    if (monthlyPriceKrw > currentMonthlyPriceKrw) {
      return {
        kind: "upgrade",
        targetPlanKey: planKey,
        label: "해지 예약 취소 · 업그레이드",
        icon: "upgrade",
        requiresProvider: true,
      };
    }
    return {
      kind: "downgrade",
      targetPlanKey: planKey,
      label: "해지 예약 취소 · 변경 예약",
      icon: "calendar_month",
      requiresProvider: false,
    };
  }

  if (subscription.pendingPlanKey) {
    return isPendingPlan
      ? {
          kind: "cancel_plan_change",
          label: "변경 예약 취소",
          icon: "undo",
          requiresProvider: false,
        }
      : null;
  }

  if (isSubscriptionPlan) {
    return {
      kind: "cancel_subscription",
      label: "다음 결제 해지",
      icon: "event_busy",
      requiresProvider: false,
    };
  }

  if (monthlyPriceKrw > currentMonthlyPriceKrw) {
    return {
      kind: "upgrade",
      targetPlanKey: planKey,
      label: "차액 확인 후 업그레이드",
      icon: "upgrade",
      requiresProvider: true,
    };
  }
  return {
    kind: "downgrade",
    targetPlanKey: planKey,
    label: "다음 결제일부터 변경",
    icon: "calendar_month",
    requiresProvider: false,
  };
}

function quoteDescription(
  quote: BillingOperationQuote,
  currentPeriodEnd: string | null,
): string {
  const effectiveDate = formatDate(quote.effectiveAt);
  const periodEnd = formatDate(currentPeriodEnd);
  switch (quote.kind) {
    case "subscribe":
      return "자동결제 수단을 등록한 뒤 첫 달 결제가 진행됩니다.";
    case "upgrade":
      return quote.chargedTodayKrw > 0
        ? "남은 이용 기간에 해당하는 차액만 오늘 결제됩니다."
        : "남은 기간의 차액이 없어 플랜만 바로 변경됩니다.";
    case "downgrade":
      return `${effectiveDate ?? "다음 결제일"}부터 새 플랜과 금액이 적용됩니다.`;
    case "cancel_subscription":
      return `${periodEnd ?? "현재 결제 기간 종료일"}까지는 지금 플랜을 그대로 이용할 수 있습니다.`;
    case "resume_subscription":
      return "해지 예약을 취소하고 현재 플랜을 계속 유지합니다.";
    case "cancel_plan_change":
      return "예약된 플랜 변경을 취소하고 현재 플랜을 유지합니다.";
    case "replace_payment_method":
      return "새 카드를 등록한 뒤 미납 결제를 바로 다시 확인합니다.";
  }
}

function processingCopy(message?: string | null): string {
  return (
    message ??
    "결제 결과를 안전하게 확인하고 있습니다. 페이지를 닫아도 서버에서 계속 처리합니다."
  );
}

export default function BillingPlanAction(props: BillingPlanActionProps) {
  const {
    planKey,
    currentPlanKey,
    billingProviderReady,
    billingState,
    subscription,
    processingMessage,
    activeOperation,
  } = props;
  const [quote, setQuote] = useState<BillingOperationQuote | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const action = actionForPlan(props);
  const isCurrentPlan = planKey === currentPlanKey;

  async function requestBillingAuth(checkout: NonNullable<ConfirmResponse["checkout"]>) {
    if (!window.TossPayments) {
      throw new Error(
        "결제 도구를 불러오는 중입니다. 잠시 후 다시 확인해 주세요.",
      );
    }
    const tossPayments = window.TossPayments(checkout.clientKey);
    tossPayments.payment({ customerKey: checkout.customerKey }).requestBillingAuth({
      method: checkout.method,
      successUrl: checkout.successUrl,
      failUrl: checkout.failUrl,
      windowTarget: "self",
    });
  }

  async function requestQuote() {
    if (!action || pending || billingActionInFlight) return;
    billingActionInFlight = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/toss/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: action.kind,
          ...(action.targetPlanKey ? { targetPlanKey: action.targetPlanKey } : {}),
        }),
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(errorMessage(payload, "결제 금액을 준비하지 못했습니다."));
      }
      const nextQuote = payload as BillingOperationQuote;
      if (!nextQuote.operationId || !isPaidTarget(nextQuote.targetPlanKey ?? planKey)) {
        throw new Error("결제 금액 정보를 확인하지 못했습니다.");
      }
      setQuote(nextQuote);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "결제 금액을 준비하지 못했습니다.",
      );
    } finally {
      setPending(false);
      billingActionInFlight = false;
    }
  }

  async function confirmQuote() {
    if (!quote || pending || billingActionInFlight) return;
    billingActionInFlight = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/toss/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId: quote.operationId }),
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(errorMessage(payload, "결제 요청을 처리하지 못했습니다."));
      }
      const result = payload as ConfirmResponse;
      if (!result.operationId) {
        throw new Error("결제 작업 정보를 확인하지 못했습니다.");
      }
      if (!result.checkout) {
        window.location.assign(
          `/settings/billing?operation=${encodeURIComponent(result.operationId)}`,
        );
        return;
      }
      await requestBillingAuth(result.checkout);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "결제 요청을 처리하지 못했습니다.",
      );
      setPending(false);
      billingActionInFlight = false;
    }
  }

  async function continueAuthentication() {
    if (
      !activeOperation ||
      activeOperation.status !== "awaiting_auth" ||
      pending ||
      billingActionInFlight
    ) {
      return;
    }
    billingActionInFlight = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/billing/toss/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operationId: activeOperation.id }),
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(errorMessage(payload, "자동결제 인증을 이어가지 못했습니다."));
      }
      const result = payload as ConfirmResponse;
      if (!result.checkout) {
        window.location.assign(
          `/settings/billing?operation=${encodeURIComponent(activeOperation.id)}`,
        );
        return;
      }
      await requestBillingAuth(result.checkout);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "자동결제 인증을 이어가지 못했습니다.",
      );
      setPending(false);
      billingActionInFlight = false;
    }
  }

  async function cancelAuthentication() {
    if (!activeOperation || pending || billingActionInFlight) return;
    billingActionInFlight = true;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/billing/toss/operations/${encodeURIComponent(activeOperation.id)}/cancel`,
        { method: "POST" },
      );
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(errorMessage(payload, "결제 인증을 취소하지 못했습니다."));
      }
      window.location.assign(
        `/settings/billing?operation=${encodeURIComponent(activeOperation.id)}`,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "결제 인증을 취소하지 못했습니다.",
      );
      setPending(false);
      billingActionInFlight = false;
    }
  }

  if (planKey === "free") {
    return (
      <p className="mt-sm text-[12px] font-bold leading-5 text-muted">
        {isCurrentPlan ? "현재 기본 플랜" : "유료 플랜 해지 후 자동 전환"}
      </p>
    );
  }

  if (billingState === "unavailable") {
    return (
      <p className="mt-sm text-[12px] font-bold leading-5 text-muted">
        구독 상태를 확인한 뒤 변경할 수 있습니다.
      </p>
    );
  }

  if (billingState === "processing") {
    const activePlan = activeOperation?.targetPlanKey ?? activeOperation?.fromPlanKey;
    const canResumeAuthentication =
      activeOperation?.status === "awaiting_auth" && planKey === activePlan;
    return (
      <div className="mt-sm">
        <p className="text-[12px] font-bold leading-5 text-muted">
          {processingCopy(processingMessage)}
        </p>
        {canResumeAuthentication && (
          <div className="mt-xs grid gap-xs sm:grid-cols-2">
            <button
              type="button"
              onClick={continueAuthentication}
              disabled={pending || !billingProviderReady}
              className="inline-flex min-h-10 items-center justify-center rounded-[8px] bg-primary px-sm text-[12px] font-black text-on-primary hover:bg-primary-active disabled:cursor-not-allowed disabled:opacity-55"
            >
              인증 계속하기
            </button>
            <button
              type="button"
              onClick={cancelAuthentication}
              disabled={pending}
              className="inline-flex min-h-10 items-center justify-center rounded-[8px] border border-hairline px-sm text-[12px] font-black text-ink hover:bg-surface-soft disabled:cursor-not-allowed disabled:opacity-55"
            >
              인증 취소
            </button>
          </div>
        )}
        {error && (
          <p className="mt-xs text-[12px] font-bold leading-5 text-error">
            {error}
          </p>
        )}
      </div>
    );
  }

  if (!action) {
    const statusText =
      billingState === "pending_cancel" && isCurrentPlan
        ? "해지 예약됨"
        : subscription.pendingPlanKey === planKey
          ? "다음 결제일 변경 예약됨"
          : billingState === "grace" || billingState === "past_due"
            ? "결제 수단 변경 후 플랜을 조정할 수 있습니다."
            : isCurrentPlan
              ? "현재 플랜"
              : "현재 상태에서는 변경할 수 없습니다.";
    return (
      <p className="mt-sm text-[12px] font-bold leading-5 text-muted">
        {statusText}
      </p>
    );
  }

  const providerUnavailable = action.requiresProvider && !billingProviderReady;
  return (
    <div className="mt-sm">
      <button
        type="button"
        onClick={requestQuote}
        disabled={pending || providerUnavailable}
        className={`inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[8px] px-sm text-[13px] font-black leading-5 transition ${
          action.kind === "cancel_subscription" ||
          action.kind === "resume_subscription" ||
          action.kind === "cancel_plan_change"
            ? "border border-hairline bg-canvas text-ink hover:bg-surface-soft"
            : "bg-primary text-on-primary hover:bg-primary-active"
        } disabled:cursor-not-allowed disabled:opacity-55`}
      >
        <span aria-hidden="true" className="material-symbols-outlined text-[18px]">
          {action.icon}
        </span>
        {pending ? "금액 확인 중" : action.label}
      </button>
      {providerUnavailable && (
        <p className="mt-xs text-[12px] font-bold leading-5 text-muted">
          현재 결제 연동을 점검하고 있어 새 결제를 시작할 수 없습니다.
        </p>
      )}
      {error && (
        <p className="mt-xs text-[12px] font-bold leading-5 text-error">
          {error}
        </p>
      )}

      <BottomSheet
        open={Boolean(quote)}
        onClose={() => {
          if (!pending) setQuote(null);
        }}
        ariaLabel="결제 금액 확인"
        presentation="responsive-dialog"
        contentClassName="p-base sm:p-lg"
        closeOnBackdrop={!pending}
        dragToDismiss={!pending}
      >
        {quote && (
          <div>
            <p className="font-mono text-[11px] font-black uppercase tracking-[0.14em] text-primary">
              CONFIRM CHANGE
            </p>
            <h3 className="mt-2 text-[22px] font-black leading-7 text-ink">
              결제 내용을 확인해 주세요.
            </h3>
            <p className="mt-2 text-[13px] font-semibold leading-5 text-body">
              {quoteDescription(quote, subscription.currentPeriodEnd)}
            </p>
            <dl className="mt-base overflow-hidden rounded-[8px] border border-hairline">
              <div className="flex items-center justify-between gap-sm border-b border-hairline px-sm py-sm">
                <dt className="text-[13px] font-bold text-muted">오늘 청구</dt>
                <dd className="text-[16px] font-black text-ink">
                  {quote.chargedTodayKrw > 0
                    ? formatWon(quote.chargedTodayKrw)
                    : "청구 없음"}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-sm px-sm py-sm">
                <dt className="text-[13px] font-bold text-muted">
                  다음 결제 {formatDate(quote.nextBillingAt) ? `(${formatDate(quote.nextBillingAt)})` : ""}
                </dt>
                <dd className="text-[14px] font-black text-ink">
                  {quote.nextChargeKrw > 0
                    ? `월 ${formatWon(quote.nextChargeKrw)}`
                    : "없음"}
                </dd>
              </div>
            </dl>
            {billingState === "pending_cancel" &&
              (quote.kind === "upgrade" || quote.kind === "downgrade") && (
                <p className="mt-sm rounded-[8px] bg-primary-fixed px-sm py-sm text-[12px] font-bold leading-5 text-on-primary-fixed">
                  변경이 완료되면 기존 해지 예약은 취소됩니다. 완료하지 못하면 해지 예약은 그대로 유지됩니다.
                </p>
              )}
            {error && (
              <p className="mt-sm text-[12px] font-bold leading-5 text-error">
                {error}
              </p>
            )}
            <div className="mt-base grid gap-xs sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setQuote(null)}
                disabled={pending}
                className="inline-flex min-h-11 items-center justify-center rounded-[8px] border border-hairline px-sm text-[13px] font-black text-ink hover:bg-surface-soft disabled:cursor-not-allowed disabled:opacity-55"
              >
                돌아가기
              </button>
              <button
                type="button"
                onClick={confirmQuote}
                disabled={pending}
                className="inline-flex min-h-11 items-center justify-center rounded-[8px] bg-primary px-sm text-[13px] font-black text-on-primary hover:bg-primary-active disabled:cursor-not-allowed disabled:opacity-55"
              >
                {pending
                  ? "처리 중"
                  : quote.chargedTodayKrw > 0
                    ? `${formatWon(quote.chargedTodayKrw)} 확인`
                    : "변경 확인"}
              </button>
            </div>
          </div>
        )}
      </BottomSheet>
    </div>
  );
}
