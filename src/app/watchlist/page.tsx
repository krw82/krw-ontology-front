import { redirect } from "next/navigation";
import type { Metadata } from "next";
import WatchlistHomeClient from "@/components/watchlist/WatchlistHomeClient";
import { getAuthUser } from "@/lib/auth";
import { getEntitlementStatus } from "@/lib/billing/entitlement";
import { isEntitlementFeatureEnabled } from "@/lib/billing/feature-access";
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
    interest: 0,
    holding: 0,
    open_questions: 0,
    notes: 0,
    recent_activity: 0,
  },
};

export default async function WatchlistPage() {
  const user = await getAuthUser().catch(() => null);
  if (!user) {
    redirect("/login?next=/watchlist");
  }

  const entitlement = await getEntitlementStatus(user.id, user.email ?? null);
  if (!isEntitlementFeatureEnabled(entitlement, "research_notebook")) {
    redirect("/settings/billing?feature=research_notebook");
  }

  return (
    <div className="bg-canvas text-ink">
      <WatchlistHomeClient
        overview={EMPTY_OVERVIEW}
        cacheOwnerId={user.id}
        loadOverview
      />
    </div>
  );
}
