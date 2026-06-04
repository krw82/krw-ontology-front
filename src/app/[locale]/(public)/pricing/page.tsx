import type { Metadata } from "next";
import { notFound } from "next/navigation";
import MarketingCtaLink from "@/components/MarketingCtaLink";
import PublicRelatedLinks from "@/components/PublicRelatedLinks";
import PublicTopNav from "@/components/PublicTopNav";
import { isLocale, type Locale } from "@/i18n/config";
import { localizedPageMetadata } from "@/i18n/metadata";
import { localizedPath } from "@/i18n/routing";
import {
  getBillingPlanAnalysisCredits,
  getBillingPlanLimitLabel,
} from "@/lib/billing/plans";
import { listPublicBillingPlansFromStore } from "@/lib/billing/plan-store";

type PricingPageProps = {
  params: Promise<{ locale: string }>;
};

const pricingCopy = {
  ko: {
    title: "가격과 무료 베타 플랜",
    description:
      "KRW Ontology의 무료 베타, Pro, Power 플랜의 분석 크레딧과 사용 범위를 확인하세요.",
    eyebrow: "무료 베타",
    heading: "먼저 무료로 근거 기반 분석을 확인하세요.",
    intro:
      "현재는 결제 없이 무료 베타로 운영합니다. 내부 플랜과 사용량 모델은 아래 기준으로 동작하며, 유료 결제는 정식 오픈 전에 별도로 안내합니다.",
    primaryCta: "무료로 첫 분석 시작",
    cardCta: "무료 베타로 시작",
    recommended: "추천",
    principlesHeading: "플랜을 나누는 기준",
    principles: [
      {
        title: "가치 기준은 분석 크레딧",
        body: "질문마다 공시 검색 범위와 답변 생성량이 다르므로, 실제 제한은 단순 질문 수가 아니라 분석 크레딧을 기준으로 둡니다.",
      },
      {
        title: "먼저 가치를 확인",
        body: "결제보다 첫 답변 성공, 근거 확인, 재질문 경험을 먼저 완성하는 무료 베타 흐름을 유지합니다.",
      },
      {
        title: "무리한 차단 없음",
        body: "80%에서는 부드럽게 알리고, 크레딧이 남아 있으면 마지막 분석까지 실행합니다. 한도를 넘는 비용은 남은 크레딧까지만 차감합니다.",
      },
    ],
  },
  en: {
    title: "Pricing and free beta plans",
    description:
      "Review KRW Ontology free beta, Pro, and Power plan analysis credits and usage limits.",
    eyebrow: "Free beta",
    heading: "Start by testing evidence-first analysis for free.",
    intro:
      "KRW Ontology is currently running as a free beta. The plan and usage model below shows how analysis credits work before paid plans are opened.",
    primaryCta: "Start your first analysis",
    cardCta: "Start free beta",
    recommended: "Recommended",
    principlesHeading: "How plans are separated",
    principles: [
      {
        title: "Value is measured in analysis credits",
        body: "Each question can require a different filing search scope and answer size, so limits are based on analysis credits rather than raw question count.",
      },
      {
        title: "Prove value before payment",
        body: "The free beta keeps the focus on a successful first answer, visible evidence, and follow-up questions before charging users.",
      },
      {
        title: "No abrupt blocking",
        body: "At 80% usage KRW Ontology warns gently, and if credits remain the final analysis can still run. Over-limit cost is capped by remaining credits.",
      },
    ],
  },
} satisfies Record<Locale, {
  title: string;
  description: string;
  eyebrow: string;
  heading: string;
  intro: string;
  primaryCta: string;
  cardCta: string;
  recommended: string;
  principlesHeading: string;
  principles: Array<{ title: string; body: string }>;
}>;

type PublicBillingPlan = Awaited<
  ReturnType<typeof listPublicBillingPlansFromStore>
>[number];

type BillingPlanDisplay = {
  label: string;
  statusLabel: string;
  description: string;
  limitLabel: string;
};

const englishPlanCopy: Record<string, BillingPlanDisplay> = {
  free: {
    label: "Free",
    statusLabel: "Free beta",
    description: "For individual testing and lightweight company research.",
    limitLabel: "analysis credits/month",
  },
  pro: {
    label: "Pro individual analysis",
    statusLabel: "Free beta",
    description: "For users who regularly perform company research.",
    limitLabel: "analysis credits/month",
  },
  power: {
    label: "Power high-frequency analysis",
    statusLabel: "Free beta",
    description:
      "For repeated high-usage research across multiple companies and topics.",
    limitLabel: "analysis credits/month",
  },
};

function fallbackEnglishPlanLabel(key: string) {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getPlanDisplay(plan: PublicBillingPlan, locale: Locale): BillingPlanDisplay {
  if (locale === "ko") {
    return {
      label: plan.label,
      statusLabel: plan.statusLabel,
      description: plan.description,
      limitLabel: getBillingPlanLimitLabel(plan),
    };
  }

  return (
    englishPlanCopy[plan.key] ?? {
      label: fallbackEnglishPlanLabel(plan.key),
      statusLabel: "Beta",
      description: "Analysis credits for company research.",
      limitLabel: "analysis credits/month",
    }
  );
}

export async function generateMetadata({
  params,
}: PricingPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return localizedPageMetadata({
    locale,
    title: pricingCopy[locale].title,
    description: pricingCopy[locale].description,
    path: "/pricing",
  });
}

export default async function PricingPage({ params }: PricingPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const copy = pricingCopy[locale];
  const plans = await listPublicBillingPlansFromStore();

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <PublicTopNav locale={locale} />
      <main
        id="main-content"
        className="px-base pb-[112px] pt-xl sm:px-md md:px-xl md:pb-[96px] md:pt-[72px]"
      >
        <div className="mx-auto w-full max-w-6xl">
          <header className="border-b border-hairline pb-8">
            <p className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-primary">
              {copy.eyebrow}
            </p>
            <h1 className="mt-3 max-w-4xl text-balance text-[34px] font-black leading-[1.08] tracking-normal text-ink sm:text-[48px]">
              {copy.heading}
            </h1>
            <p className="mt-4 max-w-3xl text-[16px] leading-7 text-body sm:text-[18px]">
              {copy.intro}
            </p>
            <div className="mt-6">
              <MarketingCtaLink
                href={localizedPath(locale, "/companies")}
                ctaId="pricing_hero_start"
                ctaLabel={copy.primaryCta}
                surface="pricing_hero"
                className="inline-flex min-h-12 items-center justify-center rounded-[8px] bg-surface-dark px-5 py-3 text-[15px] font-extrabold leading-5 text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                {copy.primaryCta}
              </MarketingCtaLink>
            </div>
          </header>

          <section className="grid gap-4 py-8 md:grid-cols-3">
            {plans.map((plan) => {
              const recommended = plan.key === "pro";
              const planDisplay = getPlanDisplay(plan, locale);

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
                        {planDisplay.label}
                      </h2>
                      <p className="mt-1 text-[13px] font-bold leading-5 text-muted">
                        {planDisplay.statusLabel}
                      </p>
                    </div>
                    {recommended && (
                      <span className="rounded-full bg-primary-container px-xs py-xxs text-[11px] font-bold leading-4 text-on-primary">
                        {copy.recommended}
                      </span>
                    )}
                  </div>
                  <p className="mt-5 text-[32px] font-black leading-[1.05] text-ink">
                    {getBillingPlanAnalysisCredits(plan).toLocaleString()}{" "}
                    <span className="ml-1 align-baseline text-[13px] font-bold leading-5 text-muted">
                      {planDisplay.limitLabel}
                    </span>
                  </p>
                  <p className="mt-4 text-[14px] font-medium leading-6 text-body">
                    {planDisplay.description}
                  </p>
                  <MarketingCtaLink
                    href={localizedPath(locale, "/companies")}
                    ctaId={`pricing_${plan.key}_start`}
                    ctaLabel={copy.cardCta}
                    surface="pricing_plan_card"
                    trackUpgrade={plan.key !== "free"}
                    className={`mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-[8px] px-sm py-xs text-[14px] font-extrabold leading-5 transition-colors ${
                      recommended
                        ? "bg-surface-dark text-on-dark hover:bg-primary-active"
                        : "border border-hairline bg-canvas text-ink hover:border-primary hover:text-primary"
                    }`}
                  >
                    {copy.cardCta}
                  </MarketingCtaLink>
                </article>
              );
            })}
          </section>

          <section className="border-t border-hairline py-8">
            <h2 className="text-[22px] font-black leading-7 text-ink">
              {copy.principlesHeading}
            </h2>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {copy.principles.map((principle) => (
                <Principle
                  key={principle.title}
                  title={principle.title}
                  body={principle.body}
                />
              ))}
            </div>
          </section>

          <PublicRelatedLinks currentPath="/pricing" locale={locale} />
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
