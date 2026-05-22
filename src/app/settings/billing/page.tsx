import { redirect } from "next/navigation";
import TopNav from "@/components/TopNav";
import UsageStatus from "@/components/UsageStatus";
import { getAuthUser } from "@/lib/auth";
import { getEntitlementStatus } from "@/lib/billing/entitlement";
import { listPublicBillingPlans } from "@/lib/billing/plans";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export default async function BillingSettingsPage() {
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
  const entitlement = await getEntitlementStatus(user.id);
  const plans = listPublicBillingPlans();
  const enabledFeatures = entitlement.features.filter((feature) => feature.enabled);
  const upcomingFeatures = entitlement.features.filter(
    (feature) => !feature.enabled,
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <TopNav initialUserProfile={initialUserProfile} />
      <main
        id="main-content"
        className="min-h-0 flex-1 overflow-y-auto px-base pb-[112px] pt-xl sm:px-md md:px-xl md:pb-[96px] md:pt-[72px]"
      >
        <div className="mx-auto w-full max-w-4xl">
          <header className="border-b border-hairline pb-8">
            <p className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-primary">
              설정
            </p>
            <h1 className="mt-3 text-balance text-[32px] font-black leading-[1.08] tracking-normal text-ink sm:text-[44px]">
              플랜과 사용량
            </h1>
            <p className="mt-4 max-w-2xl text-[16px] leading-7 text-body sm:text-[18px]">
              현재 베타 쿼터, 포함된 기능, 준비 중인 플랜 항목을 한곳에서
              확인합니다.
            </p>
          </header>

          <section className="mt-8">
            <UsageStatus entitlement={entitlement} variant="panel" />
          </section>

          <section className="mt-6 rounded-[8px] border border-hairline bg-canvas p-base sm:p-lg">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-[16px] font-black leading-6 text-ink">
                  월간 플랜
                </h2>
                <p className="mt-1 text-[13px] font-medium leading-5 text-muted">
                  결제 연동 전에도 내부 권한 모델은 이 기준으로 동작합니다.
                </p>
              </div>
              <p className="text-[12px] font-bold leading-5 text-muted">
                현재 {entitlement.plan.label}
              </p>
            </div>
            <div className="mt-base grid gap-sm md:grid-cols-3">
              {plans.map((plan) => {
                const isCurrent = plan.key === entitlement.plan.key;

                return (
                  <div
                    key={plan.key}
                    className={`rounded-[8px] border p-sm ${
                      isCurrent
                        ? "border-primary bg-surface"
                        : "border-hairline bg-surface-soft"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-sm">
                      <div>
                        <p className="text-[15px] font-black leading-5 text-ink">
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
                    <p className="mt-sm text-[22px] font-black leading-7 text-ink">
                      {plan.monthlyQuestionLimit.toLocaleString()}
                      <span className="ml-1 text-[12px] font-bold text-muted">
                        질문/월
                      </span>
                    </p>
                    <p className="mt-sm text-[12px] font-medium leading-5 text-muted">
                      {plan.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-[8px] border border-hairline bg-canvas p-base sm:p-lg">
              <h2 className="text-[16px] font-black leading-6 text-ink">
                포함된 기능
              </h2>
              <div className="mt-base space-y-sm">
                {enabledFeatures.map((feature) => (
                  <div key={feature.key} className="flex gap-sm">
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined mt-[2px] text-[18px] text-primary"
                    >
                      check
                    </span>
                    <div className="min-w-0">
                      <p className="text-[14px] font-extrabold leading-5 text-ink">
                        {feature.label}
                      </p>
                      <p className="mt-0.5 text-[13px] font-medium leading-5 text-muted">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[8px] border border-hairline bg-surface p-base sm:p-lg">
              <h2 className="text-[16px] font-black leading-6 text-ink">
                준비 중
              </h2>
              <div className="mt-base space-y-sm">
                {upcomingFeatures.map((feature) => (
                  <div key={feature.key} className="flex gap-sm">
                    <span
                      aria-hidden="true"
                      className="material-symbols-outlined mt-[2px] text-[18px] text-muted"
                    >
                      pending
                    </span>
                    <div className="min-w-0">
                      <p className="text-[14px] font-extrabold leading-5 text-ink">
                        {feature.label}
                      </p>
                      <p className="mt-0.5 text-[13px] font-medium leading-5 text-muted">
                        {feature.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
