import { redirect } from "next/navigation";
import BillingPlanAction from "@/components/BillingPlanAction";
import { getAuthUser } from "@/lib/auth";
import { getEntitlementStatus } from "@/lib/billing/entitlement";
import { MENU_FEATURE_DEFINITIONS } from "@/lib/billing/feature-access";
import { listPublicBillingPlansFromStore } from "@/lib/billing/plan-store";
import { isTossPaymentsConfigured } from "@/lib/billing/toss";
import { getCurrentTossSubscriptionSummary } from "@/lib/billing/toss-subscriptions";

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

  const billing = firstParam(searchParams.billing);
  if (billing === "success") {
    return {
      tone: "success",
      message: "구독 결제가 완료되었습니다. 새 플랜이 적용되었습니다.",
    };
  }
  if (billing === "cancel_scheduled") {
    return {
      tone: "success",
      message:
        "구독 해지가 예약되었습니다. 이미 결제된 기간이 끝날 때까지 플랜은 유지됩니다.",
    };
  }
  if (billing === "upgrade_success") {
    return {
      tone: "success",
      message:
        "업그레이드가 즉시 반영되었습니다. 새 플랜의 기능을 이용할 수 있습니다.",
    };
  }
  if (billing === "downgrade_scheduled") {
    return {
      tone: "success",
      message: "다운그레이드가 다음 월 갱신에 예약되었습니다.",
    };
  }
  if (billing === "plan_change_cancelled") {
    return {
      tone: "success",
      message: "예약된 플랜 변경을 취소했습니다.",
    };
  }

  const billingError = firstParam(searchParams.billing_error);
  if (!billingError) return null;
  return {
    tone: "error",
    message:
      firstParam(searchParams.billing_message) ??
      "결제 처리 중 오류가 발생했습니다.",
  };
}

function monthlyPriceLabel(value: number): string {
  return value === 0 ? "무료" : `월 ${value.toLocaleString()}원`;
}

function planFeatureLabel(planKey: string): string {
  if (planKey === "free") return "핵심 탐색 기능";
  if (planKey === "standard") return "와이드 리서치 포함";
  if (planKey === "pro") return "전체 메뉴 + 노트북";
  return "기능 기반";
}

function planDescription(planKey: string): string {
  if (planKey === "free") {
    return "회사 검색, 공시 기반 분석, 기관 보유 공시 확인을 시작할 수 있습니다.";
  }
  if (planKey === "standard") {
    return "Free 기능에 와이드 리서치를 더합니다.";
  }
  if (planKey === "pro") {
    return "모든 기능과 리서치 노트북을 제공합니다.";
  }
  return "기능별로 리서치 메뉴를 확장할 수 있는 플랜입니다.";
}

export default async function BillingSettingsPage({
  searchParams,
}: BillingSettingsPageProps) {
  const resolvedSearchParams = await searchParams;
  const user = await getAuthUser().catch(() => null);
  if (!user) {
    redirect("/login?next=/settings/billing");
  }

  const entitlement = await getEntitlementStatus(user.id, user.email ?? null);
  const plans = await listPublicBillingPlansFromStore();
  const subscription = await getCurrentTossSubscriptionSummary(user.id).catch(
    () => null,
  );
  const currentPlan =
    plans.find((plan) => plan.key === subscription?.planKey) ??
    plans.find((plan) => plan.key === entitlement.plan.key) ??
    plans.find((plan) => plan.key === "free");
  const billingProviderReady = isTossPaymentsConfigured();
  const notice = billingNotice(resolvedSearchParams);
  return (
    <div className="bg-canvas">
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
              Free는 핵심 탐색 기능을, Standard는 와이드 리서치를,
              Pro는 리서치 노트북을 제공합니다.
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
                {entitlement.plan.label}
              </p>
              <p className="mt-1 text-[13px] font-semibold leading-5 text-muted">
                {entitlement.plan.status_label}
              </p>
              <p className="mt-3 text-[14px] font-semibold leading-6 text-body">
                {planDescription(entitlement.plan.key)}
              </p>
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
            <div className="mt-base grid gap-sm lg:grid-cols-3">
              {plans.map((plan) => {
                const isCurrent = plan.key === entitlement.plan.key;
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
                        currentPlanKey={entitlement.plan.key}
                        monthlyPriceKrw={plan.monthlyPriceKrw}
                        currentMonthlyPriceKrw={
                          currentPlan?.monthlyPriceKrw ?? 0
                        }
                        billingProviderReady={billingProviderReady}
                        subscriptionPlanKey={subscription?.planKey ?? null}
                        pendingPlanKey={subscription?.pendingPlanKey ?? null}
                        cancelAtPeriodEnd={
                          subscription?.cancelAtPeriodEnd ?? false
                        }
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

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
                  Free는 핵심 메뉴를, Standard와 Pro는 확장 리서치 메뉴를
                  제공합니다.
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
                        {feature.required_plan === "standard"
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
