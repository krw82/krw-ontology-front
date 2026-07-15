import { redirect } from "next/navigation";
import TopNav from "@/components/TopNav";
import PulseFeed from "@/components/pulse/PulseFeed";
import { getAuthUser } from "@/lib/auth";
import { shouldPreserveInitialProfile, topNavProfileFromUser } from "@/lib/auth/user-profile";
import { canAccessMenuFeature } from "@/lib/billing/feature-access-server";
import { composePulseFeed } from "@/lib/pulse/composer";
import { isPulseFeedEnabled } from "@/lib/pulse/enabled";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { PulseFilter } from "@/types/api-contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_FILTERS = new Set<PulseFilter>(["all", "filing", "checkup", "question", "resurface", "learning"]);

export default async function PulsePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  if (!isPulseFeedEnabled()) redirect("/filings");
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/pulse");
  const requestedFilter = (await searchParams).filter as PulseFilter | undefined;
  const filter = requestedFilter && VALID_FILTERS.has(requestedFilter) ? requestedFilter : "all";
  const includeNotebookSources = await canAccessMenuFeature(user.id, user.email, "research_notebook").catch(() => false);
  const initialFeed = await composePulseFeed({
    supabase: getSupabaseAdmin(),
    userId: user.id,
    includeNotebookSources,
    filter,
  });

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <TopNav initialUserProfile={topNavProfileFromUser(user)} preserveInitialUserProfile={shouldPreserveInitialProfile(user)} />
      <PulseFeed initialFeed={initialFeed} />
    </div>
  );
}
