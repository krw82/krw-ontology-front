import { redirect } from "next/navigation";
import TopNav from "@/components/TopNav";
import PulseFeed from "@/components/pulse/PulseFeed";
import PulseLegacyFeed from "@/components/pulse/PulseLegacyFeed";
import { getAuthUser } from "@/lib/auth";
import {
  shouldPreserveInitialProfile,
  topNavProfileFromUser,
} from "@/lib/auth/user-profile";
import { canAccessMenuFeature } from "@/lib/billing/feature-access-server";
import { composePulseFeed } from "@/lib/pulse/composer";
import { isPulseFeedEnabled, isPulseP0V2Enabled } from "@/lib/pulse/enabled";
import { composeLegacyPulseFeed } from "@/lib/pulse/legacy-composer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { PulseFilter } from "@/types/api-contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEGACY_FILTERS = new Set<PulseFilter>([
  "all",
  "filing",
  "checkup",
  "question",
  "resurface",
  "learning",
]);

export default async function PulsePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  if (!isPulseFeedEnabled()) redirect("/filings");
  const p0V2Enabled = isPulseP0V2Enabled();
  const user = await getAuthUser().catch(() => null);
  if (!user) redirect("/login?next=/pulse");
  const includeNotebookSources = await canAccessMenuFeature(
    user.id,
    user.email,
    "research_notebook",
  ).catch(() => false);
  const requestedFilter = (await searchParams).filter as
    PulseFilter | undefined;
  const filter =
    !p0V2Enabled && requestedFilter && LEGACY_FILTERS.has(requestedFilter)
      ? requestedFilter
      : "all";
  const options = {
    supabase: getSupabaseAdmin(),
    userId: user.id,
    includeNotebookSources,
    filter: "all" as const,
  };
  const initialFeed = p0V2Enabled
    ? await composePulseFeed(options)
    : await composeLegacyPulseFeed({ ...options, filter });

  return (
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <TopNav
        initialUserProfile={topNavProfileFromUser(user)}
        preserveInitialUserProfile={shouldPreserveInitialProfile(user)}
      />
      {p0V2Enabled ? (
        <PulseFeed initialFeed={initialFeed} />
      ) : (
        <PulseLegacyFeed initialFeed={initialFeed} />
      )}
    </div>
  );
}
