import TopNav from "@/components/TopNav";
import CompaniesBrowser from "@/components/CompaniesBrowser";
import { getAuthUser } from "@/lib/auth";
import { listIndexedCompanies } from "@/lib/ontology/catalog";
import { getCompanyLandingCopyForTicker } from "@/lib/companies/landing-copy";
import { pageMetadata } from "@/lib/marketing/site";
import type { Metadata } from "next";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = pageMetadata({
  title: "분석 가능한 회사 목록",
  description:
    "KRW Ontology에서 공시 근거 기반으로 분석할 수 있는 미국 상장기업을 티커, 사업 활동, 리스크 키워드로 찾아보세요.",
  path: "/companies",
});

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export default async function CompaniesPage() {
  const [companies, user] = await Promise.all([
    listIndexedCompanies(),
    getAuthUser().catch(() => null),
  ]);
  const displayCompanies = companies.map((company) => ({
    ...company,
    ...getCompanyLandingCopyForTicker(company.ticker),
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

  return (
    <div className="min-h-[100dvh] bg-canvas">
      <TopNav
        initialUserProfile={initialUserProfile}
        brandHref="/"
        brandAriaLabel="홈으로 이동"
        showSidebarTrigger
      />
      <CompaniesBrowser initialCompanies={displayCompanies} />
    </div>
  );
}
