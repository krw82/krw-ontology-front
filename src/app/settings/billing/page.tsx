import { redirect } from "next/navigation";
import BillingPlanAction from "@/components/BillingPlanAction";
import TopNav from "@/components/TopNav";
import { getAuthUser } from "@/lib/auth";
import { getEntitlementStatus } from "@/lib/billing/entitlement";
import { listPublicBillingPlansFromStore } from "@/lib/billing/plan-store";
import { isTossPaymentsConfigured } from "@/lib/billing/toss";
import { getCurrentTossSubscriptionSummary } from "@/lib/billing/toss-subscriptions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BillingSettingsPageProps = {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
};

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function billingNotice(
  searchParams: Awaited<BillingSettingsPageProps["searchParams"]>,
): { tone: "success" | "error"; message: string } | null {
  const billing = firstParam(searchParams.billing);
  if (billing === "success") {
    return {
      tone: "success",
      message:
        "구독 결제가 완료되었습니다. 결제 시각 기준으로 주간 사용량이 계산됩니다.",
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
        "업그레이드가 즉시 반영되었습니다. 현재 주간 한도도 새 플랜 기준으로 늘어납니다.",
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

function formatResetTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "다음 충전 시점";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function monthlyPriceLabel(value: number): string {
  return value === 0 ? "무료" : `월 ${value.toLocaleString()}원`;
}

function weeklyUsageStatusLabel(params: {
  unlimited: boolean;
  percent: number;
  blocked: boolean;
}): string {
  if (params.unlimited) return "한도 없음";
  if (params.blocked || params.percent >= 100) return "모두 사용";
  if (params.percent >= 90) return "거의 다 사용";
  if (params.percent >= 50) return "절반 이상 사용";
  if (params.percent > 0) return "여유 있음";
  return "아직 사용 전";
}

function weeklyUsageDescription(params: {
  unlimited: boolean;
  blocked: boolean;
}): string {
  if (params.unlimited) return "제한 없이 새 분석을 시작할 수 있습니다.";
  if (params.blocked) {
    return "다음 충전 전까지 새 분석은 시작할 수 없습니다.";
  }
  return "새 분석을 실행하면 이번 주 사용량에 반영됩니다.";
}

function planUsageLabel(planKey: string): string {
  if (planKey === "free") return "체험 사용량";
  if (planKey === "standard") return "기본 사용량";
  if (planKey === "pro") return "넉넉한 주간 사용량";
  return "사용량 기반";
}

function planDescription(planKey: string): string {
  if (planKey === "free") {
    return "첫 리서치 흐름을 확인하는 체험용 플랜입니다.";
  }
  if (planKey === "standard") {
    return "보통의 개인 투자자에게 맞습니다.";
  }
  if (planKey === "pro") {
    return "여러 기업을 자주 비교하고 반복적으로 리서치하는 사용자에게 맞습니다.";
  }
  return "사용량 기반으로 리서치를 이어갈 수 있는 플랜입니다.";
}

export default async function BillingSettingsPage({
  searchParams,
}: BillingSettingsPageProps) {
  const resolvedSearchParams = await searchParams;
  const user = await getAuthUser().catch(() => null);
  if (!user) {
    redirect("/login?next=/settings/billing");
  }

  const metadata = user.user_metadata;
  const initialUserProfile = user.email
    ? {
        email: user.email,
        name:
          stringValue(metadata?.full_name) ??
          stringValue(metadata?.name) ??
          stringValue(metadata?.display_name),
        avatarUrl:
          stringValue(metadata?.avatar_url) ??
          stringValue(metadata?.picture) ??
          stringValue(metadata?.photo_url),
      }
    : null;
  const preserveInitialUserProfile =
    user.app_metadata?.provider === "dev-auth-bypass";
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
  const usagePercent = Math.max(
    0,
    Math.min(100, entitlement.usage.percent_used),
  );
  const isBlocked = entitlement.usage.alert_level === "blocked";

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <TopNav
        initialUserProfile={initialUserProfile}
        preserveInitialUserProfile={preserveInitialUserProfile}
      />
      <main
        id="main-content"
        className="px-base pb-[112px] pt-xl sm:px-md md:px-xl md:pb-[96px] md:pt-[72px]"
      >
        <div className="mx-auto w-full max-w-6xl">
          <header className="mx-auto max-w-3xl text-center">
            <p className="font-mono text-[12px] font-black uppercase tracking-[0.18em] text-primary">
              PLAN & USAGE
            </p>
            <h1 className="mt-4 text-balance text-[36px] font-black leading-[1.04] tracking-normal text-ink sm:text-[52px]">
              필요한 만큼 리서치하세요.
            </h1>
            <p className="mx-auto mt-4 max-w-2xl text-[16px] font-medium leading-7 text-body sm:text-[18px]">
              모든 플랜에서 공시 기반 리서치와 노트북을 사용할 수 있습니다.
              차이는 매주 다시 채워지는 사용량입니다.
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

          <section className="mt-8 grid gap-sm md:grid-cols-3">
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
            </div>
            <div className="rounded-[8px] border border-hairline bg-canvas p-base">
              <div className="flex items-start justify-between gap-sm">
                <div>
                  <p className="font-mono text-[11px] font-black uppercase tracking-[0.14em] text-muted">
                    THIS WEEK
                  </p>
                  <p
                    className={`mt-2 text-[22px] font-black leading-7 ${
                      isBlocked ? "text-error" : "text-ink"
                    }`}
                  >
                    {weeklyUsageStatusLabel({
                      unlimited: entitlement.usage.unlimited,
                      percent: usagePercent,
                      blocked: isBlocked,
                    })}
                  </p>
                </div>
              </div>
              <div className="mt-sm h-2 overflow-hidden rounded-full bg-surface-dim">
                <div
                  className={`h-full rounded-full ${
                    isBlocked ? "bg-error" : "bg-primary"
                  }`}
                  style={{ width: `${usagePercent}%` }}
                />
              </div>
              <p className="mt-xs text-[12px] font-semibold leading-5 text-muted">
                {weeklyUsageDescription({
                  unlimited: entitlement.usage.unlimited,
                  blocked: isBlocked,
                })}
              </p>
            </div>
            <div className="rounded-[8px] border border-hairline bg-canvas p-base">
              <p className="font-mono text-[11px] font-black uppercase tracking-[0.14em] text-muted">
                NEXT RESET
              </p>
              <p className="mt-2 text-[22px] font-black leading-7 text-ink">
                {entitlement.usage.unlimited
                  ? "한도 없음"
                  : formatResetTime(entitlement.usage.resets_at)}
              </p>
              <p className="mt-1 text-[13px] font-semibold leading-5 text-muted">
                구독 시작 시각 기준 7일마다 다시 충전됩니다.
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
                  사용량 기반 플랜
                </h2>
              </div>
            </div>
            <div className="mt-base grid gap-sm lg:grid-cols-3">
              {plans.map((plan) => {
                const isCurrent = plan.key === entitlement.plan.key;
                const isRecommended = plan.key === "standard";

                return (
                  <div
                    key={plan.key}
                    className={`relative flex min-h-[360px] flex-col rounded-[8px] border p-base sm:p-lg ${
                      isRecommended
                        ? "border-primary bg-primary-fixed/35 shadow-[0_18px_48px_rgba(0,82,255,0.10)]"
                        : isCurrent
                          ? "border-primary/45 bg-canvas"
                          : "border-hairline bg-canvas"
                    }`}
                  >
                    {isRecommended && (
                      <div className="absolute right-sm top-sm rounded-full bg-primary px-xs py-xxs text-[11px] font-black leading-4 text-on-primary">
                        개인 투자자 추천
                      </div>
                    )}
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
                      {planUsageLabel(plan.key)}
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
                  모든 플랜에서 열려 있는 기능
                </h2>
                <p className="mt-1 text-[13px] font-medium leading-5 text-muted">
                  플랜 차이는 기능 잠금이 아니라 매주 사용할 수 있는
                  분석량입니다.
                </p>
              </div>
              <p className="px-base pb-base text-[12px] font-bold leading-5 text-muted sm:p-lg sm:pt-0">
                사용량 기반
              </p>
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
                  </div>
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined text-[20px] text-primary"
                  >
                    check
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
