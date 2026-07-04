import type { Metadata } from "next";
import { notFound } from "next/navigation";
import JsonLdScript from "@/components/JsonLdScript";
import MarketingCtaLink from "@/components/MarketingCtaLink";
import PublicRelatedLinks from "@/components/PublicRelatedLinks";
import PublicTopNav from "@/components/PublicTopNav";
import { isLocale, type Locale } from "@/i18n/config";
import { localizedPageMetadata } from "@/i18n/metadata";
import { localizedPath } from "@/i18n/routing";
import { listPublicBillingPlansFromStore } from "@/lib/billing/plan-store";
import { getBillingPlanAnalysisCredits } from "@/lib/billing/plans";
import {
  absoluteUrl,
  buildSiteOgImagePath,
  SITE_NAME,
} from "@/lib/marketing/site";
import { getCspNonce } from "@/lib/security/csp-nonce";

type PricingPageProps = {
  params: Promise<{ locale: string }>;
};

const pricingCopy = {
  ko: {
    title: "가격과 사용량 기반 플랜",
    description:
      "KRW Ontology의 Free, Standard, Pro 사용량 기반 플랜을 확인하세요.",
    eyebrow: "가격",
    heading: "필요한 만큼 리서치하세요.",
    intro:
      "결제는 월 단위로 받고, 주간 분석량은 구독 시작 시각 기준 7일마다 다시 충전됩니다. 사용량은 질문 수가 아니라 분석 범위와 답변 생성량에 따라 달라집니다.",
    primaryCta: "무료로 첫 분석 시작",
    cardCta: "분석 시작",
    recommended: "추천",
    comparisonHeading: "플랜 비교",
    comparisonRows: [
      {
        label: "적합한 사용",
        free: "첫 분석 체험",
        standard: "개인 반복 분석",
        pro: "여러 회사 비교",
      },
      {
        label: "와이드 리서치",
        free: "제한",
        standard: "포함",
        pro: "넉넉함",
      },
      {
        label: "리서치 노트북",
        free: "기본",
        standard: "포함",
        pro: "포함",
      },
      {
        label: "주간 사용량",
        free: "체험",
        standard: "기본",
        pro: "높음",
      },
    ],
    principlesHeading: "플랜을 나누는 기준",
    principles: [
      {
        title: "사용량 기반 플랜",
        body: "기능은 모든 플랜에서 열어두고, 분석 범위와 답변 생성량에 따라 이번 주 사용량에 반영합니다.",
      },
      {
        title: "먼저 가치를 확인",
        body: "Free 플랜으로 첫 답변 성공, 근거 확인, 재질문 경험을 먼저 확인한 뒤 필요한 만큼 플랜을 올릴 수 있습니다.",
      },
      {
        title: "무리한 차단 없음",
        body: "사용량이 남아 있으면 기능을 막지 않습니다. 한도에 도달하면 다음 충전 시각과 업그레이드 선택지만 안내합니다.",
      },
    ],
  },
  en: {
    title: "Usage-based pricing",
    description:
      "Review KRW Ontology Free, Standard, and Pro usage-based plans.",
    eyebrow: "Pricing",
    heading: "Choose the research capacity that fits your workflow.",
    intro:
      "Billing is monthly, while weekly usage capacity refills every seven days from your subscription anchor. Usage depends on research scope and answer length, not a fixed question count.",
    primaryCta: "Start your first analysis",
    cardCta: "Start analysis",
    recommended: "Recommended",
    comparisonHeading: "Plan comparison",
    comparisonRows: [
      {
        label: "Best for",
        free: "First analysis",
        standard: "Repeated individual research",
        pro: "Multi-company comparison",
      },
      {
        label: "Wide research",
        free: "Limited",
        standard: "Included",
        pro: "Generous",
      },
      {
        label: "Research notebook",
        free: "Basic",
        standard: "Included",
        pro: "Included",
      },
      {
        label: "Weekly usage",
        free: "Trial",
        standard: "Standard",
        pro: "High",
      },
    ],
    principlesHeading: "How plans are separated",
    principles: [
      {
        title: "Usage-based plans",
        body: "Features stay open across plans. Usage reflects research scope and answer size.",
      },
      {
        title: "Prove value before payment",
        body: "The Free plan keeps the focus on a successful first answer, visible evidence, and follow-up questions before upgrading.",
      },
      {
        title: "No abrupt blocking",
        body: "If usage remains, features stay usable. When the weekly limit is reached, the product shows the next refill time and upgrade options.",
      },
    ],
  },
} satisfies Record<
  Locale,
  {
    title: string;
    description: string;
    eyebrow: string;
    heading: string;
    intro: string;
    primaryCta: string;
    cardCta: string;
    recommended: string;
    comparisonHeading: string;
    comparisonRows: Array<{
      label: string;
      free: string;
      standard: string;
      pro: string;
    }>;
    principlesHeading: string;
    principles: Array<{ title: string; body: string }>;
  }
>;

type PublicBillingPlan = Awaited<
  ReturnType<typeof listPublicBillingPlansFromStore>
>[number];

type BillingPlanDisplay = {
  label: string;
  statusLabel: string;
  description: string;
  usageLabel: string;
};

const englishPlanCopy: Record<string, BillingPlanDisplay> = {
  free: {
    label: "Free",
    statusLabel: "Free",
    description: "For individual testing and lightweight company research.",
    usageLabel: "Basic weekly usage",
  },
  pro: {
    label: "Pro",
    statusLabel: "Advanced analysis",
    description:
      "For higher-volume comparison and repeated research workflows.",
    usageLabel: "5x Standard usage",
  },
  standard: {
    label: "Standard",
    statusLabel: "Individual analysis",
    description: "For users who regularly perform company research.",
    usageLabel: "Individual research",
  },
};

function fallbackEnglishPlanLabel(key: string) {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getPlanDisplay(
  plan: PublicBillingPlan,
  locale: Locale,
): BillingPlanDisplay {
  if (locale === "ko") {
    const koPlanCopy: Record<
      string,
      Pick<BillingPlanDisplay, "description" | "usageLabel">
    > = {
      free: {
        description: "첫 리서치 흐름을 확인하는 체험용 플랜입니다.",
        usageLabel: "체험 사용량",
      },
      standard: {
        description: "보통의 개인 투자자에게 맞습니다.",
        usageLabel: "기본 사용량",
      },
      pro: {
        description:
          "여러 기업을 자주 비교하고 반복적으로 리서치하는 사용자에게 맞습니다.",
        usageLabel: "넉넉한 주간 사용량",
      },
    };
    const copy = koPlanCopy[plan.key] ?? {
      description: "사용량 기반으로 리서치를 이어갈 수 있는 플랜입니다.",
      usageLabel: "사용량 기반",
    };

    return {
      label: plan.label,
      statusLabel: plan.statusLabel,
      description: copy.description,
      usageLabel: copy.usageLabel,
    };
  }

  return (
    englishPlanCopy[plan.key] ?? {
      label: fallbackEnglishPlanLabel(plan.key),
      statusLabel: "Beta",
      description: "Usage-based access for company research.",
      usageLabel: "Usage-based",
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
    image: {
      url: buildSiteOgImagePath("pricing", locale),
      alt: `${pricingCopy[locale].title} | ${SITE_NAME}`,
    },
  });
}

export default async function PricingPage({ params }: PricingPageProps) {
  const nonce = await getCspNonce();
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const copy = pricingCopy[locale];
  const plans = await listPublicBillingPlansFromStore();
  const pageUrl = absoluteUrl(localizedPath(locale, "/pricing"));
  const offerItems = plans.map((plan, index) => {
    const display = getPlanDisplay(plan, locale);
    return {
      "@type": "Offer",
      position: index + 1,
      name: display.label,
      description: display.description,
      price: plan.monthlyPriceKrw,
      priceCurrency: "KRW",
      availability: "https://schema.org/InStock",
      eligibleQuantity: {
        "@type": "QuantitativeValue",
        value: getBillingPlanAnalysisCredits(plan),
        unitText: "weekly analysis capacity",
      },
    };
  });
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SoftwareApplication",
        name: SITE_NAME,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        url: absoluteUrl(localizedPath(locale)),
        description: copy.description,
        offers: {
          "@type": "OfferCatalog",
          name: copy.title,
          url: pageUrl,
          itemListElement: offerItems,
        },
      },
      {
        "@type": "OfferCatalog",
        name: copy.title,
        description: copy.description,
        url: pageUrl,
        itemListElement: offerItems.map((offer, index) => ({
          "@type": "ListItem",
          position: index + 1,
          item: offer,
        })),
      },
    ],
  };

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <JsonLdScript nonce={nonce} data={jsonLd} />
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
              const recommended = plan.key === "standard";
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
                    {plan.monthlyPriceKrw === 0
                      ? locale === "ko"
                        ? "무료"
                        : "Free"
                      : locale === "ko"
                        ? `월 ${plan.monthlyPriceKrw.toLocaleString()}원`
                        : `KRW ${plan.monthlyPriceKrw.toLocaleString()}/mo`}
                  </p>
                  <p className="mt-3 text-[22px] font-black leading-[1.05] text-ink">
                    {planDisplay.usageLabel}
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
              {copy.comparisonHeading}
            </h2>
            <div className="mt-4 overflow-hidden rounded-[8px] border border-hairline bg-canvas">
              <div className="grid grid-cols-[minmax(112px,0.9fr)_repeat(3,minmax(92px,1fr))] border-b border-hairline bg-surface px-sm py-2.5 font-mono text-[11px] font-black uppercase tracking-[0.12em] text-muted">
                <span>{locale === "ko" ? "항목" : "Item"}</span>
                <span>Free</span>
                <span>Standard</span>
                <span>Pro</span>
              </div>
              <div className="divide-y divide-hairline">
                {copy.comparisonRows.map((row) => (
                  <div
                    key={row.label}
                    className="grid grid-cols-[minmax(112px,0.9fr)_repeat(3,minmax(92px,1fr))] px-sm py-3 text-[13px] leading-5"
                  >
                    <span className="font-black text-ink">{row.label}</span>
                    <span className="font-semibold text-body">{row.free}</span>
                    <span className="font-semibold text-body">{row.standard}</span>
                    <span className="font-semibold text-body">{row.pro}</span>
                  </div>
                ))}
              </div>
            </div>
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
