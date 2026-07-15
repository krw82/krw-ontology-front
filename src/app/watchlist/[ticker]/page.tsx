import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import ChatSidebar from "@/components/ChatSidebar";
import TopNav from "@/components/TopNav";
import WatchlistWorkspaceClient from "@/components/watchlist/WatchlistWorkspaceClient";
import { getAuthUser } from "@/lib/auth";
import { getEntitlementStatus } from "@/lib/billing/entitlement";
import { isEntitlementFeatureEnabled } from "@/lib/billing/feature-access";
import {
  shouldPreserveInitialProfile,
  topNavProfileFromUser,
} from "@/lib/auth/user-profile";
import { normalizeTicker } from "@/lib/ontology/ticker";
import { getWatchlistCompanyDetail } from "@/lib/watchlist/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type WatchlistCompanyPageProps = {
  params: Promise<{ ticker: string }>;
};

export async function generateMetadata({
  params,
}: WatchlistCompanyPageProps): Promise<Metadata> {
  const { ticker: rawTicker } = await params;
  const ticker = normalizeTicker(rawTicker) ?? rawTicker.toUpperCase();
  return {
    title: `${ticker} 리서치 | KRW.O`,
    description: `${ticker} 개인 리서치 카드, 질문, 노트, thesis를 관리합니다.`,
  };
}

export default async function WatchlistCompanyPage({
  params,
}: WatchlistCompanyPageProps) {
  const user = await getAuthUser().catch(() => null);
  if (!user) {
    const { ticker } = await params;
    redirect(`/login?next=/watchlist/${encodeURIComponent(ticker)}`);
  }

  const entitlement = await getEntitlementStatus(user.id, user.email ?? null);
  if (!isEntitlementFeatureEnabled(entitlement, "research_notebook")) {
    redirect("/settings/billing?feature=research_notebook");
  }

  const { ticker: rawTicker } = await params;
  const detail = await getWatchlistCompanyDetail(user.id, rawTicker);
  if (!detail) notFound();

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <TopNav
        initialUserProfile={topNavProfileFromUser(user)}
        preserveInitialUserProfile={shouldPreserveInitialProfile(user)}
        brandHref="/companies"
        brandAriaLabel="회사 목록으로 이동"
        showSidebarTrigger
      />
      <ChatSidebar
        activeSessionId={null}
        refreshSignal={`/watchlist/${detail.company.ticker}`}
        showDesktopSidebar={false}
      />
      <WatchlistWorkspaceClient detail={detail} />
    </div>
  );
}
