import { redirect } from "next/navigation";
import type { Metadata } from "next";
import FollowedCompaniesCard from "@/components/FollowedCompaniesCard";
import { getAuthUser } from "@/lib/auth";
import { getEntitlementStatus } from "@/lib/billing/entitlement";
import { isEntitlementFeatureEnabled } from "@/lib/billing/feature-access";
import { listUserCompanyFollows } from "@/lib/follow/company-follow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "관심 기업 | KRW.O",
  description: "관심 기업 목록을 확인하고 새 소식 알림을 관리합니다.",
};

export default async function FollowedCompaniesPage() {
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/settings/companies");

  const entitlement = await getEntitlementStatus(user.id, user.email ?? null);
  // 목록 로드 실패가 페이지 전체를 막아서는 안 된다 — 빈 목록으로 시작한다.
  const companies = await listUserCompanyFollows(user.id).catch(() => []);

  return (
    <div className="bg-canvas text-ink">
      <main
        id="main-content"
        className="mx-auto w-full max-w-2xl px-base py-2xl"
      >
        <FollowedCompaniesCard
          initialCompanies={companies}
          activeLimit={entitlement.plan.key === "free" ? 3 : null}
          hasNotebook={isEntitlementFeatureEnabled(
            entitlement,
            "research_notebook",
          )}
        />
      </main>
    </div>
  );
}
