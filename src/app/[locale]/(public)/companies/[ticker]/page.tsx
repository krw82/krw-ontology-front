import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import TopNav from "@/components/TopNav";
import MarketingCtaLink from "@/components/MarketingCtaLink";
import SuggestedPromptActions from "@/components/SuggestedPromptActions";
import {
  getCompanyDisplayCopyForTicker,
  getSuggestedPromptDisplaysForTickers,
} from "@/content/companies/display";
import { isLocale } from "@/i18n/config";
import { localizedPageMetadata } from "@/i18n/metadata";
import { localizedPath } from "@/i18n/routing";
import { getAuthUser } from "@/lib/auth";
import { getIndexedCompany } from "@/lib/ontology/catalog";
import { normalizeTicker } from "@/lib/ontology/ticker";
import {
  getSuggestedPromptsForTickers,
} from "@/lib/companies/landing-copy";
import { absoluteUrl, SITE_NAME } from "@/lib/marketing/site";
import { getCspNonce } from "@/lib/security/csp-nonce";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CompanyPageProps = {
  params: Promise<{ locale: string; ticker: string }>;
};

function chatHref(ticker: string, query?: string): string {
  const params = new URLSearchParams({ ticker });
  if (query) params.set("query", query);
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
          ? "현재 KRW Ontology 인덱스에서 찾을 수 없는 회사입니다."
          : "This company is not currently available in the KRW Ontology index.",
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
  });
}

export default async function CompanyLandingPage({
  params,
}: CompanyPageProps) {
  const nonce = await getCspNonce();
  const { locale, ticker: rawTicker } = await params;
  if (!isLocale(locale)) notFound();

  const ticker = normalizeTicker(rawTicker);
  const [company, user] = await Promise.all([
    ticker ? getIndexedCompany(ticker) : Promise.resolve(null),
    getAuthUser().catch(() => null),
  ]);

  if (!company) notFound();

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

  const canonicalPrompts = getSuggestedPromptsForTickers([company.ticker]);
  const prompts = getSuggestedPromptDisplaysForTickers(locale, [company.ticker]);
  const promptHrefs = prompts.map((_, index) =>
    chatHref(company.ticker, canonicalPrompts[index]),
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
          startCta: `${displayCompany.ticker} 무료 분석 시작`,
          scopeEyebrow: "분석 범위",
          scopeHeading: `${companyTitleName} 리서치 초점`,
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
          scopeEyebrow: "Analysis scope",
          scopeHeading: `${displayCompany.name} research focus`,
          businessActivity: "Business activity",
          watchItem: "Watch item",
          fallbackActivity: "Company-specific business activity index",
          fallbackRisk: "Company-specific risk variable index",
        };

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: pageCopy.jsonLdName,
    url: absoluteUrl(localizedPath(locale, `/companies/${displayCompany.ticker}`)),
    isPartOf: {
      "@type": "WebSite",
      name: SITE_NAME,
      url: absoluteUrl(localizedPath(locale)),
    },
    about: {
      "@type": "Organization",
      name: displayCompany.name,
      tickerSymbol: displayCompany.ticker,
    },
  };

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <script
        nonce={nonce}
        type="application/ld+json"
        suppressHydrationWarning
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <TopNav
        initialUserProfile={initialUserProfile}
        preserveInitialUserProfile={preserveInitialUserProfile}
        brandHref={localizedPath(locale, "/companies")}
        brandAriaLabel={locale === "ko" ? "회사 목록으로 이동" : "Go to companies"}
        showSidebarTrigger
        showLocaleSwitcher
      />
      <main
        id="main-content"
        className="px-base pb-[112px] pt-xl sm:px-md md:px-xl md:pb-[96px] md:pt-[72px]"
      >
        <div className="mx-auto w-full max-w-5xl">
          <nav className="mb-6 text-[13px] font-bold leading-5 text-muted">
            <Link href={localizedPath(locale, "/companies")} className="hover:text-primary">
              {pageCopy.breadcrumbCompanies}
            </Link>
            <span className="mx-2 text-outline-variant">/</span>
            <span className="text-ink">{companyTitleName}</span>
          </nav>

          <header className="border-b border-hairline pb-8">
            <p className="font-mono text-[14px] font-black leading-5 tracking-[0.08em] text-primary">
              {displayCompany.name}
            </p>
            <h1 className="mt-3 max-w-4xl text-balance text-[34px] font-black leading-[1.08] tracking-normal text-ink sm:text-[48px]">
              {pageCopy.heroHeading}
            </h1>
            <p className="mt-4 max-w-3xl text-[16px] leading-7 text-body sm:text-[18px]">
              {displayCompany.description}
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <MarketingCtaLink
                href={chatHref(displayCompany.ticker)}
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

          <section className="border-b border-hairline pt-8 pb-3">
            <div className="grid gap-6 md:grid-cols-[180px_minmax(0,1fr)] md:items-start">
              <div>
                <p className="font-mono text-[11px] font-black uppercase tracking-[0.16em] text-primary">
                  {pageCopy.scopeEyebrow}
                </p>
                <h2 className="mt-2 text-[22px] font-black leading-7 text-ink">
                  {pageCopy.scopeHeading}
                </h2>
              </div>
              <div className="divide-y divide-hairline border-t border-hairline">
                <ScopeRow
                  index="01"
                  label={pageCopy.businessActivity}
                  value={
                    displayCompany.core_strength ??
                    pageCopy.fallbackActivity
                  }
                />
                <ScopeRow
                  index="02"
                  label={pageCopy.watchItem}
                  value={
                    displayCompany.critical_risk ??
                    pageCopy.fallbackRisk
                  }
                />
              </div>
            </div>
          </section>

        </div>
      </main>
    </div>
  );
}

function ScopeRow({
  index,
  label,
  value,
}: {
  index: string;
  label: string;
  value: string;
}) {
  return (
    <div className="grid gap-2 py-4 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-5">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[12px] font-black leading-none text-primary">
          {index}
        </span>
        <span className="text-[13px] font-extrabold leading-5 text-muted">
          {label}
        </span>
      </div>
      <p className="whitespace-pre-line text-[15px] font-extrabold leading-7 text-ink">
        {value}
      </p>
    </div>
  );
}
