import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import JsonLdScript from "@/components/JsonLdScript";
import { KrwBrand } from "@/components/KrwBrand";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import {
  HomeHeaderActions,
  HomePrimaryCtas,
  HomeQuestionForm,
} from "@/components/HomeInteractions";
import {
  HeroHeading,
  HeroSubtext,
  HeroEyebrow,
  WorkflowSteps,
  TraceCardEntrance,
  QuestionFormEntrance,
} from "@/components/HeroSection";
import SampleResearchAnswerCard from "@/components/public/SampleResearchAnswerCard";
import { SAMPLE_RESEARCH_ANSWERS } from "@/content/sample-research-answer.ko";
import { isLocale, type Locale } from "@/i18n/config";
import { localizedPageMetadata } from "@/i18n/metadata";
import { localizedPath, queryLocalizedPath } from "@/i18n/routing";
import { buildNewChatHref } from "@/lib/chat/history-state";
import { sampleAnswerCtaHref } from "@/lib/content/sample-answer-display";
import {
  absoluteUrl,
  buildSiteOgImagePath,
  SITE_NAME,
} from "@/lib/marketing/site";
import { getCspNonce } from "@/lib/security/csp-nonce";

type HomePageProps = {
  params: Promise<{ locale: string }>;
};

const homeCopy = {
  ko: {
    metadataTitle: "미국주식 질문을 공시 근거로 확인하는 AI 리서치",
    metadataDescription:
      "미국 상장기업에 대한 투자 질문을 회사 공시, 실적 변화, 리스크, 사업 맥락과 함께 확인하세요.",
    navResearch: "리서치",
    navCompanies: "회사 목록",
    navQuestions: "질문 그래프",
    navPricing: "가격",
    eyebrow: "공시 근거 기반 미국주식 리서치",
    headingLines: ["AI 답변을 믿기 전에"],
    accentLine: "회사 공시로 확인하세요",
    subtext:
      "매일 공시·뉴스·기관 보유·내부자 거래를 한 곳으로 모아, 오늘 확인할 리서치 거리를 골라줍니다.",
    browseLinks: [
      { href: "/pulse", label: "피드" },
      { href: "/news", label: "뉴스" },
      { href: "/questions", label: "질문 예시" },
      { href: "/13f", label: "13F 보유" },
      { href: "/pricing", label: "가격" },
    ],
    previewEyebrow: "REAL ANSWER",
    previewTitle: "실제 답변 예시",
    previewDataStrip: "공시 · 뉴스 · 13F 기관 보유 · 내부자 거래 — 355개 기업",
    workflowSteps: ["질문 고르기", "리서치 실행", "매일 이어서 보기"],
    offerDescription: "무료 플랜",
    browseAria: "공개 페이지 둘러보기",
  },
  en: {
    metadataTitle: "Filing-grounded AI research for U.S. stock questions",
    metadataDescription:
      "Check U.S. stock questions against company filings, earnings changes, risks, and business context.",
    navResearch: "Research",
    navCompanies: "Companies",
    navQuestions: "Question graphs",
    navPricing: "Pricing",
    eyebrow: "Filing-grounded U.S. stock research",
    headingLines: ["Before you trust an AI answer,"],
    accentLine: "check the company filings",
    subtext:
      "Filings, market news, institutional holdings, and insider trades — gathered in one place so today's research finds you.",
    browseLinks: [
      { href: "/pulse", label: "Feed" },
      { href: "/news", label: "News" },
      { href: "/questions", label: "Question examples" },
      { href: "/13f", label: "13F holdings" },
      { href: "/pricing", label: "Pricing" },
    ],
    previewEyebrow: "REAL ANSWER",
    previewTitle: "A real answer example",
    previewDataStrip: "Filings · News · 13F holdings · Insider trades — 355 companies",
    workflowSteps: ["Pick a question", "Run the research", "Continue every day"],
    offerDescription: "Free plan",
    browseAria: "Browse public pages",
  },
} satisfies Record<Locale, {
  metadataTitle: string;
  metadataDescription: string;
  navResearch: string;
  navCompanies: string;
  navQuestions: string;
  navPricing: string;
  eyebrow: string;
  headingLines: string[];
  accentLine: string;
  subtext: string;
  browseLinks: Array<{ href: string; label: string }>;
  previewEyebrow: string;
  previewTitle: string;
  previewDataStrip: string;
  workflowSteps: string[];
  offerDescription: string;
  browseAria: string;
}>;

export async function generateMetadata({
  params,
}: HomePageProps): Promise<Metadata> {
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) notFound();

  const copy = homeCopy[rawLocale];
  return localizedPageMetadata({
    locale: rawLocale,
    title: copy.metadataTitle,
    description: copy.metadataDescription,
    path: "/",
    image: {
      url: buildSiteOgImagePath("home", rawLocale),
      alt: `${copy.metadataTitle} | ${SITE_NAME}`,
    },
  });
}

export default async function Home({ params }: HomePageProps) {
  const nonce = await getCspNonce();
  const { locale: rawLocale } = await params;
  if (!isLocale(rawLocale)) notFound();

  const locale = rawLocale;
  const copy = homeCopy[locale];
  const siteUrl = absoluteUrl(localizedPath(locale));
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: SITE_NAME,
        url: siteUrl,
        logo: absoluteUrl("/krw-logo.svg"),
      },
      {
        "@type": "WebSite",
        name: SITE_NAME,
        alternateName: "KRW",
        url: siteUrl,
        publisher: {
          "@type": "Organization",
          name: SITE_NAME,
        },
      },
      {
        "@type": "SoftwareApplication",
        name: SITE_NAME,
        applicationCategory: "FinanceApplication",
        operatingSystem: "Web",
        url: siteUrl,
        description: copy.metadataDescription,
        publisher: {
          "@type": "Organization",
          name: SITE_NAME,
        },
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "KRW",
          description: copy.offerDescription,
          availability: "https://schema.org/InStock",
        },
      },
    ],
  };

  return (
    <div className="min-h-[100dvh] overflow-x-hidden bg-canvas text-ink">
      <JsonLdScript nonce={nonce} data={jsonLd} />
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-hairline bg-canvas/95 backdrop-blur-xl">
        <nav className="mx-auto flex h-20 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <KrwBrand
            href="/pulse"
            compact
            ariaLabel={locale === "ko" ? "펄스로 이동" : "Go to the feed"}
          />

          <div className="hidden items-center gap-8 text-sm font-semibold text-muted md:flex">
            <Link
              href={buildNewChatHref(undefined, { locale })}
              className="transition-colors hover:text-ink"
            >
              {copy.navResearch}
            </Link>
            <Link
              href={localizedPath(locale, "/companies")}
              className="transition-colors hover:text-ink"
            >
              {copy.navCompanies}
            </Link>
            <Link href={localizedPath(locale, "/questions")} className="transition-colors hover:text-ink">
              {copy.navQuestions}
            </Link>
            <Link href={localizedPath(locale, "/pricing")} className="transition-colors hover:text-ink">
              {copy.navPricing}
            </Link>
          </div>

          <div className="flex items-center gap-3">
            <LocaleSwitcher compact />
            <HomeHeaderActions locale={locale} />
          </div>
        </nav>
      </header>

      <main
        id="main-content"
        className="relative min-h-[100dvh] px-4 pb-16 pt-28 sm:px-6 sm:pb-24 sm:pt-32 lg:px-8"
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(90deg,rgba(10,11,13,0.04)_1px,transparent_1px),linear-gradient(180deg,rgba(10,11,13,0.04)_1px,transparent_1px)] bg-[size:72px_72px]"
        />
        <section className="relative z-10 mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)] items-start gap-12 lg:min-h-[calc(100dvh-160px)] lg:grid-cols-[minmax(0,0.92fr)_minmax(420px,0.78fr)]">
          <div className="min-w-0 max-w-full">
            <HeroEyebrow>{copy.eyebrow}</HeroEyebrow>

            <HeroHeading
              lines={copy.headingLines}
              accentLine={copy.accentLine}
            />
            <HeroSubtext>
              {copy.subtext}
            </HeroSubtext>

            <HomePrimaryCtas locale={locale} />

            <nav
              className="mt-5 border-y border-hairline md:hidden"
              aria-label={copy.browseAria}
            >
              {copy.browseLinks.map((item) => (
                <Link
                  key={item.href}
                  href={queryLocalizedPath(locale, item.href)}
                  className="group flex min-h-11 items-center justify-between gap-sm border-b border-hairline py-3 text-[14px] font-extrabold leading-5 text-ink transition-colors last:border-b-0 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  <span className="flex min-w-0 items-center gap-sm">
                    <span className="font-mono text-[12px] font-black leading-5 text-primary">
                      {String(copy.browseLinks.indexOf(item) + 1).padStart(2, "0")}
                    </span>
                    <span className="truncate">{item.label}</span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="material-symbols-outlined shrink-0 text-[18px] text-muted transition-colors group-hover:text-primary"
                  >
                    arrow_forward
                  </span>
                </Link>
              ))}
            </nav>

            <QuestionFormEntrance>
              <HomeQuestionForm locale={locale} />
            </QuestionFormEntrance>

            <WorkflowSteps steps={copy.workflowSteps} />
          </div>

          <TraceCardEntrance>
            <div className="relative max-w-full rounded-[12px] border border-hairline bg-canvas p-4 text-ink shadow-[0_18px_48px_rgba(10,11,13,0.12)] sm:p-5">
              <div className="flex flex-col gap-3 border-b border-hairline pb-4 min-[480px]:flex-row min-[480px]:items-center min-[480px]:justify-between">
                <div className="min-w-0">
                  <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
                    {copy.previewEyebrow}
                  </p>
                  <h2 className="mt-2 text-[24px] font-black leading-[1.08]">
                    {copy.previewTitle}
                  </h2>
                </div>
              </div>

              <div className="mt-4">
                <SampleResearchAnswerCard
                  answer={SAMPLE_RESEARCH_ANSWERS[0]}
                  ctaHref={sampleAnswerCtaHref(SAMPLE_RESEARCH_ANSWERS[0])}
                  locale={locale}
                  ctaId="home_sample_answer_start"
                  surface="home_preview"
                />
              </div>

              <p className="mt-3 border-t border-hairline pt-3 text-center text-[12px] font-semibold leading-5 text-muted">
                {copy.previewDataStrip}
              </p>
            </div>
          </TraceCardEntrance>
        </section>
      </main>

    </div>
  );
}
