import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import JsonLdScript from "@/components/JsonLdScript";
import { KrwBrand } from "@/components/KrwBrand";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import {
  HomeHeaderActions,
  HomeEvidenceCards,
  HomePrimaryCtas,
  HomeQuestionForm,
  HomeTraceExplorer,
  type HomeEvidenceCard,
  type HomeTraceNode,
} from "@/components/HomeInteractions";
import {
  HeroHeading,
  HeroSubtext,
  HeroEyebrow,
  WorkflowSteps,
  TraceCardEntrance,
  QuestionFormEntrance,
} from "@/components/HeroSection";
import { isLocale, type Locale } from "@/i18n/config";
import { localizedPageMetadata } from "@/i18n/metadata";
import { localizedPath } from "@/i18n/routing";
import { buildNewChatHref } from "@/lib/chat/history-state";
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
      "회사 보고서에는 뉴스와 주가만으로는 보이지 않는 단서가 숨어 있습니다. 그 단서가 매출·마진·현금흐름·리스크에 어떤 의미인지 확인하세요.",
    browseLinks: [
      { href: "/questions", label: "질문 예시" },
      { href: "/companies", label: "회사 목록" },
      { href: "/13f", label: "13F 보유" },
      { href: "/pricing", label: "가격" },
    ],
    previewEyebrow: "답변 미리보기",
    previewTitle: "투자 질문 확인 예시",
    footer: "© 2026 KRW Ontology Research. 공시 근거 기반 기업 리서치.",
    privacy: "개인정보처리방침",
    terms: "서비스 약관",
    refund: "환불정책",
    offerDescription: "무료 베타 플랜",
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
      "Company reports contain signals that news and price moves alone do not show. Check what those signals mean for revenue, margins, cash flow, and risk.",
    browseLinks: [
      { href: "/questions", label: "Question examples" },
      { href: "/companies", label: "Companies" },
      { href: "/13f", label: "13F holdings" },
      { href: "/pricing", label: "Pricing" },
    ],
    previewEyebrow: "Answer preview",
    previewTitle: "Investment question check example",
    footer: "© 2026 KRW Ontology Research. Evidence-first company analysis.",
    privacy: "Privacy Policy",
    terms: "Terms of Service",
    refund: "Refund Policy",
    offerDescription: "Free beta plan",
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
  footer: string;
  privacy: string;
  terms: string;
  refund: string;
  offerDescription: string;
  browseAria: string;
}>;

const homeExperienceCopy = {
  ko: {
    evidenceCards: [
      {
        id: "source",
        label: "근거",
        value: "회사 보고서",
        detail: "답의 단서가 되는 문장 확인",
      },
      {
        id: "node",
        label: "흐름",
        value: "사업 맥락",
        detail: "실적 변화와 리스크 연결",
      },
      {
        id: "path",
        label: "정리",
        value: "근거 기반 답변",
        detail: "단서를 바탕으로 답변 정리",
      },
    ],
    traceNodes: [
      {
        id: "filing",
        label: "근거",
        mobileLabel: "근거",
        eyebrow: "단서 확인",
        title: "회사 보고서에서 단서 확인",
        detail:
          "질문과 관련된 문장을 먼저 찾아 답변의 출발점을 고정합니다.",
        quote: "답변은 보고서에서 찾은 단서에서 시작됩니다.",
      },
      {
        id: "segment",
        label: "연결",
        mobileLabel: "연결",
        eyebrow: "맥락 연결",
        title: "사업 흐름과 리스크 연결",
        detail:
          "보고서 문장과 관련된 사업 활동, 변수, 기간을 한 화면에서 이어 봅니다.",
        quote: "각 연결은 답변을 만들기 위한 단서로 유지됩니다.",
      },
      {
        id: "driver",
        label: "요약",
        mobileLabel: "요약",
        eyebrow: "답변 준비",
        title: "근거와 함께 핵심 요인 정리",
        detail:
          "연결된 근거를 바탕으로 답변의 주요 요인을 압축합니다.",
        quote: "최종 답변은 연결된 단서를 바탕으로 정리됩니다.",
      },
    ],
    workflowSteps: ["회사 질문", "단서 찾기", "근거 정리"],
  },
  en: {
    evidenceCards: [
      {
        id: "source",
        label: "Source",
        value: "Company filings",
        detail: "Find the sentences behind the answer",
      },
      {
        id: "node",
        label: "Context",
        value: "Business signals",
        detail: "Connect performance changes and risks",
      },
      {
        id: "path",
        label: "Answer",
        value: "Evidence-first summary",
        detail: "Organize the answer from traced signals",
      },
    ],
    traceNodes: [
      {
        id: "filing",
        label: "Source",
        mobileLabel: "Source",
        eyebrow: "Signal check",
        title: "Find signals in company reports",
        detail:
          "KRW Ontology anchors the answer by first finding report sentences related to the question.",
        quote: "The answer starts from report evidence.",
      },
      {
        id: "segment",
        label: "Connect",
        mobileLabel: "Connect",
        eyebrow: "Context link",
        title: "Connect business flow and risks",
        detail:
          "Report language is connected to business activity, variables, and periods in one trace.",
        quote: "Each connection is kept as an answer signal.",
      },
      {
        id: "driver",
        label: "Summarize",
        mobileLabel: "Summary",
        eyebrow: "Answer prep",
        title: "Summarize key drivers with evidence",
        detail:
          "The answer compresses key factors from the connected evidence path.",
        quote: "The final answer is organized from linked signals.",
      },
    ],
    workflowSteps: ["Company question", "Find signals", "Organize evidence"],
  },
} satisfies Record<Locale, {
  evidenceCards: HomeEvidenceCard[];
  traceNodes: HomeTraceNode[];
  workflowSteps: string[];
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
  const experience = homeExperienceCopy[locale];
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
            href="/companies"
            compact
            ariaLabel={locale === "ko" ? "회사 목록으로 이동" : "Go to companies"}
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
                  href={localizedPath(locale, item.href)}
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

            <WorkflowSteps steps={experience.workflowSteps} />
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

              <HomeEvidenceCards cards={experience.evidenceCards} />

              <HomeTraceExplorer nodes={experience.traceNodes} locale={locale} />
            </div>
          </TraceCardEntrance>
        </section>
      </main>

      <footer className="relative z-10 border-t border-hairline bg-canvas px-4 py-6 text-center text-xs font-bold uppercase leading-5 tracking-[0.14em] text-muted sm:px-6">
        <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          <span>
            {copy.footer}
          </span>
          <span className="hidden h-1 w-1 rounded-full bg-outline-variant sm:block" />
          <Link
            href={localizedPath(locale, "/privacy")}
            className="transition-colors hover:text-ink"
          >
            {copy.privacy}
          </Link>
          <Link
            href={localizedPath(locale, "/terms")}
            className="transition-colors hover:text-ink"
          >
            {copy.terms}
          </Link>
          <Link
            href={localizedPath(locale, "/refund")}
            className="transition-colors hover:text-ink"
          >
            {copy.refund}
          </Link>
        </div>
      </footer>
    </div>
  );
}
