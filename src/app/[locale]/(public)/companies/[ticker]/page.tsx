import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import TopNav from "@/components/TopNav";
import CompanyLogo from "@/components/CompanyLogo";
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
import type { UserCompanyMarkRow } from "@/types/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CompanyPageProps = {
  params: Promise<{ locale: string; ticker: string }>;
};

function chatHref(ticker: string, query?: string, locale?: Locale): string {
  const params = new URLSearchParams({ ticker });
  if (query) params.set("query", query);
  if (locale && locale !== DEFAULT_LOCALE) params.set("locale", locale);
  return `/chat/new?${params.toString()}`;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

export default async function CompanyLandingPage({ params }: CompanyPageProps) {
  const nonce = await getCspNonce();
  const { locale, ticker: rawTicker } = await params;
  if (!isLocale(locale)) notFound();

  const ticker = normalizeTicker(rawTicker);
  const [company, user] = await Promise.all([
    ticker ? getIndexedCompany(ticker) : Promise.resolve(null),
    getAuthUser().catch(() => null),
  ]);

  if (!company) notFound();

  const institutionalActivity = await getInstitutionalTickerActivity(
    company.ticker,
  ).catch(() => []);

  let savedMark: Pick<
    UserCompanyMarkRow,
    "is_watchlisted" | "is_holding"
  > | null = null;
  if (user) {
    const { data } = await getSupabaseAdmin()
      .from("user_company_marks")
      .select("is_watchlisted, is_holding")
      .eq("user_id", user.id)
      .eq("ticker", company.ticker)
      .maybeSingle<Pick<UserCompanyMarkRow, "is_watchlisted" | "is_holding">>();
    savedMark = data ?? null;
  }

  const metadata = user?.user_metadata;
  const initialUserProfile = user?.email
    ? {
        email: user.email,
        name:
          stringValue(metadata?.full_name) ??
          stringValue(metadata?.name) ??
          stringValue(metadata?.display_name),
        avatarUrl:
          stringValue(metadata?.avatar_url) ??
          stringValue(metadata?.picture) ??
          stringValue(metadata?.photo_url),
      }
    : null;
  const preserveInitialUserProfile =
    user?.app_metadata?.provider === "dev-auth-bypass";

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
          guruCta: "구루 관점으로 보기",
          watchlistInterestCta: "관심",
          watchlistHoldingCta: "보유",
          watchlistInterestSaved: "관심 저장됨",
          watchlistHoldingSaved: "보유 저장됨",
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
          guruCta: "View through a Guru lens",
          watchlistInterestCta: "Watch",
          watchlistHoldingCta: "Holding",
          watchlistInterestSaved: "Watch saved",
          watchlistHoldingSaved: "Holding saved",
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
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <JsonLdScript nonce={nonce} data={jsonLd} />
      <TopNav
        initialUserProfile={initialUserProfile}
        preserveInitialUserProfile={preserveInitialUserProfile}
        brandHref="/companies"
        brandAriaLabel={
          locale === "ko" ? "회사 목록으로 이동" : "Go to companies"
        }
        showSidebarTrigger
        showLocaleSwitcher
      />
      <main
        id="main-content"
        className="px-base pb-[112px] pt-xl sm:px-md md:px-xl md:pb-[96px] md:pt-[72px]"
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
                  initialSavedAction={
                    savedMark?.is_holding
                      ? "holding"
                      : savedMark?.is_watchlisted
                        ? "watchlist"
                        : null
                  }
                  labels={{
                    watchlist: pageCopy.watchlistInterestCta,
                    holding: pageCopy.watchlistHoldingCta,
                    savedWatchlist: pageCopy.watchlistInterestSaved,
                    savedHolding: pageCopy.watchlistHoldingSaved,
                    saving: pageCopy.watchlistSaving,
                    error: pageCopy.watchlistError,
                  }}
                  analyticsProperties={{
                    company_name: displayCompany.name,
                    source_surface: "company_hero",
                  }}
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
