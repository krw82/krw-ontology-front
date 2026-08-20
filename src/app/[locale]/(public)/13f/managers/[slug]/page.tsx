import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import JsonLdScript from "@/components/JsonLdScript";
import PublicRelatedLinks from "@/components/PublicRelatedLinks";
import PublicTopNav from "@/components/PublicTopNav";
import { SUPPORTED_LOCALES, isLocale, type Locale } from "@/i18n/config";
import { localizedPageMetadata } from "@/i18n/metadata";
import { localizedPath } from "@/i18n/routing";
import { absoluteUrl, SITE_NAME } from "@/lib/marketing/site";
import {
  allCurated13FManagerSlugs,
  findCurated13FManagerPageBySlug,
} from "@/lib/sec-13f/seo";
import { getInstitutionalHoldingsDashboard } from "@/lib/sec-13f/service";
import type { InstitutionalHoldingView } from "@/lib/sec-13f/types";
import { getCspNonce } from "@/lib/security/csp-nonce";

type ManagerPageProps = {
  params: Promise<{ locale: string; slug: string }>;
};

const managerCopy = {
  ko: {
    home: "홈",
    index: "13F 보유 공시",
    notFoundTitle: "13F manager를 찾지 못했습니다",
    notFoundDescription: "현재 공개 13F 페이지로 제공하지 않는 manager입니다.",
    eyebrow: "SEC 13F manager",
    titleSuffix: "13F 보유 공시",
    ctaDashboard: "대시보드로 보기",
    introSuffix:
      "의 최신 SEC 13F 보유 상위 종목과 분기 리밸런싱을 확인합니다. 13F는 현재 포트폴리오가 아니라 보고 기준일의 보유 스냅샷입니다.",
    watchHeading: "이 manager의 13F에서 볼 것",
    watchIntro: "보유 변화 자체보다, 어떤 회사 질문으로 이어지는지가 중요합니다.",
    questionsHeading: "대표 질문",
    questionsIntro: "아래 질문은 13F에서 회사 공시 리서치로 이어가기 좋은 출발점입니다.",
    summaryHeading: "공시 요약",
    reportPeriod: "보고 기준일",
    filingDate: "제출일",
    topValue: "상위 보유 시가",
    top10Weight: "Top 10 비중",
    noFiling: "저장된 13F 스냅샷이 없습니다.",
    holdingsHeading: "상위 보유 종목",
    holdingsDescription: "보유 시가 기준으로 정렬한 공개 13F information table 요약입니다.",
    issuer: "종목",
    value: "보유 시가",
    weight: "비중",
    change: "변화",
    companyLinkCta: "회사 보기",
    rebalancingHeading: "분기 리밸런싱 단서",
    newPurchases: "신규 편입",
    buys: "비중 증가",
    sells: "비중 감소",
    limitsHeading: "13F 해석 유의사항",
    limits: [
      "13F는 분기 말 이후 공개되므로 현재 보유와 다를 수 있습니다.",
      "공매도, 일부 해외 보유, 비공개 처리 요청 항목은 보이지 않을 수 있습니다.",
      "KRW.O에서는 13F를 투자 판단이 아니라 후속 공시 리서치 질문을 만드는 입력으로 다룹니다.",
    ],
    faqHeading: "자주 묻는 질문",
    faqQuestion: "이 13F 페이지는 어떤 목적으로 쓰나요?",
    faqAnswer:
      "특정 manager가 어떤 미국 상장주식을 보유했는지 확인한 뒤, 해당 종목의 사업 공시와 리스크를 더 깊게 확인할 질문을 만드는 데 사용합니다.",
  },
  en: {
    home: "Home",
    index: "13F holdings",
    notFoundTitle: "13F manager not found",
    notFoundDescription: "This manager is not currently available as a public 13F page.",
    eyebrow: "SEC 13F manager",
    titleSuffix: "13F holdings",
    ctaDashboard: "Open dashboard",
    introSuffix:
      "'s latest SEC 13F top holdings and quarterly rebalancing. 13F data is a report-period snapshot, not a live portfolio.",
    watchHeading: "What to watch in this manager's 13F",
    watchIntro:
      "The useful signal is not the holding change alone, but the company question it creates.",
    questionsHeading: "Representative questions",
    questionsIntro:
      "Use these as starting points to move from a 13F signal into company filing research.",
    summaryHeading: "Filing summary",
    reportPeriod: "Report period",
    filingDate: "Filing date",
    topValue: "Top holdings value",
    top10Weight: "Top 10 weight",
    noFiling: "No stored 13F snapshot is available yet.",
    holdingsHeading: "Top holdings",
    holdingsDescription: "Public 13F information table summary sorted by reported market value.",
    issuer: "Issuer",
    value: "Market value",
    weight: "Weight",
    change: "Change",
    companyLinkCta: "View company",
    rebalancingHeading: "Quarterly rebalancing signals",
    newPurchases: "New positions",
    buys: "Weight increases",
    sells: "Weight decreases",
    limitsHeading: "How to interpret 13F data",
    limits: [
      "13F data is published after quarter end, so holdings may have changed.",
      "Short positions, some non-U.S. holdings, and confidential treatment items may not be visible.",
      "KRW.O treats 13F as input for follow-up filing research, not as a substitute for an investment decision.",
    ],
    faqHeading: "FAQ",
    faqQuestion: "What is this 13F page for?",
    faqAnswer:
      "Use it to see which U.S. listed equities a manager disclosed, then turn those holdings into follow-up company and risk research questions.",
  },
} satisfies Record<Locale, Record<string, string | string[]>>;

export function generateStaticParams() {
  return SUPPORTED_LOCALES.flatMap((locale) =>
    allCurated13FManagerSlugs().map((slug) => ({ locale, slug })),
  );
}

export async function generateMetadata({
  params,
}: ManagerPageProps): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();

  const page = findCurated13FManagerPageBySlug(slug, locale);
  if (!page) {
    return localizedPageMetadata({
      locale,
      title: managerCopy[locale].notFoundTitle as string,
      description: managerCopy[locale].notFoundDescription as string,
      path: `/13f/managers/${slug}`,
      noIndex: true,
    });
  }

  return localizedPageMetadata({
    locale,
    title: `${page.shortName} ${managerCopy[locale].titleSuffix}`,
    description: managerDescription(locale, page.shortName, page.focus),
    path: `/13f/managers/${page.slug}`,
  });
}

export default async function Manager13FPage({ params }: ManagerPageProps) {
  const nonce = await getCspNonce();
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();

  const page = findCurated13FManagerPageBySlug(slug, locale);
  if (!page) notFound();

  const copy = managerCopy[locale];
  const dashboard = await getInstitutionalHoldingsDashboard(page.manager.cik).catch(
    () => null,
  );
  const holdings = dashboard?.holdings ?? [];
  const interpretationLimits = [...page.limits, ...(copy.limits as string[])];
  const pageTitle = `${page.shortName} ${copy.titleSuffix}`;
  const description = managerDescription(locale, page.shortName, page.focus);
  const pageUrl = absoluteUrl(localizedPath(locale, `/13f/managers/${page.slug}`));
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: pageTitle,
        description,
        url: pageUrl,
        isPartOf: {
          "@type": "WebSite",
          name: SITE_NAME,
          url: absoluteUrl(localizedPath(locale)),
        },
        about: {
          "@type": "Organization",
          name: page.manager.name,
          alternateName: page.shortName,
          identifier: page.manager.cik,
        },
        mainEntity: holdingsItemListJsonLd(locale, page.shortName, holdings),
      },
      managerQuestionItemListJsonLd(locale, page.shortName, page.questions),
      breadcrumbJsonLd(locale, page.shortName, page.slug, copy),
      faqJsonLd(copy.faqQuestion as string, copy.faqAnswer as string),
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
            <Link
              href={localizedPath(locale, "/13f")}
              className="hover:text-primary"
            >
              {copy.index}
            </Link>
            <span className="mx-2 text-outline-variant">/</span>
            <span className="text-ink">{page.shortName}</span>
          </nav>

          <header className="border-b border-hairline pb-8">
            <p className="font-mono text-[12px] font-bold uppercase tracking-[0.16em] text-primary">
              {copy.eyebrow} · CIK {page.manager.cik}
            </p>
            <h1 className="mt-3 max-w-4xl text-balance text-[34px] font-black leading-[1.08] tracking-normal text-ink sm:text-[48px]">
              {pageTitle}
            </h1>
            <p className="mt-4 max-w-3xl text-[16px] leading-7 text-body sm:text-[18px]">
              {page.shortName}
              {copy.introSuffix}
            </p>
            <p className="mt-3 max-w-3xl text-[15px] font-semibold leading-7 text-body">
              {page.profile}
            </p>
            <div className="mt-6">
              <Link
                href={`/institutional-holdings?cik=${encodeURIComponent(page.manager.cik)}`}
                className="inline-flex min-h-12 items-center justify-center rounded-[8px] bg-surface-dark px-5 py-3 text-[15px] font-extrabold leading-5 text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                {copy.ctaDashboard}
              </Link>
            </div>
          </header>

          <section className="grid gap-4 border-b border-hairline py-8 md:grid-cols-2">
            <article className="rounded-[8px] border border-hairline bg-canvas p-base">
              <p className="font-mono text-[11px] font-black uppercase tracking-[0.14em] text-primary">
                Watch
              </p>
              <h2 className="mt-2 text-[22px] font-black leading-7 text-ink">
                {copy.watchHeading}
              </h2>
              <p className="mt-2 text-[13px] font-bold leading-6 text-muted">
                {copy.watchIntro}
              </p>
              <ul className="mt-4 space-y-3">
                {page.watchPoints.map((point) => (
                  <li
                    key={point}
                    className="grid grid-cols-[22px_minmax(0,1fr)] gap-2 text-[13px] font-semibold leading-6 text-body"
                  >
                    <span className="font-mono text-primary">-</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </article>

            <article className="rounded-[8px] border border-hairline bg-surface p-base">
              <p className="font-mono text-[11px] font-black uppercase tracking-[0.14em] text-primary">
                Questions
              </p>
              <h2 className="mt-2 text-[22px] font-black leading-7 text-ink">
                {copy.questionsHeading}
              </h2>
              <p className="mt-2 text-[13px] font-bold leading-6 text-muted">
                {copy.questionsIntro}
              </p>
              <ol className="mt-4 space-y-3">
                {page.questions.map((question, index) => (
                  <li
                    key={question}
                    className="grid grid-cols-[28px_minmax(0,1fr)] gap-2 text-[13px] font-bold leading-6 text-body"
                  >
                    <span className="font-mono text-primary">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>{question}</span>
                  </li>
                ))}
              </ol>
            </article>
          </section>

          <section className="border-b border-hairline py-8">
            <h2 className="text-[22px] font-black leading-7 text-ink">
              {copy.summaryHeading}
            </h2>
            {dashboard?.filing ? (
              <div className="mt-4 grid gap-3 md:grid-cols-4">
                <Metric
                  label={copy.reportPeriod as string}
                  value={formatDate(dashboard.filing.reportPeriod, locale)}
                  detail={dashboard.filing.form}
                />
                <Metric
                  label={copy.filingDate as string}
                  value={formatDate(dashboard.filing.filingDate, locale)}
                  detail={dashboard.filing.accessionNumber}
                />
                <Metric
                  label={copy.topValue as string}
                  value={formatUsd(dashboard.stats.totalValueUsd, locale)}
                  detail={`${dashboard.stats.totalPositions.toLocaleString()} positions`}
                />
                <Metric
                  label={copy.top10Weight as string}
                  value={formatPercent(dashboard.stats.top10Weight, locale)}
                  detail={dashboard.previousFiling ? formatDate(dashboard.previousFiling.reportPeriod, locale) : "-"}
                />
              </div>
            ) : (
              <p className="mt-4 rounded-[8px] border border-hairline bg-surface p-base text-[14px] font-semibold leading-6 text-body">
                {copy.noFiling}
              </p>
            )}
          </section>

          <section className="border-b border-hairline py-8">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-[22px] font-black leading-7 text-ink">
                  {copy.holdingsHeading}
                </h2>
                <p className="mt-1 text-[13px] font-bold leading-5 text-muted">
                  {copy.holdingsDescription}
                </p>
              </div>
            </div>
            {holdings.length > 0 ? (
              <div className="mt-4 overflow-hidden rounded-[8px] border border-hairline bg-canvas">
                <div className="grid grid-cols-[minmax(160px,1fr)_120px_88px_100px] border-b border-hairline bg-surface px-sm py-2.5 font-mono text-[11px] font-black uppercase tracking-[0.12em] text-muted">
                  <span>{copy.issuer}</span>
                  <span className="text-right">{copy.value}</span>
                  <span className="text-right">{copy.weight}</span>
                  <span className="text-right">{copy.change}</span>
                </div>
                <div className="divide-y divide-hairline">
                  {holdings.slice(0, 12).map((holding) => (
                    <HoldingRow
                      key={holding.id}
                      holding={holding}
                      locale={locale}
                      ctaLabel={copy.companyLinkCta as string}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <p className="mt-4 rounded-[8px] border border-hairline bg-surface p-base text-[14px] font-semibold leading-6 text-body">
                {copy.noFiling}
              </p>
            )}
          </section>

          {dashboard &&
          (dashboard.rebalancing.newPurchases.length > 0 ||
            dashboard.rebalancing.buys.length > 0 ||
            dashboard.rebalancing.sells.length > 0) ? (
            <section className="border-b border-hairline py-8">
              <h2 className="text-[22px] font-black leading-7 text-ink">
                {copy.rebalancingHeading}
              </h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {dashboard.rebalancing.newPurchases.length > 0 ? (
                  <RebalanceList
                    title={copy.newPurchases as string}
                    holdings={dashboard.rebalancing.newPurchases}
                    locale={locale}
                  />
                ) : null}
                <RebalanceList
                  title={copy.buys as string}
                  holdings={dashboard.rebalancing.buys}
                  locale={locale}
                />
                <RebalanceList
                  title={copy.sells as string}
                  holdings={dashboard.rebalancing.sells}
                  locale={locale}
                />
              </div>
            </section>
          ) : null}

          <section className="border-b border-hairline py-8">
            <h2 className="text-[22px] font-black leading-7 text-ink">
              {copy.limitsHeading}
            </h2>
            <ul className="mt-4 grid gap-3 md:grid-cols-3">
              {interpretationLimits.map((item) => (
                <li
                  key={item}
                  className="rounded-[8px] border border-hairline bg-canvas p-base text-[13px] font-medium leading-6 text-body"
                >
                  {item}
                </li>
              ))}
            </ul>
          </section>

          <section className="border-b border-hairline py-8">
            <h2 className="text-[22px] font-black leading-7 text-ink">
              {copy.faqHeading}
            </h2>
            <article className="mt-4 rounded-[8px] border border-hairline bg-canvas p-base">
              <h3 className="text-[15px] font-black leading-6 text-ink">
                {copy.faqQuestion}
              </h3>
              <p className="mt-2 text-[13px] font-medium leading-6 text-body">
                {copy.faqAnswer}
              </p>
            </article>
          </section>

          <PublicRelatedLinks locale={locale} />
        </div>
      </main>
    </div>
  );
}

function managerDescription(locale: Locale, shortName: string, focus: string): string {
  if (locale === "ko") {
    return `${shortName} 13F 보유 공시를 SEC EDGAR 원본 기준으로 확인하세요. ${focus}와 상위 보유, 비중 변화, 리밸런싱 단서를 정리합니다.`;
  }

  return `Review ${shortName} 13F holdings from SEC EDGAR filings, including top positions, portfolio weights, and quarterly rebalancing context.`;
}

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-[8px] border border-hairline bg-canvas p-base">
      <p className="text-[12px] font-extrabold leading-5 text-muted">{label}</p>
      <p className="mt-2 text-[22px] font-black leading-7 text-ink">{value}</p>
      <p className="mt-1 truncate text-[11px] font-semibold leading-4 text-muted">
        {detail}
      </p>
    </div>
  );
}

function HoldingRow({
  holding,
  locale,
  ctaLabel,
}: {
  holding: InstitutionalHoldingView;
  locale: Locale;
  ctaLabel: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(160px,1fr)_120px_88px_100px] items-center gap-2 px-sm py-3 text-[13px] leading-5">
      <div className="min-w-0">
        <p className="truncate font-black text-ink">{holding.displayName}</p>
        <p className="mt-0.5 truncate font-mono text-[11px] font-bold text-muted">
          {holding.ticker ?? holding.cusip}
        </p>
        {holding.ticker ? (
          <Link
            href={localizedPath(locale, `/companies/${holding.ticker}`)}
            className="mt-1 inline-flex text-[11px] font-extrabold leading-4 text-primary hover:text-primary-active"
          >
            {ctaLabel}
          </Link>
        ) : null}
      </div>
      <span className="text-right font-bold text-body">
        {formatUsd(holding.valueUsd, locale)}
      </span>
      <span className="text-right font-bold text-body">
        {formatPercent(holding.portfolioWeight, locale)}
      </span>
      <span className="text-right font-bold text-muted">
        {changeLabel(holding.changeType, locale)}
      </span>
    </div>
  );
}

function RebalanceList({
  title,
  holdings,
  locale,
}: {
  title: string;
  holdings: InstitutionalHoldingView[];
  locale: Locale;
}) {
  return (
    <section className="rounded-[8px] border border-hairline bg-canvas">
      <h3 className="border-b border-hairline px-sm py-3 text-[15px] font-black leading-6 text-ink">
        {title}
      </h3>
      <div className="divide-y divide-hairline">
        {holdings.length > 0 ? (
          holdings.map((holding) => (
            <div key={holding.id} className="px-sm py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[14px] font-black leading-5 text-ink">
                    {holding.displayName}
                  </p>
                  <p className="mt-1 font-mono text-[11px] font-bold leading-4 text-muted">
                    {holding.ticker ?? holding.cusip}
                  </p>
                </div>
                <p className="shrink-0 text-right text-[13px] font-black leading-5 text-primary">
                  {holding.portfolioWeightChange === null
                    ? "-"
                    : formatPercent(holding.portfolioWeightChange, locale, true)}
                </p>
              </div>
            </div>
          ))
        ) : (
          <p className="px-sm py-3 text-[13px] font-medium leading-6 text-muted">
            -
          </p>
        )}
      </div>
    </section>
  );
}

function formatDate(value: string, locale: Locale): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function formatUsd(value: number, locale: Locale): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toLocaleString(
      locale === "ko" ? "ko-KR" : "en-US",
      { maximumFractionDigits: 1 },
    )}B`;
  }
  if (Math.abs(value) >= 1_000_000) {
    return `$${(value / 1_000_000).toLocaleString(
      locale === "ko" ? "ko-KR" : "en-US",
      { maximumFractionDigits: 1 },
    )}M`;
  }
  return `$${value.toLocaleString(locale === "ko" ? "ko-KR" : "en-US", {
    maximumFractionDigits: 0,
  })}`;
}

function formatPercent(
  value: number,
  locale: Locale,
  showSign = false,
): string {
  const percent = value * 100;
  const formatted = percent.toLocaleString(locale === "ko" ? "ko-KR" : "en-US", {
    maximumFractionDigits: 2,
  });
  if (!showSign || percent === 0) return `${formatted}%`;
  return `${percent > 0 ? "+" : ""}${formatted}%`;
}

function changeLabel(
  value: InstitutionalHoldingView["changeType"],
  locale: Locale,
): string {
  const labels = {
    ko: {
      new: "신규",
      increased: "증가",
      decreased: "감소",
      unchanged: "유지",
      sold: "보유 종료",
    },
    en: {
      new: "New",
      increased: "Increased",
      decreased: "Decreased",
      unchanged: "Unchanged",
      sold: "Sold",
    },
  } as const;

  return labels[locale][value];
}

function holdingsItemListJsonLd(
  locale: Locale,
  managerName: string,
  holdings: InstitutionalHoldingView[],
) {
  return {
    "@type": "ItemList",
    name:
      locale === "ko"
        ? `${managerName} 13F 상위 보유 종목`
        : `${managerName} top 13F holdings`,
    numberOfItems: holdings.length,
    itemListElement: holdings.slice(0, 12).map((holding, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: holding.displayName,
      identifier: holding.ticker ?? holding.cusip,
    })),
  };
}

function managerQuestionItemListJsonLd(
  locale: Locale,
  managerName: string,
  questions: string[],
) {
  return {
    "@type": "ItemList",
    name:
      locale === "ko"
        ? `${managerName} 13F 대표 리서치 질문`
        : `${managerName} representative 13F research questions`,
    itemListElement: questions.map((question, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: question,
    })),
  };
}

function breadcrumbJsonLd(
  locale: Locale,
  managerName: string,
  slug: string,
  copy: (typeof managerCopy)[Locale],
) {
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
        name: copy.index,
        item: absoluteUrl(localizedPath(locale, "/13f")),
      },
      {
        "@type": "ListItem",
        position: 3,
        name: managerName,
        item: absoluteUrl(localizedPath(locale, `/13f/managers/${slug}`)),
      },
    ],
  };
}

function faqJsonLd(question: string, answer: string) {
  return {
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: question,
        acceptedAnswer: {
          "@type": "Answer",
          text: answer,
        },
      },
    ],
  };
}
