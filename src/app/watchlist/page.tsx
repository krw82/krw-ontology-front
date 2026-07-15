import { redirect } from "next/navigation";
import type { Metadata } from "next";
import TopNav from "@/components/TopNav";
import WatchlistHomeClient from "@/components/watchlist/WatchlistHomeClient";
import { getAuthUser } from "@/lib/auth";
import { getEntitlementStatus } from "@/lib/billing/entitlement";
import { isEntitlementFeatureEnabled } from "@/lib/billing/feature-access";
import {
  shouldPreserveInitialProfile,
  topNavProfileFromUser,
} from "@/lib/auth/user-profile";
import { listWatchlistOverview } from "@/lib/watchlist/workspace";
import type { WatchlistOverviewResponse } from "@/types/api-contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "리서치 노트북 | KRW.O",
  description: "보유 종목과 관심 종목의 리서치 이유, 질문, 노트를 관리합니다.",
};

const EMPTY_OVERVIEW: WatchlistOverviewResponse = {
  companies: [],
  research_inbox: [],
  stats: {
    total: 0,
    watchlisted: 0,
    holding: 0,
    open_questions: 0,
    notes: 0,
    recent_activity: 0,
  },
};

async function loadWatchlistPageData(userId: string): Promise<{
  overview: WatchlistOverviewResponse;
  loadError: string | null;
}> {
  try {
    return {
      overview: await listWatchlistOverview(userId),
      loadError: null,
    };
  } catch {
    return {
      overview: EMPTY_OVERVIEW,
      loadError: "리서치 노트북 데이터를 불러오지 못했습니다.",
    };
  }
}

export default async function WatchlistPage() {
  const user = await getAuthUser().catch(() => null);
  if (!user) {
    redirect("/login?next=/watchlist");
  }

  const entitlement = await getEntitlementStatus(user.id, user.email ?? null);
  if (!isEntitlementFeatureEnabled(entitlement, "research_notebook")) {
    redirect("/settings/billing?feature=research_notebook");
  }

  const { overview, loadError } = await loadWatchlistPageData(user.id);

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <TopNav
        initialUserProfile={topNavProfileFromUser(user)}
        preserveInitialUserProfile={shouldPreserveInitialProfile(user)}
        brandHref="/companies"
        brandAriaLabel="회사 목록으로 이동"
      />
      <WatchlistHomeClient overview={overview} loadError={loadError} />
    </div>
  );
}
