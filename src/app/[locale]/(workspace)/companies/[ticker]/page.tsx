import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import CompanyLogo from "@/components/CompanyLogo";
import CompanyInsiderTransactions from "@/components/CompanyInsiderTransactions";
import CompanyRecentImportantFilings from "@/components/CompanyRecentImportantFilings";
import CompanyWatchlistActions from "@/components/CompanyWatchlistActions";
import InstitutionalTickerActivity from "@/components/InstitutionalTickerActivity";
import JsonLdScript from "@/components/JsonLdScript";
import MarketingCtaLink from "@/components/MarketingCtaLink";
import SuggestedPromptActions from "@/components/SuggestedPromptActions";
import CompanyGuruLensPicker from "@/components/guru/CompanyGuruLensPicker";
import {
  getCompanyDisplayCopyForTicker,
  getSuggestedPromptDisplaysForTickers,
} from "@/content/companies/display";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { localizedPageMetadata } from "@/i18n/metadata";
import { localizedPath } from "@/i18n/routing";
import { getAuthUser } from "@/lib/auth";
import { getIndexedCompany } from "@/lib/ontology/catalog";
import { normalizeTicker } from "@/lib/ontology/ticker";
import {
  absoluteUrl,
  buildCompanyOgImagePath,
  SITE_NAME,
} from "@/lib/marketing/site";
import { getCspNonce } from "@/lib/security/csp-nonce";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getInstitutionalTickerActivity } from "@/lib/sec-13f/service";
import { getLatestAccessibleImportantFiling } from "@/lib/onboarding/latest-important-filing";
import {
  normalizeCoverageContinuePath,
  type CoverageOnboardingFiling,
} from "@/lib/onboarding/coverage-flow";
import { isFirstValueEntry } from "@/lib/onboarding/first-value";
import { ONBOARDING_START_ENTRY } from "@/lib/onboarding/start-flow";
import { getRecentCompanyInsiderTransactions } from "@/lib/filing-notifications/company-insider-transactions";
import { getRecentCompanyImportantFilings } from "@/lib/filing-notifications/company-important-filings";
import type { UserCompanyMarkRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CompanyPageProps = {
  params: Promise<{ locale: string; ticker: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function chatHref(
  ticker: string,
  query?: string,
  locale?: Locale,
  entry?: string,
): string {
  const params = new URLSearchParams({ ticker });
  if (query) params.set("query", query);
  if (entry) params.set("entry", entry);
  if (locale && locale !== DEFAULT_LOCALE) params.set("locale", locale);
  return `/chat/new?${params.toString()}`;
}

export async function generateMetadata({
  params,
}: CompanyPageProps): Promise<Metadata> {
  const { locale, ticker: rawTicker } = await params;
  if (!isLocale(locale)) notFound();

  const ticker = normalizeTicker(rawTicker);
  const company = ticker ? await getIndexedCompany(ticker) : null;

  if (!company) {
    return localizedPageMetadata({
      locale,
      title: locale === "ko" ? "회사를 찾지 못했습니다" : "Company not found",
      description:
        locale === "ko"
          ? "현재 KRW.O 인덱스에서 찾을 수 없는 회사입니다."
          : "This company is not currently available in the KRW.O index.",
      path: `/companies/${rawTicker}`,
      noIndex: true,
    });
  }

  const copy = getCompanyDisplayCopyForTicker(locale, company.ticker);
  const displayCompany = { ...company, ...copy };
  const companyNameKo = displayCompany.companyNameKo;
  const companyTitleName = companyNameKo ?? displayCompany.name;

  return localizedPageMetadata({
    locale,
    title:
      locale === "ko"
        ? `${displayCompany.ticker} ${companyTitleName} 공시 기반 기업 분석`
        : `${displayCompany.ticker} ${displayCompany.name} filing-grounded company analysis`,
    description:
      locale === "ko"
        ? `${displayCompany.name}${companyNameKo ? ` · ${companyNameKo}` : ""} (${displayCompany.ticker})의 실적 변화, 리스크, 사업 활동을 공시 근거 기반으로 질문해보세요.`
        : `Research ${displayCompany.name} (${displayCompany.ticker}) performance changes, risks, and business activity with filing-grounded evidence.`,
    path: `/companies/${displayCompany.ticker}`,
    image: {
      url: buildCompanyOgImagePath(displayCompany.ticker, locale),
      alt: `${displayCompany.ticker} ${companyTitleName} | ${SITE_NAME}`,
    },
  });
}

export default async function CompanyLandingPage({
  params,
  searchParams,
}: CompanyPageProps) {
  const nonce = await getCspNonce();
  const query = await searchParams;
  const { locale, ticker: rawTicker } = await params;
  if (!isLocale(locale)) notFound();

  const ticker = normalizeTicker(rawTicker);
  const [company, user] = await Promise.all([
    ticker ? getIndexedCompany(ticker) : Promise.resolve(null),
    getAuthUser().catch(() => null),
  ]);

  if (!company) notFound();

  const coverageOnboarding =
    (Array.isArray(query.onboarding)
      ? query.onboarding[0]
      : query.onboarding) === "coverage";
  // Legacy first-value links remain valid, but previewing the new first-user
  // flow now happens at `/[locale]/start?preview=always` instead of appearing
  // on every local company page.
  const firstValueEntry = isFirstValueEntry(
    Array.isArray(query.entry) ? query.entry[0] : query.entry,
  );
  const firstValueEntryName = Array.isArray(query.entry)
    ? query.entry[0] ?? null
    : query.entry ?? null;
  const onboardingContinuePath = normalizeCoverageContinuePath(
    Array.isArray(query.continue) ? query.continue[0] : query.continue,
  );
  const [
    institutionalActivity,
    latestImportantFiling,
    insiderTransactions,
    recentImportantFilings,
  ] =
    await Promise.all([
      getInstitutionalTickerActivity(company.ticker).catch(() => []),
      user && (coverageOnboarding || firstValueEntry)
        ? getLatestAccessibleImportantFiling(user.id, company.ticker)
        : Promise.resolve(null),
      getRecentCompanyInsiderTransactions(company.ticker).catch(() => []),
      getRecentCompanyImportantFilings(company.ticker).catch(() => []),
    ]);

  let savedMark: Pick<
    UserCompanyMarkRow,
    "coverage_level"
  > | null = null;
  if (user) {
    const { data } = await getSupabaseAdmin()
      .from("user_company_marks")
      .select("coverage_level")
      .eq("user_id", user.id)
      .eq("ticker", company.ticker)
      .maybeSingle<Pick<UserCompanyMarkRow, "coverage_level">>();
    savedMark = data ?? null;
  }

  const prompts = getSuggestedPromptDisplaysForTickers(locale, [
    company.ticker,
  ]);
  const promptHrefs = prompts.map((prompt) =>
    chatHref(company.ticker, prompt, locale),
  );
  const copy = getCompanyDisplayCopyForTicker(locale, company.ticker);
  const displayCompany = { ...company, ...copy };
  const companyNameKo = displayCompany.companyNameKo;
  const companyTitleName = companyNameKo ?? displayCompany.name;
  const pageCopy =
    locale === "ko"
      ? {
          jsonLdName: `${companyTitleName} 공시 기반 기업 분석`,
          breadcrumbCompanies: "회사 목록",
          heroHeading: `${companyTitleName} 공시 기반 리서치`,
          startCta: `${displayCompany.ticker} 분석 시작`,
          firstValueEyebrow: "첫 공시 변화",
          firstValueTitle: "최근 중요한 변화부터 확인하세요",
          firstValueDescription: "한 번의 클릭으로 요약과 SEC 원문까지 이어집니다.",
          firstValueCta: "이 변화의 근거 보기",
          firstValueUnavailable:
            "지금 바로 열 수 있는 새 중요 공시가 없습니다. 이 회사의 실적과 리스크를 공시 근거로 확인해보세요.",
          guruCta: "구루 관점으로 보기",
          watchlistInterestCta: "관심",
          watchlistInterestSaved: "관심 저장됨",
          watchlistSaving: "저장 중",
          watchlistError: "종목 상태를 저장하지 못했습니다.",
          scopeEyebrow: "분석 범위",
          scopeHeading: `${companyTitleName} 리서치 축`,
          businessActivity: "사업 활동",
          watchItem: "추적 변수",
          fallbackActivity: "회사별 사업 활동 인덱스 확인",
          fallbackRisk: "리스크 변수 인덱스 확인",
        }
      : {
          jsonLdName: `${displayCompany.name} filing-grounded company analysis`,
          breadcrumbCompanies: "Companies",
          heroHeading: `${displayCompany.name} filing-grounded research`,
          startCta: `Start ${displayCompany.ticker} analysis`,
          firstValueEyebrow: "First filing change",
          firstValueTitle: "Start with the latest important change",
          firstValueDescription: "Open the filing summary and SEC source in one short path.",
          firstValueCta: "See the evidence for this change",
          firstValueUnavailable:
            "There is no newly accessible important filing right now. Start a filing-grounded check of this company instead.",
          guruCta: "View through a Guru lens",
          watchlistInterestCta: "Watch",
          watchlistInterestSaved: "Watch saved",
          watchlistSaving: "Saving",
          watchlistError: "Could not save this company.",
          scopeEyebrow: "Analysis scope",
          scopeHeading: `${displayCompany.name} research axes`,
          businessActivity: "Business activity",
          watchItem: "Watch item",
          fallbackActivity: "Company-specific business activity index",
          fallbackRisk: "Company-specific risk variable index",
        };

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: pageCopy.jsonLdName,
        url: absoluteUrl(
          localizedPath(locale, `/companies/${displayCompany.ticker}`),
        ),
        isPartOf: {
          "@type": "WebSite",
          name: SITE_NAME,
          url: absoluteUrl(localizedPath(locale)),
        },
        about: {
          "@type": "Organization",
          name: displayCompany.name,
          alternateName: companyNameKo ?? undefined,
          tickerSymbol: displayCompany.ticker,
        },
        mainEntity: {
          "@type": "ItemList",
          name:
            locale === "ko"
              ? `${companyTitleName} 대표 리서치 질문`
              : `${displayCompany.name} representative research questions`,
          itemListElement: prompts.map((prompt, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: prompt,
            url: absoluteUrl(
              promptHrefs[index] ??
                localizedPath(locale, `/companies/${displayCompany.ticker}`),
            ),
          })),
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          {
            "@type": "ListItem",
            position: 1,
            name: pageCopy.breadcrumbCompanies,
            item: absoluteUrl(localizedPath(locale, "/companies")),
          },
          {
            "@type": "ListItem",
            position: 2,
            name: companyTitleName,
            item: absoluteUrl(
              localizedPath(locale, `/companies/${displayCompany.ticker}`),
            ),
          },
        ],
      },
    ],
  };
  const watchlistPath = `/watchlist/${displayCompany.ticker}`;
  const watchlistLoginHref = `/login?next=${encodeURIComponent(watchlistPath)}`;

  return (
    <div className="bg-canvas text-ink">
      <JsonLdScript nonce={nonce} data={jsonLd} />
      <main
        id="main-content"
        className="px-base pb-xl pt-xl sm:px-md md:px-xl md:pb-[96px] md:pt-[72px]"
      >
        <div className="mx-auto w-full max-w-5xl">
          <nav className="mb-6 text-[13px] font-bold leading-5 text-muted">
            <Link
              href={localizedPath(locale, "/companies")}
              className="hover:text-primary"
            >
              {pageCopy.breadcrumbCompanies}
            </Link>
            <span className="mx-2 text-outline-variant">/</span>
            <span className="text-ink">{companyTitleName}</span>
          </nav>

          <header className="border-b border-hairline pb-8">
            <div className="flex min-w-0 items-start gap-4 sm:gap-5">
              <CompanyLogo
                ticker={displayCompany.ticker}
                companyName={companyTitleName}
                imageSize={128}
                className="h-14 w-14 text-[13px] sm:h-16 sm:w-16"
              />
              <div className="min-w-0">
                <p className="font-mono text-[14px] font-black leading-5 tracking-[0.08em] text-primary">
                  {displayCompany.ticker}
                </p>
                <h1 className="mt-2 max-w-4xl text-balance text-[34px] font-black leading-[1.08] tracking-normal text-ink sm:text-[48px]">
                  {pageCopy.heroHeading}
                </h1>
              </div>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[auto_auto_1fr] lg:items-start">
              <MarketingCtaLink
                href={chatHref(displayCompany.ticker, undefined, locale)}
                ctaId="company_start_analysis"
                ctaLabel={pageCopy.startCta}
                surface="company_hero"
                analyticsProperties={{
                  ticker: displayCompany.ticker,
                  company_name: displayCompany.name,
                }}
                className="inline-flex min-h-12 items-center justify-center rounded-[8px] bg-surface-dark px-5 py-3 text-[15px] font-extrabold leading-5 text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                {pageCopy.startCta}
              </MarketingCtaLink>
              <CompanyGuruLensPicker
                ticker={displayCompany.ticker}
                companyName={companyTitleName}
                locale={locale}
                ctaLabel={pageCopy.guruCta}
              />
              <div className="min-w-0 sm:col-span-2 lg:col-span-1">
                <CompanyWatchlistActions
                  ticker={displayCompany.ticker}
                  isAuthenticated={Boolean(user)}
                  loginHref={watchlistLoginHref}
                  destinationHref={watchlistPath}
                  initialCoverageLevel={savedMark?.coverage_level ?? null}
                  labels={{
                    watchlist: pageCopy.watchlistInterestCta,
                    savedWatchlist: pageCopy.watchlistInterestSaved,
                    saving: pageCopy.watchlistSaving,
                    error: pageCopy.watchlistError,
                  }}
                  analyticsProperties={{
                    company_name: displayCompany.name,
                    source_surface: "company_hero",
                  }}
                  onboarding={
                    coverageOnboarding
                      ? {
                          locale,
                          latestImportantFiling,
                          memoryHref: `${watchlistPath}?${new URLSearchParams({
                            onboarding: "coverage",
                            ...(onboardingContinuePath
                              ? { continue: onboardingContinuePath }
                              : {}),
                          }).toString()}`,
                          continuePath: onboardingContinuePath,
                        }
                      : null
                  }
                />
              </div>
            </div>
            <SuggestedPromptActions
              prompts={prompts}
              groupId={`company-prompts-${displayCompany.ticker}`}
              className="mt-5"
              hrefs={promptHrefs}
              analytics={{
                sourceSurface: "company_detail",
                ticker: displayCompany.ticker,
                tickers: [displayCompany.ticker],
                promptCategory: "company_research",
                promptIds: prompts.map(
                  (_, index) =>
                    `${displayCompany.ticker.toLowerCase()}_suggested_${index + 1}`,
                ),
              }}
            />
          </header>

          {firstValueEntry && user ? (
            <FirstValueCompanyPanel
              locale={locale}
              ticker={displayCompany.ticker}
              companyName={companyTitleName}
              filing={latestImportantFiling}
              entry={
                firstValueEntryName === ONBOARDING_START_ENTRY
                  ? ONBOARDING_START_ENTRY
                  : "first_value"
              }
              copy={pageCopy}
            />
          ) : null}

          <CompanyRecentImportantFilings
            locale={locale}
            ticker={displayCompany.ticker}
            items={recentImportantFilings}
          />

          <CompanyInsiderTransactions
            locale={locale}
            ticker={displayCompany.ticker}
            items={insiderTransactions}
          />

          <InstitutionalTickerActivity
            locale={locale}
            items={institutionalActivity}
          />

          <section className="border-b border-hairline py-7">
            <div className="grid gap-5 md:grid-cols-[176px_minmax(0,1fr)] md:items-start">
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-primary">
                  {pageCopy.scopeEyebrow}
                </p>
                <h2 className="mt-2 text-[20px] font-black leading-7 text-ink sm:text-[22px]">
                  {pageCopy.scopeHeading}
                </h2>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <ScopeActionGroup
                  index="01"
                  label={pageCopy.businessActivity}
                  items={scopeItemsFromValue(
                    displayCompany.core_strength ?? pageCopy.fallbackActivity,
                  )}
                  companyName={companyTitleName}
                  locale={locale}
                  ticker={displayCompany.ticker}
                />
                <ScopeActionGroup
                  index="02"
                  label={pageCopy.watchItem}
                  items={scopeItemsFromValue(
                    displayCompany.critical_risk ?? pageCopy.fallbackRisk,
                  )}
                  companyName={companyTitleName}
                  locale={locale}
                  ticker={displayCompany.ticker}
                />
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function FirstValueCompanyPanel({
  locale,
  ticker,
  companyName,
  filing,
  entry,
  copy,
}: {
  locale: Locale;
  ticker: string;
  companyName: string;
  filing: CoverageOnboardingFiling | null;
  entry: "first_value" | typeof ONBOARDING_START_ENTRY;
  copy: {
    startCta: string;
    firstValueEyebrow: string;
    firstValueTitle: string;
    firstValueDescription: string;
    firstValueCta: string;
    firstValueUnavailable: string;
  };
}) {
  const filingHref = filing
    ? `/filings/${encodeURIComponent(filing.id)}?${new URLSearchParams({
      source: "company_onboarding",
      entry,
      ticker,
      locale,
    }).toString()}`
    : null;
  const fallbackHref = chatHref(
    ticker,
    undefined,
    locale,
    entry === ONBOARDING_START_ENTRY ? entry : undefined,
  );

  return (
    <section className="border-b border-hairline py-6 sm:py-7" aria-label={copy.firstValueEyebrow}>
      <div className="rounded-[10px] border border-primary/25 bg-primary-fixed/45 p-base sm:p-lg">
        <p className="font-mono text-[10px] font-black uppercase tracking-[0.14em] text-primary">
          {copy.firstValueEyebrow}
        </p>
        <div className="mt-2 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-[19px] font-black leading-6 text-ink">
              {copy.firstValueTitle}
            </h2>
            {filing ? (
              <p className="mt-2 text-[14px] font-bold leading-6 text-body">
                {formatFirstValueFiling(filing, locale)}
              </p>
            ) : (
              <p className="mt-2 text-[14px] leading-6 text-body">
                {copy.firstValueUnavailable}
              </p>
            )}
            <p className="mt-1 text-[12px] font-semibold leading-5 text-muted">
              {filing ? copy.firstValueDescription : companyName}
            </p>
          </div>
          <MarketingCtaLink
            href={filingHref ?? fallbackHref}
            ctaId={filingHref ? "first_value_filing" : "first_value_company_analysis"}
            ctaLabel={filingHref ? copy.firstValueCta : copy.startCta}
            surface="company_first_value"
            analyticsProperties={{
              ticker,
              filing_event_id: filing?.id ?? null,
              company_name: companyName,
            }}
            className="inline-flex min-h-12 shrink-0 items-center justify-center rounded-[8px] bg-surface-dark px-5 py-3 text-[14px] font-extrabold text-on-dark transition-colors hover:bg-primary-active focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-primary-fixed"
          >
            {filingHref ? copy.firstValueCta : copy.startCta}
            <span className="material-symbols-outlined ml-1 text-[18px]" aria-hidden="true">
              arrow_forward
            </span>
          </MarketingCtaLink>
        </div>
      </div>
    </section>
  );
}

function formatFirstValueFiling(
  filing: CoverageOnboardingFiling,
  locale: Locale,
): string {
  const date = new Date(`${filing.filing_date}T00:00:00Z`);
  const formattedDate = Number.isNaN(date.getTime())
    ? filing.filing_date
    : new Intl.DateTimeFormat(locale === "ko" ? "ko-KR" : "en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date);
  return `${formattedDate} ${filing.form_type} · ${filing.label}`;
}

function ScopeActionGroup({
  index,
  label,
  items,
  companyName,
  locale,
  ticker,
}: {
  index: string;
  label: string;
  items: string[];
  companyName: string;
  locale: Locale;
  ticker: string;
}) {
  return (
    <section className="overflow-hidden rounded-[8px] border border-hairline bg-canvas">
      <div className="flex items-baseline gap-2 border-b border-hairline bg-surface px-sm py-xs">
        <span className="font-mono text-[11px] font-black leading-none text-primary">
          {index}
        </span>
        <span className="text-[12px] font-extrabold leading-5 text-muted">
          {label}
        </span>
      </div>
      <div className="divide-y divide-hairline">
        {items.map((item, itemIndex) => (
          <Link
            key={item}
            href={chatHref(
              ticker,
              buildScopeQuestion({ companyName, item, label, locale }),
              locale,
            )}
            className="group grid min-h-[76px] gap-2 px-sm py-3 transition-colors hover:bg-surface-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
          >
            <div className="flex min-w-0 items-start justify-between gap-3">
              <p className="min-w-0 text-[14px] font-black leading-6 text-ink [word-break:keep-all]">
                {item}
              </p>
              <span className="font-mono text-[11px] font-black leading-5 text-muted">
                {String(itemIndex + 1).padStart(2, "0")}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function buildScopeQuestion({
  companyName,
  item,
  label,
  locale,
}: {
  companyName: string;
  item: string;
  label: string;
  locale: Locale;
}): string {
  if (locale === "ko") {
    return `${companyName}의 ${item}을 ${label} 관점에서 공시 근거로 정리해줘.`;
  }

  return `Analyze ${companyName}'s ${item} from the ${label.toLowerCase()} perspective using filing evidence.`;
}

function scopeItemsFromValue(value: string): string[] {
  const cleaned = value
    .replace(/^리서치 초점\s*:\s*/, "")
    .replace(/^핵심 성장 동력\s*:\s*/, "")
    .replace(/^리스크 변수\s*:\s*/, "")
    .replace(/^주요 리스크 요인\s*:\s*/, "")
    .replace(/^Research focus\s*:\s*/i, "")
    .replace(/^Core strengths\s*:\s*/i, "")
    .replace(/^Risk variables\s*:\s*/i, "")
    .replace(/^Key risks\s*:\s*/i, "")
    .trim();

  const items = cleaned
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  return items.length > 0 ? items : [value];
}
