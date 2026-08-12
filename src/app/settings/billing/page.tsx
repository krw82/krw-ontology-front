import { redirect } from "next/navigation";
import Script from "next/script";
import BillingPlanAction from "@/components/BillingPlanAction";
import BillingRefundAction from "@/components/BillingRefundAction";
import { getAuthUser } from "@/lib/auth";
import {
  getBillingPageModel,
  operationResultMessage,
} from "@/lib/billing/billing-page-model";
import { getEntitlementStatus } from "@/lib/billing/entitlement";
import { MENU_FEATURE_DEFINITIONS } from "@/lib/billing/feature-access";
import { listPublicBillingPlansFromStore } from "@/lib/billing/plan-store";
import { isTossPaymentsCheckoutConfigured } from "@/lib/billing/toss";
import { listRecentTossRefundablePayments } from "@/lib/billing/toss-refunds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BillingSettingsPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function billingNotice(
  searchParams: Awaited<BillingSettingsPageProps["searchParams"]>,
): { tone: "success" | "error"; message: string } | null {
  const featureKey = firstParam(searchParams.feature);
  const lockedFeature = MENU_FEATURE_DEFINITIONS.find(
    (feature) => feature.key === featureKey,
  );
  if (lockedFeature) {
    const requiredPlan =
      lockedFeature.required_plan.charAt(0).toUpperCase() +
      lockedFeature.required_plan.slice(1);
    return {
      tone: "error",
      message: `${lockedFeature.label}은 현재 플랜에서 사용할 수 없습니다. ${requiredPlan} 플랜부터 이용할 수 있습니다.`,
    };
  }

  return null;
}

function monthlyPriceLabel(value: number): string {
  return value === 0 ? "무료" : `월 ${value.toLocaleString()}원`;
}

function planFeatureLabel(planKey: string): string {
  if (planKey === "free") return "모든 리서치 모드";
  if (planKey === "lite") return "더 넉넉한 분석량";
  if (planKey === "standard") return "확장 분석량";
  if (planKey === "pro") return "리서치 노트북 + 최고 분석량";
  return "기능 기반";
}

function planDescription(planKey: string): string {
  if (planKey === "free") {
    return "모든 리서치 모드와 공시 근거 확인을 시작하고 관심 기업 3개를 저장할 수 있습니다.";
  }
  if (planKey === "lite") {
    return "모든 리서치 모드를 유지하면서 더 넉넉한 주간 분석량을 제공합니다.";
  }
  if (planKey === "standard") {
    return "정기적인 기업 리서치를 위한 확장 분석량을 제공합니다.";
  }
  if (planKey === "pro") {
    return "기업별 가설, 질문, 메모와 다음 확인 조건을 리서치 노트북으로 관리합니다.";
  }
  return "기능별로 리서치 메뉴를 확장할 수 있는 플랜입니다.";
}

function billingDateLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export default async function BillingSettingsPage({
  searchParams,
}: BillingSettingsPageProps) {
  const resolvedSearchParams = await searchParams;
  const requestedOperationId = firstParam(resolvedSearchParams.operation);
  const user = await getAuthUser().catch(() => null);
  if (!user) {
    const next = new URL("/settings/billing", "https://billing.local");
    if (requestedOperationId) {
      next.searchParams.set("operation", requestedOperationId);
    }
    redirect(`/login?next=${encodeURIComponent(`${next.pathname}${next.search}`)}`);
  }

  const [entitlement, plans, billingModel, refundablePayments] = await Promise.all([
    getEntitlementStatus(user.id, user.email ?? null),
    listPublicBillingPlansFromStore(),
    getBillingPageModel({
      userId: user.id,
      requestedOperationId,
    }),
    listRecentTossRefundablePayments(user.id),
  ]);
  // Billing mutations and card state must use the single server-owned billing
  // model. Entitlement is still used below for feature presentation, but it
  // must not independently decide which subscription action is available.
  const billingCurrentPlanKey =
    billingModel.subscription?.plan_key ??
    (billingModel.state === "free" ? "free" : entitlement.plan.key);
  const currentPlan =
    plans.find((plan) => plan.key === billingCurrentPlanKey) ??
    plans.find((plan) => plan.key === entitlement.plan.key) ??
    plans.find((plan) => plan.key === "free");
  const billingProviderReady = isTossPaymentsCheckoutConfigured();
  const notice =
    billingNotice(resolvedSearchParams) ??
    operationResultMessage(billingModel.requestedOperation) ??
    (billingModel.unavailableReason
      ? { tone: "error" as const, message: billingModel.unavailableReason }
      : null);
  const processingMessage = billingModel.activeOperation
    ? billingModel.activeOperation.status === "payment_uncertain"
      ? "결제 결과를 확인하고 있습니다. 같은 결제가 다시 청구되지 않도록 기존 주문만 재조회합니다."
      : billingModel.activeOperation.status === "paid_pending_apply"
        ? "결제는 승인됐고 구독 반영을 다시 확인하고 있습니다."
        : billingModel.activeOperation.status === "awaiting_auth"
          ? "자동결제 인증을 기다리고 있습니다. Toss 창을 완료하면 이 화면에 반영됩니다."
          : "결제 작업을 안전하게 처리하고 있습니다. 페이지를 닫아도 서버에서 계속 확인합니다."
    : null;
  const subscriptionDate = billingDateLabel(
    billingModel.subscription?.current_period_end,
  );
  const currentPlanPrice = currentPlan?.monthlyPriceKrw ?? 0;
  const currentPlanDetail =
    billingModel.state === "pending_cancel"
      ? `${subscriptionDate ?? "현재 결제 기간 종료일"}까지 이용할 수 있으며, 이후 Free로 전환됩니다.`
      : billingModel.state === "grace" || billingModel.state === "past_due"
        ? "결제 수단을 변경하면 미납 결제를 같은 주문 기준으로 다시 확인합니다."
        : billingModel.state === "processing"
          ? processingMessage
          : billingModel.state === "unavailable"
            ? billingModel.unavailableReason
            : billingModel.subscription && subscriptionDate
              ? `${subscriptionDate}에 월 ${currentPlanPrice.toLocaleString("ko-KR")}원 결제 예정`
              : "언제든 플랜과 금액을 확인한 뒤 구독을 시작할 수 있습니다.";
  return (
    <div className="bg-canvas">
      {billingProviderReady && (
        <Script
          id="toss-payments-sdk"
          src="https://js.tosspayments.com/v2/standard"
          strategy="afterInteractive"
        />
      )}
      <main
        id="main-content"
        className="px-base pb-xl pt-xl sm:px-md md:px-xl md:pb-[96px] md:pt-[72px]"
      >
        <div className="mx-auto w-full max-w-6xl">
          <header className="mx-auto max-w-3xl text-center">
            <p className="font-mono text-[12px] font-black uppercase tracking-[0.18em] text-primary">
              PLAN & FEATURES
            </p>
            <h1 className="mt-4 text-balance text-[36px] font-black leading-[1.04] tracking-normal text-ink sm:text-[52px]">
              내 리서치에 맞는 플랜을 선택하세요.
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-[16px] font-medium leading-7 text-body sm:text-[18px]">
              모든 플랜에서 리서치를 시작하고, 분석량은 필요에 따라 늘릴 수
              있습니다. Pro에서는 리서치 노트북으로 판단을 계속 관리합니다.
            </p>
            <p className="mx-auto mt-3 max-w-2xl text-[12px] font-medium leading-5 text-muted">
              공시와 시장 자료를 확인하는 리서치 소프트웨어입니다. 투자자문이나
              매수·매도 추천을 제공하지 않으며, 투자 판단은 이용자에게 있습니다.
            </p>
          </header>

          {notice && (
            <section
              className={`mt-8 rounded-[8px] border p-base text-[13px] font-bold leading-5 ${
                notice.tone === "success"
                  ? "border-primary-container bg-primary-fixed text-on-primary-fixed"
                  : notice.tone === "info"
                    ? "border-hairline bg-surface-soft text-body"
                    : "border-error bg-error-container text-on-error-container"
              }`}
            >
              {notice.message}
            </section>
          )}

          <section className="mt-8">
            <div className="rounded-[8px] border border-hairline bg-canvas p-base">
              <p className="font-mono text-[11px] font-black uppercase tracking-[0.14em] text-muted">
                CURRENT PLAN
              </p>
              <p className="mt-2 text-[22px] font-black leading-7 text-ink">
                {currentPlan?.label ?? entitlement.plan.label}
              </p>
              <p className="mt-1 text-[13px] font-semibold leading-5 text-muted">
                {billingModel.state === "pending_cancel"
                  ? "해지 예약됨"
                  : billingModel.state === "grace"
                    ? "결제 유예 · 결제 수단 변경 필요"
                    : billingModel.state === "past_due"
                      ? "결제 확인 필요"
                      : billingModel.state === "processing"
                        ? "결제 처리 중"
                        : billingModel.state === "unavailable"
                          ? "구독 상태 확인 중"
                          : entitlement.plan.status_label}
              </p>
              <p className="mt-3 text-[14px] font-semibold leading-6 text-body">
                {planDescription(currentPlan?.key ?? entitlement.plan.key)}
              </p>
              {currentPlanDetail && (
                <p className="mt-2 text-[12px] font-bold leading-5 text-muted">
                  {currentPlanDetail}
                </p>
              )}
            </div>
          </section>

          <section className="mt-8">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="font-mono text-[12px] font-black uppercase tracking-[0.16em] text-primary">
                  PLANS
                </p>
                <h2 className="mt-2 text-[28px] font-black leading-8 text-ink">
                  기능별 플랜
                </h2>
              </div>
            </div>
            <div className="mt-base grid gap-sm md:grid-cols-2 xl:grid-cols-4">
              {plans.map((plan) => {
                const isCurrent = plan.key === billingCurrentPlanKey;
                const isFeatured = plan.key === "standard";

                return (
                  <div
                    key={plan.key}
                    className={`relative flex min-h-[360px] flex-col rounded-[8px] border p-base sm:p-lg ${
                      isFeatured
                        ? "border-primary bg-primary-fixed/35 shadow-[0_18px_48px_rgba(0,82,255,0.10)]"
                        : isCurrent
                          ? "border-primary/45 bg-canvas"
                          : "border-hairline bg-canvas"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-sm">
                      <div>
                        <p className="text-[22px] font-black leading-7 text-ink">
                          {plan.label}
                        </p>
                        <p className="mt-1 text-[12px] font-bold leading-4 text-muted">
                          {plan.statusLabel}
                        </p>
                      </div>
                      {isCurrent && (
                        <span className="rounded-full bg-primary-container px-xs py-xxs text-[11px] font-bold leading-4 text-on-primary">
                          현재
                        </span>
                      )}
                    </div>
                    <p className="mt-lg text-[14px] font-extrabold leading-5 text-primary">
                      {monthlyPriceLabel(plan.monthlyPriceKrw)}
                    </p>
                    <p className="mt-xs text-[34px] font-black leading-9 text-ink">
                      {planFeatureLabel(plan.key)}
                    </p>
                    <p className="mt-sm min-h-[40px] text-[13px] font-semibold leading-5 text-body">
                      {planDescription(plan.key)}
                    </p>
                    <div className="mt-auto pt-base">
                      <BillingPlanAction
                        planKey={plan.key}
                        currentPlanKey={billingCurrentPlanKey}
                        monthlyPriceKrw={plan.monthlyPriceKrw}
                        currentMonthlyPriceKrw={
                          currentPlan?.monthlyPriceKrw ?? 0
                        }
                        billingProviderReady={billingProviderReady}
                        billingState={billingModel.state}
                        subscription={{
                          planKey: billingModel.subscription?.plan_key ?? null,
                          pendingPlanKey:
                            billingModel.subscription?.pending_plan_key ?? null,
                          currentPeriodEnd:
                            billingModel.subscription?.current_period_end ?? null,
                        }}
                        processingMessage={processingMessage}
                        activeOperation={
                          billingModel.activeOperation
                            ? {
                                id: billingModel.activeOperation.id,
                                status: billingModel.activeOperation.status,
                                targetPlanKey:
                                  billingModel.activeOperation.target_plan_key,
                                fromPlanKey:
                                  billingModel.activeOperation.from_plan_key,
                              }
                            : null
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <BillingRefundAction payments={refundablePayments} />

          <section className="mt-8 rounded-[8px] border border-hairline bg-canvas">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div className="p-base sm:p-lg">
                <p className="font-mono text-[12px] font-black uppercase tracking-[0.16em] text-primary">
                  FEATURES
                </p>
                <h2 className="text-[16px] font-black leading-6 text-ink">
                  플랜별 기능 및 메뉴
                </h2>
                <p className="mt-1 text-[13px] font-medium leading-5 text-muted">
                  모든 플랜에서 리서치 메뉴를 사용합니다. Pro의 리서치 노트북은
                  기업별 가설과 다음 확인 조건을 계속 관리하는 작업공간입니다.
                </p>
              </div>
            </div>
            <div className="border-t border-hairline">
              {entitlement.features.map((feature) => (
                <div
                  key={feature.key}
                  className="grid gap-xs border-b border-hairline px-base py-sm last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-lg"
                >
                  <div className="min-w-0">
                    <p className="text-[14px] font-extrabold leading-5 text-ink">
                      {feature.label}
                    </p>
                    <p className="mt-0.5 text-[13px] font-medium leading-5 text-muted">
                      {feature.description}
                    </p>
                    {!feature.enabled && feature.required_plan ? (
                      <p className="mt-1 text-[12px] font-bold leading-5 text-error">
                        {feature.required_plan === "lite"
                          ? "Lite"
                          : feature.required_plan === "standard"
                            ? "Standard"
                            : "Pro"}
                        플랜부터 사용 가능
                      </p>
                    ) : null}
                  </div>
                  <span
                    aria-hidden="true"
                    className={`material-symbols-outlined text-[20px] ${
                      feature.enabled ? "text-primary" : "text-muted"
                    }`}
                  >
                    {feature.enabled ? "check" : "lock"}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
