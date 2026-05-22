import type { Metadata } from "next";
import MarketingCtaLink from "@/components/MarketingCtaLink";
import PublicRelatedLinks from "@/components/PublicRelatedLinks";
import PublicTopNav from "@/components/PublicTopNav";
import { listPublicBillingPlans } from "@/lib/billing/plans";
import { pageMetadata } from "@/lib/marketing/site";

export const metadata: Metadata = pageMetadata({
  title: "가격과 무료 베타 플랜",
  description:
    "KRW Ontology의 무료 베타, Pro, Power 플랜의 월간 질문 한도와 사용 범위를 확인하세요.",
  path: "/pricing",
});

export default function PricingPage() {
  const plans = listPublicBillingPlans();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas text-ink">
      <PublicTopNav />
      <main
        id="main-content"
        className="min-h-0 flex-1 overflow-y-auto px-base pb-[112px] pt-xl sm:px-md md:px-xl md:pb-[96px] md:pt-[72px]"
      >
        <div className="mx-auto w-full max-w-6xl">
          <header className="border-b border-hairline pb-8">
            <p className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-primary">
              무료 베타
            </p>
            <h1 className="mt-3 max-w-4xl text-balance text-[34px] font-black leading-[1.08] tracking-normal text-ink sm:text-[48px]">
              먼저 무료로 근거 기반 분석을 확인하세요.
            </h1>
            <p className="mt-4 max-w-3xl text-[16px] leading-7 text-body sm:text-[18px]">
              현재는 결제 없이 무료 베타로 운영합니다. 내부 플랜과 월간
              사용량 모델은 아래 기준으로 동작하며, 유료 결제는 정식 오픈
              전에 별도로 안내합니다.
            </p>
            <div className="mt-6">
              <MarketingCtaLink
                href="/companies"
                ctaId="pricing_hero_start"
                ctaLabel="무료로 첫 분석 시작"
                surface="pricing_hero"
                className="inline-flex min-h-12 items-center justify-center rounded-[8px] bg-surface-dark px-5 py-3 text-[15px] font-extrabold leading-5 text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                무료로 첫 분석 시작
              </MarketingCtaLink>
            </div>
          </header>

          <section className="grid gap-4 py-8 md:grid-cols-3">
            {plans.map((plan) => {
              const recommended = plan.key === "pro";

              return (
                <article
                  key={plan.key}
                  className={`rounded-[8px] border p-base ${
                    recommended
                      ? "border-primary bg-surface"
                      : "border-hairline bg-canvas"
                  }`}
                >
                  <div className="flex items-start justify-between gap-sm">
                    <div>
                      <h2 className="text-[20px] font-black leading-7 text-ink">
                        {plan.label}
                      </h2>
                      <p className="mt-1 text-[13px] font-bold leading-5 text-muted">
                        {plan.statusLabel}
                      </p>
                    </div>
                    {recommended && (
                      <span className="rounded-full bg-primary-container px-xs py-xxs text-[11px] font-bold leading-4 text-on-primary">
                        추천
                      </span>
                    )}
                  </div>
                  <p className="mt-5 text-[34px] font-black leading-none text-ink">
                    {plan.monthlyQuestionLimit.toLocaleString()}
                    <span className="ml-1 text-[13px] font-bold leading-5 text-muted">
                      질문/월
                    </span>
                  </p>
                  <p className="mt-4 text-[14px] font-medium leading-6 text-body">
                    {plan.description}
                  </p>
                  <MarketingCtaLink
                    href="/companies"
                    ctaId={`pricing_${plan.key}_start`}
                    ctaLabel="무료 베타로 시작"
                    surface="pricing_plan_card"
                    trackUpgrade={plan.key !== "free"}
                    className={`mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-[8px] px-sm py-xs text-[14px] font-extrabold leading-5 transition-colors ${
                      recommended
                        ? "bg-surface-dark text-on-dark hover:bg-primary-active"
                        : "border border-hairline bg-canvas text-ink hover:border-primary hover:text-primary"
                    }`}
                  >
                    무료 베타로 시작
                  </MarketingCtaLink>
                </article>
              );
            })}
          </section>

          <section className="border-t border-hairline py-8">
            <h2 className="text-[22px] font-black leading-7 text-ink">
              플랜을 나누는 기준
            </h2>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <Principle
                title="가치 기준은 질문 수"
                body="사용자가 더 많은 회사를 반복 분석할수록 가치가 커지므로 월간 질문 수를 기본 value metric으로 둡니다."
              />
              <Principle
                title="먼저 가치를 확인"
                body="결제보다 첫 답변 성공, 근거 확인, 재질문 경험을 먼저 완성하는 무료 베타 흐름을 유지합니다."
              />
              <Principle
                title="무리한 차단 없음"
                body="80%에서는 부드럽게 알리고, 100%에서만 다음 분석을 제한해 사용자가 맥락을 잃지 않게 합니다."
              />
            </div>
          </section>

          <PublicRelatedLinks currentPath="/pricing" />
        </div>
      </main>
    </div>
  );
}

function Principle({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[8px] border border-hairline bg-canvas p-base">
      <h3 className="text-[15px] font-black leading-6 text-ink">{title}</h3>
      <p className="mt-2 text-[13px] font-medium leading-6 text-body">{body}</p>
    </div>
  );
}
