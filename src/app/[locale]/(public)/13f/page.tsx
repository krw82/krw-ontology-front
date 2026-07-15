import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import JsonLdScript from "@/components/JsonLdScript";
import PublicRelatedLinks from "@/components/PublicRelatedLinks";
import PublicTopNav from "@/components/PublicTopNav";
import { isLocale, type Locale } from "@/i18n/config";
import { localizedPageMetadata } from "@/i18n/metadata";
import { localizedPath } from "@/i18n/routing";
import { absoluteUrl, SITE_NAME } from "@/lib/marketing/site";
import { listCurated13FManagerPages } from "@/lib/sec-13f/seo";
import { getCspNonce } from "@/lib/security/csp-nonce";

type ThirteenFPageProps = {
  params: Promise<{ locale: string }>;
};

const pageCopy = {
  ko: {
    title: "기관 13F 보유 공시",
    description:
      "국민연금, 버크셔 해서웨이, 블랙록, ARK 등 주요 기관투자자의 SEC 13F 보유 공시를 manager별로 확인하세요.",
    home: "홈",
    breadcrumb: "13F 보유 공시",
    eyebrow: "SEC 13F",
    heading: "유명 기관투자자의 13F 보유 공시를 확인하세요.",
    intro:
      "13F는 분기 말 기준 기관투자자의 미국 상장주식 보유 스냅샷입니다. 현재의 투자 판단을 대신하는 자료가 아니라, 어떤 회사와 리서치 질문을 더 확인할지 정하는 출발점으로 사용하세요.",
    managerHeading: "주요 13F filer",
    managerBody:
      "검색 수요가 높은 기관부터 공개 SEO 페이지로 제공합니다. 각 manager 페이지에서 최신 보유, 상위 비중, 분기 리밸런싱을 확인할 수 있습니다.",
    openManager: "13F 보기",
    factsHeading: "13F를 볼 때 기억할 점",
    facts: [
      {
        title: "분기 말 스냅샷",
        body: "13F는 현재 포트폴리오가 아니라 보고 기준일의 보유 현황입니다.",
      },
      {
        title: "공개 지연",
        body: "일반적으로 분기 말 이후 45일 안에 제출되므로 공개 시점에는 보유가 달라졌을 수 있습니다.",
      },
      {
        title: "리서치 질문의 출발점",
        body: "누가 들고 있는지보다 왜 그 종목을 더 확인해야 하는지 공시 근거로 이어가는 것이 중요합니다.",
      },
    ],
    faqHeading: "13F 자주 묻는 질문",
    faq: [
      {
        question: "13F 보유 공시는 어떻게 해석하나요?",
        answer:
          "13F는 기관투자자의 과거 보유 스냅샷입니다. 현재의 투자 판단이나 향후 결과를 보장하지 않으며, KRW.O에서는 이를 회사 리서치 질문을 만드는 참고 자료로 다룹니다.",
      },
      {
        question: "13F에서 어떤 정보를 볼 수 있나요?",
        answer:
          "manager, 보고 기준일, issuer, CUSIP, 보유 주식 수, 보유 시가, 포트폴리오 비중, 직전 분기 대비 변화 등을 확인할 수 있습니다.",
      },
    ],
  },
  en: {
    title: "Institutional 13F holdings",
    description:
      "Review SEC 13F holdings for National Pension Service, Berkshire Hathaway, BlackRock, ARK, and other institutional managers.",
    home: "Home",
    breadcrumb: "13F holdings",
    eyebrow: "SEC 13F",
    heading: "Review public 13F holdings from major institutional investors.",
    intro:
      "Form 13F is a quarter-end snapshot of U.S. listed equity holdings. Treat it as a starting point for research questions, not as a substitute for an investment decision.",
    managerHeading: "Featured 13F filers",
    managerBody:
      "KRW.O starts with high-demand institutional managers and links each public page to holdings, weights, and quarterly rebalancing context.",
    openManager: "View 13F",
    factsHeading: "How to read 13F data",
    facts: [
      {
        title: "Quarter-end snapshot",
        body: "13F shows holdings as of the report period, not a live portfolio.",
      },
      {
        title: "Disclosure delay",
        body: "Filings are generally submitted within 45 days after quarter end, so positions may have changed by publication.",
      },
      {
        title: "Research input",
        body: "The useful question is not only who holds a stock, but what filing evidence should be checked next.",
      },
    ],
    faqHeading: "13F FAQ",
    faq: [
      {
        question: "How should I interpret a 13F filing?",
        answer:
      "A 13F filing is a historical holdings snapshot. It does not make the investment decision or guarantee future results. KRW.O treats it as a source for follow-up company research questions.",
      },
      {
        question: "What can I see in 13F data?",
        answer:
          "You can review the manager, report period, issuer, CUSIP, shares, market value, portfolio weight, and changes versus the previous quarter.",
      },
    ],
  },
} satisfies Record<
  Locale,
  {
    title: string;
    description: string;
    home: string;
    breadcrumb: string;
    eyebrow: string;
    heading: string;
    intro: string;
    managerHeading: string;
    managerBody: string;
    openManager: string;
    factsHeading: string;
    facts: Array<{ title: string; body: string }>;
    faqHeading: string;
    faq: Array<{ question: string; answer: string }>;
  }
>;

export async function generateMetadata({
  params,
}: ThirteenFPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return localizedPageMetadata({
    locale,
    title: pageCopy[locale].title,
    description: pageCopy[locale].description,
    path: "/13f",
  });
}

export default async function ThirteenFPage({ params }: ThirteenFPageProps) {
  const nonce = await getCspNonce();
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const copy = pageCopy[locale];
  const managers = listCurated13FManagerPages(locale);
  const pageUrl = absoluteUrl(localizedPath(locale, "/13f"));
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        name: copy.title,
        description: copy.description,
        url: pageUrl,
        isPartOf: {
          "@type": "WebSite",
          name: SITE_NAME,
          url: absoluteUrl(localizedPath(locale)),
        },
        mainEntity: {
          "@type": "ItemList",
          itemListElement: managers.map((manager, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: manager.shortName,
            url: absoluteUrl(localizedPath(locale, `/13f/managers/${manager.slug}`)),
          })),
        },
      },
      breadcrumbJsonLd(locale, copy),
      faqJsonLd(copy.faq),
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
          <nav className="mb-6 text-[13px] font-bold leading-5 text-muted">
            <Link href={localizedPath(locale)} className="hover:text-primary">
              {copy.home}
            </Link>
            <span className="mx-2 text-outline-variant">/</span>
            <span className="text-ink">{copy.breadcrumb}</span>
          </nav>

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
          </header>

          <section className="border-b border-hairline py-8">
            <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-primary">
                  13F directory
                </p>
                <h2 className="mt-2 text-[22px] font-black leading-7 text-ink">
                  {copy.managerHeading}
                </h2>
              </div>
              <p className="w-full max-w-[36rem] text-[13px] font-medium leading-6 text-muted md:w-[520px] md:max-w-none md:shrink-0 md:text-right">
                {copy.managerBody}
              </p>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {managers.map((page) => (
                <Link
                  key={page.manager.cik}
                  href={localizedPath(locale, `/13f/managers/${page.slug}`)}
                  className="group flex min-h-[184px] flex-col rounded-[8px] border border-hairline bg-canvas p-base transition-colors hover:border-primary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  <span className="font-mono text-[11px] font-black uppercase tracking-[0.14em] text-primary">
                    {page.manager.countryCode || "13F"} · CIK {page.manager.cik}
                  </span>
                  <span className="mt-3 text-[20px] font-black leading-7 text-ink">
                    {page.shortName}
                  </span>
                  {page.personName ? (
                    <span className="mt-1 text-[13px] font-bold leading-5 text-muted">
                      {page.personName}
                    </span>
                  ) : null}
                  <span className="mt-3 line-clamp-3 text-[13px] font-medium leading-6 text-body">
                    {page.focus}
                  </span>
                  <span className="mt-auto pt-4 text-[13px] font-extrabold leading-5 text-primary">
                    {copy.openManager}
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <section className="border-b border-hairline py-8">
            <h2 className="text-[22px] font-black leading-7 text-ink">
              {copy.factsHeading}
            </h2>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {copy.facts.map((fact) => (
                <article
                  key={fact.title}
                  className="rounded-[8px] border border-hairline bg-canvas p-base"
                >
                  <h3 className="text-[15px] font-black leading-6 text-ink">
                    {fact.title}
                  </h3>
                  <p className="mt-2 text-[13px] font-medium leading-6 text-body">
                    {fact.body}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <section className="border-b border-hairline py-8">
            <h2 className="text-[22px] font-black leading-7 text-ink">
              {copy.faqHeading}
            </h2>
            <div className="mt-4 divide-y divide-hairline rounded-[8px] border border-hairline bg-canvas">
              {copy.faq.map((item) => (
                <article key={item.question} className="p-base">
                  <h3 className="text-[15px] font-black leading-6 text-ink">
                    {item.question}
                  </h3>
                  <p className="mt-2 text-[13px] font-medium leading-6 text-body">
                    {item.answer}
                  </p>
                </article>
              ))}
            </div>
          </section>

          <PublicRelatedLinks currentPath="/13f" locale={locale} />
        </div>
      </main>
    </div>
  );
}

function breadcrumbJsonLd(locale: Locale, copy: (typeof pageCopy)[Locale]) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: copy.home,
        item: absoluteUrl(localizedPath(locale)),
      },
      {
        "@type": "ListItem",
        position: 2,
        name: copy.breadcrumb,
        item: absoluteUrl(localizedPath(locale, "/13f")),
      },
    ],
  };
}

function faqJsonLd(faq: Array<{ question: string; answer: string }>) {
  return {
    "@type": "FAQPage",
    mainEntity: faq.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
  };
}
