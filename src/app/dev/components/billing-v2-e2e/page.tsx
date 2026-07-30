import { notFound } from "next/navigation";
import BillingPlanAction from "@/components/BillingPlanAction";
import { isDevAuthBypassEnabled } from "@/lib/dev-auth-server";

export const dynamic = "force-dynamic";

export default async function BillingV2E2EPage() {
  const canUseProductionE2EFixture = await isDevAuthBypassEnabled();
  const fixtureEnabled =
    process.env.NEXT_PUBLIC_KRW_E2E_BILLING_FIXTURE === "1";

  if (
    !fixtureEnabled ||
    (process.env.NODE_ENV !== "development" && !canUseProductionE2EFixture)
  ) {
    notFound();
  }

  return (
    <main className="mx-auto grid min-h-screen w-full max-w-xl content-center gap-base bg-canvas p-base text-ink">
      <section className="rounded-[8px] border border-hairline bg-surface p-base">
        <h1 className="text-[24px] font-black">Billing V2 E2E</h1>
        <p className="mt-xs text-[14px] font-semibold text-muted">
          결제 금액 확인 뒤에만 결제 인증을 시작하는지 검증합니다.
        </p>
        <div className="mt-base">
          <BillingPlanAction
            planKey="standard"
            currentPlanKey="free"
            monthlyPriceKrw={7_900}
            currentMonthlyPriceKrw={0}
            billingProviderReady
            billingState="free"
            subscription={{
              planKey: null,
              pendingPlanKey: null,
              currentPeriodEnd: null,
            }}
            activeOperation={null}
          />
        </div>
      </section>
    </main>
  );
}
