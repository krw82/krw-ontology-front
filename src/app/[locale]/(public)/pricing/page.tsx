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
    title: "가격과 기능별 플랜",
    description:
      "KRW.O의 Free, Standard, Pro 기능별 플랜을 확인하세요.",
    eyebrow: "가격",
    heading: "내 리서치에 맞는 플랜을 선택하세요.",
    intro:
      "유료 플랜은 매월 정기 결제됩니다. Free에서 핵심 탐색 기능을 시작하고, Standard와 Pro에서 더 넓은 리서치 메뉴를 이용할 수 있습니다.",
    serviceNote:
      "공시와 시장 자료를 확인하는 리서치 소프트웨어입니다. 투자자문이나 매수·매도 추천을 제공하지 않으며, 투자 판단은 이용자에게 있습니다.",
    primaryCta: "첫 분석 시작",
    cardCta: "플랜 시작",
    comparisonHeading: "플랜 비교",
    comparisonRows: [
      {
        label: "회사 찾기",
        free: "포함",
        standard: "포함",
        pro: "포함",
      },
      {
        label: "관점별 분석",
        free: "포함",
        standard: "포함",
        pro: "포함",
      },
      {
        label: "최근 채팅",
        free: "포함",
        standard: "포함",
        pro: "포함",
      },
      {
        label: "13F 기관 보유",
        free: "포함",
        standard: "포함",
        pro: "포함",
      },
      {
        label: "조건으로 기업 검색",
        free: "포함",
        standard: "포함",
        pro: "포함",
      },
      {
        label: "와이드 리서치",
        free: "제한",
        standard: "포함",
        pro: "포함",
      },
      {
        label: "리서치 노트북",
        free: "제한",
        standard: "제한",
        pro: "포함",
      },
    ],
    principlesHeading: "플랜을 나누는 기준",
    principles: [
      {
        title: "메뉴별 기능 분리",
        body: "Free는 핵심 탐색 기능, Standard는 와이드 리서치, Pro는 리서치 노트북까지 제공합니다.",
      },
      {
        title: "먼저 가치를 확인",
        body: "Free 플랜으로 첫 답변 성공, 근거 확인, 재질문 경험을 먼저 확인한 뒤 필요한 만큼 플랜을 올릴 수 있습니다.",
      },
      {
        title: "필요한 기능만 확장",
        body: "Standard에서 와이드 리서치를, Pro에서 리서치 노트북을 추가로 이용할 수 있습니다.",
      },
    ],
  },
  en: {
    title: "Feature-based pricing",
    description:
      "Review KRW.O Free, Standard, and Pro feature-based plans.",
    eyebrow: "Pricing",
    heading: "Choose the plan that fits your workflow.",
    intro:
      "Paid plans renew monthly. Start with core discovery on Free, then unlock wider research menus with Standard and Pro.",
    serviceNote:
      "This is research software for reviewing filings and market materials. It does not provide investment advice or buy/sell recommendations; users make their own decisions.",
    primaryCta: "Start your first analysis",
    cardCta: "Start plan",
    comparisonHeading: "Plan comparison",
    comparisonRows: [
      {
        label: "Find companies",
        free: "Included",
        standard: "Included",
        pro: "Included",
      },
      {
        label: "Perspective analysis",
        free: "Included",
        standard: "Included",
        pro: "Included",
      },
      {
        label: "Recent chats",
        free: "Included",
        standard: "Included",
        pro: "Included",
      },
      {
        label: "13F institutional holdings",
        free: "Included",
        standard: "Included",
        pro: "Included",
      },
      {
        label: "Company search by criteria",
        free: "Included",
        standard: "Included",
        pro: "Included",
      },
      {
        label: "Wide research",
        free: "Limited",
        standard: "Included",
        pro: "Included",
      },
      {
        label: "Research notebook",
        free: "Limited",
        standard: "Limited",
        pro: "Included",
      },
    ],
    principlesHeading: "How plans are separated",
    principles: [
      {
        title: "Menu-based access",
        body: "Free covers core discovery, Standard adds wide research, and Pro adds the research notebook.",
      },
      {
        title: "Prove value before payment",
        body: "The Free plan keeps the focus on a successful first answer, visible evidence, and follow-up questions before upgrading.",
      },
      {
        title: "Expand by workflow",
        body: "Standard adds wide research, while Pro adds the research notebook.",
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
    serviceNote: string;
    primaryCta: string;
    cardCta: string;
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
  featureSummary: string;
};

const englishPlanCopy: Record<string, BillingPlanDisplay> = {
  free: {
    label: "Free",
    statusLabel: "Free",
    description:
      "Start with company search, filing-based analysis, and institutional holdings research.",
    featureSummary: "Core discovery features",
  },
  pro: {
    label: "Pro",
    statusLabel: "Advanced analysis",
    description: "Unlock every menu, including the research notebook.",
    featureSummary: "All features + notebook",
  },
  standard: {
    label: "Standard",
    statusLabel: "Extended analysis",
    description: "Add wide research to the Free feature set.",
    featureSummary: "Wide research included",
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
      Pick<BillingPlanDisplay, "description" | "featureSummary">
    > = {
      free: {
        description:
          "회사 검색, 공시 기반 분석, 기관 보유 공시 확인을 시작할 수 있습니다.",
        featureSummary: "핵심 탐색 기능",
      },
      standard: {
        description: "Free 기능에 와이드 리서치를 더합니다.",
        featureSummary: "와이드 리서치 포함",
      },
      pro: {
        description: "모든 기능과 리서치 노트북을 제공합니다.",
        featureSummary: "전체 메뉴 + 노트북",
      },
    };
    const copy = koPlanCopy[plan.key] ?? {
      description: "기능별로 리서치 메뉴를 확장할 수 있는 플랜입니다.",
      featureSummary: "기능 기반",
    };

    return {
      label: plan.label,
      statusLabel: plan.statusLabel,
      description: copy.description,
      featureSummary: copy.featureSummary,
    };
  }

  return (
    englishPlanCopy[plan.key] ?? {
      label: fallbackEnglishPlanLabel(plan.key),
      statusLabel: "Beta",
      description: "Usage-based access for company research.",
      featureSummary: "Feature-based",
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
              const isFeatured = plan.key === "standard";
              const planDisplay = getPlanDisplay(plan, locale);

              return (
                <article
                  key={plan.key}
                  className={`rounded-[8px] border p-base ${
                    isFeatured
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
                    {planDisplay.featureSummary}
                  </p>
                  <p className="mt-4 text-[14px] font-medium leading-6 text-body">
                    {planDisplay.description}
                  </p>
                  <MarketingCtaLink
                    href={
                      plan.key === "free"
                        ? localizedPath(locale, "/companies")
                        : `/login?next=${encodeURIComponent("/settings/billing")}`
                    }
                    ctaId={`pricing_${plan.key}_start`}
                    ctaLabel={copy.cardCta}
                    surface="pricing_plan_card"
                    trackUpgrade={plan.key !== "free"}
                    className={`mt-5 inline-flex min-h-11 w-full items-center justify-center rounded-[8px] px-sm py-xs text-[14px] font-extrabold leading-5 transition-colors ${
                      isFeatured
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

          <p className="-mt-4 max-w-3xl text-[12px] font-medium leading-5 text-muted">
            {copy.serviceNote}
          </p>

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
