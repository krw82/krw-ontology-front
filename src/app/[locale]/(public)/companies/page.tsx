import TopNav from "@/components/TopNav";
import CompaniesBrowser from "@/components/CompaniesBrowser";
import { getCompanyDisplayCopyForTicker } from "@/content/companies/display";
import { isLocale } from "@/i18n/config";
import { localizedPageMetadata } from "@/i18n/metadata";
import { getAuthUser } from "@/lib/auth";
import { buildSiteOgImagePath, SITE_NAME } from "@/lib/marketing/site";
import { listIndexedCompanies } from "@/lib/ontology/catalog";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CompaniesPageProps = {
  params: Promise<{ locale: string }>;
};

const companiesMetadataCopy = {
  ko: {
    title: "분석 가능한 회사 목록",
    description:
      "KRW Ontology에서 공시 근거 기반으로 분석할 수 있는 미국 상장기업을 티커, 사업 활동, 리스크 키워드로 찾아보세요.",
  },
  en: {
    title: "Companies available for analysis",
    description:
      "Browse U.S. public companies available in KRW Ontology by ticker, business activity, and risk keyword.",
  },
} as const;

export async function generateMetadata({
  params,
}: CompaniesPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return localizedPageMetadata({
    locale,
    ...companiesMetadataCopy[locale],
    path: "/companies",
    image: {
      url: buildSiteOgImagePath("companies", locale),
      alt: `${companiesMetadataCopy[locale].title} | ${SITE_NAME}`,
    },
  });
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export default async function CompaniesPage({ params }: CompaniesPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const [companies, user] = await Promise.all([
    listIndexedCompanies(),
    getAuthUser().catch(() => null),
  ]);
  const displayCompanies = companies.map((company) => ({
    ...company,
    ...getCompanyDisplayCopyForTicker(locale, company.ticker),
  }));
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

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <TopNav
        initialUserProfile={initialUserProfile}
        preserveInitialUserProfile={preserveInitialUserProfile}
        brandHref="/companies"
        brandAriaLabel={locale === "ko" ? "회사 목록으로 이동" : "Go to companies"}
        showSidebarTrigger
        showLocaleSwitcher
      />
      <CompaniesBrowser
        initialCompanies={displayCompanies}
        locale={locale}
      />
    </div>
  );
}
