import CompaniesBrowser from "@/components/CompaniesBrowser";
import { isLocale } from "@/i18n/config";
import { localizedPageMetadata } from "@/i18n/metadata";
import { buildSiteOgImagePath, SITE_NAME } from "@/lib/marketing/site";
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
      "KRW.O에서 공시 근거 기반으로 분석할 수 있는 미국 상장기업을 티커, 사업 활동, 리스크 키워드로 찾아보세요.",
  },
  en: {
    title: "Companies available for analysis",
    description:
      "Browse U.S. public companies available in KRW.O by ticker, business activity, and risk keyword.",
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

export default async function CompaniesPage({ params }: CompaniesPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <div className="bg-canvas">
      <CompaniesBrowser
        initialCompanies={[]}
        locale={locale}
        loadCatalog
      />
    </div>
  );
}
